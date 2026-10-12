import {
  PhilosopherState,
  ReadonlySimulationView,
  ResolvedSimulationConfig,
  Strategy,
  StrategyAction,
  StrategyEventDescriptor,
  StrategyStepResult,
} from '../types';

export type MonitorPhilosopherState = 'Thinking' | 'Hungry' | 'Eating';

export type ConditionVariableStatus = 'Idle' | 'Waiting' | 'Signaled';

export interface MonitorDebugState {
  readonly monitorStates: readonly MonitorPhilosopherState[];
  readonly conditionStates: readonly ConditionVariableStatus[];
  readonly waitingPhilosophers: readonly number[];
  readonly eatingPhilosophers: readonly number[];
  readonly forkOwners: readonly (number | null)[];
  readonly [key: string]: unknown;
}

/**
 * Monitor Strategy (Hoare/Dijkstra Monitor with test(i) and Per-Philosopher Condition Variables):
 * - Maintains monitor state per philosopher: 'Thinking' | 'Hungry' | 'Eating', plus per-philosopher
 *   condition variable waiting state (self[i]).
 * - pickup(i): marks monitorStates[i] = 'Hungry' and calls test(i). If test(i) does not transition
 *   philosopher i to 'Eating', philosopher i waits on condition variable self[i].
 * - test(i): grants atomic allocation of both neighboring forks and transitions monitorStates[i] to
 *   'Eating' if and only if monitorStates[i] === 'Hungry' and neither neighbor is 'Eating'.
 * - putdown(i): marks monitorStates[i] = 'Thinking' and calls test(leftNeighbor(i)) and
 *   test(rightNeighbor(i)) to wake any waiting neighbors whose both forks are now available.
 * - Intentionally does not add artificial FIFO queueing so the textbook monitor's high concurrency
 *   and potential for starvation under asymmetric timings can be observed.
 */
export class MonitorStrategy implements Strategy {
  public readonly name = 'monitor' as const;
  public readonly description =
    'Monitor with test(i) and per-philosopher condition variables; acquires both forks atomically when neither neighbor is eating.';

  private philosopherCount = 5;
  private monitorStates: MonitorPhilosopherState[] = [];
  private conditionStates: ConditionVariableStatus[] = [];
  private forkOwners: (number | null)[] = [];

  constructor(philosopherCount = 5) {
    this.configureCount(philosopherCount);
  }

  public reset(config?: ResolvedSimulationConfig): void {
    const count = config?.philosopherCount ?? this.philosopherCount;
    this.configureCount(count);
    this.monitorStates = Array.from({ length: count }, (_, id) => {
      const initial = config?.initialStates?.[id];
      return initial === 'Hungry' || initial === 'Waiting' ? 'Thinking' : 'Thinking';
    });
    this.conditionStates = Array.from({ length: count }, () => 'Idle');
    this.forkOwners = Array.from({ length: count }, () => null);
  }

