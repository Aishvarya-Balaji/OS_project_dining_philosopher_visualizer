import { SimulationEngine } from '../engine/simulation';
import { CasDebugState } from '../engine/strategies/cas';
import {
  CasBackoffMode,
  ScenarioPreset,
  SimulationConfig,
  StrategyName,
} from '../engine/types';
import { NORMAL_PRESET } from '../scenarios/presets';

export interface StrategyRunSpec {
  readonly strategy: StrategyName;
  readonly label?: string;
  readonly casBackoffMode?: CasBackoffMode;
}

export interface BatchRunOptions {
  readonly scenario?: ScenarioPreset | SimulationConfig;
  readonly scenarioId?: string;
  readonly seed?: number;
  readonly ticks?: number;
  readonly strategies?: readonly (StrategyName | StrategyRunSpec)[];
}

export interface StrategyComparisonRow {
  readonly strategy: StrategyName;
  readonly strategyLabel: string;
  readonly casBackoffMode?: CasBackoffMode;
  readonly scenarioId: string;
  readonly seed: number;
  readonly ticksRun: number;
  readonly deadlocked: boolean;
  readonly deadlockTick: number | null;
  readonly starvationDetected: boolean;
  readonly starvationStatusLabel: string;
  readonly starvedPhilosopherIds: readonly number[];
  readonly starvationEpisodeCount: number;
  readonly livelockSuspected: boolean;
  readonly livelockTick: number | null;
  readonly averageWaitTicks: number;
  readonly maxWaitTicks: number;
  readonly totalMealsCompleted: number;
  readonly totalMealsStarted: number;
  readonly minMealsPerPhilosopher: number;
  readonly maxMealsPerPhilosopher: number;
  readonly mealsPerPhilosopher: readonly number[];
  readonly fairnessScore: number;
  readonly casAttempts: number | null;
  readonly casFailures: number | null;
  readonly casRollbacks: number | null;
}

export const DEFAULT_COMPARISON_STRATEGIES: readonly StrategyName[] = Object.freeze([
  'naive',
  'semaphore',
  'monitor',
  'cas',
]);

/**
 * Computes Jain's Fairness Index: (sum(x_i))^2 / (N * sum(x_i^2)) in [0, 1].
 * Returns 0 when all philosophers have 0 completed meals.
 */
export function computeJainFairnessIndex(mealsByPhilosopher: readonly number[]): number {
  const n = mealsByPhilosopher.length;
  if (n === 0) {
    return 0;
  }
  const sum = mealsByPhilosopher.reduce((acc, val) => acc + val, 0);
  if (sum === 0) {
    return 0;
  }
  const sumSquares = mealsByPhilosopher.reduce((acc, val) => acc + val * val, 0);
  const index = (sum * sum) / (n * sumSquares);
  return Number(index.toFixed(3));
}

export function getDefaultStrategyLabel(
  strategy: StrategyName,
  casBackoffMode?: CasBackoffMode
): string {
  switch (strategy) {
    case 'naive':
      return 'Naive (Left -> Right)';
    case 'semaphore':
      return 'Semaphore (N-1 Permits, FIFO)';
    case 'monitor':
      return 'Monitor (test(i) + Condition)';
    case 'cas':
      return casBackoffMode
        ? `Lock-free (simulated CAS - ${casBackoffMode} back-off)`
        : 'Lock-free (simulated CAS)';
  }
}

/**
 * Runs a single strategy headlessly on the given configuration and returns a structured comparison row.
 */
