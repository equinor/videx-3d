import { describe, expect, it } from 'vitest';
import {
  Frustum,
  Matrix4,
  OrthographicCamera,
  PerspectiveCamera,
  Vector3,
} from 'three';
import {
  capTileHeights,
  chunkTileBoxes,
  chunkTileCorners,
  compactTilePool,
  createTilePool,
  cullTilePool,
  fitsPoolTile,
  flushTilePool,
  orderTileChanges,
  selectTileLevels,
  setPoolTile,
  tilesInView,
  TilePool,
  viewTilePool,
} from '../src/components/Chunks/chunk-lod';
import type { StackTiling } from '../src/sdk';
import { LOD_COARSEN_MARGIN, pixelsPerUnit } from '../src/sdk/utils/lod';

// 2 x 1 tiles of 10 cells, 50 m cells, grid column = x / 50 and row = -z / 50 + 3.
const tiling: StackTiling = {
  cells: 10,
  first: [1, 0],
  count: [2, 1],
  toGrid: [1 / 50, 0, 0, 0, -1 / 50, 3],
};

describe('chunkTileBoxes', () => {
  it('maps each tile back to scene XZ over the height range', () => {
    const [a, b] = chunkTileBoxes(tiling, -900, -100);
    // tile 0: columns 9.5..19.5, rows -0.5..9.5
    expect(a.min.x).toBeCloseTo(475);
    expect(a.max.x).toBeCloseTo(975);
    expect(a.min.z).toBeCloseTo(-325);
    expect(a.max.z).toBeCloseTo(175);
    expect([a.min.y, a.max.y]).toEqual([-900, -100]);
    expect(b.min.x).toBeCloseTo(975);
    expect(b.max.x).toBeCloseTo(1475);
  });
});

describe('capTileHeights', () => {
  it('spans each tile\'s full-level triangles, widened, and a bare tile the range', () => {
    const y = [-100, -200, -300, -400];
    // Tile 0: one triangle over vertices 0-2; tile 1: none.
    const heights = capTileHeights(
      [0, 1, 2],
      Uint32Array.from([0, 1, 1]),
      y,
      10,
      -900,
      -50,
    );
    expect(Array.from(heights)).toEqual([-310, -90, -900, -50]);
    expect(
      Array.from(capTileHeights([0, 1, 2], Uint32Array.from([0, 1]), null, 10, -900, -50)),
    ).toEqual([-900, -50]);
  });
});

describe('tilesInView', () => {
  const corners = chunkTileCorners(tiling);
  const look = (fov: number, eye: Vector3, at: Vector3, far = 10000) => {
    const camera = new PerspectiveCamera(fov, 1, 1, far);
    // Not +Y: looking straight down along it would leave `lookAt` no roll to pick.
    camera.up.set(0, 0, -1);
    camera.position.copy(eye);
    camera.lookAt(at);
    camera.updateMatrixWorld();
    return new Frustum().setFromProjectionMatrix(
      new Matrix4().multiplyMatrices(
        camera.projectionMatrix,
        camera.matrixWorldInverse,
      ),
    );
  };

  it('keeps the tiles whose prism reaches into the view', () => {
    const heights = Float32Array.from([-900, -100, -900, -100]);
    const inView = new Uint8Array(2);
    // Straight down over tile 0 (x 475..975): ±254 m wide at the prism's base.
    const above = look(10, new Vector3(700, 2000, -75), new Vector3(700, -500, -75));
    tilesInView(above, corners, heights, inView);
    expect(Array.from(inView)).toEqual([1, 0]);
    // Wide enough to take in both.
    const wide = look(60, new Vector3(975, 2000, -75), new Vector3(975, -500, -75));
    tilesInView(wide, corners, heights, inView);
    expect(Array.from(inView)).toEqual([1, 1]);
  });

  it('judges each cap by its own heights', () => {
    const inView = new Uint8Array(2);
    const view = look(60, new Vector3(975, 0, -75), new Vector3(975, -500, -75), 1000);
    // Tile 1's cap lies beyond the far plane; tile 0's within it.
    tilesInView(view, corners, Float32Array.from([-300, -200, -3000, -2900]), inView);
    expect(Array.from(inView)).toEqual([1, 0]);
  });
});

