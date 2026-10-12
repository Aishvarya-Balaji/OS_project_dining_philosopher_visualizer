import { detectDeadlock } from './deadlockDetector';
import { detectLivelock } from './livelockDetector';
import { SeededRng } from './rng';
import { detectStarvation } from './starvationDetector';
import { SimulatedCasStrategy } from './strategies/cas';
import { MonitorStrategy } from './strategies/monitor';
import { NaiveStrategy } from './strategies/naive';
import { SemaphoreStrategy } from './strategies/semaphore';
import {
  DetectorStatus,
  ForkSnapshot,
  getLeftForkId,
  getRightForkId,
  PhilosopherSnapshot,
  PhilosopherState,
  ReadonlySimulationView,
  ResolvedSimulationConfig,
  SimulationConfig,
  SimulationEvent,
  SimulationEventType,
  SimulationSnapshot,
  Strategy,
  StrategyAction,
  StrategyName,
  StrategyStepResult,
} from './types';

/**
 * Error thrown whenever a strategy decision or engine state violates an OS resource/state invariant.
 */
export class InvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvariantError';
  }
}

/**
 * Checks whether a philosopher state transition is legal in the Dining Philosophers state machine:
 * - Thinking -> Hungry
 * - Hungry -> Waiting | Eating
 * - Waiting -> Eating
 * - Eating -> Thinking
 */
export function isLegalStateTransition(from: PhilosopherState, to: PhilosopherState): boolean {
  switch (from) {
    case 'Thinking':
      return to === 'Hungry';
    case 'Hungry':
      return to === 'Waiting' || to === 'Eating';
    case 'Waiting':
      return to === 'Eating';
    case 'Eating':
      return to === 'Thinking';
    default:
      return false;
  }
}

/**
 * Validates and resolves user/scenario configuration into a complete ResolvedSimulationConfig.
 * Throws an Error if any timing range or numeric parameter is invalid.
 */
export function resolveSimulationConfig(config: SimulationConfig = {}): ResolvedSimulationConfig {
  const philosopherCount = config.philosopherCount ?? 5;
  if (!Number.isInteger(philosopherCount) || philosopherCount < 2) {
    throw new Error(`Invalid philosopherCount: ${String(philosopherCount)}. Must be an integer >= 2.`);
  }

  const seed = config.seed ?? 42;
  if (!Number.isFinite(seed)) {
    throw new Error(`Invalid seed: ${String(seed)}. Must be a finite number.`);
  }

  const thinkTicksRange: readonly [number, number] = config.thinkTicksRange ?? [2, 4];
  validateTimingRange('thinkTicksRange', thinkTicksRange);

  const eatTicksRange: readonly [number, number] = config.eatTicksRange ?? [2, 3];
  validateTimingRange('eatTicksRange', eatTicksRange);

  if (config.perPhilosopherThinkRanges) {
    if (config.perPhilosopherThinkRanges.length !== philosopherCount) {
      throw new Error(
        `perPhilosopherThinkRanges length (${config.perPhilosopherThinkRanges.length}) must match philosopherCount (${philosopherCount}).`
      );
    }
    config.perPhilosopherThinkRanges.forEach((range, idx) =>
      validateTimingRange(`perPhilosopherThinkRanges[${idx}]`, range)
    );
  }

  if (config.perPhilosopherEatRanges) {
    if (config.perPhilosopherEatRanges.length !== philosopherCount) {
      throw new Error(
        `perPhilosopherEatRanges length (${config.perPhilosopherEatRanges.length}) must match philosopherCount (${philosopherCount}).`
      );
    }
    config.perPhilosopherEatRanges.forEach((range, idx) =>
      validateTimingRange(`perPhilosopherEatRanges[${idx}]`, range)
    );
  }

  if (config.initialStates && config.initialStates.length !== philosopherCount) {
    throw new Error(
      `initialStates length (${config.initialStates.length}) must match philosopherCount (${philosopherCount}).`
    );
  }

  if (config.initialThinkTicks) {
    if (config.initialThinkTicks.length !== philosopherCount) {
      throw new Error(
        `initialThinkTicks length (${config.initialThinkTicks.length}) must match philosopherCount (${philosopherCount}).`
      );
    }
    config.initialThinkTicks.forEach((ticks, idx) => {
      if (!Number.isInteger(ticks) || ticks < 1) {
        throw new Error(`Invalid initialThinkTicks[${idx}]: ${String(ticks)}. Must be an integer >= 1.`);
      }
    });
  }

  const starvationThresholdTicks = config.starvationThresholdTicks ?? 15;
  if (!Number.isInteger(starvationThresholdTicks) || starvationThresholdTicks < 1) {
    throw new Error(
      `Invalid starvationThresholdTicks: ${String(starvationThresholdTicks)}. Must be an integer >= 1.`
    );
  }

  const livelockWindowTicks = config.livelockWindowTicks ?? 12;
  if (!Number.isInteger(livelockWindowTicks) || livelockWindowTicks < 1) {
    throw new Error(`Invalid livelockWindowTicks: ${String(livelockWindowTicks)}. Must be an integer >= 1.`);
  }

  const casFixedBackoffTicks = config.casFixedBackoffTicks ?? 2;
  if (!Number.isInteger(casFixedBackoffTicks) || casFixedBackoffTicks < 1) {
    throw new Error(`Invalid casFixedBackoffTicks: ${String(casFixedBackoffTicks)}. Must be an integer >= 1.`);
  }

  const casMaxRandomBackoffTicks = config.casMaxRandomBackoffTicks ?? 5;
  if (!Number.isInteger(casMaxRandomBackoffTicks) || casMaxRandomBackoffTicks < 1) {
    throw new Error(
      `Invalid casMaxRandomBackoffTicks: ${String(casMaxRandomBackoffTicks)}. Must be an integer >= 1.`
    );
  }

  return {
    philosopherCount,
    seed: seed | 0,
    strategy: config.strategy ?? 'naive',
    thinkTicksRange: [thinkTicksRange[0], thinkTicksRange[1]],
    eatTicksRange: [eatTicksRange[0], eatTicksRange[1]],
    perPhilosopherThinkRanges: config.perPhilosopherThinkRanges,
    perPhilosopherEatRanges: config.perPhilosopherEatRanges,
    initialStates: config.initialStates,
    initialThinkTicks: config.initialThinkTicks,
    starvationThresholdTicks,
    livelockWindowTicks,
    casBackoffMode: config.casBackoffMode ?? 'random',
    casFixedBackoffTicks,
    casMaxRandomBackoffTicks,
  };
}

