import { describe, expect, it, vi } from 'vitest';
import { Box3, BufferAttribute, BufferGeometry, Vector3 } from 'three';
import * as tin from '../src/sdk/geometries/tin-sampler';
import {
  CapCullState,
  capOpenTable,
  capVisibilityKey,
  createCapView,
  createIntervalProbe,
  openIntervals,
  releaseCapView,
  visibleCapIndex,
} from '../src/components/Chunks/cap-visibility';
import {
  assembleChunk,
  SurfaceChunk,
  SurfaceChunkBoundary,
} from '../src/sdk/geometries/surface-chunk';
import {
  packSurfaceChunk,
  unpackSurfaceChunk,
} from '../src/sdk/geometries/surface-chunk-packing';
import {
  CAP_SIDE_OPEN,
  INTERVAL_FLAT,
  INTERVAL_MISSING,
  INTERVAL_PRESENT,
  stackCapNeighbours,
  stackIntervalStates,
  stackIntervalTriangles,
} from '../src/sdk/geometries/surface-stack';

const OPEN = CAP_SIDE_OPEN;

vi.mock('../src/sdk/geometries/tin-sampler', { spy: true });
// A quad as two triangles; every layer is constant over it.
const QUAD = new Uint32Array([0, 1, 2, 0, 2, 3]);
const level = (y: number) => new Float32Array(4).fill(y);

describe('stackIntervalStates', () => {
  it('tells a flat interval from a missing one', () => {
    const heights = [level(0), level(-10), level(-10), level(-30)];
    const states = stackIntervalStates(heights, QUAD, {
      // The deepest layer has no data over the first triangle.
      coverageTriangles: [
        new Uint8Array([1, 1]),
        new Uint8Array([1, 1]),
        new Uint8Array([1, 1]),
        new Uint8Array([0, 1]),
      ],
    });
    expect(Array.from(states[0])).toEqual([INTERVAL_PRESENT, INTERVAL_PRESENT]);
    expect(Array.from(states[1])).toEqual([INTERVAL_FLAT, INTERVAL_FLAT]);
    expect(Array.from(states[2])).toEqual([INTERVAL_MISSING, INTERVAL_PRESENT]);
  });

  it('collapses to the wall masks unchanged', () => {
    const heights = [level(0), level(-10), level(-10), level(-30)];
    expect(
      stackIntervalTriangles(heights, QUAD).map(m => Array.from(m)),
    ).toEqual([
      [1, 1],
      [0, 0],
      [1, 1],
    ]);
  });
});

