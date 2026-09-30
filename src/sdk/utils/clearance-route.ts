import { Vec2 } from '../types/common';
import {
  ClearanceGrid,
  cellCentre,
  cellIndexAt,
  clearanceAt,
} from './clearance-grid';

/**
 * Routing over a {@link ClearanceGrid} — a path that prefers OPEN GROUND over the short way.
 *
 * ⭐⭐ The one idea: cost is length multiplied by a penalty that grows as the ground gets tight and
 * vanishes once there is `comfort` metres of room. A shortest-path search under that cost takes the
 * roomiest corridor that is not a silly detour, and narrows only where the geometry leaves no
 * alternative — which is the behaviour a greedy "steer away from the obstacle" marcher cannot give,
 * because steering away has local maxima and no way back out of them.
 *
 * ⭐ Passability is a HARD floor, and it is at least one cell wide. Distance to an obstacle is
 * 1-Lipschitz, so if both ends of an edge are ≥ `cell` clear and the edge is at most `cell·√2` long,
 * every point on it is ≥ `cell·(1 − √2/2)` > 0 clear: **an edge between two passable cells can never
 * cross an obstacle.** That is what makes a coarse grid safe to route on, and it is also why the
 * cell size doubles as the route's minimum standoff.
 */

/** {@link routeThroughClearance} options. */
export type ClearanceRouteOptions = {
  /** hard floor on clearance (m). The effective floor is `max(this, grid.cell)` — see above. */
  minClearance: number;
  /** clearance (m) at or beyond which ground counts as fully open and costs nothing extra. */
  comfort: number;
  /** how strongly tight ground is avoided. 0 = plain shortest path; higher swings wider. */
  avoidance: number;
  /** extra cost (m) charged for finishing at a given goal point — a soft direction preference. */
  goalCost?: (p: Vec2) => number;
};

/** A seed the search may start from, with the cost already paid to reach it. */
export type RouteSeed = { point: Vec2; cost: number };

/** {@link routeThroughClearance} result. */
export type ClearanceRoute = {
  /** the cell-centre path, seed → goal. Blocky by construction — smooth it before use. */
  path: Vec2[];
  /** the smallest clearance anywhere along `path` (m) */
  bottleneck: number;
  /** the hard clearance floor the search actually used (m) */
  floor: number;
  /** cells settled — the search's real cost, for the diagnostics view */
  visited: number;
};

/** A lazy-deletion binary min-heap over cell indices. */
class CellHeap {
  private items: Int32Array;
  private keys: Float64Array;
  private n = 0;

  constructor(capacity: number) {
    this.items = new Int32Array(capacity);
    this.keys = new Float64Array(capacity);
  }

  get size(): number {
    return this.n;
  }

  push(item: number, key: number): void {
    if (this.n === this.items.length) {
      const items = new Int32Array(this.n * 2);
      const keys = new Float64Array(this.n * 2);
      items.set(this.items);
      keys.set(this.keys);
      this.items = items;
      this.keys = keys;
    }
    let i = this.n++;
    this.items[i] = item;
    this.keys[i] = key;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.keys[parent] <= this.keys[i]) break;
      this.swap(parent, i);
      i = parent;
    }
  }

  pop(): number {
    const top = this.items[0];
    this.n--;
    if (this.n > 0) {
      this.items[0] = this.items[this.n];
      this.keys[0] = this.keys[this.n];
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < this.n && this.keys[l] < this.keys[m]) m = l;
        if (r < this.n && this.keys[r] < this.keys[m]) m = r;
        if (m === i) break;
        this.swap(m, i);
        i = m;
      }
    }
    return top;
  }

  private swap(a: number, b: number): void {
    const ti = this.items[a];
    this.items[a] = this.items[b];
    this.items[b] = ti;
    const tk = this.keys[a];
    this.keys[a] = this.keys[b];
    this.keys[b] = tk;
  }
}

/**
 * The cheapest route from any seed to any goal cell under a clearance-weighted length cost.
 *
 * ⛔ NO SILENT FALLBACK: an unreachable goal, or a seed set with no passable cell in it, THROWS
 * naming which of the two it was. A caller never receives a route that violates the clearance floor.
 *
 * @param grid the free-space model
 * @param seeds where the route may begin, each with the cost already spent reaching it
 * @param isGoal tests a cell centre — the search stops once no unsettled cell can beat the best goal
 * @param options the cost shape
 *
 * @group Utils
 */
