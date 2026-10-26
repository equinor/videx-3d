import { describe, expect, it } from 'vitest';
import {
  createReliefSampler,
  RELIEF_SURFACE,
  ReliefPins,
  ReliefSamplerTile,
  reliefSquareTile,
} from '../src/components/Sky/sky-relief-sampler';
import type { ReliefTile } from '../src/sdk/geometries/relief-tiles';

const CELLS = 4;

/** A tile over a square, its nodes (and the border around them) at `f(x, z)`: where a point lies on it. */
function tileOver(
  minX: number,
  minZ: number,
  width: number,
  f: (x: number, z: number) => number,
): (x: number, z: number) => ReliefSamplerTile {
  const nodes = CELLS + 3;
  const heights = new Float32Array(nodes * nodes);
  const cell = width / CELLS;
  for (let j = 0; j < nodes; j++) {
    for (let i = 0; i < nodes; i++) {
      heights[j * nodes + i] = f(minX + (i - 1) * cell, minZ + (j - 1) * cell);
    }
  }
  const tile = { cells: CELLS, heights } as unknown as ReliefTile;
  return (x, z) => reliefSquareTile(tile, minX, minZ, width, x, z);
}

describe('ReliefPins', () => {
  it('holds squares until released, each pin on its own', () => {
    const pins = new ReliefPins();
    const a = pins.add([[0, 0, 10, 10]]);
    const b = pins.add([
      [100, 100, 110, 110],
      [200, 0, 210, 10],
    ]);
    expect(pins.squares).toHaveLength(3);
    expect(pins.overlaps(5, 5, 50, 50)).toBe(true);
    expect(pins.overlaps(20, 20, 50, 50)).toBe(false);
    a();
    expect(pins.squares).toEqual([
      [100, 100, 110, 110],
      [200, 0, 210, 10],
    ]);
    expect(pins.overlaps(5, 5, 50, 50)).toBe(false);
    // Released twice: nothing else goes.
    a();
    expect(pins.squares).toHaveLength(2);
    b();
    expect(pins.squares).toEqual([]);
  });
});

describe('createReliefSampler', () => {
  // A plane, which every triangle of the tile draws exactly.
  const plane = (x: number, z: number) => 20 + 0.1 * x - 0.05 * z;
  const tile = tileOver(0, 0, 400, plane);
  const sampler = createReliefSampler(
    (x, z) =>
      x >= 0 && x <= 400 && z >= 0 && z <= 400 ? tile(x, z) : undefined,
    -30,
    new ReliefPins(),
  );

  it('answers the ground from its level, with the normal of its triangle', () => {
    const at = sampler.sampleAt(130, 270)!;
    expect(at.y).toBeCloseTo(-30 + plane(130, 270), 5);
    const length = Math.hypot(0.1, 1, 0.05);
    expect(at.normal[0]).toBeCloseTo(-0.1 / length, 6);
    expect(at.normal[1]).toBeCloseTo(1 / length, 6);
    expect(at.normal[2]).toBeCloseTo(0.05 / length, 6);
    expect(sampler.getHeightAt(130, 270, RELIEF_SURFACE)).toBeCloseTo(at.y, 9);
  });

  it('meets the ground as the triangles draw it, not as the nodes curve', () => {
    // A bowl: between nodes the triangles cut across it.
    const bowl = (x: number, z: number) =>
      ((x - 200) ** 2 + (z - 200) ** 2) / 100;
    const curved = tileOver(0, 0, 400, bowl);
    const ground = createReliefSampler(curved, 0, new ReliefPins());
    // On a node, exact; between, on the chord, above the bowl.
    expect(ground.getHeightAt(100, 100)).toBeCloseTo(bowl(100, 100), 4);
    const mid = ground.getHeightAt(150, 100)!;
    expect(mid).toBeCloseTo((bowl(100, 100) + bowl(200, 100)) / 2, 4);
    expect(mid).toBeGreaterThan(bowl(150, 100));
  });

  it('answers for the relief alone, and nothing where no tile is in', () => {
    expect(sampler.getHeightAt(100, 100, 'bed')).toBeNull();
    expect(sampler.getHeightAt(-10, 100)).toBeNull();
    expect(sampler.surfaces).toEqual([RELIEF_SURFACE]);
  });

  it('measures how far below the ground a point lies', () => {
    const ground = sampler.getHeightAt(100, 100)!;
    expect(sampler.solidAt(100, ground - 12, 100)).toBeCloseTo(12, 5);
    expect(sampler.solidAt(100, ground + 1, 100)).toBeNull();
  });

  it('tells how fine its answer is', () => {
    expect(sampler.cellAt(100, 100)).toBe(100);
    expect(sampler.cellAt(-10, 100)).toBeNull();
  });

  it('pins on the pins it was given', () => {
    const pins = new ReliefPins();
    const pinned = createReliefSampler(() => undefined, 0, pins);
    const release = pinned.pin([[0, 0, 1, 1]]);
    expect(pins.squares).toEqual([[0, 0, 1, 1]]);
    release();
    expect(pins.squares).toEqual([]);
  });
});
