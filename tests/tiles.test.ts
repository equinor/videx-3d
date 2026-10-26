import { describe, expect, it, vi } from 'vitest';
import {
  PINNED_TILE_PRIORITY,
  QuadtreeTileInfo,
  selectPinnedTiles,
  selectQuadtreeTiles,
} from '../src/sdk/tiles/quadtree';
import {
  tileAddress,
  tileChildren,
  tileKey,
  tileKeyAt,
  tileParent,
  tileSquare,
} from '../src/sdk/tiles/tile-keys';
import { TileStreamer } from '../src/sdk/tiles/tile-streamer';

const ROOT = 1024;
// One pixel per unit at distance 1000, as a perspective camera falls off.
const ppu = (distance: number) => 1000 / Math.max(distance, 1);

// Every tile is in, with an error of a tenth of its width, flat at Y 0.
const everyTile =
  (leafDepth = 8) =>
  (key: number): QuadtreeTileInfo => {
    const [depth] = tileAddress(key);
    return {
      error: ROOT / 2 ** depth / 10,
      minY: 0,
      maxY: 0,
      leaf: depth >= leafDepth,
    };
  };

// How many of `keys` cover each point of a grid over the disc of `reach` about the eye,
// where `keep` holds.
function coverage(
  keys: number[],
  eye: [number, number],
  reach: number,
  keep: (x: number, z: number) => boolean = () => true,
) {
  const squares = keys.map(key => tileSquare(key, ROOT));
  const counts: number[] = [];
  const step = reach / 20;
  for (let z = eye[1] - reach; z <= eye[1] + reach; z += step) {
    for (let x = eye[0] - reach; x <= eye[0] + reach; x += step) {
      if (Math.hypot(x - eye[0], z - eye[1]) > reach * 0.99 || !keep(x, z))
        continue;
      counts.push(
        squares.filter(
          ([sx, sz, size]) =>
            sx <= x && x < sx + size && sz <= z && z < sz + size,
        ).length,
      );
    }
  }
  return counts;
}

function overlaps(keys: number[]) {
  const squares = keys.map(key => tileSquare(key, ROOT));
  for (let a = 0; a < squares.length; a++) {
    for (let b = a + 1; b < squares.length; b++) {
      const [ax, az, as] = squares[a];
      const [bx, bz, bs] = squares[b];
      if (ax < bx + bs && bx < ax + as && az < bz + bs && bz < az + as)
        return true;
    }
  }
  return false;
}

describe('tile keys', () => {
  it('round-trips a depth, column and row, either side of the origin', () => {
    for (const [d, i, j] of [
      [0, 0, 0],
      [3, -5, 7],
      [21, 2 ** 22, -(2 ** 22)],
      [31, -(2 ** 23), 2 ** 23 - 1],
    ]) {
      expect(tileAddress(tileKey(d, i, j))).toEqual([d, i, j]);
    }
  });

  it('finds a parent and its children', () => {
    const key = tileKey(4, -3, 5);
    expect(tileAddress(tileParent(key))).toEqual([3, -2, 2]);
    const children = tileChildren(key).map(tileAddress);
    expect(children).toEqual([
      [5, -6, 10],
      [5, -5, 10],
      [5, -6, 11],
      [5, -5, 11],
    ]);
    for (const child of tileChildren(key)) expect(tileParent(child)).toBe(key);
  });

  it('places a tile', () => {
    expect(tileSquare(tileKey(2, -1, 3), ROOT)).toEqual([-256, 768, 256]);
  });

  it('finds the tile holding a point, at any depth', () => {
    expect(tileAddress(tileKeyAt(2, -1, 800, ROOT))).toEqual([2, -1, 3]);
    // An edge belongs to the tile it starts.
    expect(tileAddress(tileKeyAt(2, 256, -256, ROOT))).toEqual([2, 1, -1]);
    expect(tileAddress(tileKeyAt(0, 1023.9, 0, ROOT))).toEqual([0, 0, 0]);
    for (const depth of [0, 3, 7]) {
      const [x, z, size] = tileSquare(tileKeyAt(depth, -300, 500, ROOT), ROOT);
      expect(x <= -300 && -300 < x + size && z <= 500 && 500 < z + size).toBe(
        true,
      );
    }
  });
});

