import { StrictMode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createStrategyByName, SimulationEngine } from '../src/engine/simulation';
import {
  CAS_LIVELOCK_PRESET,
  FORCE_DEADLOCK_PRESET,
  NORMAL_PRESET,
  STARVATION_PRESET,
} from '../src/scenarios/presets';
import { App, buildSimulationConfig, DetectorBanners } from '../src/ui/App';
import { ComparisonPanel } from '../src/ui/ComparisonPanel';
import { EventLog } from '../src/ui/EventLog';
import { SimulationTable } from '../src/ui/SimulationTable';
import { StrategyDetails } from '../src/ui/StrategyDetails';

describe('Step 9 — UI, SVG Table, Controls, Detectors, and Event Log', () => {
  it('renders App inside React StrictMode at Tick 0 with all accessible controls and initial snapshot', () => {
    const html = renderToStaticMarkup(
      <StrictMode>
        <App />
      </StrictMode>
    );

    expect(html).toContain('Dining Philosophers OS Concurrency Simulator');
    expect(html).toContain('aria-label="Scenario preset"');
    expect(html).toContain('aria-label="Synchronization strategy"');
    expect(html).toContain('aria-label="Deterministic RNG seed"');
    expect(html).toContain('aria-label="Simulation speed"');
    expect(html).toContain('aria-label="Start simulation"');
    expect(html).toContain('aria-label="Pause simulation"');
    expect(html).toContain('aria-label="Step one tick"');
    expect(html).toContain('aria-label="Reset simulation"');
    expect(html).toContain('Tick 0');
    expect(html).toContain('SIMULATION_INIT');
  });

  it('matches every philosopher state and fork owner in SimulationTable to the engine snapshot', () => {
    const engine = new SimulationEngine(
      FORCE_DEADLOCK_PRESET.config,
      createStrategyByName('naive')
    );

    // Advance 2 ticks into passive circular-wait deadlock
    const snapshot = engine.runTicks(2);
    const events = engine.getEventLog();

    const tableHtml = renderToStaticMarkup(<SimulationTable snapshot={snapshot} />);
    const bannerHtml = renderToStaticMarkup(<DetectorBanners snapshot={snapshot} />);
    const logHtml = renderToStaticMarkup(<EventLog events={events} />);

    for (const phil of snapshot.philosophers) {
      expect(tableHtml).toContain(`data-philosopher-id="${phil.id}"`);
      expect(tableHtml).toContain(`data-state="${phil.state}"`);
    }

    for (const fork of snapshot.forks) {
      const expectedOwner = fork.ownerId ?? 'free';
      expect(tableHtml).toContain(
        `data-fork-id="${fork.id}" data-owner-id="${expectedOwner}"`
      );
    }

    expect(bannerHtml).toContain('data-detector="deadlock"');
    expect(bannerHtml).toContain(
      'P0 (holds F0, waits for F1) -&gt; P1 (holds F1, waits for F2)'
    );
    expect(logHtml).toContain('data-event-type="DEADLOCK_DETECTED"');
  });

  it('renders the explicit "starvation detected by threshold" banner and badge when Monitor hits starvation threshold', () => {
    const engine = new SimulationEngine(
      STARVATION_PRESET.config,
      createStrategyByName('monitor')
    );

    // At tick 13 in STARVATION_PRESET, P1 reaches 12 wait ticks while P0 and P2 complete meals
    const snapshot = engine.runTicks(13);
    expect(snapshot.detectors.starvationDetected).toBe(true);
    expect(snapshot.detectors.starvedPhilosopherIds).toEqual([1]);

    const bannerHtml = renderToStaticMarkup(<DetectorBanners snapshot={snapshot} />);
    const tableHtml = renderToStaticMarkup(<SimulationTable snapshot={snapshot} />);
    const detailsHtml = renderToStaticMarkup(<StrategyDetails snapshot={snapshot} />);

    expect(bannerHtml).toContain('data-detector="starvation"');
    expect(bannerHtml).toContain('starvation detected by threshold');
    expect(tableHtml).toContain('starvation detected by threshold');
    expect(tableHtml).toContain('STARVED (≥12t)');
    expect(detailsHtml).toContain('Monitor with test(i)');
  });

  it('renders Suspected Livelock banner and real CAS rollback counters for CAS Livelock preset', () => {
    const engine = new SimulationEngine(
      CAS_LIVELOCK_PRESET.config,
      createStrategyByName('cas')
    );

    const snapshot = engine.runTicks(12);
    expect(snapshot.detectors.livelockDetected).toBe(true);

    const bannerHtml = renderToStaticMarkup(<DetectorBanners snapshot={snapshot} />);
    const detailsHtml = renderToStaticMarkup(<StrategyDetails snapshot={snapshot} />);
    const comparisonHtml = renderToStaticMarkup(
      <ComparisonPanel scenario={NORMAL_PRESET} seed={42} />
    );

    expect(bannerHtml).toContain('data-detector="livelock"');
    expect(bannerHtml).toContain('SUSPECTED LIVELOCK');
    expect(detailsHtml).toContain('Lock-free (simulated CAS)');
    expect(detailsHtml).toContain('Left-Fork Rollbacks');
    expect(comparisonHtml).toContain('Cross-Strategy Batch Comparison');
  });

  it('builds deterministic simulation configs when switching scenario, strategy, seed, or CAS back-off mode', () => {
    const cfg1 = buildSimulationConfig('force-deadlock', 'semaphore', 99, 'random');
    expect(cfg1.strategy).toBe('semaphore');
    expect(cfg1.seed).toBe(99);
    expect(cfg1.initialStates).toEqual([
      'Hungry',
      'Hungry',
      'Hungry',
      'Hungry',
      'Hungry',
    ]);

    const engine = new SimulationEngine(cfg1, createStrategyByName('semaphore'));
    const snapAfterStep = engine.step();
    expect(snapAfterStep.tick).toBe(1);

    // Changing strategy/scenario/seed resets the engine back to tick 0
    const cfgReset = buildSimulationConfig('normal', 'monitor', 42, 'random');
    const snapReset = engine.reset(cfgReset, createStrategyByName('monitor'));
    expect(snapReset.tick).toBe(0);
    expect(snapReset.config.strategy).toBe('monitor');
    expect(snapReset.config.seed).toBe(42);
  });
});