  public decide(view: ReadonlySimulationView): StrategyStepResult {
    const actions: StrategyAction[] = [];
    const events: StrategyEventDescriptor[] = [];

    if (view.philosophers.length !== this.philosopherCount) {
      this.configureCount(view.philosophers.length);
    }

    // Synchronize initial fork ownership from the engine view
    const reservedForkOwners = new Map<number, number>();
    this.forkOwners = view.forks.map((f) => {
      if (f.ownerId !== null) {
        reservedForkOwners.set(f.id, f.ownerId);
      }
      return f.ownerId;
    });

    // Synchronize any philosopher currently Eating in the engine view
    for (const phil of view.philosophers) {
      if (phil.state === 'Eating') {
        this.monitorStates[phil.id] = 'Eating';
        this.conditionStates[phil.id] = 'Idle';
      }
    }

    const grantedEatingThisTick = new Set<number>();

    // 1. Process putdown(i) for philosophers who completed eating at the start of this tick.
    //    putdown(i) marks philosopher i Thinking and calls test(left) and test(right).
    for (const completedId of view.completedEatersThisTick) {
      this.putdown(
        completedId,
        view,
        reservedForkOwners,
        grantedEatingThisTick,
        actions,
        events
      );
    }

    // Defensive sync: if any philosopher is Thinking in the view but still marked Eating in monitor
    for (const phil of view.philosophers) {
      if (
        phil.state === 'Thinking' &&
        this.monitorStates[phil.id] === 'Eating' &&
        !view.completedEatersThisTick.includes(phil.id)
      ) {
        this.putdown(
          phil.id,
          view,
          reservedForkOwners,
          grantedEatingThisTick,
          actions,
          events
        );
      }
    }

    // 2. Process pickup(i) for philosophers who are newly Hungry (or Waiting in a synthetic view
    //    without having entered the monitor yet).
    for (const phil of view.philosophers) {
      if (phil.state !== 'Hungry' && phil.state !== 'Waiting') {
        continue;
      }
      if (grantedEatingThisTick.has(phil.id)) {
        continue;
      }

      if (this.monitorStates[phil.id] === 'Thinking') {
        this.pickup(
          phil.id,
          view,
          reservedForkOwners,
          grantedEatingThisTick,
          actions,
          events
        );
      } else if (this.monitorStates[phil.id] === 'Hungry') {
        // Already inside monitor waiting on condition variable self[i]; re-test only if neither
        // neighbor is Eating (e.g. if a neighbor was not Eating from the start of a custom view).
        const leftId = this.getLeftNeighborId(phil.id);
        const rightId = this.getRightNeighborId(phil.id);
        if (
          this.monitorStates[leftId] !== 'Eating' &&
          this.monitorStates[rightId] !== 'Eating'
        ) {
          this.test(
            phil.id,
            'condition-recheck',
            phil.id,
            view,
            reservedForkOwners,
            grantedEatingThisTick,
            actions,
            events
          );
        }
      }
    }

    // 3. Emit WAIT actions for any Hungry/Waiting philosopher who remains blocked on self[i]
    for (const phil of view.philosophers) {
      if (
        (phil.state === 'Hungry' || phil.state === 'Waiting') &&
        !grantedEatingThisTick.has(phil.id)
      ) {
        const leftId = this.getLeftNeighborId(phil.id);
        const rightId = this.getRightNeighborId(phil.id);
        const blockingNeighbors: string[] = [];
        if (this.monitorStates[leftId] === 'Eating') {
          blockingNeighbors.push(`P${leftId}`);
        }
        if (this.monitorStates[rightId] === 'Eating') {
          blockingNeighbors.push(`P${rightId}`);
        }
        const blockerDesc =
          blockingNeighbors.length > 0
            ? `neighbor(s) ${blockingNeighbors.join(' & ')} currently Eating`
            : 'neighboring forks unavailable';

        actions.push({
          type: 'WAIT',
          philosopherId: phil.id,
          reason: `Monitor strategy: Philosopher ${phil.id} is waiting on condition variable self[${phil.id}] (${blockerDesc}).`,
        });
      }
    }

    return { actions, events };
  }

  /**
   * Monitor procedure pickup(i):
   * Marks philosopher i as Hungry and invokes test(i).
   * If test(i) cannot grant both forks, philosopher i waits on condition self[i].
   */
  public pickup(
    philosopherId: number,
    view: ReadonlySimulationView,
    reservedForkOwners: Map<number, number>,
    grantedEatingThisTick: Set<number>,
    actions: StrategyAction[],
    events: StrategyEventDescriptor[]
  ): void {
    this.monitorStates[philosopherId] = 'Hungry';

    events.push({
      type: 'STRATEGY_DECISION',
      philosopherId,
      reason: `Monitor entered: pickup(P${philosopherId}) set state[${philosopherId}] = Hungry and called test(P${philosopherId}).`,
      details: {
        procedure: 'pickup',
        philosopherId,
      },
    });

    const acquired = this.test(
      philosopherId,
      'pickup',
      philosopherId,
      view,
      reservedForkOwners,
      grantedEatingThisTick,
      actions,
      events
    );

    if (!acquired) {
      this.conditionStates[philosopherId] = 'Waiting';
      const leftId = this.getLeftNeighborId(philosopherId);
      const rightId = this.getRightNeighborId(philosopherId);
      events.push({
        type: 'MONITOR_WAIT',
        philosopherId,
        reason: `Monitor wait: test(P${philosopherId}) failed (P${leftId}=${this.monitorStates[leftId]}, P${rightId}=${this.monitorStates[rightId]}); P${philosopherId} waits on condition self[${philosopherId}].`,
        details: {
          leftNeighborId: leftId,
          leftNeighborState: this.monitorStates[leftId] ?? 'Thinking',
          rightNeighborId: rightId,
          rightNeighborState: this.monitorStates[rightId] ?? 'Thinking',
        },
      });
    }
  }

