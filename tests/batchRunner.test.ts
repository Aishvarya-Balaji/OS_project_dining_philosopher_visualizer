import { describe, expect, it } from 'vitest';
import {
  computeJainFairnessIndex,
  runStrategyBatchComparison,
} from '../src/runner/batchRunner';
import { formatComparisonRows } from '../src/runner/formatResults';
import {
  CAS_LIVELOCK_PRESET,
  FORCE_DEADLOCK_PRESET,
  NORMAL_PRESET,
  STARVATION_PRESET,
} from '../src/scenarios/presets';

describe('Headless Batch Runner and Cross-Strategy Comparison', () => {
  it('returns identical comparison rows across repeated runs for the same scenario and seed', () => {
    const run1 = runStrategyBatchComparison({
      scenario: NORMAL_PRESET,
      seed: 42,
      ticks: 60,
    });
    const run2 = runStrategyBatchComparison({
      scenario: NORMAL_PRESET,
      seed: 42,
      ticks: 60,
    });

    expect(run1).toEqual(run2);
    expect(run1).toHaveLength(4);

    for (const row of run1) {
      expect(row.deadlocked).toBe(false);
      expect(row.starvationDetected).toBe(false);
      expect(row.livelockSuspected).toBe(false);
      expect(row.totalMealsCompleted).toBeGreaterThan(0);
      expect(row.fairnessScore).toBeGreaterThan(0.8);
    }
  });

  it('proves under Force Deadlock that Naive deadlocks while Semaphore, Monitor, and random-CAS make progress, and fixed-CAS livelocks', () => {
    const rows = runStrategyBatchComparison({
      scenario: FORCE_DEADLOCK_PRESET,
      seed: 42,
      ticks: 50,
      strategies: [
        { strategy: 'naive' },
        { strategy: 'semaphore' },
        { strategy: 'monitor' },
        { strategy: 'cas', casBackoffMode: 'random', label: 'CAS (Random Back-off)' },
        { strategy: 'cas', casBackoffMode: 'fixed', label: 'CAS (Fixed Back-off)' },
      ],
    });

    const naiveRow = rows.find((r) => r.strategy === 'naive')!;
    const semaphoreRow = rows.find((r) => r.strategy === 'semaphore')!;
    const monitorRow = rows.find((r) => r.strategy === 'monitor')!;
    const casRandomRow = rows.find(
      (r) => r.strategy === 'cas' && r.casBackoffMode === 'random'
    )!;
    const casFixedRow = rows.find(
      (r) => r.strategy === 'cas' && r.casBackoffMode === 'fixed'
    )!;

    // 1. Naive reliably deadlocks on tick 1 with 0 meals
    expect(naiveRow.deadlocked).toBe(true);
    expect(naiveRow.deadlockTick).toBe(1);
    expect(naiveRow.totalMealsCompleted).toBe(0);
    expect(naiveRow.fairnessScore).toBe(0);

    // 2. Semaphore prevents deadlock and completes meals fairly
    expect(semaphoreRow.deadlocked).toBe(false);
    expect(semaphoreRow.totalMealsCompleted).toBeGreaterThanOrEqual(5);
    expect(semaphoreRow.minMealsPerPhilosopher).toBeGreaterThanOrEqual(1);
    expect(semaphoreRow.fairnessScore).toBeGreaterThan(0.9);

    // 3. Monitor prevents deadlock and achieves high meal throughput
    expect(monitorRow.deadlocked).toBe(false);
    expect(monitorRow.totalMealsCompleted).toBeGreaterThanOrEqual(10);
    expect(monitorRow.minMealsPerPhilosopher).toBeGreaterThanOrEqual(1);
    expect(monitorRow.fairnessScore).toBeGreaterThan(0.9);

    // 4. CAS with seeded random back-off breaks symmetry and completes meals
    expect(casRandomRow.deadlocked).toBe(false);
    expect(casRandomRow.livelockSuspected).toBe(false);
    expect(casRandomRow.totalMealsCompleted).toBeGreaterThanOrEqual(5);
    expect(casRandomRow.casAttempts).toBeGreaterThan(10);
    expect(casRandomRow.casRollbacks).toBeGreaterThanOrEqual(5);

    // 5. CAS with fixed back-off livelocks with 0 meals and is NOT marked deadlocked
    expect(casFixedRow.deadlocked).toBe(false);
    expect(casFixedRow.livelockSuspected).toBe(true);
    expect(casFixedRow.livelockTick).toBe(FORCE_DEADLOCK_PRESET.config.livelockWindowTicks);
    expect(casFixedRow.totalMealsCompleted).toBe(0);
    expect(casFixedRow.casRollbacks).toBeGreaterThan(10);
  });

  it('captures threshold-detected starvation in Starvation (Biased) preset and formats comparison rows cleanly', () => {
    const rows = runStrategyBatchComparison({
      scenario: STARVATION_PRESET,
      seed: 42,
      ticks: 40,
    });

    const monitorRow = rows.find((r) => r.strategy === 'monitor')!;
    const semaphoreRow = rows.find((r) => r.strategy === 'semaphore')!;

    expect(monitorRow.starvationDetected).toBe(true);
    expect(monitorRow.starvationStatusLabel).toBe('starvation detected by threshold');
    expect(monitorRow.starvedPhilosopherIds).toContain(1);
    expect(monitorRow.maxWaitTicks).toBeGreaterThanOrEqual(21);

    expect(semaphoreRow.deadlocked).toBe(false);
    expect(semaphoreRow.starvationDetected).toBe(false);

    const formatted = formatComparisonRows(rows);
    const formattedMonitor = formatted.find((f) => f.strategy === 'monitor')!;
    expect(formattedMonitor.starvation).toContain('starvation detected by threshold');
    expect(formattedMonitor.starvation).toContain('P1');
  });

  it('computes Jain fairness index accurately for equal, skewed, and zero-meal distributions', () => {
    expect(computeJainFairnessIndex([4, 4, 4, 4, 4])).toBe(1);
    expect(computeJainFairnessIndex([0, 0, 0, 0, 0])).toBe(0);
    expect(computeJainFairnessIndex([5, 0, 0, 0, 0])).toBe(0.2);

    const livelockRows = runStrategyBatchComparison({
      scenario: CAS_LIVELOCK_PRESET,
      ticks: 25,
    });
    const casRow = livelockRows.find((r) => r.strategy === 'cas')!;
    expect(casRow.livelockSuspected).toBe(true);
    expect(casRow.fairnessScore).toBe(0);
  });
});
