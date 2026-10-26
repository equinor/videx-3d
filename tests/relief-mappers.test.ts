import { describe, expect, it } from 'vitest';
import { clipReliefToOutline } from '../src/sdk/data/relief/clip-relief';
import { functionRelief } from '../src/sdk/data/relief/function-relief';
import { gridToRelief } from '../src/sdk/data/relief/grid-to-relief';
import { irapbinToRelief } from '../src/sdk/data/relief/irapbin-to-relief';
import {
  reliefLevelToNode,
  reliefNodeToMap,
  reliefWindow,
} from '../src/sdk/data/relief/relief-window';
import { stackLayerToRelief } from '../src/sdk/data/relief/stack-layer-to-relief';
import { surfaceToRelief } from '../src/sdk/data/relief/surface-to-relief';
import type { SurfaceMeta } from '../src/sdk/data/types/SurfaceMeta';
import { evaluateRelief } from '../src/sdk/geometries/procedural-relief';
import { surfaceGridToWorld } from '../src/sdk/geometries/surface-grid';
import {
  IRAPBIN_UNDEFINED,
  parseIrapbin,
  readIrapbin,
} from '../src/sdk/utils/irapbin-parser';

const UTM = '+proj=utm +zone=31 +datum=WGS84 +units=m +no_defs';

// An IRAP binary grid as IRAP writes one: big-endian Fortran records, the header's three
// and then the values, rows from the south, `perRecord` values a record.
function irapbin(
  header: {
    nx: number;
    ny: number;
    xori: number;
    yori: number;
    xinc: number;
    yinc: number;
    rot?: number;
  },
  values: number[],
  perRecord = 5,
): ArrayBuffer {
  const words: { type: 'i' | 'f'; value: number }[] = [];
  const record = (items: { type: 'i' | 'f'; value: number }[]) => {
    words.push({ type: 'i', value: items.length * 4 });
    words.push(...items);
    words.push({ type: 'i', value: items.length * 4 });
  };
  const i = (value: number) => ({ type: 'i' as const, value });
  const f = (value: number) => ({ type: 'f' as const, value });
  const { nx, ny, xori, yori, xinc, yinc, rot = 0 } = header;
  record([
    i(-996),
    i(ny),
    f(xori),
    f(xori + (nx - 1) * xinc),
    f(yori),
    f(yori + (ny - 1) * yinc),
    f(xinc),
    f(yinc),
  ]);
  record([i(nx), f(rot), f(xori), f(yori)]);
  record(Array.from({ length: 7 }, () => i(0)));
  for (let k = 0; k < values.length; k += perRecord) {
    record(values.slice(k, k + perRecord).map(f));
  }
  const view = new DataView(new ArrayBuffer(words.length * 4));
  words.forEach(({ type, value }, k) =>
    type === 'i'
      ? view.setInt32(k * 4, value, false)
      : view.setFloat32(k * 4, value, false),
  );
  return view.buffer;
}

// 4 x 3 depths, rows from the south: the south row 100.., the north row 300...
const NX = 4;
const NY = 3;
const DEPTHS = [
  100,
  101,
  102,
  103,
  200,
  IRAPBIN_UNDEFINED,
  202,
  203,
  300,
  301,
  302,
  303,
];
const HEADER = {
  nx: NX,
  ny: NY,
  xori: 431000,
  yori: 6476000,
  xinc: 25,
  yinc: 50,
  rot: 30,
};

describe('readIrapbin', () => {
  it('reads the header and the values as stored, across records', () => {
    const { header, values } = readIrapbin(irapbin(HEADER, DEPTHS, 5));
    expect(header).toMatchObject({
      nx: NX,
      ny: NY,
      xori: 431000,
      yori: 6476000,
      xinc: 25,
      yinc: 50,
      rot: 30,
    });
    expect(Array.from(values)).toEqual(DEPTHS);
  });

  it('leaves parseIrapbin as it was: rows from the north, a null for none', async () => {
    const values = [...DEPTHS];
    values[1] = 0;
    const { data } = await parseIrapbin(
      new Blob([irapbin(HEADER, values, 3)]),
      -1,
      1000,
    );
    // The north row first; at or below 1e-30, or past 1e30, is none.
    expect(Array.from(data.slice(0, NX))).toEqual([700, 699, 698, 697]);
    expect(data[2 * NX + 1]).toBe(-1);
    // The undefined value is below 1e30: parseIrapbin keeps it, as it always has.
    expect(data[NX + 1]).toBe(1000 - IRAPBIN_UNDEFINED);
  });
});

