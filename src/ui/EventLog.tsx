import { useState } from 'react';
import { SimulationEvent, SimulationEventType } from '../engine/types';

export interface EventLogProps {
  readonly events: readonly SimulationEvent[];
}

type EventCategoryFilter = 'all' | 'alerts' | 'meals' | 'synchronization';

function getEventTone(type: SimulationEventType): string {
  switch (type) {
    case 'DEADLOCK_DETECTED':
    case 'INVARIANT_VIOLATION':
      return 'event-critical';
    case 'STARVATION_DETECTED':
    case 'LIVELOCK_DETECTED':
      return 'event-warning';
    case 'STARVATION_ENDED':
    case 'MEAL_STARTED':
    case 'MEAL_COMPLETED':
      return 'event-success';
    case 'FORK_ACQUIRED':
    case 'FORK_RELEASED':
    case 'SEMAPHORE_ACQUIRED':
    case 'SEMAPHORE_RELEASED':
    case 'MONITOR_SIGNAL':
      return 'event-info';
    case 'FORK_DENIED':
    case 'SEMAPHORE_QUEUED':
    case 'MONITOR_WAIT':
    case 'CAS_ROLLBACK':
    case 'CAS_BACKOFF':
      return 'event-muted-warn';
    default:
      return 'event-neutral';
  }
}

function matchesCategory(evt: SimulationEvent, filter: EventCategoryFilter): boolean {
  if (filter === 'all') {
    return true;
  }
  if (filter === 'alerts') {
    return (
      evt.type === 'DEADLOCK_DETECTED' ||
      evt.type === 'STARVATION_DETECTED' ||
      evt.type === 'STARVATION_ENDED' ||
      evt.type === 'LIVELOCK_DETECTED' ||
      evt.type === 'INVARIANT_VIOLATION'
    );
  }
  if (filter === 'meals') {
    return evt.type === 'MEAL_STARTED' || evt.type === 'MEAL_COMPLETED';
  }
  return (
    evt.type === 'FORK_ACQUIRED' ||
    evt.type === 'FORK_RELEASED' ||
    evt.type === 'FORK_DENIED' ||
    evt.type === 'SEMAPHORE_ACQUIRED' ||
    evt.type === 'SEMAPHORE_RELEASED' ||
    evt.type === 'SEMAPHORE_QUEUED' ||
    evt.type === 'MONITOR_TEST' ||
    evt.type === 'MONITOR_WAIT' ||
    evt.type === 'MONITOR_SIGNAL' ||
    evt.type === 'CAS_ATTEMPT' ||
    evt.type === 'CAS_ROLLBACK' ||
    evt.type === 'CAS_BACKOFF'
  );
}

export function EventLog({ events }: EventLogProps) {
  const [filter, setFilter] = useState<EventCategoryFilter>('all');

  const filteredEvents = events.filter((evt) => matchesCategory(evt, filter));
  // Display newest events first while keeping deterministic event IDs visible
  const reversedEvents = [...filteredEvents].reverse().slice(0, 120);

  return (
    <section className="panel event-log-panel" aria-label="Simulation Event Log">
      <div className="panel-header-row">
        <div>
          <h2 className="panel-title">Append-Only Event Log</h2>
          <span className="panel-subtitle">
            Showing {reversedEvents.length} of {filteredEvents.length} matching events (total:{' '}
            {events.length})
          </span>
        </div>

        <div className="event-filter-group" role="group" aria-label="Event log category filter">
          {(
            [
              { id: 'all', label: 'All Events' },
              { id: 'alerts', label: 'Detectors & Alerts' },
              { id: 'meals', label: 'Meals' },
              { id: 'synchronization', label: 'Forks / Locks / CAS' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`btn btn-xs ${
                filter === tab.id ? 'btn-filter-active' : 'btn-secondary'
              }`}
              onClick={() => setFilter(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="event-log-list" role="log" aria-live="polite">
        {reversedEvents.length === 0 ? (
          <p className="empty-log-message">No events match the selected filter.</p>
        ) : (
          reversedEvents.map((evt) => (
            <div
              key={evt.id}
              className={`event-log-item ${getEventTone(evt.type)}`}
              data-event-id={evt.id}
              data-event-type={evt.type}
            >
              <div className="event-item-meta">
                <span className="event-id">#{evt.id}</span>
                <span className="event-tick">T={evt.tick}</span>
                <span className="event-type-badge">{evt.type}</span>
                {evt.philosopherId !== undefined && (
                  <span className="event-entity-tag">P{evt.philosopherId}</span>
                )}
                {evt.forkId !== undefined && (
                  <span className="event-entity-tag">F{evt.forkId}</span>
                )}
              </div>
              <div className="event-item-reason">{evt.reason}</div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
