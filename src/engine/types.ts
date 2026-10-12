/**
 * Core domain types and strategy contract for the deterministic Dining Philosophers engine.
 * Pure TypeScript module: no React, DOM, timer, Math.random, or Date.now dependencies.
 */

export type PhilosopherState = 'Thinking' | 'Hungry' | 'Waiting' | 'Eating';

export type StrategyName = 'naive' | 'semaphore' | 'monitor' | 'cas';

export type CasBackoffMode = 'fixed' | 'random';

export interface ForkSnapshot {
  readonly id: number;
  /** Philosopher ID currently holding this fork, or null if available on the table. */
  readonly ownerId: number | null;
}

export interface PhilosopherSnapshot {
  readonly id: number;
  readonly name: string;
  readonly state: PhilosopherState;
  /** Fork i lies between philosopher i and (i + 1) mod N. Left fork is i. */
  readonly leftForkId: number;
  /** Right fork is (i + 1) mod N. */
  readonly rightForkId: number;
  /** Fork IDs currently held by this philosopher (subset of [leftForkId, rightForkId]). */
  readonly heldForkIds: readonly number[];
  /** Remaining ticks in current Thinking or Eating state (0 when Hungry or Waiting). */
  readonly remainingStateTicks: number;
  /** Tick when the philosopher most recently became Hungry, or null if Thinking/Eating. */
  readonly waitStartTick: number | null;
  /** Ticks spent waiting in the current Hungry/Waiting cycle. */
  readonly currentWaitTicks: number;
  /** Cumulative ticks spent waiting across the entire simulation run. */
  readonly totalWaitTicks: number;
  /** Maximum consecutive ticks spent waiting in a single cycle so far. */
  readonly longestWaitTicks: number;
  /** Number of times this philosopher has acquired both forks and started eating. */
  readonly mealsEaten: number;
  /** Number of meals fully completed (transitioned from Eating back to Thinking). */
  readonly mealsCompleted: number;
  /** Average wait ticks per meal (0 if no meals eaten yet). */
  readonly averageWaitPerMeal: number;
}

export type SimulationEventType =
  | 'SIMULATION_INIT'
  | 'SIMULATION_RESET'
  | 'STATE_CHANGE'
  | 'FORK_ACQUIRED'
  | 'FORK_RELEASED'
  | 'FORK_DENIED'
  | 'STRATEGY_DECISION'
  | 'CAS_ATTEMPT'
  | 'CAS_ROLLBACK'
  | 'CAS_BACKOFF'
  | 'SEMAPHORE_ACQUIRED'
  | 'SEMAPHORE_RELEASED'
  | 'SEMAPHORE_QUEUED'
  | 'MONITOR_TEST'
  | 'MONITOR_WAIT'
  | 'MONITOR_SIGNAL'
  | 'MEAL_STARTED'
  | 'MEAL_COMPLETED'
  | 'DEADLOCK_DETECTED'
  | 'STARVATION_DETECTED'
  | 'STARVATION_ENDED'
  | 'LIVELOCK_DETECTED'
  | 'INVARIANT_VIOLATION';

export interface SimulationEvent {
  readonly id: number;
  readonly tick: number;
  readonly type: SimulationEventType;
  readonly philosopherId?: number;
  readonly forkId?: number;
  readonly fromState?: PhilosopherState;
  readonly toState?: PhilosopherState;
  /** Concise human-readable reason explaining the state or resource change. */
  readonly reason: string;
  /** Formatted summary message suitable for direct event log display. */
  readonly message: string;
  readonly details?: Readonly<Record<string, string | number | boolean | null>>;
}

export interface SimulationConfig {
  /** Number of philosophers and forks (defaults to 5). */
  readonly philosopherCount?: number;
  /** Deterministic RNG seed (defaults to 42). */
  readonly seed?: number;
  /** Active synchronization strategy identifier. */
  readonly strategy?: StrategyName;
  /** Inclusive [min, max] ticks spent in Thinking state. */
  readonly thinkTicksRange?: readonly [number, number];
  /** Inclusive [min, max] ticks spent in Eating state. */
  readonly eatTicksRange?: readonly [number, number];
  /** Optional per-philosopher think tick ranges (for asymmetric/starvation scenarios). */
  readonly perPhilosopherThinkRanges?: ReadonlyArray<readonly [number, number]>;
  /** Optional per-philosopher eat tick ranges (for asymmetric/starvation scenarios). */
  readonly perPhilosopherEatRanges?: ReadonlyArray<readonly [number, number]>;
  /** Optional initial state per philosopher at tick 0. */
  readonly initialStates?: readonly PhilosopherState[];
  /** Optional initial remaining think ticks per philosopher at tick 0. */
  readonly initialThinkTicks?: readonly number[];
  /** Wait tick threshold to flag "starvation detected by threshold". */
  readonly starvationThresholdTicks?: number;
  /** Window of consecutive ticks with active CAS retries and no completed meals to flag livelock. */
  readonly livelockWindowTicks?: number;
  /** CAS backoff policy ('fixed' for livelock demo, 'random' for progress). */
  readonly casBackoffMode?: CasBackoffMode;
  /** Fixed backoff ticks when casBackoffMode === 'fixed'. */
  readonly casFixedBackoffTicks?: number;
  /** Maximum random backoff ticks when casBackoffMode === 'random'. */
  readonly casMaxRandomBackoffTicks?: number;
}