describe('stackCapNeighbours', () => {
  // 0 ── filled ── 1 ═ flat ═ 2 ── filled ── 3 ── unfilled ── 4
  const heights = [level(0), level(-10), level(-10), level(-30), level(-40)];
  const fills = [true, true, true, false, false];

  it('steps over flat intervals and stops at an unfilled one', () => {
    const states = stackIntervalStates(heights, QUAD);
    const result = stackCapNeighbours(states, fills, QUAD);
    const at = (layer: number) => ({
      above: Array.from(result[layer]!.above),
      below: Array.from(result[layer]!.below),
    });
    expect(at(0)).toEqual({ above: [OPEN, OPEN], below: [0, 0] });
    // Below layer 1 the interval is flat, so the next solid unit is interval 2.
    expect(at(1)).toEqual({ above: [0, 0], below: [2, 2] });
    expect(at(2)).toEqual({ above: [0, 0], below: [2, 2] });
    expect(at(3)).toEqual({ above: [2, 2], below: [OPEN, OPEN] });
    expect(at(4)).toEqual({ above: [OPEN, OPEN], below: [OPEN, OPEN] });
    expect(result.map(r => r!.units)).toEqual([[0], [0, 2], [0, 2], [2], []]);
  });

  it('answers per KEPT triangle, in the order of the cap’s own index', () => {
    const states = stackIntervalStates(heights, QUAD);
    const kept = [null, null, new Uint32Array([0, 2, 3]), null, null];
    const result = stackCapNeighbours(states, fills, QUAD, kept);
    expect(result[2]!.above).toHaveLength(1);
    expect(result[2]!.below).toHaveLength(1);
  });

  it('opens a side where an interval is missing', () => {
    const states = stackIntervalStates(heights, QUAD, {
      coverageTriangles: [
        new Uint8Array([1, 1]),
        new Uint8Array([1, 1]),
        new Uint8Array([1, 1]),
        new Uint8Array([0, 1]),
        new Uint8Array([1, 1]),
      ],
    });
    const result = stackCapNeighbours(states, fills, QUAD);
    expect(Array.from(result[1]!.below)).toEqual([OPEN, 2]);
  });

  it('skips a layer without a cap', () => {
    const states = stackIntervalStates(heights, QUAD);
    const result = stackCapNeighbours(states, fills, QUAD, undefined, [
      true,
      false,
      true,
      true,
      true,
    ]);
    expect(result[1]).toBeNull();
    expect(result[0]).not.toBeNull();
  });

  it('matches a brute-force walk over random stacks', () => {
    let seed = 7;
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    // A 3×3 vertex grid: 8 triangles.
    const indices: number[] = [];
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < 2; c++) {
        const v = r * 3 + c;
        indices.push(v, v + 1, v + 4, v, v + 4, v + 3);
      }
    }
    const shared = new Uint32Array(indices);
    const threshold = 0.5;

    for (let run = 0; run < 50; run++) {
      const layers = 6;
      const stack: Float32Array[] = [];
      let previous = new Float32Array(9).fill(0);
      for (let l = 0; l < layers; l++) {
        const y = new Float32Array(9);
        for (let v = 0; v < 9; v++) {
          y[v] =
            l === 0 ? 0 : previous[v] - (random() < 0.4 ? 0 : 5 * random());
        }
        stack.push(y);
        previous = y;
      }
      const filled = stack.map(() => random() < 0.7);
      const kept = stack.map(() => {
        const subset: number[] = [];
        for (let t = 0; t < 8; t++) {
          if (random() < 0.6) subset.push(...indices.slice(3 * t, 3 * t + 3));
        }
        return new Uint32Array(subset);
      });

      const result = stackCapNeighbours(
        stackIntervalStates(stack, shared, { threshold }),
        filled,
        shared,
        kept,
      );

      const flat = (j: number, t: number) =>
        [0, 1, 2].every(
          k =>
            stack[j][shared[3 * t + k]] - stack[j + 1][shared[3 * t + k]] <=
            threshold,
        );
      const walk = (from: number, step: -1 | 1, t: number) => {
        for (let j = from; j >= 0 && j < layers - 1; j += step) {
          if (flat(j, t)) continue;
          return filled[j] ? j : OPEN;
        }
        return OPEN;
      };
      kept.forEach((subset, layer) => {
        let k = 0;
        for (let t = 0; t < 8 && k < subset.length / 3; t++) {
          if (subset[3 * k] !== shared[3 * t]) continue;
          if (subset[3 * k + 1] !== shared[3 * t + 1]) continue;
          expect(result[layer]!.above[k]).toBe(walk(layer - 1, -1, t));
          expect(result[layer]!.below[k]).toBe(walk(layer, 1, t));
          k++;
        }
      });
    }
  });
});

