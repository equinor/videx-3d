import type { Vec2 } from '../types/common';

// ⚠️ Free of three.js: plain math, as the frames.

const DEG = Math.PI / 180;

/**
 * A map projection of the whole Earth for a top-down map: longitude and latitude (degrees,
 * the longitude from the map's central meridian) to metres on the map, east and north, and
 * back. A sphere's, as such maps are drawn.
 *
 * @group Utils
 */
export type MapProjection = {
  /** what the `Minimap`'s `projection` names it */
  name: 'web-mercator' | 'equal-earth' | 'lambert-conformal-conic';
  /** metres east and north of longitude 0 (the central meridian) on the equator — or, for a cone, on its origin's parallel */
  forward(longitude: number, latitude: number): Vec2;
  /**
   * the longitude (from the central meridian) and latitude at `x`, `y`; a point past the
   * map's edge is taken to the nearest the map holds
   */
  inverse(x: number, y: number): Vec2;
  /** whether `x`, `y` lies on the map */
  contains(x: number, y: number): boolean;
  /**
   * a Lambert conformal conic's cone, for a shader to find its outline: its constant `n`,
   * `R·F`, the radius of its origin's parallel and of the parallel it ends at
   */
  cone?: { n: number; rf: number; rho0: number; rhoEnd: number };
};

/** The sphere Web Mercator is drawn on: the WGS84 equatorial radius, metres. */
export const WEB_MERCATOR_RADIUS = 6378137;
/** The latitude Web Mercator ends at, north and south: where it is square. */
export const WEB_MERCATOR_MAX_LATITUDE = 85.0511287798066;

const mercatorMaxY =
  WEB_MERCATOR_RADIUS *
  Math.log(Math.tan(Math.PI / 4 + (WEB_MERCATOR_MAX_LATITUDE * DEG) / 2));

/**
 * Web Mercator (EPSG:3857 on its sphere): conformal, so shapes and bearings hold, but areas
 * grow toward the poles — twice as wide at 60°, four times the area — and it ends at
 * {@link WEB_MERCATOR_MAX_LATITUDE}.
 *
 * @group Utils
 */
export const webMercator: MapProjection = {
  name: 'web-mercator',
  forward(longitude, latitude) {
    const lat = Math.max(
      Math.min(latitude, WEB_MERCATOR_MAX_LATITUDE),
      -WEB_MERCATOR_MAX_LATITUDE,
    );
    return [
      WEB_MERCATOR_RADIUS * longitude * DEG,
      WEB_MERCATOR_RADIUS * Math.log(Math.tan(Math.PI / 4 + (lat * DEG) / 2)),
    ];
  },
  inverse(x, y) {
    const yc = Math.max(Math.min(y, mercatorMaxY), -mercatorMaxY);
    const longitude = Math.max(
      Math.min(x / WEB_MERCATOR_RADIUS / DEG, 180),
      -180,
    );
    const latitude =
      (2 * Math.atan(Math.exp(yc / WEB_MERCATOR_RADIUS)) - Math.PI / 2) / DEG;
    return [longitude, latitude];
  },
  contains(x, y) {
    return (
      Math.abs(y) <= mercatorMaxY &&
      Math.abs(x) <= WEB_MERCATOR_RADIUS * Math.PI
    );
  },
};

/** The sphere Equal Earth is drawn on: the Earth's mean radius, metres. */
export const EQUAL_EARTH_RADIUS = 6371008.8;

// Equal Earth's polynomial (Šavrič, Patterson and Jenny, 2018).
const A1 = 1.340264;
const A2 = -0.081106;
const A3 = 0.000893;
const A4 = 0.003796;
const M = Math.sqrt(3) / 2;

// y / R at parametric latitude θ, and its derivative.
const eeY = (t: number) => {
  const t2 = t * t;
  const t6 = t2 * t2 * t2;
  return t * (A1 + A2 * t2 + t6 * (A3 + A4 * t2));
};
const eeDY = (t: number) => {
  const t2 = t * t;
  const t6 = t2 * t2 * t2;
  return A1 + 3 * A2 * t2 + t6 * (7 * A3 + 9 * A4 * t2);
};
const eeMaxT = Math.asin(M);
const eeMaxY = EQUAL_EARTH_RADIUS * eeY(eeMaxT);

// θ at y / R, by Newton's method from y / R / A1.
function eeTheta(yr: number): number {
  let t = yr / A1;
  for (let i = 0; i < 12; i++) {
    const step = (eeY(t) - yr) / eeDY(t);
    t -= step;
    if (Math.abs(step) < 1e-12) break;
  }
  return Math.max(Math.min(t, eeMaxT), -eeMaxT);
}