function validateTimingRange(label: string, range: readonly [number, number]): void {
  const [min, max] = range;
  if (!Number.isInteger(min) || !Number.isInteger(max) || min < 1 || max < min) {
    throw new Error(
      `Invalid timing range for ${label}: [${String(min)}, ${String(max)}]. Both bounds must be integers with 1 <= min <= max.`
    );
  }
}

/**
 * Default fallback strategy used when no external strategy is injected into SimulationEngine.
 * Grants both neighboring forks atomically when both are free; otherwise waits.
 */
export class AtomicBothForksDefaultStrategy implements Strategy {
  public readonly name = 'monitor' as const;
  public readonly description = 'Default atomic both-forks strategy for baseline engine verification.';

  public reset(): void {
    // Stateless baseline strategy
  }

  public decide(view: ReadonlySimulationView): StrategyStepResult {
    const actions: StrategyAction[] = [];
    const reservedForks = new Set<number>();

    for (const fork of view.forks) {
      if (fork.ownerId !== null) {
        reservedForks.add(fork.id);
      }
    }

    for (const phil of view.philosophers) {
      if (phil.state !== 'Hungry' && phil.state !== 'Waiting') {
        continue;
      }

      const holdsLeft = phil.heldForkIds.includes(phil.leftForkId);
      const holdsRight = phil.heldForkIds.includes(phil.rightForkId);
      const leftAvailable = holdsLeft || !reservedForks.has(phil.leftForkId);
      const rightAvailable = holdsRight || !reservedForks.has(phil.rightForkId);

      if (leftAvailable && rightAvailable) {
        if (!holdsLeft) {
          reservedForks.add(phil.leftForkId);
          actions.push({
            type: 'ACQUIRE_FORK',
            philosopherId: phil.id,
            forkId: phil.leftForkId,
            reason: `Philosopher ${phil.id} acquired left fork ${phil.leftForkId} because both neighboring forks are free.`,
          });
        }
        if (!holdsRight) {
          reservedForks.add(phil.rightForkId);
          actions.push({
            type: 'ACQUIRE_FORK',
            philosopherId: phil.id,
            forkId: phil.rightForkId,
            reason: `Philosopher ${phil.id} acquired right fork ${phil.rightForkId} because both neighboring forks are free.`,
          });
        }
        actions.push({
          type: 'START_EATING',
          philosopherId: phil.id,
          reason: `Philosopher ${phil.id} holds both forks (${phil.leftForkId} and ${phil.rightForkId}) and begins eating.`,
        });
      } else {
        const blockingFork = !leftAvailable ? phil.leftForkId : phil.rightForkId;
        actions.push({
          type: 'WAIT',
          philosopherId: phil.id,
          reason: `Philosopher ${phil.id} must wait because neighboring fork ${blockingFork} is currently in use.`,
        });
      }
    }

    return { actions };
  }
}

export function createStrategyByName(name: StrategyName): Strategy {
  switch (name) {
    case 'naive':
      return new NaiveStrategy();
    case 'semaphore':
      return new SemaphoreStrategy();
    case 'monitor':
      return new MonitorStrategy();
    case 'cas':
      return new SimulatedCasStrategy();
    default:
      return new AtomicBothForksDefaultStrategy();
  }
}

interface MutablePhilosopher {
  id: number;
  name: string;
  state: PhilosopherState;
  leftForkId: number;
  rightForkId: number;
  heldForkIds: number[];
  remainingStateTicks: number;
  waitStartTick: number | null;
  currentWaitTicks: number;
  totalWaitTicks: number;
  longestWaitTicks: number;
  mealsEaten: number;
  mealsCompleted: number;
}

interface MutableFork {
  id: number;
  ownerId: number | null;
}