describe('cap visibility rules', () => {
  const boundaries: SurfaceChunkBoundary[] = [
    { layer: 0, ceiling: false, fill: true },
    { layer: 1, ceiling: false, fill: true },
    { layer: 2, ceiling: false, fill: false },
    // the carrier, past the caller's three layers
    { layer: 3, ceiling: true, fill: false },
  ];
  const state = (over: Partial<CapCullState> = {}): CapCullState => ({
    layers: [{}, {}, {}],
    surfaceOpacity: 1,
    wallOpacity: 1,
    wireframe: false,
    showWalls: true,
    top: 0,
    base: 3,
    cameraUnits: [],
    ...over,
  });

  it('opens unfilled, peeled, see-through and occupied units', () => {
    const plain = openIntervals(boundaries, state())!;
    expect([plain[0], plain[1], plain[2], plain[OPEN]]).toEqual([0, 0, 1, 1]);
    expect(openIntervals(boundaries, state({ top: 1 }))![0]).toBe(1);
    expect(openIntervals(boundaries, state({ base: 1 }))![1]).toBe(1);
    expect(openIntervals(boundaries, state({ cameraUnits: [1] }))![1]).toBe(1);
    const glass = openIntervals(boundaries, state({ wallOpacity: 0.5 }))!;
    expect([glass[0], glass[1]]).toEqual([1, 1]);
  });

  it('culls nothing under a transparent cap, wireframe or hidden walls', () => {
    expect(
      openIntervals(boundaries, state({ surfaceOpacity: 0.9 })),
    ).toBeNull();
    expect(
      openIntervals(boundaries, state({ layers: [{}, { opacity: 0.5 }, {}] })),
    ).toBeNull();
    expect(openIntervals(boundaries, state({ wireframe: true }))).toBeNull();
    expect(openIntervals(boundaries, state({ showWalls: false }))).toBeNull();
  });

  it('opens what a cut takes, around a cap that survives it', () => {
    const layers = [{}, { section: false }, {}];
    const open = openIntervals(boundaries, state({ layers }))!;
    const cut = { carrier: false, seaKept: false };
    // Cap 2 floors the kept unit 1, so it survives; unit 1 stays solid.
    const table = capOpenTable(open, boundaries, { layer: 2 }, layers, [cut]);
    expect([table[0], table[1], table[2]]).toEqual([1, 0, 1]);
    // Cap 0 is cut with everything around it: nothing changes.
    expect(capOpenTable(open, boundaries, { layer: 0 }, layers, [cut])).toBe(
      open,
    );
    // The floor survives a cut that leaves it whole, and goes with one that does not.
    const floor = { layer: 3, ceiling: true };
    expect(capOpenTable(open, boundaries, floor, [{}, {}, {}], [cut])[0]).toBe(
      1,
    );
    expect(
      capOpenTable(
        open,
        boundaries,
        floor,
        [{}, {}, {}],
        [{ carrier: true, seaKept: false }],
      ),
    ).toBe(open);
  });

  it('keeps a triangle when either side is open', () => {
    const table = new Uint8Array(OPEN + 1);
    table[OPEN] = 1;
    const above = new Uint8Array([0, OPEN]);
    const below = new Uint8Array([1, 1]);
    expect(Array.from(visibleCapIndex(QUAD, above, below, table))).toEqual([
      0, 2, 3,
    ]);
    table[1] = 1;
    // Everything visible: the cap's own index, not a copy.
    expect(visibleCapIndex(QUAD, above, below, table)).toBe(QUAD);
    table[1] = 0;
    table[OPEN] = 0;
    expect(visibleCapIndex(QUAD, above, below, table)).toHaveLength(0);
  });

  it('keys a cap only on the units it faces', () => {
    const surface = {
      above: new Uint8Array([0, OPEN]),
      below: new Uint8Array([1, 1]),
    };
    const table = new Uint8Array(OPEN + 1);
    const before = capVisibilityKey(surface, table);
    table[5] = 1;
    expect(capVisibilityKey(surface, table)).toBe(before);
    table[1] = 1;
    expect(capVisibilityKey(surface, table)).not.toBe(before);
    // The worker's list stands in for the scan.
    expect(capVisibilityKey({ ...surface, units: [0, 1] }, table)).toBe(
      capVisibilityKey(surface, table),
    );
  });
});

describe('cap views', () => {
  it('share the cap’s attributes and free only their own index', () => {
    const cap = new BufferGeometry();
    cap.setAttribute('xz', new BufferAttribute(new Float32Array(8), 2));
    cap.setAttribute('y', new BufferAttribute(new Float32Array(4), 1));
    cap.setIndex(new BufferAttribute(QUAD, 1));
    cap.boundingBox = new Box3(new Vector3(0, -1, 0), new Vector3(1, 0, 1));

    const view = createCapView(cap, new Uint32Array([0, 2, 3]));
    expect(view.getAttribute('xz')).toBe(cap.getAttribute('xz'));
    expect(view.getIndex()!.count).toBe(3);
    expect(view.boundingBox).not.toBe(cap.boundingBox);
    expect(view.boundingBox!.equals(cap.boundingBox)).toBe(true);

    // three frees every attribute still attached when `dispose` fires.
    let attachedAtDispose = -1;
    view.addEventListener('dispose', () => {
      attachedAtDispose = Object.keys(view.attributes).length;
    });
    releaseCapView(view);
    expect(attachedAtDispose).toBe(0);
    expect(cap.hasAttribute('xz')).toBe(true);
  });
});

