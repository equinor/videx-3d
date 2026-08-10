import { describe, expect, it } from 'vitest';
import {
  buildStackReference,
  evaluateSurfaceField,
  generateSurfaceValues,
  PlanarPolygonGeometry,
  SurfaceFieldSpec,
} from '../src/sdk';
import {
  getSyntheticSurface,
  syntheticSurfaceIds,
} from '../src/storybook/data/synthetic-surfaces';

// A small grid, axis-aligned and centred on the scene origin, so a region given in
// world coordinates is easy to reason about.
const NX = 81;
const NY = 81;
const CELL = 100;
const header = { nx: NX, ny: NY, xinc: CELL, yinc: CELL, rot: 0 };
// `surfaceGridToWorld` shifts rows by -(ny-1)*yinc, so this places node (0, ny-1)
// such that the grid spans [-4000, 4000] in both axes.
const worldPosition: [number, number] = [-4000, 4000];

const dipping: SurfaceFieldSpec = {
  base: 1000,
  dip: { azimuth: 90, gradient: 0.01 },
};

describe('evaluateSurfaceField', () => {
  it('applies base and dip, positive-down', () => {
    expect(evaluateSurfaceField({ base: 800 }, 0, 0)).toBe(800);
    // azimuth 90 deg is +X, so 1 km east at 0.01 is 10 m deeper
    expect(evaluateSurfaceField(dipping, 1000, 0)).toBeCloseTo(1010, 6);
    expect(evaluateSurfaceField(dipping, -1000, 0)).toBeCloseTo(990, 6);
    // ...and nothing along Z
    expect(evaluateSurfaceField(dipping, 0, 1000)).toBeCloseTo(1000, 6);
  });

  it('reports nodata outside the boundary and inside holes', () => {
    const spec: SurfaceFieldSpec = {
      base: 500,
      boundary: { kind: 'rect', min: [-1000, -1000], max: [1000, 1000] },
      holes: [{ kind: 'ellipse', center: [0, 0], radius: 200 }],
    };
    expect(evaluateSurfaceField(spec, 900, 900)).toBe(500);
    expect(evaluateSurfaceField(spec, 1500, 0)).toBeNull(); // outside boundary
    expect(evaluateSurfaceField(spec, 0, 0)).toBeNull(); // in the hole
    expect(evaluateSurfaceField(spec, 250, 0)).toBe(500); // just outside it
  });

  it('treats a polygon boundary by even-odd containment', () => {
    const spec: SurfaceFieldSpec = {
      base: 1,
      boundary: {
        kind: 'polygon',
        points: [
          [0, 0],
          [1000, 0],
          [1000, 1000],
          [0, 1000],
        ],
      },
    };
    expect(evaluateSurfaceField(spec, 500, 500)).toBe(1);
    expect(evaluateSurfaceField(spec, 1500, 500)).toBeNull();
  });
});

describe('generateSurfaceValues', () => {
  it('encodes depth-normalized against the realized max, with the sentinel', () => {
    const g = generateSurfaceValues(dipping, header, worldPosition);

    expect(g.covered).toBe(NX * NY);
    // the grid spans +/- 4000 in X at 0.01 dip about a 1000 m base
    expect(g.min).toBeCloseTo(960, 4);
    expect(g.max).toBeCloseTo(1040, 4);

    // `value = max - depth`, so the DEEPEST sample is 0 and values are in [0, span]
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of g.values) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    expect(lo).toBeCloseTo(0, 4);
    expect(hi).toBeCloseTo(g.max - g.min, 4);
  });

  it('recovers the field: max - value is the depth at that node', () => {
    const g = generateSurfaceValues(dipping, header, worldPosition);
    // node (0, ny-1) is the grid origin, i.e. `worldPosition`
    const i = (NY - 1) * NX;
    const expected = evaluateSurfaceField(dipping, ...worldPosition)!;
    expect(g.max - g.values[i]).toBeCloseTo(expected, 3);
  });

  it('writes the null sentinel where there is no data, and honours a custom one', () => {
    const spec: SurfaceFieldSpec = {
      base: 100,
      holes: [{ kind: 'ellipse', center: [0, 0], radius: 1000 }],
    };
    const g = generateSurfaceValues(spec, header, worldPosition);
    expect(g.covered).toBeLessThan(NX * NY);
    expect(g.nullValue).toBe(-1);
    expect(Array.from(g.values).some(v => v === -1)).toBe(true);

    const custom = generateSurfaceValues(spec, header, worldPosition, -999);
    expect(Array.from(custom.values).some(v => v === -999)).toBe(true);
    expect(Array.from(custom.values).some(v => v === -1)).toBe(false);
  });

  it('is deterministic — the same spec generates identical values', () => {
    const spec: SurfaceFieldSpec = {
      base: 900,
      relief: [
        { amplitude: 50, featureSize: 3000, seed: 7 },
        { kind: 'ridges', amplitude: 20, featureSize: 900, seed: 3 },
      ],
    };
    const a = generateSurfaceValues(spec, header, worldPosition);
    const b = generateSurfaceValues(spec, header, worldPosition);
    expect(Array.from(a.values)).toEqual(Array.from(b.values));
    expect(a.min).toBe(b.min);
    expect(a.max).toBe(b.max);
  });

  it('returns an all-null grid rather than throwing when nothing is mapped', () => {
    const spec: SurfaceFieldSpec = {
      base: 100,
      boundary: { kind: 'rect', min: [100000, 100000], max: [200000, 200000] },
    };
    const g = generateSurfaceValues(spec, header, worldPosition);
    expect(g.covered).toBe(0);
    expect(Array.from(g.values).every(v => v === -1)).toBe(true);
  });
});

