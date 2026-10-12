import { CasBackoffMode, ScenarioPreset, StrategyName } from '../engine/types';
import { SCENARIO_PRESETS } from '../scenarios/presets';

export interface ControlsProps {
  readonly scenarioId: string;
  readonly strategy: StrategyName;
  readonly casBackoffMode: CasBackoffMode;
  readonly seed: number;
  readonly speedMs: number;
  readonly isRunning: boolean;
  readonly isDeadlocked: boolean;
  readonly tick: number;
  readonly onScenarioChange: (scenarioId: string) => void;
  readonly onStrategyChange: (strategy: StrategyName) => void;
  readonly onCasBackoffModeChange: (mode: CasBackoffMode) => void;
  readonly onSeedChange: (seed: number) => void;
  readonly onSpeedChange: (speedMs: number) => void;
  readonly onStart: () => void;
  readonly onPause: () => void;
  readonly onStep: () => void;
  readonly onReset: () => void;
}

export const STRATEGY_OPTIONS: ReadonlyArray<{
  readonly value: StrategyName;
  readonly label: string;
  readonly summary: string;
}> = [
  {
    value: 'naive',
    label: 'Naive (Left Fork, then Right Fork)',
    summary:
      'Each hungry philosopher grabs their left fork first and waits for their right fork while holding the left fork.',
  },
  {
    value: 'semaphore',
    label: 'Counting Semaphore (N-1 Permits + FIFO)',
    summary:
      'At most N-1 = 4 philosophers may hold room permits at once; 5th waits in a strict FIFO queue, preventing circular wait.',
  },
  {
    value: 'monitor',
    label: 'Monitor (test(i) + Condition Variables)',
    summary:
      'pickup(i) and putdown(i) coordinate via test(i): a philosopher acquires both forks atomically only when neither neighbor is Eating.',
  },
  {
    value: 'cas',
    label: 'Lock-free (simulated CAS)',
    summary:
      'Deterministic single-fork compare-and-swap per tick. If right-fork CAS fails, rolls back left fork and backs off (fixed vs. seeded random).',
  },
];

export const SPEED_PRESETS: ReadonlyArray<{
  readonly ms: number;
  readonly label: string;
}> = [
  { ms: 1000, label: '0.5x Slow (1000 ms/tick)' },
  { ms: 600, label: '1x Normal (600 ms/tick)' },
  { ms: 300, label: '2x Fast (300 ms/tick)' },
  { ms: 120, label: '5x Turbo (120 ms/tick)' },
];

export function Controls({
  scenarioId,
  strategy,
  casBackoffMode,
  seed,
  speedMs,
  isRunning,
  isDeadlocked,
  tick,
  onScenarioChange,
  onStrategyChange,
  onCasBackoffModeChange,
  onSeedChange,
  onSpeedChange,
  onStart,
  onPause,
  onStep,
  onReset,
}: ControlsProps) {
  const activeScenario: ScenarioPreset =
    SCENARIO_PRESETS.find((preset) => preset.id === scenarioId) ?? SCENARIO_PRESETS[0]!;
  const activeStrategyOption =
    STRATEGY_OPTIONS.find((opt) => opt.value === strategy) ?? STRATEGY_OPTIONS[0]!;

  const handleSeedInputChange = (raw: string) => {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed)) {
      onSeedChange(parsed);
    }
  };

  return (
    <section className="panel controls-panel" aria-label="Simulation Controls">
      <div className="controls-grid">
        {/* Scenario Preset Selector */}
        <div className="control-group">
          <label htmlFor="scenario-select" className="control-label">
            Scenario Preset
          </label>
          <select
            id="scenario-select"
            aria-label="Scenario preset"
            className="control-select"
            value={scenarioId}
            onChange={(e) => onScenarioChange(e.target.value)}
          >
            {SCENARIO_PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.name}
              </option>
            ))}
          </select>
          <p className="control-hint">{activeScenario.description}</p>
        </div>

        {/* Strategy Selector */}
        <div className="control-group">
          <label htmlFor="strategy-select" className="control-label">
            Synchronization Strategy
          </label>
          <select
            id="strategy-select"
            aria-label="Synchronization strategy"
            className="control-select"
            value={strategy}
            onChange={(e) => onStrategyChange(e.target.value as StrategyName)}
          >
            {STRATEGY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <p className="control-hint">{activeStrategyOption.summary}</p>
        </div>

        {/* CAS Back-off Mode & Seed Controls */}
        <div className="control-group control-group-compact">
          <div className="sub-control-row">
            <div className="sub-control">
              <label htmlFor="seed-input" className="control-label">
                PRNG Seed
              </label>
              <div className="seed-input-row">
                <input
                  id="seed-input"
                  type="number"
                  aria-label="Deterministic RNG seed"
                  className="control-input"
                  value={seed}
                  onChange={(e) => handleSeedInputChange(e.target.value)}
                />
                <button
                  type="button"
                  className="btn btn-secondary btn-xs"
                  onClick={() => onSeedChange(42)}
                  title="Reset seed to default 42"
                >
                  Seed 42
                </button>
              </div>
            </div>

            <div className="sub-control">
              <label htmlFor="speed-select" className="control-label">
                Tick Speed ({speedMs} ms)
              </label>
              <select
                id="speed-select"
                aria-label="Simulation speed"
                className="control-select"
                value={speedMs}
                onChange={(e) => onSpeedChange(Number(e.target.value))}
              >
                {SPEED_PRESETS.map((preset) => (
                  <option key={preset.ms} value={preset.ms}>
                    {preset.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {strategy === 'cas' && (
            <div className="cas-backoff-box">
              <label htmlFor="cas-backoff-select" className="control-label">
                Simulated CAS Back-off Mode
              </label>
              <select
                id="cas-backoff-select"
                aria-label="CAS back-off mode"
                className="control-select"
                value={casBackoffMode}
                onChange={(e) => onCasBackoffModeChange(e.target.value as CasBackoffMode)}
              >
                <option value="fixed">Fixed Back-off (2 ticks — demonstrates livelock)</option>
                <option value="random">
                  Seeded Randomized Back-off (1..5 ticks — breaks symmetry)
                </option>
              </select>
            </div>
          )}
        </div>
      </div>

      {/* Action Buttons & Live Status Bar */}
      <div className="playback-bar">
        <div className="playback-buttons" role="group" aria-label="Playback actions">
          <button
            type="button"
            className="btn btn-primary"
            aria-label="Start simulation"
            disabled={isRunning || isDeadlocked}
            onClick={onStart}
          >
            Start
          </button>
          <button
            type="button"
            className="btn btn-warning"
            aria-label="Pause simulation"
            disabled={!isRunning}
            onClick={onPause}
          >
            Pause
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            aria-label="Step one tick"
            onClick={onStep}
          >
            Step (+1 Tick)
          </button>
          <button
            type="button"
            className="btn btn-danger-outline"
            aria-label="Reset simulation"
            onClick={onReset}
          >
            Reset (Tick 0)
          </button>
        </div>

        <div className="playback-status" aria-live="polite">
          <span
            className={`status-pill ${
              isDeadlocked
                ? 'status-deadlocked'
                : isRunning
                  ? 'status-running'
                  : 'status-paused'
            }`}
          >
            {isDeadlocked ? 'Halted (Deadlock)' : isRunning ? 'Running' : 'Paused'}
          </span>
          <span className="tick-readout">
            Tick: <strong>{tick}</strong>
          </span>
          <span className="seed-readout">
            Seed: <strong>{seed}</strong>
          </span>
        </div>
      </div>
    </section>
  );
}
