import type { Vec2 } from '../../types/common';
import type { ReliefData, ReliefMeta, ReliefWindow } from '../types/ReliefMeta';

// ⚠️ Free of three.js: it runs where a store or the generators run.

/**
 * How many values a relief's grid has along X and Y at `level`: `ceil(size / 2^level)`.
 *
 * @group Data
 */
export function reliefLevelSize(meta: ReliefMeta, level: number): Vec2 {
  const step = 2 ** level;
  return [
    Math.ceil(meta.grid.size[0] / step),
    Math.ceil(meta.grid.size[1] / step),
  ];
}

/**
 * Where value (`col`, `row`) of `level` lies, as a fractional node of the grid (column
 * from the west, row from the north): the centre of the block of nodes it stands for.
 *
 * @group Data
 */
export function reliefLevelToNode(
  level: number,
  col: number,
  row: number,
): Vec2 {
  const step = 2 ** level;
  const half = (step - 1) / 2;
  return [col * step + half, row * step + half];
}

/**
 * The fractional value of `level` at grid node (`col`, `row`) (column from the west, row
 * from the north): the inverse of {@link reliefLevelToNode}.
 *
 * @group Data
 */
export function reliefNodeToLevel(
  level: number,
  col: number,
  row: number,
): Vec2 {
  const step = 2 ** level;
  const half = (step - 1) / 2;
  return [(col - half) / step, (row - half) / step];
}

/**
 * Map coordinates of grid node (`col`, `row`), fractional, the row counted from the north.
 *
 * @group Data
 */
export function reliefNodeToMap(
  meta: ReliefMeta,
  col: number,
  row: number,
): Vec2 {
  const { origin, cell, size, rotation = 0 } = meta.grid;
  const theta = (rotation * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const u = col * cell[0];
  const v = (size[1] - 1 - row) * cell[1];
  return [origin[0] + cos * u - sin * v, origin[1] + sin * u + cos * v];
}

/**
 * The fractional grid node (column from the west, row from the north) at map coordinates
 * (`x`, `y`): the inverse of {@link reliefNodeToMap}.
 *
 * @group Data
 */
export function reliefMapToNode(meta: ReliefMeta, x: number, y: number): Vec2 {
  const { origin, cell, size, rotation = 0 } = meta.grid;
  const theta = (rotation * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const du = x - origin[0];
  const dv = y - origin[1];
  return [
    (cos * du + sin * dv) / cell[0],
    size[1] - 1 - (-sin * du + cos * dv) / cell[1],
  ];
}

// Every level built so far, per grid of values: level 0 is the values themselves.
const pyramids = new WeakMap<Float32Array, Float32Array[]>();

/**
 * Level `level` of a relief held whole (see {@link ReliefWindow}), row-major from the
 * northern row: built from the level below the first time it is asked for, and kept as
 * long as the values are.
 *
 * @group Data
 */
export function reliefLevel(data: ReliefData, level: number): Float32Array {
  const { values, meta } = data;
  let levels = pyramids.get(values);
  if (!levels) {
    levels = [values];
    pyramids.set(values, levels);
  }
  for (let k = levels.length; k <= level; k++) {
    const [w0, h0] = reliefLevelSize(meta, k - 1);
    const [w1, h1] = reliefLevelSize(meta, k);
    const below = levels[k - 1];
    const next = new Float32Array(w1 * h1);
    for (let j = 0; j < h1; j++) {
      for (let i = 0; i < w1; i++) {
        let sum = 0;
        let n = 0;
        for (let b = 0; b < 2; b++) {
          const y = 2 * j + b;
          if (y >= h0) break;
          for (let a = 0; a < 2; a++) {
            const x = 2 * i + a;
            if (x >= w0) break;
            const value = below[y * w0 + x];
            if (value === value) {
              sum += value;
              n++;
            }
          }
        }
        next[j * w1 + i] = n > 0 ? sum / n : NaN;
      }
    }
    levels.push(next);
  }
  return levels[level];
}

/**
 * A window of a relief held whole: what a store hands out for `relief-values` with a
 * {@link ReliefWindow}. Values past the level's edge are `NaN`.
 *
 * @group Data
 */
export function reliefWindow(
  data: ReliefData,
  window: ReliefWindow,
): Float32Array {
  const { level, first, count } = window;
  const values = reliefLevel(data, level);
  const [w, h] = reliefLevelSize(data.meta, level);
  const [cols, rows] = count;
  const out = new Float32Array(cols * rows).fill(NaN);
  const i0 = Math.max(first[0], 0);
  const i1 = Math.min(first[0] + cols, w);
  if (i1 <= i0) return out;
  for (let j = 0; j < rows; j++) {
    const row = first[1] + j;
    if (row < 0 || row >= h) continue;
    out.set(
      values.subarray(row * w + i0, row * w + i1),
      j * cols + (i0 - first[0]),
    );
  }
  return out;
}
