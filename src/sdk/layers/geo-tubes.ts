import {
  conformalOffset,
  type ConformalOrigin,
} from '../projection/conformal-sphere';
import type { LonLat } from './geo-lines';

// ⚠️ Free of three.js: the nodes are laid on a worker (`generateGeoTubeNodes`).

const DEG = Math.PI / 180;
const EARTH_RADIUS = 6371008.8;
const METRES_PER_DEGREE = DEG * EARTH_RADIUS;

/**
 * Floats a tube's node holds (see {@link GeoTubeNodeArrays}): its offset on the conformal
 * sphere (2), its lift off the ground (1), the ground found then (1), its way east, north
 * and up (3), 1 where it ends a part (1), its feature's id (1), and one spare.
 *
 * @group Layers
 */
export const GEO_TUBE_NODE_STRIDE = 10;

/**
 * A line of a tubes layer: its feature's id, its parts in longitude and latitude, and their
 * bounds (min lon, min lat, max lon, max lat).
 *
 * @group Layers
 */
export type GeoTubeRoute = {
  id: number;
  parts: LonLat[][];
  bounds: [number, number, number, number];
};

/**
 * Routes packed in typed arrays ({@link packGeoTubeRoutes}), to send to a worker: every
 * part's vertices in one array (longitude, latitude), where each part starts in it (a vertex
 * index; one more, the end), and each part's feature id and bounds (min lon, min lat, max
 * lon, max lat).
 *
 * @group Layers
 */
export type GeoTubeRoutes = {
  coordinates: Float64Array;
  starts: Uint32Array;
  ids: Float64Array;
  bounds: Float64Array;
};

/**
 * Where a tube's nodes are written by {@link layGeoTubeNodes}: `nodes`
 * {@link GEO_TUBE_NODE_STRIDE} floats a node, `lonLat` two a node, `along` its distance
 * from its part's start in metres, `near` 1 where it is close enough to the camera for a
 * free span to show (its ground wanted, see {@link liftGeoTubeNodes}).
 *
 * @group Layers
 */
export type GeoTubeNodeArrays = {
  capacity: number;
  nodes: Float32Array;
  lonLat: Float64Array;
  along: Float64Array;
  near: Uint8Array;
};

/**
 * How {@link layGeoTubeNodes} lays the lines.
 *
 * @group Layers
 */
export type GeoTubeLaying = {
  /** metres between nodes near the camera */
  spacing: number;
  /** and farther off, this much of the distance to the camera, if more. Default 0.01 */
  spacingPerDistance?: number;
  /** the longest hollow a pipe bridges, resting on the high points, metres. Default 0 */
  span?: number;
  /** rounds off the corners `span` leaves, over a window in metres. Default 0 */
  smoothing?: number;
  /** metres from the camera past which nothing is laid. Default Infinity */
  maxDistance?: number;
};

/**
 * The nodes {@link geoTubeNodesAround} lays, in arrays of their own length (as
 * {@link GeoTubeNodeArrays}), and the share of the distance they ended up spaced by.
 *
 * @group Layers
 */
export type GeoTubeNodesLaid = {
  count: number;
  nodes: Float32Array;
  lonLat: Float64Array;
  along: Float64Array;
  near: Uint8Array;
  spacingPerDistance: number;
};

// The great-circle distance in metres (geoDistance, without the arrays).
function distance(lon0: number, lat0: number, lon1: number, lat1: number) {
  const dLat = (lat1 - lat0) * DEG;
  const dLon = (lon1 - lon0) * DEG;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat0 * DEG) * Math.cos(lat1 * DEG) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Routes in typed arrays, to lay on a worker (see {@link GeoTubeRoutes}). Parts of fewer
 * than two vertices are left out.
 *
 * @group Layers
 */
export function packGeoTubeRoutes(routes: GeoTubeRoute[]): GeoTubeRoutes {
  const parts = routes.flatMap(route =>
    route.parts
      .filter(part => part.length >= 2)
      .map(part => ({ id: route.id, part })),
  );
  const total = parts.reduce((sum, { part }) => sum + part.length, 0);
  const coordinates = new Float64Array(total * 2);
  const starts = new Uint32Array(parts.length + 1);
  const ids = new Float64Array(parts.length);
  const bounds = new Float64Array(parts.length * 4);
  let at = 0;
  parts.forEach(({ id, part }, p) => {
    starts[p] = at;
    ids[p] = id;
    let minLon = Infinity;
    let minLat = Infinity;
    let maxLon = -Infinity;
    let maxLat = -Infinity;
    for (const [longitude, latitude] of part) {
      coordinates[2 * at] = longitude;
      coordinates[2 * at + 1] = latitude;
      minLon = Math.min(minLon, longitude);
      minLat = Math.min(minLat, latitude);
      maxLon = Math.max(maxLon, longitude);
      maxLat = Math.max(maxLat, latitude);
      at++;
    }
    bounds.set([minLon, minLat, maxLon, maxLat], 4 * p);
  });
  starts[parts.length] = at;
  return { coordinates, starts, ids, bounds };
}

