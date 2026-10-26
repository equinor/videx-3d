import proj4 from 'proj4';
import { Matrix4, Uniform, Vector2, Vector3, Vector4 } from 'three';
import {
  ConformalSphere,
  conformalLatitude,
  conformalSphere,
  geodeticLatitude,
} from './conformal-sphere';
import { wgs84Def } from './crs';
import { GeoFrame, geoFrameAt, placeGeoFrame } from './geo-frame';

/** The Earth's mean radius, in metres. */
export const EARTH_RADIUS = 6371000;

/**
 * Where a view ray meets a {@link Globe}'s surface ({@link Globe.reach}).
 *
 * @group Utils
 */
export type GlobeReach = {
  /** along the ray; on a miss, to where the ray passes closest to the globe's centre */
  distance: number;
  /** whether the ray meets the surface */
  hit: boolean;
};

/**
 * The uniforms a material binds, by reference, to draw on a {@link Globe}.
 *
 * @group Utils
 */
export type GlobeUniforms = {
  /** the scene's up */
  uGlobeUp: Uniform<Vector3>;
  /** the disc's centre on the level plane (xyz), and its radius (w) */
  uGlobeDisc: Uniform<Vector4>;
  /**
   * the globe's radius (x), how far below the disc's centre its centre lies (y), the
   * disc's radius squared (z), and 1 while on (w)
   */
  uGlobe: Uniform<Vector4>;
  /**
   * the camera drawing ({@link Globe.setCamera}): its height along up as measured over the
   * globe (`altitude` + `level`, x), `|camera − C|² − R²` (y), its height over the whole
   * sphere, `|camera − C| − R` (z)
   */
  uGlobeCamera: Uniform<Vector4>;
  /** up at the camera ({@link Globe.upAt}) */
  uGlobeCameraUp: Uniform<Vector3>;
  /**
   * away from the sphere's centre through the camera (xyz), and how far its view runs to
   * graze the sphere, `√(|camera − C|² − R²)` (w; 0 from inside it)
   */
  uGlobeCameraRadial: Uniform<Vector4>;
  /** the sine and cosine of how far the camera's horizon dips below its own level */
  uGlobeCameraDip: Uniform<Vector2>;
  /** true east at the disc's centre ({@link Globe.north}'s east) */
  uGlobeEast: Uniform<Vector3>;
  /** true north at the disc's centre ({@link Globe.north}) */
  uGlobeNorth: Uniform<Vector3>;
  /**
   * the conformal sphere at the disc's centre: the sine and cosine of its latitude there
   * (x, y), and 1 with a frame (w); see {@link Globe.sphereOffset}
   */
  uGlobeSphere: Uniform<Vector4>;
};

/** A rectangle in world X/Z: `[minX, minZ, maxX, maxZ]`. */
type Bounds = [number, number, number, number];

const v = new Vector3();
const flat = new Vector3();
const way = new Vector3();
const across = new Vector3();
// Globe.tangent's.
const pivot = new Vector3();
const placed = new Vector3();
const ahead = new Vector3();
const behind = new Vector3();
const alongX = new Vector3();
const alongZ = new Vector3();
const normal = new Vector3();
const planeX = new Vector3();
const planeZ = new Vector3();
const basis = new Matrix4();
// Half the span over which Globe.tangent measures the placement, in metres.
const TANGENT_STEP = 10;
const DEG = Math.PI / 180;
// hav θ = sin²(θ / 2) = (1 − cos θ) / 2.
const haversine = (angle: number) => {
  const half = Math.sin(angle / 2);
  return half * half;
};
// An angle in (−π, π].
const wrapAngle = (angle: number) =>
  angle - 2 * Math.PI * Math.round(angle / (2 * Math.PI));
// Globe.foot's latitude and longitude.
const under = { latitude: 0, longitude: 0 };

// The conformal sphere's longitude of one `delta` from the disc's centre's (radians): n Δλ
// near it, where the sphere is conformal, but Δλ again on the far side of the Earth, so the
// sphere closes without a seam (n Δλ would overlap itself there, by (n − 1) · 360°).
const sphereLongitude = (n: number, delta: number) =>
  delta + (n - 1) * Math.sin(delta);

