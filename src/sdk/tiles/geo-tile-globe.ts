import { Box3, Frustum, Vector2, Vector3 } from 'three';
import type { Globe } from '../projection/globe';
import { GEO_TILE_ROOTS, geoTileRegion } from './geo-tile-keys';
import type { QuadtreeLayout } from './quadtree';

// Geographic tiles (`geo-tile-keys`) on a globe with a frame (`Globe.setFrame`): their
// squares in the coordinates the quadtree, its finer regions and its pins take — longitude
// east and latitude south, in degrees — where they lie in the world, and how they are
// drawn. Shared by the relief's tiles and the overlays' (`GeoPolygons`).

const DEG = Math.PI / 180;

/**
 * A geographic tile's square: west longitude, minus its north latitude, and its span.
 *
 * @group Tiles
 */
export function geoTileSquare(key: number): [number, number, number] {
  const [west, north, span] = geoTileRegion(key);
  return [west, -north, span];
}

const corner = new Vector3();
const at = new Vector3();
const where = { latitude: 0, longitude: 0 };

/**
 * The square (`geoTileSquare`'s coordinates) that holds a rectangle of world X/Z on the
 * level plane: its corners' and edges' latitudes and longitudes, and a little more.
 *
 * @group Tiles
 */
export function geoSquareOver(
  globe: Globe,
  bounds: [minX: number, minZ: number, maxX: number, maxZ: number],
): [number, number, number, number] {
  const [x0, z0, x1, z1] = bounds;
  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (let j = 0; j <= 2; j++) {
    for (let i = 0; i <= 2; i++) {
      globe.place(x0 + ((x1 - x0) * i) / 2, z0 + ((z1 - z0) * j) / 2, 0, at);
      const { latitude, longitude } = globe.geographic(at, where);
      minLon = Math.min(minLon, longitude);
      maxLon = Math.max(maxLon, longitude);
      minLat = Math.min(minLat, latitude);
      maxLat = Math.max(maxLat, latitude);
    }
  }
  const padLon = (maxLon - minLon) * 0.01;
  const padLat = (maxLat - minLat) * 0.01;
  return [minLon - padLon, -maxLat - padLat, maxLon + padLon, -minLat + padLat];
}

/**
 * How far along the ground a geographic tile is across, at its middle: the mean of its two sides.
 *
 * @group Tiles
 */
export function geoTileWidth(globe: Globe, key: number): number {
  const [, north, span] = geoTileRegion(key);
  const along = span * DEG * globe.radius;
  return along * Math.sqrt(Math.max(Math.cos((north - span / 2) * DEG), 1e-3));
}

// What a tile's place on the globe gives that does not depend on the camera: its corners on
// the conformal sphere, and its bounding box between two heights. Kept per globe while it
// does not change (`Globe.version`), for at most TILE_CACHE_LIMIT tiles.
type TileGeometry = {
  chiNorth: number;
  lonWest: number;
  chiSouth: number;
  lonEast: number;
  box: Box3 | null;
  low: number;
  high: number;
};
type GlobeTileCache = {
  version: number;
  tiles: Map<number, TileGeometry>;
  // The eye's offset on the sphere, for the latitude and longitude it was found at.
  eyeLatitude: number;
  eyeLongitude: number;
  chiEye: number;
  lonEye: number;
};
const TILE_CACHE_LIMIT = 16384;
const tileCaches = new WeakMap<Globe, GlobeTileCache>();

function tileCache(globe: Globe): GlobeTileCache {
  let cache = tileCaches.get(globe);
  if (!cache || cache.version !== globe.version) {
    cache = {
      version: globe.version,
      tiles: new Map(),
      eyeLatitude: NaN,
      eyeLongitude: NaN,
      chiEye: 0,
      lonEye: 0,
    };
    tileCaches.set(globe, cache);
  }
  return cache;
}

