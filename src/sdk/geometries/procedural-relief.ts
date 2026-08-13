/**
 * Procedural relief fields, shared by the synthetic layers of a chunk stack.
 *
 * Deliberately free of any three.js import: these run inside the (inlined) stack
 * workers alongside the rest of the grid maths.
 *
 * ⭐ Every field is evaluated in WORLD coordinates, never in coordinates relative
 * to a chunk's own footprint. Two chunks covering the same ground therefore
 * generate the same rock — and changing an outline no longer changes the geology
 * under it. It is also what lets a SHAPED field (a coast, an island) be placed:
 * a centre means something only in a frame that does not move.
 */
import { Vec2 } from '../types/common';

/** Which procedural field a synthetic layer uses. */
export type ReliefKind = 'dunes' | 'ridges' | 'ramp' | 'dome';

/**
 * Default wavelength of the coarsest relief feature, in world units. Chosen for
 * field scale (20–80 km²): a few features across a typical chunk.
 */
export const RELIEF_FEATURE_SIZE = 8000;

/** Smooth Hermite step, 0 below `a`, 1 above `b`. */
function smoothstep(a: number, b: number, t: number): number {
  if (b === a) return t < a ? 0 : 1;
  const u = Math.min(Math.max((t - a) / (b - a), 0), 1);
  return u * u * (3 - 2 * u);
}

/**
 * Ridged, multi-octave [0, 1] field (`1 - |sin|` creases per octave, slow
 * amplitude falloff, sharpened) — reads as jagged rock rather than rolling sand.
 */
export function ridgeRelief(fx: number, fz: number, seed: number): number {
  const ridge = (a: number) => 1 - Math.abs(Math.sin(a));
  const freqs = [3, 7, 15, 29];
  let n = 0;
  let amp = 1;
  let norm = 0;
  for (let o = 0; o < freqs.length; o++) {
    const f = freqs[o];
    n +=
      amp *
      ridge((fx * f + seed) * Math.PI) *
      ridge((fz * f - seed * 0.7) * Math.PI + 0.9);
    norm += amp;
    amp *= 0.62; // slow falloff keeps strong high-frequency (rocky) detail
  }
  n /= norm;
  return Math.min(Math.max(Math.pow(n, 1.4), 0), 1); // sharpen toward blocky rock
}

/** Smooth [0, 1] field (a small sum of sines — rolling dunes). */
export function duneRelief(fx: number, fz: number, seed: number): number {
  let n = 0.5;
  n +=
    0.25 * Math.sin((fx * 6.0 + seed) * Math.PI) * Math.cos(fz * 5.0 * Math.PI);
  n +=
    0.15 *
    Math.sin((fx * 13.0 - seed) * Math.PI + 1.7) *
    Math.cos(fz * 11.0 * Math.PI - 0.6);
  n +=
    0.1 *
    Math.sin(fx * 23.0 * Math.PI + 0.3) *
    Math.cos(fz * 19.0 * Math.PI + 2.1);
  return Math.min(Math.max(n, 0), 1);
}

/**
 * Rise along a direction, EASED: flat at both ends with a slope between them.
 *
 * ⭐ The easing is what makes it a landform rather than a tilt. A plain gradient
 * is what `dip` already gives; this is a basin, a slope and a shelf, which is
 * what a coast looks like.
 *
 * @param x world X
 * @param z world Z
 * @param azimuth compass direction the field RISES toward, in degrees
 * @param run distance over which it rises, in world units
 * @param center world XZ the run is centred on
 * @returns 0 on the low side, 1 on the high side
 */
export function rampRelief(
  x: number,
  z: number,
  azimuth: number,
  run: number,
  center: Vec2 = [0, 0],
): number {
  const a = (azimuth * Math.PI) / 180;
  // Compass: 0 = +Z (north), 90 = +X (east).
  const along = (x - center[0]) * Math.sin(a) + (z - center[1]) * Math.cos(a);
  const half = Math.max(run, 1) / 2;
  return smoothstep(-half, half, along);
}

/**
 * A radially symmetric high — an island, a bank, a hill on top of one.
 *
 * `falloff` is the width of the rim, measured inward from `radius`: small values
 * give a flat-topped mesa, `falloff = radius` a smooth dome.
 *
 * @returns 0 at and beyond `radius`, 1 across the middle
 */