/**
 * Deterministic Tick-Based Dining Philosophers Simulation Engine.
 *
 * Exact Tick Processing Order (`step()`):
 * 1. Increment simulation `tick` counter (`tick = tick + 1`).
 * 2. Phase 1 (Advance Eating Timers & Release Forks):
 *    For each philosopher `0..N-1` who started this tick in `'Eating'`:
 *    - Decrement `remainingStateTicks`.
 *    - If `remainingStateTicks === 0`:
 *      - Release both `leftForkId` and `rightForkId` (`FORK_RELEASED`).
 *      - Increment `mealsCompleted` (`MEAL_COMPLETED`).
 *      - Sample next think duration from seeded RNG and transition `Eating -> Thinking` (`STATE_CHANGE`).
 * 3. Phase 2 (Strategy Decision & Resource/State Actions):
 *    - Build a deeply frozen `ReadonlySimulationView` snapshot and invoke `strategy.decide(view, rng)`.
 *    - Record any strategy explanatory events.
 *    - Apply returned `StrategyAction`s (`ACQUIRE_FORK`, `RELEASE_FORK`, `START_EATING`, `WAIT`) for
 *      philosophers who started this tick in `'Hungry'` or `'Waiting'`, validating invariants on every action.
 *    - Any philosopher who started this tick in `'Hungry'` and did not transition to `'Eating'` transitions
 *      `Hungry -> Waiting` (`STATE_CHANGE`).
 * 4. Phase 3 (Update Waiting Metrics):
 *    - For each philosopher currently in `'Hungry'` or `'Waiting'`, increment `currentWaitTicks` and
 *      `totalWaitTicks`, and update `longestWaitTicks`.
 * 5. Phase 4 (Advance Thinking Timers):
 *    - For each philosopher `0..N-1` who started this tick in `'Thinking'`:
 *      - Decrement `remainingStateTicks`.
 *      - If `remainingStateTicks === 0`, transition `Thinking -> Hungry` with `waitStartTick = tick` and
 *        `currentWaitTicks = 0` (`STATE_CHANGE`).
 * 6. Phase 5 (Global Invariant Verification):
 *    - Assert one owner per fork, bidirectional fork-philosopher consistency, valid adjacent forks only,
 *      and that every `'Eating'` philosopher holds both neighboring forks while `'Thinking'`/`'Hungry'` hold none.
 * 7. Phase 6 (Deadlock Detection):
 *    - Evaluate `detectDeadlock`. When passive circular-wait deadlock is reached, emit a single
 *      `DEADLOCK_DETECTED` event describing the cycle and the four Coffman conditions.
 * 8. Phase 7 (Threshold-Based Starvation Detection) & Phase 8 (Suspected Livelock Detection).
 */
export class SimulationEngine {
  private config: ResolvedSimulationConfig;
  private strategy: Strategy;
  private hasCustomStrategy: boolean;
  private rng: SeededRng;
  private tick = 0;
  private nextEventId = 1;
  private philosophers: MutablePhilosopher[] = [];
  private forks: MutableFork[] = [];
  private events: SimulationEvent[] = [];
  private deadlocked = false;
  private deadlockReason: string | null = null;
  private hasEmittedDeadlockEvent = false;
  private starvationDetected = false;
  private starvedPhilosopherIds: number[] = [];
  private starvationReason: string | null = null;
  private starvationEpisodeActive = new Set<number>();
  private neighborMealsAtWaitStart: number[] = [];
  private livelockDetected = false;
  private livelockReason: string | null = null;
  private hasEmittedLivelockEvent = false;
  private lastMealCompletedTick = 0;

  constructor(config: SimulationConfig = {}, strategy?: Strategy) {
    this.config = resolveSimulationConfig(config);
    this.hasCustomStrategy = strategy !== undefined;
    this.strategy = strategy ?? createStrategyByName(this.config.strategy);
    this.rng = new SeededRng(this.config.seed);
    this.initializeState();
  }

  /**
   * Resets the simulation to tick 0 with the same (or newly provided) configuration and strategy.
   * Re-seeds the deterministic RNG so the exact same event log and state sequence are reproduced.
   */
  public reset(newConfig?: SimulationConfig, newStrategy?: Strategy): SimulationSnapshot {
    if (newConfig !== undefined) {
      this.config = resolveSimulationConfig(newConfig);
      if (newStrategy === undefined && !this.hasCustomStrategy) {
        this.strategy = createStrategyByName(this.config.strategy);
      }
    }
    if (newStrategy !== undefined) {
      this.strategy = newStrategy;
      this.hasCustomStrategy = true;
    }
    this.initializeState();
    return this.getSnapshot();
  }

  /**
   * Replaces the active strategy and resets the simulation to tick 0.
   */
  public setStrategy(strategy: Strategy): SimulationSnapshot {
    return this.reset(undefined, strategy);
  }

