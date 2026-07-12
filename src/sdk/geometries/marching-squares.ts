import { Vec2 } from '../types/common';

/**
 * Extract iso-contours from a scalar field with marching squares, returning
 * closed rings of `[column, row]` field coordinates (fractional, from linear
 * edge interpolation). A sample is treated as "inside" when its value is `>=`
 * `isoLevel`; each ring therefore encloses a connected inside region (outer
 * boundaries and holes both come out as separate rings — see
 * {@link ringsToPolygonCoordinates} to group them).
 *
 * Crossings are keyed by the grid edge they sit on (not their floating-point
 * position), so segments from adjacent cells stitch together exactly into closed
 * loops without epsilon matching. The two ambiguous saddle cases are resolved by
 * the cell-centre average.
 *
 * @param field row-major scalar field of length `cols * rows`
 * @param cols number of columns
 * @param rows number of rows
 * @param isoLevel contour threshold
 *
 * @group Geometries
 */
export function marchingSquares(
  field: ArrayLike<number>,
  cols: number,
  rows: number,
  isoLevel: number,
): Vec2[][] {
  if (cols < 2 || rows < 2) return [];

  const at = (c: number, r: number) => field[r * cols + c];

  // Interpolated crossing position on an edge between values fa (t=0) and fb (t=1).
  const cross = (fa: number, fb: number) => {
    const d = fb - fa;
    if (d === 0 || !Number.isFinite(d)) return 0.5;
    const t = (isoLevel - fa) / d;
    return t < 0 ? 0 : t > 1 ? 1 : t;
  };

  const points = new Map<string, Vec2>();
  const segments: [string, string][] = [];
  const addPoint = (id: string, p: Vec2) => {
    if (!points.has(id)) points.set(id, p);
  };

  // Edge identifiers are shared between neighbouring cells (H:c:r spans the
  // horizontal grid edge (c,r)-(c+1,r); V:c:r spans the vertical edge
  // (c,r)-(c,r+1)), so a crossing on a shared edge gets the same id + point.
  const emit = (c: number, r: number) => {
    const tl = at(c, r);
    const tr = at(c + 1, r);
    const br = at(c + 1, r + 1);
    const bl = at(c, r + 1);

    let idx = 0;
    if (tl >= isoLevel) idx |= 1;
    if (tr >= isoLevel) idx |= 2;
    if (br >= isoLevel) idx |= 4;
    if (bl >= isoLevel) idx |= 8;
    if (idx === 0 || idx === 15) return;

    const idT = 'H:' + c + ':' + r;
    const idB = 'H:' + c + ':' + (r + 1);
    const idL = 'V:' + c + ':' + r;
    const idR = 'V:' + (c + 1) + ':' + r;
    const T = (): [string, Vec2] => [idT, [c + cross(tl, tr), r]];
    const B = (): [string, Vec2] => [idB, [c + cross(bl, br), r + 1]];
    const L = (): [string, Vec2] => [idL, [c, r + cross(tl, bl)]];
    const R = (): [string, Vec2] => [idR, [c + 1, r + cross(tr, br)]];

    const seg = (a: [string, Vec2], b: [string, Vec2]) => {
      addPoint(a[0], a[1]);
      addPoint(b[0], b[1]);
      segments.push([a[0], b[0]]);
    };

    switch (idx) {
      case 1:
        seg(L(), T());
        break;
      case 2:
        seg(T(), R());
        break;
      case 3:
        seg(L(), R());
        break;
      case 4:
        seg(R(), B());
        break;
      case 6:
        seg(T(), B());
        break;
      case 7:
        seg(L(), B());
        break;
      case 8:
        seg(B(), L());
        break;
      case 9:
        seg(B(), T());
        break;
      case 11:
        seg(B(), R());
        break;
      case 12:
        seg(R(), L());
        break;
      case 13:
        seg(T(), R());
        break;
      case 14:
        seg(L(), T());
        break;
      case 5: {
        const centerInside = (tl + tr + br + bl) / 4 >= isoLevel;
        if (centerInside) {
          seg(T(), R());
          seg(B(), L());
        } else {
          seg(L(), T());
          seg(R(), B());
        }
        break;
      }
      case 10: {
        const centerInside = (tl + tr + br + bl) / 4 >= isoLevel;
        if (centerInside) {
          seg(L(), T());
          seg(R(), B());
        } else {
          seg(T(), R());
          seg(B(), L());
        }
        break;
      }
    }
  };

  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      emit(c, r);
    }
  }

  // Stitch the undirected segment graph into closed loops. Each crossing has an
  // even degree (2 in a clean contour, 4 at a resolved saddle), so we can always
  // leave a node by an unused incident segment.
  const incident = new Map<string, number[]>();
  segments.forEach(([a, b], i) => {
    (incident.get(a) ?? incident.set(a, []).get(a)!).push(i);
    (incident.get(b) ?? incident.set(b, []).get(b)!).push(i);
  });
  const used = new Uint8Array(segments.length);

  const rings: Vec2[][] = [];
  for (let s = 0; s < segments.length; s++) {
    if (used[s]) continue;
    const start = segments[s][0];
    const ring: Vec2[] = [];
    let cur = start;
    let edge = s;
    while (edge !== -1 && !used[edge]) {
      used[edge] = 1;
      const [a, b] = segments[edge];
      const next = a === cur ? b : a;
      ring.push(points.get(next)!);
      cur = next;
      // Pick the next unused segment incident to `cur`.
      edge = -1;
      const inc = incident.get(cur);
      if (inc) {
        for (const e of inc) {
          if (!used[e]) {
            edge = e;
            break;
          }
        }
      }
      if (cur === start) break;
    }
    if (ring.length >= 3) rings.push(ring);
  }

  return rings;
}