/**
 * Equal Earth: equal-area, so every region keeps its size against the others, with the
 * poles drawn as lines and shapes kept fair across the whole world.
 *
 * @group Utils
 */
export const equalEarth: MapProjection = {
  name: 'equal-earth',
  forward(longitude, latitude) {
    const t = Math.asin(M * Math.sin(latitude * DEG));
    return [
      (EQUAL_EARTH_RADIUS * 2 * Math.sqrt(3) * longitude * DEG * Math.cos(t)) /
        (3 * eeDY(t)),
      EQUAL_EARTH_RADIUS * eeY(t),
    ];
  },
  inverse(x, y) {
    const yc = Math.max(Math.min(y, eeMaxY), -eeMaxY);
    const t = eeTheta(yc / EQUAL_EARTH_RADIUS);
    const lambda =
      (3 * (x / EQUAL_EARTH_RADIUS) * eeDY(t)) /
      (2 * Math.sqrt(3) * Math.max(Math.cos(t), 1e-12));
    const longitude = Math.max(Math.min(lambda / DEG, 180), -180);
    const latitude =
      Math.asin(Math.max(Math.min(Math.sin(t) / M, 1), -1)) / DEG;
    return [longitude, latitude];
  },
  contains(x, y) {
    if (Math.abs(y) > eeMaxY) return false;
    const t = eeTheta(y / EQUAL_EARTH_RADIUS);
    const edge =
      (EQUAL_EARTH_RADIUS * 2 * Math.sqrt(3) * Math.PI * Math.cos(t)) /
      (3 * eeDY(t));
    return Math.abs(x) <= edge;
  },
};

/** The projections of the whole world by the `Minimap`'s name for them; a cone is made per view (see {@link lambertConformalConic}). */
export const MAP_PROJECTIONS: Record<
  'web-mercator' | 'equal-earth',
  MapProjection
> = {
  'web-mercator': webMercator,
  'equal-earth': equalEarth,
};

// How far short of the far pole a cone ends, degrees: that pole lies at infinity.
const CONE_END = 10;
// A cone flatter than this is a cylinder: Mercator.
const MIN_CONE = 1e-3;

/**
 * A Lambert conformal conic projection on a sphere of the Earth's mean radius: conformal,
 * true to scale along its two standard `parallels` (degrees) and nearly so between them —
 * the map for a region wider east–west than north–south at middle latitudes. Its origin's
 * parallel, `origin` (degrees), is at y = 0. It holds the half of the Earth about its
 * central meridian to 10° short of the far pole. Parallels either side of the equator
 * (a flat cone) give Mercator.
 *
 * @group Utils
 */
export function lambertConformalConic(
  parallels: [number, number],
  origin: number,
): MapProjection {
  const clamp = (latitude: number) => Math.max(Math.min(latitude, 89), -89);
  const p1 = clamp(parallels[0]) * DEG;
  const p2 = clamp(parallels[1]) * DEG;
  const t = (p: number) => Math.tan(Math.PI / 4 + p / 2);
  const n =
    Math.abs(p1 - p2) < 1e-9
      ? Math.sin(p1)
      : Math.log(Math.cos(p1) / Math.cos(p2)) / Math.log(t(p2) / t(p1));
  if (!(Math.abs(n) >= MIN_CONE)) return webMercator;
  const R = EQUAL_EARTH_RADIUS;
  const rf = (R * Math.cos(p1) * t(p1) ** n) / n;
  const rho = (latitude: number) => rf / t(latitude * DEG) ** n;
  const rho0 = rho(clamp(origin));
  // The far pole's side: south for a northern cone.
  const end = n > 0 ? -90 + CONE_END : 90 - CONE_END;
  const rhoEnd = rho(end);
  const sign = Math.sign(n);
  const latitudeAt = (r: number) =>
    (2 * Math.atan((rf / r) ** (1 / n)) - Math.PI / 2) / DEG;
  return {
    name: 'lambert-conformal-conic',
    cone: { n, rf, rho0, rhoEnd },
    forward(longitude, latitude) {
      const lat = n > 0 ? Math.max(latitude, end) : Math.min(latitude, end);
      const r = rho(lat);
      const theta = n * longitude * DEG;
      return [r * Math.sin(theta), rho0 - r * Math.cos(theta)];
    },
    inverse(x, y) {
      const dy = rho0 - y;
      let r = sign * Math.hypot(x, dy);
      let theta = Math.atan2(sign * x, sign * dy);
      const wedge = Math.abs(n) * Math.PI;
      theta = Math.max(Math.min(theta, wedge), -wedge);
      // Past the far end: on it.
      if (Math.abs(r) > Math.abs(rhoEnd)) r = rhoEnd;
      const latitude = Math.abs(r) < 1e-9 ? sign * 90 : latitudeAt(r);
      return [theta / n / DEG, latitude];
    },
    contains(x, y) {
      const dy = rho0 - y;
      const r = Math.hypot(x, dy);
      const theta = Math.atan2(sign * x, sign * dy);
      return Math.abs(theta) <= Math.abs(n) * Math.PI && r <= Math.abs(rhoEnd);
    },
  };
}