/**
 * Where the ground under `nodes` (heights, NaN for unknown), `along` metres apart in all,
 * would hold a stiff pipe up: its lift over each, as a pipe resting on the highest ground
 * within `span` / 2 either way (a rolling maximum, as `drapePolyline`'s), rounded off over
 * `smoothing` and never below the ground. 0 where the ground is unknown.
 *
 * @group Layers
 */
export function geoSpanLift(
  ground: Float64Array,
  along: Float64Array,
  span: number,
  smoothing = 0,
): Float64Array {
  const n = ground.length;
  const lift = new Float64Array(n);
  if (span <= 0 || n === 0) return lift;
  const half = span / 2;
  const shaped = new Float64Array(n);
  let from = 0;
  let to = 0;
  for (let i = 0; i < n; i++) {
    while (along[i] - along[from] > half) from++;
    while (to + 1 < n && along[to + 1] - along[i] <= half) to++;
    let best = -Infinity;
    for (let j = from; j <= to; j++)
      if (!Number.isNaN(ground[j]) && ground[j] > best) best = ground[j];
    shaped[i] = best;
  }
  const smooth = smoothing / 2;
  from = 0;
  to = 0;
  for (let i = 0; i < n; i++) {
    if (Number.isNaN(ground[i])) continue;
    let value = shaped[i];
    if (smooth > 0) {
      while (along[i] - along[from] > smooth) from++;
      while (to + 1 < n && along[to + 1] - along[i] <= smooth) to++;
      let sum = 0;
      let count = 0;
      for (let j = from; j <= to; j++) {
        if (shaped[j] === -Infinity) continue;
        sum += shaped[j];
        count++;
      }
      if (count > 0) value = sum / count;
    }
    lift[i] = Math.max(value - ground[i], 0);
  }
  return lift;
}

// Node `i`'s way along its part (`first`…`last`), east, north and `up` (metres between its
// neighbours'), as a unit vector.
function writeTangent(
  out: GeoTubeNodeArrays,
  i: number,
  first: number,
  last: number,
  up: number,
) {
  const { nodes, lonLat } = out;
  const a = Math.max(i - 1, first);
  const b = Math.min(i + 1, last);
  const k = Math.cos(lonLat[2 * i + 1] * DEG) * METRES_PER_DEGREE;
  const east = (lonLat[2 * b] - lonLat[2 * a]) * k;
  const north = (lonLat[2 * b + 1] - lonLat[2 * a + 1]) * METRES_PER_DEGREE;
  const length = Math.hypot(east, north, up) || 1;
  const at = i * GEO_TUBE_NODE_STRIDE;
  nodes[at + 4] = east / length;
  nodes[at + 5] = north / length;
  nodes[at + 6] = up / length;
}

/**
 * Lay lines in longitude and latitude as a tube's nodes (see {@link GeoTubeNodeArrays}): every
 * route vertex, and between them a node every `spacing` metres near the camera's foot
 * `centre` (its `altitude` over the ground counted), farther apart farther off (a
 * `spacingPerDistance` share of the distance), so a whole network costs nodes where they are
 * seen. Each on the ground the GPU finds, `fallback` where it has none, level, its way east
 * and north; those closer together than `span` are marked `near`, for
 * {@link liftGeoTubeNodes} to rest on the ground it finds. Returns the nodes written, or -1
 * when they would not fit in `capacity`.
 *
 * @param origin the globe's conformal sphere (`Globe.conformalOrigin`): each node's offset
 *   on it, as the GPU places it
 *
 * @group Layers
 */
