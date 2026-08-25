import { describe, expect, it } from 'vitest';
import { resolvePeel } from '../src/components/Chunks/chunk-defs';

describe('resolvePeel', () => {
  const LEN = 10;

  it('is a no-op when undefined', () => {
    expect(resolvePeel(undefined, LEN)).toEqual({ top: 0, base: LEN });
  });

  it('peels a top prefix for a plain number (unchanged behaviour)', () => {
    expect(resolvePeel(3, LEN)).toEqual({ top: 3, base: LEN });
  });

  it('treats a falsy count as "to the bottom", not a window', () => {
    expect(resolvePeel({ from: 3 }, LEN)).toEqual({ top: 3, base: LEN });
    expect(resolvePeel({ from: 3, count: 0 }, LEN)).toEqual({
      top: 3,
      base: LEN,
    });
  });

  it('opens a window for count >= 1', () => {
    // Isolate a single unit: unit 4, floor cap at 5.
    expect(resolvePeel({ from: 4, count: 1 }, LEN)).toEqual({
      top: 4,
      base: 5,
    });
    expect(resolvePeel({ from: 2, count: 3 }, LEN)).toEqual({
      top: 2,
      base: 5,
    });
  });

  it('defaults `from` to 0 (top window)', () => {
    expect(resolvePeel({ count: 3 }, LEN)).toEqual({ top: 0, base: 3 });
  });

  it('clamps both ends into [0, layerCount]', () => {
    expect(resolvePeel(99, LEN)).toEqual({ top: LEN, base: LEN });
    expect(resolvePeel({ from: -5, count: 2 }, LEN)).toEqual({
      top: 0,
      base: 2,
    });
    // A count past the bottom stops at the natural base.
    expect(resolvePeel({ from: 8, count: 99 }, LEN)).toEqual({
      top: 8,
      base: LEN,
    });
  });
});