describe('generated surfaces read back through buildStackReference', () => {
  const outline = new PlanarPolygonGeometry(
    [
      [
        [
          [-3500, -3500],
          [3500, -3500],
          [3500, 3500],
          [-3500, 3500],
          [-3500, -3500],
        ],
      ],
    ],
    [0, 0],
  );

  it('produces a coverage mask matching the spec', () => {
    const hole = {
      kind: 'ellipse' as const,
      center: [0, 0] as [number, number],
      radius: 1000,
    };
    const spec: SurfaceFieldSpec = { base: 1000, holes: [hole] };
    const g = generateSurfaceValues(spec, header, worldPosition);

    const reference = buildStackReference(
      [
        {
          values: g.values,
          header,
          referenceDepth: g.max,
          worldPosition,
        },
      ],
      outline,
    )!;

    expect(reference).not.toBeNull();
    const mask = reference.masks[0];
    let covered = 0;
    for (const m of mask) covered += m;

    // The outline covers ~49 km^2 and the hole removes ~pi km^2 of it, so a little
    // over 90% should survive — enough to show the hole reached the mask, and to
    // catch a sentinel that was read as a depth (which would give full coverage).
    const fraction = covered / mask.length;
    expect(fraction).toBeGreaterThan(0.85);
    expect(fraction).toBeLessThan(0.98);
  });

  it('decodes the depths it was given', () => {
    const spec: SurfaceFieldSpec = {
      base: 1234,
      dip: { azimuth: 90, gradient: 0 },
    };
    const g = generateSurfaceValues(spec, header, worldPosition);

    const reference = buildStackReference(
      [{ values: g.values, header, referenceDepth: g.max, worldPosition }],
      outline,
    )!;

    // scene Y is upwards-positive, so a constant 1234 m depth is y = -1234
    const channel = reference.channels[0];
    for (let i = 0; i < channel.length; i++) {
      expect(channel[i]).toBeCloseTo(-1234, 3);
    }
  });
});

describe('synthetic surface scenarios', () => {
  it('generates every declared scenario with consistent meta and values', () => {
    expect(syntheticSurfaceIds.length).toBeGreaterThan(0);

    for (const id of syntheticSurfaceIds) {
      const surface = getSyntheticSurface(id);
      expect(surface, id).not.toBeNull();
      const { meta, values } = surface!;

      expect(values.length).toBe(meta.header.nx * meta.header.ny);
      expect(meta.max).toBeGreaterThanOrEqual(meta.min);

      // meta.max IS the referenceDepth, so every real sample must decode into
      // [min, max] — the check that meta and values describe one realization.
      // Aggregated rather than asserted per sample: 160k expect() calls per
      // scenario costs seconds, and reports nothing extra.
      let covered = 0;
      let lo = Infinity;
      let hi = -Infinity;
      for (const v of values) {
        if (v === -1) continue;
        covered++;
        const depth = meta.max - v;
        if (depth < lo) lo = depth;
        if (depth > hi) hi = depth;
      }
      expect(covered, `${id} has no data`).toBeGreaterThan(0);
      expect(lo, id).toBeCloseTo(meta.min, 3);
      expect(hi, id).toBeCloseTo(meta.max, 3);
    }
  });

  it('memoizes, so meta and values cannot come from different realizations', () => {
    const a = getSyntheticSurface(syntheticSurfaceIds[0]);
    const b = getSyntheticSurface(syntheticSurfaceIds[0]);
    expect(a).toBe(b);
  });

  it('gives the scenarios the coverage they were designed for', () => {
    const fraction = (id: string) => {
      const { values } = getSyntheticSurface(id)!;
      let covered = 0;
      for (const v of values) if (v !== -1) covered++;
      return covered / values.length;
    };

    // the control is mapped everywhere; the inset and the mismatch pair are not
    expect(fraction('synthetic:flat')).toBe(1);
    expect(fraction('synthetic:inset')).toBeLessThan(0.95);
    expect(fraction('synthetic:holes')).toBeLessThan(1);
    expect(fraction('synthetic:mismatchB')).toBeLessThan(
      fraction('synthetic:mismatchA'),
    );
  });
});
