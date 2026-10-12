import { useMemo, useState } from 'react';
import { ScenarioPreset } from '../engine/types';
import { runStrategyBatchComparison, StrategyRunSpec } from '../runner/batchRunner';
import { formatComparisonRows } from '../runner/formatResults';

export interface ComparisonPanelProps {
  readonly scenario: ScenarioPreset;
  readonly seed: number;
}

export const COMPARISON_SPECS: readonly StrategyRunSpec[] = [
  { strategy: 'naive', label: 'Naive (Left → Right)' },
  { strategy: 'semaphore', label: 'Semaphore (N−1 Permits, FIFO)' },
  { strategy: 'monitor', label: 'Monitor (test(i) + Condition)' },
  {
    strategy: 'cas',
    casBackoffMode: 'fixed',
    label: 'Lock-free (simulated CAS — Fixed Back-off)',
  },
  {
    strategy: 'cas',
    casBackoffMode: 'random',
    label: 'Lock-free (simulated CAS — Seeded Random)',
  },
];

export interface StrategyTradeoffNote {
  readonly title: string;
  readonly mechanism: string;
  readonly tradeoff: string;
}

export const STRATEGY_TRADEOFF_NOTES: readonly StrategyTradeoffNote[] = [
  {
    title: 'Naive (Left → Right)',
    mechanism:
      'Acquires left fork first, then waits for right fork while holding left fork (hold-and-wait).',
    tradeoff:
      'Zero coordination overhead under staggered arrivals, but deadlocks immediately (0 meals) when all 5 philosophers become Hungry symmetrically.',
  },
  {
    title: 'Counting Semaphore (N−1 Permits + FIFO)',
    mechanism:
      'Limits concurrent fork contenders to N−1 = 4 room permits and queues the 5th philosopher in strict FIFO order.',
    tradeoff:
      'Prevents circular-wait deadlock and bounds queuing delay via FIFO handoff, at the cost of permit management and two-step fork acquisition.',
  },
  {
    title: 'Monitor (test(i) + Condition Variables)',
    mechanism:
      'pickup(i) and putdown(i) evaluate test(i) inside a monitor: both forks are allocated atomically only when neither neighbor is Eating.',
    tradeoff:
      'Eliminates hold-and-wait (never holds a single fork while waiting) and achieves high throughput, but without a FIFO queue fast-cycling neighbors can starve a middle philosopher.',
  },
  {
    title: 'Lock-free (simulated CAS — Fixed vs. Random Back-off)',
    mechanism:
      'Attempts single-fork CAS on left fork, then right fork on the next tick; rolls back left fork and backs off if right-fork CAS fails.',
    tradeoff:
      'Avoids passive deadlock because failed second-fork claims release the first fork, but symmetric fixed back-off causes synchronized livelock until seeded randomized back-off breaks symmetry.',
  },
];