// Its inverse, by Newton's method: its slope is within (n − 1) of 1.
const mapLongitude = (n: number, lambda: number) => {
  let delta = lambda / n;
  for (let i = 0; i < 6; i++)
    delta -=
      (sphereLongitude(n, delta) - lambda) / (1 + (n - 1) * Math.cos(delta));
  return delta;
};

/**
 * The Earth as the scene draws it: a sphere fixed in the scene whose cap over a disc is
 * cut flat by the sea's level plane, its centre just far enough below for the plane to
 * meet the sphere exactly on the disc's edge. A field on the disc lies on the plane, as
 * drawn flat; beyond it the ground is the sphere. Off, it is the level plane everywhere.
 * See `documents/world.md`, step 2.
 *
 * Given the map the scene's X/Z are in ({@link setFrame}, a `World`'s), it lies on the
 * Earth: the sphere is the WGS84 ellipsoid's Gauss conformal sphere matched at the disc's
 * centre, in the map's units there, turned to true north, and a latitude and longitude
 * have one place on it at any distance ({@link geodetic}), the far side of the Earth
 * included. Near the field it meets the map to 3 cm 5.5 km out, 11 cm 11 km out: the
 * map's own scale changing across the field (UTM's, away from its meridian). Without one,
 * the map's X/Z are carried onto the sphere from the plane, along the line from its
 * centre, which holds for a region only (world.md, step 6).
 *
 * Plain math, in 64-bit floats but written as a shader must in 32 (`globe.glsl` is its
 * twin): about the disc's centre, in forms that subtract no near-equal numbers. And the
 * uniforms that carry it, which keep up with it.
 *
 * ⚠️ The disc and {@link place} take world X/Z: they assume the default up (+Y).
 *
 * @group Utils
 */
export class Globe {
  /** bound by reference; kept up to date as the globe changes */
  readonly uniforms: GlobeUniforms;

  // The radius given, and the one drawn: the given, or the Earth's in the map's units.
  private readonly givenRadius: number;
  private R: number;
  private on = true;
  private seaLevel = 0;
  private readonly sceneUp = new Vector3(0, 1, 0);
  private discX = 0;
  private discZ = 0;
  private discR = 0;
  // The map the scene's X/Z are in, and what is derived from it (update): its converter
  // from WGS84, the conformal sphere matched at the disc's centre, that centre's longitude
  // (radians) and conformal latitude, and true east and north there, in the world.
  private mapFrame: GeoFrame | null = null;
  private toMap: proj4.Converter | null = null;
  private sphere: ConformalSphere | null = null;
  private lambda0 = 0;
  private sinChi0 = 0;
  private cosChi0 = 1;
  private readonly trueEast = new Vector3(1, 0, 0);
  private readonly trueNorth = new Vector3(0, 0, -1);
  private located: { latitude: number; longitude: number } | null = null;
  // Derived (update): the disc's centre on the level plane, the depth of the sphere's
  // centre below it, and the sphere's centre.
  private readonly c = new Vector3();
  private s = 0;
  private readonly C = new Vector3();
  // Where the camera uniforms were last set for, and whether the globe changed since.
  private readonly cameraAt = new Vector3();
  private cameraStale = true;

  constructor(radius = EARTH_RADIUS) {
    this.givenRadius = radius;
    this.R = radius;
    this.uniforms = {
      uGlobeUp: new Uniform(new Vector3(0, 1, 0)),
      uGlobeDisc: new Uniform(new Vector4()),
      uGlobe: new Uniform(new Vector4()),
      uGlobeCamera: new Uniform(new Vector4()),
      uGlobeCameraUp: new Uniform(new Vector3(0, 1, 0)),
      uGlobeCameraRadial: new Uniform(new Vector4(0, 1, 0, 0)),
      uGlobeCameraDip: new Uniform(new Vector2(0, 1)),
      uGlobeEast: new Uniform(new Vector3(1, 0, 0)),
      uGlobeNorth: new Uniform(new Vector3(0, 0, -1)),
      uGlobeSphere: new Uniform(new Vector4(0, 1, 0, 0)),
    };
    this.update();
  }

  /**
   * the sphere's radius, in world units: the one given, or with a {@link frame} the
   * Earth's there (the conformal sphere's, in the map's units at the disc's centre)
   */
  get radius(): number {
    return this.R;
  }

