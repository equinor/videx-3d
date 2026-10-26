import { Box3, Frustum, Matrix4, Vector2, Vector3 } from 'three';
import type { Globe } from '../../sdk/projection/globe';
import { geoTileRegion } from '../../sdk/tiles/geo-tile-keys';
import type { SkyStageBounds } from './sky-stage';

// Geographic relief tiles on a globe with a frame (`Globe.setFrame`): their squares in the
// coordinates the quadtree, its finer regions and its pins take — longitude east and
// latitude south, in degrees — where they lie in the world, and how they are drawn.

const DEG = Math.PI / 180;

/** A geographic tile's square: west longitude, minus its north latitude, and its span. */
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
 */
export function geoSquareOver(
  globe: Globe,
  bounds: SkyStageBounds,
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

/** How far along the ground a geographic tile is across, at its middle: the mean of its two sides. */
export function geoTileWidth(globe: Globe, key: number): number {
  const [, north, span] = geoTileRegion(key);
  const along = span * DEG * globe.radius;
  return along * Math.sqrt(Math.max(Math.cos((north - span / 2) * DEG), 1e-3));
}

/**
 * The point of a geographic tile nearest the eye over the globe, as an offset on the
 * conformal sphere from the disc's centre (`Globe.sphereOffset`). The tile is a rectangle
 * of latitude and longitude on that sphere too, so the point is exact there: on the eye's
 * meridian where the tile spans it, else on its nearer side's, at the latitude nearest the
 * eye along it — not where the eye's latitude is, which far east or west of the tile lies
 * tens of degrees off.
 */
export function geoTileNearest(
  globe: Globe,
  key: number,
  eyeAt: { latitude: number; longitude: number },
  target: Vector2,
): Vector2 {
  const [west, north, span] = geoTileRegion(key);
  const chi0 = globe.sphereLatitude;
  globe.sphereOffset(eyeAt.latitude, eyeAt.longitude, offset);
  const chiEye = chi0 + offset.x;
  const lonEye = offset.y;
  globe.sphereOffset(north, west, offset);
  const chiNorth = chi0 + offset.x;
  const lonWest = offset.y;
  globe.sphereOffset(north - span, west + span, offset);
  const chiSouth = chi0 + offset.x;
  let lonEast = offset.y;
  if (lonEast <= lonWest) lonEast += 2 * Math.PI;
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
  box.makeEmpty();
  for (let j = 0; j <= steps; j++) {
    for (let i = 0; i <= steps; i++) {
      const latitude = north - (span * j) / steps;
      const longitude = west + (span * i) / steps;
      box.expandByPoint(globe.geodetic(latitude, longitude, low, corner));
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
 * Where a geographic tile is drawn (`reliefTile`, `reliefTileChi`): its west and east
 * edges' longitude and its north edge's, middle's and south edge's latitude on the
 * conformal sphere, from the disc's centre (`Globe.sphereOffset`), into `lon` and `chi`.
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

/** Where a point of world X/Z on the level plane lies, in latitude and longitude. */
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
 * The warp (`heightFieldWarp`) that takes world X/Z over `bounds` to `geoTileSquare`'s
 * coordinates scaled by `scale` about (`lon0`, `lat0`): the ground as the tiles draw it,
 * fitted with a quadratic about the middle by least squares over a 5 x 5 grid. What it
 * leaves is cubic, mostly a longitude's along a grid row far north: on the ground 2.4 mm
 * at the edge of an 8 km stage at 58°N, 19 mm at the edge of a 16 km one.
 */
export function geoWarp(
  globe: Globe,
  bounds: SkyStageBounds,
  lon0: number,
  lat0: number,
  scale: number,
  target: Matrix4,
): Matrix4 {
  const [x0, z0, x1, z1] = bounds;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const hx = Math.max((x1 - x0) / 2, 1);
  const hz = Math.max((z1 - z0) / 2, 1);
  // Normal equations for q = a + b dx + c dz + d dx² + e dx dz + f dz², per coordinate.
  const ata = Array.from({ length: 6 }, () => new Float64Array(6));
  const atq = [new Float64Array(6), new Float64Array(6)];
  const row = new Float64Array(6);
  const there = { latitude: 0, longitude: 0 };
  for (let j = -2; j <= 2; j++) {
    for (let i = -2; i <= 2; i++) {
      const dx = (hx * i) / 2;
      const dz = (hz * j) / 2;
      geoAt(globe, cx + dx, cz + dz, there);
      const q = [
        (((((there.longitude - lon0 + 540) % 360) + 360) % 360) - 180) * scale,
        (lat0 - there.latitude) * scale,
      ];
      row.set([1, dx, dz, dx * dx, dx * dz, dz * dz]);
      for (let a = 0; a < 6; a++) {
        for (let b = 0; b < 6; b++) ata[a][b] += row[a] * row[b];
        atq[0][a] += row[a] * q[0];
        atq[1][a] += row[a] * q[1];
      }
    }
  }
  const [u, v] = atq.map(rhs => solve6(ata, rhs));
  return target.fromArray([
    cx,
    cz,
    u[0],
    v[0],
    u[1],
    u[2],
    v[1],
    v[2],
    u[3],
    u[4],
    u[5],
    0,
    v[3],
    v[4],
    v[5],
    0,
  ]);
}

// A 6 x 6 system by Gaussian elimination with partial pivoting.
function solve6(m: Float64Array[], rhs: Float64Array): number[] {
  const a = m.map((row, i) => [...row, rhs[i]]);
  for (let c = 0; c < 6; c++) {
    let pivot = c;
    for (let r = c + 1; r < 6; r++)
      if (Math.abs(a[r][c]) > Math.abs(a[pivot][c])) pivot = r;
    [a[c], a[pivot]] = [a[pivot], a[c]];
    for (let r = c + 1; r < 6; r++) {
      const f = a[r][c] / a[c][c];
      for (let k = c; k <= 6; k++) a[r][k] -= f * a[c][k];
    }
  }
  const x = new Array<number>(6).fill(0);
  for (let r = 5; r >= 0; r--) {
    let sum = a[r][6];
    for (let k = r + 1; k < 6; k++) sum -= a[r][k] * x[k];
    x[r] = sum / a[r][r];
  }
  return x;
}
