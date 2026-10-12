import {
  ForkSnapshot,
  PhilosopherSnapshot,
  PhilosopherState,
  SimulationSnapshot,
} from '../engine/types';

export interface SimulationTableProps {
  readonly snapshot: SimulationSnapshot;
}

interface Point {
  readonly x: number;
  readonly y: number;
}

const CENTER_X = 310;
const CENTER_Y = 300;
const TABLE_RADIUS = 135;
const PHILOSOPHER_RADIUS = 212;
const FORK_REST_RADIUS = 112;
const FORK_HELD_RADIUS = 166;

export const STATE_COLORS: Readonly<
  Record<
    PhilosopherState,
    {
      readonly fill: string;
      readonly stroke: string;
      readonly badgeBg: string;
      readonly text: string;
    }
  >
> = {
  Thinking: {
    fill: '#0f2942',
    stroke: '#38bdf8',
    badgeBg: '#0284c7',
    text: '#e0f2fe',
  },
  Hungry: {
    fill: '#3b2506',
    stroke: '#fbbf24',
    badgeBg: '#d97706',
    text: '#fef3c7',
  },
  Waiting: {
    fill: '#3f1121',
    stroke: '#fb7185',
    badgeBg: '#e11d48',
    text: '#ffe4e6',
  },
  Eating: {
    fill: '#063224',
    stroke: '#34d399',
    badgeBg: '#059669',
    text: '#d1fae5',
  },
};

function polarToCartesian(cx: number, cy: number, radius: number, angleRad: number): Point {
  return {
    x: Number((cx + radius * Math.cos(angleRad)).toFixed(2)),
    y: Number((cy + radius * Math.sin(angleRad)).toFixed(2)),
  };
}

/**
 * Angle for philosopher i (P0 at top 12 o'clock, proceeding clockwise).
 */
function getPhilosopherAngle(id: number, count: number): number {
  return -Math.PI / 2 + (2 * Math.PI * id) / count;
}

/**
 * Fork i is shared by philosopher i (leftForkId = i) and philosopher (i - 1 + N) % N (rightForkId = i).
 * Placing fork i at angle(P_i) - pi/N puts Fork i halfway between P_{(i-1+N)%N} and P_i,
 * so every philosopher i sits directly between Fork i (counter-clockwise) and Fork (i+1)%N (clockwise).
 */
function getForkRestAngle(forkId: number, count: number): number {
  return getPhilosopherAngle(forkId, count) - Math.PI / count;
}

function getForkPosition(fork: ForkSnapshot, count: number): {
  readonly x: number;
  readonly y: number;
  readonly rotationDeg: number;
} {
  const restAngle = getForkRestAngle(fork.id, count);
  if (fork.ownerId === null) {
    const pt = polarToCartesian(CENTER_X, CENTER_Y, FORK_REST_RADIUS, restAngle);
    const rotationDeg = Number(((restAngle * 180) / Math.PI + 90).toFixed(1));
    return { x: pt.x, y: pt.y, rotationDeg };
  }

  const ownerAngle = getPhilosopherAngle(fork.ownerId, count);
  // Offset slightly toward the fork's side of the owner so left and right forks sit on either side of the philosopher
  const angularOffset = fork.id === fork.ownerId ? -0.19 : 0.19;
  const targetAngle = ownerAngle + angularOffset;
  const pt = polarToCartesian(CENTER_X, CENTER_Y, FORK_HELD_RADIUS, targetAngle);
  const rotationDeg = Number(((targetAngle * 180) / Math.PI + 90).toFixed(1));
  return { x: pt.x, y: pt.y, rotationDeg };
}

function formatPhilosopherTimer(phil: PhilosopherSnapshot): string {
  if (phil.state === 'Thinking') {
    return `Think: ${phil.remainingStateTicks}t`;
  }
  if (phil.state === 'Eating') {
    return `Eat: ${phil.remainingStateTicks}t`;
  }
  return `Wait: ${phil.currentWaitTicks}t`;
}

