import { Uniform, Vector3, Vector4 } from 'three';

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
};

/** A rectangle in world X/Z: `[minX, minZ, maxX, maxZ]`. */
type Bounds = [number, number, number, number];

const v = new Vector3();
const flat = new Vector3();
const way = new Vector3();
const across = new Vector3();

/**
 * The Earth as the scene draws it: a sphere fixed in the scene whose cap over a disc is
 * cut flat by the sea's level plane, its centre just far enough below for the plane to
 * meet the sphere exactly on the disc's edge. A field on the disc lies on the plane, as
 * drawn flat; beyond it the ground is the sphere. Off, it is the level plane everywhere.
 * See `documents/world.md`, step 2.
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
  /** the sphere's radius, in world units (metres) */
  readonly radius: number;
  /** bound by reference; kept up to date as the globe changes */
  readonly uniforms: GlobeUniforms;

  private on = true;
  private seaLevel = 0;
  private readonly sceneUp = new Vector3(0, 1, 0);
  private discX = 0;
  private discZ = 0;
  private discR = 0;
  // Derived (update): the disc's centre on the level plane, the depth of the sphere's
  // centre below it, and the sphere's centre.
  private readonly c = new Vector3();
  private s = 0;
  private readonly C = new Vector3();

  constructor(radius = EARTH_RADIUS) {
    this.radius = radius;
    this.uniforms = {
      uGlobeUp: new Uniform(new Vector3(0, 1, 0)),
      uGlobeDisc: new Uniform(new Vector4()),
      uGlobe: new Uniform(new Vector4()),
    };
    this.update();
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
   * plane's; beyond, the plane's point carried along the line from the sphere's centre
   * onto the sphere, and `height` along up there.
   */
  place(x: number, z: number, height: number, target: Vector3): Vector3 {
    const up = this.sceneUp;
    target
      .set(x, 0, z)
      .addScaledVector(up, this.seaLevel - (x * up.x + z * up.z));
    const r2 = this.discR * this.discR;
    // On the level plane, as the disc's centre is: no part along up.
    v.subVectors(target, this.c);
    const d2 = v.lengthSq();
    if (!this.on || d2 <= r2) return target.addScaledVector(up, height);
    const s = this.s;
    const q = Math.sqrt(d2 + s * s);
    // (R + height) / q − 1, with R − q written as (r² − d²) / (R + q).
    const k = (height + (r2 - d2) / (this.radius + q)) / q;
    return target
      .copy(this.c)
      .addScaledVector(v, 1 + k)
      .addScaledVector(up, s * k);
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

  private update() {
    const up = this.sceneUp;
    this.c
      .set(this.discX, 0, this.discZ)
      .addScaledVector(
        up,
        this.seaLevel - (this.discX * up.x + this.discZ * up.z),
      );
    const R = this.radius;
    const r = Math.min(this.discR, R);
    this.s = Math.sqrt((R - r) * (R + r));
    this.C.copy(this.c).addScaledVector(up, -this.s);
    const { uGlobeUp, uGlobeDisc, uGlobe } = this.uniforms;
    uGlobeUp.value.copy(up);
    uGlobeDisc.value.set(this.c.x, this.c.y, this.c.z, this.discR);
    uGlobe.value.set(R, this.s, this.discR * this.discR, this.on ? 1 : 0);
  }
}