function tileGeometry(globe: Globe, key: number): TileGeometry {
  const cache = tileCache(globe);
  let geometry = cache.tiles.get(key);
  if (geometry) return geometry;
  const [west, north, span] = geoTileRegion(key);
  const chi0 = globe.sphereLatitude;
  globe.sphereOffset(north, west, offset);
  const chiNorth = chi0 + offset.x;
  const lonWest = offset.y;
  globe.sphereOffset(north - span, west + span, offset);
  const chiSouth = chi0 + offset.x;
  let lonEast = offset.y;
  if (lonEast <= lonWest) lonEast += 2 * Math.PI;
  if (cache.tiles.size >= TILE_CACHE_LIMIT) cache.tiles.clear();
  geometry = {
    chiNorth,
    lonWest,
    chiSouth,
    lonEast,
    box: null,
    low: NaN,
    high: NaN,
  };
  cache.tiles.set(key, geometry);
  return geometry;
}

/**
 * The point of a geographic tile nearest the eye over the globe, as an offset on the
 * conformal sphere from the disc's centre (`Globe.sphereOffset`). The tile is a rectangle
 * of latitude and longitude on that sphere too, so the point is exact there: on the eye's
 * meridian where the tile spans it, else on its nearer side's, at the latitude nearest the
 * eye along it — not where the eye's latitude is, which far east or west of the tile lies
 * tens of degrees off. The tile's corners, and the eye's place, are kept while the globe
 * and the eye hold.
 *
 * @group Tiles
 */