export function layGeoTubeNodes(
  routes: GeoTubeRoutes,
  centre: LonLat,
  altitude: number,
  laying: GeoTubeLaying,
  origin: ConformalOrigin,
  fallback: number,
  out: GeoTubeNodeArrays,
): number {
  const spacing = Math.max(laying.spacing, 0.1);
  const perDistance = laying.spacingPerDistance ?? 0.01;
  const span = laying.span ?? 0;
  const maxDistance = laying.maxDistance ?? Infinity;
  const h2 = altitude * altitude;
  const [cx, cy] = centre;
  const away = (longitude: number, latitude: number) =>
    Math.sqrt(distance(longitude, latitude, cx, cy) ** 2 + h2);
  const stepAt = (d: number) => Math.max(spacing, d * perDistance);
  const { coordinates, starts, ids, bounds } = routes;
  const { nodes, lonLat, along, near, capacity } = out;
  const S = GEO_TUBE_NODE_STRIDE;
  const offset: [number, number] = [0, 0];
  let count = 0;

  for (let p = 0; p + 1 < starts.length; p++) {
    const first = starts[p];
    const last = starts[p + 1] - 1;
    if (last - first < 1) continue;
    if (maxDistance < Infinity) {
      // Its bounds' nearest point to the centre.
      const nearLon = Math.min(Math.max(cx, bounds[4 * p]), bounds[4 * p + 2]);
      const nearLat = Math.min(
        Math.max(cy, bounds[4 * p + 1]),
        bounds[4 * p + 3],
      );
      if (away(nearLon, nearLat) > maxDistance) continue;
    }
    const id = ids[p];
    const begin = count;
    // Each node, with the step that laid it.
    const put = (longitude: number, latitude: number, step: number) => {
      if (count >= capacity) return false;
      lonLat[2 * count] = longitude;
      lonLat[2 * count + 1] = latitude;
      along[count] =
        count === begin
          ? 0
          : along[count - 1] +
            distance(
              lonLat[2 * count - 2],
              lonLat[2 * count - 1],
              longitude,
              latitude,
            );
      near[count] = span > 0 && step < span ? 1 : 0;
      count++;
      return true;
    };
    // The nodes: each vertex, and between them as far apart as the distance allows.
    for (let v = first; v < last; v++) {
      const ax = coordinates[2 * v];
      const ay = coordinates[2 * v + 1];
      const bx = coordinates[2 * v + 2];
      const by = coordinates[2 * v + 3];
      const length = distance(ax, ay, bx, by);
      let t = stepAt(away(ax, ay));
      if (!put(ax, ay, t)) return -1;
      while (t < length) {
        const x = ax + ((bx - ax) * t) / length;
        const y = ay + ((by - ay) * t) / length;
        const step = stepAt(away(x, y));
        if (!put(x, y, step)) return -1;
        t += step;
      }
    }
    const lx = coordinates[2 * last];
    const ly = coordinates[2 * last + 1];
    if (!put(lx, ly, stepAt(away(lx, ly)))) return -1;

    const end = count - 1;
    for (let i = begin; i <= end; i++) {
      conformalOffset(origin, lonLat[2 * i + 1], lonLat[2 * i], offset);
      const at = i * S;
      nodes[at] = offset[0];
      nodes[at + 1] = offset[1];
      nodes[at + 2] = 0;
      nodes[at + 3] = fallback;
      writeTangent(out, i, begin, end, 0);
      nodes[at + 7] = i === end ? 1 : 0;
      nodes[at + 8] = id;
      nodes[at + 9] = 0;
    }
  }
  return count;
}

/**
 * Rest the `near` nodes laid by {@link layGeoTubeNodes} on the ground (`groundAt`, sampled
 * there only), a stiff pipe on the high points over the hollows (`span`, see
 * {@link geoSpanLift}): their lift, ground and slope. Where the ground is unknown, `fallback`
 * and level. Again as often as the ground sharpens: each time from the ground alone. Returns
 * the first and last node written, or null for none.
 *
 * @group Layers
 */
export function liftGeoTubeNodes(
  out: GeoTubeNodeArrays,
  count: number,
  laying: Pick<GeoTubeLaying, 'span' | 'smoothing'>,
  groundAt: (longitude: number, latitude: number) => number | null,
  fallback: number,
): [number, number] | null {
  const span = laying.span ?? 0;
  if (span <= 0) return null;
  const { nodes, lonLat, along, near } = out;
  const S = GEO_TUBE_NODE_STRIDE;
  let written: [number, number] | null = null;
  for (let begin = 0; begin < count; ) {
    let end = begin;
    while (end < count - 1 && nodes[end * S + 7] < 0.5) end++;
    // The part's nodes from its first near one to its last.
    let a = -1;
    let b = -1;
    for (let i = begin; i <= end; i++)
      if (near[i]) {
        if (a < 0) a = i;
        b = i;
      }
    if (a >= 0) {
      const n = b - a + 1;
      const ground = new Float64Array(n).fill(NaN);
      const at = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        at[i] = along[a + i];
        if (!near[a + i]) continue;
        const found = groundAt(lonLat[2 * (a + i)], lonLat[2 * (a + i) + 1]);
        if (found !== null && Number.isFinite(found)) ground[i] = found;
      }
      const lift = geoSpanLift(ground, at, span, laying.smoothing ?? 0);
      for (let i = 0; i < n; i++) {
        const node = (a + i) * S;
        nodes[node + 2] = lift[i];
        nodes[node + 3] = Number.isNaN(ground[i]) ? fallback : ground[i];
        // Up only where both neighbours' heights are known.
        const ia = Math.max(i - 1, 0);
        const ib = Math.min(i + 1, n - 1);
        const up =
          Number.isNaN(ground[ia]) || Number.isNaN(ground[ib])
            ? 0
            : ground[ib] + lift[ib] - ground[ia] - lift[ia];
        writeTangent(out, a + i, begin, end, up);
      }
      written = [written ? written[0] : a, b];
    }
    begin = end + 1;
  }
  return written;
}

