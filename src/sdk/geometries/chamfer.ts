/**
 * Two-sweep chamfer transforms over a regular grid.
 *
 * The same pair of sweeps answers two questions that come up repeatedly when a
 * surface grid is incomplete: *how far is this node from real data* (used to bound
 * hole filling and to shape a taper) and *what value does the nearest real data
 * carry* (used to extend a field continuously into the gap).
 *
 * Distances are in CELLS, with a diagonal costing √2 — an approximation of the
 * Euclidean distance that is accurate to a few percent and costs two linear passes
 * rather than a search.
 */

const D1 = 1;
const D2 = Math.SQRT2;

/**
 * Distance from every node to the nearest set node, in cells.
 *
 * @param mask 1 where the node is a source
 * @returns distances; `Infinity` everywhere when the mask is empty
 *
 * @group Geometries
 */
export function chamferDistance(
  mask: Uint8Array,
  w: number,
  h: number,
): Float32Array {
  const dist = new Float32Array(w * h);
  for (let i = 0; i < dist.length; i++) dist[i] = mask[i] ? 0 : Infinity;

  for (let y = 0; y < h; y++) {
    const row = y * w;
    const up = row - w;
    for (let x = 0; x < w; x++) {
      const i = row + x;
      if (dist[i] === 0) continue;
      let d = dist[i];
      if (x > 0) d = Math.min(d, dist[i - 1] + D1);
      if (y > 0) {
        d = Math.min(d, dist[up + x] + D1);
        if (x > 0) d = Math.min(d, dist[up + x - 1] + D2);
        if (x < w - 1) d = Math.min(d, dist[up + x + 1] + D2);
      }
      dist[i] = d;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    const row = y * w;
    const down = row + w;
    for (let x = w - 1; x >= 0; x--) {
      const i = row + x;
      if (dist[i] === 0) continue;
      let d = dist[i];
      if (x < w - 1) d = Math.min(d, dist[i + 1] + D1);
      if (y < h - 1) {
        d = Math.min(d, dist[down + x] + D1);
        if (x < w - 1) d = Math.min(d, dist[down + x + 1] + D2);
        if (x > 0) d = Math.min(d, dist[down + x - 1] + D2);
      }
      dist[i] = d;
    }
  }
  return dist;
}

/**
 * Fill every unset node from the nearest set one, carrying the value along with
 * the distance.
 *
 * A continuous extension (rather than a mean, or a hard edge) matters wherever the
 * result is triangulated: a cliff at a data boundary costs a dense cluster of
 * slivers for geometry that is outside the mask or about to be dropped anyway.
 *
 * ⚠️ Mutates `values` in place.
 *
 * @param values the field to extend; only the set nodes are read
 * @param mask 1 where `values` holds real data
 * @returns the distance to the nearest real value, in cells
 *
 * @group Geometries
 */
export function chamferFill(
  values: Float32Array,
  mask: Uint8Array,
  w: number,
  h: number,
): Float32Array {
  const dist = new Float32Array(w * h);
  for (let i = 0; i < dist.length; i++) dist[i] = mask[i] ? 0 : Infinity;

  const relax = (i: number, j: number, d: number) => {
    const nd = dist[j] + d;
    if (nd < dist[i]) {
      dist[i] = nd;
      values[i] = values[j];
    }
  };

  for (let y = 0; y < h; y++) {
    const row = y * w;
    const up = row - w;
    for (let x = 0; x < w; x++) {
      const i = row + x;
      if (dist[i] === 0) continue;
      if (x > 0) relax(i, i - 1, D1);
      if (y > 0) {
        relax(i, up + x, D1);
        if (x > 0) relax(i, up + x - 1, D2);
        if (x < w - 1) relax(i, up + x + 1, D2);
      }
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    const row = y * w;
    const down = row + w;
    for (let x = w - 1; x >= 0; x--) {
      const i = row + x;
      if (dist[i] === 0) continue;
      if (x < w - 1) relax(i, i + 1, D1);
      if (y < h - 1) {
        relax(i, down + x, D1);
        if (x < w - 1) relax(i, down + x + 1, D2);
        if (x > 0) relax(i, down + x - 1, D2);
      }
    }
  }
  return dist;
}
