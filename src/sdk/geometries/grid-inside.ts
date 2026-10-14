import type { GridPolygon, GridRing } from './triangulate-grid-delaunay';

// Kept free of three.js: the stack worker pool runs the tile tessellation, which
// trims with these tests.

/**
 * Row-bucketed even-odd crossing test for a set of rings in grid coordinates.
 * Ring edges are bucketed by the integer rows they span, so a query only tests
 * the few edges that can cross its scanline rather than every ring vertex — the
 * trim pass runs one query per triangle, so a linear scan over the (potentially
 * very long) traced data boundary would dominate.
 */
export function buildCrossingIndex(
  rings: GridRing[],
): (x: number, y: number) => boolean {
  const exi: number[] = [];
  const eyi: number[] = [];
  const exj: number[] = [];
  const eyj: number[] = [];
  let minRow = Infinity;
  let maxRow = -Infinity;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const yA = ring[i][1];
      const yB = ring[j][1];
      if (yA === yB) continue; // horizontal edges never produce a crossing
      exi.push(ring[i][0]);
      eyi.push(yA);
      exj.push(ring[j][0]);
      eyj.push(yB);
      const r0 = Math.floor(Math.min(yA, yB));
      const r1 = Math.floor(Math.max(yA, yB));
      if (r0 < minRow) minRow = r0;
      if (r1 > maxRow) maxRow = r1;
    }
  }
  const n = exi.length;
  if (n === 0) return () => false;

  const xi = Float64Array.from(exi);
  const yi = Float64Array.from(eyi);
  const xj = Float64Array.from(exj);
  const yj = Float64Array.from(eyj);

  // CSR buckets: offsets[r] .. offsets[r + 1] index into items
  const rowCount = maxRow - minRow + 1;
  const offsets = new Uint32Array(rowCount + 1);
  for (let e = 0; e < n; e++) {
    const r0 = Math.floor(Math.min(yi[e], yj[e])) - minRow;
    const r1 = Math.floor(Math.max(yi[e], yj[e])) - minRow;
    for (let r = r0; r <= r1; r++) offsets[r + 1]++;
  }
  for (let r = 0; r < rowCount; r++) offsets[r + 1] += offsets[r];
  const items = new Uint32Array(offsets[rowCount]);
  const cursor = offsets.slice(0, rowCount);
  for (let e = 0; e < n; e++) {
    const r0 = Math.floor(Math.min(yi[e], yj[e])) - minRow;
    const r1 = Math.floor(Math.max(yi[e], yj[e])) - minRow;
    for (let r = r0; r <= r1; r++) items[cursor[r]++] = e;
  }

  return (x: number, y: number) => {
    const r = Math.floor(y) - minRow;
    if (r < 0 || r >= rowCount) return false;
    let inside = false;
    for (let k = offsets[r]; k < offsets[r + 1]; k++) {
      const e = items[k];
      const yA = yi[e];
      const yB = yj[e];
      if (
        yA > y !== yB > y &&
        x < ((xj[e] - xi[e]) * (y - yA)) / (yB - yA) + xi[e]
      ) {
        inside = !inside;
      }
    }
    return inside;
  };
}

/**
 * Build an "inside any component polygon (outer ring minus its holes)" test for
 * polygons given in grid coordinates. Row-bucketed, so a query only tests the ring
 * edges on its own scanline.
 *
 * @group Geometries
 */
export function makeGridInside(polygons: GridPolygon[]) {
  const indexed = polygons
    .filter(poly => poly.length > 0)
    .map(poly => ({
      outer: buildCrossingIndex([poly[0]]),
      holes: poly.slice(1).map(hole => buildCrossingIndex([hole])),
    }));
  return (x: number, y: number) => {
    for (const poly of indexed) {
      if (!poly.outer(x, y)) continue;
      let inHole = false;
      for (const hole of poly.holes) {
        if (hole(x, y)) {
          inHole = true;
          break;
        }
      }
      if (!inHole) return true;
    }
    return false;
  };
}
