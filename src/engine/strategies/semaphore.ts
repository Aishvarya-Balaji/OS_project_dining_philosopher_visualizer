import {
  ReadonlySimulationView,
  ResolvedSimulationConfig,
  Strategy,
  StrategyAction,
  StrategyEventDescriptor,
  StrategyStepResult,
} from '../types';

export interface SemaphoreDebugState {
  readonly availablePermits: number;
  readonly maxPermits: number;
  readonly queue: readonly number[];
  readonly admittedPhilosophers: readonly number[];
  readonly forkOwners: readonly (number | null)[];
  readonly [key: string]: unknown;
}

/**
 * Counting Semaphore Strategy (N - 1 Room Permits + FIFO Queue):
 * - Maintains a counting semaphore initialized to N - 1 permits (4 permits for 5 philosophers).
 * - A Hungry/Waiting philosopher must acquire a room permit before attempting to pick up any fork.
 * - If no permit is available, the philosopher is placed in a strict FIFO waiting queue.
 * - Once admitted with a permit, the philosopher acquires their left fork first and their right
 *   fork on a subsequent tick (same 1-tick inter-fork delay as the Naive strategy).
 * - When a philosopher finishes eating and releases their forks, their room permit is released
 *   and immediately passed to the head of the FIFO queue without barging.
 */
export class SemaphoreStrategy implements Strategy {
  public readonly name = 'semaphore' as const;
  public readonly description =
    'Counting semaphore with N-1 room permits and a strict FIFO queue; prevents circular-wait deadlock.';

  private philosopherCount = 5;
  private maxPermits = 4;
  private admittedPhilosophers: number[] = [];
  private waitQueue: number[] = [];
  private forkOwners: (number | null)[] = [null, null, null, null, null];
  private loggedDenials = new Set<string>();

  constructor(philosopherCount = 5) {
    this.configureCount(philosopherCount);
  }

  public reset(config?: ResolvedSimulationConfig): void {
    const count = config?.philosopherCount ?? this.philosopherCount;
    this.configureCount(count);
    this.admittedPhilosophers = [];
    this.waitQueue = [];
    this.forkOwners = Array.from({ length: count }, () => null);
    this.loggedDenials.clear();
  }

