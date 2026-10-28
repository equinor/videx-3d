import {
  Camera,
  Color,
  ColorRepresentation,
  MathUtils,
  OrthographicCamera,
  PerspectiveCamera,
  Uniform,
  Vector2,
  Vector3,
  Vector4,
} from 'three';
import type { Globe } from '../projection/globe';

/** The kinds of lines a graticule draws, in the order of its uniforms (`graticule.glsl`). */
export const GRATICULE_KINDS = ['latLon', 'utm', 'timeZones'] as const;

/** How far apart on screen, in pixels, latitude and longitude following the view are at the least, by default. */
export const GRATICULE_MIN_SPACING = 120;

/** The steps latitude and longitude follow the view by, coarse to fine, in degrees: 30°, 10°, 5°, 1°, 30′, 10′, 5′, 1′. Each is a multiple of the next. */
export const GRATICULE_STEPS = [
  30,
  10,
  5,
  1,
  0.5,
  1 / 6,
  1 / 12,
  1 / 60,
] as const;

/** One of {@link GRATICULE_KINDS}. */
export type GraticuleKind = (typeof GRATICULE_KINDS)[number];

/** How one kind of a graticule's lines is drawn. */
export type GraticuleStyle = {
  color: ColorRepresentation;
  /** width in screen pixels */
  thickness: number;
  /** from 0 to 1 */
  opacity: number;
  /** degrees between lines, for latitude and longitude; 0 or left out to follow the view */
  interval?: number;
  /** following the view, how far apart on screen its lines are at the least, in pixels */
  minSpacing?: number;
};

/** The step of latitude and longitude for a view ({@link graticuleStep}). */
export type GraticuleStep = {
  /** degrees between the lines drawn */
  step: number;
  /** the next finer step's */
  finer: number;
  /** how much of the finer step is drawn, 0 to 1 */
  weight: number;
};

/** The uniforms `graticule.glsl` reads. */
export type GraticuleUniforms = {
  /** per kind: its colour, linear, and opacity */
  uGraticuleColors: Uniform<Vector4[]>;
  /** per kind: its width in pixels (0: off) */
  uGraticuleLines: Uniform<Vector4[]>;
  /** latitude and longitude's step, the next finer step, and how much of it is drawn (see {@link GraticuleStep}) */
  uGraticuleLatLon: Uniform<Vector3>;
  /** where lines are measured from, near the camera ({@link setGraticuleOrigin}): its whole degrees of longitude and latitude, and what is left of them */
  uGraticuleBase: Uniform<Vector4>;
  /** its offset on the globe's sphere (Δχ, ΔΛ, radians), and 1 once set */
  uGraticuleOrigin: Uniform<Vector4>;
  /** latitude from it, in degrees, per radian of Δχ from its, to the first, second and third power */
  uGraticuleSeries: Uniform<Vector3>;
};

/** A graticule's uniforms, every kind off. */
export function createGraticuleUniforms(): GraticuleUniforms {
  return {
    uGraticuleColors: new Uniform(GRATICULE_KINDS.map(() => new Vector4())),
    uGraticuleLines: new Uniform(GRATICULE_KINDS.map(() => new Vector4())),
    uGraticuleLatLon: new Uniform(new Vector3(GRATICULE_STEPS[0], 0, 0)),
    uGraticuleBase: new Uniform(new Vector4()),
    uGraticuleOrigin: new Uniform(new Vector4()),
    uGraticuleSeries: new Uniform(new Vector3()),
  };
}

// How far either way the latitude's series is sampled from, in radians of Δχ.
const SERIES_STEP = 1e-3;
const offset = new Vector2();
const under = { latitude: 0, longitude: 0 };

/**
 * Where the lines are measured from: the ground under `point` (the camera), in 64-bit
 * floats. Latitude and longitude are near 1 radian, which 32-bit floats hold to about half
 * a metre: close in, the lines' offsets and their change over a pixel came in steps of
 * it, and the lines broke into strands and dashes. Measured from here instead — whole
 * degrees, what is left of them, and the latitude's change as a series in the sphere's
 * offset, which a shader holds to a centimetre near it — they hold. Needs `globe` placed
 * on the Earth (a frame); a no-op without.
 */
