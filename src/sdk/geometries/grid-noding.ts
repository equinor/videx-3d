import type { GridRing } from './triangulate-grid-delaunay';

// ⚠️ Kept free of three.js: the stack worker pool nodes tile pieces with it.

const NODE_EPS = 1e-9;
/**
 * Grid cells: a point this close to a ring's segment lies ON it (`nodeGridRings`).
 *
 * @group Geometries
 */
export const GRID_NODE_TOUCH = 1e-6;
const NODE_TOUCH = GRID_NODE_TOUCH;
// sine of the angle below which two segments are parallel for crossing purposes
const NODE_PARALLEL = 1e-10;

/**
 * Split every ring segment where it crosses a segment of ANOTHER ring, so that
 * the crossing becomes a shared point of both.
 *
 * ⚠️ Two constraint edges that cross cannot both survive a triangulation — only a
 * vertex AT the crossing lets both follow mesh edges. A chunk constrains its own
 * rim plus the rim of any neighbour it partially overlaps, which produces exactly
 * that, so they have to be noded first. Without it the triangulator silently
 * drops one of the two boundaries.
 *
 * Rings are returned in the input order, with their points unchanged apart from
 * the inserted crossings, and BY IDENTITY when nothing crosses.
 *
 * ⚠️ An endpoint lying on another ring's segment splits that segment at the
 * endpoint itself. That covers T-junctions and collinear segments that overlap with
 * different vertices — e.g. two layer pairs tracing the same pinch-out, simplified
 * apart. Left unsplit, the later ring's vertices land a rounding error to either
 * side of the earlier ring's locked edge, and the edge between them crosses it.
 *
 * @param open per ring, whether it is an open polyline (no closing segment)
 *
 * @group Geometries
 */
