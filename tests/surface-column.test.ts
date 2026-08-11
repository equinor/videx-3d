import { describe, expect, it } from 'vitest';
import { surfaceGridToWorld } from '../src/sdk/geometries/surface-clip';
import {
  ColumnSpec,
  columnSurfaces,
  evaluateColumn,
  generateColumn,
} from '../src/sdk/geometries/surface-column';

const GRID = {
  header: { nx: 40, ny: 40, xinc: 100, yinc: 100, rot: 0 },
  worldPosition: [-2000, -2000] as [number, number],
};

// ⚠️ Ask the real mapping where a node lands rather than restating it: rows do
// NOT run in +Z (`z = worldPosition[1] - (ny - 1 - row) * yinc`).
const NODE = surfaceGridToWorld(GRID.header, GRID.worldPosition);
const CENTRE = NODE(GRID.header.nx / 2, GRID.header.ny / 2);

/** depth of layer `name` at (x, z) */
const depthOf = (spec: ColumnSpec, name: string, x: number, z: number) => {
  const names = columnSurfaces(spec).map(s => s.name);
  const at = names.indexOf(name);
  expect(at).toBeGreaterThanOrEqual(0);
  return evaluateColumn(spec, x, z)[at];
};

describe('evaluateColumn', () => {
  const spec = (): ColumnSpec => ({
    basement: { base: 2400, dip: { azimuth: 90, gradient: 0.1 } },
    steps: [
      { name: 'A', drape: 100 },
      { name: 'B', fill: 1, datum: 2000 },
      { name: 'C', drape: 50 },
    ],
    grid: GRID,
  });

  it('reports its surfaces shallowest first, basement last', () => {
    expect(columnSurfaces(spec()).map(s => s.name)).toEqual([
      'C',
      'B',
      'A',
      'Basement',
    ]);
  });

  it('drape lays a constant thickness, carrying the structure upward', () => {
    const s = spec();
    for (const x of [-1500, 0, 1500]) {
      const base = depthOf(s, 'Basement', x, 0)!;
      expect(depthOf(s, 'A', x, 0)).toBeCloseTo(base - 100, 6);
    }
  });

  it('⭐ fill levels toward the datum, and PINCHES OUT where the high is above it', () => {
    const s: ColumnSpec = {
      // dips 0.1 m/m along +X: shallow on one side, deep on the other
      basement: { base: 2000, dip: { azimuth: 90, gradient: 0.1 } },
      steps: [{ name: 'Fill', fill: 1, datum: 2000 }],
      grid: GRID,
    };

    // deep side: the unit fills all the way up to the datum
    const deep = depthOf(s, 'Basement', 1500, 0)!;
    expect(deep).toBeGreaterThan(2000);
    expect(depthOf(s, 'Fill', 1500, 0)).toBeCloseTo(2000, 6);

    // shallow side: nothing to fill, so the unit has NO thickness at all
    const high = depthOf(s, 'Basement', -1500, 0)!;
    expect(high).toBeLessThan(2000);
    expect(depthOf(s, 'Fill', -1500, 0)).toBeCloseTo(high, 6);
  });

  it('never gives a unit negative thickness, however rough its relief', () => {
    const s: ColumnSpec = {
      basement: { base: 2000 },
      steps: [
        { name: 'Thin', drape: 1, relief: [{ amplitude: 400, seed: 3 }] },
      ],
      grid: GRID,
    };

    for (let x = -1900; x <= 1900; x += 137) {
      const base = depthOf(s, 'Basement', x, 0)!;
      expect(depthOf(s, 'Thin', x, 0)!).toBeLessThanOrEqual(base + 1e-9);
    }
  });

  it('stays monotone: every surface is at or above the one below it', () => {
    const s = spec();
    for (let x = -1900; x <= 1900; x += 211) {
      const depths = evaluateColumn(s, x, 0).map(d => d!);
      for (let i = 1; i < depths.length; i++) {
        expect(depths[i - 1]).toBeLessThanOrEqual(depths[i] + 1e-9);
      }
    }
  });
});

