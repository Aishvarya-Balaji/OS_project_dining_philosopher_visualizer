import {
  CasBackoffMode,
  DeterministicRng,
  ReadonlySimulationView,
  ResolvedSimulationConfig,
  Strategy,
  StrategyAction,
  StrategyEventDescriptor,
  StrategyStepResult,
} from '../types';

export interface CasDebugState {
  readonly algorithm: string;
  readonly semanticsNote: string;
  readonly backoffMode: CasBackoffMode;
  readonly fixedBackoffTicks: number;
  readonly maxRandomBackoffTicks: number;
  readonly totalAttempts: number;
  readonly totalSuccesses: number;
  readonly totalFailures: number;
  readonly totalRollbacks: number;
  readonly attemptsByPhilosopher: readonly number[];
  readonly failuresByPhilosopher: readonly number[];
  readonly rollbacksByPhilosopher: readonly number[];
  readonly backoffRemainingByPhilosopher: readonly number[];
  readonly activelyRetryingPhilosophers: readonly number[];
  readonly forkOwners: readonly (number | null)[];
  readonly [key: string]: unknown;
}

/**
 * Lock-free (simulated CAS) Strategy:
 *
 * Architectural Note:
 * This strategy is a deterministic tick-based simulation of compare-and-swap (CAS) semantics
 * on individual fork ownership cells (`CAS(forkCell[f], expected=null, desired=philosopherId)`),
 * NOT real hardware atomic CPU instructions (`LOCK CMPXCHG`).
 *
 * Protocol:
 * 1. Each Hungry/Waiting philosopher may perform at most ONE single-fork CAS attempt per tick
 *    (never atomic acquisition of two forks at once).
 * 2. Phase 1 (Holding 0 forks, backoff === 0):
 *    - Philosopher attempts `CAS(leftFork, null -> i)`.
 *    - On success, acquires `leftFork` and waits until the next tick to attempt `rightFork`.
 *    - On failure, enters back-off (`fixed` or `random` ticks) before retrying.
 * 3. Phase 2 (Holding leftFork from an earlier tick):
 *    - Philosopher attempts `CAS(rightFork, null -> i)`.
 *    - On success, acquires `rightFork` and immediately starts Eating.
 *    - On failure, rolls back (releases) `leftFork` so neighbors are not passively deadlocked,
 *      and enters back-off (`fixed` or seeded `random` ticks) before retrying.
 */
export class SimulatedCasStrategy implements Strategy {
  public readonly name = 'cas' as const;
  public readonly displayName = 'Lock-free (simulated CAS)';
  public readonly description =
    'Lock-free (simulated CAS): single-fork compare-and-swap per tick with left-fork rollback and fixed or seeded-random back-off.';

  private philosopherCount = 5;
  private backoffMode: CasBackoffMode = 'random';
  private fixedBackoffTicks = 2;
  private maxRandomBackoffTicks = 5;

  private totalAttempts = 0;
  private totalSuccesses = 0;
  private totalFailures = 0;
  private totalRollbacks = 0;

  private attemptsByPhilosopher: number[] = [];
  private failuresByPhilosopher: number[] = [];
  private rollbacksByPhilosopher: number[] = [];
  private backoffRemaining: number[] = [];
  private activelyRetrying: boolean[] = [];
  private forkOwners: (number | null)[] = [];

  constructor(options?: {
    philosopherCount?: number;
    backoffMode?: CasBackoffMode;
    fixedBackoffTicks?: number;
    maxRandomBackoffTicks?: number;
  }) {
    this.philosopherCount = options?.philosopherCount ?? 5;
    this.backoffMode = options?.backoffMode ?? 'random';
    this.fixedBackoffTicks = options?.fixedBackoffTicks ?? 2;
    this.maxRandomBackoffTicks = options?.maxRandomBackoffTicks ?? 5;
    this.initArrays(this.philosopherCount);
  }

