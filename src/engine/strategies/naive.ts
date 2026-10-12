import {
  ReadonlySimulationView,
  Strategy,
  StrategyAction,
  StrategyEventDescriptor,
  StrategyStepResult,
} from '../types';

/**
 * Naive Strategy:
 * 1. When a philosopher is Hungry/Waiting and holds no forks, they request their left fork first.
 * 2. Because fork acquisition is two-phase (1-tick simulated delay between left and right fork
 *    requests), after acquiring the left fork on tick t, the philosopher waits until tick t+1
 *    to request their right fork.
 * 3. If the right fork is unavailable, the philosopher keeps holding the left fork and waits
 *    passively (Hold-and-Wait + No Preemption), which causes circular wait deadlock when all
 *    philosophers acquire their left forks simultaneously.
 */
export class NaiveStrategy implements Strategy {
  public readonly name = 'naive' as const;
  public readonly description =
    'Acquire left fork first, then right fork on a subsequent tick; hold left fork while waiting if right fork is busy.';

  /**
   * Tracks which philosopher:fork denials have already been logged during the current wait cycle
   * so the event log records a clear FORK_DENIED reason without repeating identically every tick.
   */
  private loggedDenials = new Set<string>();

  public reset(): void {
    this.loggedDenials.clear();
  }

  public decide(view: ReadonlySimulationView): StrategyStepResult {
    const actions: StrategyAction[] = [];
    const events: StrategyEventDescriptor[] = [];

    // Clear denial tracking for philosophers who finished eating or are currently thinking/eating
    for (const phil of view.philosophers) {
      if (phil.state === 'Thinking' || phil.state === 'Eating') {
        this.loggedDenials.delete(`${phil.id}:${phil.leftForkId}`);
        this.loggedDenials.delete(`${phil.id}:${phil.rightForkId}`);
      }
    }

    // Track forks currently owned or newly granted earlier in this tick
    const reservedForkOwners = new Map<number, number>();
    for (const fork of view.forks) {
      if (fork.ownerId !== null) {
        reservedForkOwners.set(fork.id, fork.ownerId);
      }
    }

    for (const phil of view.philosophers) {
      if (phil.state !== 'Hungry' && phil.state !== 'Waiting') {
        continue;
      }

      const holdsLeft = phil.heldForkIds.includes(phil.leftForkId);
      const holdsRight = phil.heldForkIds.includes(phil.rightForkId);

      // Phase 1 of Naive acquisition: philosopher does not yet hold their left fork
      if (!holdsLeft) {
        const currentOwner = reservedForkOwners.get(phil.leftForkId);
        if (currentOwner === undefined) {
          reservedForkOwners.set(phil.leftForkId, phil.id);
          this.loggedDenials.delete(`${phil.id}:${phil.leftForkId}`);
          actions.push({
            type: 'ACQUIRE_FORK',
            philosopherId: phil.id,
            forkId: phil.leftForkId,
            reason: `Naive strategy: Philosopher ${phil.id} acquired left fork ${phil.leftForkId} first and will request right fork ${phil.rightForkId} on the next tick.`,
          });
          actions.push({
            type: 'WAIT',
            philosopherId: phil.id,
            reason: `Philosopher ${phil.id} holds left fork ${phil.leftForkId} and waits one tick before requesting right fork ${phil.rightForkId}.`,
          });
        } else {
          const denialKey = `${phil.id}:${phil.leftForkId}`;
          if (!this.loggedDenials.has(denialKey)) {
            this.loggedDenials.add(denialKey);
            events.push({
              type: 'FORK_DENIED',
              philosopherId: phil.id,
              forkId: phil.leftForkId,
              reason: `Naive strategy: Philosopher ${phil.id} could not acquire left fork ${phil.leftForkId} because it is held by Philosopher ${currentOwner}.`,
            });
          }
          actions.push({
            type: 'WAIT',
            philosopherId: phil.id,
            reason: `Philosopher ${phil.id} is waiting for left fork ${phil.leftForkId} (held by Philosopher ${currentOwner}).`,
          });
        }
        continue;
      }

      // Phase 2 of Naive acquisition: philosopher already holds left fork from an earlier tick
      if (holdsLeft && !holdsRight) {
        const currentOwner = reservedForkOwners.get(phil.rightForkId);
        if (currentOwner === undefined) {
          reservedForkOwners.set(phil.rightForkId, phil.id);
          this.loggedDenials.delete(`${phil.id}:${phil.rightForkId}`);
          actions.push({
            type: 'ACQUIRE_FORK',
            philosopherId: phil.id,
            forkId: phil.rightForkId,
            reason: `Naive strategy: Philosopher ${phil.id} acquired right fork ${phil.rightForkId} while already holding left fork ${phil.leftForkId}.`,
          });
          actions.push({
            type: 'START_EATING',
            philosopherId: phil.id,
            reason: `Naive strategy: Philosopher ${phil.id} now holds both forks (${phil.leftForkId} and ${phil.rightForkId}) and starts eating.`,
          });
        } else {
          const denialKey = `${phil.id}:${phil.rightForkId}`;
          if (!this.loggedDenials.has(denialKey)) {
            this.loggedDenials.add(denialKey);
            events.push({
              type: 'FORK_DENIED',
              philosopherId: phil.id,
              forkId: phil.rightForkId,
              reason: `Naive strategy: Philosopher ${phil.id} holds left fork ${phil.leftForkId} but was denied right fork ${phil.rightForkId} (held by Philosopher ${currentOwner}); keeping left fork and waiting.`,
            });
          }
          actions.push({
            type: 'WAIT',
            philosopherId: phil.id,
            reason: `Philosopher ${phil.id} keeps holding left fork ${phil.leftForkId} while passively waiting for right fork ${phil.rightForkId} (held by Philosopher ${currentOwner}).`,
          });
        }
      }
    }

    return { actions, events };
  }

  public getInternalState(): Readonly<Record<string, unknown>> {
    return {
      algorithm: 'Naive (Left Fork -> Right Fork)',
      preemption: false,
      acquisitionDelayTicks: 1,
    };
  }
}
