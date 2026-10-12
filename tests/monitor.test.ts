import { describe, expect, it } from 'vitest';
import { SimulationEngine } from '../src/engine/simulation';
import { MonitorDebugState, MonitorStrategy } from '../src/engine/strategies/monitor';
import { FORCE_DEADLOCK_PRESET } from '../src/scenarios/presets';

describe('MonitorStrategy (pickup, putdown, test(i), condition variables)', () => {
  it('avoids deadlock in Force Deadlock and allows two non-adjacent philosophers to eat immediately', () => {
    const strategy = new MonitorStrategy();
    const engine = new SimulationEngine(
      {
        ...FORCE_DEADLOCK_PRESET.config,
        strategy: 'monitor',
        eatTicksRange: [2, 2],
        thinkTicksRange: [3, 4],
      },
      strategy
    );

    // Tick 1: P0 and P2 pass test(i) and eat in parallel; P1, P3, P4 wait on condition variables holding 0 forks
    const snap1 = engine.step();
    expect(snap1.detectors.deadlocked).toBe(false);
    expect(snap1.philosophers[0]?.state).toBe('Eating');
    expect(snap1.philosophers[0]?.heldForkIds).toEqual([0, 1]);
    expect(snap1.philosophers[2]?.state).toBe('Eating');
    expect(snap1.philosophers[2]?.heldForkIds).toEqual([2, 3]);

    expect(snap1.philosophers[1]?.state).toBe('Waiting');
    expect(snap1.philosophers[1]?.heldForkIds).toEqual([]);
    expect(snap1.philosophers[3]?.state).toBe('Waiting');
    expect(snap1.philosophers[3]?.heldForkIds).toEqual([]);
    expect(snap1.philosophers[4]?.state).toBe('Waiting');
    expect(snap1.philosophers[4]?.heldForkIds).toEqual([]);

    const debug1 = snap1.strategyState as MonitorDebugState;
    expect(debug1.monitorStates).toEqual(['Eating', 'Hungry', 'Eating', 'Hungry', 'Hungry']);
    expect(debug1.conditionStates).toEqual(['Signaled', 'Waiting', 'Signaled', 'Waiting', 'Waiting']);

    // Run 25 more ticks: all 5 philosophers eat and complete meals without deadlocking
    const finalSnap = engine.runTicks(25);
    expect(finalSnap.detectors.deadlocked).toBe(false);
    for (const phil of finalSnap.philosophers) {
      expect(phil.mealsEaten).toBeGreaterThanOrEqual(1);
      expect(phil.mealsCompleted).toBeGreaterThanOrEqual(1);
    }
  });

  it('maintains mutual exclusion so no adjacent philosophers ever eat simultaneously', () => {
    const engine = new SimulationEngine({
      ...FORCE_DEADLOCK_PRESET.config,
      strategy: 'monitor',
      eatTicksRange: [1, 3],
      thinkTicksRange: [1, 3],
      seed: 909,
    });

    const n = 5;
    for (let t = 0; t < 100; t++) {
      const snap = engine.step();
      expect(snap.detectors.deadlocked).toBe(false);

      for (let i = 0; i < n; i++) {
        const phil = snap.philosophers[i]!;
        const rightNeighbor = snap.philosophers[(i + 1) % n]!;

        // No two adjacent philosophers may eat at the same time
        expect(phil.state === 'Eating' && rightNeighbor.state === 'Eating').toBe(false);

        // Monitor acquires both forks atomically: a philosopher holds either 0 forks (Thinking/Hungry/Waiting) or 2 forks (Eating)
        if (phil.state === 'Eating') {
          expect(phil.heldForkIds).toHaveLength(2);
        } else {
          expect(phil.heldForkIds).toHaveLength(0);
        }
      }
    }
  });

  it('tests both neighbors on putdown(i) and emits monitor-entered, test, wait, and signal wakeup events', () => {
    const engine = new SimulationEngine({
      philosopherCount: 5,
      strategy: 'monitor',
      initialStates: ['Hungry', 'Hungry', 'Hungry', 'Hungry', 'Hungry'],
      eatTicksRange: [2, 2],
      thinkTicksRange: [5, 5],
      seed: 42,
    });

    // Tick 1: P0 and P2 enter Eating; P1, P3, P4 enter Waiting on self[i]
    engine.step();
    // Tick 2: P0 and P2 still Eating (remaining 1 tick)
    engine.step();
    // Tick 3: P0 and P2 finish eating -> putdown(0) tests P4 & P1; putdown(2) tests P1 & P3 -> P4 and P1 wake up and eat!
    const snap3 = engine.step();

    expect(snap3.philosophers[4]?.state).toBe('Eating');
    expect(snap3.philosophers[1]?.state).toBe('Eating');

    const log = engine.getEventLog();

    // Check monitor-entered events (pickup and putdown)
    const pickupEvents = log.filter(
      (e) => e.type === 'STRATEGY_DECISION' && e.details?.procedure === 'pickup'
    );
    expect(pickupEvents.length).toBeGreaterThanOrEqual(5);

    const putdownP0 = log.find(
      (e) =>
        e.type === 'STRATEGY_DECISION' &&
        e.details?.procedure === 'putdown' &&
        e.philosopherId === 0
    );
    expect(putdownP0).toBeDefined();
    expect(putdownP0?.details?.leftNeighborId).toBe(4);
    expect(putdownP0?.details?.rightNeighborId).toBe(1);

    // Check neighbor MONITOR_TEST events triggered by putdown(0)
    const putdownTestsFromP0 = log.filter(
      (e) =>
        e.type === 'MONITOR_TEST' &&
        e.details?.caller === 'putdown' &&
        e.details?.triggeredBy === 0
    );
    expect(putdownTestsFromP0.map((e) => e.philosopherId)).toEqual([4, 1]);

    // Check MONITOR_WAIT and MONITOR_SIGNAL wakeup events
    const waitEvents = log.filter((e) => e.type === 'MONITOR_WAIT');
    expect(waitEvents.map((e) => e.philosopherId)).toEqual([1, 3, 4]);

    const wakeupSignalEvents = log.filter(
      (e) => e.type === 'MONITOR_SIGNAL' && e.details?.wasWaitingOnCondition === true
    );
    expect(wakeupSignalEvents.map((e) => e.philosopherId)).toEqual([4, 1]);
  });

  it('produces deterministic event logs across identical seeds and resets', () => {
    const config = {
      ...FORCE_DEADLOCK_PRESET.config,
      strategy: 'monitor' as const,
      seed: 1234,
    };

    const engineA = new SimulationEngine(config);
    const engineB = new SimulationEngine(config);

    engineA.runTicks(30);
    engineB.runTicks(30);

    expect(engineA.getEventLog()).toEqual(engineB.getEventLog());

    const logBeforeReset = engineA.getEventLog();
    engineA.reset();
    engineA.runTicks(30);
    expect(engineA.getEventLog()).toEqual(logBeforeReset);
  });
});