  public reset(config?: ResolvedSimulationConfig): void {
    if (config) {
      this.philosopherCount = config.philosopherCount;
      this.backoffMode = config.casBackoffMode;
      this.fixedBackoffTicks = config.casFixedBackoffTicks;
      this.maxRandomBackoffTicks = config.casMaxRandomBackoffTicks;
    }
    this.totalAttempts = 0;
    this.totalSuccesses = 0;
    this.totalFailures = 0;
    this.totalRollbacks = 0;
    this.initArrays(this.philosopherCount);
  }

  public decide(view: ReadonlySimulationView, rng: DeterministicRng): StrategyStepResult {
    const actions: StrategyAction[] = [];
    const events: StrategyEventDescriptor[] = [];

    if (view.philosophers.length !== this.philosopherCount) {
      this.philosopherCount = view.philosophers.length;
      this.initArrays(this.philosopherCount);
    }

    // Sync backoff config from view.config
    this.backoffMode = view.config.casBackoffMode;
    this.fixedBackoffTicks = view.config.casFixedBackoffTicks;
    this.maxRandomBackoffTicks = view.config.casMaxRandomBackoffTicks;

    // Clear active retry / backoff flags for philosophers who are Thinking or Eating
    for (const phil of view.philosophers) {
      if (phil.state === 'Thinking' || phil.state === 'Eating') {
        this.backoffRemaining[phil.id] = 0;
        this.activelyRetrying[phil.id] = false;
      }
    }

    // Track fork ownership at the start of the tick.
    // Note: Forks rolled back during this tick remain unavailable until the end of the tick
    // so simultaneous right-fork CAS attempts observe the true start-of-tick ownership,
    // whereas newly acquired forks immediately update `casForkCells` to prevent double-claims.
    const casForkCells = new Map<number, number>();
    this.forkOwners = view.forks.map((f) => {
      if (f.ownerId !== null) {
        casForkCells.set(f.id, f.ownerId);
      }
      return f.ownerId;
    });

    for (const phil of view.philosophers) {
      if (phil.state !== 'Hungry' && phil.state !== 'Waiting') {
        continue;
      }

      const id = phil.id;
      const currentBackoff = this.backoffRemaining[id] ?? 0;

      // Case 0: Philosopher is currently in back-off cooldown
      if (currentBackoff > 0) {
        const nextBackoff = currentBackoff - 1;
        this.backoffRemaining[id] = nextBackoff;
        actions.push({
          type: 'WAIT',
          philosopherId: id,
          reason: `Lock-free (simulated CAS): Philosopher ${id} is backing off (${nextBackoff} tick(s) left in ${this.backoffMode} back-off).`,
        });
        continue;
      }

      const holdsLeft = phil.heldForkIds.includes(phil.leftForkId);
      const holdsRight = phil.heldForkIds.includes(phil.rightForkId);

      // Case 1: Holding 0 forks -> 1 CAS attempt on leftForkId
      if (!holdsLeft) {
        this.totalAttempts += 1;
        this.attemptsByPhilosopher[id] = (this.attemptsByPhilosopher[id] ?? 0) + 1;

        const currentOwner = casForkCells.get(phil.leftForkId);
        if (currentOwner === undefined) {
          // Simulated CAS(leftFork, expected: null, desired: id) -> SUCCESS
          casForkCells.set(phil.leftForkId, id);
          this.forkOwners[phil.leftForkId] = id;
          this.totalSuccesses += 1;

          events.push({
            type: 'CAS_ATTEMPT',
            philosopherId: id,
            forkId: phil.leftForkId,
            reason: `Lock-free (simulated CAS): CAS(F${phil.leftForkId}, null -> P${id}) succeeded; Philosopher ${id} claimed left fork ${phil.leftForkId} and will attempt right fork ${phil.rightForkId} next tick.`,
            details: {
              success: true,
              phase: 'left',
              backoffMode: this.backoffMode,
            },
          });

          actions.push({
            type: 'ACQUIRE_FORK',
            philosopherId: id,
            forkId: phil.leftForkId,
            reason: `Simulated CAS succeeded on left fork ${phil.leftForkId}.`,
          });
          actions.push({
            type: 'WAIT',
            philosopherId: id,
            reason: `Philosopher ${id} holds left fork ${phil.leftForkId} after CAS and waits one tick before attempting CAS on right fork ${phil.rightForkId}.`,
          });
        } else {
          // Simulated CAS(leftFork, expected: null, desired: id) -> FAILED
          this.totalFailures += 1;
          this.failuresByPhilosopher[id] = (this.failuresByPhilosopher[id] ?? 0) + 1;
          this.activelyRetrying[id] = true;

          const backoffTicks = this.sampleBackoffTicks(rng);
          // Subtract 1 for the current tick spent waiting so backoffTicks === 1 retries on the next tick,
          // or keep full countdown for backoffTicks >= 1
          this.backoffRemaining[id] = backoffTicks;

          events.push({
            type: 'CAS_ATTEMPT',
            philosopherId: id,
            forkId: phil.leftForkId,
            reason: `Lock-free (simulated CAS): CAS(F${phil.leftForkId}, null -> P${id}) failed because F${phil.leftForkId} is owned by P${currentOwner}.`,
            details: {
              success: false,
              phase: 'left',
              ownerId: currentOwner,
            },
          });

          events.push({
            type: 'CAS_BACKOFF',
            philosopherId: id,
            forkId: phil.leftForkId,
            reason: `Lock-free (simulated CAS): Philosopher ${id} backing off for ${backoffTicks} tick(s) (${this.backoffMode} mode) after failed left-fork CAS.`,
            details: {
              backoffTicks,
              backoffMode: this.backoffMode,
            },
          });

          actions.push({
            type: 'WAIT',
            philosopherId: id,
            reason: `Simulated CAS on left fork ${phil.leftForkId} failed; backing off for ${backoffTicks} tick(s).`,
          });
        }
        continue;
      }

      // Case 2: Already holding leftForkId -> 1 CAS attempt on rightForkId
      if (holdsLeft && !holdsRight) {
        this.totalAttempts += 1;
        this.attemptsByPhilosopher[id] = (this.attemptsByPhilosopher[id] ?? 0) + 1;

        const currentOwner = casForkCells.get(phil.rightForkId);
        if (currentOwner === undefined) {
          // Simulated CAS(rightFork, expected: null, desired: id) -> SUCCESS
          casForkCells.set(phil.rightForkId, id);
          this.forkOwners[phil.rightForkId] = id;
          this.totalSuccesses += 1;
          this.activelyRetrying[id] = false;
          this.backoffRemaining[id] = 0;

          events.push({
            type: 'CAS_ATTEMPT',
            philosopherId: id,
            forkId: phil.rightForkId,
            reason: `Lock-free (simulated CAS): CAS(F${phil.rightForkId}, null -> P${id}) succeeded; Philosopher ${id} now holds both forks (${phil.leftForkId}, ${phil.rightForkId}).`,
            details: {
              success: true,
              phase: 'right',
              backoffMode: this.backoffMode,
            },
          });

          actions.push({
            type: 'ACQUIRE_FORK',
            philosopherId: id,
            forkId: phil.rightForkId,
            reason: `Simulated CAS succeeded on right fork ${phil.rightForkId}.`,
          });
          actions.push({
            type: 'START_EATING',
            philosopherId: id,
            reason: `Lock-free (simulated CAS): Philosopher ${id} acquired both forks (${phil.leftForkId} and ${phil.rightForkId}) via two-step CAS and starts eating.`,
          });
        } else {
          // Simulated CAS(rightFork, expected: null, desired: id) -> FAILED -> Roll back leftFork and back off!
          this.totalFailures += 1;
          this.totalRollbacks += 1;
          this.failuresByPhilosopher[id] = (this.failuresByPhilosopher[id] ?? 0) + 1;
          this.rollbacksByPhilosopher[id] = (this.rollbacksByPhilosopher[id] ?? 0) + 1;
          this.activelyRetrying[id] = true;
          this.forkOwners[phil.leftForkId] = null;

          const backoffTicks = this.sampleBackoffTicks(rng);
          this.backoffRemaining[id] = backoffTicks;

          events.push({
            type: 'CAS_ATTEMPT',
            philosopherId: id,
            forkId: phil.rightForkId,
            reason: `Lock-free (simulated CAS): CAS(F${phil.rightForkId}, null -> P${id}) failed because F${phil.rightForkId} is held by P${currentOwner}.`,
            details: {
              success: false,
              phase: 'right',
              ownerId: currentOwner,
            },
          });

          events.push({
            type: 'CAS_ROLLBACK',
            philosopherId: id,
            forkId: phil.leftForkId,
            reason: `Lock-free (simulated CAS) rollback: Philosopher ${id} released left fork ${phil.leftForkId} after right-fork CAS(F${phil.rightForkId}) failed.`,
            details: {
              rolledBackForkId: phil.leftForkId,
              failedForkId: phil.rightForkId,
            },
          });

          events.push({
            type: 'CAS_BACKOFF',
            philosopherId: id,
            forkId: phil.rightForkId,
            reason: `Lock-free (simulated CAS) back-off: Philosopher ${id} backing off for ${backoffTicks} tick(s) (${this.backoffMode} mode) after rolling back F${phil.leftForkId}.`,
            details: {
              backoffTicks,
              backoffMode: this.backoffMode,
            },
          });

          actions.push({
            type: 'RELEASE_FORK',
            philosopherId: id,
            forkId: phil.leftForkId,
            reason: `Simulated CAS rollback: releasing left fork ${phil.leftForkId} because right fork ${phil.rightForkId} was busy.`,
          });
          actions.push({
            type: 'WAIT',
            philosopherId: id,
            reason: `Philosopher ${id} rolled back left fork ${phil.leftForkId} and is backing off for ${backoffTicks} tick(s) (${this.backoffMode} mode).`,
          });
        }
      }
    }

    return { actions, events };
  }