  /**
   * Advances the simulation by a single deterministic tick and returns the new immutable snapshot.
   */
  public step(): SimulationSnapshot {
    this.tick += 1;

    // Capture each philosopher's state at the start of the tick so newly transitioned
    // philosophers are not double-processed within the same tick.
    const stateAtTickStart: PhilosopherState[] = this.philosophers.map((p) => p.state);
    const completedEatersThisTick: number[] = [];

    // Phase 1: Advance Eating timers and release forks when a meal completes
    for (let i = 0; i < this.config.philosopherCount; i++) {
      if (stateAtTickStart[i] !== 'Eating') {
        continue;
      }
      const phil = this.getMutablePhilosopher(i);
      phil.remainingStateTicks -= 1;

      if (phil.remainingStateTicks <= 0) {
        this.releaseForkInternal(phil, phil.leftForkId, `Philosopher ${phil.id} finished eating and released left fork ${phil.leftForkId}.`);
        this.releaseForkInternal(phil, phil.rightForkId, `Philosopher ${phil.id} finished eating and released right fork ${phil.rightForkId}.`);

        phil.mealsCompleted += 1;
        this.lastMealCompletedTick = this.tick;
        this.hasEmittedLivelockEvent = false;
        this.emitEvent({
          type: 'MEAL_COMPLETED',
          philosopherId: phil.id,
          reason: `Philosopher ${phil.id} completed meal #${phil.mealsCompleted}.`,
        });

        const nextThinkTicks = this.sampleThinkTicks(phil.id);
        this.transitionPhilosopherState(
          phil,
          'Thinking',
          `Philosopher ${phil.id} is now thinking for ${nextThinkTicks} tick(s) after completing a meal.`
        );
        phil.remainingStateTicks = nextThinkTicks;
        completedEatersThisTick.push(phil.id);
      }
    }

    // Phase 2: Invoke strategy with deeply frozen read-only simulation view
    const view = this.createReadonlyView(completedEatersThisTick);
    const decisionResult = this.strategy.decide(view, this.rng);

    if (decisionResult.events) {
      for (const evt of decisionResult.events) {
        this.emitEvent({
          type: evt.type,
          philosopherId: evt.philosopherId,
          forkId: evt.forkId,
          reason: evt.reason,
          details: evt.details,
        });
      }
    }

    for (const action of decisionResult.actions) {
      this.applyStrategyAction(action, stateAtTickStart);
    }

    // Any philosopher who started this tick in Hungry and did not start Eating transitions to Waiting
    for (let i = 0; i < this.config.philosopherCount; i++) {
      if (stateAtTickStart[i] === 'Hungry') {
        const phil = this.getMutablePhilosopher(i);
        if (phil.state === 'Hungry') {
          this.transitionPhilosopherState(
            phil,
            'Waiting',
            `Philosopher ${phil.id} could not acquire both forks immediately and is now waiting.`
          );
        }
      }
    }

    // Phase 3: Update wait time metrics for all philosophers currently Hungry or Waiting
    for (let i = 0; i < this.config.philosopherCount; i++) {
      const phil = this.getMutablePhilosopher(i);
      if (phil.state === 'Hungry' || phil.state === 'Waiting') {
        if (phil.waitStartTick === null) {
          phil.waitStartTick = this.tick;
        }
        phil.currentWaitTicks += 1;
        phil.totalWaitTicks += 1;
        if (phil.currentWaitTicks > phil.longestWaitTicks) {
          phil.longestWaitTicks = phil.currentWaitTicks;
        }
      }
    }

    // Phase 4: Advance Thinking timers for philosophers who started this tick in Thinking
    for (let i = 0; i < this.config.philosopherCount; i++) {
      if (stateAtTickStart[i] !== 'Thinking') {
        continue;
      }
      const phil = this.getMutablePhilosopher(i);
      phil.remainingStateTicks -= 1;

      if (phil.remainingStateTicks <= 0) {
        phil.remainingStateTicks = 0;
        phil.waitStartTick = this.tick;
        phil.currentWaitTicks = 0;
        this.neighborMealsAtWaitStart[phil.id] = this.getNeighborMealsCompleted(phil.id);
        this.transitionPhilosopherState(
          phil,
          'Hungry',
          `Philosopher ${phil.id} finished thinking and is now hungry (needs forks ${phil.leftForkId} and ${phil.rightForkId}).`
        );
      }
    }

    // Phase 5: Global invariant check
    this.assertInvariants();

    const philosopherSnapshots = this.philosophers.map((p) => this.toPhilosopherSnapshot(p));

    // Phase 6: Deadlock detection
    const deadlockCheck = detectDeadlock({
      philosophers: philosopherSnapshots,
      forks: this.forks,
      strategy: this.strategy.name,
    });
    this.deadlocked = deadlockCheck.deadlocked;
    this.deadlockReason = deadlockCheck.reason;

    if (deadlockCheck.deadlocked && !this.hasEmittedDeadlockEvent) {
      this.hasEmittedDeadlockEvent = true;
      this.emitEvent({
        type: 'DEADLOCK_DETECTED',
        reason: deadlockCheck.reason!,
        details: deadlockCheck.coffmanConditions
          ? {
              cycle: deadlockCheck.cycle ?? '',
              mutualExclusion: deadlockCheck.coffmanConditions.mutualExclusion,
              holdAndWait: deadlockCheck.coffmanConditions.holdAndWait,
              noPreemption: deadlockCheck.coffmanConditions.noPreemption,
              circularWait: deadlockCheck.coffmanConditions.circularWait,
            }
          : undefined,
      });
    }

    // Phase 7: Threshold-based Starvation detection
    const neighborMealsDuringWait: Record<number, number> = {};
    for (const phil of this.philosophers) {
      const currentNeighborMeals = this.getNeighborMealsCompleted(phil.id);
      const baseline = this.neighborMealsAtWaitStart[phil.id] ?? 0;
      neighborMealsDuringWait[phil.id] = Math.max(0, currentNeighborMeals - baseline);
    }

    const starvationCheck = detectStarvation({
      philosophers: philosopherSnapshots,
      starvationThresholdTicks: this.config.starvationThresholdTicks,
      neighborMealsDuringWait,
    });

    this.starvationDetected = starvationCheck.starvationDetected;
    this.starvedPhilosopherIds = [...starvationCheck.starvedPhilosopherIds];
    this.starvationReason = starvationCheck.reason;

    for (const victim of starvationCheck.victims) {
      if (!this.starvationEpisodeActive.has(victim.philosopherId)) {
        this.starvationEpisodeActive.add(victim.philosopherId);
        this.emitEvent({
          type: 'STARVATION_DETECTED',
          philosopherId: victim.philosopherId,
          reason: victim.reason,
          details: {
            label: 'starvation detected by threshold',
            currentWaitTicks: victim.currentWaitTicks,
            threshold: this.config.starvationThresholdTicks,
            neighborMealsDuringWait: victim.neighborMealsDuringWait,
            leftNeighborId: victim.leftNeighborId,
            rightNeighborId: victim.rightNeighborId,
          },
        });
      }
    }

    // Phase 8: Suspected Livelock detection
    const livelockCheck = detectLivelock({
      tick: this.tick,
      livelockWindowTicks: this.config.livelockWindowTicks,
      strategy: this.strategy.name,
      philosophers: philosopherSnapshots,
      events: this.events,
      lastMealCompletedTick: this.lastMealCompletedTick,
    });

    this.livelockDetected = livelockCheck.livelockDetected;
    this.livelockReason = livelockCheck.reason;

    if (livelockCheck.livelockDetected && !this.hasEmittedLivelockEvent) {
      this.hasEmittedLivelockEvent = true;
      this.emitEvent({
        type: 'LIVELOCK_DETECTED',
        reason: livelockCheck.reason!,
        details: {
          windowTicks: this.config.livelockWindowTicks,
          attemptsInWindow: livelockCheck.attemptsInWindow,
          rollbacksInWindow: livelockCheck.rollbacksInWindow,
        },
      });
    }

    return this.getSnapshot();
  }

