import { ForkSnapshot, PhilosopherSnapshot, StrategyName } from './types';

export interface CoffmanConditionsExplanation {
  readonly mutualExclusion: string;
  readonly holdAndWait: string;
  readonly noPreemption: string;
  readonly circularWait: string;
}

export interface DeadlockDetectionInput {
  readonly philosophers: readonly PhilosopherSnapshot[];
  readonly forks: readonly ForkSnapshot[];
  readonly strategy?: StrategyName;
}

export interface DeadlockDetectionResult {
  readonly deadlocked: boolean;
  readonly cycle: string | null;
  readonly coffmanConditions: CoffmanConditionsExplanation | null;
  readonly reason: string | null;
}

/**
 * Detects the passive Dining Philosophers deadlock state:
 * 1. Strategy is passive (not an active rollback strategy like CAS).
 * 2. Every philosopher is in the 'Waiting' state.
 * 3. Every philosopher holds exactly one neighboring fork.
 * 4. Every philosopher's missing neighboring fork is held by another waiting philosopher,
 *    forming a closed circular-wait dependency cycle across all philosophers.
 */
export function detectDeadlock(input: DeadlockDetectionInput): DeadlockDetectionResult {
  const { philosophers, forks, strategy } = input;
  const count = philosophers.length;

  // Active rollback strategies (CAS) release forks on conflict instead of blocking passively
  if (count < 2 || strategy === 'cas') {
    return {
      deadlocked: false,
      cycle: null,
      coffmanConditions: null,
      reason: null,
    };
  }

  // Condition check: every philosopher must be passively Waiting and holding exactly 1 fork
  for (const phil of philosophers) {
    if (phil.state !== 'Waiting' || phil.heldForkIds.length !== 1) {
      return {
        deadlocked: false,
        cycle: null,
        coffmanConditions: null,
        reason: null,
      };
    }
  }

  // Build fork ownership map and verify all forks are held
  const forkOwners = new Map<number, number>();
  for (const fork of forks) {
    if (fork.ownerId === null) {
      return {
        deadlocked: false,
        cycle: null,
        coffmanConditions: null,
        reason: null,
      };
    }
    forkOwners.set(fork.id, fork.ownerId);
  }

  // Trace the dependency chain starting from Philosopher 0 to verify a closed circular wait
  const cycleSteps: string[] = [];
  const visited = new Set<number>();
  let currentId = 0;

  while (!visited.has(currentId)) {
    visited.add(currentId);
    const phil = philosophers[currentId];
    if (!phil || phil.heldForkIds.length !== 1) {
      return {
        deadlocked: false,
        cycle: null,
        coffmanConditions: null,
        reason: null,
      };
    }

    const heldForkId = phil.heldForkIds[0]!;
    const neededForkId = heldForkId === phil.leftForkId ? phil.rightForkId : phil.leftForkId;
    const blockingOwnerId = forkOwners.get(neededForkId);

    if (blockingOwnerId === undefined || blockingOwnerId === currentId) {
      return {
        deadlocked: false,
        cycle: null,
        coffmanConditions: null,
        reason: null,
      };
    }

    cycleSteps.push(`P${phil.id} (holds F${heldForkId}, waits for F${neededForkId})`);
    currentId = blockingOwnerId;
  }

  // All philosophers must be part of the closed cycle returning to P0
  if (visited.size !== count || currentId !== 0) {
    return {
      deadlocked: false,
      cycle: null,
      coffmanConditions: null,
      reason: null,
    };
  }

  const cycle = `${cycleSteps.join(' -> ')} -> P0`;

  const coffmanConditions: CoffmanConditionsExplanation = Object.freeze({
    mutualExclusion:
      'Mutual exclusion: Each fork can be held by only one philosopher at a time.',
    holdAndWait:
      'Hold and wait: Every philosopher holds one fork while waiting to acquire their second neighboring fork.',
    noPreemption:
      'No preemption: Held forks cannot be forcibly taken away and are only released after eating.',
    circularWait: `Circular wait: Closed dependency chain (${cycle}).`,
  });

  const reason = [
    `Deadlock detected: all ${count} philosophers are passively Waiting, each holds 1 fork, and no progress is possible.`,
    `Cycle: ${cycle}.`,
    `Coffman conditions satisfied — (1) ${coffmanConditions.mutualExclusion} (2) ${coffmanConditions.holdAndWait} (3) ${coffmanConditions.noPreemption} (4) ${coffmanConditions.circularWait}`,
  ].join(' ');

  return Object.freeze({
    deadlocked: true,
    cycle,
    coffmanConditions,
    reason,
  });
}