export function geoTileNearest(
  globe: Globe,
  key: number,
  eyeAt: { latitude: number; longitude: number },
  target: Vector2,
): Vector2 {
  const chi0 = globe.sphereLatitude;
  const cache = tileCache(globe);
  if (
    cache.eyeLatitude !== eyeAt.latitude ||
    cache.eyeLongitude !== eyeAt.longitude
  ) {
    globe.sphereOffset(eyeAt.latitude, eyeAt.longitude, offset);
    cache.eyeLatitude = eyeAt.latitude;
    cache.eyeLongitude = eyeAt.longitude;
    cache.chiEye = chi0 + offset.x;
    cache.lonEye = offset.y;
  }
  const chiEye = cache.chiEye;
  const lonEye = cache.lonEye;
  const { chiNorth, lonWest, chiSouth, lonEast } = tileGeometry(globe, key);
  // East of the west side, and how far the tile spans.
  const along =
    (((lonEye - lonWest) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const width = lonEast - lonWest;
  let lon = lonEye;
  let apart = 0;
  if (along > width) {
    const pastEast = along - width;
    const toWest = 2 * Math.PI - along;
    lon = pastEast < toWest ? lonEast : lonWest;
    apart = Math.min(pastEast, toWest);
  }
  // Along a meridian `apart` from the eye's, cos χ cos χe cos Δ + sin χ sin χe is greatest
  // at one latitude; within the tile's, there or at a side.
  const a = Math.cos(chiEye) * Math.cos(apart);
  const b = Math.sin(chiEye);
  const best = Math.atan2(b, a);
  let chi = chiNorth;
  let most = -Infinity;
  for (const candidate of [
    Math.min(Math.max(best, chiSouth), chiNorth),
    chiSouth,
    chiNorth,
  ]) {
    const value = a * Math.cos(candidate) + b * Math.sin(candidate);
    if (value > most) {
      most = value;
      chi = candidate;
    }
  }
  return target.set(chi - chi0, lon);
}

/**
 * From `eye` to the nearest point of a geographic tile reaching from `low` to `high` over
 * the sea: its point nearest the eye over the globe (`geoTileNearest`), at the eye's
 * height clamped to the tile's.
 *
 * @group Tiles
 */
export function geoTileDistance(
  globe: Globe,
  key: number,
  eye: Vector3,
  eyeAt: { latitude: number; longitude: number },
  eyeHeight: number,
  low: number,
  high: number,
): number {
  const height = Math.min(Math.max(eyeHeight, low), high);
  return globe
    .sphereAt(geoTileNearest(globe, key, eyeAt, nearest), height, corner)
    .distanceTo(eye);
}

/**
 * Whether a geographic tile reaching from `low` to `high` over the sea may be seen: some of
 * it in the frustum, and its nearest point to the eye (`geoTileNearest`) not past the
 * globe's horizon from `eye`, as far as ground `high` up shows over it. Bounded by points
 * over it, more the larger it is, and padded by the sphere's bulge between them.
 *
 * @group Tiles
 */
export function geoTileInView(
  globe: Globe,
  key: number,
  frustum: Frustum,
  eye: Vector3,
  eyeAt: { latitude: number; longitude: number },
  low: number,
  high: number,
): boolean {
  const [west, north, span] = geoTileRegion(key);
  const centre = globe.centre;
  const R = globe.radius;
  toEye.subVectors(eye, centre);
  const fromCentre = toEye.length();
  if (globe.enabled && fromCentre > R) {
    // Ground `top` up is seen past the sea's horizon as far as the angle from the eye's
    // foot at which its own horizon meets the eye's: acos(R / d) + acos(R / (R + top)).
    const top = Math.max(high, 0);
    globe.sphereAt(geoTileNearest(globe, key, eyeAt, nearest), 0, corner);
    corner.sub(centre);
    const angle = corner.angleTo(toEye);
    if (
      angle >
      Math.acos(R / fromCentre) + Math.acos(R / (R + top)) + HORIZON_MARGIN
    )
      return false;
  }
  const steps = span > 20 ? 6 : span > 2 ? 3 : 1;
  // Its box between these heights, kept while they and the globe hold.
  const geometry = tileGeometry(globe, key);
  if (geometry.box && geometry.low === low && geometry.high === high)
    return frustum.intersectsBox(geometry.box);
  box.makeEmpty();
  for (let j = 0; j <= steps; j++) {
    for (let i = 0; i <= steps; i++) {
      const latitude = north - (span * j) / steps;
      const longitude = west + (span * i) / steps;
      box.expandByPoint(globe.geodetic(latitude, longitude, low, corner));
      // A flat tile (an overlay's) reaches no higher: its point there is the same one.
      if (high !== low)
        box.expandByPoint(globe.geodetic(latitude, longitude, high, corner));
    }
  }
  if (steps === 1)
    box.expandByPoint(
      globe.geodetic(north - span / 2, west + span / 2, high, corner),
    );
  // Between its points the sphere bulges out, most across a diagonal of their grid.
  const across = ((span / steps) * Math.SQRT2 * DEG) / 2;
  box.expandByScalar((R + Math.max(high, 0)) * (1 - Math.cos(across)));
  geometry.box = (geometry.box ?? new Box3()).copy(box);
  geometry.low = low;
  geometry.high = high;
  return frustum.intersectsBox(box);
}

// An angle on the sphere the horizon test leaves to spare: the disc's flat cap, and the
// ground drawn a hair off the sphere (about 600 m).
const HORIZON_MARGIN = 1e-4;
const box = new Box3();
const toEye = new Vector3();
const offset = new Vector2();
const nearest = new Vector2();

/**
 * Where a geographic tile is drawn (the relief's `reliefTile` and `reliefTileChi`, an
 * overlay's `overlayTile` and `overlayTileChi`; see `geo-tile.glsl`): its west and east
 * edges' longitude and its north edge's, middle's and south edge's latitude on the
 * conformal sphere, from the disc's centre (`Globe.sphereOffset`), into `lon` and `chi`.
 *
 * @group Tiles
 */
export function geoTileOffsets(
  globe: Globe,
  key: number,
  lon: Float32Array,
  lonAt: number,
  chi: Float32Array,
  chiAt: number,
) {
  const [west, north, span] = geoTileRegion(key);
  const mid = north - span / 2;
  globe.sphereOffset(north, west, offset);
  const chiNorth = offset.x;
  const lonWest = offset.y;
  globe.sphereOffset(mid, west + span, offset);
  const chiMid = offset.x;
  // Across the meridian opposite the field the longitude wraps: the east edge lies past π.
  let lonEast = offset.y;
  if (lonEast <= lonWest) lonEast += 2 * Math.PI;
  globe.sphereOffset(north - span, west, offset);
  lon[lonAt] = lonWest;
  lon[lonAt + 1] = lonEast;
  chi[chiAt] = chiNorth;
  chi[chiAt + 1] = chiMid;
  chi[chiAt + 2] = offset.x;
}

/**
 * Where a point of world X/Z on the level plane lies, in latitude and longitude.
 *
 * @group Tiles
 */
export function geoAt(
  globe: Globe,
  x: number,
  z: number,
  target = { latitude: 0, longitude: 0 },
) {
  globe.place(x, z, 0, at);
  return globe.geographic(at, target);
}

/**
 * Where the camera is, for choosing geographic tiles on a globe ({@link geoTileLayout}).
 *
 * @group Tiles
 */
export type GeoTileView = {
  globe: Globe;
  /** the camera's position in the world */
  eye: Vector3;
  /** where it is over the Earth (`globe.geographic`) */
  eyeAt: { latitude: number; longitude: number };
  /** its height over the globe's sea (`globe.altitude`) */
  altitude: number;
  /** the frustum, from the camera's projection and its inverse world matrix */
  frustum: Frustum;
  /** tiles wholly farther than this are left out */
  seen: number;
  /** the sea's level: the world Y heights are measured from (usually `globe.level`) */
  level: number;
};

/**
 * How geographic tiles lie on a globe, for `selectQuadtreeTiles` (`layout`): each tile's
 * square in `geoTileSquare`'s coordinates, its distance from the eye, whether it may be
 * seen, and its width. Heights given to it (`minY`, `maxY`) are the world's: `level` is
 * taken off. `view` is read on each call, so it may be updated in place between frames.
 *
 * @group Tiles
 */
export function geoTileLayout(view: GeoTileView): QuadtreeLayout {
  // Each tile's distance, once per eye and heights: the choice asks for it to test a tile
  // and again to visit it.
  const known = new Map<number, { low: number; high: number; d: number }>();
  const eyeKey = { x: NaN, y: NaN, z: NaN, version: NaN, altitude: NaN };
  const distance = (key: number, minY: number, maxY: number) => {
    const { eye, globe } = view;
    if (
      eyeKey.x !== eye.x ||
      eyeKey.y !== eye.y ||
      eyeKey.z !== eye.z ||
      eyeKey.version !== globe.version ||
      eyeKey.altitude !== view.altitude
    ) {
      known.clear();
      eyeKey.x = eye.x;
      eyeKey.y = eye.y;
      eyeKey.z = eye.z;
      eyeKey.version = globe.version;
      eyeKey.altitude = view.altitude;
    }
    const low = minY - view.level;
    const high = maxY - view.level;
    const hit = known.get(key);
    if (hit && hit.low === low && hit.high === high) return hit.d;
    const d = geoTileDistance(
      globe,
      key,
      eye,
      view.eyeAt,
      view.altitude,
      low,
      high,
    );
    known.set(key, { low, high, d });
    return d;
  };
  return {
    roots: GEO_TILE_ROOTS,
    square: geoTileSquare,
    distance,
    shows: (key, minY, maxY) =>
      distance(key, minY, maxY) <= view.seen &&
      geoTileInView(
        view.globe,
        key,
        view.frustum,
        view.eye,
        view.eyeAt,
        // A little lower, for the ground drawn a hair off the sphere.
        minY - view.level - geoTileWidth(view.globe, key) * 0.01,
        maxY - view.level,
      ),
    width: key => geoTileWidth(view.globe, key),
  };
}