describe('erosion', () => {
  const eroded = (encoding: 'mask' | 'clip'): ColumnSpec => ({
    basement: { base: 2400 },
    steps: [
      { name: 'Old', drape: 300 },
      {
        kind: 'erosion',
        name: 'Unconformity',
        surface: { base: 2250 },
        encoding,
      },
      { name: 'Young', drape: 100 },
    ],
    grid: GRID,
  });

  it('mask (the default): the truncated horizon simply has NO DATA', () => {
    const s = eroded('mask');
    // Old sat at 2100, above the unconformity at 2250, so it was removed
    expect(depthOf(s, 'Old', 0, 0)).toBeNull();
    expect(depthOf(s, 'Unconformity', 0, 0)).toBeCloseTo(2250, 6);
  });

  it('clip: the truncated horizon is pushed onto the unconformity', () => {
    const s = eroded('clip');
    expect(depthOf(s, 'Old', 0, 0)).toBeCloseTo(2250, 6);
  });

  it('deposition resumes ON the unconformity, which is what makes it angular', () => {
    // a TILTED unconformity over a flat column: the units above it are flat, the
    // ones below are cut at an angle
    const s: ColumnSpec = {
      basement: { base: 2400 },
      steps: [
        { name: 'Old', drape: 300 },
        {
          kind: 'erosion',
          name: 'Unconformity',
          surface: { base: 2200, dip: { azimuth: 90, gradient: 0.05 } },
        },
        { name: 'Young', drape: 100 },
      ],
      grid: GRID,
    };

    for (const x of [-1000, 0, 1000]) {
      const unc = depthOf(s, 'Unconformity', x, 0)!;
      expect(depthOf(s, 'Young', x, 0)).toBeCloseTo(unc - 100, 6);
    }
    // and the cut really is at an angle
    expect(depthOf(s, 'Unconformity', -1000, 0)).not.toBeCloseTo(
      depthOf(s, 'Unconformity', 1000, 0)!,
      3,
    );
  });
});

describe('faults', () => {
  const faulted = (halfLength?: number): ColumnSpec => ({
    basement: { base: 2400 },
    steps: [
      { name: 'A', drape: 200 },
      { name: 'B', drape: 200 },
      {
        kind: 'fault',
        at: [0, 0],
        azimuth: 0, // strikes along Z, so the throw is across X
        throw: 300,
        ramp: 200,
        halfLength,
      },
      { name: 'C', drape: 100 },
    ],
    grid: GRID,
  });

  it('lifts one side and leaves the other, by the full throw', () => {
    const s = faulted();
    const left = depthOf(s, 'A', -1500, 0)!;
    const right = depthOf(s, 'A', 1500, 0)!;
    expect(left - right).toBeCloseTo(300, 6);
  });

  it('⭐ carries the surfaces ACROSS the plane as a ramp — no break, no gap', () => {
    const s = faulted();
    // every sample across the fault exists, and the step is spread over the ramp
    let previous = depthOf(s, 'A', -400, 0)!;
    for (let x = -380; x <= 400; x += 20) {
      const d = depthOf(s, 'A', x, 0);
      expect(d).not.toBeNull();
      expect(d!).toBeLessThanOrEqual(previous + 1e-9);
      previous = d!;
    }
  });

  it('moves every surface deposited BEFORE it, and none after', () => {
    const s = faulted();
    const throwOf = (name: string) =>
      depthOf(s, name, -1500, 0)! - depthOf(s, name, 1500, 0)!;

    expect(throwOf('Basement')).toBeCloseTo(300, 6);
    expect(throwOf('B')).toBeCloseTo(300, 6);
    // C was laid down afterwards: it drapes the faulted topography, so its own
    // relief still shows the step — but it is not displaced any further
    expect(throwOf('C')).toBeCloseTo(300, 6);
  });

  it('⭐⭐ juxtaposes units: at one depth, different units on either side', () => {
    const s = faulted();
    const at = (x: number) =>
      evaluateColumn(s, x, 0).map(d => (d === null ? Infinity : d));
    const unitAt = (x: number, depth: number) =>
      at(x).findIndex(d => d >= depth);

    // 2150 m sits inside different units on the two sides of the fault
    expect(unitAt(-1500, 2150)).not.toBe(unitAt(1500, 2150));
  });

  it('dies out along strike when a half-length is given', () => {
    const s = faulted(800);
    const across = (z: number) =>
      depthOf(s, 'A', -1500, z)! - depthOf(s, 'A', 1500, z)!;

    expect(across(0)).toBeCloseTo(300, 6);
    expect(across(700)).toBeGreaterThan(0);
    expect(across(700)).toBeLessThan(300);
    expect(across(1200)).toBeCloseTo(0, 6);
  });
});