  /**
   * Runs the simulation forward by `count` ticks and returns the resulting snapshot.
   */
  public runTicks(count: number): SimulationSnapshot {
    if (!Number.isInteger(count) || count < 0) {
      throw new Error(`Invalid tick count: ${String(count)}. Must be a non-negative integer.`);
    }
    for (let i = 0; i < count; i++) {
      this.step();
    }
    return this.getSnapshot();
  }

  /**
   * Returns an immutable snapshot of the current simulation state.
   */
  public getSnapshot(): SimulationSnapshot {
    const philosophers: PhilosopherSnapshot[] = this.philosophers.map((p) =>
      this.toPhilosopherSnapshot(p)
    );

    const forks: ForkSnapshot[] = this.forks.map((f) =>
      Object.freeze({
        id: f.id,
        ownerId: f.ownerId,
      })
    );

    const totalMealsEaten = philosophers.reduce((sum, p) => sum + p.mealsEaten, 0);
    const totalMealsCompleted = philosophers.reduce((sum, p) => sum + p.mealsCompleted, 0);

    const detectors: DetectorStatus = Object.freeze({
      deadlocked: this.deadlocked,
      deadlockReason: this.deadlockReason,
      starvationDetected: this.starvationDetected,
      starvedPhilosopherIds: Object.freeze([...this.starvedPhilosopherIds]),
      starvationReason: this.starvationReason,
      livelockDetected: this.livelockDetected,
      livelockReason: this.livelockReason,
    });

    const strategyState = this.strategy.getInternalState
      ? Object.freeze({ ...this.strategy.getInternalState() })
      : undefined;

    return Object.freeze({
      tick: this.tick,
      config: Object.freeze({ ...this.config }),
      philosophers: Object.freeze(philosophers),
      forks: Object.freeze(forks),
      totalMealsEaten,
      totalMealsCompleted,
      detectors,
      strategyState,
    });
  }

  /**
   * Returns a read-only copy of the append-only event log.
   */
  public getEventLog(): readonly SimulationEvent[] {
    return Object.freeze(this.events.map((e) => Object.freeze({ ...e })));
  }