export function routeThroughClearance(
  grid: ClearanceGrid,
  seeds: RouteSeed[],
  isGoal: (p: Vec2) => boolean,
  options: ClearanceRouteOptions,
): ClearanceRoute {
  const { comfort, avoidance } = options;
  if (!(comfort > 0)) {
    throw new Error('routeThroughClearance: comfort must be > 0');
  }
  const floor = Math.max(options.minClearance, grid.cell);
  const n = grid.nx * grid.nz;
  const dist = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const settled = new Uint8Array(n);
  const heap = new CellHeap(1024);

  let seeded = 0;
  for (const seed of seeds) {
    const k = cellIndexAt(grid, seed.point);
    if (k < 0 || grid.values[k] < floor) continue;
    if (seed.cost < dist[k]) {
      dist[k] = seed.cost;
      heap.push(k, seed.cost);
      seeded++;
    }
  }
  if (seeded === 0) {
    throw new Error(
      `routeThroughClearance: no seed cell has the ${floor.toFixed(1)} m clearance the route needs — the start is in tighter ground than the cell size can route`,
    );
  }

  // Cost of ENTERING a cell: tight ground is charged a length multiplier that dies off at `comfort`.
  const weight = (k: number): number => {
    const tight = Math.max(0, 1 - grid.values[k] / comfort);
    return 1 + avoidance * tight * tight;
  };

  const orth = grid.cell;
  const diag = grid.cell * Math.SQRT2;
  let best = Infinity;
  let bestCell = -1;
  let visited = 0;

  while (heap.size > 0) {
    const k = heap.pop();
    if (settled[k]) continue;
    settled[k] = 1;
    visited++;
    // `goalCost` is non-negative, so once the frontier is past the best total no goal can beat it.
    if (dist[k] >= best) break;
    const p = cellCentre(grid, k);
    if (isGoal(p)) {
      const total = dist[k] + (options.goalCost?.(p) ?? 0);
      if (total < best) {
        best = total;
        bestCell = k;
      }
      // A goal cell is a terminus — the route has no reason to pass THROUGH the open field.
      continue;
    }
    const ix = k % grid.nx;
    const iz = (k - ix) / grid.nx;
    for (let dz = -1; dz <= 1; dz++) {
      const jz = iz + dz;
      if (jz < 0 || jz >= grid.nz) continue;
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dz === 0) continue;
        const jx = ix + dx;
        if (jx < 0 || jx >= grid.nx) continue;
        const j = jx + jz * grid.nx;
        if (settled[j] || grid.values[j] < floor) continue;
        const d = dist[k] + (dx !== 0 && dz !== 0 ? diag : orth) * weight(j);
        if (d < dist[j]) {
          dist[j] = d;
          prev[j] = k;
          heap.push(j, d);
        }
      }
    }
  }

  if (bestCell < 0) {
    throw new Error(
      `routeThroughClearance: no goal is reachable while holding ${floor.toFixed(1)} m of clearance`,
    );
  }

  const path: Vec2[] = [];
  let bottleneck = Infinity;
  for (let k = bestCell; k >= 0; k = prev[k]) {
    path.push(cellCentre(grid, k));
    if (grid.values[k] < bottleneck) bottleneck = grid.values[k];
  }
  path.reverse();
  return { path, bottleneck, floor, visited };
}

/** The smallest clearance found by sampling a segment every `step` metres. */
function segmentClearance(
  grid: ClearanceGrid,
  a: Vec2,
  b: Vec2,
  step: number,
): number {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const n = Math.max(1, Math.ceil(len / step));
  let min = Infinity;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const c = clearanceAt(grid, [
      a[0] + (b[0] - a[0]) * t,
      a[1] + (b[1] - a[1]) * t,
    ]);
    if (c < min) min = c;
  }
  return min;
}

/**
 * Straighten a cell path by replacing runs of vertices with a chord, but only where the chord keeps
 * as much room as the run it replaces. The 45°-quantised staircase a grid search produces becomes
 * long straight legs without the route sliding back toward the obstacle it just avoided.
 *
 * @group Utils
 */
export function shortcutRoute(
  grid: ClearanceGrid,
  path: Vec2[],
  floor: number,
): Vec2[] {
  if (path.length < 3) return path.map(p => [p[0], p[1]] as Vec2);
  const step = grid.cell / 2;
  const out: Vec2[] = [path[0]];
  let i = 0;
  while (i < path.length - 1) {
    let bestJ = i + 1;
    let runMin = clearanceAt(grid, path[i]);
    for (let j = i + 1; j < path.length; j++) {
      runMin = Math.min(runMin, clearanceAt(grid, path[j]));
      const keep = Math.max(floor, runMin);
      if (segmentClearance(grid, path[i], path[j], step) < keep) break;
      bestJ = j;
    }
    out.push(path[bestJ]);
    i = bestJ;
  }
  return out;
}

/**
 * Round a route's corners by repeated corner cutting, refusing any cut that would take a vertex
 * below `floor`. Corners are cut at a quarter of each adjacent leg, so the rounding scales with the
 * legs themselves — long field-scale legs get a broad sweep, short ones a small one.
 *
 * @group Utils
 */
export function smoothRoute(
  grid: ClearanceGrid,
  path: Vec2[],
  floor: number,
  passes = 3,
): Vec2[] {
  let current = path.map(p => [p[0], p[1]] as Vec2);
  for (let pass = 0; pass < passes; pass++) {
    if (current.length < 3) break;
    const next: Vec2[] = [current[0]];
    for (let i = 1; i < current.length - 1; i++) {
      const a = current[i - 1];
      const v = current[i];
      const b = current[i + 1];
      const q: Vec2 = [
        v[0] + (a[0] - v[0]) * 0.25,
        v[1] + (a[1] - v[1]) * 0.25,
      ];
      const r: Vec2 = [
        v[0] + (b[0] - v[0]) * 0.25,
        v[1] + (b[1] - v[1]) * 0.25,
      ];
      if (
        segmentClearance(grid, q, r, grid.cell / 2) >= floor &&
        clearanceAt(grid, q) >= floor &&
        clearanceAt(grid, r) >= floor
      ) {
        next.push(q, r);
      } else {
        next.push(v);
      }
    }
    next.push(current[current.length - 1]);
    current = next;
  }
  return current;
}
