import {
  lambertConformalConic,
  lambertParallelsFor,
  MAP_PROJECTIONS,
  mapPlane,
  mapProjectionScale,
  type MapProjection,
} from '../../../sdk/projection/map-projections';
import {
  mapViewMetresPerPixel,
  type MapView,
} from '../../../sdk/projection/map-view';
import type { Vec2 } from '../../../sdk/types/common';

/** What a map is drawn in now: the scene's own map, or a projection of the whole world. */
export type GeoMapKind = 'scene' | MapProjection['name'];

/**
 * What a map is drawn in: `'scene'`, a projection of the whole world, or `'auto'` — the
 * scene's map up to `globalFrom` across, the global projection past it.
 *
 * @group Components
 */
export type GeoMapProjection = GeoMapKind | 'auto';

/**
 * A map's view: what it is centred on, how much ground it shows, and how it is turned.
 *
 * @group Components
 */
export type GeoMapView = {
  /** longitude and latitude at the middle, degrees */
  center: Vec2;
  /** ground metres across the map's shorter side */
  extent: number;
  /**
   * radians clockwise from the map's north to its up: 0 north-up (the scene's grid north in
   * the scene's map, true north in a projection). Default 0
   */
  rotation?: number;
};

/** The seconds a change of projection cross-fades over. */
export const GEO_MAP_PROJECTION_FADE = 0.3;
// With 'auto', back to the scene's map only once this far under `globalFrom`: no flicker
// while the extent hovers about it.
const GLOBAL_HYSTERESIS = 0.8;
// Ground metres a degree of latitude spans, on a sphere of the Earth's mean radius.
export const METRES_PER_DEGREE = (6371008.8 * Math.PI) / 180;
// A pixel's fraction the view may drift by before it is drawn again.
const MOVE_PIXELS = 0.25;

/** How a map's view is placed on the Earth: what {@link geoMapView} needs. */
export type GeoMapViewInput = {
  /** longitude and latitude at the middle */
  lonLat: Vec2;
  /** ground metres across the shorter side */
  extent: number;
  /** pixels */
  size: Vec2;
  /** radians clockwise from north to up */
  rotation: number;
  /** a direction in scene X/Z to point up instead (a camera's heading), or null */
  upScene: Vec2 | null;
  kind: GeoMapKind;
  toLonLat: (x: number, z: number) => Vec2;
  toXZ: (longitude: number, latitude: number) => Vec2;
  /** a Lambert conformal conic's standard parallels, degrees; null to follow the view */
  lambertParallels: [number, number] | null;
};

/**
 * The view a map draws: about `lonLat`, in the scene's map (its X/Z) or in a projection's
 * plane about the meridian there, so the antimeridian lies at the map's edge; up its north
 * turned by `rotation`, or the scene's direction `upScene` carried into it.
 */
export function geoMapView({
  lonLat,
  extent,
  size,
  rotation,
  upScene,
  kind,
  toLonLat,
  toXZ,
  lambertParallels,
}: GeoMapViewInput): MapView {
  const [longitude, latitude] = lonLat;
  const metresPerPixel = mapViewMetresPerPixel(extent, size);
  const center = toXZ(longitude, latitude);
  // North turned clockwise: X east, Z south.
  const turned: Vec2 = [Math.sin(rotation), -Math.cos(rotation)];
  if (kind === 'scene')
    return {
      center,
      up: upScene ?? turned,
      metresPerPixel,
      size,
      lonLat: [longitude, latitude],
    };
  // A cone about the middle's parallel, its standard parallels following the map's
  // extent north–south unless fixed.
  const projection =
    kind === 'lambert-conformal-conic'
      ? lambertConformalConic(
          lambertParallels ??
            lambertParallelsFor(
              latitude,
              (Math.max(size[0], size[1]) * metresPerPixel) / METRES_PER_DEGREE,
            ),
          latitude,
        )
      : MAP_PROJECTIONS[kind];
  const plane = mapPlane(projection, longitude, toLonLat, toXZ);
  const middle = plane.fromLonLat(longitude, latitude);
  let up = turned;
  if (upScene) {
    // The scene's direction carried across: a short step along it, into the plane.
    const step = metresPerPixel * 8;
    const [ax, az] = plane.toPlane(
      center[0] + upScene[0] * step,
      center[1] + upScene[1] * step,
    );
    const length = Math.hypot(ax - middle[0], az - middle[1]);
    if (length > 0) up = [(ax - middle[0]) / length, (az - middle[1]) / length];
  }
  return {
    center,
    up,
    metresPerPixel,
    size,
    lonLat: [longitude, latitude],
    projected: {
      plane,
      center: middle,
      scale: mapProjectionScale(projection, 0, latitude),
    },
  };
}

