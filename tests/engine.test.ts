import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/engine/rng';
import {
  InvariantError,
  isLegalStateTransition,
  resolveSimulationConfig,
  SimulationEngine,
} from '../src/engine/simulation';
import {
  ReadonlySimulationView,
  Strategy,
  StrategyStepResult,
} from '../src/engine/types';

describe('SeededRng', () => {
  it('produces identical sequences for the same seed and reproduces after reset()', () => {
    const rngA = new SeededRng(1337);
    const rngB = new SeededRng(1337);

    const seqA = Array.from({ length: 20 }, () => rngA.nextInt(1, 100));
    const seqB = Array.from({ length: 20 }, () => rngB.nextInt(1, 100));
    expect(seqA).toEqual(seqB);

    rngA.reset();
    const seqAfterReset = Array.from({ length: 20 }, () => rngA.nextInt(1, 100));
    expect(seqAfterReset).toEqual(seqA);
  });

  it('produces values strictly within [min, max] and rejects invalid bounds', () => {
    const rng = new SeededRng(99);
    for (let i = 0; i < 100; i++) {
      const value = rng.nextInt(3, 7);
      expect(value).toBeGreaterThanOrEqual(3);
      expect(value).toBeLessThanOrEqual(7);
      expect(Number.isInteger(value)).toBe(true);
    }

    expect(() => rng.nextInt(8, 4)).toThrow(/Invalid RNG integer range/);
    expect(() => new SeededRng(Number.NaN)).toThrow(/Invalid RNG seed/);
  });
});

describe('SimulationEngine determinism and reset reproducibility', () => {
  it('produces the exact same event log and snapshot for identical seed and config', () => {
    const config = {
      seed: 2026,
      thinkTicksRange: [2, 4] as const,
      eatTicksRange: [2, 3] as const,
    };

    const engine1 = new SimulationEngine(config);
    const engine2 = new SimulationEngine(config);

    const snap1 = engine1.runTicks(40);
    const snap2 = engine2.runTicks(40);

    expect(snap1).toEqual(snap2);
    expect(engine1.getEventLog()).toEqual(engine2.getEventLog());
  });

  it('reproduces the exact same event log and snapshots after reset()', () => {
    const engine = new SimulationEngine({
      seed: 777,
      thinkTicksRange: [1, 3],
      eatTicksRange: [1, 2],
    });

    const firstSnap = engine.runTicks(35);
    const firstLog = engine.getEventLog();

    engine.reset();
    expect(engine.getSnapshot().tick).toBe(0);

    const secondSnap = engine.runTicks(35);
    const secondLog = engine.getEventLog();

    expect(secondSnap).toEqual(firstSnap);
    expect(secondLog).toEqual(firstLog);
  });
});

describe('Legal state transitions, timing ranges, and metrics', () => {
  it('validates timing ranges and rejects invalid configurations', () => {
    expect(() => resolveSimulationConfig({ thinkTicksRange: [0, 3] })).toThrow(
      /Invalid timing range/
    );
    expect(() => resolveSimulationConfig({ thinkTicksRange: [5, 2] })).toThrow(
      /Invalid timing range/
    );
    expect(() => resolveSimulationConfig({ eatTicksRange: [4, 1] })).toThrow(
      /Invalid timing range/
    );
    expect(() => resolveSimulationConfig({ philosopherCount: 1 })).toThrow(
      /Invalid philosopherCount/
    );
  });

  it('keeps sampled Thinking and Eating durations within configured timing ranges', () => {
    const engine = new SimulationEngine({
      seed: 42,
      thinkTicksRange: [2, 5],
      eatTicksRange: [3, 4],
    });

    for (let t = 0; t < 50; t++) {
      const snap = engine.step();
      for (const phil of snap.philosophers) {
        if (phil.state === 'Thinking') {
          expect(phil.remainingStateTicks).toBeGreaterThanOrEqual(1);
          expect(phil.remainingStateTicks).toBeLessThanOrEqual(5);
        } else if (phil.state === 'Eating') {
          expect(phil.remainingStateTicks).toBeGreaterThanOrEqual(1);
          expect(phil.remainingStateTicks).toBeLessThanOrEqual(4);
        } else {
          expect(phil.remainingStateTicks).toBe(0);
        }
      }
    }
  });

  it('executes only legal philosopher state transitions and records wait/meal metrics', () => {
    const engine = new SimulationEngine({
      seed: 101,
      thinkTicksRange: [1, 2],
      eatTicksRange: [2, 2],
    });

    const finalSnap = engine.runTicks(50);
    const stateEvents = engine.getEventLog().filter((e) => e.type === 'STATE_CHANGE');
    expect(stateEvents.length).toBeGreaterThan(0);

    for (const evt of stateEvents) {
      expect(evt.fromState).toBeDefined();
      expect(evt.toState).toBeDefined();
      expect(isLegalStateTransition(evt.fromState!, evt.toState!)).toBe(true);
    }

    expect(finalSnap.totalMealsEaten).toBeGreaterThan(0);
    expect(finalSnap.totalMealsCompleted).toBeGreaterThan(0);

    const anyWaited = finalSnap.philosophers.some(
      (p) => p.totalWaitTicks > 0 && p.longestWaitTicks > 0
    );
    expect(anyWaited).toBe(true);
  });
});

