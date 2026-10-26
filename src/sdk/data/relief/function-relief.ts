import type { ReliefMeta, ReliefWindow } from '../types/ReliefMeta';
import {
  reliefLevelSize,
  reliefLevelToNode,
  reliefNodeToMap,
} from './relief-window';

// ⚠️ Free of three.js: it runs where a store runs.

/**
 * A relief whose windows are computed when they are asked for: nothing is held. A store
 * answers `relief-meta` with its `meta` and `relief-values` with its `window`.
 *
 * @group Data
 */
export type ComputedRelief = {
  meta: ReliefMeta;
  /** a window of one of its levels (see {@link ReliefWindow}) */
  window: (window: ReliefWindow) => Float32Array;
};

/**
 * The record of a {@link functionRelief}: a relief's, its `min` and `max` optional.
 *
 * @group Data
 */
export type FunctionReliefMeta = Omit<ReliefMeta, 'min' | 'max'> & {
  min?: number;
  max?: number;
};

// Nodes along each side of the lattice that estimates a function relief's range.
const RANGE_NODES = 129;

/**
 * A relief computed from a height function of map X/Y (`meta.crs`), in metres above
 * mean sea level: synthetic relief, with nothing held. Each value of a window is the
 * height where a reader places it (`reliefLevelToNode`: the middle of the block of nodes
 * it stands for, which at the grid's last row or column may lie past it), so the relief
 * read back is the function itself, where a held one averages. A height that is not
 * finite is none.
 *
 * Without `meta.min` and `meta.max`, they are estimated on a lattice of 129 x 129 nodes:
 * give them where the function has narrow peaks.
 *
 * @group Data
 */
export function functionRelief(
  meta: FunctionReliefMeta,
  height: (x: number, y: number) => number,
): ComputedRelief {
  const [nx, ny] = meta.grid.size;
  const at = (col: number, row: number) => {
    const [x, y] = reliefNodeToMap(meta as ReliefMeta, col, row);
    const value = height(x, y);
    return Number.isFinite(value) ? value : NaN;
  };

  let { min, max } = meta;
  if (min === undefined || max === undefined) {
    let low = Infinity;
    let high = -Infinity;
    const steps = Math.min(RANGE_NODES, Math.max(nx, ny));
    for (let b = 0; b < steps; b++) {
      for (let a = 0; a < steps; a++) {
        const value = at(
          (a / Math.max(steps - 1, 1)) * (nx - 1),
          (b / Math.max(steps - 1, 1)) * (ny - 1),
        );
        if (value < low) low = value;
        if (value > high) high = value;
      }
    }
    min ??= low <= high ? low : 0;
    max ??= low <= high ? high : 0;
  }
  const full: ReliefMeta = { ...meta, min, max };

  return {
    meta: full,
    window: ({ level, first, count }) => {
      const [w, h] = reliefLevelSize(full, level);
      const [cols, rows] = count;
      const out = new Float32Array(cols * rows).fill(NaN);
      for (let j = 0; j < rows; j++) {
        const row = first[1] + j;
        if (row < 0 || row >= h) continue;
        for (let i = 0; i < cols; i++) {
          const col = first[0] + i;
          if (col < 0 || col >= w) continue;
          const [c, r] = reliefLevelToNode(level, col, row);
          out[j * cols + i] = at(c, r);
        }
      }
      return out;
    },
  };
}