export interface ResolvedSimulationConfig {
  readonly philosopherCount: number;
  readonly seed: number;
  readonly strategy: StrategyName;
  readonly thinkTicksRange: readonly [number, number];
  readonly eatTicksRange: readonly [number, number];
  readonly perPhilosopherThinkRanges?: ReadonlyArray<readonly [number, number]>;
  readonly perPhilosopherEatRanges?: ReadonlyArray<readonly [number, number]>;
  readonly initialStates?: readonly PhilosopherState[];
  readonly initialThinkTicks?: readonly number[];
  readonly starvationThresholdTicks: number;
  readonly livelockWindowTicks: number;
  readonly casBackoffMode: CasBackoffMode;
  readonly casFixedBackoffTicks: number;
  readonly casMaxRandomBackoffTicks: number;
}

export interface ScenarioPreset {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly config: SimulationConfig;
}

export interface DetectorStatus {
  readonly deadlocked: boolean;
  readonly deadlockReason: string | null;
  readonly starvationDetected: boolean;
  readonly starvedPhilosopherIds: readonly number[];
  readonly starvationReason: string | null;
  readonly livelockDetected: boolean;
  readonly livelockReason: string | null;
}

export interface SimulationSnapshot {
  readonly tick: number;
  readonly config: ResolvedSimulationConfig;
  readonly philosophers: readonly PhilosopherSnapshot[];
  readonly forks: readonly ForkSnapshot[];
  readonly totalMealsEaten: number;
  readonly totalMealsCompleted: number;
  readonly detectors: DetectorStatus;
  readonly strategyState?: Readonly<Record<string, unknown>>;
}

/**
 * Read-only view passed to strategies during step evaluation.
 * Frozen at runtime so strategies cannot mutate engine state directly.
 */
export interface ReadonlySimulationView {
  readonly tick: number;
  readonly config: ResolvedSimulationConfig;
  readonly philosophers: readonly PhilosopherSnapshot[];
  readonly forks: readonly ForkSnapshot[];
  /** IDs of philosophers who finished eating and released their forks at the start of this tick. */
  readonly completedEatersThisTick: readonly number[];
}

export type StrategyAction =
  | {
      readonly type: 'ACQUIRE_FORK';
      readonly philosopherId: number;
      readonly forkId: number;
      readonly reason: string;
    }
  | {
      readonly type: 'RELEASE_FORK';
      readonly philosopherId: number;
      readonly forkId: number;
      readonly reason: string;
    }
  | {
      readonly type: 'START_EATING';
      readonly philosopherId: number;
      readonly reason: string;
    }
  | {
      readonly type: 'WAIT';
      readonly philosopherId: number;
      readonly reason: string;
    };

export interface StrategyEventDescriptor {
  readonly type: SimulationEventType;
  readonly philosopherId?: number;
  readonly forkId?: number;
  readonly reason: string;
  readonly details?: Readonly<Record<string, string | number | boolean | null>>;
}

export interface StrategyStepResult {
  readonly actions: readonly StrategyAction[];
  readonly events?: readonly StrategyEventDescriptor[];
}

/**
 * Minimal deterministic RNG interface exposed to strategies and the engine.
 */
export interface DeterministicRng {
  /** Returns a deterministic float in [0, 1). */
  nextFloat(): number;
  /** Returns a deterministic integer in [min, max] inclusive. */
  nextInt(min: number, max: number): number;
  /** Resets the RNG to its initial seed. */
  reset(seed?: number): void;
  /** Returns current internal state for debugging/testing. */
  getState(): number;
}

/**
 * Strategy contract.
 * Strategies inspect a read-only view of the simulation and return resource grant/deny
 * actions plus optional explanatory events. They must never mutate the engine directly.
 */
export interface Strategy {
  readonly name: StrategyName;
  readonly description: string;
  /** Called on engine init and reset() to clear any internal strategy queues/permits/backoff state. */
  reset(config?: ResolvedSimulationConfig): void;
  /** Computes resource and state actions for the current tick without mutating the view. */
  decide(view: ReadonlySimulationView, rng: DeterministicRng): StrategyStepResult;
  /** Optional read-only snapshot of internal strategy data for UI visualization and tests. */
  getInternalState?(): Readonly<Record<string, unknown>>;
}

/**
 * Helper: Fork i lies between philosopher i and philosopher (i + 1) mod N.
 * Philosopher i's left fork is i, and right fork is (i + 1) mod N.
 */
export function getLeftForkId(philosopherId: number, philosopherCount = 5): number {
  return ((philosopherId % philosopherCount) + philosopherCount) % philosopherCount;
}

export function getRightForkId(philosopherId: number, philosopherCount = 5): number {
  return (getLeftForkId(philosopherId, philosopherCount) + 1) % philosopherCount;
}