describe('selectQuadtreeTiles', () => {
  // A tenth of a pixel per unit at distance 1000: tiles split only near the eye.
  const near = (distance: number) => 100 / Math.max(distance, 1);

  it('splits near the eye, and covers the reach once', () => {
    const { draw, want } = selectQuadtreeTiles({
      eye: [10, 50, 10],
      reach: 900,
      pixelsPerUnit: near,
      pixelError: 2,
      rootSize: ROOT,
      info: everyTile(),
    });
    expect(want).toEqual([]);
    expect(coverage(draw, [10, 10], 900).every(n => n === 1)).toBe(true);
    const depths = draw.map(key => tileAddress(key)[0]);
    const under = draw.find(key => {
      const [x, z, size] = tileSquare(key, ROOT);
      return x <= 10 && 10 < x + size && z <= 10 && 10 < z + size;
    })!;
    expect(tileAddress(under)[0]).toBe(Math.max(...depths));
    expect(Math.min(...depths)).toBeLessThan(tileAddress(under)[0]);
  });

  it('never splits a leaf, and stops at the deepest allowed', () => {
    const leaves = selectQuadtreeTiles({
      eye: [10, 1, 10],
      reach: 100,
      pixelsPerUnit: ppu,
      pixelError: 0.01,
      rootSize: ROOT,
      info: everyTile(3),
    });
    expect(Math.max(...leaves.draw.map(key => tileAddress(key)[0]))).toBe(3);
    const capped = selectQuadtreeTiles({
      eye: [10, 1, 10],
      reach: 100,
      pixelsPerUnit: ppu,
      pixelError: 0.01,
      rootSize: ROOT,
      maxDepth: 2,
      info: everyTile(),
    });
    expect(Math.max(...capped.draw.map(key => tileAddress(key)[0]))).toBe(2);
  });

  it('draws a tile until all its children in view are in, and wants those not in', () => {
    const info = everyTile();
    const missing = tileKey(1, 0, 0);
    const { draw, want } = selectQuadtreeTiles({
      eye: [10, 50, 10],
      reach: 100,
      pixelsPerUnit: ppu,
      pixelError: 2,
      rootSize: ROOT,
      info: key => (key === missing ? undefined : info(key)),
    });
    expect(draw).toContain(tileKey(0, 0, 0));
    expect(want.map(w => w.key)).toEqual([missing]);
    expect(want[0].priority).toBeGreaterThan(0);
    expect(overlaps(draw)).toBe(false);
  });

  it('wants a root that is not in, above everything', () => {
    const { draw, want } = selectQuadtreeTiles({
      eye: [10, 50, 10],
      reach: 100,
      pixelsPerUnit: ppu,
      pixelError: 2,
      rootSize: ROOT,
      info: () => undefined,
    });
    expect(draw).toEqual([]);
    expect(want.length).toBe(4);
    expect(want.every(w => w.priority === Infinity)).toBe(true);
  });

  it('merges back only once well under the limit', () => {
    const key = tileKey(0, 0, 0);
    // The root alone: its error shows as 1.8 px from where the eye is.
    const info = (k: number): QuadtreeTileInfo | undefined =>
      tileAddress(k)[0] > 1
        ? undefined
        : {
            error: tileAddress(k)[0] === 0 ? 1.8 : 0,
            minY: 0,
            maxY: 0,
            leaf: tileAddress(k)[0] === 1,
          };
    const options = {
      eye: [-1000, 0, 512] as [number, number, number],
      reach: 4000,
      pixelsPerUnit: ppu,
      pixelError: 2,
      rootSize: ROOT,
      info,
    };
    expect(selectQuadtreeTiles(options).split.has(key)).toBe(false);
    expect(
      selectQuadtreeTiles({ ...options, split: new Set([key]) }).split.has(key),
    ).toBe(true);
  });

  it('splits where the error is over a cap, whatever it shows', () => {
    const { draw } = selectQuadtreeTiles({
      eye: [3000, 10, 3000],
      reach: 6000,
      pixelsPerUnit: ppu,
      pixelError: 1000,
      rootSize: ROOT,
      info: everyTile(),
      errorCap: (minX, minZ) =>
        minX >= 0 && minX < 256 && minZ >= 0 && minZ < 256 ? 10 : Infinity,
    });
    const corner = draw.filter(key => {
      const [x, z] = tileSquare(key, ROOT);
      return x >= 0 && x < 256 && z >= 0 && z < 256;
    });
    expect(corner.length).toBeGreaterThan(0);
    for (const key of corner) {
      expect(ROOT / 2 ** tileAddress(key)[0] / 10).toBeLessThanOrEqual(10);
    }
    // Elsewhere nothing is split.
    expect(
      draw.filter(key => tileAddress(key)[0] === 0).length,
    ).toBeGreaterThan(100);
  });

  it('shows less error over finer squares', () => {
    const options = {
      eye: [3000, 10, 3000] as [number, number, number],
      reach: 6000,
      pixelsPerUnit: ppu,
      pixelError: 1000,
      rootSize: ROOT,
      info: everyTile(),
    };
    const square: [number, number, number, number] = [0, 0, 256, 256];
    const { draw, split } = selectQuadtreeTiles({
      ...options,
      finer: [{ bounds: square, pixelError: 2 }],
    });
    const over = (key: number) => {
      const [x, z, size] = tileSquare(key, ROOT);
      return x < 256 && z < 256 && x + size > 0 && z + size > 0;
    };
    const there = draw.filter(over);
    expect(there.length).toBeGreaterThan(1);
    // Each shows no more than 2 px at its nearest point: the eye is 3 km off.
    for (const key of there) {
      const [x, z, size] = tileSquare(key, ROOT);
      const nearest = Math.hypot(
        Math.max(x - 3000, 3000 - (x + size), 0),
        Math.max(z - 3000, 3000 - (z + size), 0),
        10,
      );
      expect((size / 10) * ppu(nearest)).toBeLessThanOrEqual(2);
    }
    // Outside the root it lies in, the choice is as without it.
    const outside = (key: number) => {
      const [x, z] = tileSquare(key, ROOT);
      return x < 0 || z < 0 || x >= ROOT || z >= ROOT;
    };
    const plain = selectQuadtreeTiles(options).draw.filter(outside).sort();
    expect(draw.filter(outside).sort()).toEqual(plain);
    // Merged back by the same rule: what was split stays split.
    const again = selectQuadtreeTiles({
      ...options,
      finer: [{ bounds: square, pixelError: 2 }],
      split,
    });
    expect(again.draw.sort()).toEqual([...draw].sort());
  });

  it('leaves out what is not in view', () => {
    const { draw } = selectQuadtreeTiles({
      eye: [10, 50, 10],
      reach: 900,
      pixelsPerUnit: near,
      pixelError: 2,
      rootSize: ROOT,
      info: everyTile(),
      inView: minX => minX >= 0,
    });
    expect(draw.every(key => tileSquare(key, ROOT)[0] >= 0)).toBe(true);
    expect(coverage(draw, [10, 10], 900, x => x >= 0).every(n => n === 1)).toBe(
      true,
    );
  });

  describe('with cellPixels', () => {
    // No error at all, as ground seen straight from above: only the cells split it.
    const flat =
      (leafDepth = 8) =>
      (key: number): QuadtreeTileInfo => ({
        error: 0,
        minY: 0,
        maxY: 0,
        leaf: tileAddress(key)[0] >= leafDepth,
      });
    // One pixel per unit at any distance, as an orthographic camera.
    const ortho = () => 1;
    const base = {
      eye: [10, 50, 10] as [number, number, number],
      reach: 100,
      pixelsPerUnit: ortho,
      pixelError: 2,
      rootSize: ROOT,
    };

    it('splits until a cell spans no more than the pixels allowed', () => {
      const plain = selectQuadtreeTiles({ ...base, info: flat() });
      expect(plain.draw.every(key => tileAddress(key)[0] === 0)).toBe(true);
      // 16 cells a side: a root's cells are 1024 / 16 = 64 px, and at depth d
      // 64 / 2^d px, so 4 px is reached at depth 4.
      const { draw } = selectQuadtreeTiles({
        ...base,
        info: flat(),
        cellPixels: { cells: 16, pixels: 4 },
      });
      expect(new Set(draw.map(key => tileAddress(key)[0]))).toEqual(
        new Set([4]),
      );
      expect(coverage(draw, [10, 10], 100).every(n => n === 1)).toBe(true);
    });

    it('stops at a leaf: there is nothing finer to show', () => {
      const { draw } = selectQuadtreeTiles({
        ...base,
        info: flat(2),
        cellPixels: { cells: 16, pixels: 4 },
      });
      expect(new Set(draw.map(key => tileAddress(key)[0]))).toEqual(
        new Set([2]),
      );
    });

    it('merges back only once well under the limit', () => {
      // A root's cells are 64 px. Allowing 30 splits it; allowing 66 does not, unless it
      // was split, which it then stays until under 66 by the margin (0.8 × 66 < 64)...
      // and allowing 81 merges it back (0.8 × 81 > 64).
      const key = tileKey(0, 0, 0);
      const one = (pixels: number, split?: Set<number>) =>
        selectQuadtreeTiles({
          ...base,
          eye: [10, 50, 10],
          info: flat(1),
          cellPixels: { cells: 16, pixels },
          split,
        }).split.has(key);
      expect(one(30)).toBe(true);
      expect(one(66)).toBe(false);
      expect(one(66, new Set([key]))).toBe(true);
      expect(one(81, new Set([key]))).toBe(false);
    });

    it('merges back what was split for its cells once they are left out', () => {
      // As under the ground, where the renderer stops asking for them.
      const split = selectQuadtreeTiles({
        ...base,
        info: flat(),
        cellPixels: { cells: 16, pixels: 4 },
      }).split;
      expect(split.size).toBeGreaterThan(0);
      const { draw } = selectQuadtreeTiles({ ...base, info: flat(), split });
      expect(draw.every(key => tileAddress(key)[0] === 0)).toBe(true);
    });

    it('wants the children it splits for, by how far over it is', () => {
      const info = flat();
      const { want } = selectQuadtreeTiles({
        ...base,
        info: key => (tileAddress(key)[0] > 0 ? undefined : info(key)),
        cellPixels: { cells: 16, pixels: 4 },
      });
      expect(want.length).toBeGreaterThan(0);
      // A root's cells are 64 px, 60 over.
      expect(want[0].priority).toBe(60);
    });

    it('leaves flat ground alone with a minSlope', () => {
      // An error of a tenth of a cell is a slope of 0.2; none at all is flat.
      const rough = (key: number): QuadtreeTileInfo => ({
        ...flat()(key),
        error: ROOT / 2 ** tileAddress(key)[0] / 16 / 10,
      });
      const options = { cells: 16, pixels: 4, minSlope: 0.1 };
      const onFlat = selectQuadtreeTiles({
        ...base,
        info: flat(),
        cellPixels: options,
      });
      expect(onFlat.draw.every(key => tileAddress(key)[0] === 0)).toBe(true);
      const onRough = selectQuadtreeTiles({
        ...base,
        // Its error alone never splits it.
        pixelError: 1000,
        info: rough,
        cellPixels: options,
      });
      expect(new Set(onRough.draw.map(key => tileAddress(key)[0]))).toEqual(
        new Set([4]),
      );
    });
  });
});