describe('variation', () => {
  const base: ColumnSpec = {
    basement: {
      base: 2400,
      relief: [{ amplitude: 300, seed: 2, featureSize: 2000 }],
    },
    steps: [
      { name: 'A', drape: 100, relief: [{ amplitude: 50, seed: 5 }] },
      {
        kind: 'erosion',
        name: 'Unconformity',
        surface: { base: 2200 },
      },
      { name: 'B', drape: 80 },
    ],
    grid: GRID,
  };

  it('seed re-rolls the structure without changing the architecture', () => {
    const a = generateColumn(base);
    const b = generateColumn({ ...base, seed: 17 });

    // same units, same order, same grid
    expect(b.map(s => s.name)).toEqual(a.map(s => s.name));
    // ...but a different realization
    expect(Array.from(b[b.length - 1].values)).not.toEqual(
      Array.from(a[a.length - 1].values),
    );
  });

  it('the same seed gives the same column twice', () => {
    const a = generateColumn({ ...base, seed: 4 });
    const b = generateColumn({ ...base, seed: 4 });
    expect(Array.from(b[0].values)).toEqual(Array.from(a[0].values));
  });

  it('erosionEncoding sets the default, and a step still overrides it', () => {
    // No relief anywhere, so the depths are exact: A lands at 2300 and the
    // unconformity at 2350 is DEEPER, so A is the horizon it removes.
    const flat: ColumnSpec = {
      basement: { base: 2400 },
      steps: [
        { name: 'A', drape: 100 },
        { kind: 'erosion', name: 'Unconformity', surface: { base: 2350 } },
        { name: 'B', drape: 80 },
      ],
      grid: GRID,
    };
    const a = columnSurfaces(flat)
      .map(s => s.name)
      .indexOf('A');

    expect(
      evaluateColumn({ ...flat, erosionEncoding: 'mask' }, 0, 0)[a],
    ).toBeNull();
    expect(
      evaluateColumn({ ...flat, erosionEncoding: 'clip' }, 0, 0)[a],
    ).toBeCloseTo(2350, 6);

    const override: ColumnSpec = {
      ...flat,
      erosionEncoding: 'mask',
      steps: flat.steps.map(step =>
        step.kind === 'erosion' ? { ...step, encoding: 'clip' as const } : step,
      ),
    };
    expect(evaluateColumn(override, 0, 0)[a]).toBeCloseTo(2350, 6);
  });
});

describe('generateColumn', () => {
  const spec: ColumnSpec = {
    basement: { base: 2400, dip: { azimuth: 90, gradient: 0.05 } },
    steps: [
      { name: 'A', class: 'sand', drape: 150 },
      { name: 'B', class: 'shale', fill: 0.8, datum: 2000 },
    ],
    grid: GRID,
  };

  it('rasterizes in the storage encoding, shallowest first', () => {
    const surfaces = generateColumn(spec);

    expect(surfaces.map(s => s.name)).toEqual(['B', 'A', 'Basement']);
    expect(surfaces[0].class).toBe('shale');
    for (const s of surfaces) {
      expect(s.values).toHaveLength(GRID.header.nx * GRID.header.ny);
      expect(s.covered).toBe(GRID.header.nx * GRID.header.ny);
      // value = referenceDepth - depth, referenceDepth = the realized max
      expect(Math.min(...s.values)).toBeCloseTo(0, 4);
      expect(Math.max(...s.values)).toBeCloseTo(s.max - s.min, 4);
    }
  });

  it('agrees with evaluateColumn node for node', () => {
    const surfaces = generateColumn(spec);
    const { nx } = GRID.header;

    for (const [col, row] of [
      [0, 0],
      [7, 13],
      [nx - 1, 5],
    ]) {
      const [x, z] = NODE(col, row);
      const expected = evaluateColumn(spec, x, z);
      surfaces.forEach((s, i) => {
        const value = s.values[row * nx + col];
        expect(s.max - value).toBeCloseTo(expected[i]!, 3);
      });
    }
  });

  it('writes the null sentinel where a unit is not mapped, and only there', () => {
    const inset: ColumnSpec = {
      ...spec,
      steps: [
        {
          name: 'Inset',
          drape: 150,
          boundary: { kind: 'ellipse', center: CENTRE, radius: 1200 },
        },
      ],
    };

    const [top] = generateColumn(inset);
    expect(top.covered).toBeGreaterThan(0);
    expect(top.covered).toBeLessThan(GRID.header.nx * GRID.header.ny);
    expect([...top.values].filter(v => v === top.nullValue).length).toBe(
      GRID.header.nx * GRID.header.ny - top.covered,
    );
  });

  it('⚠️ an extent is an EMISSION property: it does not change what is deposited', () => {
    const withExtent: ColumnSpec = {
      ...spec,
      steps: [
        {
          ...(spec.steps[0] as { name: string }),
          drape: 150,
          boundary: { kind: 'ellipse', center: CENTRE, radius: 1200 },
        },
        spec.steps[1],
      ],
    };

    // B sits on A whether or not anyone recorded A out there
    const plain = generateColumn(spec)[0];
    const limited = generateColumn(withExtent)[0];
    expect(Array.from(limited.values)).toEqual(Array.from(plain.values));
  });

  it('lets a surface use its own grid, and still relates it exactly', () => {
    const other = {
      header: { nx: 25, ny: 25, xinc: 160, yinc: 160, rot: 30 },
      worldPosition: [-2000, -2000] as [number, number],
    };
    const mixed: ColumnSpec = {
      ...spec,
      steps: [{ name: 'A', drape: 150, grid: other }, spec.steps[1]],
    };

    const surfaces = generateColumn(mixed);
    const a = surfaces.find(s => s.name === 'A')!;
    expect(a.header.nx).toBe(25);
    expect(a.header.rot).toBe(30);
    expect(a.covered).toBe(25 * 25);
  });
});