export function ComparisonPanel({ scenario, seed }: ComparisonPanelProps) {
  const [ticksToRun, setTicksToRun] = useState<number>(60);

  const formattedRows = useMemo(() => {
    const rawRows = runStrategyBatchComparison({
      scenario,
      seed,
      ticks: ticksToRun,
      strategies: COMPARISON_SPECS,
    });
    return formatComparisonRows(rawRows);
  }, [scenario, seed, ticksToRun]);

  return (
    <section
      className="panel comparison-panel"
      aria-label="Cross-Strategy Batch Comparison Table"
    >
      <div className="panel-header-row">
        <div>
          <h2 className="panel-title">
            Cross-Strategy Batch Comparison ({scenario.name}, Seed {seed})
          </h2>
          <span className="panel-subtitle">
            Computed live via headless deterministic engine runs over {ticksToRun} ticks
            (starvation threshold: ≥{scenario.config.starvationThresholdTicks ?? 18} wait ticks,
            livelock window: {scenario.config.livelockWindowTicks ?? 12} ticks)
          </span>
        </div>

        <div className="comparison-controls">
          <label htmlFor="comparison-ticks-select" className="control-label-inline">
            Tick Count:
          </label>
          <select
            id="comparison-ticks-select"
            aria-label="Comparison tick count"
            className="control-select control-select-sm"
            value={ticksToRun}
            onChange={(e) => setTicksToRun(Number(e.target.value))}
          >
            <option value={30}>30 ticks</option>
            <option value={60}>60 ticks</option>
            <option value={100}>100 ticks</option>
          </select>
        </div>
      </div>

      <div className="table-responsive">
        <table className="status-table comparison-table" aria-label="Strategy comparison table">
          <thead>
            <tr>
              <th>Strategy</th>
              <th>Deadlock</th>
              <th>Starvation (Threshold)</th>
              <th>Suspected Livelock</th>
              <th>Avg Wait</th>
              <th>Max Wait</th>
              <th>Meals Completed</th>
              <th>Min / Max Meals</th>
              <th>Jain Fairness</th>
              <th>CAS Retries / Rollbacks</th>
            </tr>
          </thead>
          <tbody>
            {formattedRows.map((row) => (
              <tr key={row.strategyLabel} data-comparison-strategy={row.strategyLabel}>
                <td>
                  <strong>{row.strategyLabel}</strong>
                </td>
                <td>
                  <span
                    className={`table-flag ${
                      row.raw.deadlocked ? 'flag-danger' : 'flag-ok'
                    }`}
                  >
                    {row.deadlock}
                  </span>
                </td>
                <td>
                  <span
                    className={`table-flag ${
                      row.raw.starvationDetected ? 'flag-warning' : 'flag-ok'
                    }`}
                  >
                    {row.starvation}
                  </span>
                </td>
                <td>
                  <span
                    className={`table-flag ${
                      row.raw.livelockSuspected ? 'flag-warning' : 'flag-ok'
                    }`}
                  >
                    {row.livelock}
                  </span>
                </td>
                <td className="mono-cell">{row.averageWait}</td>
                <td className="mono-cell">{row.maxWait}</td>
                <td className="mono-cell">
                  <strong>{row.mealsCompleted}</strong>
                </td>
                <td className="mono-cell">{row.minMaxMeals}</td>
                <td className="mono-cell">{row.fairness}</td>
                <td className="mono-cell">{row.casRetries}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Explicit Methodological & Modeling Notes */}
      <div className="comparison-notes-callout" aria-label="Detector and Modeling Notes">
        <p className="comparison-note-item">
          <strong>Starvation Note (Threshold-Detected):</strong> Starvation is reported as{' '}
          <code>starvation detected by threshold</code> when a philosopher waits at least{' '}
          <code>{scenario.config.starvationThresholdTicks ?? 18}</code> consecutive ticks while
          its neighbors complete meals during that interval. In a finite simulation run, a
          threshold flag measures severe unfairness over a bounded window rather than a
          mathematical proof of infinite future waiting.
        </p>
        <p className="comparison-note-item">
          <strong>Simulated CAS Note (Model vs. Hardware Atomics):</strong>{' '}
          <code>Lock-free (simulated CAS)</code> models single-fork compare-and-swap semantics (
          <code>CAS(fork[f], null → i)</code>) one fork at a time in discrete deterministic
          ticks with rollback and back-off. It is an algorithmic OS model and not real hardware
          atomic CPU instruction execution (such as <code>LOCK CMPXCHG</code> across kernel
          threads).
        </p>
      </div>

      {/* Static Strategy Trade-Off Cards */}
      <div className="tradeoffs-grid" aria-label="Strategy Trade-off Summary">
        {STRATEGY_TRADEOFF_NOTES.map((item) => (
          <article key={item.title} className="tradeoff-card">
            <h3 className="tradeoff-title">{item.title}</h3>
            <p className="tradeoff-text">
              <strong>Mechanism:</strong> {item.mechanism}
            </p>
            <p className="tradeoff-text">
              <strong>Result &amp; Trade-off:</strong> {item.tradeoff}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}