  public decide(view: ReadonlySimulationView): StrategyStepResult {
    const actions: StrategyAction[] = [];
    const events: StrategyEventDescriptor[] = [];

    if (view.philosophers.length !== this.philosopherCount) {
      this.configureCount(view.philosophers.length);
    }

    // Clear denial logs for philosophers who are Thinking or Eating
    for (const phil of view.philosophers) {
      if (phil.state === 'Thinking' || phil.state === 'Eating') {
        this.loggedDenials.delete(`${phil.id}:${phil.leftForkId}`);
        this.loggedDenials.delete(`${phil.id}:${phil.rightForkId}`);
      }
    }

    // 1. Release permits for philosophers who completed their meal at the start of this tick
    //    and hand permits directly to the first queued waiter in FIFO order (no barging).
    for (const completedId of view.completedEatersThisTick) {
      this.releasePermitAndSignalNext(completedId, view, events);
    }

    // Defensive cleanup: if any admitted philosopher is currently Thinking (e.g. custom test view),
    // release their permit as well.
    for (const admittedId of [...this.admittedPhilosophers]) {
      const phil = view.philosophers[admittedId];
      if (phil && phil.state === 'Thinking' && !view.completedEatersThisTick.includes(admittedId)) {
        this.releasePermitAndSignalNext(admittedId, view, events);
      }
    }

    // 2. Process Hungry/Waiting philosophers who neither hold a permit nor are in the FIFO queue yet.
    for (const phil of view.philosophers) {
      if (phil.state !== 'Hungry' && phil.state !== 'Waiting') {
        continue;
      }

      const isAdmitted = this.admittedPhilosophers.includes(phil.id);
      const isQueued = this.waitQueue.includes(phil.id);

      if (!isAdmitted && !isQueued) {
        // Strict no-barging rule: only grant immediately if queue is empty and permits are available
        if (this.waitQueue.length === 0 && this.admittedPhilosophers.length < this.maxPermits) {
          this.admittedPhilosophers.push(phil.id);
          const remaining = this.maxPermits - this.admittedPhilosophers.length;
          events.push({
            type: 'SEMAPHORE_ACQUIRED',
            philosopherId: phil.id,
            reason: `Semaphore strategy: Philosopher ${phil.id} acquired a room permit (${remaining}/${this.maxPermits} permits remaining).`,
            details: {
              availablePermits: remaining,
              maxPermits: this.maxPermits,
            },
          });
        } else {
          this.waitQueue.push(phil.id);
          events.push({
            type: 'SEMAPHORE_QUEUED',
            philosopherId: phil.id,
            reason: `Semaphore strategy: All ${this.maxPermits} room permits are in use; Philosopher ${phil.id} joined FIFO wait queue at position ${this.waitQueue.length}.`,
            details: {
              queuePosition: this.waitQueue.length,
              availablePermits: this.maxPermits - this.admittedPhilosophers.length,
            },
          });
        }
      }
    }

    // If any permits are still available while waiters are queued, admit from the head of the FIFO queue
    while (this.admittedPhilosophers.length < this.maxPermits && this.waitQueue.length > 0) {
      const nextId = this.waitQueue.shift()!;
      const nextPhil = view.philosophers[nextId];
      if (nextPhil && (nextPhil.state === 'Hungry' || nextPhil.state === 'Waiting')) {
        this.admittedPhilosophers.push(nextId);
        const remaining = this.maxPermits - this.admittedPhilosophers.length;
        events.push({
          type: 'SEMAPHORE_ACQUIRED',
          philosopherId: nextId,
          reason: `Semaphore strategy: Queued Philosopher ${nextId} acquired a room permit in FIFO order (${remaining}/${this.maxPermits} permits remaining).`,
          details: {
            availablePermits: remaining,
            maxPermits: this.maxPermits,
          },
        });
      }
    }

    // 3. Track current fork owners
    const reservedForkOwners = new Map<number, number>();
    this.forkOwners = view.forks.map((f) => {
      if (f.ownerId !== null) {
        reservedForkOwners.set(f.id, f.ownerId);
      }
      return f.ownerId;
    });

    // 4. Evaluate fork acquisition for Hungry/Waiting philosophers
    for (const phil of view.philosophers) {
      if (phil.state !== 'Hungry' && phil.state !== 'Waiting') {
        continue;
      }

      const isAdmitted = this.admittedPhilosophers.includes(phil.id);
      if (!isAdmitted) {
        const queueIndex = this.waitQueue.indexOf(phil.id);
        actions.push({
          type: 'WAIT',
          philosopherId: phil.id,
          reason: `Philosopher ${phil.id} is waiting in the semaphore FIFO queue (position ${queueIndex + 1}) before requesting forks.`,
        });
        continue;
      }

      const holdsLeft = phil.heldForkIds.includes(phil.leftForkId);
      const holdsRight = phil.heldForkIds.includes(phil.rightForkId);

      // Phase 1: Admitted philosopher does not yet hold left fork
      if (!holdsLeft) {
        const currentOwner = reservedForkOwners.get(phil.leftForkId);
        if (currentOwner === undefined) {
          reservedForkOwners.set(phil.leftForkId, phil.id);
          this.forkOwners[phil.leftForkId] = phil.id;
          this.loggedDenials.delete(`${phil.id}:${phil.leftForkId}`);
          actions.push({
            type: 'ACQUIRE_FORK',
            philosopherId: phil.id,
            forkId: phil.leftForkId,
            reason: `Semaphore strategy: Admitted Philosopher ${phil.id} acquired left fork ${phil.leftForkId} first and will request right fork ${phil.rightForkId} on the next tick.`,
          });
          actions.push({
            type: 'WAIT',
            philosopherId: phil.id,
            reason: `Admitted Philosopher ${phil.id} holds left fork ${phil.leftForkId} and waits one tick before requesting right fork ${phil.rightForkId}.`,
          });
        } else {
          const denialKey = `${phil.id}:${phil.leftForkId}`;
          if (!this.loggedDenials.has(denialKey)) {
            this.loggedDenials.add(denialKey);
            events.push({
              type: 'FORK_DENIED',
              philosopherId: phil.id,
              forkId: phil.leftForkId,
              reason: `Semaphore strategy: Admitted Philosopher ${phil.id} could not acquire left fork ${phil.leftForkId} (held by Philosopher ${currentOwner}).`,
            });
          }
          actions.push({
            type: 'WAIT',
            philosopherId: phil.id,
            reason: `Admitted Philosopher ${phil.id} is waiting for left fork ${phil.leftForkId} (held by Philosopher ${currentOwner}).`,
          });
        }
        continue;
      }

      // Phase 2: Admitted philosopher already holds left fork from an earlier tick
      if (holdsLeft && !holdsRight) {
        const currentOwner = reservedForkOwners.get(phil.rightForkId);
        if (currentOwner === undefined) {
          reservedForkOwners.set(phil.rightForkId, phil.id);
          this.forkOwners[phil.rightForkId] = phil.id;
          this.loggedDenials.delete(`${phil.id}:${phil.rightForkId}`);
          actions.push({
            type: 'ACQUIRE_FORK',
            philosopherId: phil.id,
            forkId: phil.rightForkId,
            reason: `Semaphore strategy: Admitted Philosopher ${phil.id} acquired right fork ${phil.rightForkId} while holding left fork ${phil.leftForkId}.`,
          });
          actions.push({
            type: 'START_EATING',
            philosopherId: phil.id,
            reason: `Semaphore strategy: Admitted Philosopher ${phil.id} holds both forks (${phil.leftForkId} and ${phil.rightForkId}) and starts eating.`,
          });
        } else {
          const denialKey = `${phil.id}:${phil.rightForkId}`;
          if (!this.loggedDenials.has(denialKey)) {
            this.loggedDenials.add(denialKey);
            events.push({
              type: 'FORK_DENIED',
              philosopherId: phil.id,
              forkId: phil.rightForkId,
              reason: `Semaphore strategy: Admitted Philosopher ${phil.id} holds left fork ${phil.leftForkId} and waits for right fork ${phil.rightForkId} (held by Philosopher ${currentOwner}).`,
            });
          }
          actions.push({
            type: 'WAIT',
            philosopherId: phil.id,
            reason: `Admitted Philosopher ${phil.id} keeps holding left fork ${phil.leftForkId} while waiting for right fork ${phil.rightForkId} (held by Philosopher ${currentOwner}).`,
          });
        }
      }
    }

    return { actions, events };
  }

