import { describe, expect, it } from 'vitest';
import { SimulationEngine } from '../src/engine/simulation';
import { SemaphoreDebugState, SemaphoreStrategy } from '../src/engine/strategies/semaphore';
import { FORCE_DEADLOCK_PRESET } from '../src/scenarios/presets';

describe('SemaphoreStrategy (N - 1 permits + FIFO queue)', () => {
  it('prevents deadlock under Force Deadlock preset and allows all 5 philosophers to eat', () => {
    const strategy = new SemaphoreStrategy();
    const engine = new SimulationEngine(
      {
        ...FORCE_DEADLOCK_PRESET.config,
        strategy: 'semaphore',
        eatTicksRange: [2, 2],
        thinkTicksRange: [3, 4],
      },
      strategy
    );

    // Tick 1: P0, P1, P2, P3 get permits and grab left forks (F0..F3); P4 is queued on semaphore and holds 0 forks
    const snap1 = engine.step();
    const debug1 = snap1.strategyState as SemaphoreDebugState;
    expect(debug1.availablePermits).toBe(0);
    expect(debug1.maxPermits).toBe(4);
    expect(debug1.admittedPhilosophers).toEqual([0, 1, 2, 3]);
    expect(debug1.queue).toEqual([4]);
    expect(snap1.philosophers[4]?.heldForkIds).toEqual([]);
    expect(snap1.forks[4]?.ownerId).toBeNull();

    // Tick 2: P3 acquires free right fork F4 and starts Eating!
    const snap2 = engine.step();
    expect(snap2.philosophers[3]?.state).toBe('Eating');
    expect(snap2.philosophers[3]?.heldForkIds).toEqual([3, 4]);
    expect(snap2.detectors.deadlocked).toBe(false);

    // Run 40 more ticks: all 5 philosophers eat and complete meals without deadlocking
    const finalSnap = engine.runTicks(40);
    expect(finalSnap.detectors.deadlocked).toBe(false);
    for (const phil of finalSnap.philosophers) {
      expect(phil.mealsEaten).toBeGreaterThanOrEqual(1);
      expect(phil.mealsCompleted).toBeGreaterThanOrEqual(1);
    }
  });

  it('keeps permit count strictly within [0, N - 1] and maintains mutual exclusion across all ticks', () => {
    const strategy = new SemaphoreStrategy();
    const engine = new SimulationEngine(
      {
        ...FORCE_DEADLOCK_PRESET.config,
        strategy: 'semaphore',
        eatTicksRange: [1, 3],
        thinkTicksRange: [1, 3],
      },
      strategy
    );

    const n = 5;
    for (let t = 0; t < 80; t++) {
      const snap = engine.step();
      const debug = strategy.getInternalState();

      // Permit bounds check: 0 <= availablePermits <= N - 1
      expect(debug.maxPermits).toBe(n - 1);
      expect(debug.availablePermits).toBeGreaterThanOrEqual(0);
      expect(debug.availablePermits).toBeLessThanOrEqual(n - 1);
      expect(debug.admittedPhilosophers.length).toBe(
        debug.maxPermits - debug.availablePermits
      );
      expect(debug.admittedPhilosophers.length).toBeLessThanOrEqual(n - 1);

      // Verify debug state is JSON-serializable and matches engine fork owners
      expect(() => JSON.stringify(debug)).not.toThrow();
      expect(debug.forkOwners).toEqual(snap.forks.map((f) => f.ownerId));

      // Queued philosophers without a permit must never hold any forks
      for (const queuedId of debug.queue) {
        expect(snap.philosophers[queuedId]?.heldForkIds).toEqual([]);
      }

      // Mutual exclusion: no two adjacent philosophers are ever Eating simultaneously
      for (let i = 0; i < n; i++) {
        const current = snap.philosophers[i]!;
        const neighbor = snap.philosophers[(i + 1) % n]!;
        expect(current.state === 'Eating' && neighbor.state === 'Eating').toBe(false);
      }
    }
  });

  it('enforces strict FIFO queue order and passes released permits without barging', () => {
    const strategy = new SemaphoreStrategy();
    const engine = new SimulationEngine(
      {
        philosopherCount: 5,
        strategy: 'semaphore',
        // P0..P3 start Hungry at tick 0; P4 becomes Hungry at tick 1
        initialStates: ['Hungry', 'Hungry', 'Hungry', 'Hungry', 'Thinking'],
        initialThinkTicks: [1, 1, 1, 1, 1],
        eatTicksRange: [1, 1],
        thinkTicksRange: [1, 1],
      },
      strategy
    );

    // Tick 1: P0..P3 acquire the 4 permits; P4 finishes thinking and becomes Hungry at end of Tick 1
    engine.step();
    expect(strategy.getInternalState().admittedPhilosophers).toEqual([0, 1, 2, 3]);
    expect(strategy.getInternalState().queue).toEqual([]);

    // Tick 2: P4 is now Hungry and joins the FIFO queue; P3 acquires F4 and starts Eating (for 1 tick)
    engine.step();
    expect(strategy.getInternalState().queue).toEqual([4]);
    expect(engine.getSnapshot().philosophers[3]?.state).toBe('Eating');

    // Tick 3: P3 finishes eating and releases their permit; P4 (at head of FIFO queue) must receive the permit immediately
    engine.step();
    const log = engine.getEventLog();
    const queuedEvt = log.find((e) => e.type === 'SEMAPHORE_QUEUED' && e.philosopherId === 4);
    const releaseEvt = log.find((e) => e.type === 'SEMAPHORE_RELEASED' && e.philosopherId === 3);
    const acquireP4Evt = log.find((e) => e.type === 'SEMAPHORE_ACQUIRED' && e.philosopherId === 4);

    expect(queuedEvt).toBeDefined();
    expect(releaseEvt).toBeDefined();
    expect(acquireP4Evt).toBeDefined();
    expect(acquireP4Evt!.id).toBeGreaterThan(releaseEvt!.id);
    expect(acquireP4Evt!.details?.passedFrom).toBe(3);
  });
});