describe('selectPinnedTiles', () => {
  // The tiles in, each a leaf from `leafDepth` down.
  const inUpTo =
    (inDepth: number, leafDepth = 3) =>
    (key: number) => {
      const [depth] = tileAddress(key);
      return depth <= inDepth ? { leaf: depth >= leafDepth } : undefined;
    };
  const path = (x: number, z: number, deepest: number) =>
    Array.from({ length: deepest + 1 }, (_, d) => tileKeyAt(d, x, z, ROOT));

  it('keeps every tile under a pin down to its leaves', () => {
    const { keep, want } = selectPinnedTiles({
      squares: [[100, 100, 110, 110]],
      info: inUpTo(8),
      rootSize: ROOT,
    });
    expect(keep.sort()).toEqual(path(105, 105, 3).sort());
    expect(want).toEqual([]);
  });

  it('wants the first tile missing on each path, ahead of the view', () => {
    // Across the line between two tiles at depth 2 (256 wide).
    const { keep, want } = selectPinnedTiles({
      squares: [[250, 100, 260, 110]],
      info: inUpTo(1),
      rootSize: ROOT,
    });
    expect(keep.sort()).toEqual(path(255, 105, 1).sort());
    expect(want.map(w => w.key).sort()).toEqual(
      [tileKeyAt(2, 250, 105, ROOT), tileKeyAt(2, 260, 105, ROOT)].sort(),
    );
    expect(want.every(w => w.priority === PINNED_TILE_PRIORITY)).toBe(true);
  });

  it('follows every pin down its own path, however many share a root', () => {
    // Two pins under one root, apart from depth 1.
    const { keep, want } = selectPinnedTiles({
      squares: [
        [100, 100, 110, 110],
        [900, 900, 910, 910],
      ],
      info: inUpTo(8),
      rootSize: ROOT,
    });
    expect(keep.sort()).toEqual(
      [...new Set([...path(105, 105, 3), ...path(905, 905, 3)])].sort(),
    );
    expect(keep).toHaveLength(7);
    expect(want).toEqual([]);
  });

  it('walks each tile once, and no more than its limit', () => {
    const shared = selectPinnedTiles({
      squares: [
        [100, 100, 110, 110],
        [101, 101, 109, 109],
      ],
      info: inUpTo(8),
      rootSize: ROOT,
    });
    expect(shared.keep).toHaveLength(4);
    const capped = selectPinnedTiles({
      squares: [[0, 0, 1000, 1000]],
      info: inUpTo(8),
      rootSize: ROOT,
      limit: 10,
    });
    expect(capped.keep.length + capped.want.length).toBe(10);
  });

  it('stops at the deepest allowed', () => {
    const { keep } = selectPinnedTiles({
      squares: [[100, 100, 110, 110]],
      info: inUpTo(8, 20),
      rootSize: ROOT,
      maxDepth: 2,
    });
    expect(keep.sort()).toEqual(path(105, 105, 2).sort());
  });
});

