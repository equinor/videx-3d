import { BufferAttribute, BufferGeometry } from 'three';
import {
  CAP_SIDE_OPEN,
  createTinSampler,
  distanceToSegment2D,
  PlanarPolygonCoordinates,
  pointInPolygon,
  SurfaceChunk,
  SurfaceChunkBoundary,
  SurfaceChunkMesh,
  TinLocation,
  TinSampler,
  Vec2,
} from '../../sdk';
import type { ChunkLayer } from './chunk-defs';

/**
 * Whether a cut takes cap `i`. ⭐ A unit is bounded by TWO caps, so keeping one
 * whole keeps the cap that FLOORS it too; `seaKept` keeps cap 0, the sea bed —
 * as the floor of a sea the cut leaves whole, or on its own (`StackWater.keepBed`) —
 * and `ChunkLayer.keepCap` keeps a cap alone.
 */
export function capCut(
  layers: readonly ChunkLayer[],
  i: number,
  seaKept: boolean,
) {
  const kept = (j: number) => layers[j]?.section === false;
  return (
    !kept(i) && !kept(i - 1) && !layers[i]?.keepCap && !(seaKept && i === 0)
  );
}

/** The opacity a layer's CAP is drawn with: `capOpacity`, else `opacity`, else `fallback`. */
export function layerCapOpacity(
  layer: ChunkLayer | undefined,
  fallback: number,
) {
  return layer?.capOpacity ?? layer?.opacity ?? fallback;
}

/** What decides, per frame, which units a cap can be seen through. */
export type CapCullState = {
  /** the caller's layers, read for `opacity` and `section` */
  layers: readonly ChunkLayer[];
  surfaceOpacity: number;
  wallOpacity: number;
  wireframe: boolean;
  showWalls: boolean;
  /** the resolved peel (see `resolvePeel`) */
  top: number;
  base: number;
  /** the build intervals the camera is in or near (see {@link createIntervalProbe}) */
  cameraUnits: readonly number[];
};

/**
 * Whether nothing may be culled at all.
 *
 * ⚠️ A transparent CAP anywhere switches culling off, rather than opening the
 * units on either side of it: where the collapse dropped a coincident cap, a
 * shallower one stands in for it, so the cap a viewer looks through is not
 * necessarily the one bounding the unit behind it. A transparent FILL is exact per
 * interval (its walls and faces are its own), and is handled there.
 */
export function capCullingBlocked(
  state: Omit<CapCullState, 'top' | 'base' | 'cameraUnits'>,
) {
  return (
    state.wireframe ||
    !state.showWalls ||
    state.surfaceOpacity < 1 ||
    state.layers.some(layer => layerCapOpacity(layer, 1) < 1)
  );
}

/**
 * Per build interval, `1` where a cap facing it has to be drawn — the unit there
 * is not a closed, opaque solid this frame — or `null` when nothing may be culled
 * (see {@link capCullingBlocked}). Indexed by the ids in
 * `SurfaceChunkMesh.above`/`below`, so {@link CAP_SIDE_OPEN} is always `1`.
 */
export function openIntervals(
  boundaries: readonly SurfaceChunkBoundary[],
  state: CapCullState,
): Uint8Array | null {
  if (capCullingBlocked(state)) return null;
  const open = new Uint8Array(CAP_SIDE_OPEN + 1);
  open[CAP_SIDE_OPEN] = 1;
  for (let i = 0; i + 1 < boundaries.length && i < CAP_SIDE_OPEN; i++) {
    const { layer, fill } = boundaries[i];
    // A peeled unit is not drawn: a wall is kept for `top <= layer < base`.
    const peeled = layer < state.top || layer >= state.base;
    const opacity = state.layers[layer]?.opacity ?? state.wallOpacity;
    if (!fill || peeled || opacity < 1) open[i] = 1;
  }
  for (const unit of state.cameraUnits) {
    if (unit >= 0 && unit < CAP_SIDE_OPEN) open[unit] = 1;
  }
  return open;
}

/** One cut the stack declares; see {@link capOpenTable}. */
export type CapCutRule = {
  /** whether it takes the column's floor (`sectionCarrier` / `fenceCarrier`) */
  carrier: boolean;
  /** whether it leaves the sea bed's cap whole: the sea stays, or `StackWater.keepBed` */
  seaKept: boolean;
};

/**
 * {@link openIntervals} for one cap: also open every unit a cut can take, where
 * the cap itself SURVIVES that cut — in the half the cut removed, the cap is the
 * boundary left exposed.
 *
 * ⭐ Every DECLARED cut counts, whether or not it is drawing: a cap that survives
 * a cut is rare (the floor, a kept unit's caps, the sea bed), so the culling this
 * gives up is small, and it never lags a toggle by a frame.
 */