export function domeRelief(
  x: number,
  z: number,
  center: Vec2,
  radius: number,
  falloff?: number,
): number {
  const d = Math.hypot(x - center[0], z - center[1]);
  const r = Math.max(radius, 1);
  const rim = Math.min(Math.max(falloff ?? r, 1), r);
  return 1 - smoothstep(r - rim, r, d);
}

/** What every relief component carries, whatever shape it has. */
type ReliefBase = {
  /** perturbation of the base, in world units — see {@link ReliefBase.mode} */
  amplitude: number;
  /**
   * `'center'` (default) spreads the relief ± `amplitude / 2` about the base, so
   * the base is the MEAN — right for noise, which has no natural zero. `'above'`
   * treats the base as the LOWEST point and raises the field out of it, which is
   * what a landform wants: nothing outside it, `amplitude` at its top. `'below'`
   * is the same the other way.
   */
  mode?: 'center' | 'above' | 'below';
  /** procedural seed. Default 0; ignored by the shaped kinds. */
  seed?: number;
};

/** A noise field: the same everywhere, with no position of its own. */
export type NoiseRelief = ReliefBase & {
  kind?: 'dunes' | 'ridges';
  /**
   * Wavelength of the coarsest feature, in WORLD units. Default
   * {@link RELIEF_FEATURE_SIZE}.
   */
  featureSize?: number;
};

/** An eased rise along a direction — a coast (see {@link rampRelief}). */
export type RampRelief = ReliefBase & {
  kind: 'ramp';
  /** compass direction it rises toward, in degrees (0 = +Z, 90 = +X) */
  azimuth: number;
  /** distance over which it rises, in world units */
  run: number;
  /** world XZ the run is centred on. Default `[0, 0]`. */
  center?: Vec2;
};

/** A radially symmetric high — an island or a hill (see {@link domeRelief}). */
export type DomeRelief = ReliefBase & {
  kind: 'dome';
  /** world XZ of the middle */
  center: Vec2;
  /** world units out to where it reaches the base again */
  radius: number;
  /** width of the rim, inward from `radius`. Default `radius` (a smooth dome). */
  falloff?: number;
};

/**
 * One procedural relief component: what shape, how strong, and where.
 *
 * Shared by the synthetic layers of a chunk stack ({@link StackRelief}) and by
 * generated surface fields, so "the same relief" means the same thing in both.
 * Components compose: a coast, an island on it and a little noise over the whole
 * thing are three entries in one array.
 *
 * @group Geometries
 */
export type ReliefSpec = NoiseRelief | RampRelief | DomeRelief;

/**
 * How a synthetic layer is perturbed away from its base plane.
 *
 * @group Geometries
 */
export type StackRelief = ReliefSpec;

/**
 * Evaluate a relief field at a world position, returning the SIGNED offset (world
 * units, upwards-positive) to add to a base height.
 *
 * @group Geometries
 */
export function evaluateRelief(relief: ReliefSpec, x: number, z: number) {
  const n = sampleRelief(relief, x, z);
  if (relief.mode === 'below') return -relief.amplitude * n;
  if (relief.mode === 'above') return relief.amplitude * n;
  return relief.amplitude * (n - 0.5);
}

/**
 * The same offset as {@link evaluateRelief}, in DEPTH — positive-down, the
 * convention the surface generators work in. Raising a landform makes its depth
 * SMALLER, which is the one place that sign has to be stated.
 *
 * @group Geometries
 */
export function reliefDepth(relief: ReliefSpec, x: number, z: number) {
  return -evaluateRelief(relief, x, z);
}

/**
 * Evaluate a relief field at a world position, returning the RAW `[0, 1]` field
 * value before any amplitude or mode is applied.
 *
 * @group Geometries
 */
export function sampleRelief(relief: ReliefSpec, x: number, z: number): number {
  if (relief.kind === 'ramp')
    return rampRelief(x, z, relief.azimuth, relief.run, relief.center);
  if (relief.kind === 'dome')
    return domeRelief(x, z, relief.center, relief.radius, relief.falloff);
  const size = Math.max(relief.featureSize ?? RELIEF_FEATURE_SIZE, 1);
  const seed = relief.seed ?? 0;
  const field = relief.kind === 'ridges' ? ridgeRelief : duneRelief;
  return field(x / size, z / size, seed);
}
