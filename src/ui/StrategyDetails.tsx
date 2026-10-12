import { CasDebugState } from '../engine/strategies/cas';
import { MonitorDebugState } from '../engine/strategies/monitor';
import { SemaphoreDebugState } from '../engine/strategies/semaphore';
import { SimulationSnapshot } from '../engine/types';

export interface StrategyDetailsProps {
  readonly snapshot: SimulationSnapshot;
}

export function StrategyDetails({ snapshot }: StrategyDetailsProps) {
  const strategy = snapshot.config.strategy;
  const rawState = snapshot.strategyState;

  return (
    <section
      className="panel strategy-details-panel"
      aria-label="Synchronization Strategy Internals"
    >
      <div className="panel-header-row">
        <h2 className="panel-title">Strategy Internals ({strategy.toUpperCase()})</h2>
      </div>

      {strategy === 'naive' && (
        <div className="strategy-detail-body">
          <p className="strategy-explanation">
            <strong>Naive Two-Phase Fork Acquisition:</strong> Every Hungry philosopher first
            acquires their left fork <code>F_i</code>, then waits until a subsequent tick to
            request their right fork <code>F_(i+1)%N</code> while continuing to hold{' '}
            <code>F_i</code>. Because all four Coffman conditions can hold simultaneously,
            symmetric arrivals cause circular-wait deadlock.
          </p>
          <div className="detail-badges-row">
            {snapshot.forks.map((fork) => (
              <span key={fork.id} className="detail-chip">
                Fork F{fork.id}:{' '}
                <strong>{fork.ownerId !== null ? `Held by P${fork.ownerId}` : 'Free'}</strong>
              </span>
            ))}
          </div>
        </div>
      )}

      {strategy === 'semaphore' && rawState && (
        <SemaphoreInternals state={rawState as unknown as SemaphoreDebugState} />
      )}

      {strategy === 'monitor' && rawState && (
        <MonitorInternals state={rawState as unknown as MonitorDebugState} />
      )}

      {strategy === 'cas' && rawState && (
        <CasInternals state={rawState as unknown as CasDebugState} />
      )}
    </section>
  );
}

function SemaphoreInternals({ state }: { readonly state: SemaphoreDebugState }) {
  return (
    <div className="strategy-detail-body">
      <p className="strategy-explanation">
        <strong>Counting Semaphore (N−1 = {state.maxPermits} Room Permits):</strong> A
        philosopher must acquire a room permit before attempting left-then-right fork
        acquisition. When all {state.maxPermits} permits are held, additional hungry
        philosophers wait in a strict <strong>FIFO queue</strong>, breaking circular wait.
      </p>
      <div className="detail-metrics-grid">
        <div className="detail-stat-card">
          <span className="detail-stat-label">Available Permits</span>
          <strong className="detail-stat-value">
            {state.availablePermits} / {state.maxPermits}
          </strong>
        </div>
        <div className="detail-stat-card">
          <span className="detail-stat-label">Admitted (Holding Permit)</span>
          <strong className="detail-stat-value">
            {state.admittedPhilosophers.length > 0
              ? state.admittedPhilosophers.map((id) => `P${id}`).join(', ')
              : 'None'}
          </strong>
        </div>
        <div className="detail-stat-card">
          <span className="detail-stat-label">FIFO Wait Queue (Head → Tail)</span>
          <strong className="detail-stat-value">
            {state.queue.length > 0 ? state.queue.map((id) => `P${id}`).join(' → ') : 'Empty'}
          </strong>
        </div>
      </div>
    </div>
  );
}

function MonitorInternals({ state }: { readonly state: MonitorDebugState }) {
  return (
    <div className="strategy-detail-body">
      <p className="strategy-explanation">
        <strong>Monitor with test(i) &amp; Condition Variables:</strong>{' '}
        <code>pickup(i)</code> sets <code>state[i] = Hungry</code> and invokes{' '}
        <code>test(i)</code>, which atomically grants both neighboring forks only when neither
        neighbor is <code>Eating</code>. Otherwise <code>P_i</code> waits on condition variable{' '}
        <code>self[i]</code> until a neighbor calls <code>putdown()</code>.
      </p>
      <div className="detail-badges-row">
        {state.monitorStates.map((mState, id) => {
          const cond = state.conditionStates[id] ?? 'Idle';
          return (
            <span key={id} className="detail-chip">
              <strong>P{id}</strong>: monitor=<code>{mState}</code> | self[{id}]=
              <code>{cond}</code>
            </span>
          );
        })}
      </div>
    </div>
  );
}

function CasInternals({ state }: { readonly state: CasDebugState }) {
  return (
    <div className="strategy-detail-body">
      <p className="strategy-explanation">
        <strong>{state.algorithm}:</strong> {state.semanticsNote}
      </p>
      <div className="detail-metrics-grid">
        <div className="detail-stat-card">
          <span className="detail-stat-label">Back-off Policy</span>
          <strong className="detail-stat-value">
            {state.backoffMode === 'fixed'
              ? `Fixed (${state.fixedBackoffTicks}t)`
              : `Seeded Random (1..${state.maxRandomBackoffTicks}t)`}
          </strong>
        </div>
        <div className="detail-stat-card">
          <span className="detail-stat-label">CAS Attempts (OK / Fail)</span>
          <strong className="detail-stat-value">
            {state.totalAttempts} ({state.totalSuccesses} / {state.totalFailures})
          </strong>
        </div>
        <div className="detail-stat-card">
          <span className="detail-stat-label">Left-Fork Rollbacks</span>
          <strong className="detail-stat-value">{state.totalRollbacks}</strong>
        </div>
      </div>

      <div className="detail-badges-row">
        {state.backoffRemainingByPhilosopher.map((backoffTicks, id) => (
          <span key={id} className="detail-chip">
            <strong>P{id}</strong>: attempts={state.attemptsByPhilosopher[id] ?? 0}, rollbacks=
            {state.rollbacksByPhilosopher[id] ?? 0}, back-off={backoffTicks}t
          </span>
        ))}
      </div>
    </div>
  );
}
