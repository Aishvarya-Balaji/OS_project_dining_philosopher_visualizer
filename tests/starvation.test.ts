import { describe, expect, it } from 'vitest';
import { SimulationEngine } from '../src/engine/simulation';
import { detectStarvation } from '../src/engine/starvationDetector';
import { PhilosopherSnapshot } from '../src/engine/types';
import {
  FORCE_DEADLOCK_PRESET,
  getScenarioPreset,
  NORMAL_PRESET,
  STARVATION_PRESET,
} from '../src/scenarios/presets';

function makeMockPhilosopher(
  id: number,
  overrides: Partial<PhilosopherSnapshot> = {}
): PhilosopherSnapshot {
  return {
    id,
    name: `Philosopher ${id}`,
    state: 'Thinking',
    leftForkId: id,
    rightForkId: (id + 1) % 5,
    heldForkIds: [],
    remainingStateTicks: 2,
    waitStartTick: null,
    currentWaitTicks: 0,
    totalWaitTicks: 0,
    longestWaitTicks: 0,
    mealsEaten: 0,
    mealsCompleted: 0,
    averageWaitPerMeal: 0,
    ...overrides,
  };
}

describe('Threshold-based Starvation Detector boundary rules', () => {
  it('enforces the exact threshold boundary (threshold - 1 vs threshold) and requires neighbor meals', () => {
    const threshold = 12;

    // 1. Wait is threshold - 1 (11 ticks) while neighbors completed 3 meals -> NOT flagged
    const belowBoundary = [
      makeMockPhilosopher(0, { mealsCompleted: 2 }),
      makeMockPhilosopher(1, { state: 'Waiting', waitStartTick: 1, currentWaitTicks: 11 }),
      makeMockPhilosopher(2, { mealsCompleted: 1 }),
      makeMockPhilosopher(3),
      makeMockPhilosopher(4),
    ];
    expect(
      detectStarvation({
        philosophers: belowBoundary,
        starvationThresholdTicks: threshold,
      }).starvationDetected
    ).toBe(false);

    // 2. Wait reaches exact threshold (12 ticks) while neighbors completed 3 meals -> FLAGGED
    const atBoundary = [
      makeMockPhilosopher(0, { mealsCompleted: 2 }),
      makeMockPhilosopher(1, { state: 'Waiting', waitStartTick: 1, currentWaitTicks: 12 }),
      makeMockPhilosopher(2, { mealsCompleted: 1 }),
      makeMockPhilosopher(3),
      makeMockPhilosopher(4),
    ];
    const flaggedResult = detectStarvation({
      philosophers: atBoundary,
      starvationThresholdTicks: threshold,
    });
    expect(flaggedResult.starvationDetected).toBe(true);
    expect(flaggedResult.starvedPhilosopherIds).toEqual([1]);
    expect(flaggedResult.reason).toContain('starvation detected by threshold');

    // 3. Wait exceeds threshold (20 ticks) but neighbors completed 0 meals (e.g. deadlock) -> NOT flagged
    const noNeighborMeals = [
      makeMockPhilosopher(0, { state: 'Waiting', currentWaitTicks: 20, mealsCompleted: 0 }),
      makeMockPhilosopher(1, { state: 'Waiting', currentWaitTicks: 20, mealsCompleted: 0 }),
      makeMockPhilosopher(2, { state: 'Waiting', currentWaitTicks: 20, mealsCompleted: 0 }),
      makeMockPhilosopher(3, { state: 'Waiting', currentWaitTicks: 20, mealsCompleted: 0 }),
      makeMockPhilosopher(4, { state: 'Waiting', currentWaitTicks: 20, mealsCompleted: 0 }),
    ];
    expect(
      detectStarvation({
        philosophers: noNeighborMeals,
        starvationThresholdTicks: threshold,
      }).starvationDetected
    ).toBe(false);
  });

  it('does not falsely flag starvation during Force Deadlock or Normal preset runs', () => {
    // Force Deadlock under Naive deadlocks with 0 meals -> must not flag starvation
    const deadlockEngine = new SimulationEngine(FORCE_DEADLOCK_PRESET.config);
    const deadlockSnap = deadlockEngine.runTicks(30);
    expect(deadlockSnap.detectors.deadlocked).toBe(true);
    expect(deadlockSnap.detectors.starvationDetected).toBe(false);
    expect(
      deadlockEngine.getEventLog().filter((e) => e.type === 'STARVATION_DETECTED')
    ).toHaveLength(0);

    // Normal preset across Naive, Semaphore, and Monitor must not falsely trigger starvation
    for (const strategy of ['naive', 'semaphore', 'monitor'] as const) {
      const normalEngine = new SimulationEngine({
        ...NORMAL_PRESET.config,
        strategy,
      });
      for (let t = 0; t < 80; t++) {
        const snap = normalEngine.step();
        expect(snap.detectors.starvationDetected).toBe(false);
      }
      expect(
        normalEngine.getEventLog().filter((e) => e.type === 'STARVATION_DETECTED')
      ).toHaveLength(0);
    }
  });
});

