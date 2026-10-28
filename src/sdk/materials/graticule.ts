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

/**
 * Meridians run on to a pole past the last parallel before it only when that parallel lies
 * within this latitude, in degrees; beyond, they stop there ({@link graticuleMeridianThinning}).
 * As `graticule.glsl`'s `GRATICULE_POLE_CAP`.
 */
export const GRATICULE_POLE_CAP = 60;

/**
 * How narrow a cell of latitude and longitude may get, east–west for its height: meridians
 * are thinned toward the poles to keep it ({@link graticuleMeridianThinning}). As
 * `graticule.glsl`'s `GRATICULE_CELL_ASPECT`.
 */
export const GRATICULE_CELL_ASPECT = 0.5;

/** The fewest meridians round the Earth that thinning leaves; fewer, and they stop. */
export const GRATICULE_MIN_MERIDIANS = 4;

/** The most steps of thinning a graticule's uniforms hold, per step (`uGraticuleThinning`). */
export const GRATICULE_THINNING_MAX = 12;

const thinningChains = new Map<number, number[]>();

/**
 * How meridians every `step` degrees thin toward the poles: every 1st, then every m-th of
 * them for each `m` in turn, each twice or three times the last — so cells keep between
 * {@link GRATICULE_CELL_ASPECT} and 1.5 times as wide as tall — and each dividing the
 * meridians round the Earth, so those kept meet themselves evenly at the date line and are
 * among those kept nearer the equator. While {@link GRATICULE_MIN_MERIDIANS} are left, and
 * {@link GRATICULE_THINNING_MAX} at most. A step that does not divide 360° thins by twos.
 */
export function graticuleMeridianChain(step: number): number[] {
  const known = thinningChains.get(step);
  if (known) return known;
  const chain = [1];
  const around = 360 / step;
  const whole = Math.round(around);
  const even = step > 0 && Math.abs(around - whole) < 1e-6 * around;
  let m = 1;
  while (step > 0 && chain.length < GRATICULE_THINNING_MAX) {
    let next = 0;
    for (const factor of [2, 3]) {
      if (!even || whole % (m * factor) === 0) {
        next = m * factor;
        break;
      }
    }
    if (!next || around / next < GRATICULE_MIN_MERIDIANS - 1e-9) break;
    m = next;
    chain.push(m);
  }
  thinningChains.set(step, chain);
  return chain;
}

/** The first of `chain` ({@link graticuleMeridianChain}) that is `needed` or more; 0 if none is. */
export function graticuleThinningPick(
  chain: readonly number[],
  needed: number,
) {
  for (const m of chain) if (m >= needed * (1 - 1e-6)) return m;
  return 0;
}

const DEG = Math.PI / 180;

/**
 * Which of the meridians every `step` degrees are drawn in the band between the parallels
 * `band` and `band + 1` steps from the equator (either way): every m-th, the least of
 * {@link graticuleMeridianChain} that keeps the band's cells {@link GRATICULE_CELL_ASPECT}
 * as wide as tall where they are narrowest, at its poleward parallel; 0 for none, where
 * none does. The band reaching a pole keeps its meridians only if its parallel lies within
 * {@link GRATICULE_POLE_CAP} (30°: twelve to the pole), judged there, else none: a plain
 * cap. Changing only at a parallel, the meridians are cut clean under it, as the shader
 * cuts them.
 */
export function graticuleMeridianThinning(step: number, band: number): number {
  if (!(step > 0)) return 0;
  const a = Math.abs(band * step);
  const b = Math.abs((band + 1) * step);
  const equatorward = Math.min(a, b);
  const poleward = Math.min(Math.max(a, b), 90);
  if (equatorward >= 90) return 0;
  const last = poleward >= 90 - 1e-9;
  if (last && equatorward > GRATICULE_POLE_CAP + 1e-9) return 0;
  const narrowest = Math.cos((last ? equatorward : poleward) * DEG);
  return graticuleThinningPick(
    graticuleMeridianChain(step),
    GRATICULE_CELL_ASPECT / Math.max(narrowest, 1e-12),
  );
}

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
  /** how the step's meridians thin toward the poles ({@link graticuleMeridianChain}), then the finer step's: twelve each, 0 past the end */
  uGraticuleThinning: Uniform<Vector4[]>;
};

/** A graticule's uniforms, every kind off. */
export function createGraticuleUniforms(): GraticuleUniforms {
  const uniforms: GraticuleUniforms = {
    uGraticuleColors: new Uniform(GRATICULE_KINDS.map(() => new Vector4())),
    uGraticuleLines: new Uniform(GRATICULE_KINDS.map(() => new Vector4())),
    uGraticuleLatLon: new Uniform(new Vector3(GRATICULE_STEPS[0], 0, 0)),
    uGraticuleBase: new Uniform(new Vector4()),
    uGraticuleOrigin: new Uniform(new Vector4()),
    uGraticuleSeries: new Uniform(new Vector3()),
    uGraticuleThinning: new Uniform(
      Array.from({ length: 6 }, () => new Vector4()),
    ),
  };
  setGraticuleStep(uniforms, { step: GRATICULE_STEPS[0], finer: 0, weight: 0 });
  return uniforms;
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

/** Set latitude and longitude's step on `uniforms` (see {@link graticuleStep}), and how its meridians and the finer step's thin toward the poles. */
export function setGraticuleStep(
  uniforms: GraticuleUniforms,
  { step, finer, weight }: GraticuleStep,
) {
  uniforms.uGraticuleLatLon.value.set(step, finer, weight);
  writeThinning(uniforms.uGraticuleThinning.value, 0, step);
  writeThinning(uniforms.uGraticuleThinning.value, 3, finer);
}

// A step's thinning (graticuleMeridianChain) into three vec4s from `from`, 0 past its end.
function writeThinning(target: Vector4[], from: number, step: number) {
  const chain = step > 0 ? graticuleMeridianChain(step) : [1];
  for (let i = 0; i < 3; i++)
    target[from + i].set(
      chain[4 * i] ?? 0,
      chain[4 * i + 1] ?? 0,
      chain[4 * i + 2] ?? 0,
      chain[4 * i + 3] ?? 0,
    );
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