/**
 * What a map is drawn in at `extent` metres across: fixed, or with `'auto'` the global
 * projection from `globalFrom` on, and back to the scene's map only once well under it
 * (`was`, what it is drawn in now, gives the way it is going).
 */
export function geoMapKindFor(
  projection: GeoMapProjection,
  extent: number,
  globalProjection: MapProjection['name'],
  globalFrom: number,
  was: GeoMapKind | null,
): GeoMapKind {
  if (projection !== 'auto') return projection;
  const from =
    was === globalProjection ? globalFrom * GLOBAL_HYSTERESIS : globalFrom;
  return extent >= from ? globalProjection : 'scene';
}

/**
 * Whether a map moved enough between `last` and `view` to draw it again: a quarter pixel of
 * travel, a pixel's worth of turn at its edge, a thousandth of its scale, a new size, or
 * another projection.
 */
export function geoMapViewMoved(last: MapView | null, view: MapView): boolean {
  if (!last) return true;
  if (
    last.size[0] !== view.size[0] ||
    last.size[1] !== view.size[1] ||
    Math.abs(view.metresPerPixel / last.metresPerPixel - 1) > 1e-3 ||
    last.projected?.plane.projection.name !==
      view.projected?.plane.projection.name
  )
    return true;
  const step = view.metresPerPixel * (view.projected?.scale ?? 1);
  const [ax, az] = last.projected?.center ?? last.center;
  const [bx, bz] = view.projected?.center ?? view.center;
  // In a projection the plane moves with the middle's meridian: compare longitudes too.
  if (view.lonLat && last.lonLat) {
    let dLon = view.lonLat[0] - last.lonLat[0];
    dLon -= 360 * Math.round(dLon / 360);
    const dLat = view.lonLat[1] - last.lonLat[1];
    const metres =
      Math.hypot(dLon * Math.cos((view.lonLat[1] * Math.PI) / 180), dLat) *
      METRES_PER_DEGREE;
    if (metres > MOVE_PIXELS * view.metresPerPixel) return true;
  } else if (Math.hypot(bx - ax, bz - az) > MOVE_PIXELS * step) return true;
  const turn = Math.hypot(view.up[0] - last.up[0], view.up[1] - last.up[1]);
  return turn > 1 / Math.max(view.size[0], view.size[1]);
}

/**
 * How far north a map's up is turned on screen, radians clockwise: what its compass turns by.
 */
export function geoMapNorthAngle(view: MapView): number {
  return Math.atan2(-view.up[0], -view.up[1]);
}

/**
 * The heading on `view` of a camera at `at` (scene X/Z) looking along `forward` (a unit vector
 * in scene X/Z), radians clockwise from the map's up: its own direction carried into the
 * projection's plane where it is drawn in one.
 */
export function geoMapHeading(view: MapView, at: Vec2, forward: Vec2): number {
  let [wx, wz] = forward;
  const projected = view.projected;
  if (projected) {
    const step = view.metresPerPixel * 8;
    const [ax, az] = projected.plane.toPlane(at[0], at[1]);
    const [bx, bz] = projected.plane.toPlane(
      at[0] + forward[0] * step,
      at[1] + forward[1] * step,
    );
    const length = Math.hypot(bx - ax, bz - az);
    if (length > 0 && Number.isFinite(length)) {
      wx = (bx - ax) / length;
      wz = (bz - az) / length;
    }
  }
  const [ux, uz] = view.up;
  return Math.atan2(-wx * uz + wz * ux, wx * ux + wz * uz);
}

/** `lonLat` moved by `[dLon, dLat]` degrees, its longitude wrapped to ±180 and its latitude held to the poles. */
export function offsetLonLat(lonLat: Vec2, offset: Vec2): Vec2 {
  let longitude = lonLat[0] + offset[0];
  longitude -= 360 * Math.floor((longitude + 180) / 360);
  return [longitude, Math.max(Math.min(lonLat[1] + offset[1], 90), -90)];
}

/** The way from `a` to `b` in degrees, the longitude the short way round. */
export function lonLatDelta(a: Vec2, b: Vec2): Vec2 {
  let dLon = b[0] - a[0];
  dLon -= 360 * Math.round(dLon / 360);
  return [dLon, b[1] - a[1]];
}