  /** whether the globe curves; off, the level plane everywhere */
  get enabled(): boolean {
    return this.on;
  }
  set enabled(value: boolean) {
    this.on = value;
    this.update();
  }

  /** the sea's level: the plane's height along {@link up} */
  get level(): number {
    return this.seaLevel;
  }
  set level(value: number) {
    this.seaLevel = value;
    this.update();
  }

  /** the scene's up (normalised); read only, see {@link setUp} */
  get up(): Vector3 {
    return this.sceneUp;
  }

  /** Set the scene's up (normalised here). */
  setUp(up: Vector3) {
    this.sceneUp.copy(up).normalize();
    this.update();
  }

  /**
   * Set the disc the sea is flat over: the one holding `bounds` (world X/Z), centred on
   * its middle, its radius half its diagonal. `null`: a disc of no size at the origin, the
   * sphere touching the level plane there.
   */
  setDisc(bounds: Bounds | null) {
    if (bounds) {
      const [minX, minZ, maxX, maxZ] = bounds;
      this.discX = (minX + maxX) / 2;
      this.discZ = (minZ + maxZ) / 2;
      this.discR = Math.hypot(maxX - minX, maxZ - minZ) / 2;
    } else {
      this.discX = 0;
      this.discZ = 0;
      this.discR = 0;
    }
    this.update();
  }

  /** the disc's centre, on the level plane; read only */
  get discCentre(): Vector3 {
    return this.c;
  }

  /** the disc's radius */
  get discRadius(): number {
    return this.discR;
  }

  /** the sphere's centre; read only */
  get centre(): Vector3 {
    return this.C;
  }

  /** how far below the disc's centre the sphere's centre lies: `√(R² − r²)` */
  get centreDepth(): number {
    return this.s;
  }

  /** the map the scene's X/Z are in, or null; see {@link setFrame} */
  get frame(): GeoFrame | null {
    return this.mapFrame;
  }

  /**
   * Set the map the scene's X/Z are in — a `World`'s frame — or none. With one the globe
   * lies on the Earth (see {@link Globe}): its radius the Earth's there, {@link north} true
   * north, and {@link place}, {@link foot} and {@link tangent} go through latitude and
   * longitude, so what they place agrees with what is placed by its latitude and longitude
   * ({@link geodetic}) at any distance. The frame must be projected, in metres.
   */
  setFrame(frame: GeoFrame | null) {
    this.mapFrame = frame;
    this.toMap = frame ? proj4(wgs84Def, frame.projection) : null;
    this.update();
  }

  /** where the disc's centre lies on the Earth, in degrees; null without a {@link frame} */
  get location(): { latitude: number; longitude: number } | null {
    return this.located;
  }

  /**
   * True north at the disc's centre, level, in the world (normalised; read only): the
   * map's grid north turned by its convergence there. The scene's −Z without a
   * {@link frame}.
   */
  get north(): Vector3 {
    return this.trueNorth;
  }

  /**
   * The point `height` over the ground at `latitude` and `longitude` (WGS84, degrees): on
   * the conformal sphere, along the line from its centre; over the disc, where that line
   * meets the level plane. Off, the sphere laid flat about the disc's centre
   * (stereographically), as `globe.glsl`'s `globeGeodetic` lays it. Needs a {@link frame}.
   */
  geodetic(
    latitude: number,
    longitude: number,
    height: number,
    target: Vector3,
  ): Vector3 {
    const sphere = this.sphere;
    if (!sphere || !this.toMap)
      throw new Error('Globe.geodetic needs a frame (Globe.setFrame)');
    const up = this.sceneUp;
    const chi = conformalLatitude(sphere, latitude * DEG);
    const lambda = sphereLongitude(
      sphere.n,
      wrapAngle(longitude * DEG - this.lambda0),
    );
    // The direction from the sphere's centre, about the disc's centre's: east, north and
    // up parts, written so nothing near-equal is subtracted near it (haversines).
    const cosChi = Math.cos(chi);
    const havLambda = haversine(lambda);
    const e = cosChi * Math.sin(lambda);
    const n =
      Math.sin(chi - sphere.chi0) + 2 * cosChi * this.sinChi0 * havLambda;
    const below =
      2 * (haversine(chi - sphere.chi0) + cosChi * this.cosChi0 * havLambda);
    const u = 1 - below;
    const R = this.R;
    if (!this.on) {
      const flatten = (2 * R) / (1 + u);
      return target
        .copy(this.c)
        .addScaledVector(this.trueEast, flatten * e)
        .addScaledVector(this.trueNorth, flatten * n)
        .addScaledVector(up, height);
    }
    const s = this.s;
    // Over the disc: where the line from the centre meets the plane, `s / u` along it.
    const reach = s / u;
    const r = this.discR;
    if (u > 0 && reach * reach * (e * e + n * n) <= r * r)
      return target
        .copy(this.c)
        .addScaledVector(this.trueEast, reach * e)
        .addScaledVector(this.trueNorth, reach * n)
        .addScaledVector(up, height);
    // The sphere: R (e, n, u − 1) + (R − s) up about the disc's centre, then up there.
    const lift = (r * r) / (R + s) - R * below;
    return target
      .copy(this.c)
      .addScaledVector(this.trueEast, (R + height) * e)
      .addScaledVector(this.trueNorth, (R + height) * n)
      .addScaledVector(up, lift + height * u);
  }

