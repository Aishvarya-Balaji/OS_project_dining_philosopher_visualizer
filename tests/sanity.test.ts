import { describe, expect, it } from 'vitest';

describe('Project setup sanity check', () => {
  it('runs Vitest with TypeScript in strict mode', () => {
    const philosopherCount: number = 5;
    expect(philosopherCount).toBe(5);
  });
});