  public getInternalState(): CasDebugState {
    const activelyRetryingPhilosophers: number[] = [];
    for (let i = 0; i < this.philosopherCount; i++) {
      if (this.activelyRetrying[i]) {
        activelyRetryingPhilosophers.push(i);
      }
    }

    return Object.freeze({
      algorithm: this.displayName,
      semanticsNote:
        'Deterministic tick-based simulation of single-cell CAS semantics, not hardware atomic CPU instructions.',
      backoffMode: this.backoffMode,
      fixedBackoffTicks: this.fixedBackoffTicks,
      maxRandomBackoffTicks: this.maxRandomBackoffTicks,
      totalAttempts: this.totalAttempts,
      totalSuccesses: this.totalSuccesses,
      totalFailures: this.totalFailures,
      totalRollbacks: this.totalRollbacks,
      attemptsByPhilosopher: Object.freeze([...this.attemptsByPhilosopher]),
      failuresByPhilosopher: Object.freeze([...this.failuresByPhilosopher]),
      rollbacksByPhilosopher: Object.freeze([...this.rollbacksByPhilosopher]),
      backoffRemainingByPhilosopher: Object.freeze([...this.backoffRemaining]),
      activelyRetryingPhilosophers: Object.freeze(activelyRetryingPhilosophers),
      forkOwners: Object.freeze([...this.forkOwners]),
    });
  }

  private sampleBackoffTicks(rng: DeterministicRng): number {
    if (this.backoffMode === 'fixed') {
      return this.fixedBackoffTicks;
    }
    return rng.nextInt(1, this.maxRandomBackoffTicks);
  }

  private initArrays(count: number): void {
    this.attemptsByPhilosopher = Array.from({ length: count }, () => 0);
    this.failuresByPhilosopher = Array.from({ length: count }, () => 0);
    this.rollbacksByPhilosopher = Array.from({ length: count }, () => 0);
    this.backoffRemaining = Array.from({ length: count }, () => 0);
    this.activelyRetrying = Array.from({ length: count }, () => false);
    this.forkOwners = Array.from({ length: count }, () => null);
  }
}