export function setGraticuleOrigin(
  uniforms: GraticuleUniforms,
  globe: Globe,
  point: Vector3,
) {
  if (!globe.location) {
    uniforms.uGraticuleOrigin.value.w = 0;
    return;
  }
  const { latitude, longitude } = globe.geographic(point, under);
  globe.sphereOffset(latitude, longitude, offset);
  const lon = Math.floor(longitude);
  const lat = Math.floor(latitude);
  uniforms.uGraticuleBase.value.set(lon, lat, longitude - lon, latitude - lat);
  uniforms.uGraticuleOrigin.value.set(offset.x, offset.y, 0, 1);
  // φ(Δχ₀ + δ) − φ(Δχ₀) = a₁δ + a₂δ² + a₃δ³, by central differences.
  const h = SERIES_STEP;
  const f = (d: number) =>
    globe.sphereGeographicLatitude(offset.x + d) - latitude;
  const [m2, m1, p1, p2] = [f(-2 * h), f(-h), f(h), f(2 * h)];
  uniforms.uGraticuleSeries.value.set(
    (p1 - m1) / (2 * h),
    (p1 + m1) / (2 * h * h),
    (p2 - 2 * p1 + 2 * m1 - m2) / (12 * h * h * h),
  );
}

const color = new Color();

/** Set each kind of `styles` on `uniforms`: drawn with its style, or off where null or left out. */
export function setGraticuleUniforms(
  uniforms: GraticuleUniforms,
  styles: Partial<Record<GraticuleKind, GraticuleStyle | null>>,
) {
  GRATICULE_KINDS.forEach((kind, i) => {
    const style = styles[kind];
    const lines = uniforms.uGraticuleLines.value[i];
    if (!style || style.thickness <= 0 || style.opacity <= 0) {
      lines.set(0, 0, 0, 0);
      return;
    }
    color.set(style.color);
    uniforms.uGraticuleColors.value[i].set(
      color.r,
      color.g,
      color.b,
      Math.min(style.opacity, 1),
    );
    lines.set(style.thickness, 0, 0, 0);
  });
}

const smoothstep = (a: number, b: number, t: number) => {
  const u = Math.min(Math.max((t - a) / (b - a), 0), 1);
  return u * u * (3 - 2 * u);
};

/**
 * The step of latitude and longitude for a view where a pixel spans `degreesPerPixel`
 * (of latitude): the finest of {@link GRATICULE_STEPS} whose lines lie `minSpacing` pixels
 * apart or more (the coarsest where none does), and the next finer one fading in, on a log
 * scale, as its lines go from half that apart to all of it. So the step changes without a
 * jump, and the finest drawn is never dense.
 */
export function graticuleStep(
  degreesPerPixel: number,
  minSpacing = GRATICULE_MIN_SPACING,
  target: GraticuleStep = { step: 0, finer: 0, weight: 0 },
): GraticuleStep {
  const perPixel = Math.max(degreesPerPixel, 1e-12);
  const least = Math.max(minSpacing, 1);
  let i = 0;
  while (
    i + 1 < GRATICULE_STEPS.length &&
    GRATICULE_STEPS[i + 1] / perPixel >= least
  )
    i++;
  const finer = GRATICULE_STEPS[Math.min(i + 1, GRATICULE_STEPS.length - 1)];
  target.step = GRATICULE_STEPS[i];
  target.finer = finer;
  target.weight =
    finer === target.step
      ? 0
      : smoothstep(
          Math.log2(least / 2),
          Math.log2(least),
          Math.log2(finer / perPixel),
        );
  return target;
}

/** Set latitude and longitude's step on `uniforms` (see {@link graticuleStep}). */
export function setGraticuleStep(
  uniforms: GraticuleUniforms,
  { step, finer, weight }: GraticuleStep,
) {
  uniforms.uGraticuleLatLon.value.set(step, finer, weight);
}

// Metres along a meridian per degree of latitude, on the Earth's mean sphere.
const METRES_PER_DEGREE = (Math.PI / 180) * 6371008.8;

/**
 * How far a view is zoomed, for {@link graticuleStep}: the degrees of latitude a pixel
 * spans on ground `distance` from `camera`, seen face on, the view `pixels` tall (the
 * drawing buffer's height, as the shaders' pixels are). Pass the distance to the ground the
 * view is centred on, so an oblique view follows what it looks at, not what lies under it.
 * A perspective camera's by its field of view; an orthographic one's by its frustum,
 * whatever the distance.
 */
export function graticuleDegreesPerPixel(
  camera: Camera,
  distance: number,
  pixels: number,
): number {
  const ortho = camera as OrthographicCamera;
  const span = ortho.isOrthographicCamera
    ? (ortho.top - ortho.bottom) / ortho.zoom
    : 2 *
      Math.tan(
        MathUtils.degToRad((camera as PerspectiveCamera).getEffectiveFOV()) / 2,
      ) *
      Math.max(Math.abs(distance), 1);
  return span / Math.max(pixels, 1) / METRES_PER_DEGREE;
}