export function nodeGridRings(rings: GridRing[], open?: boolean[]): GridRing[] {
  type Seg = {
    ring: number;
    // the slot after an open ring's last vertex, which has no segment
    none: boolean;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
  };

  // Numbered ring by ring, so segment `base(r) + i` runs from ring r's vertex i.
  const segments: Seg[] = [];
  rings.forEach((ring, r) => {
    for (let i = 0; i < ring.length; i++) {
      const none = !!open?.[r] && i === ring.length - 1;
      const [x1, y1] = ring[i];
      const [x2, y2] = none ? ring[i] : ring[(i + 1) % ring.length];
      segments.push({
        ring: r,
        none,
        x1,
        y1,
        x2,
        y2,
        minX: Math.min(x1, x2),
        maxX: Math.max(x1, x2),
        minY: Math.min(y1, y2),
        maxY: Math.max(y1, y2),
      });
    }
  });
  const n = segments.length;
  if (n === 0) return rings;

  // Pairs of split points a rounding error apart, to become one point (rare).
  const joins: NodeSplit[] = [];

  // segment -> crossings along it, as (position, point)
  const splits: (NodeSplit[] | undefined)[] = new Array(n);
  let split = false;
  const addSplit = (si: number, t: number, p: number[], vertex = false) => {
    const list = splits[si];
    if (!list) {
      splits[si] = [{ t, p, vertex }];
      split = true;
      return;
    }
    // Two different partners can cross at the same place.
    const twin = list.find(e => Math.abs(e.t - t) < NODE_EPS);
    if (twin) joins.push(twin, { t, p, vertex });
    else list.push({ t, p, vertex });
  };
  const touch = (si: number, px: number, py: number) => {
    const s = segments[si];
    const rx = s.x2 - s.x1;
    const ry = s.y2 - s.y1;
    const len2 = rx * rx + ry * ry;
    if (len2 === 0) return 0;
    const qx = px - s.x1;
    const qy = py - s.y1;
    const t = (qx * rx + qy * ry) / len2;
    if (t <= NODE_EPS || t >= 1 - NODE_EPS) return 0;
    const cross = qx * ry - qy * rx;
    if (cross * cross > NODE_TOUCH * NODE_TOUCH * len2) return 0;
    addSplit(si, t, [px, py], true);
    return 1;
  };

  // ⭐ Pairs are VISITED in x-sweep order — by `minX`, then input order — and each
  // segment against the earlier ones in that order. Which of two near-coincident
  // crossings a segment keeps depends on the order they arrive in, so this is what
  // makes the result independent of the grid below.
  const keys = new Float64Array(n);
  for (let i = 0; i < n; i++) keys[i] = segments[i].minX;
  // A native sort of the keys, then each segment placed after the equal keys
  // before it: the order of the stable comparator sort this replaced.
  const sorted = keys.slice().sort();
  const ties = new Int32Array(n);
  const order = new Int32Array(n);
  const rank = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    let lo = 0;
    let hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid] < keys[i]) lo = mid + 1;
      else hi = mid;
    }
    const k = lo + ties[lo]++;
    order[k] = i;
    rank[i] = k;
  }

  // ⭐ ...but FOUND through a uniform grid over the segment boxes. A sweep compares
  // every pair whose x spans overlap, and a vertical line through a chunk crosses
  // every termination line and ring in it — thousands of pairs per segment, nearly
  // all far apart in y. Cells at least as large as the average segment keep a
  // segment to a few cells; at least `area / n` keeps the grid to ~n cells.
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let extent = 0;
  for (const s of segments) {
    if (s.minX < minX) minX = s.minX;
    if (s.maxX > maxX) maxX = s.maxX;
    if (s.minY < minY) minY = s.minY;
    if (s.maxY > maxY) maxY = s.maxY;
    extent += Math.max(s.maxX - s.minX, s.maxY - s.minY);
  }
  const width = maxX - minX;
  const height = maxY - minY;
  const cell = Math.max(
    extent / n,
    Math.sqrt((width * height) / n),
    Math.max(width, height) / n,
    1e-9,
  );
  const gx = Math.floor(width / cell) + 1;
  const gy = Math.floor(height / cell) + 1;
  const cellX = (x: number) => Math.min(gx - 1, Math.floor((x - minX) / cell));
  const cellY = (y: number) => Math.min(gy - 1, Math.floor((y - minY) / cell));

  // Every segment is listed in every cell its box touches (CSR layout).
  const span = new Int32Array(4 * n);
  const start = new Int32Array(gx * gy + 1);
  for (let si = 0; si < n; si++) {
    const s = segments[si];
    if (s.none) continue;
    const x0 = cellX(s.minX);
    const x1 = cellX(s.maxX);
    const y0 = cellY(s.minY);
    const y1 = cellY(s.maxY);
    span[4 * si] = x0;
    span[4 * si + 1] = x1;
    span[4 * si + 2] = y0;
    span[4 * si + 3] = y1;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) start[y * gx + x + 1]++;
    }
  }
  for (let c = 0; c < gx * gy; c++) start[c + 1] += start[c];
  const entries = new Int32Array(start[gx * gy]);
  const fill = start.slice(0, gx * gy);
  for (let si = 0; si < n; si++) {
    if (segments[si].none) continue;
    for (let y = span[4 * si + 2]; y <= span[4 * si + 3]; y++) {
      for (let x = span[4 * si]; x <= span[4 * si + 1]; x++) {
        entries[fill[y * gx + x]++] = si;
      }
    }
  }

  const seen = new Int32Array(n).fill(-1);
  const near: number[] = [];
  for (let k = 0; k < n; k++) {
    const si = order[k];
    const s = segments[si];
    if (s.none) continue;
    near.length = 0;
    for (let y = span[4 * si + 2]; y <= span[4 * si + 3]; y++) {
      for (let x = span[4 * si]; x <= span[4 * si + 1]; x++) {
        for (let e = start[y * gx + x]; e < start[y * gx + x + 1]; e++) {
          const oi = entries[e];
          if (rank[oi] >= k || seen[oi] === si) continue;
          seen[oi] = si;
          const o = segments[oi];
          if (o.ring === s.ring) continue;
          // Boxes that merely share a cell. Inclusive, like the sweep: segments
          // that only touch end to end still have to be compared.
          if (o.maxX < s.minX || o.minX > s.maxX) continue;
          if (o.minY > s.maxY || o.maxY < s.minY) continue;
          near.push(rank[oi]);
        }
      }
    }
    near.sort((a, b) => a - b);

    for (const r of near) {
      const oi = order[r];
      const o = segments[oi];

      const touches =
        touch(si, o.x1, o.y1) +
        touch(si, o.x2, o.y2) +
        touch(oi, s.x1, s.y1) +
        touch(oi, s.x2, s.y2);
      // two straight segments that touch cannot also cross
      if (touches > 0) continue;

      const rx = s.x2 - s.x1;
      const ry = s.y2 - s.y1;
      const ox = o.x2 - o.x1;
      const oy = o.y2 - o.y1;
      const denom = rx * oy - ry * ox;
      // near-parallel pairs meet only at a touch; their crossing is rounding noise
      const scale = NODE_PARALLEL * Math.hypot(rx, ry) * Math.hypot(ox, oy);
      if (Math.abs(denom) <= scale) continue;
      const dx = o.x1 - s.x1;
      const dy = o.y1 - s.y1;
      const t = (dx * oy - dy * ox) / denom;
      const u = (dx * ry - dy * rx) / denom;
      if (t < -NODE_EPS || t > 1 + NODE_EPS) continue;
      if (u < -NODE_EPS || u > 1 + NODE_EPS) continue;

      // ⭐ Computed ONCE and shared, so both rings insert bit-identical
      // coordinates and land on the same vertex.
      const p = [s.x1 + t * rx, s.y1 + t * ry];
      // An endpoint is already a vertex; only interior crossings need splitting.
      if (t > NODE_EPS && t < 1 - NODE_EPS) addSplit(si, t, p);
      if (u > NODE_EPS && u < 1 - NODE_EPS) addSplit(oi, u, p);
    }
  }

  if (!split) return rings;

  // ⭐ Three rings crossing at (almost) one point give a crossing per PAIR, a
  // rounding error apart. Each line holds two of them side by side, so joining
  // neighbours along every segment reaches the whole cluster.
  const close = (p: number[], q: number[]) =>
    Math.abs(p[0] - q[0]) <= NODE_TOUCH && Math.abs(p[1] - q[1]) <= NODE_TOUCH;
  let si = 0;
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++, si++) {
      const list = splits[si];
      if (!list) continue;
      list.sort((a, b) => a.t - b.t);
      for (let k = 1; k < list.length; k++) {
        if (close(list[k - 1].p, list[k].p)) joins.push(list[k - 1], list[k]);
      }
      // A crossing a rounding error from the segment's own end IS that vertex.
      const end = ring[(i + 1) % ring.length];
      const first = list[0];
      const last = list[list.length - 1];
      if (close(first.p, ring[i])) {
        joins.push(first, { t: 0, p: ring[i], vertex: true, fixed: true });
      }
      if (close(last.p, end)) {
        joins.push(last, { t: 1, p: end, vertex: true, fixed: true });
      }
    }
  }
  if (joins.length > 0) weldJoins(joins);

  si = 0;
  return rings.map(ring => {
    const out: GridRing = [];
    for (let i = 0; i < ring.length; i++, si++) {
      out.push(ring[i]);
      const list = splits[si];
      if (!list) continue;
      if (joins.length === 0) {
        for (const e of list) out.push(e.p);
        continue;
      }
      // Welded points can coincide with their neighbour or the segment's end.
      const end = ring[(i + 1) % ring.length];
      for (const { p } of list) {
        const last = out[out.length - 1];
        if (last[0] === p[0] && last[1] === p[1]) continue;
        if (end[0] === p[0] && end[1] === p[1]) continue;
        out.push(p);
      }
    }
    return out;
  });
}