  private initializeState(): void {
    this.tick = 0;
    this.nextEventId = 1;
    this.events = [];
    this.deadlocked = false;
    this.deadlockReason = null;
    this.hasEmittedDeadlockEvent = false;
    this.starvationDetected = false;
    this.starvedPhilosopherIds = [];
    this.starvationReason = null;
    this.starvationEpisodeActive.clear();
    this.livelockDetected = false;
    this.livelockReason = null;
    this.hasEmittedLivelockEvent = false;
    this.lastMealCompletedTick = 0;
    this.rng.reset(this.config.seed);

    const count = this.config.philosopherCount;
    this.neighborMealsAtWaitStart = Array.from({ length: count }, () => 0);
    this.forks = Array.from({ length: count }, (_, id) => ({
      id,
      ownerId: null,
    }));

    this.philosophers = Array.from({ length: count }, (_, id) => {
      const initialState = this.config.initialStates?.[id] ?? 'Thinking';
      if (initialState === 'Eating') {
        this.failInvariant(`Philosopher ${id} cannot start in 'Eating' state at tick 0 without holding forks.`);
      }

      const initialThink =
        initialState === 'Thinking'
          ? (this.config.initialThinkTicks?.[id] ?? this.sampleThinkTicks(id))
          : 0;

      return {
        id,
        name: `Philosopher ${id}`,
        state: initialState,
        leftForkId: getLeftForkId(id, count),
        rightForkId: getRightForkId(id, count),
        heldForkIds: [],
        remainingStateTicks: initialThink,
        waitStartTick: initialState === 'Hungry' || initialState === 'Waiting' ? 0 : null,
        currentWaitTicks: 0,
        totalWaitTicks: 0,
        longestWaitTicks: 0,
        mealsEaten: 0,
        mealsCompleted: 0,
      };
    });

    this.strategy.reset(this.config);

    this.emitEvent({
      type: 'SIMULATION_INIT',
      reason: `Simulation initialized with ${count} philosophers, seed ${this.config.seed}, and strategy '${this.strategy.name}'.`,
    });

    this.assertInvariants();
  }

  private createReadonlyView(completedEatersThisTick: readonly number[]): ReadonlySimulationView {
    const philosophers: PhilosopherSnapshot[] = this.philosophers.map((p) =>
      this.toPhilosopherSnapshot(p)
    );

    const forks: ForkSnapshot[] = this.forks.map((f) =>
      Object.freeze({
        id: f.id,
        ownerId: f.ownerId,
      })
    );

    return Object.freeze({
      tick: this.tick,
      config: Object.freeze({ ...this.config }),
      philosophers: Object.freeze(philosophers),
      forks: Object.freeze(forks),
      completedEatersThisTick: Object.freeze([...completedEatersThisTick]),
    });
  }

  private toPhilosopherSnapshot(p: MutablePhilosopher): PhilosopherSnapshot {
    const mealCountForAverage = p.mealsCompleted > 0 ? p.mealsCompleted : p.mealsEaten;
    const averageWaitPerMeal =
      mealCountForAverage > 0
        ? Number((p.totalWaitTicks / mealCountForAverage).toFixed(2))
        : 0;

    return Object.freeze({
      id: p.id,
      name: p.name,
      state: p.state,
      leftForkId: p.leftForkId,
      rightForkId: p.rightForkId,
      heldForkIds: Object.freeze([...p.heldForkIds]),
      remainingStateTicks: p.remainingStateTicks,
      waitStartTick: p.waitStartTick,
      currentWaitTicks: p.currentWaitTicks,
      totalWaitTicks: p.totalWaitTicks,
      longestWaitTicks: p.longestWaitTicks,
      mealsEaten: p.mealsEaten,
      mealsCompleted: p.mealsCompleted,
      averageWaitPerMeal,
    });
  }

  private getNeighborMealsCompleted(philosopherId: number): number {
    const count = this.config.philosopherCount;
    const leftId = (philosopherId + count - 1) % count;
    const rightId = (philosopherId + 1) % count;
    const leftMeals = this.philosophers[leftId]?.mealsCompleted ?? 0;
    const rightMeals = this.philosophers[rightId]?.mealsCompleted ?? 0;
    return leftMeals + rightMeals;
  }