  /**
   * Monitor procedure putdown(i):
   * Marks philosopher i as Thinking and invokes test(leftNeighbor(i)) and test(rightNeighbor(i))
   * to signal waiting neighbors.
   */
  public putdown(
    philosopherId: number,
    view: ReadonlySimulationView,
    reservedForkOwners: Map<number, number>,
    grantedEatingThisTick: Set<number>,
    actions: StrategyAction[],
    events: StrategyEventDescriptor[]
  ): void {
    this.monitorStates[philosopherId] = 'Thinking';
    this.conditionStates[philosopherId] = 'Idle';

    const leftId = this.getLeftNeighborId(philosopherId);
    const rightId = this.getRightNeighborId(philosopherId);

    events.push({
      type: 'STRATEGY_DECISION',
      philosopherId,
      reason: `Monitor entered: putdown(P${philosopherId}) set state[${philosopherId}] = Thinking and tests neighbors P${leftId} and P${rightId}.`,
      details: {
        procedure: 'putdown',
        philosopherId,
        leftNeighborId: leftId,
        rightNeighborId: rightId,
      },
    });

    this.test(
      leftId,
      'putdown',
      philosopherId,
      view,
      reservedForkOwners,
      grantedEatingThisTick,
      actions,
      events
    );
    this.test(
      rightId,
      'putdown',
      philosopherId,
      view,
      reservedForkOwners,
      grantedEatingThisTick,
      actions,
      events
    );
  }

