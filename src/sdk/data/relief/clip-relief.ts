import { pointInPolygon } from '../../geometries/polygon-outline';
import type { Vec2 } from '../../types/common';
import type { ReliefData } from '../types/ReliefMeta';
import { reliefNodeToMap } from './relief-window';

// ⚠️ Free of three.js: it runs where a store runs.

/**
 * A relief with everything outside `outline` made `NaN`: only what lies inside is
 * kept, so as a relief layer it covers that area, and the layers under it take over
 * around it, eased in by its `feather`. Its range is that of what is kept.
 *
 * @param outline in the relief's own map (`meta.crs`): rings of map X/Y, the first of
 *   each polygon its outer ring, the rest its holes, as a `PlanarPolygonCoordinates`;
 *   or a single ring
 *
 * @group Data
 */
export function clipReliefToOutline(
  data: ReliefData,
  outline: Vec2[][][] | Vec2[],
): ReliefData {
  const polygon = isRing(outline) ? [[outline]] : outline;
  const { meta } = data;
  const [nx, ny] = meta.grid.size;
  const values = new Float32Array(data.values);

  // Only the polygon's bounds are tested node by node.
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const rings of polygon) {
    for (const [x, y] of rings[0] ?? []) {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  }

  let min = Infinity;
  let max = -Infinity;
  for (let row = 0; row < ny; row++) {
    for (let col = 0; col < nx; col++) {
      const k = row * nx + col;
      const value = values[k];
      if (!(value === value)) continue;
      const [x, y] = reliefNodeToMap(meta, col, row);
      if (
        x < x0 ||
        x > x1 ||
        y < y0 ||
        y > y1 ||
        !pointInPolygon(x, y, polygon)
      ) {
        values[k] = NaN;
        continue;
      }
      if (value < min) min = value;
      if (value > max) max = value;
    }
  }
  return {
    meta: {
      ...meta,
      min: min <= max ? min : 0,
      max: min <= max ? max : 0,
    },
    values,
  };
}

function isRing(outline: Vec2[][][] | Vec2[]): outline is Vec2[] {
  return outline.length > 0 && typeof outline[0][0] === 'number';
}