  private applyStrategyAction(action: StrategyAction, stateAtTickStart: readonly PhilosopherState[]): void {
    const phil = this.philosophers[action.philosopherId];
    if (!phil) {
      this.failInvariant(`Strategy referenced non-existent philosopher ID ${String(action.philosopherId)}.`);
    }

    const startState = stateAtTickStart[phil.id];
    if (startState !== 'Hungry' && startState !== 'Waiting') {
      this.failInvariant(
        `Strategy attempted action '${action.type}' on Philosopher ${phil.id} who started tick ${this.tick} in '${String(startState)}' state (only Hungry or Waiting philosophers can act).`
      );
    }

    switch (action.type) {
      case 'ACQUIRE_FORK': {
        if (phil.state !== 'Hungry' && phil.state !== 'Waiting') {
          this.failInvariant(
            `Cannot acquire fork for Philosopher ${phil.id} in state '${phil.state}'.`
          );
        }
        const fork = this.forks[action.forkId];
        if (!fork) {
          this.failInvariant(`Strategy referenced non-existent fork ID ${String(action.forkId)}.`);
        }
        if (fork.id !== phil.leftForkId && fork.id !== phil.rightForkId) {
          this.failInvariant(
            `Philosopher ${phil.id} attempted to acquire non-neighboring fork ${fork.id} (allowed: ${phil.leftForkId}, ${phil.rightForkId}).`
          );
        }
        if (fork.ownerId !== null) {
          this.failInvariant(
            `Philosopher ${phil.id} attempted to acquire fork ${fork.id}, which is already held by Philosopher ${fork.ownerId}.`
          );
        }
        if (phil.heldForkIds.includes(fork.id)) {
          this.failInvariant(`Philosopher ${phil.id} already holds fork ${fork.id}.`);
        }

        fork.ownerId = phil.id;
        phil.heldForkIds.push(fork.id);

        this.emitEvent({
          type: 'FORK_ACQUIRED',
          philosopherId: phil.id,
          forkId: fork.id,
          reason: action.reason,
        });
        break;
      }

      case 'RELEASE_FORK': {
        if (phil.state !== 'Hungry' && phil.state !== 'Waiting') {
          this.failInvariant(
            `Cannot release fork via strategy action for Philosopher ${phil.id} in state '${phil.state}'.`
          );
        }
        const fork = this.forks[action.forkId];
        if (!fork) {
          this.failInvariant(`Strategy referenced non-existent fork ID ${String(action.forkId)}.`);
        }
        if (fork.ownerId !== phil.id || !phil.heldForkIds.includes(fork.id)) {
          this.failInvariant(
            `Philosopher ${phil.id} attempted to release fork ${fork.id}, which they do not own (owner: ${String(fork.ownerId)}).`
          );
        }

        this.releaseForkInternal(phil, fork.id, action.reason);
        break;
      }

      case 'START_EATING': {
        if (phil.state !== 'Hungry' && phil.state !== 'Waiting') {
          this.failInvariant(
            `Philosopher ${phil.id} cannot transition to Eating from state '${phil.state}'.`
          );
        }
        const holdsLeft = phil.heldForkIds.includes(phil.leftForkId);
        const holdsRight = phil.heldForkIds.includes(phil.rightForkId);
        const leftFork = this.forks[phil.leftForkId];
        const rightFork = this.forks[phil.rightForkId];

        if (
          !holdsLeft ||
          !holdsRight ||
          leftFork?.ownerId !== phil.id ||
          rightFork?.ownerId !== phil.id
        ) {
          this.failInvariant(
            `Philosopher ${phil.id} attempted to START_EATING without holding both neighboring forks (${phil.leftForkId} and ${phil.rightForkId}). Currently holds: [${phil.heldForkIds.join(', ')}].`
          );
        }

        const waitedTicks = phil.currentWaitTicks;
        const wasStarved = this.starvationEpisodeActive.has(phil.id);
        const eatTicks = this.sampleEatTicks(phil.id);
        this.transitionPhilosopherState(phil, 'Eating', action.reason);
        phil.remainingStateTicks = eatTicks;
        phil.waitStartTick = null;
        phil.currentWaitTicks = 0;
        phil.mealsEaten += 1;

        if (wasStarved) {
          this.starvationEpisodeActive.delete(phil.id);
          this.emitEvent({
            type: 'STARVATION_ENDED',
            philosopherId: phil.id,
            reason: `starvation detected by threshold ended: Philosopher ${phil.id} acquired both forks and started eating after waiting ${waitedTicks} ticks.`,
            details: {
              waitedTicks,
              threshold: this.config.starvationThresholdTicks,
            },
          });
        }

        this.emitEvent({
          type: 'MEAL_STARTED',
          philosopherId: phil.id,
          reason: `Philosopher ${phil.id} started meal #${phil.mealsEaten} for ${eatTicks} tick(s) holding forks ${phil.leftForkId} and ${phil.rightForkId}.`,
        });
        break;
      }

      case 'WAIT': {
        if (phil.state === 'Hungry') {
          this.transitionPhilosopherState(phil, 'Waiting', action.reason);
        } else if (phil.state === 'Waiting') {
          // Already waiting; no state transition required
        } else {
          this.failInvariant(
            `Philosopher ${phil.id} cannot WAIT while in state '${phil.state}'.`
          );
        }
        break;
      }
    }
  }

  private transitionPhilosopherState(
    phil: MutablePhilosopher,
    nextState: PhilosopherState,
    reason: string
  ): void {
    const prevState = phil.state;
    if (!isLegalStateTransition(prevState, nextState)) {
      this.failInvariant(
        `Illegal state transition for Philosopher ${phil.id}: '${prevState}' -> '${nextState}'.`
      );
    }
    phil.state = nextState;
    this.emitEvent({
      type: 'STATE_CHANGE',
      philosopherId: phil.id,
      fromState: prevState,
      toState: nextState,
      reason,
    });
  }

  private releaseForkInternal(phil: MutablePhilosopher, forkId: number, reason: string): void {
    const fork = this.forks[forkId];
    if (!fork || fork.ownerId !== phil.id) {
      this.failInvariant(
        `Internal fork release mismatch: Philosopher ${phil.id} does not own fork ${String(forkId)}.`
      );
    }
    fork.ownerId = null;
    phil.heldForkIds = phil.heldForkIds.filter((id) => id !== forkId);

    this.emitEvent({
      type: 'FORK_RELEASED',
      philosopherId: phil.id,
      forkId,
      reason,
    });
  }

