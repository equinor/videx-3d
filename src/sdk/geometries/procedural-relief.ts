/**
 * Procedural relief fields, shared by the synthetic layers of a chunk stack.
 *
 * Deliberately free of any three.js import: these run inside the (inlined) stack
 * workers alongside the rest of the grid maths.
 *
 * ⭐ All fields are evaluated in WORLD coordinates divided by `featureSize`, never
 * in coordinates relative to a chunk's own footprint. Two chunks covering the same
 * ground therefore generate the same rock — and changing an outline no longer
 * changes the geology under it.
 */

/** Which procedural field a synthetic layer uses. */
export type ReliefKind = 'dunes' | 'ridges';

/**
 * Default wavelength of the coarsest relief feature, in world units. Chosen for
 * field scale (20–80 km²): a few features across a typical chunk.
 */
export const RELIEF_FEATURE_SIZE = 8000;

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
 * One procedural relief component: which field, how strong, at what scale.
 *
 * Shared by the synthetic layers of a chunk stack ({@link StackRelief}) and by
 * generated surface fields, so "the same relief" means the same thing in both.
 *
 * @group Geometries
 */
export type ReliefSpec = {
  /** which field to use. Default `'dunes'`. */
  kind?: ReliefKind;
  /** ± perturbation about the base, in world units */
  amplitude: number;
  /** procedural seed. Default 0. */
  seed?: number;
  /**
   * Wavelength of the coarsest feature, in WORLD units. Default
   * {@link RELIEF_FEATURE_SIZE}.
   */
  featureSize?: number;
};

/**
 * How a synthetic layer is perturbed away from its base plane.
 *
 * @group Geometries
 */
export type StackRelief = ReliefSpec & {
  /**
   * `'center'` (default) spreads the relief ± `amplitude / 2` about the base, so
   * the base is the MEAN. `'below'` keeps the base as the shallowest point and
   * pushes everything down from it.
   */
  mode?: 'center' | 'below';
};

/**
 * Evaluate a relief field at a world position, returning the SIGNED offset (world
 * units, upwards-positive) to add to a base height.
 *
 * @group Geometries
 */
export function evaluateRelief(relief: StackRelief, x: number, z: number) {
  const n = sampleRelief(relief, x, z);
  return relief.mode === 'below'
    ? -relief.amplitude * n
    : relief.amplitude * (n - 0.5);
}

/**
 * Evaluate a relief field at a world position, returning the RAW `[0, 1]` field
 * value before any amplitude or mode is applied.
 *
 * @group Geometries
 */
export function sampleRelief(relief: ReliefSpec, x: number, z: number): number {
  const size = Math.max(relief.featureSize ?? RELIEF_FEATURE_SIZE, 1);
  const seed = relief.seed ?? 0;
  const field = relief.kind === 'ridges' ? ridgeRelief : duneRelief;
  return field(x / size, z / size, seed);
}
