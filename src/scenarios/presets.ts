import { ScenarioPreset, SimulationConfig } from '../engine/types';
import { countToWord, DEFAULT_PHILOSOPHERS } from './philosopherCount';

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

const starvationBiasedConfig = Object.freeze<SimulationConfig>({
  philosopherCount: 5,
  seed: 42,
  strategy: 'monitor',
  initialStates: ['Hungry', 'Thinking', 'Thinking', 'Thinking', 'Thinking'],
  initialThinkTicks: [1, 1, 3, 17, 30],
  thinkTicksRange: [1, 8],
  eatTicksRange: [2, 4],
  perPhilosopherThinkRanges: [
    [1, 1],
    [3, 3],
    [1, 1],
    [12, 12],
    [12, 12],
  ],
  perPhilosopherEatRanges: [
    [4, 4],
    [2, 2],
    [4, 4],
    [4, 4],
    [2, 2],
  ],
  starvationThresholdTicks: 12,
  livelockWindowTicks: 12,
  casBackoffMode: 'random',
  casFixedBackoffTicks: 2,
  casMaxRandomBackoffTicks: 5,
});

/**
 * Starvation (Biased) Preset:
 * Asymmetric timing profile where fast-cycling neighbors P0 and P2 (1-tick think, 4-tick eat)
 * overlap their meals across P1, causing P1 to wait past the threshold under the Monitor strategy
 * before P3 eventually disrupts the cycle so P1 can eat.
 */
export const STARVATION_PRESET: ScenarioPreset = Object.freeze<ScenarioPreset>({
  id: 'starvation',
  name: 'Starvation (Biased)',
  description:
    'Asymmetric think/eat timings where fast-cycling neighbors P0 and P2 repeatedly overlap meals and starve P1 past the wait threshold.',
  config: starvationBiasedConfig,
});

const casLivelockConfig = Object.freeze<SimulationConfig>({
  philosopherCount: 5,
  seed: 42,
  strategy: 'cas',
  initialStates: ['Hungry', 'Hungry', 'Hungry', 'Hungry', 'Hungry'],
  thinkTicksRange: [3, 5],
  eatTicksRange: [2, 3],
  starvationThresholdTicks: 18,
  livelockWindowTicks: 10,
  casBackoffMode: 'fixed',
  casFixedBackoffTicks: 2,
  casMaxRandomBackoffTicks: 5,
});

/**
 * CAS Livelock Preset:
 * All five philosophers start Hungry simultaneously and use Simulated CAS with fixed back-off,
 * causing them to synchronously claim left forks, fail right-fork CAS, roll back, and retry forever.
 */
export const CAS_LIVELOCK_PRESET: ScenarioPreset = Object.freeze<ScenarioPreset>({
  id: 'cas-livelock',
  name: 'CAS Livelock (Fixed Back-off)',
  description:
    'Symmetric initial state with fixed CAS back-off where all five philosophers synchronously claim left forks, fail right-fork CAS, roll back, and retry indefinitely.',
  config: casLivelockConfig,
});

export const SCENARIO_PRESETS: readonly ScenarioPreset[] = Object.freeze([
  NORMAL_PRESET,
  FORCE_DEADLOCK_PRESET,
  STARVATION_PRESET,
  CAS_LIVELOCK_PRESET,
]);

export function getScenarioPreset(id: string): ScenarioPreset {
  const preset = SCENARIO_PRESETS.find((p) => p.id === id);
  if (!preset) {
    throw new Error(`Unknown scenario preset ID: '${id}'.`);
  }
  return preset;
}

/**
 * Returns the preset description worded for the selected philosopher count.
 * At the preset's own count the original static `description` is returned verbatim.
 */
export function getScenarioDescription(preset: ScenarioPreset, philosopherCount: number): string {
  const presetCount = preset.config.philosopherCount ?? DEFAULT_PHILOSOPHERS;
  if (philosopherCount === presetCount) {
    return preset.description;
  }
  const word = countToWord(philosopherCount);
  switch (preset.id) {
    case FORCE_DEADLOCK_PRESET.id:
      return `All ${word} philosophers become Hungry simultaneously, reliably triggering circular-wait deadlock under the Naive strategy.`;
    case CAS_LIVELOCK_PRESET.id:
      return `Symmetric initial state with fixed CAS back-off where all ${word} philosophers synchronously claim left forks, fail right-fork CAS, roll back, and retry indefinitely.`;
    case STARVATION_PRESET.id:
      return `${preset.description} Timings are tuned for ${countToWord(presetCount)} philosophers; with ${word}, starvation is not guaranteed.`;
    default:
      return preset.description;
  }
}
