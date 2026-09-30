import { BufferAttribute, BufferGeometry } from 'three';
import { describe, expect, it } from 'vitest';
import {
  createSurfaceSampler,
  sampleSurfaceFootprint,
  SurfaceSamplerEntry,
} from '../src/components/Chunks/surface-sampler';
import { Vec2 } from '../src/sdk/types/common';

/** A square sheet over [-50, 50]², at `f(x, z)`. */
function sheet(id: string | null, f: (x: number, z: number) => number) {
  const geometry = new BufferGeometry();
  const corners: [number, number][] = [
    [-50, -50],
    [50, -50],
    [50, 50],
    [-50, 50],
  ];
  const positions = new Float32Array(
    corners.flatMap(([x, z]) => [x, f(x, z), z]),
  );
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  return { id, layer: 0, geometry } satisfies SurfaceSamplerEntry;
}

describe('createSurfaceSampler', () => {
  it('answers with the HIGHEST surface drawn over the point', () => {
    // Order deliberately puts the deepest last: taking the last hit instead of
    // the highest reads as the floor of a block rather than its surface.
    const sampler = createSurfaceSampler([
      sheet('bed', () => -100),
      sheet('basement', () => -2600),
    ]);

    expect(sampler.getHeightAt(0, 0)).toBe(-100);
    expect(sampler.sampleAt(10, -20)!.y).toBe(-100);
  });

  it('samples a named surface alone', () => {
    const sampler = createSurfaceSampler([
      sheet('bed', () => -100),
      sheet('basement', () => -2600),
    ]);

    expect(sampler.getHeightAt(0, 0, 'basement')).toBe(-2600);
    expect(sampler.getHeightAt(0, 0, 'bed')).toBe(-100);
    expect(sampler.getHeightAt(0, 0, 'nothing')).toBeNull();
    expect(sampler.surfaces).toEqual(['bed', 'basement']);
  });

  it('reports nothing where nothing is drawn', () => {
    const sampler = createSurfaceSampler([sheet('bed', () => -100)]);
    expect(sampler.getHeightAt(500, 0)).toBeNull();
  });
});

describe('sampleSurfaceFootprint', () => {
  it('fits the slope under the footprint, not one triangle', () => {
    const sampler = createSurfaceSampler([sheet('bed', x => -100 + x / 10)]);
    const fit = sampleSurfaceFootprint(sampler, { x: 0, z: 0, radius: 20 })!;

    expect(fit.y).toBeCloseTo(-100, 4);
    expect(fit.coverage).toBe(1);
    expect(fit.max - fit.min).toBeCloseTo(4, 4);
    // Ground rising toward +X tips the normal back toward -X.
    const tilt = Math.hypot(0.1, 1);
    expect(fit.normal[0]).toBeCloseTo(-0.1 / tilt, 4);
    expect(fit.normal[1]).toBeCloseTo(1 / tilt, 4);
    expect(fit.normal[2]).toBeCloseTo(0, 4);
  });

  it('says how much of the footprint is actually on the surface', () => {
    const sampler = createSurfaceSampler([sheet('bed', () => -100)]);
    const fit = sampleSurfaceFootprint(sampler, { x: 45, z: 0, radius: 20 })!;

    expect(fit.coverage).toBeGreaterThan(0.3);
    expect(fit.coverage).toBeLessThan(0.8);
    expect(fit.y).toBe(-100);
  });

  it('is null where the footprint finds nothing at all', () => {
    const sampler = createSurfaceSampler([sheet('bed', () => -100)]);
    expect(
      sampleSurfaceFootprint(sampler, { x: 400, z: 400, radius: 20 }),
    ).toBeNull();
  });

  it('samples explicit points, turned by the heading', () => {
    // A ridge along +X: a skid's corners see it only when they lie across it.
    const sampler = createSurfaceSampler([
      sheet('bed', (_, z) => -100 + z / 5),
    ]);
    const corners: Vec2[] = [
      [20, 0],
      [-20, 0],
    ];

    const alongRidge = sampleSurfaceFootprint(sampler, {
      x: 0,
      z: 0,
      points: corners,
    })!;
    expect(alongRidge.max - alongRidge.min).toBeCloseTo(0, 6);

    // Turned a quarter turn, the same two corners straddle the slope.
    const acrossRidge = sampleSurfaceFootprint(sampler, {
      x: 0,
      z: 0,
      points: corners,
      heading: Math.PI / 2,
    })!;
    expect(acrossRidge.max - acrossRidge.min).toBeCloseTo(8, 4);
    expect(acrossRidge.coverage).toBe(1);
  });

  it('fits a named surface rather than whatever is highest', () => {
    const sampler = createSurfaceSampler([
      sheet('bed', () => -100),
      sheet('deep', x => -2600 + x / 10),
    ]);

    const top = sampleSurfaceFootprint(sampler, { x: 0, z: 0, radius: 20 })!;
    expect(top.y).toBeCloseTo(-100, 6);
    expect(top.normal[0]).toBeCloseTo(0, 6);

    const deep = sampleSurfaceFootprint(sampler, {
      x: 0,
      z: 0,
      radius: 20,
      surface: 'deep',
    })!;
    expect(deep.y).toBeCloseTo(-2600, 4);
    const tilt = Math.hypot(0.1, 1);
    expect(deep.normal[0]).toBeCloseTo(-0.1 / tilt, 4);
  });

  it('does not carry state between calls', () => {
    const sampler = createSurfaceSampler([sheet('bed', x => -100 + x / 10)]);

    const wide = sampleSurfaceFootprint(sampler, { x: 0, z: 0, radius: 40 })!;
    const narrow = sampleSurfaceFootprint(sampler, { x: 0, z: 0, radius: 5 })!;
    const wideAgain = sampleSurfaceFootprint(sampler, {
      x: 0,
      z: 0,
      radius: 40,
    })!;

    expect(narrow.max - narrow.min).toBeCloseTo(1, 4);
    expect(wideAgain.max - wideAgain.min).toBeCloseTo(wide.max - wide.min, 6);
    expect(wideAgain.coverage).toBe(wide.coverage);
  });
});