describe('selectTileLevels', () => {
  const boxes = chunkTileBoxes(tiling, -900, -100);
  const errors = [5, 20, 80];

  it('keeps the tile under the eye at full detail and coarsens with distance', () => {
    const camera = new PerspectiveCamera(60);
    const scale = pixelsPerUnit(camera, 1000);
    const levels = new Uint8Array(2);
    const eye = new Vector3(700, 0, -50);
    // 100 m above tile 0: 5 m spans ~43 px, so nothing coarsens.
    expect(selectTileLevels(boxes, eye, scale, errors, 2, levels)).toBe(false);
    expect(levels[0]).toBe(0);
    const far = new Vector3(700, 60000, -50);
    expect(selectTileLevels(boxes, far, scale, errors, 2, levels)).toBe(true);
    expect(Array.from(levels)).toEqual([2, 2]);
  });

  it('goes coarser only with a margin, and finer at once', () => {
    const errorsAt = [5, 20];
    const levels = new Uint8Array(1);
    const one = [boxes[0]];
    const eye = new Vector3(700, 0, -50);
    // A scale that puts level 1 exactly ON the limit: not coarse enough yet.
    const onLimit = () => 2 / errorsAt[1];
    selectTileLevels(one, eye, onLimit, errorsAt, 2, levels);
    expect(levels[0]).toBe(0);
    const underMargin = () => (2 * LOD_COARSEN_MARGIN) / errorsAt[1];
    selectTileLevels(one, eye, underMargin, errorsAt, 2, levels);
    expect(levels[0]).toBe(1);
    // ...and back on the limit it stays, until it is over it.
    expect(selectTileLevels(one, eye, onLimit, errorsAt, 2, levels)).toBe(false);
    expect(levels[0]).toBe(1);
    const over = () => (2 * 1.01) / errorsAt[1];
    selectTileLevels(one, eye, over, errorsAt, 2, levels);
    expect(levels[0]).toBe(0);
  });

  it('projects an orthographic camera the same at any distance', () => {
    const camera = new OrthographicCamera(-500, 500, 500, -500);
    const scale = pixelsPerUnit(camera, 1000);
    expect(scale(10)).toBe(scale(10000));
    // 1 px per metre: 5 m is over 2 px, 20 m too, so full detail everywhere.
    const levels = new Uint8Array(2);
    selectTileLevels(boxes, new Vector3(), scale, errors, 2, levels);
    expect(Array.from(levels)).toEqual([0, 0]);
  });

  it('reads the height error through a vertical exaggeration', () => {
    const scale = pixelsPerUnit(new PerspectiveCamera(60), 1000);
    const exaggerated = new Matrix4().makeScale(1, 4, 1);
    const pick = (eye: Vector3, frame?: Matrix4) => {
      const levels = new Uint8Array(2).fill(2);
      selectTileLevels(boxes, eye, scale, errors, 2, levels, undefined, frame);
      return Array.from(levels);
    };
    // From the side the distance stays, and every metre of error is four on screen.
    const side = new Vector3(975, -500, 20000);
    expect(pick(side)).toEqual([1, 1]);
    expect(pick(side, exaggerated)).toEqual([0, 0]);
    // From above both scale alike, so nothing changes.
    const above = new Vector3(975, 20000, -75);
    expect(pick(above, exaggerated)).toEqual(pick(above));
  });
});

describe('orderTileChanges', () => {
  it('puts the tiles needing detail first, the most visible error first', () => {
    const levels = Uint8Array.from([0, 2, 0, 1, 1]);
    const applied = Uint8Array.from([1, 1, 2, 1, 0]);
    const excess = [3, 0.5, 9, 7, 0.2];
    // 0 and 2 go finer (9 px before 3 px); 1 and 4 coarser (0.2 px before 0.5 px).
    expect(orderTileChanges(levels, applied, excess)).toEqual([2, 0, 4, 1]);
  });
});