describe('irapbinToRelief', () => {
  it('turns depths into heights, rows from the north, its undefined value none', () => {
    const relief = irapbinToRelief(irapbin(HEADER, DEPTHS), {
      id: 'irap',
      name: 'Irap',
      crs: UTM,
    });
    expect(relief.meta.grid).toEqual({
      origin: [431000, 6476000],
      cell: [25, 50],
      size: [NX, NY],
      rotation: 30,
    });
    expect(Array.from(relief.values.slice(0, NX))).toEqual([
      -300, -301, -302, -303,
    ]);
    expect(Array.from(relief.values.slice(2 * NX))).toEqual([
      -100, -101, -102, -103,
    ]);
    expect(relief.values[NX + 1]).toBeNaN();
    expect(relief.meta.min).toBe(-303);
    expect(relief.meta.max).toBe(-100);
  });

  it('keeps heights as they are with `depth: false`, shifted by `offset`', () => {
    const relief = irapbinToRelief(irapbin(HEADER, DEPTHS), {
      id: 'irap',
      name: 'Irap',
      crs: UTM,
      depth: false,
      offset: -2,
    });
    expect(relief.values[0]).toBe(298);
  });
});

describe('surfaceToRelief', () => {
  // A surface rotated as the demo's generated seabed is.
  const header = {
    nx: 5,
    ny: 4,
    xori: 432000,
    yori: 6477000,
    xinc: 25,
    yinc: 25,
    rot: 220,
    xmax: 0,
    ymax: 0,
  };
  const meta: SurfaceMeta = {
    id: 'seabed',
    name: 'Seabed',
    projection: UTM,
    min: 80,
    max: 120,
    displayMin: 80,
    displayMax: 120,
    color: 'black',
    visualization: 'depth',
    header,
  };

  it('decodes the store encoding into heights', () => {
    // depth = max − value; −1 is none.
    const values = new Float32Array(header.nx * header.ny).fill(20);
    values[3] = -1;
    values[7] = 40;
    const relief = surfaceToRelief(meta, values);
    expect(relief.values[0]).toBe(-100);
    expect(relief.values[7]).toBe(-80);
    expect(relief.values[3]).toBeNaN();
    expect(relief.meta.crs).toBe(UTM);
    expect(relief.meta.id).toBe('seabed');
    expect(
      surfaceToRelief({ ...meta, projection: '31N' }, values, { crs: UTM }).meta
        .crs,
    ).toBe(UTM);
  });

  it('lays each node where the surface is drawn', () => {
    const relief = surfaceToRelief(
      meta,
      new Float32Array(header.nx * header.ny),
    );
    // A scene with its origin at map (0, 0), X east and Z south, as `UtmArea` places
    // it: the surface is drawn from its SW node.
    const toScene = surfaceGridToWorld(header, [header.xori, -header.yori]);
    for (const [col, row] of [
      [0, 0],
      [4, 3],
      [2, 1],
      [0, 3],
    ]) {
      const [sx, sz] = toScene(col, row);
      const [x, y] = reliefNodeToMap(relief.meta, col, row);
      expect(x).toBeCloseTo(sx, 6);
      expect(y).toBeCloseTo(-sz, 6);
    }
  });
});

describe('functionRelief', () => {
  const grid = {
    origin: [1000, 2000] as [number, number],
    cell: [10, 20] as [number, number],
    size: [9, 7] as [number, number],
  };
  const plane = (x: number, y: number) => 0.5 * x - 0.25 * y + 7;

  it('is the function itself where a reader places each value, at every level', () => {
    const computed = functionRelief(
      { id: 'f', name: 'F', crs: UTM, grid },
      plane,
    );
    // The same plane held whole: the same at its nodes, and inside the grid at each level.
    const held = gridToRelief(
      {
        values: Array.from({ length: 63 }, (_, k) => {
          const col = k % 9;
          const row = Math.floor(k / 9);
          return plane(1000 + col * 10, 2000 + (6 - row) * 20);
        }),
        size: [9, 7],
        origin: grid.origin,
        cell: grid.cell,
        crs: UTM,
      },
      { id: 'h', name: 'H' },
    );
    for (const window of [
      {
        level: 0,
        first: [0, 0] as [number, number],
        count: [9, 7] as [number, number],
      },
      {
        level: 1,
        first: [-1, 1] as [number, number],
        count: [7, 4] as [number, number],
      },
      {
        level: 2,
        first: [0, 0] as [number, number],
        count: [3, 2] as [number, number],
      },
    ]) {
      const { level, first, count } = window;
      const [w, h] = [Math.ceil(9 / 2 ** level), Math.ceil(7 / 2 ** level)];
      const a = computed.window(window);
      const b = reliefWindow(held, window);
      expect(a.length).toBe(count[0] * count[1]);
      // Per value: NaN past the level's edge, else the plane where it is placed; and
      // the held level's value where both average the same nodes (away from the edge).
      let pastEdge = 0;
      let worst = 0;
      let worstHeld = 0;
      for (let k = 0; k < a.length; k++) {
        const col = first[0] + (k % count[0]);
        const row = first[1] + Math.floor(k / count[0]);
        if (col < 0 || row < 0 || col >= w || row >= h) {
          pastEdge += Number.isNaN(a[k]) ? 0 : 1;
          continue;
        }
        const [c, r] = reliefLevelToNode(level, col, row);
        const [x, y] = reliefNodeToMap(computed.meta, c, r);
        worst = Math.max(worst, Math.abs(a[k] - plane(x, y)));
        const inside =
          (col + 1) * 2 ** level <= 9 && (row + 1) * 2 ** level <= 7;
        worstHeld = Math.max(worstHeld, inside ? Math.abs(a[k] - b[k]) : 0);
      }
      expect(pastEdge).toBe(0);
      expect(worst).toBeLessThan(1e-4);
      expect(worstHeld).toBeLessThan(1e-4);
    }
    expect(computed.meta.min).toBeCloseTo(held.meta.min, 4);
    expect(computed.meta.max).toBeCloseTo(held.meta.max, 4);
  });

  it('takes a height that is not finite as none, and the range it is given', () => {
    const computed = functionRelief(
      { id: 'f', name: 'F', crs: UTM, grid, min: -5, max: 5 },
      x => (x < 1040 ? NaN : 1),
    );
    const values = computed.window({ level: 0, first: [0, 0], count: [9, 1] });
    expect(values[0]).toBeNaN();
    expect(values[8]).toBe(1);
    expect(computed.meta.min).toBe(-5);
    expect(computed.meta.max).toBe(5);
  });
});