/**
 * The standard parallels a {@link lambertConformalConic} takes for a map `extent` degrees
 * north–south about `latitude`: a sixth of it in from either edge, the usual rule, which
 * splits the scale's error evenly between the middle and the edges.
 *
 * @group Utils
 */
export function lambertParallelsFor(
  latitude: number,
  extent: number,
): [number, number] {
  const third = Math.max(extent / 3, 1);
  return [latitude - third, latitude + third];
}

// Metres along the ground between two points on a sphere of the Earth's mean radius.
function groundDistance(a: Vec2, b: Vec2): number {
  const [l1, p1] = [a[0] * DEG, a[1] * DEG];
  const [l2, p2] = [b[0] * DEG, b[1] * DEG];
  const h =
    Math.sin((p2 - p1) / 2) ** 2 +
    Math.cos(p1) * Math.cos(p2) * Math.sin((l2 - l1) / 2) ** 2;
  return 2 * EQUAL_EARTH_RADIUS * Math.asin(Math.min(Math.sqrt(h), 1));
}

/**
 * How many of `projection`'s metres a metre along the ground spans at `longitude`,
 * `latitude` (from the central meridian): the square root of how much it scales areas
 * there — for a conformal one, its scale; for an equal-area one, the same everywhere.
 * Measured over a few hundred metres.
 *
 * @group Utils
 */
export function mapProjectionScale(
  projection: MapProjection,
  longitude: number,
  latitude: number,
): number {
  // A few hundred metres each way, short of the poles.
  const lat = Math.max(Math.min(latitude, 89.9), -89.9);
  const dLat = 0.002;
  const dLon = dLat / Math.max(Math.cos(lat * DEG), 1e-3);
  const at = projection.forward(longitude, lat);
  const east = projection.forward(longitude + dLon, lat);
  const north = projection.forward(longitude, lat + dLat);
  const area = Math.abs(
    (east[0] - at[0]) * (north[1] - at[1]) -
      (east[1] - at[1]) * (north[0] - at[0]),
  );
  const ground =
    groundDistance([longitude, lat], [longitude + dLon, lat]) *
    groundDistance([longitude, lat], [longitude, lat + dLat]);
  return Math.sqrt(area / ground);
}

/**
 * A top-down map's plane in a projection about a central meridian: points of the scene
 * (its X/Z, through the frame it lies in) and of the Earth (longitude and latitude) to the
 * plane's metres — east, and SOUTH as the scene's Z, so a map view reads it as it reads the
 * scene — and back.
 *
 * @group Utils
 */
export type MapPlane = {
  projection: MapProjection;
  /** the plane's central meridian: the middle of the map, so the antimeridian is its edge */
  meridian: number;
  /** scene X/Z to the plane */
  toPlane(x: number, z: number): Vec2;
  /** the plane to scene X/Z: off the map, the nearest point it holds */
  fromPlane(u: number, v: number): Vec2;
  /** longitude (from `meridian`) and latitude at a point of the plane */
  lonLatAt(u: number, v: number): Vec2;
  /** whether a point of the plane lies on the map */
  contains(u: number, v: number): boolean;
};

/**
 * The plane of `projection` about `meridian` (degrees east), for a scene whose X/Z
 * `toLonLat` and `toXZ` convert (`geoFrameLonLat`, `geoFrameXZ`).
 *
 * @group Utils
 */
export function mapPlane(
  projection: MapProjection,
  meridian: number,
  toLonLat: (x: number, z: number) => Vec2,
  toXZ: (longitude: number, latitude: number) => Vec2,
): MapPlane {
  const wrap = (longitude: number) => {
    const d = longitude - meridian;
    return d - 360 * Math.floor((d + 180) / 360);
  };
  return {
    projection,
    meridian,
    toPlane(x, z) {
      const [longitude, latitude] = toLonLat(x, z);
      const [u, n] = projection.forward(wrap(longitude), latitude);
      return [u, -n];
    },
    fromPlane(u, v) {
      const [dLon, latitude] = projection.inverse(u, -v);
      return toXZ(dLon + meridian, latitude);
    },
    lonLatAt(u, v) {
      return projection.inverse(u, -v);
    },
    contains(u, v) {
      return projection.contains(u, -v);
    },
  };
}