export function capOpenTable(
  open: Uint8Array,
  boundaries: readonly SurfaceChunkBoundary[],
  surface: Pick<SurfaceChunkMesh, 'layer' | 'ceiling'>,
  layers: readonly ChunkLayer[],
  cuts: readonly CapCutRule[],
): Uint8Array {
  const kept = (j: number) => layers[j]?.section === false;
  const carrier = !layers[surface.layer] && surface.layer === layers.length;
  const survives = cuts.some(cut =>
    carrier
      ? !(cut.carrier && !kept(layers.length - 1))
      : surface.ceiling
        ? kept(surface.layer - 1)
        : !capCut(layers, surface.layer, cut.seaKept),
  );
  if (!survives) return open;
  const table = open.slice();
  for (let i = 0; i + 1 < boundaries.length && i < CAP_SIDE_OPEN; i++) {
    if (!kept(boundaries[i].layer)) table[i] = 1;
  }
  return table;
}

/** The distinct unit ids one cap's triangles face, cached per neighbour array. */
const capUnitCache = new WeakMap<Uint8Array, number[]>();

function capUnits(above: Uint8Array, below: Uint8Array) {
  const cached = capUnitCache.get(above);
  if (cached) return cached;
  const seen = new Uint8Array(CAP_SIDE_OPEN + 1);
  for (let k = 0; k < above.length; k++) {
    seen[above[k]] = 1;
    seen[below[k]] = 1;
  }
  const units: number[] = [];
  for (let u = 0; u < CAP_SIDE_OPEN; u++) if (seen[u]) units.push(u);
  capUnitCache.set(above, units);
  return units;
}

/**
 * A key that changes exactly when the triangles {@link visibleCapIndex} keeps
 * can: the open state of each unit the cap actually faces.
 */
export function capVisibilityKey(
  surface: Pick<SurfaceChunkMesh, 'above' | 'below' | 'units'>,
  table: Uint8Array,
): string {
  if (!surface.above || !surface.below) return '';
  let key = '';
  for (const unit of surface.units ?? capUnits(surface.above, surface.below))
    key += table[unit];
  return key;
}

/**
 * Whether a cap going from key `from` to `to` (see {@link capVisibilityKey}) only
 * closes units — what it drew before is then still enough: more, never a hole.
 */
export function keyOnlyHides(from: string, to: string): boolean {
  if (from.length !== to.length) return false;
  for (let i = 0; i < from.length; i++) if (to[i] > from[i]) return false;
  return true;
}

/**
 * The triangles of a cap that are not buried: a triangle is kept when the unit
 * on EITHER side of it is open in `table`.
 *
 * @param index the cap's index, in the order `above`/`below` follow
 * @returns the kept triangles' vertex indices — `index` itself when every
 *   triangle is kept, an empty array when none is
 */
export function visibleCapIndex(
  index: ArrayLike<number>,
  above: Uint8Array,
  below: Uint8Array,
  table: Uint8Array,
): ArrayLike<number> {
  const triangles = above.length;
  let count = 0;
  for (let t = 0; t < triangles; t++) {
    if (table[above[t]] || table[below[t]]) count++;
  }
  if (count === triangles) return index;
  const out = new Uint32Array(count * 3);
  let n = 0;
  for (let t = 0; t < triangles; t++) {
    if (!table[above[t]] && !table[below[t]]) continue;
    out[n++] = index[3 * t];
    out[n++] = index[3 * t + 1];
    out[n++] = index[3 * t + 2];
  }
  return out;
}

/**
 * A geometry drawing a SUBSET of a cap's triangles: the cap's own attributes,
 * shared, and an index of its own. Release it with {@link releaseCapView}, never
 * `dispose()` alone — that would free the cap's buffers with it.
 */
export function createCapView(
  cap: BufferGeometry,
  index: ArrayLike<number>,
): BufferGeometry {
  const view = new BufferGeometry();
  for (const name in cap.attributes) {
    view.setAttribute(name, cap.attributes[name]);
  }
  view.setIndex(new BufferAttribute(index as Uint32Array, 1));
  // A subset of the cap, so the cap's bounds are a valid (if loose) bound — and
  // a cap carries no `position` to derive one from.
  view.boundingBox = cap.boundingBox?.clone() ?? null;
  view.boundingSphere = cap.boundingSphere?.clone() ?? null;
  return view;
}

/**
 * Free a {@link createCapView} view: detach the shared attributes FIRST, so the
 * dispose releases only the view's own index buffer.
 */
export function releaseCapView(view: BufferGeometry) {
  for (const name of Object.keys(view.attributes)) view.deleteAttribute(name);
  view.dispose();
}

// Per cap geometry, and dies with it: a streamed chunk makes a new probe per packet.
const locators = new WeakMap<BufferGeometry, TinSampler>();