  private sampleThinkTicks(philosopherId: number): number {
    const range =
      this.config.perPhilosopherThinkRanges?.[philosopherId] ?? this.config.thinkTicksRange;
    return this.rng.nextInt(range[0], range[1]);
  }

  private sampleEatTicks(philosopherId: number): number {
    const range =
      this.config.perPhilosopherEatRanges?.[philosopherId] ?? this.config.eatTicksRange;
    return this.rng.nextInt(range[0], range[1]);
  }

  /**
   * Enforces all resource and state safety invariants.
   * Throws InvariantError and logs an INVARIANT_VIOLATION event if any check fails.
   */
  public assertInvariants(): void {
    const count = this.config.philosopherCount;
    const seenOwnedForks = new Map<number, number>();

    for (const phil of this.philosophers) {
      // Check valid held forks
      for (const forkId of phil.heldForkIds) {
        if (forkId !== phil.leftForkId && forkId !== phil.rightForkId) {
          this.failInvariant(
            `Invariant violation: Philosopher ${phil.id} holds non-adjacent fork ${forkId}.`
          );
        }
        if (seenOwnedForks.has(forkId)) {
          this.failInvariant(
            `Invariant violation: Fork ${forkId} is claimed by both Philosopher ${seenOwnedForks.get(forkId)} and Philosopher ${phil.id}.`
          );
        }
        seenOwnedForks.set(forkId, phil.id);

        const fork = this.forks[forkId];
        if (!fork || fork.ownerId !== phil.id) {
          this.failInvariant(
            `Invariant violation: Philosopher ${phil.id} lists fork ${forkId} as held, but fork.ownerId is ${String(fork?.ownerId)}.`
          );
        }
      }

      // State-specific fork ownership invariants
      if (phil.state === 'Eating') {
        const holdsBoth =
          phil.heldForkIds.length === 2 &&
          phil.heldForkIds.includes(phil.leftForkId) &&
          phil.heldForkIds.includes(phil.rightForkId);
        if (!holdsBoth) {
          this.failInvariant(
            `Invariant violation: Philosopher ${phil.id} is Eating without holding both forks (${phil.leftForkId}, ${phil.rightForkId}).`
          );
        }
        if (phil.waitStartTick !== null || phil.currentWaitTicks !== 0) {
          this.failInvariant(
            `Invariant violation: Philosopher ${phil.id} is Eating but wait metrics were not cleared.`
          );
        }
      } else if (phil.state === 'Thinking' || phil.state === 'Hungry') {
        if (phil.heldForkIds.length > 0) {
          this.failInvariant(
            `Invariant violation: Philosopher ${phil.id} is ${phil.state} while holding fork(s) [${phil.heldForkIds.join(', ')}].`
          );
        }
      }

      // Check adjacent philosophers are not both Eating
      if (phil.state === 'Eating') {
        const rightNeighborId = (phil.id + 1) % count;
        const rightNeighbor = this.philosophers[rightNeighborId];
        if (rightNeighbor && rightNeighbor.state === 'Eating') {
          this.failInvariant(
            `Invariant violation: Adjacent philosophers ${phil.id} and ${rightNeighbor.id} are Eating simultaneously.`
          );
        }
      }
    }

    // Verify every fork with non-null ownerId is in that philosopher's heldForkIds
    for (const fork of this.forks) {
      if (fork.ownerId !== null) {
        const owner = this.philosophers[fork.ownerId];
        if (!owner || !owner.heldForkIds.includes(fork.id)) {
          this.failInvariant(
            `Invariant violation: Fork ${fork.id} has ownerId=${fork.ownerId}, but Philosopher ${fork.ownerId} does not list it in heldForkIds.`
          );
        }
      }
    }
  }

  private getMutablePhilosopher(id: number): MutablePhilosopher {
    const phil = this.philosophers[id];
    if (!phil) {
      this.failInvariant(`Internal error: Philosopher ${id} not found.`);
    }
    return phil;
  }

  private failInvariant(reason: string): never {
    this.emitEvent({
      type: 'INVARIANT_VIOLATION',
      reason,
    });
    throw new InvariantError(reason);
  }

  private emitEvent(params: {
    type: SimulationEventType;
    philosopherId?: number;
    forkId?: number;
    fromState?: PhilosopherState;
    toState?: PhilosopherState;
    reason: string;
    details?: Readonly<Record<string, string | number | boolean | null>>;
  }): void {
    const prefixParts = [`[Tick ${this.tick}]`, `[${params.type}]`];
    if (params.philosopherId !== undefined) {
      prefixParts.push(`P${params.philosopherId}`);
    }
    if (params.forkId !== undefined) {
      prefixParts.push(`F${params.forkId}`);
    }

    const event: SimulationEvent = Object.freeze({
      id: this.nextEventId++,
      tick: this.tick,
      type: params.type,
      philosopherId: params.philosopherId,
      forkId: params.forkId,
      fromState: params.fromState,
      toState: params.toState,
      reason: params.reason,
      message: `${prefixParts.join(' ')}: ${params.reason}`,
      details: params.details ? Object.freeze({ ...params.details }) : undefined,
    });

    this.events.push(event);
  }
}