  /**
   * Where `latitude` and `longitude` (WGS84, degrees) lie on the conformal sphere, from
   * the disc's centre: its latitude there less the centre's (x), and its longitude from
   * the centre's (y), in radians — what `globe.glsl`'s `globeGeodetic` places from, small
   * near the field, so 32-bit floats hold it to a millimetre. Needs a {@link frame}.
   */
  sphereOffset(latitude: number, longitude: number, target: Vector2): Vector2 {
    const sphere = this.sphere;
    if (!sphere)
      throw new Error('Globe.sphereOffset needs a frame (Globe.setFrame)');
    return target.set(
      conformalLatitude(sphere, latitude * DEG) - sphere.chi0,
      sphereLongitude(sphere.n, wrapAngle(longitude * DEG - this.lambda0)),
    );
  }

  /**
   * The latitude and longitude (WGS84, degrees) of the ground under `point`: the inverse
   * of {@link geodetic}, its height left out. Needs a {@link frame}.
   */
  geographic(
    point: Vector3,
    target = { latitude: 0, longitude: 0 },
  ): { latitude: number; longitude: number } {
    const sphere = this.sphere;
    if (!sphere || !this.toMap)
      throw new Error('Globe.geographic needs a frame (Globe.setFrame)');
    const up = this.sceneUp;
    v.subVectors(point, this.c);
    const h = v.dot(up);
    flat.copy(v).addScaledVector(up, -h);
    const onDisc = flat.lengthSq() <= this.discR * this.discR;
    // Its direction from the sphere's centre; over the disc, its foot's; off, where the
    // sphere laid flat has it (geodetic).
    const R = this.R;
    let e = flat.dot(this.trueEast);
    let n = flat.dot(this.trueNorth);
    let u = this.s + (onDisc ? 0 : h);
    if (!this.on) {
      const t2 = flat.lengthSq() / (4 * R * R);
      e /= R;
      n /= R;
      u = 1 - t2;
    }
    const length = Math.hypot(e, n, u);
    const chi = Math.asin(
      Math.max(-1, Math.min(1, (n * this.cosChi0 + u * this.sinChi0) / length)),
    );
    const lambda = Math.atan2(e, u * this.cosChi0 - n * this.sinChi0);
    target.latitude = geodeticLatitude(sphere, chi) / DEG;
    target.longitude =
      wrapAngle(this.lambda0 + mapLongitude(sphere.n, lambda)) / DEG;
    return target;
  }

  /**
   * Height of `point` over the surface: over the level plane above the disc, over the
   * sphere beyond.
   */
  altitude(point: Vector3): number {
    const up = this.sceneUp;
    v.subVectors(point, this.c);
    const h = v.dot(up);
    if (!this.on) return h;
    const r2 = this.discR * this.discR;
    const d2 = flat.copy(v).addScaledVector(up, -h).lengthSq();
    if (d2 <= r2) return h;
    const s = this.s;
    // (|p − C|² − R²) / (|p − C| + R), the numerator about the disc's centre.
    const fromCentre = Math.sqrt(d2 + (h + s) * (h + s));
    return (d2 - r2 + h * (h + 2 * s)) / (fromCentre + this.radius);
  }