describe('createIntervalProbe', () => {
  // Three caps over a 100 m quad at 0, -10 and -20.
  const capAt = (y: number, boundary: number) => {
    const geometry = new BufferGeometry();
    geometry.setAttribute(
      'xz',
      new BufferAttribute(
        new Float32Array([0, 0, 100, 0, 100, 100, 0, 100]),
        2,
      ),
    );
    geometry.setAttribute('y', new BufferAttribute(level(y), 1));
    geometry.setIndex(new BufferAttribute(QUAD, 1));
    geometry.boundingBox = new Box3(
      new Vector3(0, y, 0),
      new Vector3(100, y, 100),
    );
    return {
      geometry,
      layer: boundary,
      boundary,
      above: new Uint8Array(2),
      below: new Uint8Array(2),
    };
  };
  const chunk = (caps: number[]): SurfaceChunk => ({
    surfaces: caps.map(b => capAt(-10 * b, b)),
    walls: [],
    boundaries: [0, 1, 2].map(layer => ({ layer, ceiling: false, fill: true })),
    metrics: {} as SurfaceChunk['metrics'],
  });

  it('finds the interval around a point, widened by the band', () => {
    const probe = createIntervalProbe(chunk([0, 1, 2]));
    expect(probe(50, -5, 50, 0)).toEqual([0]);
    expect(probe(50, -15, 50, 0)).toEqual([1]);
    expect(probe(50, -9, 50, 2)).toEqual([0, 1]);
    // Outside the bounds, above or beside the block.
    expect(probe(50, 10, 50, 2)).toEqual([]);
    expect(probe(500, -5, 50, 2)).toEqual([]);
  });

  it('spans a boundary that has no cap here', () => {
    const probe = createIntervalProbe(chunk([0, 2]));
    expect(probe(50, -5, 50, 0)).toEqual([0, 1]);
  });

  it('builds one lookup grid, even off every cap and across probes', () => {
    // Every cap keeps only the lower-right triangle, so the box's upper-left
    // corner is inside the bounds and off every cap.
    const c = chunk([0, 1, 2]);
    c.surfaces.forEach(s =>
      s.geometry.setIndex(new BufferAttribute(new Uint32Array([0, 1, 2]), 1)),
    );
    const built = vi.mocked(tin.createTinSampler);
    built.mockClear();

    expect(createIntervalProbe(c)(10, -5, 90, 0)).toEqual([0, 1]);
    expect(createIntervalProbe({ ...c })(20, -5, 80, 0)).toEqual([0, 1]);
    expect(built).toHaveBeenCalledTimes(1);
  });
});

describe('carrying neighbours on a chunk', () => {
  it('survives packing, with the arrays in the transfer list', () => {
    const geometry = new BufferGeometry();
    geometry.setAttribute('y', new BufferAttribute(level(0), 1));
    geometry.setIndex(new BufferAttribute(QUAD, 1));
    const neighbours = {
      above: new Uint8Array([OPEN, OPEN]),
      below: new Uint8Array([0, 0]),
      units: [0],
    };
    const chunk = assembleChunk(
      [
        { geometry, rimY: [], fill: true, wall: null, neighbours },
        { geometry: null, rimY: [], fill: false, wall: null },
      ],
      [],
      {},
      { t0: 0, densifyMs: 0, clipMs: 0, rimMs: 0 },
    );
    expect(chunk.boundaries).toEqual([
      { layer: 0, ceiling: false, fill: true },
      { layer: 1, ceiling: false, fill: false },
    ]);
    expect(chunk.surfaces[0].boundary).toBe(0);

    const [packed, transfer] = packSurfaceChunk(chunk);
    expect(transfer).toContain(neighbours.above.buffer);
    expect(transfer).toContain(neighbours.below.buffer);
    const restored = unpackSurfaceChunk(packed);
    expect(restored.boundaries).toEqual(chunk.boundaries);
    expect(Array.from(restored.surfaces[0].below!)).toEqual([0, 0]);
    expect(restored.surfaces[0].units).toEqual([0]);
  });
});