  /**
   * Monitor procedure test(i):
   * Checks if state[i] === 'Hungry' and neither leftNeighbor(i) nor rightNeighbor(i) is 'Eating'.
   * When satisfied, transitions state[i] = 'Eating', signals self[i], and requests atomic acquisition
   * of both neighboring forks via the engine decision contract.
   */
  public test(
    philosopherId: number,
    caller: 'pickup' | 'putdown' | 'condition-recheck',
    triggeredByPhilosopherId: number,
    view: ReadonlySimulationView,
    reservedForkOwners: Map<number, number>,
    grantedEatingThisTick: Set<number>,
    actions: StrategyAction[],
    events: StrategyEventDescriptor[]
  ): boolean {
    const phil = view.philosophers[philosopherId];
    if (!phil) {
      return false;
    }

    const engineState: PhilosopherState = phil.state;
    const isHungryInMonitor =
      this.monitorStates[philosopherId] === 'Hungry' &&
      (engineState === 'Hungry' || engineState === 'Waiting') &&
      !grantedEatingThisTick.has(philosopherId);

    const leftId = this.getLeftNeighborId(philosopherId);
    const rightId = this.getRightNeighborId(philosopherId);
    const leftState = this.monitorStates[leftId] ?? 'Thinking';
    const rightState = this.monitorStates[rightId] ?? 'Thinking';

    // If called from putdown on a neighbor who isn't even Hungry, still record the neighbor test
    if (!isHungryInMonitor) {
      if (caller === 'putdown') {
        events.push({
          type: 'MONITOR_TEST',
          philosopherId,
          reason: `Monitor test(P${philosopherId}) from putdown(P${triggeredByPhilosopherId}): P${philosopherId} is ${this.monitorStates[philosopherId]} (not Hungry); no wakeup needed.`,
          details: {
            caller,
            triggeredBy: triggeredByPhilosopherId,
            passed: false,
          },
        });
      }
      return false;
    }

    const neighborsNotEating = leftState !== 'Eating' && rightState !== 'Eating';
    const leftForkFree =
      !reservedForkOwners.has(phil.leftForkId) ||
      reservedForkOwners.get(phil.leftForkId) === phil.id;
    const rightForkFree =
      !reservedForkOwners.has(phil.rightForkId) ||
      reservedForkOwners.get(phil.rightForkId) === phil.id;

    const canEat = neighborsNotEating && leftForkFree && rightForkFree;

    events.push({
      type: 'MONITOR_TEST',
      philosopherId,
      reason: canEat
        ? `Monitor test(P${philosopherId}) [${caller}]: passed — P${philosopherId} is Hungry and neither neighbor P${leftId} (${leftState}) nor P${rightId} (${rightState}) is Eating.`
        : `Monitor test(P${philosopherId}) [${caller}]: blocked — neighbor states are P${leftId}=${leftState}, P${rightId}=${rightState}.`,
      details: {
        caller,
        triggeredBy: triggeredByPhilosopherId,
        passed: canEat,
        leftNeighborId: leftId,
        leftNeighborState: leftState,
        rightNeighborId: rightId,
        rightNeighborState: rightState,
      },
    });

    if (!canEat) {
      return false;
    }

    const wasWaitingOnCondition = this.conditionStates[philosopherId] === 'Waiting';
    this.monitorStates[philosopherId] = 'Eating';
    this.conditionStates[philosopherId] = 'Signaled';
    grantedEatingThisTick.add(philosopherId);

    events.push({
      type: 'MONITOR_SIGNAL',
      philosopherId,
      reason: wasWaitingOnCondition
        ? `Monitor signal: condition self[${philosopherId}] signaled by putdown(P${triggeredByPhilosopherId}); waking Philosopher ${philosopherId} to acquire forks ${phil.leftForkId} and ${phil.rightForkId} atomically.`
        : `Monitor signal: condition self[${philosopherId}] satisfied immediately in pickup(P${philosopherId}); granting forks ${phil.leftForkId} and ${phil.rightForkId} atomically.`,
      details: {
        caller,
        triggeredBy: triggeredByPhilosopherId,
        wasWaitingOnCondition,
      },
    });

    if (!phil.heldForkIds.includes(phil.leftForkId)) {
      reservedForkOwners.set(phil.leftForkId, phil.id);
      this.forkOwners[phil.leftForkId] = phil.id;
      actions.push({
        type: 'ACQUIRE_FORK',
        philosopherId: phil.id,
        forkId: phil.leftForkId,
        reason: `Monitor test(P${phil.id}) succeeded: atomically acquiring left fork ${phil.leftForkId}.`,
      });
    }

    if (!phil.heldForkIds.includes(phil.rightForkId)) {
      reservedForkOwners.set(phil.rightForkId, phil.id);
      this.forkOwners[phil.rightForkId] = phil.id;
      actions.push({
        type: 'ACQUIRE_FORK',
        philosopherId: phil.id,
        forkId: phil.rightForkId,
        reason: `Monitor test(P${phil.id}) succeeded: atomically acquiring right fork ${phil.rightForkId}.`,
      });
    }

    actions.push({
      type: 'START_EATING',
      philosopherId: phil.id,
      reason: `Monitor strategy: Philosopher ${phil.id} acquired both forks (${phil.leftForkId} and ${phil.rightForkId}) atomically after test(P${phil.id}) succeeded.`,
    });

    return true;
  }

  public getInternalState(): MonitorDebugState {
    const waitingPhilosophers: number[] = [];
    const eatingPhilosophers: number[] = [];
    for (let i = 0; i < this.philosopherCount; i++) {
      if (this.monitorStates[i] === 'Hungry') {
        waitingPhilosophers.push(i);
      } else if (this.monitorStates[i] === 'Eating') {
        eatingPhilosophers.push(i);
      }
    }

    return Object.freeze({
      monitorStates: Object.freeze([...this.monitorStates]),
      conditionStates: Object.freeze([...this.conditionStates]),
      waitingPhilosophers: Object.freeze(waitingPhilosophers),
      eatingPhilosophers: Object.freeze(eatingPhilosophers),
      forkOwners: Object.freeze([...this.forkOwners]),
    });
  }

  public getLeftNeighborId(philosopherId: number): number {
    return (philosopherId + this.philosopherCount - 1) % this.philosopherCount;
  }

  public getRightNeighborId(philosopherId: number): number {
    return (philosopherId + 1) % this.philosopherCount;
  }

  private configureCount(count: number): void {
    this.philosopherCount = count;
    this.monitorStates = Array.from({ length: count }, () => 'Thinking');
    this.conditionStates = Array.from({ length: count }, () => 'Idle');
    this.forkOwners = Array.from({ length: count }, () => null);
  }
}
