// ⚠️ No runtime imports: scripts/generate-overlays.js loads this file with Node's own type
// stripping, which resolves neither extensionless paths nor types imported as values.

/**
 * Longitude, latitude in degrees.
 *
 * @group Layers
 */
export type LonLat = [longitude: number, latitude: number];

const DEG = Math.PI / 180;
/** The Earth's mean radius, in metres. */
const EARTH_RADIUS = 6371008.8;

/**
 * The great-circle distance between two points, in metres (haversine, on a sphere of the
 * Earth's mean radius).
 *
 * @group Layers
 */
export function geoDistance(
  [lon0, lat0]: LonLat,
  [lon1, lat1]: LonLat,
): number {
  const dLat = (lat1 - lat0) * DEG;
  const dLon = (lon1 - lon0) * DEG;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat0 * DEG) * Math.cos(lat1 * DEG) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Points along the great circle from `a` to `b` — `b` included, `a` not — no farther apart
 * than `step` metres: a straight route as a map draws it, curved in longitude and latitude.
 *
 * @group Layers
 */
export function greatCircleSteps(a: LonLat, b: LonLat, step = 1000): LonLat[] {
  const distance = geoDistance(a, b);
  const n = Math.max(1, Math.ceil(distance / step));
  const omega = distance / EARTH_RADIUS;
  if (omega < 1e-12) return [[b[0], b[1]]];
  const toVector = ([lon, lat]: LonLat) => [
    Math.cos(lat * DEG) * Math.cos(lon * DEG),
    Math.cos(lat * DEG) * Math.sin(lon * DEG),
    Math.sin(lat * DEG),
  ];
  const p = toVector(a);
  const q = toVector(b);
  const points: LonLat[] = [];
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const s0 = Math.sin((1 - t) * omega) / Math.sin(omega);
    const s1 = Math.sin(t * omega) / Math.sin(omega);
    const x = s0 * p[0] + s1 * q[0];
    const y = s0 * p[1] + s1 * q[1];
    const z = s0 * p[2] + s1 * q[2];
    points.push([
      Math.atan2(y, x) / DEG,
      Math.atan2(z, Math.hypot(x, y)) / DEG,
    ]);
  }
  points.push([b[0], b[1]]);
  return points;
}

/**
 * Join a line's nearest free end to the point `to` along the great circle (see
 * {@link greatCircleSteps}), when it lies within `maxGap` metres of it: a route cut short
 * of where it goes, as Sodir cuts its pipelines 500 m short of each facility. `parts` (a
 * multi-line's parts) are extended in place. `used` holds the ends joined already, as
 * `part:start` or `part:end`, so a line's two ends go to its two facilities.
 *
 * Returns the gap closed, in metres: 0 when the end was within `minGap` already (it is
 * then taken, not moved), -1 when every free end is farther than `maxGap` (nothing done).
 *
 * @group Layers
 */
export function joinNearestEnd(
  parts: LonLat[][],
  to: LonLat,
  used: Set<string>,
  { minGap = 1, maxGap = 60000, step = 1000 } = {},
): number {
  let bestPart = -1;
  let bestEnd: 'start' | 'end' = 'start';
  let bestGap = Infinity;
  for (let k = 0; k < parts.length; k++) {
    const part = parts[k];
    if (part.length === 0) continue;
    for (const end of ['start', 'end'] as const) {
      if (used.has(`${k}:${end}`)) continue;
      const gap = geoDistance(
        end === 'start' ? part[0] : part[part.length - 1],
        to,
      );
      if (gap < bestGap) {
        bestPart = k;
        bestEnd = end;
        bestGap = gap;
      }
    }
  }
  if (bestPart < 0 || bestGap > maxGap) return -1;
  used.add(`${bestPart}:${bestEnd}`);
  if (bestGap < minGap) return 0;
  const part = parts[bestPart];
  if (bestEnd === 'end') {
    // From the end to `to`.
    part.push(...greatCircleSteps(part[part.length - 1], to, step));
  } else {
    // From `to` to the start: the steps from the start to `to`, reversed, `to` first.
    const steps = greatCircleSteps(part[0], to, step).reverse();
    part.unshift(...steps);
  }
  return bestGap;
}

/**
 * Drop the points of a line in longitude and latitude that carry no shape, keeping every
 * point within `tolerance` of the result (Ramer–Douglas–Peucker, iterative), a degree of
 * longitude counted as `cos(latitude)` of one, so `tolerance` is in degrees of latitude
 * (0.001° is about 110 m). Its ends are always kept. For a coarser version of a line —
 * on a minimap, or seen from far off.
 *
 * @group Layers
 */
export function simplifyGeoLine(points: LonLat[], tolerance: number): LonLat[] {
  const n = points.length;
  if (n < 3) return points.map(([lon, lat]) => [lon, lat]);
  let middle = 0;
  for (const [, lat] of points) middle += lat;
  const k = Math.cos((middle / n) * DEG);
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  const tolerance2 = tolerance * tolerance;
  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    const ax = points[first][0] * k;
    const ay = points[first][1];
    const dx = points[last][0] * k - ax;
    const dy = points[last][1] - ay;
    const length = dx * dx + dy * dy;
    let worst = tolerance2;
    let worstAt = -1;
    for (let i = first + 1; i < last; i++) {
      const px = points[i][0] * k - ax;
      const py = points[i][1] - ay;
      const t =
        length > 0 ? Math.min(Math.max((px * dx + py * dy) / length, 0), 1) : 0;
      const d = (px - t * dx) ** 2 + (py - t * dy) ** 2;
      if (d > worst) {
        worst = d;
        worstAt = i;
      }
    }
    if (worstAt > 0) {
      keep[worstAt] = 1;
      stack.push([first, worstAt], [worstAt, last]);
    }
  }
  const out: LonLat[] = [];
  for (let i = 0; i < n; i++)
    if (keep[i]) out.push([points[i][0], points[i][1]]);
  return out;
}