describe('Starvation (Biased) scenario and metrics tracking', () => {
  it('reproducibly flags Philosopher 1 under Monitor strategy, emits one event per episode, and emits STARVATION_ENDED when P1 eats', () => {
    const preset = getScenarioPreset('starvation');
    expect(preset).toEqual(STARVATION_PRESET);

    const engine = new SimulationEngine(preset.config);

    // Step to tick 12: P1 has waited 11 ticks (threshold is 12) -> not yet flagged
    const snap12 = engine.runTicks(12);
    expect(snap12.philosophers[1]?.currentWaitTicks).toBe(11);
    expect(snap12.detectors.starvationDetected).toBe(false);

    // Tick 13: P1 reaches 12 wait ticks while neighbors P0 and P2 have completed meals -> flagged!
    const snap13 = engine.step();
    expect(snap13.philosophers[1]?.currentWaitTicks).toBe(12);
    expect(snap13.detectors.starvationDetected).toBe(true);
    expect(snap13.detectors.starvedPhilosopherIds).toEqual([1]);
    expect(snap13.detectors.starvationReason).toContain('starvation detected by threshold');

    // Step through ticks 14..23: P1 remains waiting; still only ONE STARVATION_DETECTED event for this episode
    const snap20 = engine.runTicks(7);
    expect(snap20.detectors.starvationDetected).toBe(true);
    const detectedEventsAt20 = engine
      .getEventLog()
      .filter((e) => e.type === 'STARVATION_DETECTED');
    expect(detectedEventsAt20).toHaveLength(1);
    expect(detectedEventsAt20[0]?.philosopherId).toBe(1);
    expect(detectedEventsAt20[0]?.reason).toContain('starvation detected by threshold');

    // Advance to tick 23: P3 disrupts P2's cycle at tick 20, allowing P1 to finally acquire both forks and start eating at tick 23!
    const snap23 = engine.runTicks(3);
    expect(snap23.philosophers[1]?.state).toBe('Eating');
    expect(snap23.philosophers[1]?.mealsEaten).toBe(1);
    expect(snap23.philosophers[1]?.longestWaitTicks).toBe(21);
    expect(snap23.philosophers[1]?.averageWaitPerMeal).toBe(21);
    expect(snap23.detectors.starvationDetected).toBe(false);

    const endedEvents = engine
      .getEventLog()
      .filter((e) => e.type === 'STARVATION_ENDED');
    expect(endedEvents).toHaveLength(1);
    expect(endedEvents[0]?.philosopherId).toBe(1);
    expect(endedEvents[0]?.reason).toContain('starvation detected by threshold ended');
  });

  it('reproduces identical starvation metrics and event logs across runs and resets', () => {
    const engine1 = new SimulationEngine(STARVATION_PRESET.config);
    const engine2 = new SimulationEngine(STARVATION_PRESET.config);

    const snap1 = engine1.runTicks(30);
    const snap2 = engine2.runTicks(30);

    expect(snap1).toEqual(snap2);
    expect(engine1.getEventLog()).toEqual(engine2.getEventLog());

    engine1.reset();
    const snapAfterReset = engine1.runTicks(30);
    expect(snapAfterReset).toEqual(snap1);
  });
});
