import { PhilosopherSnapshot, SimulationEvent, StrategyName } from './types';

export interface LivelockDetectionInput {
  readonly tick: number;
  readonly livelockWindowTicks: number;
  readonly strategy?: StrategyName;
  readonly philosophers: readonly PhilosopherSnapshot[];
  readonly events: readonly SimulationEvent[];
  readonly lastMealCompletedTick?: number;
}

export interface LivelockDetectionResult {
  readonly livelockDetected: boolean;
  readonly retryingPhilosopherIds: readonly number[];
  readonly attemptsInWindow: number;
  readonly rollbacksInWindow: number;
  readonly reason: string | null;
}

/**
 * Suspected Livelock Detector:
 * Flags livelock when:
 * 1. At least `livelockWindowTicks` ticks have elapsed (`tick >= livelockWindowTicks`).
 * 2. Zero meals have started or completed during the window `[tick - livelockWindowTicks + 1, tick]`
 *    and no philosopher is currently Eating.
 * 3. Philosophers are actively retrying and rolling back forks (`CAS_ATTEMPT` and `CAS_ROLLBACK`
 *    events continue to occur inside the window).
 */
export function detectLivelock(input: LivelockDetectionInput): LivelockDetectionResult {
  const {
    tick,
    livelockWindowTicks,
    strategy,
    philosophers,
    events,
    lastMealCompletedTick,
  } = input;

  if (
    livelockWindowTicks < 1 ||
    tick < livelockWindowTicks ||
    (strategy !== undefined && strategy !== 'cas')
  ) {
    return Object.freeze({
      livelockDetected: false,
      retryingPhilosopherIds: Object.freeze([]),
      attemptsInWindow: 0,
      rollbacksInWindow: 0,
      reason: null,
    });
  }

  // If any philosopher is currently Eating, progress is being made
  if (philosophers.some((p) => p.state === 'Eating')) {
    return Object.freeze({
      livelockDetected: false,
      retryingPhilosopherIds: Object.freeze([]),
      attemptsInWindow: 0,
      rollbacksInWindow: 0,
      reason: null,
    });
  }

  if (
    lastMealCompletedTick !== undefined &&
    lastMealCompletedTick > 0 &&
    tick - lastMealCompletedTick < livelockWindowTicks
  ) {
    return Object.freeze({
      livelockDetected: false,
      retryingPhilosopherIds: Object.freeze([]),
      attemptsInWindow: 0,
      rollbacksInWindow: 0,
      reason: null,
    });
  }

  const windowStartTick = tick - livelockWindowTicks + 1;
  let attemptsInWindow = 0;
  let rollbacksInWindow = 0;
  const retryingSet = new Set<number>();

  for (let i = events.length - 1; i >= 0; i--) {
    const evt = events[i]!;
    if (evt.tick < windowStartTick) {
      break;
    }

    if (evt.type === 'MEAL_COMPLETED' || evt.type === 'MEAL_STARTED') {
      return Object.freeze({
        livelockDetected: false,
        retryingPhilosopherIds: Object.freeze([]),
        attemptsInWindow: 0,
        rollbacksInWindow: 0,
        reason: null,
      });
    }

    if (evt.type === 'CAS_ATTEMPT') {
      attemptsInWindow += 1;
    } else if (evt.type === 'CAS_ROLLBACK') {
      rollbacksInWindow += 1;
      if (evt.philosopherId !== undefined) {
        retryingSet.add(evt.philosopherId);
      }
    } else if (evt.type === 'CAS_BACKOFF' && evt.philosopherId !== undefined) {
      retryingSet.add(evt.philosopherId);
    }
  }

  if (attemptsInWindow === 0 || rollbacksInWindow === 0 || retryingSet.size === 0) {
    return Object.freeze({
      livelockDetected: false,
      retryingPhilosopherIds: Object.freeze([]),
      attemptsInWindow,
      rollbacksInWindow,
      reason: null,
    });
  }

  const retryingPhilosopherIds = Array.from(retryingSet).sort((a, b) => a - b);
  const philList = retryingPhilosopherIds.map((id) => `P${id}`).join(', ');
  const reason = `Suspected livelock detected: no meal completed during the ${livelockWindowTicks}-tick window (ticks ${windowStartTick}..${tick}) while philosophers [${philList}] actively retried and rolled back (${attemptsInWindow} CAS attempts, ${rollbacksInWindow} rollbacks).`;

  return Object.freeze({
    livelockDetected: true,
    retryingPhilosopherIds: Object.freeze(retryingPhilosopherIds),
    attemptsInWindow,
    rollbacksInWindow,
    reason,
  });
}