  /** Up at `point`: the scene's above the disc, away from the sphere's centre beyond. */
  upAt(point: Vector3, target: Vector3): Vector3 {
    const up = this.sceneUp;
    v.subVectors(point, this.c);
    const h = v.dot(up);
    const d2 = flat.copy(v).addScaledVector(up, -h).lengthSq();
    if (!this.on || d2 <= this.discR * this.discR) return target.copy(up);
    return target.copy(v).addScaledVector(up, this.s).normalize();
  }

  /**
   * The point `height` over the ground at world X/Z (`x`, `z`): over the disc, the level
   * plane's; beyond, with a {@link frame}, the map's point where its latitude and longitude
   * lie ({@link geodetic}); without, the plane's point carried along the line from the
   * sphere's centre onto the sphere. Then `height` along up there.
   */
  place(x: number, z: number, height: number, target: Vector3): Vector3 {
    const up = this.sceneUp;
    this.onPlane(x, z, target);
    const r2 = this.discR * this.discR;
    // On the level plane, as the disc's centre is: no part along up.
    v.subVectors(target, this.c);
    const d2 = v.lengthSq();
    if (!this.on || d2 <= r2) return target.addScaledVector(up, height);
    if (this.toMap) {
      const [longitude, latitude] = this.toMap.inverse(this.mapEN(x, z));
      return this.geodetic(latitude, longitude, height, target);
    }
    const s = this.s;
    const q = Math.sqrt(d2 + s * s);
    // (R + height) / q − 1, with R − q written as (r² − d²) / (R + q).
    const k = (height + (r2 - d2) / (this.R + q)) / q;
    return target
      .copy(this.c)
      .addScaledVector(v, 1 + k)
      .addScaledVector(up, s * k);
  }

  /**
   * The map point under `point`, on the level plane, which {@link place} carries back:
   * under the disc, straight down; beyond, with a {@link frame}, the map's point at the
   * latitude and longitude under it ({@link geographic}); without, where the line from the
   * sphere's centre through it meets the plane.
   */
  foot(point: Vector3, target: Vector3): Vector3 {
    const up = this.sceneUp;
    v.subVectors(point, this.c);
    const h = v.dot(up);
    flat.copy(v).addScaledVector(up, -h);
    const onDisc = !this.on || flat.lengthSq() <= this.discR * this.discR;
    if (!onDisc && this.toMap) {
      const { latitude, longitude } = this.geographic(point, under);
      const [x, z] = this.mapXZ(longitude, latitude);
      return this.onPlane(x, z, target);
    }
    return target
      .copy(this.c)
      .addScaledVector(flat, onDisc ? 1 : this.s / (h + this.s));
  }

  /**
   * How the globe places what lies about world X/Z (`x`, `z`), to first order: the matrix
   * that takes the level plane there, and heights over it, to where {@link place} puts them
   * — turned to the globe's up there, and squeezed as the ground around it is, by about
   * `(d / R)²` toward the disc's centre and half that across (0.2% at 300 km out). Content
   * drawn flat and placed by it meets what is placed point by point (a relief, a route)
   * to under a metre 10 km around, 300 km out, and stands upright there. The identity over
   * the disc, or with the globe off.
   */
  tangent(x: number, z: number, target: Matrix4): Matrix4 {
    const up = this.sceneUp;
    // The plane's point at x, z, as place takes it.
    pivot
      .set(x, 0, z)
      .addScaledVector(up, this.seaLevel - (x * up.x + z * up.z));
    v.subVectors(pivot, this.c);
    if (!this.on || v.lengthSq() <= this.discR * this.discR)
      return target.identity();
    const step = TANGENT_STEP;
    this.place(x, z, 0, placed);
    this.place(x + step, z, 0, ahead);
    this.place(x - step, z, 0, behind);
    alongX.subVectors(ahead, behind).divideScalar(2 * step);
    this.place(x, z + step, 0, ahead);
    this.place(x, z - step, 0, behind);
    alongZ.subVectors(ahead, behind).divideScalar(2 * step);
    this.upAt(placed, normal);
    // The plane's own steps along X and Z, and up, go to those: M = [X Z up]' · [X Z up]⁻¹.
    planeX.set(1, 0, 0).addScaledVector(up, -up.x);
    planeZ.set(0, 0, 1).addScaledVector(up, -up.z);
    basis.makeBasis(planeX, up, planeZ).invert();
    target.makeBasis(alongX, normal, alongZ).multiply(basis);
    // And the plane's point to where it is placed.
    return target.setPosition(placed.sub(pivot.applyMatrix4(target)));
  }

