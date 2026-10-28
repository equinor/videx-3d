import proj4 from 'proj4';
import type { Vec2 } from '../types/common';
import { CRS, wgs84Def } from './crs';

// ⚠️ Free of three.js: generators read frames in workers.

/**
 * Where a flat frame lies on the Earth: the projection it is drawn in, and the point in
 * it that lies at the frame's `offset` (its X/Z). X runs east, along the projection's grid,
 * and Z south. Plain data, so a worker can read it. A `World` is given the scene's; a
 * `UtmArea` and a stage's relief take theirs from it, or their own.
 *
 * See `documents/world.md`.
 *
 * @group Utils
 */
export type GeoFrame = {
  /** a proj4 definition, or a name proj4 knows; a projected one, in metres */
  projection: string;
  /** the map coordinates of the point at `offset` */
  origin: Vec2;
  /** X/Z of `origin` in the frame. Default `[0, 0]` */
  offset?: Vec2;
};

/**
 * A {@link GeoFrame} about `longitude`, `latitude` (WGS84, degrees): a transverse Mercator
 * map about the point, in metres.
 *
 * @group Utils
 */
export function geoFrameAt(longitude: number, latitude: number): GeoFrame {
  return {
    projection: `+proj=tmerc +lat_0=${latitude} +lon_0=${longitude} +k=1 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs`,
    origin: [0, 0],
  };
}

/**
 * The {@link GeoFrame} of a scene placed by `crs`, as a `UtmArea` given that CRS places
 * it: the CRS's projection, its origin at `offset` (X/Z; a `UtmArea`'s `offset` X and Z,
 * default `[0, 0]`).
 *
 * @group Utils
 */
export function geoFrameFromCrs(crs: CRS, offset?: Vec2): GeoFrame {
  return {
    projection: crs.utmDef,
    origin: [crs.originUtm[0], crs.originUtm[1]],
    ...(offset && { offset }),
  };
}

/**
 * The {@link CRS} that converts to and from `frame`'s map, about its origin (`offset` aside).
 *
 * @group Utils
 */
export function crsFromGeoFrame(frame: GeoFrame): CRS {
  return new CRS(frame.projection, [frame.origin[0], frame.origin[1]], 'utm');
}

/**
 * Where on the Earth `frame`'s origin lies, in degrees north and east (WGS84). The `Scenery`
 * takes its observer's place from the `World`'s frame this way; spread it into an
 * `observer` with a date to give it yourself: `{ date, ...geoFrameLocation(frame) }`.
 *
 * @group Utils
 */
export function geoFrameLocation(frame: GeoFrame): {
  latitude: number;
  longitude: number;
} {
  const [longitude, latitude] = proj4(frame.projection, wgs84Def, [
    frame.origin[0],
    frame.origin[1],
  ]);
  return { latitude, longitude };
}

/**
 * A converter from `frame`'s scene X/Z to longitude and latitude (WGS84, degrees): the
 * reverse of how a `World` places a point. X runs east and Z south of the frame's origin
 * (`offset` aside). Made once, as proj4 builds its transform: call the result per point.
 *
 * @group Utils
 */
export function geoFrameLonLat(
  frame: GeoFrame,
): (x: number, z: number) => Vec2 {
  const convert = proj4(frame.projection, wgs84Def);
  const [e0, n0] = frame.origin;
  const [offsetX, offsetZ] = frame.offset ?? [0, 0];
  return (x, z) => {
    const [lon, lat] = convert.forward([e0 + x - offsetX, n0 - (z - offsetZ)]);
    return [lon, lat];
  };
}

/**
 * A converter from longitude and latitude (WGS84, degrees) to `frame`'s scene X/Z: how a
 * `World` places a point, flat, the reverse of {@link geoFrameLonLat}. Made once, as
 * proj4 builds its transform: call the result per point.
 *
 * @group Utils
 */
