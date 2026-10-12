import { DeterministicRng } from './types';

/**
 * Deterministic 32-bit seeded pseudo-random number generator (Mulberry32).
 * Never calls Math.random or Date.now.
 * Identical seeds always produce identical number sequences across runs and resets.
 */
export class SeededRng implements DeterministicRng {
  private initialSeed: number;
  private state: number;

  constructor(seed = 42) {
    if (!Number.isFinite(seed)) {
      throw new Error(`Invalid RNG seed: ${String(seed)}. Seed must be a finite number.`);
    }
    this.initialSeed = seed | 0;
    this.state = this.initialSeed;
  }

  /**
   * Returns a deterministic floating-point value in the half-open interval [0, 1).
   */
  public nextFloat(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /**
   * Returns a deterministic integer in [min, max] inclusive.
   */
  public nextInt(min: number, max: number): number {
    const low = Math.ceil(min);
    const high = Math.floor(max);
    if (!Number.isFinite(low) || !Number.isFinite(high) || high < low) {
      throw new Error(`Invalid RNG integer range: [${String(min)}, ${String(max)}].`);
    }
    if (low === high) {
      return low;
    }
    const span = high - low + 1;
    return low + Math.floor(this.nextFloat() * span);
  }

  /**
   * Resets the generator back to its initial seed (or a newly supplied seed).
   */
  public reset(seed?: number): void {
    if (seed !== undefined) {
      if (!Number.isFinite(seed)) {
        throw new Error(`Invalid RNG seed: ${String(seed)}. Seed must be a finite number.`);
      }
      this.initialSeed = seed | 0;
    }
    this.state = this.initialSeed;
  }

  public getState(): number {
    return this.state;
  }
}