  /**
   * Where a view from `origin` along `dir` meets the surface `below` lower (a seabed:
   * the plane `below` down over the disc, the sphere of radius `R − below` beyond). From
   * above it only: from on or under it, no hit at distance 0. A miss reports where the
   * ray passes closest to the sphere's centre, ahead of `origin`.
   */
  reach(
    origin: Vector3,
    dir: Vector3,
    below = 0,
    target: GlobeReach = { distance: 0, hit: false },
  ): GlobeReach {
    const up = this.sceneUp;
    way.copy(dir).normalize();
    v.subVectors(origin, this.c);
    // Height over the lowered plane, and how fast the ray falls toward it.
    const h = v.dot(up) + below;
    const fall = -way.dot(up);
    const reached = (distance: number, hit: boolean) => {
      target.distance = distance;
      target.hit = hit;
      return target;
    };

    if (!this.on)
      return h > 0 && fall > 0 ? reached(h / fall, true) : reached(0, false);

    const R = this.radius;
    const s = this.s;
    const r2 = this.discR * this.discR;
    // Where the lowered plane meets the lowered sphere, squared: a hair inside the disc.
    const rho2 = r2 - (2 * below * r2) / (R + s);
    // How far from the disc's axis the ray is `t` along, squared.
    const offAxis = (t: number) => {
      across.copy(v).addScaledVector(way, t);
      return across.addScaledVector(up, -across.dot(up)).lengthSq();
    };

    // Over the disc: the plane, met first wherever it is met inside it.
    if (h > 0 && fall > 0 && offAxis(h / fall) <= rho2)
      return reached(h / fall, true);

    // Beyond: the sphere, |origin − C|² − (R − below)² about the disc's centre.
    const b = v.dot(way) + s * way.dot(up);
    const outside =
      v.lengthSq() + 2 * s * v.dot(up) - r2 + below * (2 * R - below);
    const closest = Math.max(-b, 0);
    // Inside the sphere, over the plane, is inside the cut-off cap: what leaves it but by
    // the plane meets nothing.
    if (outside <= 0) return reached(h > 0 ? closest : 0, false);
    const disc = b * b - outside;
    if (b >= 0 || disc < 0) return reached(closest, false);
    // The nearer root, as `outside / (−b + √disc)` so nothing near-equal is subtracted.
    const t = outside / (-b + Math.sqrt(disc));
    // Into the cut-off cap: the ray leaves the sphere again above the plane.
    if (h - fall * t > 0 && offAxis(t) <= rho2) return reached(closest, false);
    return reached(t, true);
  }

  /**
   * Set the camera uniforms (`uGlobeCamera…`) for a camera at `position` (world): what the
   * shaders would otherwise work out per pixel from `cameraPosition` — its height, its up,
   * and its horizon — once, in 64-bit floats. Call it for each camera that draws with them,
   * before it draws (an object's `onBeforeRender`); a call for the same place and globe
   * returns at once.
   */
  setCamera(position: Vector3) {
    if (!this.cameraStale && position.equals(this.cameraAt)) return;
    this.cameraAt.copy(position);
    this.cameraStale = false;
    const {
      uGlobeCamera,
      uGlobeCameraUp,
      uGlobeCameraRadial,
      uGlobeCameraDip,
    } = this.uniforms;
    const up = this.sceneUp;
    const R = this.radius;
    const s = this.s;
    v.subVectors(position, this.c);
    const h = v.dot(up);
    // |camera − C|² − R², about the disc's centre.
    const outside = v.lengthSq() + 2 * s * h - this.discR * this.discR;
    const fromCentre = Math.sqrt(Math.max(R * R + outside, 0));
    const reach = Math.sqrt(Math.max(outside, 0));
    const radial = way.copy(v).addScaledVector(up, s).normalize();
    uGlobeCameraRadial.value.set(radial.x, radial.y, radial.z, reach);
    const sinDip = fromCentre > 0 ? reach / fromCentre : 0;
    uGlobeCameraDip.value.set(
      sinDip,
      Math.sqrt(Math.max(1 - sinDip * sinDip, 0)),
    );
    uGlobeCamera.value.set(
      this.altitude(position) + this.seaLevel,
      outside,
      outside / (fromCentre + R),
      0,
    );
    this.upAt(position, uGlobeCameraUp.value);
  }