function capLocator(geometry: BufferGeometry): TinSampler {
  let locator = locators.get(geometry);
  if (!locator) {
    const xz = geometry.getAttribute('xz').array as ArrayLike<number>;
    const flat = new Float32Array((xz.length / 2) * 3);
    for (let v = 0; v < xz.length / 2; v++) {
      flat[3 * v] = xz[2 * v];
      flat[3 * v + 2] = xz[2 * v + 1];
    }
    locator = createTinSampler(
      flat,
      geometry.getIndex()!.array as ArrayLike<number>,
    );
    locators.set(geometry, locator);
  }
  return locator;
}

/**
 * Which build intervals a point is in, or within `band` of — for the cap culling,
 * which must not hide the caps of a unit the camera is inside.
 *
 * The heights are taken from every cap that carries neighbours, interpolated at
 * the point with ONE triangle lookup: the caps share their topology and every
 * vertex carries every cap's height, so the weights found in one apply to all. A
 * boundary with no cap here (drawn by a neighbouring chunk, say) is treated as
 * unbounded, which can only widen the answer.
 *
 * The lookup structure is built on the first query that lands inside the chunk's
 * bounds, so a chunk the camera never enters pays nothing.
 *
 * @param outline the polygon the chunk was clipped to, in its XZ frame. A point
 *   more than `band` outside it is outside the block, as one beyond the bounds
 *   is; without it, every point in the bounds but off the caps opens every unit.
 * @returns `(x, y, z, band) => intervals`, in the chunk's own frame
 */
export function createIntervalProbe(
  chunk: SurfaceChunk,
  outline?: PlanarPolygonCoordinates | null,
) {
  const boundaries = chunk.boundaries;
  const caps = chunk.surfaces.filter(
    s =>
      s.above &&
      s.boundary !== undefined &&
      s.geometry.getAttribute('y') &&
      s.geometry.getAttribute('xz') &&
      s.geometry.getIndex(),
  );
  if (!boundaries || caps.length === 0) return () => [] as number[];

  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const cap of caps) {
    const box = cap.geometry.boundingBox;
    if (!box) {
      minX = minY = minZ = -Infinity;
      maxX = maxY = maxZ = Infinity;
      break;
    }
    minX = Math.min(minX, box.min.x);
    minY = Math.min(minY, box.min.y);
    minZ = Math.min(minZ, box.min.z);
    maxX = Math.max(maxX, box.max.x);
    maxY = Math.max(maxY, box.max.y);
    maxZ = Math.max(maxZ, box.max.z);
  }

  // ⭐ Only the LARGEST cap is searched. Every cap is a subset of one shared
  // tessellation, so a point it misses is off every cap bar a triangle only a
  // smaller one kept — and a miss opens every unit, which can only cull less.
  // Searching on cost a lookup grid PER CAP (~100 ms each) just outside the rim.
  const largest = caps.reduce((a, b) =>
    b.geometry.getIndex()!.count > a.geometry.getIndex()!.count ? b : a,
  );

  const at: TinLocation = { a: 0, b: 0, c: 0, wa: 0, wb: 0, wc: 0 };
  const heights = new Float64Array(boundaries.length);
  const all = boundaries.slice(0, -1).map((_, i) => i);

  const point: Vec2 = [0, 0];
  const nearOutline = (x: number, z: number, band: number) => {
    if (!outline || pointInPolygon(x, z, outline)) return true;
    point[0] = x;
    point[1] = z;
    for (const rings of outline) {
      for (const ring of rings) {
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          if (distanceToSegment2D(point, ring[j], ring[i]) <= band) return true;
        }
      }
    }
    return false;
  };

  return (x: number, y: number, z: number, band: number): number[] => {
    if (
      x < minX - band ||
      x > maxX + band ||
      y < minY - band ||
      y > maxY + band ||
      z < minZ - band ||
      z > maxZ + band
    ) {
      return [];
    }
    const found = capLocator(largest.geometry).locate(x, z, at);
    // Over no cap's triangle. In or near the outline nothing says which unit that
    // is, so open them all; farther out the camera is outside the block.
    if (!found) return nearOutline(x, z, band) ? all : [];

    heights.fill(NaN);
    for (const cap of caps) {
      const ys = cap.geometry.getAttribute('y').array as ArrayLike<number>;
      heights[cap.boundary!] =
        found.wa * ys[found.a] +
        found.wb * ys[found.b] +
        found.wc * ys[found.c];
    }
    const out: number[] = [];
    for (let i = 0; i + 1 < boundaries.length; i++) {
      let top = Infinity;
      for (let j = i; j >= 0; j--) {
        if (!Number.isNaN(heights[j])) {
          top = heights[j];
          break;
        }
      }
      let bottom = -Infinity;
      for (let j = i + 1; j < boundaries.length; j++) {
        if (!Number.isNaN(heights[j])) {
          bottom = heights[j];
          break;
        }
      }
      if (y <= top + band && y >= bottom - band) out.push(i);
    }
    return out;
  };
}
