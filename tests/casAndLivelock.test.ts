import { describe, expect, it } from 'vitest';
import { SimulationEngine } from '../src/engine/simulation';
import { CasDebugState, SimulatedCasStrategy } from '../src/engine/strategies/cas';
import { CAS_LIVELOCK_PRESET, FORCE_DEADLOCK_PRESET, getScenarioPreset } from '../src/scenarios/presets';

describe('Lock-free (simulated CAS) strategy and Livelock Detector', () => {
  it('models single-fork CAS per tick and rolls back left fork when right-fork CAS fails', () => {
    const strategy = new SimulatedCasStrategy();
    expect(strategy.displayName).toBe('Lock-free (simulated CAS)');

    const engine = new SimulationEngine(
      {
        philosopherCount: 5,
        strategy: 'cas',
        initialStates: ['Hungry', 'Hungry', 'Thinking', 'Thinking', 'Thinking'],
        initialThinkTicks: [5, 5, 5, 5, 5],
        casBackoffMode: 'fixed',
        casFixedBackoffTicks: 2,
      },
      strategy
    );

    // Tick 1: P0 CAS-claims left fork F0 (1 attempt); P1 CAS-claims left fork F1 (1 attempt)
    const snap1 = engine.step();
    expect(snap1.philosophers[0]?.heldForkIds).toEqual([0]);
    expect(snap1.philosophers[1]?.heldForkIds).toEqual([1]);

    // Tick 2: P0 attempts right fork F1 (held by P1) -> CAS fails -> P0 rolls back F0 and backs off!
    // Meanwhile P1 attempts right fork F2 (free) -> CAS succeeds -> P1 starts Eating!
    const snap2 = engine.step();
    expect(snap2.philosophers[0]?.state).toBe('Waiting');
    expect(snap2.philosophers[0]?.heldForkIds).toEqual([]);
    expect(snap2.forks[0]?.ownerId).toBeNull();
    expect(snap2.philosophers[1]?.state).toBe('Eating');
    expect(snap2.philosophers[1]?.heldForkIds).toEqual([1, 2]);

    const debug2 = snap2.strategyState as CasDebugState;
    expect(debug2.rollbacksByPhilosopher[0]).toBe(1);
    expect(debug2.failuresByPhilosopher[0]).toBe(1);
    expect(debug2.activelyRetryingPhilosophers).toContain(0);
    expect(debug2.backoffRemainingByPhilosopher[0]).toBe(2);
  });

  it('reproduces a no-progress retry/rollback pattern (livelock) under fixed back-off and never misclassifies it as deadlock', () => {
    const preset = getScenarioPreset('cas-livelock');
    expect(preset).toEqual(CAS_LIVELOCK_PRESET);

    const engine = new SimulationEngine(preset.config);

    // Step tick by tick for 20 ticks
    for (let t = 1; t <= 20; t++) {
      const snap = engine.step();
      // Active CAS retrying must NEVER be classified as passive deadlock
      expect(snap.detectors.deadlocked).toBe(false);
      expect(snap.totalMealsEaten).toBe(0);
      expect(snap.totalMealsCompleted).toBe(0);

      if (t < preset.config.livelockWindowTicks!) {
        expect(snap.detectors.livelockDetected).toBe(false);
      } else {
        expect(snap.detectors.livelockDetected).toBe(true);
        expect(snap.detectors.livelockReason).toMatch(/Suspected livelock detected/i);
      }
    }

    const finalSnap = engine.getSnapshot();
    const debug = finalSnap.strategyState as CasDebugState;
    expect(debug.totalAttempts).toBeGreaterThan(20);
    expect(debug.totalFailures).toBeGreaterThan(10);
    expect(debug.totalRollbacks).toBeGreaterThan(10);
    expect(debug.activelyRetryingPhilosophers).toEqual([0, 1, 2, 3, 4]);

    const livelockEvents = engine
      .getEventLog()
      .filter((e) => e.type === 'LIVELOCK_DETECTED');
    expect(livelockEvents).toHaveLength(1);
    expect(
      engine.getEventLog().filter((e) => e.type === 'DEADLOCK_DETECTED')
    ).toHaveLength(0);
  });

  it('breaks symmetry and makes progress under seeded randomized back-off for fixed seed 42', () => {
    const engine = new SimulationEngine({
      ...FORCE_DEADLOCK_PRESET.config,
      strategy: 'cas',
      seed: 42,
      casBackoffMode: 'random',
      casMaxRandomBackoffTicks: 4,
      livelockWindowTicks: 15,
      eatTicksRange: [2, 2],
      thinkTicksRange: [3, 5],
    });

    // Tick 1: all 5 claim left forks; Tick 2: all 5 fail right-fork CAS, roll back, and sample seeded random back-offs
    engine.step();
    const snap2 = engine.step();
    const debug2 = snap2.strategyState as CasDebugState;
    expect(debug2.totalRollbacks).toBe(5);
    expect(snap2.philosophers.every((p) => p.heldForkIds.length === 0)).toBe(true);

    // Run 50 more ticks: seeded randomized back-off breaks symmetry so all 5 philosophers eat and complete meals!
    const finalSnap = engine.runTicks(50);
    expect(finalSnap.detectors.deadlocked).toBe(false);
    expect(finalSnap.detectors.livelockDetected).toBe(false);
    expect(finalSnap.totalMealsCompleted).toBeGreaterThanOrEqual(5);

    for (const phil of finalSnap.philosophers) {
      expect(phil.mealsEaten).toBeGreaterThanOrEqual(1);
    }
  });

  it('maintains fork safety and deterministic output across runs and resets', () => {
    const config = {
      ...FORCE_DEADLOCK_PRESET.config,
      strategy: 'cas' as const,
      seed: 77,
      casBackoffMode: 'random' as const,
      casMaxRandomBackoffTicks: 5,
    };

    const engineA = new SimulationEngine(config);
    const engineB = new SimulationEngine(config);

    const snapA = engineA.runTicks(40);
    const snapB = engineB.runTicks(40);

    expect(snapA).toEqual(snapB);
    expect(engineA.getEventLog()).toEqual(engineB.getEventLog());

    engineA.reset();
    expect(engineA.runTicks(40)).toEqual(snapA);
  });
});