  // Where the frame has the disc's centre on the Earth, and the sphere matched there: its
  // radius in the map's units, and true east and north. Without a frame, as given.
  private locate() {
    const frame = this.mapFrame;
    const toMap = this.toMap;
    if (!frame || !toMap) {
      this.sphere = null;
      this.located = null;
      this.R = this.givenRadius;
      this.trueEast.set(1, 0, 0);
      this.trueNorth.set(0, 0, -1);
      return;
    }
    const [longitude, latitude] = toMap.inverse(
      this.mapEN(this.discX, this.discZ),
    );
    this.located = { latitude, longitude };
    const sphere = conformalSphere(latitude * DEG);
    this.sphere = sphere;
    this.lambda0 = longitude * DEG;
    this.sinChi0 = Math.sin(sphere.chi0);
    this.cosChi0 = Math.cos(sphere.chi0);
    // The map against the Earth there: its metres per the ellipsoid's, and how far its
    // grid is turned from true north (a transverse Mercator map about the point is the
    // ellipsoid's own, true north up, at scale 1).
    const { rotation, scale } = placeGeoFrame(geoFrameAt(longitude, latitude), {
      projection: frame.projection,
      origin: frame.origin,
    });
    this.R = sphere.radius * scale;
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    // Turned about +Y by `rotation`: the true frame's +X and −Z.
    this.trueEast.set(cos, 0, -sin);
    this.trueNorth.set(-sin, 0, -cos);
  }

  // The map's easting and northing at world X/Z.
  private mapEN(x: number, z: number): [number, number] {
    const frame = this.mapFrame!;
    const [ox, oz] = frame.offset ?? [0, 0];
    return [frame.origin[0] + (x - ox), frame.origin[1] - (z - oz)];
  }

  // World X/Z of a longitude and latitude, through the map.
  private mapXZ(longitude: number, latitude: number): [number, number] {
    const frame = this.mapFrame!;
    const [ox, oz] = frame.offset ?? [0, 0];
    const [e, n] = this.toMap!.forward([longitude, latitude]);
    return [e - frame.origin[0] + ox, frame.origin[1] - n + oz];
  }

  // The level plane's point at world X/Z.
  private onPlane(x: number, z: number, target: Vector3): Vector3 {
    const up = this.sceneUp;
    return target
      .set(x, 0, z)
      .addScaledVector(up, this.seaLevel - (x * up.x + z * up.z));
  }

  private update() {
    this.cameraStale = true;
    const up = this.sceneUp;
    this.c
      .set(this.discX, 0, this.discZ)
      .addScaledVector(
        up,
        this.seaLevel - (this.discX * up.x + this.discZ * up.z),
      );
    this.locate();
    const R = this.R;
    const r = Math.min(this.discR, R);
    this.s = Math.sqrt((R - r) * (R + r));
    this.C.copy(this.c).addScaledVector(up, -this.s);
    const {
      uGlobeUp,
      uGlobeDisc,
      uGlobe,
      uGlobeEast,
      uGlobeNorth,
      uGlobeSphere,
    } = this.uniforms;
    uGlobeUp.value.copy(up);
    uGlobeDisc.value.set(this.c.x, this.c.y, this.c.z, this.discR);
    uGlobe.value.set(R, this.s, this.discR * this.discR, this.on ? 1 : 0);
    uGlobeEast.value.copy(this.trueEast);
    uGlobeNorth.value.copy(this.trueNorth);
    uGlobeSphere.value.set(
      this.sinChi0,
      this.cosChi0,
      this.sphere?.n ?? 1,
      this.sphere ? 1 : 0,
    );
  }
}