describe('TileStreamer', () => {
  const settle = () => new Promise(resolve => setTimeout(resolve, 0));

  it('loads the most wanted first, a few at a time', async () => {
    const order: number[] = [];
    const streamer = new TileStreamer(
      {
        load: async key => {
          order.push(key);
          return { key };
        },
        bytes: () => 1,
      },
      { concurrency: 2 },
    );
    streamer.update(
      [],
      [
        { key: 1, priority: 1 },
        { key: 2, priority: 3 },
        { key: 3, priority: 2 },
      ],
    );
    expect(order).toEqual([2, 3]);
    expect(streamer.stats.loading).toBe(2);
    await settle();
    expect(order).toEqual([2, 3, 1]);
    await settle();
    expect(streamer.get(1)).toEqual({ key: 1 });
    expect(streamer.stats.resident).toBe(3);
  });

  it('lets go of the least recently used over the budget, never one in use', async () => {
    const evicted: number[] = [];
    const deep = (n: number) => tileKey(5, n, 0);
    const streamer = new TileStreamer(
      { load: async key => key, bytes: () => 10 },
      { budget: 25, onEvict: key => evicted.push(key) },
    );
    streamer.update([], [{ key: deep(1), priority: 1 }]);
    await settle();
    streamer.update([], [{ key: deep(2), priority: 1 }]);
    await settle();
    streamer.update([deep(1)], [{ key: deep(3), priority: 1 }]);
    await settle();
    streamer.update([deep(1), deep(3)], []);
    expect(evicted).toEqual([deep(2)]);
    expect(streamer.stats.bytes).toBe(20);
  });

  it('keeps the shallowest tiles whatever the budget', async () => {
    const evicted: number[] = [];
    const streamer = new TileStreamer(
      { load: async key => key, bytes: () => 10 },
      { budget: 0, keepDepth: 1, onEvict: key => evicted.push(key) },
    );
    streamer.update([], [{ key: tileKey(1, 0, 0), priority: 1 }]);
    await settle();
    streamer.update([], []);
    expect(evicted).toEqual([]);
  });

  it('asks again for a tile that came back empty only after a while', async () => {
    const load = vi.fn<(key: number) => Promise<null>>(async () => null);
    const streamer = new TileStreamer(
      { load, bytes: () => 1 },
      { retryAfter: 2 },
    );
    const wanted = [{ key: 7, priority: 1 }];
    streamer.update([], wanted);
    await settle();
    streamer.update([], wanted);
    streamer.update([], wanted);
    expect(load).toHaveBeenCalledTimes(1);
    streamer.update([], wanted);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('drops what comes back after it is disposed', async () => {
    const loaded = vi.fn<(key: number, tile: number) => void>();
    const streamer = new TileStreamer(
      { load: async key => key, bytes: () => 1 },
      { onLoad: loaded },
    );
    streamer.update([], [{ key: 1, priority: 1 }]);
    streamer.dispose();
    await settle();
    expect(loaded).not.toHaveBeenCalled();
    expect(streamer.get(1)).toBeUndefined();
  });
});