export function geoFrameXZ(
  frame: GeoFrame,
): (longitude: number, latitude: number) => Vec2 {
  const convert = proj4(wgs84Def, frame.projection);
  const [e0, n0] = frame.origin;
  const [offsetX, offsetZ] = frame.offset ?? [0, 0];
  return (longitude, latitude) => {
    const [e, n] = convert.forward([longitude, latitude]);
    return [e - e0 + offsetX, n0 - n + offsetZ];
  };
}

/**
 * Whether `a` and `b` are the same map about the same point: the same projection and
 * origin. Their offsets are not compared.
 *
 * @group Utils
 */
export function geoFrameSameMap(a: GeoFrame, b: GeoFrame): boolean {
  return (
    a.projection === b.projection &&
    a.origin[0] === b.origin[0] &&
    a.origin[1] === b.origin[1]
  );
}

/**
 * Where a frame lies in another, flat: its origin's X/Z there, and how its grid is turned
 * and scaled about that point (see {@link placeGeoFrame}).
 *
 * @group Utils
 */
export type GeoFramePlacement = {
  /** X of the frame's origin in the other frame */
  x: number;
  /** Z of the frame's origin in the other frame */
  z: number;
  /**
   * how far the frame's grid is turned from the other's there, in radians, counter-clockwise
   * seen from above: a rotation about +Y by this angle takes the frame's X/Z to the other's
   */
  rotation: number;
  /** the other frame's metres per the frame's metre there, along the ground */
  scale: number;
};

// Half the span over which placeGeoFrame measures the grid's turn and scale, in metres.
const PLACEMENT_STEP = 100;

/**
 * Where `frame` lies in `scene` (its X/Z), flat: its origin converted through proj4, and
 * the turn and the scale between the two maps' grids there, measured with proj4 too. So a
 * field drawn in its own frame, placed by them (rotated about +Y, then scaled along X and
 * Z, then moved), lands where `scene`'s map has it: in the next UTM zone 120 km off, to
 * about 10 cm 5 km around its origin (40 cm at 10 km; the scale alone is 0.1% there). One
 * map about another origin is only moved, exactly. Heights are not scaled. Both
 * projections must be conformal (as UTM and transverse Mercator are) and in metres.
 * `frame`'s own `offset` is not used: the placement is of its origin.
 *
 * @group Utils
 */
export function placeGeoFrame(
  frame: GeoFrame,
  scene: GeoFrame,
): GeoFramePlacement {
  const [e0, n0] = frame.origin;
  const [sceneX, sceneZ] = scene.offset ?? [0, 0];
  // One map: moved only, exactly (proj4's round trip through a datum is not, by a millimetre).
  if (frame.projection === scene.projection) {
    return {
      x: e0 - scene.origin[0] + sceneX,
      z: scene.origin[1] - n0 + sceneZ,
      rotation: 0,
      scale: 1,
    };
  }
  const convert = proj4(frame.projection, scene.projection);
  const at = convert.forward([e0, n0]);
  const step = PLACEMENT_STEP;
  const e1 = convert.forward([e0 + step, n0]);
  const e2 = convert.forward([e0 - step, n0]);
  const n1 = convert.forward([e0, n0 + step]);
  const n2 = convert.forward([e0, n0 - step]);
  // The frame's east and north in the scene's map, per metre: for a conformal pair, a
  // turn and a scale, east (c, s) and north (−s, c) times it.
  const ee = (e1[0] - e2[0]) / (2 * step);
  const en = (e1[1] - e2[1]) / (2 * step);
  const ne = (n1[0] - n2[0]) / (2 * step);
  const nn = (n1[1] - n2[1]) / (2 * step);
  return {
    x: at[0] - scene.origin[0] + sceneX,
    z: scene.origin[1] - at[1] + sceneZ,
    rotation: Math.atan2(en - ne, ee + nn),
    scale: Math.sqrt(Math.abs(ee * nn - en * ne)),
  };
}
