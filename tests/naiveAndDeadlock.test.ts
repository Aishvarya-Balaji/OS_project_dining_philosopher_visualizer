import { describe, expect, it } from 'vitest';
import { detectDeadlock } from '../src/engine/deadlockDetector';
import { SimulationEngine } from '../src/engine/simulation';
import { NaiveStrategy } from '../src/engine/strategies/naive';
import { FORCE_DEADLOCK_PRESET, getScenarioPreset, NORMAL_PRESET } from '../src/scenarios/presets';

describe('NaiveStrategy behavior', () => {
  it('acquires left fork first, waits one tick, and acquires right fork on the next tick', () => {
    const engine = new SimulationEngine(
      {
        initialStates: ['Hungry', 'Thinking', 'Thinking', 'Thinking', 'Thinking'],
        initialThinkTicks: [5, 5, 5, 5, 5],
        eatTicksRange: [2, 2],
      },
      new NaiveStrategy()
    );

    // Tick 1: P0 acquires left fork (F0) only and transitions Hungry -> Waiting
    const snap1 = engine.step();
    const p0Tick1 = snap1.philosophers[0]!;
    expect(p0Tick1.state).toBe('Waiting');
    expect(p0Tick1.heldForkIds).toEqual([0]);
    expect(snap1.forks[0]?.ownerId).toBe(0);
    expect(snap1.forks[1]?.ownerId).toBeNull();

    // Tick 2: P0 acquires right fork (F1) and transitions Waiting -> Eating
    const snap2 = engine.step();
    const p0Tick2 = snap2.philosophers[0]!;
    expect(p0Tick2.state).toBe('Eating');
    expect(p0Tick2.heldForkIds).toEqual([0, 1]);
    expect(p0Tick2.mealsEaten).toBe(1);
  });

  it('keeps holding the left fork and waits when the right fork is unavailable', () => {
    const engine = new SimulationEngine(
      {
        initialStates: ['Hungry', 'Hungry', 'Thinking', 'Thinking', 'Thinking'],
        initialThinkTicks: [5, 5, 5, 5, 5],
      },
      new NaiveStrategy()
    );

    // Tick 1: P0 acquires F0, P1 acquires F1
    const snap1 = engine.step();
    expect(snap1.philosophers[0]?.heldForkIds).toEqual([0]);
    expect(snap1.philosophers[1]?.heldForkIds).toEqual([1]);

    // Tick 2: P0 wants F1 (held by P1) -> denied, keeps holding F0 and stays Waiting.
    // Meanwhile P1 acquires F2 (free) and starts Eating!
    const snap2 = engine.step();
    expect(snap2.philosophers[0]?.state).toBe('Waiting');
    expect(snap2.philosophers[0]?.heldForkIds).toEqual([0]);
    expect(snap2.philosophers[1]?.state).toBe('Eating');
    expect(snap2.philosophers[1]?.heldForkIds).toEqual([1, 2]);

    const deniedEvents = engine
      .getEventLog()
      .filter((e) => e.type === 'FORK_DENIED' && e.philosopherId === 0);
    expect(deniedEvents).toHaveLength(1);
    expect(deniedEvents[0]?.forkId).toBe(1);
  });
});

describe('Force Deadlock preset and Deadlock Detector', () => {
  it('makes all five philosophers hungry together and reliably deadlocks within a few ticks', () => {
    const preset = getScenarioPreset('force-deadlock');
    expect(preset).toEqual(FORCE_DEADLOCK_PRESET);

    const engine = new SimulationEngine(preset.config, new NaiveStrategy());

    // At tick 0, all five philosophers are Hungry together
    const initialSnap = engine.getSnapshot();
    expect(initialSnap.philosophers.every((p) => p.state === 'Hungry')).toBe(true);

    // Run 5 ticks: deadlock is reached on tick 1 when all 5 hold their left fork
    const snap = engine.runTicks(5);
    expect(snap.detectors.deadlocked).toBe(true);
    expect(snap.totalMealsEaten).toBe(0);
    expect(snap.philosophers.every((p) => p.state === 'Waiting')).toBe(true);
    expect(snap.philosophers.every((p) => p.heldForkIds.length === 1)).toBe(true);

    // Continue running more ticks: no progress is possible and only ONE deadlock event is ever emitted
    engine.runTicks(15);
    const deadlockEvents = engine
      .getEventLog()
      .filter((e) => e.type === 'DEADLOCK_DETECTED');

    expect(deadlockEvents).toHaveLength(1);

    const event = deadlockEvents[0]!;
    expect(event.reason).toContain('P0 (holds F0, waits for F1)');
    expect(event.reason).toContain('P4 (holds F4, waits for F0) -> P0');
    expect(event.reason).toMatch(/Mutual exclusion/i);
    expect(event.reason).toMatch(/Hold and wait/i);
    expect(event.reason).toMatch(/No preemption/i);
    expect(event.reason).toMatch(/Circular wait/i);
  });

  it('does not fire deadlock detector during Normal preset progress or partial waiting states', () => {
    const engine = new SimulationEngine(NORMAL_PRESET.config, new NaiveStrategy());

    for (let t = 0; t < 80; t++) {
      const snap = engine.step();
      expect(snap.detectors.deadlocked).toBe(false);
    }

    const finalSnap = engine.getSnapshot();
    expect(finalSnap.totalMealsEaten).toBeGreaterThan(5);
    expect(finalSnap.totalMealsCompleted).toBeGreaterThan(5);
    expect(
      engine.getEventLog().filter((e) => e.type === 'DEADLOCK_DETECTED')
    ).toHaveLength(0);
  });

  it('prevents false positives when strategy is active rollback (CAS) or when not all philosophers hold 1 fork', () => {
    const engine = new SimulationEngine(FORCE_DEADLOCK_PRESET.config, new NaiveStrategy());
    const deadlockedSnap = engine.step();
    expect(deadlockedSnap.detectors.deadlocked).toBe(true);

    // Same fork/philosopher state under CAS must NOT be classified as passive deadlock
    const casCheck = detectDeadlock({
      philosophers: deadlockedSnap.philosophers,
      forks: deadlockedSnap.forks,
      strategy: 'cas',
    });
    expect(casCheck.deadlocked).toBe(false);
  });
});
