import { useMemo, useState } from 'react';
import { ScenarioPreset } from '../engine/types';
import { runStrategyBatchComparison, StrategyRunSpec } from '../runner/batchRunner';
import { formatComparisonRows } from '../runner/formatResults';

export interface ComparisonPanelProps {
  readonly scenario: ScenarioPreset;
  readonly seed: number;
}

const COMPARISON_SPECS: readonly StrategyRunSpec[] = [
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
          </span>
        </div>

        <div className="comparison-controls">
          <label htmlFor="comparison-ticks-select" className="control-label-inline">
            Horizon:
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
              <tr key={row.strategyLabel}>
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
    </section>
  );
}
