import { useEffect, useRef, useState } from 'react';
import { createStrategyByName, SimulationEngine } from '../engine/simulation';
import {
  CasBackoffMode,
  SimulationConfig,
  SimulationEvent,
  SimulationSnapshot,
  StrategyName,
} from '../engine/types';
import { getScenarioPreset, NORMAL_PRESET } from '../scenarios/presets';
import { ComparisonPanel } from './ComparisonPanel';
import { Controls } from './Controls';
import { EventLog } from './EventLog';
import { SimulationTable } from './SimulationTable';
import { StrategyDetails } from './StrategyDetails';

export function buildSimulationConfig(
  scenarioId: string,
  strategy: StrategyName,
  seed: number,
  casBackoffMode: CasBackoffMode
): SimulationConfig {
  const preset = getScenarioPreset(scenarioId);
  return {
    ...preset.config,
    strategy,
    seed,
    casBackoffMode,
  };
}

export function App() {
  const initialScenario = NORMAL_PRESET;
  const initialStrategy: StrategyName = initialScenario.config.strategy ?? 'naive';
  const initialSeed: number = initialScenario.config.seed ?? 42;
  const initialBackoff: CasBackoffMode = initialScenario.config.casBackoffMode ?? 'random';

  const engineRef = useRef<SimulationEngine | null>(null);
  if (engineRef.current === null) {
    const cfg = buildSimulationConfig(
      initialScenario.id,
      initialStrategy,
      initialSeed,
      initialBackoff
    );
    engineRef.current = new SimulationEngine(cfg, createStrategyByName(initialStrategy));
  }

  const [scenarioId, setScenarioId] = useState<string>(initialScenario.id);
  const [strategy, setStrategy] = useState<StrategyName>(initialStrategy);
  const [casBackoffMode, setCasBackoffMode] = useState<CasBackoffMode>(initialBackoff);
  const [seed, setSeed] = useState<number>(initialSeed);
  const [speedMs, setSpeedMs] = useState<number>(600);
  const [isRunning, setIsRunning] = useState<boolean>(false);

  const [snapshot, setSnapshot] = useState<SimulationSnapshot>(() =>
    engineRef.current!.getSnapshot()
  );
  const [events, setEvents] = useState<readonly SimulationEvent[]>(() =>
    engineRef.current!.getEventLog()
  );

  const resetEngineWith = (
    nextScenarioId: string,
    nextStrategy: StrategyName,
    nextSeed: number,
    nextBackoffMode: CasBackoffMode
  ) => {
    setIsRunning(false);
    const cfg = buildSimulationConfig(
      nextScenarioId,
      nextStrategy,
      nextSeed,
      nextBackoffMode
    );
    const engine = engineRef.current!;
    const nextSnapshot = engine.reset(cfg, createStrategyByName(nextStrategy));
    const nextEvents = engine.getEventLog();
    setSnapshot(nextSnapshot);
    setEvents(nextEvents);
  };

  const handleScenarioChange = (nextScenarioId: string) => {
    const preset = getScenarioPreset(nextScenarioId);
    const nextStrategy: StrategyName = preset.config.strategy ?? strategy;
    const nextSeed: number = preset.config.seed ?? seed;
    const nextBackoff: CasBackoffMode = preset.config.casBackoffMode ?? casBackoffMode;

    setScenarioId(nextScenarioId);
    setStrategy(nextStrategy);
    setSeed(nextSeed);
    setCasBackoffMode(nextBackoff);
    resetEngineWith(nextScenarioId, nextStrategy, nextSeed, nextBackoff);
  };

  const handleStrategyChange = (nextStrategy: StrategyName) => {
    setStrategy(nextStrategy);
    resetEngineWith(scenarioId, nextStrategy, seed, casBackoffMode);
  };

  const handleCasBackoffModeChange = (nextMode: CasBackoffMode) => {
    setCasBackoffMode(nextMode);
    resetEngineWith(scenarioId, strategy, seed, nextMode);
  };

  const handleSeedChange = (nextSeed: number) => {
    setSeed(nextSeed);
    resetEngineWith(scenarioId, strategy, nextSeed, casBackoffMode);
  };

  const handleStart = () => {
    if (!snapshot.detectors.deadlocked) {
      setIsRunning(true);
    }
  };

  const handlePause = () => {
    setIsRunning(false);
  };

  const handleStep = () => {
    setIsRunning(false);
    const engine = engineRef.current!;
    // Advance outside of React state updater functions so React StrictMode never double-steps
    const nextSnapshot = engine.step();
    const nextEvents = engine.getEventLog();
    setSnapshot(nextSnapshot);
    setEvents(nextEvents);
  };

  const handleReset = () => {
    resetEngineWith(scenarioId, strategy, seed, casBackoffMode);
  };

  // Playback timer effect with full cleanup to prevent duplicate intervals in React StrictMode
  useEffect(() => {
    if (!isRunning) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      const engine = engineRef.current;
      if (!engine) {
        return;
      }
      const nextSnapshot = engine.step();
      const nextEvents = engine.getEventLog();
      setSnapshot(nextSnapshot);
      setEvents(nextEvents);

      if (nextSnapshot.detectors.deadlocked) {
        setIsRunning(false);
      }
    }, speedMs);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [isRunning, speedMs]);

  const activeScenario = getScenarioPreset(scenarioId);

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="header-title-group">
          <h1>Dining Philosophers OS Concurrency Simulator</h1>
          <p>
            Deterministic tick-based simulation comparing Naive, Counting Semaphore (N−1),
            Monitor (test(i)), and Lock-free (simulated CAS) synchronization.
          </p>
        </div>
        <div className="header-summary-badges">
          <span className="summary-badge">
            Tick: <strong>{snapshot.tick}</strong>
          </span>
          <span className="summary-badge">
            Meals Eaten: <strong>{snapshot.totalMealsEaten}</strong>
          </span>
          <span className="summary-badge">
            Meals Completed: <strong>{snapshot.totalMealsCompleted}</strong>
          </span>
        </div>
      </header>

      {/* Interactive Controls */}
      <Controls
        scenarioId={scenarioId}
        strategy={strategy}
        casBackoffMode={casBackoffMode}
        seed={seed}
        speedMs={speedMs}
        isRunning={isRunning}
        isDeadlocked={snapshot.detectors.deadlocked}
        tick={snapshot.tick}
        onScenarioChange={handleScenarioChange}
        onStrategyChange={handleStrategyChange}
        onCasBackoffModeChange={handleCasBackoffModeChange}
        onSeedChange={handleSeedChange}
        onSpeedChange={setSpeedMs}
        onStart={handleStart}
        onPause={handlePause}
        onStep={handleStep}
        onReset={handleReset}
      />

      {/* Detector Alert Banners (Deadlock, Threshold Starvation, Suspected Livelock) */}
      <DetectorBanners snapshot={snapshot} />

      {/* SVG Dining Table + Per-Philosopher Metrics Table */}
      <SimulationTable snapshot={snapshot} />

      {/* Strategy Internal State + Append-Only Event Log */}
      <div className="bottom-Split-grid">
        <StrategyDetails snapshot={snapshot} />
        <EventLog events={events} />
      </div>

      {/* Headless Cross-Strategy Comparison Table */}
      <ComparisonPanel scenario={activeScenario} seed={seed} />
    </main>
  );
}