export function SimulationTable({ snapshot }: SimulationTableProps) {
  const count = snapshot.philosophers.length;
  const starvedSet = new Set(snapshot.detectors.starvedPhilosopherIds);

  return (
    <div className="simulation-visual-layout">
      {/* Left column: SVG Circular Dining Table */}
      <section className="panel svg-table-panel" aria-label="Dining Table Visualization">
        <div className="panel-header-row">
          <h2 className="panel-title">Circular Dining Table (N = {count})</h2>
          <div className="state-legend" aria-label="Philosopher state color legend">
            {(['Thinking', 'Hungry', 'Waiting', 'Eating'] as const).map((st) => (
              <span key={st} className="legend-item">
                <span
                  className="legend-dot"
                  style={{
                    backgroundColor: STATE_COLORS[st].stroke,
                  }}
                />
                {st}
              </span>
            ))}
          </div>
        </div>

        <div className="svg-container">
          <svg
            viewBox="0 0 620 600"
            className="dining-table-svg"
            role="img"
            aria-label={`Dining Philosophers table at tick ${snapshot.tick}`}
          >
            <defs>
              <radialGradient id="tableSurfaceGrad" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#1e293b" />
                <stop offset="100%" stopColor="#0f172a" />
              </radialGradient>
              <marker
                id="deadlockArrow"
                viewBox="0 0 10 10"
                refX="7"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M 0 1 L 10 5 L 0 9 z" fill="#f43f5e" />
              </marker>
            </defs>

            {/* Outer Halo Ring */}
            <circle
              cx={CENTER_X}
              cy={CENTER_Y}
              r={PHILOSOPHER_RADIUS}
              fill="none"
              stroke="#1e293b"
              strokeWidth="2"
              strokeDasharray="6 6"
            />

            {/* Central Dining Table */}
            <circle
              cx={CENTER_X}
              cy={CENTER_Y}
              r={TABLE_RADIUS}
              fill="url(#tableSurfaceGrad)"
              stroke={snapshot.detectors.deadlocked ? '#f43f5e' : '#334155'}
              strokeWidth={snapshot.detectors.deadlocked ? '4' : '3'}
            />

            {/* Center Table Status Readout */}
            <g className="table-center-info" textAnchor="middle">
              <text x={CENTER_X} y={CENTER_Y - 28} className="svg-center-label">
                STRATEGY: {snapshot.config.strategy.toUpperCase()}
              </text>
              <text x={CENTER_X} y={CENTER_Y + 4} className="svg-center-tick">
                Tick {snapshot.tick}
              </text>
              <text x={CENTER_X} y={CENTER_Y + 28} className="svg-center-meals">
                Meals Completed: {snapshot.totalMealsCompleted}
              </text>
              {snapshot.detectors.deadlocked && (
                <text x={CENTER_X} y={CENTER_Y + 50} className="svg-center-alert">
                  DEADLOCKED
                </text>
              )}
              {!snapshot.detectors.deadlocked && snapshot.detectors.livelockDetected && (
                <text x={CENTER_X} y={CENTER_Y + 50} className="svg-center-warning">
                  SUSPECTED LIVELOCK
                </text>
              )}
            </g>

            {/* Fork Ownership Tether Lines */}
            {snapshot.forks.map((fork) => {
              if (fork.ownerId === null) {
                return null;
              }
              const ownerAngle = getPhilosopherAngle(fork.ownerId, count);
              const ownerPt = polarToCartesian(
                CENTER_X,
                CENTER_Y,
                PHILOSOPHER_RADIUS,
                ownerAngle
              );
              const forkPos = getForkPosition(fork, count);
              const ownerState = snapshot.philosophers[fork.ownerId]?.state ?? 'Waiting';
              const strokeColor = STATE_COLORS[ownerState].stroke;

              return (
                <line
                  key={`tether-${fork.id}`}
                  x1={ownerPt.x}
                  y1={ownerPt.y}
                  x2={forkPos.x}
                  y2={forkPos.y}
                  stroke={strokeColor}
                  strokeWidth="2.5"
                  strokeDasharray={ownerState === 'Eating' ? undefined : '4 3'}
                  className="fork-tether-line"
                />
              );
            })}

            {/* Circular Wait Arrows when Deadlocked */}
            {snapshot.detectors.deadlocked &&
              snapshot.philosophers.map((phil) => {
                const nextId = (phil.id + 1) % count;
                const a1 = getPhilosopherAngle(phil.id, count) + 0.24;
                const a2 = getPhilosopherAngle(nextId, count) - 0.24;
                const p1 = polarToCartesian(CENTER_X, CENTER_Y, PHILOSOPHER_RADIUS - 6, a1);
                const p2 = polarToCartesian(CENTER_X, CENTER_Y, PHILOSOPHER_RADIUS - 6, a2);
                return (
                  <line
                    key={`deadlock-edge-${phil.id}`}
                    x1={p1.x}
                    y1={p1.y}
                    x2={p2.x}
                    y2={p2.y}
                    stroke="#f43f5e"
                    strokeWidth="2.5"
                    markerEnd="url(#deadlockArrow)"
                  />
                );
              })}

            {/* Five Forks */}
            {snapshot.forks.map((fork) => {
              const pos = getForkPosition(fork, count);
              const isHeld = fork.ownerId !== null;
              return (
                <g
                  key={fork.id}
                  className={`svg-fork-group ${isHeld ? 'fork-held' : 'fork-free'}`}
                  style={{
                    transform: `translate(${pos.x}px, ${pos.y}px)`,
                  }}
                  data-fork-id={fork.id}
                  data-owner-id={fork.ownerId ?? 'free'}
                >
                  <circle
                    cx={0}
                    cy={0}
                    r={18}
                    fill={isHeld ? '#1e293b' : '#0f172a'}
                    stroke={isHeld ? '#fbbf24' : '#64748b'}
                    strokeWidth={isHeld ? '2.5' : '1.75'}
                  />
                  {/* Stylized Fork Icon */}
                  <g transform={`rotate(${pos.rotationDeg})`}>
                    <line
                      x1={0}
                      y1={-2}
                      x2={0}
                      y2={9}
                      stroke={isHeld ? '#fde68a' : '#cbd5e1'}
                      strokeWidth="2"
                      strokeLinecap="round"
                    />
                    <line
                      x1={-4}
                      y1={-8}
                      x2={-4}
                      y2={-2}
                      stroke={isHeld ? '#fde68a' : '#cbd5e1'}
                      strokeWidth="1.5"
                      strokeLinecap="round"
                    />
                    <line
                      x1={0}
                      y1={-9}
                      x2={0}
                      y2={-2}
                      stroke={isHeld ? '#fde68a' : '#cbd5e1'}
                      strokeWidth="1.5"
                      strokeLinecap="round"
                    />
                    <line
                      x1={4}
                      y1={-8}
                      x2={4}
                      y2={-2}
                      stroke={isHeld ? '#fde68a' : '#cbd5e1'}
                      strokeWidth="1.5"
                      strokeLinecap="round"
                    />
                    <line
                      x1={-4}
                      y1={-2}
                      x2={4}
                      y2={-2}
                      stroke={isHeld ? '#fde68a' : '#cbd5e1'}
                      strokeWidth="1.5"
                    />
                  </g>
                  <text
                    x={0}
                    y={29}
                    textAnchor="middle"
                    className="svg-fork-label"
                    fill={isHeld ? '#fde68a' : '#94a3b8'}
                  >
                    F{fork.id} ({isHeld ? `P${fork.ownerId}` : 'free'})
                  </text>
                </g>
              );
            })}

            {/* Five Philosophers */}
            {snapshot.philosophers.map((phil) => {
              const angle = getPhilosopherAngle(phil.id, count);
              const pt = polarToCartesian(CENTER_X, CENTER_Y, PHILOSOPHER_RADIUS, angle);
              const palette = STATE_COLORS[phil.state];
              const isStarved = starvedSet.has(phil.id);
              const heldLabel =
                phil.heldForkIds.length > 0
                  ? phil.heldForkIds.map((id) => `F${id}`).join(', ')
                  : 'none';

              return (
                <g
                  key={phil.id}
                  className={`svg-philosopher-group state-${phil.state.toLowerCase()}`}
                  transform={`translate(${pt.x}, ${pt.y})`}
                  data-philosopher-id={phil.id}
                  data-state={phil.state}
                >
                  {/* Starvation or Eating outer ring */}
                  {(isStarved || phil.state === 'Eating') && (
                    <circle
                      cx={0}
                      cy={0}
                      r={54}
                      fill="none"
                      stroke={isStarved ? '#f43f5e' : '#34d399'}
                      strokeWidth="2.5"
                      strokeDasharray={isStarved ? '5 3' : undefined}
                    />
                  )}

                  {/* Main Philosopher Seat Circle */}
                  <circle
                    cx={0}
                    cy={0}
                    r={46}
                    fill={palette.fill}
                    stroke={palette.stroke}
                    strokeWidth="3"
                    className="philosopher-circle"
                  />

                  {/* Philosopher ID & State */}
                  <text
                    x={0}
                    y={-18}
                    textAnchor="middle"
                    className="svg-phil-title"
                    fill="#f8fafc"
                  >
                    P{phil.id}
                  </text>
                  <text
                    x={0}
                    y={-2}
                    textAnchor="middle"
                    className="svg-phil-state"
                    fill={palette.stroke}
                  >
                    {phil.state}
                  </text>

                  {/* Timer / Wait counter */}
                  <text
                    x={0}
                    y={14}
                    textAnchor="middle"
                    className="svg-phil-meta"
                    fill={palette.text}
                  >
                    {formatPhilosopherTimer(phil)}
                  </text>

                  {/* Held Forks & Meals */}
                  <text
                    x={0}
                    y={29}
                    textAnchor="middle"
                    className="svg-phil-forks"
                    fill="#cbd5e1"
                  >
                    Forks: {heldLabel}
                  </text>

                  {/* Meals Pill below circle */}
                  <g transform="translate(0, 58)">
                    <rect
                      x={-44}
                      y={-11}
                      width={88}
                      height={20}
                      rx={10}
                      fill="#1e293b"
                      stroke="#475569"
                      strokeWidth="1"
                    />
                    <text
                      x={0}
                      y={3}
                      textAnchor="middle"
                      className="svg-phil-meals-badge"
                      fill="#e2e8f0"
                    >
                      Meals: {phil.mealsCompleted}
                    </text>
                  </g>

                  {/* Explicit Threshold Starvation Badge */}
                  {isStarved && (
                    <g transform="translate(0, -60)">
                      <rect
                        x={-62}
                        y={-11}
                        width={124}
                        height={20}
                        rx={10}
                        fill="#881337"
                        stroke="#fb7185"
                        strokeWidth="1.5"
                      />
                      <text
                        x={0}
                        y={3}
                        textAnchor="middle"
                        className="svg-starved-badge"
                        fill="#ffe4e6"
                      >
                        STARVED (≥{snapshot.config.starvationThresholdTicks}t)
                      </text>
                    </g>
                  )}
                </g>
              );
            })}
          </svg>
        </div>
      </section>

      {/* Right column: Per-Philosopher Status & Metrics Table */}
      <section
        className="panel philosopher-table-panel"
        aria-label="Per-Philosopher Status and Metrics"
      >
        <div className="panel-header-row">
          <h2 className="panel-title">Per-Philosopher Status &amp; Wait Metrics</h2>
          <span className="panel-subtitle">
            Starvation threshold: ≥{snapshot.config.starvationThresholdTicks} wait ticks
          </span>
        </div>

        <div className="table-responsive">
          <table className="status-table" aria-label="Philosopher status table">
            <thead>
              <tr>
                <th>Phil</th>
                <th>State</th>
                <th>L / R Forks</th>
                <th>Held Forks</th>
                <th>Curr Wait</th>
                <th>Max Wait</th>
                <th>Total Wait</th>
                <th>Meals</th>
                <th>Avg Wait</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.philosophers.map((phil) => {
                const isStarved = starvedSet.has(phil.id);
                return (
                  <tr
                    key={phil.id}
                    className={isStarved ? 'row-starved' : undefined}
                    data-row-philosopher={phil.id}
                  >
                    <td>
                      <strong>P{phil.id}</strong>
                    </td>
                    <td>
                      <span
                        className={`state-badge state-badge-${phil.state.toLowerCase()}`}
                      >
                        {phil.state}
                      </span>
                      {isStarved && (
                        <span
                          className="threshold-flag-pill"
                          title="starvation detected by threshold"
                        >
                          starvation detected by threshold
                        </span>
                      )}
                    </td>
                    <td className="mono-cell">
                      F{phil.leftForkId} / F{phil.rightForkId}
                    </td>
                    <td className="mono-cell">
                      {phil.heldForkIds.length > 0
                        ? phil.heldForkIds.map((f) => `F${f}`).join(', ')
                        : '—'}
                    </td>
                    <td className="mono-cell">{phil.currentWaitTicks}t</td>
                    <td className="mono-cell">{phil.longestWaitTicks}t</td>
                    <td className="mono-cell">{phil.totalWaitTicks}t</td>
                    <td className="mono-cell">
                      <strong>{phil.mealsCompleted}</strong>
                    </td>
                    <td className="mono-cell">{phil.averageWaitPerMeal.toFixed(2)}t</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