export function runSingleStrategyComparison(
  baseConfig: SimulationConfig,
  spec: StrategyRunSpec,
  ticks: number,
  scenarioId = 'custom'
): StrategyComparisonRow {
  const effectiveCasMode = spec.casBackoffMode ?? baseConfig.casBackoffMode ?? 'random';
  const runConfig: SimulationConfig = {
    ...baseConfig,
    strategy: spec.strategy,
    casBackoffMode: effectiveCasMode,
  };

  const engine = new SimulationEngine(runConfig);
  const finalSnapshot = engine.runTicks(ticks);
  const events = engine.getEventLog();

  const deadlockEvt = events.find((e) => e.type === 'DEADLOCK_DETECTED');
  const starvationEvts = events.filter((e) => e.type === 'STARVATION_DETECTED');
  const livelockEvt = events.find((e) => e.type === 'LIVELOCK_DETECTED');

  const starvedSet = new Set<number>(finalSnapshot.detectors.starvedPhilosopherIds);
  for (const evt of starvationEvts) {
    if (evt.philosopherId !== undefined) {
      starvedSet.add(evt.philosopherId);
    }
  }
  const starvedPhilosopherIds = Array.from(starvedSet).sort((a, b) => a - b);
  const starvationDetected =
    finalSnapshot.detectors.starvationDetected || starvationEvts.length > 0;

  const livelockSuspected =
    finalSnapshot.detectors.livelockDetected || livelockEvt !== undefined;

  const mealsPerPhilosopher = finalSnapshot.philosophers.map((p) => p.mealsCompleted);
  const minMealsPerPhilosopher =
    mealsPerPhilosopher.length > 0 ? Math.min(...mealsPerPhilosopher) : 0;
  const maxMealsPerPhilosopher =
    mealsPerPhilosopher.length > 0 ? Math.max(...mealsPerPhilosopher) : 0;

  const totalWaitAcrossAll = finalSnapshot.philosophers.reduce(
    (sum, p) => sum + p.totalWaitTicks,
    0
  );
  const mealDenominator =
    finalSnapshot.totalMealsCompleted > 0
      ? finalSnapshot.totalMealsCompleted
      : finalSnapshot.totalMealsEaten > 0
        ? finalSnapshot.totalMealsEaten
        : finalSnapshot.philosophers.length;

  const averageWaitTicks =
    mealDenominator > 0 ? Number((totalWaitAcrossAll / mealDenominator).toFixed(2)) : 0;

  const maxWaitTicks =
    finalSnapshot.philosophers.length > 0
      ? Math.max(...finalSnapshot.philosophers.map((p) => p.longestWaitTicks))
      : 0;

  const fairnessScore = computeJainFairnessIndex(mealsPerPhilosopher);

  let casAttempts: number | null = null;
  let casFailures: number | null = null;
  let casRollbacks: number | null = null;

  if (spec.strategy === 'cas' && finalSnapshot.strategyState) {
    const casState = finalSnapshot.strategyState as CasDebugState;
    casAttempts = casState.totalAttempts;
    casFailures = casState.totalFailures;
    casRollbacks = casState.totalRollbacks;
  }

  return Object.freeze({
    strategy: spec.strategy,
    strategyLabel:
      spec.label ??
      getDefaultStrategyLabel(
        spec.strategy,
        spec.strategy === 'cas' ? effectiveCasMode : undefined
      ),
    casBackoffMode: spec.strategy === 'cas' ? effectiveCasMode : undefined,
    scenarioId,
    seed: finalSnapshot.config.seed,
    ticksRun: finalSnapshot.tick,
    deadlocked: finalSnapshot.detectors.deadlocked || deadlockEvt !== undefined,
    deadlockTick: deadlockEvt?.tick ?? null,
    starvationDetected,
    starvationStatusLabel: starvationDetected ? 'starvation detected by threshold' : 'No',
    starvedPhilosopherIds: Object.freeze(starvedPhilosopherIds),
    starvationEpisodeCount: starvationEvts.length,
    livelockSuspected,
    livelockTick: livelockEvt?.tick ?? null,
    averageWaitTicks,
    maxWaitTicks,
    totalMealsCompleted: finalSnapshot.totalMealsCompleted,
    totalMealsStarted: finalSnapshot.totalMealsEaten,
    minMealsPerPhilosopher,
    maxMealsPerPhilosopher,
    mealsPerPhilosopher: Object.freeze(mealsPerPhilosopher),
    fairnessScore,
    casAttempts,
    casFailures,
    casRollbacks,
  });
}

/**
 * Headless Batch Runner:
 * Runs all configured strategies against the exact same scenario, seed, and tick count,
 * returning real simulation metrics without any hardcoded claims.
 */
export function runStrategyBatchComparison(
  options: BatchRunOptions = {}
): readonly StrategyComparisonRow[] {
  const isPreset =
    options.scenario !== undefined &&
    'id' in options.scenario &&
    'config' in options.scenario;

  const baseScenarioConfig: SimulationConfig = isPreset
    ? (options.scenario as ScenarioPreset).config
    : ((options.scenario as SimulationConfig | undefined) ?? NORMAL_PRESET.config);

  const scenarioId =
    options.scenarioId ??
    (isPreset ? (options.scenario as ScenarioPreset).id : 'custom');

  const ticks = options.ticks ?? 60;
  const effectiveSeed = options.seed ?? baseScenarioConfig.seed ?? 42;

  const mergedBaseConfig: SimulationConfig = {
    ...baseScenarioConfig,
    seed: effectiveSeed,
  };

  const rawStrategies = options.strategies ?? DEFAULT_COMPARISON_STRATEGIES;
  const specs: StrategyRunSpec[] = rawStrategies.map((entry) =>
    typeof entry === 'string' ? { strategy: entry } : entry
  );

  const rows = specs.map((spec) =>
    runSingleStrategyComparison(mergedBaseConfig, spec, ticks, scenarioId)
  );

  return Object.freeze(rows);
}