type NodeSplit = {
  t: number;
  p: number[];
  // `p` sits on an existing ring vertex, so its cluster should be put there
  vertex: boolean;
  // `p` IS a ring's own vertex, which never moves
  fixed?: boolean;
};

/**
 * Put every cluster of joined points (`joins` holds them in pairs) at one
 * position, IN PLACE — each crossing point is one array shared by both its
 * segments, so they all see it. A ring's own vertex wins, then a point on one.
 */
function weldJoins(joins: NodeSplit[]) {
  const parent = new Map<number[], number[]>();
  const find = (p: number[]) => {
    let root = p;
    for (let q = parent.get(root)!; q !== root; q = parent.get(root)!) root = q;
    while (p !== root) {
      const next = parent.get(p)!;
      parent.set(p, root);
      p = next;
    }
    return root;
  };
  const fixed = new Set<number[]>();
  for (const e of joins) {
    if (!parent.has(e.p)) parent.set(e.p, e.p);
    if (e.fixed) fixed.add(e.p);
  }
  for (let k = 0; k < joins.length; k += 2) {
    const a = find(joins[k].p);
    const b = find(joins[k + 1].p);
    if (a !== b) parent.set(a, b);
  }
  const rank = (e: NodeSplit) => (e.fixed ? 2 : e.vertex ? 1 : 0);
  const target = new Map<number[], NodeSplit>();
  for (const e of joins) {
    const root = find(e.p);
    const best = target.get(root);
    if (!best || rank(e) > rank(best)) target.set(root, e);
  }
  for (const p of [...parent.keys()]) {
    if (fixed.has(p)) continue;
    const to = target.get(find(p))!.p;
    p[0] = to[0];
    p[1] = to[1];
  }
}