describe('tile pool', () => {
  // 3 tiles, levels of 4, 2 and 1 triangles each; vertex ids from 1, so a real
  // triangle is never the degenerate (0, 0, 0).
  const sizes = [4, 2, 1];
  const tiles = 3;
  const lists = sizes.map((size, k) => {
    const list: number[] = [];
    for (let t = 0; t < tiles; t++) {
      for (let i = 0; i < size; i++) {
        const id = 1 + 100 * k + 10 * t + i;
        list.push(id, id, id + 1000);
      }
    }
    return Uint32Array.from(list);
  });
  const starts = sizes.map(size =>
    Uint32Array.from({ length: tiles + 1 }, (_, t) => t * size),
  );

  const triangles = (index: ArrayLike<number>, end: number) => {
    const out: string[] = [];
    for (let i = 0; i < end; i += 3) {
      if (index[i] || index[i + 1] || index[i + 2]) {
        out.push(`${index[i]},${index[i + 1]},${index[i + 2]}`);
      }
    }
    return out.sort();
  };
  const expected = (pool: TilePool) => {
    const out: string[] = [];
    for (let t = 0; t < tiles; t++) {
      const k = pool.level[t];
      const list = lists[k];
      for (let i = starts[k][t] * 3; i < starts[k][t + 1] * 3; i += 3) {
        out.push(`${list[i]},${list[i + 1]},${list[i + 2]}`);
      }
    }
    return out.sort();
  };

  it('draws each tile at its level, and says every range it wrote', () => {
    const pool = createTilePool(lists, starts, Uint8Array.from([2, 2, 2]));
    // What the GPU holds: only the ranges the pool reports reach it.
    const gpu = pool.index.slice();
    pool.written.length = 0;
    let seed = 7;
    const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648);
    for (let step = 0; step < 200; step++) {
      const t = next() % tiles;
      const k = next() % sizes.length;
      const fits = fitsPoolTile(pool, t, k);
      const old = pool.used[t];
      const wrote = setPoolTile(pool, t, k);
      // Fitting, a tile writes its slot and the one it left; otherwise the pool is packed.
      expect(
        fits
          ? wrote <= old + pool.used[t] + old
          : wrote === pool.live && pool.end === pool.live,
      ).toBe(true);
      let reported = 0;
      for (let i = 0; i < pool.written.length; i += 2) {
        const [from, count] = [pool.written[i], pool.written[i + 1]];
        gpu.set(pool.index.subarray(from, from + count), from);
        reported += count;
      }
      pool.written.length = 0;
      expect(reported).toBe(wrote);
      expect(triangles(gpu, pool.end)).toEqual(expected(pool));
      expect(pool.live).toBe(expected(pool).length * 3);
      expect(pool.end).toBeLessThanOrEqual(pool.index.length);
    }
  });

  it('rewrites only the tile that changed', () => {
    const pool = createTilePool(lists, starts, Uint8Array.from([0, 0, 0]));
    pool.written.length = 0;
    // Shrinking in place: the new level, and degenerates where the old one was.
    expect(setPoolTile(pool, 1, 2)).toBe(12);
    expect(pool.written).toEqual([12, 12]);
    // Back up again: it still fits its slot.
    pool.written.length = 0;
    expect(setPoolTile(pool, 1, 0)).toBe(12);
    expect(pool.end).toBe(36);
  });

  it('moves a tile that outgrows its slot to the end, and packs when out of room', () => {
    const pool = createTilePool(lists, starts, Uint8Array.from([1, 1, 1]));
    expect(pool.index.length).toBe(45);
    // Tile 0 is not last: its old slot is cleared and it lands at the end.
    expect(setPoolTile(pool, 0, 0)).toBe(6 + 12);
    expect(pool.slot[0]).toBe(18);
    expect(pool.end).toBe(30);
    // Its slot keeps its room, so it shrinks and grows back in place.
    setPoolTile(pool, 0, 2);
    expect(setPoolTile(pool, 0, 0)).toBe(12);
    expect(pool.end).toBe(30);
    setPoolTile(pool, 1, 0);
    expect(pool.end).toBe(42);
    // Tile 2 needs 12 and only 3 are left: everything is packed.
    pool.written.length = 0;
    expect(setPoolTile(pool, 2, 0)).toBe(36);
    expect(pool.end).toBe(36);
    expect(pool.live).toBe(36);
    expect(pool.written).toEqual([0, 36]);
    expect(triangles(pool.index, pool.end)).toEqual(expected(pool));
  });

  it('grows the last slot where it is', () => {
    const pool = createTilePool(lists, starts, Uint8Array.from([1, 1, 2]));
    expect(pool.end).toBe(15);
    expect(setPoolTile(pool, 2, 0)).toBe(12);
    expect(pool.slot[2]).toBe(12);
    expect(pool.end).toBe(24);
  });

  // Per full-level triangle, the units above and below it: tile 0 faces units 0
  // and 1, tile 1 only unit 2, tile 2 units 0 and 1 again.
  const neighbours = {
    above: Uint8Array.from([0, 0, 1, 1, 2, 2, 2, 2, 0, 1, 0, 1]),
    below: new Uint8Array(12).fill(5),
  };
  const opened = (...units: number[]) => {
    const table = new Uint8Array(256);
    for (const u of units) table[u] = 1;
    return table;
  };
  // What must be drawn: the full level per triangle, a coarser tile whole or not at
  // all, and nothing of a tile out of `view`.
  const shows = (
    pool: TilePool,
    table: Uint8Array | null,
    view?: ArrayLike<number>,
  ) => {
    const out: string[] = [];
    for (let t = 0; t < tiles; t++) {
      if (view && !view[t]) continue;
      const k = pool.level[t];
      const full: number[] = [];
      for (let i = starts[0][t]; i < starts[0][t + 1]; i++) {
        const { above, below } = neighbours;
        if (!table || table[above[i]] || table[below[i]]) full.push(i);
      }
      const list = lists[k];
      const picked =
        k === 0
          ? full
          : full.length > 0
            ? Array.from(
                { length: starts[k][t + 1] - starts[k][t] },
                (_, i) => starts[k][t] + i,
              )
            : [];
      for (const i of picked) {
        out.push(`${list[3 * i]},${list[3 * i + 1]},${list[3 * i + 2]}`);
      }
    }
    return out.sort();
  };
  const includes = (drawn: string[], wanted: string[]) => {
    const set = new Set(drawn);
    return wanted.every(w => set.has(w));
  };

  it('culls the full level per triangle, a coarser tile whole or not at all', () => {
    const pool = createTilePool(lists, starts, Uint8Array.from([0, 1, 2]));
    const table = opened(0);
    // It only hides, so all of it is still drawn until the hides go in.
    expect(cullTilePool(pool, neighbours, table)).toBe(0);
    expect(triangles(pool.index, pool.end)).toEqual(expected(pool));
    expect(flushTilePool(pool, Infinity)).toBeGreaterThan(0);
    expect(triangles(pool.index, pool.end)).toEqual(shows(pool, table));
    // Tile 0 keeps its 2 triangles over unit 0, tile 1 (unit 2) is gone, tile 2
    // draws its level whole.
    expect(pool.live).toBe((2 + 0 + 1) * 3);
  });

  it('draws what a table reveals at once, and what it hides only when flushed', () => {
    const pool = createTilePool(lists, starts, Uint8Array.from([0, 1, 2]));
    cullTilePool(pool, neighbours, opened(0));
    flushTilePool(pool, Infinity);
    const more = opened(0, 2);
    expect(cullTilePool(pool, neighbours, more)).toBeGreaterThan(0);
    expect(triangles(pool.index, pool.end)).toEqual(shows(pool, more));
    const less = opened(2);
    expect(cullTilePool(pool, neighbours, less)).toBe(0);
    const drawn = triangles(pool.index, pool.end);
    expect(includes(drawn, shows(pool, less))).toBe(true);
    expect(drawn).not.toEqual(shows(pool, less));
    flushTilePool(pool, Infinity);
    expect(triangles(pool.index, pool.end)).toEqual(shows(pool, less));
  });

  it('keeps a coarser tile with no full-level triangles to judge it by', () => {
    // Tile 1 has none at the full level; the others are buried.
    const sparse = [
      Uint32Array.from([...lists[0].subarray(0, 12), ...lists[0].subarray(24)]),
      lists[1],
    ];
    const sparseStarts = [Uint32Array.from([0, 4, 4, 8]), starts[1]];
    const pool = createTilePool(sparse, sparseStarts, Uint8Array.from([1, 1, 1]));
    const buried = { above: new Uint8Array(8), below: new Uint8Array(8) };
    cullTilePool(pool, buried, opened());
    flushTilePool(pool, Infinity);
    expect(pool.live).toBe(2 * 3);
    // Rewritten, it stays.
    compactTilePool(pool);
    expect(pool.live).toBe(2 * 3);
  });

  it('never leaves a hole, whatever order tables, levels and flushes come in', () => {
    const pool = createTilePool(lists, starts, Uint8Array.from([2, 2, 2]));
    // What the GPU holds: only the ranges the pool reports reach it.
    const gpu = pool.index.slice();
    pool.written.length = 0;
    const sync = () => {
      for (let i = 0; i < pool.written.length; i += 2) {
        const [from, count] = [pool.written[i], pool.written[i + 1]];
        gpu.set(pool.index.subarray(from, from + count), from);
      }
      pool.written.length = 0;
    };
    let seed = 11;
    // The high bits: an LCG's low bits cycle with a short period.
    const next = () =>
      (seed = (seed * 1103515245 + 12345) % 2147483648) >>> 16;
    let table: Uint8Array | null = null;
    for (let step = 0; step < 400; step++) {
      const action = next() % 3;
      if (action === 0) {
        table =
          next() % 5 === 0
            ? null
            : opened(...[0, 1, 2, 5].filter(() => next() % 2 === 0));
        cullTilePool(pool, neighbours, table);
      } else if (action === 1) {
        setPoolTile(pool, next() % tiles, next() % sizes.length);
      } else {
        flushTilePool(pool, next() % 20);
      }
      sync();
      expect(includes(triangles(gpu, pool.end), shows(pool, table))).toBe(true);
      expect(pool.end).toBeLessThanOrEqual(pool.index.length);
    }
    flushTilePool(pool, Infinity);
    sync();
    expect(triangles(gpu, pool.end)).toEqual(shows(pool, table));
    expect(pool.live).toBe(shows(pool, table).length * 3);
  });

  it('draws a tile coming into view at once, and empties one leaving only when flushed', () => {
    const pool = createTilePool(lists, starts, Uint8Array.from([0, 1, 2]));
    const view = [1, 0, 1];
    // Leaving: still drawn (off screen, never a hole) until the hide goes in.
    expect(viewTilePool(pool, view)).toBe(0);
    expect(triangles(pool.index, pool.end)).toEqual(expected(pool));
    expect(flushTilePool(pool, Infinity)).toBeGreaterThan(0);
    expect(triangles(pool.index, pool.end)).toEqual(shows(pool, null, view));
    // Back in view: written now.
    expect(viewTilePool(pool, [1, 1, 1])).toBeGreaterThan(0);
    expect(triangles(pool.index, pool.end)).toEqual(expected(pool));
    // Out and back before a flush: what it draws is still right, nothing to write.
    viewTilePool(pool, view);
    expect(viewTilePool(pool, [1, 1, 1])).toBe(0);
    expect(pool.viewStaleCount).toBe(0);
    expect(triangles(pool.index, pool.end)).toEqual(expected(pool));
  });

  it('never leaves a hole in view, whatever order views, tables, levels and flushes come in', () => {
    const pool = createTilePool(lists, starts, Uint8Array.from([2, 2, 2]));
    const gpu = pool.index.slice();
    pool.written.length = 0;
    const sync = () => {
      for (let i = 0; i < pool.written.length; i += 2) {
        const [from, count] = [pool.written[i], pool.written[i + 1]];
        gpu.set(pool.index.subarray(from, from + count), from);
      }
      pool.written.length = 0;
    };
    let seed = 23;
    const next = () =>
      (seed = (seed * 1103515245 + 12345) % 2147483648) >>> 16;
    let table: Uint8Array | null = null;
    let view = [1, 1, 1];
    for (let step = 0; step < 600; step++) {
      const action = next() % 4;
      if (action === 0) {
        view = [next() % 2, next() % 2, next() % 2];
        viewTilePool(pool, view);
      } else if (action === 1) {
        table =
          next() % 5 === 0
            ? null
            : opened(...[0, 1, 2, 5].filter(() => next() % 2 === 0));
        cullTilePool(pool, neighbours, table);
      } else if (action === 2) {
        setPoolTile(pool, next() % tiles, next() % sizes.length);
      } else {
        flushTilePool(pool, next() % 20);
      }
      sync();
      expect(includes(triangles(gpu, pool.end), shows(pool, table, view))).toBe(
        true,
      );
      expect(pool.end).toBeLessThanOrEqual(pool.index.length);
    }
    flushTilePool(pool, Infinity);
    sync();
    expect(triangles(gpu, pool.end)).toEqual(shows(pool, table, view));
    expect(pool.live).toBe(shows(pool, table, view).length * 3);
  });

  it('never reports an empty write, which WebGL would take as "to the end"', () => {
    // Tile 1 has no triangles at level 1: a cap that stops there.
    const holed = [lists[0], Uint32Array.from([1, 1, 2, 3, 3, 4])];
    const holedStarts = [starts[0], Uint32Array.from([0, 1, 1, 2])];
    const pool = createTilePool(holed, holedStarts, Uint8Array.from([1, 1, 1]));
    pool.written.length = 0;
    setPoolTile(pool, 1, 0);
    setPoolTile(pool, 1, 1);
    setPoolTile(pool, 0, 0);
    for (let i = 1; i < pool.written.length; i += 2) {
      expect(pool.written[i]).toBeGreaterThan(0);
    }
  });
});
