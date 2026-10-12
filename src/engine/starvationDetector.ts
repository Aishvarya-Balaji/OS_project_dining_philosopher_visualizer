import { PhilosopherSnapshot } from './types';

export interface StarvationVictimDetail {
  readonly philosopherId: number;
  readonly currentWaitTicks: number;
  readonly waitStartTick: number | null;
  readonly neighborMealsDuringWait: number;
  readonly leftNeighborId: number;
  readonly rightNeighborId: number;
  readonly reason: string;
}

export interface StarvationDetectionInput {
  readonly philosophers: readonly PhilosopherSnapshot[];
  readonly starvationThresholdTicks: number;
  /**
   * Optional per-philosopher count of meals completed by their two neighbors since the
   * philosopher's current wait started. If omitted in standalone unit tests, falls back
   * to the sum of the two neighbors' total `mealsCompleted`.
   */
  readonly neighborMealsDuringWait?: Readonly<Record<number, number>>;
}

export interface StarvationDetectionResult {
  readonly starvationDetected: boolean;
  readonly starvedPhilosopherIds: readonly number[];
  readonly victims: readonly StarvationVictimDetail[];
  readonly reason: string | null;
}

/**
 * Threshold-Based Starvation Detector:
 * Flags a philosopher when:
 * 1. The philosopher is currently waiting for forks ('Hungry' or 'Waiting').
 * 2. Their continuous wait (`currentWaitTicks`) has reached or exceeded `starvationThresholdTicks`.
 * 3. Their neighboring philosophers have completed at least one meal during that waiting interval.
 *
 * Explicitly labels detections as "starvation detected by threshold" because a finite wait
 * threshold is an empirical indicator rather than a formal proof of infinite starvation.
 */
export function detectStarvation(input: StarvationDetectionInput): StarvationDetectionResult {
  const { philosophers, starvationThresholdTicks, neighborMealsDuringWait } = input;
  const count = philosophers.length;

  if (count < 2 || starvationThresholdTicks < 1) {
    return Object.freeze({
      starvationDetected: false,
      starvedPhilosopherIds: Object.freeze([]),
      victims: Object.freeze([]),
      reason: null,
    });
  }

  const victims: StarvationVictimDetail[] = [];
  const starvedIds: number[] = [];

  for (const phil of philosophers) {
    if (phil.state !== 'Hungry' && phil.state !== 'Waiting') {
      continue;
    }

    if (phil.currentWaitTicks < starvationThresholdTicks) {
      continue;
    }

    const leftNeighborId = (phil.id + count - 1) % count;
    const rightNeighborId = (phil.id + 1) % count;
    const leftNeighbor = philosophers[leftNeighborId];
    const rightNeighbor = philosophers[rightNeighborId];

    const fallbackNeighborMeals =
      (leftNeighbor?.mealsCompleted ?? 0) + (rightNeighbor?.mealsCompleted ?? 0);
    const neighborMeals =
      neighborMealsDuringWait?.[phil.id] !== undefined
        ? neighborMealsDuringWait[phil.id]!
        : fallbackNeighborMeals;

    if (neighborMeals <= 0) {
      continue;
    }

    const victimReason = `starvation detected by threshold: Philosopher ${phil.id} waited ${phil.currentWaitTicks} ticks (threshold: ${starvationThresholdTicks}) while neighbors P${leftNeighborId} and P${rightNeighborId} completed ${neighborMeals} meal(s) during that interval.`;

    starvedIds.push(phil.id);
    victims.push(
      Object.freeze({
        philosopherId: phil.id,
        currentWaitTicks: phil.currentWaitTicks,
        waitStartTick: phil.waitStartTick,
        neighborMealsDuringWait: neighborMeals,
        leftNeighborId,
        rightNeighborId,
        reason: victimReason,
      })
    );
  }

  if (victims.length === 0) {
    return Object.freeze({
      starvationDetected: false,
      starvedPhilosopherIds: Object.freeze([]),
      victims: Object.freeze([]),
      reason: null,
    });
  }

  const combinedReason = victims.map((v) => v.reason).join(' ');

  return Object.freeze({
    starvationDetected: true,
    starvedPhilosopherIds: Object.freeze(starvedIds),
    victims: Object.freeze(victims),
    reason: combinedReason,
  });
}