export function DetectorBanners({ snapshot }: { readonly snapshot: SimulationSnapshot }) {
  const { deadlocked, deadlockReason, starvationDetected, starvationReason, livelockDetected, livelockReason } =
    snapshot.detectors;

  if (!deadlocked && !starvationDetected && !livelockDetected) {
    return null;
  }

  return (
    <section className="detector-banners" aria-label="Concurrency Detector Alerts" role="alert">
      {deadlocked && (
        <div className="banner banner-deadlock" data-detector="deadlock">
          <div className="banner-title">
            DEADLOCK DETECTED — Circular Wait &amp; Four Coffman Conditions Hold
          </div>
          <p className="banner-body">{deadlockReason}</p>
        </div>
      )}

      {starvationDetected && (
        <div className="banner banner-starvation" data-detector="starvation">
          <div className="banner-title">
            STARVATION ALERT — <span>starvation detected by threshold</span> (≥
            {snapshot.config.starvationThresholdTicks} wait ticks)
          </div>
          <p className="banner-body">{starvationReason}</p>
        </div>
      )}

      {livelockDetected && (
        <div className="banner banner-livelock" data-detector="livelock">
          <div className="banner-title">
            SUSPECTED LIVELOCK — Active CAS Retries &amp; Rollbacks With Zero Meals in Window (
            {snapshot.config.livelockWindowTicks} ticks)
          </div>
          <p className="banner-body">{livelockReason}</p>
        </div>
      )}
    </section>
  );
}