/**
 * The ground under the nodes laid by {@link layGeoTubeNodes} that no relief tile drawn holds
 * (`placed` false), where the GPU lays them on what the node holds: from `groundAt` — the
 * relief's tiles in, coarser past the far plane — else `fallback`. With `skipNear`, the near
 * ones are left to {@link liftGeoTubeNodes}. Returns the first and last node changed, or
 * null for none.
 *
 * @group Layers
 */
export function groundGeoTubeNodes(
  out: GeoTubeNodeArrays,
  count: number,
  placed: (index: number) => boolean,
  groundAt: (longitude: number, latitude: number) => number | null,
  fallback: number,
  skipNear = false,
): [number, number] | null {
  const { nodes, lonLat, near } = out;
  const S = GEO_TUBE_NODE_STRIDE;
  let first = -1;
  let last = -1;
  for (let i = 0; i < count; i++) {
    if (placed(i) || (skipNear && near[i])) continue;
    const found = groundAt(lonLat[2 * i], lonLat[2 * i + 1]);
    const ground = Math.fround(
      found !== null && Number.isFinite(found) ? found : fallback,
    );
    if (nodes[i * S + 3] === ground) continue;
    nodes[i * S + 3] = ground;
    if (first < 0) first = i;
    last = i;
  }
  return first < 0 ? null : [first, last];
}

// Where geoTubeNodesAround lays nodes: kept from call to call, grown as needed.
let scratch: GeoTubeNodeArrays | null = null;
function scratchFor(capacity: number): GeoTubeNodeArrays {
  if (!scratch || scratch.nodes.length < capacity * GEO_TUBE_NODE_STRIDE)
    scratch = {
      capacity,
      nodes: new Float32Array(capacity * GEO_TUBE_NODE_STRIDE),
      lonLat: new Float64Array(capacity * 2),
      along: new Float64Array(capacity),
      near: new Uint8Array(capacity),
    };
  return { ...scratch, capacity };
}

/**
 * {@link layGeoTubeNodes} about the camera, in arrays of their own (to transfer from a
 * worker): spaced farther apart (`spacingPerDistance` doubled, up to five times) until they
 * fit in `capacity`; none if they never do. The ground under the `near` ones is
 * {@link liftGeoTubeNodes}' to find, where the relief is.
 *
 * @group Layers
 */
export function geoTubeNodesAround(
  routes: GeoTubeRoutes,
  centre: LonLat,
  altitude: number,
  laying: GeoTubeLaying,
  origin: ConformalOrigin,
  fallback: number,
  capacity: number,
): GeoTubeNodesLaid {
  let size = Math.min(capacity, 16384);
  let perDistance = laying.spacingPerDistance ?? 0.01;
  let out = scratchFor(size);
  let count = -1;
  for (let tries = 1; count < 0; ) {
    out = scratchFor(size);
    count = layGeoTubeNodes(
      routes,
      centre,
      altitude,
      { ...laying, spacingPerDistance: perDistance },
      origin,
      fallback,
      out,
    );
    if (count >= 0) break;
    if (size < capacity) {
      size = Math.min(size * 2, capacity);
      continue;
    }
    if (tries++ >= 6) {
      count = 0;
      break;
    }
    perDistance *= 2;
  }
  return {
    count,
    nodes: out.nodes.slice(0, count * GEO_TUBE_NODE_STRIDE),
    lonLat: out.lonLat.slice(0, count * 2),
    along: out.along.slice(0, count),
    near: out.near.slice(0, count),
    spacingPerDistance: perDistance,
  };
}