  public getInternalState(): SemaphoreDebugState {
    const availablePermits = this.maxPermits - this.admittedPhilosophers.length;
    return Object.freeze({
      availablePermits,
      maxPermits: this.maxPermits,
      queue: Object.freeze([...this.waitQueue]),
      admittedPhilosophers: Object.freeze([...this.admittedPhilosophers]),
      forkOwners: Object.freeze([...this.forkOwners]),
    });
  }

  private configureCount(count: number): void {
    this.philosopherCount = count;
    this.maxPermits = Math.max(1, count - 1);
  }

  private releasePermitAndSignalNext(
    releasedPhilId: number,
    view: ReadonlySimulationView,
    events: StrategyEventDescriptor[]
  ): void {
    const idx = this.admittedPhilosophers.indexOf(releasedPhilId);
    if (idx === -1) {
      return;
    }

    this.admittedPhilosophers.splice(idx, 1);
    const availableAfterRelease = this.maxPermits - this.admittedPhilosophers.length;

    events.push({
      type: 'SEMAPHORE_RELEASED',
      philosopherId: releasedPhilId,
      reason: `Semaphore strategy: Philosopher ${releasedPhilId} finished eating and released their room permit (${availableAfterRelease}/${this.maxPermits} available).`,
      details: {
        availablePermits: availableAfterRelease,
        maxPermits: this.maxPermits,
      },
    });

    // Pass permit directly to the first valid waiter in the FIFO queue without barging
    while (this.waitQueue.length > 0 && this.admittedPhilosophers.length < this.maxPermits) {
      const nextWaiterId = this.waitQueue.shift()!;
      const nextPhil = view.philosophers[nextWaiterId];
      if (nextPhil && (nextPhil.state === 'Hungry' || nextPhil.state === 'Waiting')) {
        this.admittedPhilosophers.push(nextWaiterId);
        const remaining = this.maxPermits - this.admittedPhilosophers.length;
        events.push({
          type: 'SEMAPHORE_ACQUIRED',
          philosopherId: nextWaiterId,
          reason: `Semaphore strategy: Permit passed in FIFO order from Philosopher ${releasedPhilId} to queued Philosopher ${nextWaiterId} (${remaining}/${this.maxPermits} available).`,
          details: {
            passedFrom: releasedPhilId,
            availablePermits: remaining,
            maxPermits: this.maxPermits,
          },
        });
        break;
      }
    }
  }
}