describe('Fork safety and broken strategy invariant enforcement', () => {
  it('ensures no philosopher ever eats without holding both neighboring forks', () => {
    const engine = new SimulationEngine({
      seed: 555,
      thinkTicksRange: [1, 3],
      eatTicksRange: [1, 3],
    });

    for (let t = 0; t < 60; t++) {
      const snap = engine.step();
      for (const phil of snap.philosophers) {
        if (phil.state === 'Eating') {
          expect(phil.heldForkIds).toContain(phil.leftForkId);
          expect(phil.heldForkIds).toContain(phil.rightForkId);
          expect(phil.heldForkIds).toHaveLength(2);
          expect(snap.forks[phil.leftForkId]?.ownerId).toBe(phil.id);
          expect(snap.forks[phil.rightForkId]?.ownerId).toBe(phil.id);
        }
      }
    }
  });

  it('throws InvariantError when a broken strategy tells a philosopher to eat with only one fork', () => {
    const eatWithOneForkStrategy: Strategy = {
      name: 'naive',
      description: 'Broken strategy that starts eating with only the left fork',
      reset() {},
      decide(view: ReadonlySimulationView): StrategyStepResult {
        const hungryPhil = view.philosophers.find((p) => p.state === 'Hungry');
        if (!hungryPhil) {
          return { actions: [] };
        }
        return {
          actions: [
            {
              type: 'ACQUIRE_FORK',
              philosopherId: hungryPhil.id,
              forkId: hungryPhil.leftForkId,
              reason: 'Grab only left fork',
            },
            {
              type: 'START_EATING',
              philosopherId: hungryPhil.id,
              reason: 'Illegal attempt to eat with only one fork',
            },
          ],
        };
      },
    };

    const engine = new SimulationEngine(
      { initialStates: ['Hungry', 'Thinking', 'Thinking', 'Thinking', 'Thinking'] },
      eatWithOneForkStrategy
    );

    expect(() => engine.step()).toThrow(InvariantError);
    expect(engine.getEventLog().some((e) => e.type === 'INVARIANT_VIOLATION')).toBe(true);
  });

  it('throws InvariantError when a broken strategy assigns the same fork to two philosophers', () => {
    const doubleAssignForkStrategy: Strategy = {
      name: 'naive',
      description: 'Broken strategy that grants fork 1 to both Philosopher 0 and Philosopher 1',
      reset() {},
      decide(): StrategyStepResult {
        return {
          actions: [
            {
              type: 'ACQUIRE_FORK',
              philosopherId: 0,
              forkId: 1, // P0 right fork
              reason: 'Grant fork 1 to P0',
            },
            {
              type: 'ACQUIRE_FORK',
              philosopherId: 1,
              forkId: 1, // P1 left fork (already owned by P0!)
              reason: 'Illegal duplicate grant of fork 1 to P1',
            },
          ],
        };
      },
    };

    const engine = new SimulationEngine(
      { initialStates: ['Hungry', 'Hungry', 'Thinking', 'Thinking', 'Thinking'] },
      doubleAssignForkStrategy
    );

    expect(() => engine.step()).toThrow(InvariantError);
  });

  it('throws InvariantError when a broken strategy grants a non-neighboring fork', () => {
    const nonNeighborForkStrategy: Strategy = {
      name: 'naive',
      description: 'Broken strategy that grants fork 3 to Philosopher 0',
      reset() {},
      decide(): StrategyStepResult {
        return {
          actions: [
            {
              type: 'ACQUIRE_FORK',
              philosopherId: 0,
              forkId: 3,
              reason: 'Illegal non-adjacent fork grant',
            },
          ],
        };
      },
    };

    const engine = new SimulationEngine(
      { initialStates: ['Hungry', 'Thinking', 'Thinking', 'Thinking', 'Thinking'] },
      nonNeighborForkStrategy
    );

    expect(() => engine.step()).toThrow(InvariantError);
  });

  it('prevents strategies from directly mutating the read-only simulation view', () => {
    const mutatingStrategy: Strategy = {
      name: 'naive',
      description: 'Broken strategy attempting direct state mutation',
      reset() {},
      decide(view: ReadonlySimulationView): StrategyStepResult {
        // Attempt direct mutation of frozen view
        (view.forks[0] as { ownerId: number | null }).ownerId = 0;
        return { actions: [] };
      },
    };

    const engine = new SimulationEngine(
      { initialStates: ['Hungry', 'Thinking', 'Thinking', 'Thinking', 'Thinking'] },
      mutatingStrategy
    );

    expect(() => engine.step()).toThrow(TypeError);
  });
});
