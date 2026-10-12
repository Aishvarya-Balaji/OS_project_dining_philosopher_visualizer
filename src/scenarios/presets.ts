import { ScenarioPreset, SimulationConfig } from '../engine/types';

const normalConfig = Object.freeze<SimulationConfig>({
  philosopherCount: 5,
  seed: 42,
  strategy: 'naive',
  initialStates: ['Thinking', 'Thinking', 'Thinking', 'Thinking', 'Thinking'],
  initialThinkTicks: [1, 4, 2, 5, 3],
  thinkTicksRange: [4, 6],
  eatTicksRange: [2, 2],
  starvationThresholdTicks: 18,
  livelockWindowTicks: 12,
  casBackoffMode: 'random',
  casFixedBackoffTicks: 2,
  casMaxRandomBackoffTicks: 5,
});

/**
 * Normal Preset:
 * Staggered initial thinking durations and balanced think/eat ranges so philosophers
 * request forks at different ticks during normal operation.
 */
export const NORMAL_PRESET: ScenarioPreset = Object.freeze<ScenarioPreset>({
  id: 'normal',
  name: 'Normal',
  description:
    'Staggered initial thinking durations where philosophers become hungry at different times and make steady progress.',
  config: normalConfig,
});

const forceDeadlockConfig = Object.freeze<SimulationConfig>({
  philosopherCount: 5,
  seed: 42,
  strategy: 'naive',
  initialStates: ['Hungry', 'Hungry', 'Hungry', 'Hungry', 'Hungry'],
  thinkTicksRange: [3, 5],
  eatTicksRange: [2, 3],
  starvationThresholdTicks: 18,
  livelockWindowTicks: 12,
  casBackoffMode: 'random',
  casFixedBackoffTicks: 2,
  casMaxRandomBackoffTicks: 5,
});

/**
 * Force Deadlock Preset:
 * Places all five philosophers into the Hungry state simultaneously at tick 0 so that
 * under the Naive strategy every philosopher acquires their left fork on tick 1 and
 * blocks forever waiting for their right fork.
 */
export const FORCE_DEADLOCK_PRESET: ScenarioPreset = Object.freeze<ScenarioPreset>({
  id: 'force-deadlock',
  name: 'Force Deadlock',
  description:
    'All five philosophers become Hungry simultaneously, reliably triggering circular-wait deadlock under the Naive strategy.',
  config: forceDeadlockConfig,
});

export const SCENARIO_PRESETS: readonly ScenarioPreset[] = Object.freeze([
  NORMAL_PRESET,
  FORCE_DEADLOCK_PRESET,
]);

export function getScenarioPreset(id: string): ScenarioPreset {
  const preset = SCENARIO_PRESETS.find((p) => p.id === id);
  if (!preset) {
    throw new Error(`Unknown scenario preset ID: '${id}'.`);
  }
  return preset;
}