describe('clipReliefToOutline', () => {
  // 11 x 11 nodes, 10 apart, from map (0, 0): height = x.
  const relief = gridToRelief(
    {
      values: Array.from({ length: 121 }, (_, k) => (k % 11) * 10),
      size: [11, 11],
      origin: [0, 0],
      cell: [10, 10],
      crs: UTM,
    },
    { id: 'r', name: 'R' },
  );
  const square = (x0: number, y0: number, x1: number, y1: number) =>
    [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ] as [number, number][];
  const kept = (values: Float32Array) =>
    Array.from(values).filter(v => !Number.isNaN(v)).length;

  it('keeps what lies inside a ring, and its range', () => {
    const clipped = clipReliefToOutline(relief, square(15, 15, 65, 45));
    // Columns 2..6 (x 20..60), rows of y 20..40.
    expect(kept(clipped.values)).toBe(5 * 3);
    expect(clipped.meta.min).toBe(20);
    expect(clipped.meta.max).toBe(60);
    // The original is left as it was.
    expect(kept(relief.values)).toBe(121);
  });

  it('leaves out a polygon\u2019s holes', () => {
    const clipped = clipReliefToOutline(relief, [
      [square(-1, -1, 101, 101), square(35, 35, 65, 65)],
    ]);
    expect(kept(clipped.values)).toBe(121 - 9);
  });
});

describe('stackLayerToRelief', () => {
  const frame = {
    projection: UTM,
    origin: [431000, 6476000] as [number, number],
  };
  const grid = {
    origin: [429000, 6474000] as [number, number],
    cell: [100, 100] as [number, number],
    size: [41, 41] as [number, number],
  };

  it('is the layer\u2019s plane where it has no relief', () => {
    const baked = stackLayerToRelief({ depth: 95 }, frame, {
      id: 's',
      name: 'S',
      grid,
    });
    const values = baked.window({ level: 0, first: [0, 0], count: [41, 41] });
    expect(values.every(v => v === -95)).toBe(true);
    expect(baked.meta.min).toBe(-95);
    expect(baked.meta.crs).toBe(UTM);
  });

  it('evaluates the layer\u2019s relief in its own scene', () => {
    const relief = {
      kind: 'dome' as const,
      center: [1000, -1000] as [number, number],
      radius: 800,
      amplitude: 60,
      mode: 'above' as const,
    };
    const baked = stackLayerToRelief({ depth: 100, relief }, frame, {
      id: 's',
      name: 'S',
      grid,
    });
    // Scene (1000, −1000) is map (432000, 6477000): node (30, 10) from the north.
    const [top] = baked.window({ level: 0, first: [30, 10], count: [1, 1] });
    expect(top).toBeCloseTo(-100 + evaluateRelief(relief, 1000, -1000), 6);
    expect(top).toBeCloseTo(-40, 6);
    const [flat] = baked.window({ level: 0, first: [0, 0], count: [1, 1] });
    expect(flat).toBeCloseTo(-100, 6);
  });

  it('refuses a layer hung from the one above it', () => {
    expect(() =>
      stackLayerToRelief({ offset: 50 }, frame, { id: 's', name: 'S', grid }),
    ).toThrow(/offset/);
  });
});