/** A flat cap at `y` over [0, size]², published by chunk `group`. */
function cap(group: string, y: number, size: number): SurfaceSamplerEntry {
  const geometry = new BufferGeometry();
  const corners: [number, number][] = [
    [0, 0],
    [size, 0],
    [size, size],
    [0, size],
  ];
  const positions = new Float32Array(corners.flatMap(([x, z]) => [x, y, z]));
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  return { id: `${group}@${y}`, layer: 0, geometry, group };
}

/**
 * Three stacked chunks, the middle one on a NARROWER footprint — the shape a
 * chunked field column takes, and the one a stack-wide top and base cannot
 * describe: outside [0, 100] there is open air between `over` and `under`.
 */
function chunked(): SurfaceSamplerEntry[] {
  return [
    cap('over', 0, 200),
    cap('over', -10, 200),
    cap('mid', -10, 100),
    cap('mid', -40, 100),
    cap('under', -40, 200),
    cap('under', -50, 200),
  ];
}

describe('SurfaceSampler.solidAt', () => {
  it('finds rock down the whole column where every chunk is drawn', () => {
    const sampler = createSurfaceSampler(chunked());
    for (const y of [-5, -25, -45]) {
      expect(sampler.solidAt(50, y, 50)).not.toBeNull();
    }
  });

  it('reports open air between chunks that do not share a footprint', () => {
    const sampler = createSurfaceSampler(chunked());
    // Outside the middle chunk there is still rock in the two wide ones...
    expect(sampler.solidAt(150, -5, 50)).not.toBeNull();
    expect(sampler.solidAt(150, -45, 50)).not.toBeNull();
    // ...and nothing at all in the gap they leave between them.
    expect(sampler.solidAt(150, -25, 50)).toBeNull();
  });

  it('measures the distance to the nearest face of the containing chunk', () => {
    const sampler = createSurfaceSampler(chunked());
    expect(sampler.solidAt(50, -2, 50)).toBeCloseTo(2, 4);
    expect(sampler.solidAt(50, -8, 50)).toBeCloseTo(2, 4);
    expect(sampler.solidAt(50, -25, 50)).toBeCloseTo(15, 4);
  });

  it('is null above the block, below it, and off every footprint', () => {
    const sampler = createSurfaceSampler(chunked());
    expect(sampler.solidAt(50, 10, 50)).toBeNull();
    expect(sampler.solidAt(50, -60, 50)).toBeNull();
    expect(sampler.solidAt(400, -25, 50)).toBeNull();
  });

  it('carries the deepest chunk down to a carrier floor', () => {
    const sampler = createSurfaceSampler(chunked());
    // The carrier fill and the chunk above it are one solid, so the nearest face
    // at -60 is that chunk's top rather than the horizon they meet at.
    expect(sampler.solidAt(50, -60, 50, -100)).toBeCloseTo(20, 4);
    expect(sampler.solidAt(50, -95, 50, -100)).toBeCloseTo(5, 4);
    // Only the deepest one extends — the gap above it is still air.
    expect(sampler.solidAt(150, -25, 50, -100)).toBeNull();
  });

  it('treats untagged entries as the one volume a single outline is', () => {
    const entries = chunked().map(({ group: _, ...rest }) => rest);
    expect(createSurfaceSampler(entries).solidAt(150, -25, 50)).not.toBeNull();
  });
});
