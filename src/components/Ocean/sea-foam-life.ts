import {
  ClampToEdgeWrapping,
  HalfFloatType,
  type IUniform,
  LinearFilter,
  RGBAFormat,
  ShaderMaterial,
  type Texture,
  Uniform,
  Vector2,
  Vector3,
  Vector4,
  type WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import { FullscreenRenderer } from '../../rendering/fullscreen-renderer';
import fragmentShader from './shaders/foam-life-fragment.glsl';
import vertexShader from './shaders/foam-life-vertex.glsl';

/** Texels across the foam's square. */
export const SEA_FOAM_TEXELS = 512;
/**
 * The share of the whitecaps' cover that breaks afresh where the foam's life is drawn, the rest
 * being the foam they leave (`ocean-surface.glsl`'s `OCEAN_FOAM_ACTIVE`, the same): as much
 * foam in all as the whitecaps' statistical cover (measured: 3.6 % of the pixels at 15 m/s).
 */
export const SEA_FOAM_ACTIVE = 0.47;
// The square's size by the camera's height over the sea: about six times it, in powers of two
// from 512 m (a metre a texel) to 2 km; its foam faded out from 400 m up to 1 km. It grows as
// soon as the camera climbs past it, but shrinks only once the camera is well under the next
// size down (SIZE_SHRINK of it), so a camera hovering about a step does not flip it to and fro.
const SIZE_MIN = 512;
const SIZE_MAX = 2048;
const SIZE_SHRINK = 0.7;
const HOLD_FROM = 400;
const HOLD_TO = 1000;
// How far ahead of the camera the square lies, of its size, looking level (none looking down):
// more of it where the view reaches, and the camera clear of its fading edge (its outer 30 %).
const AHEAD = 0.2;
// How long a texel takes to come into its life once inside the square (s): it holds as much of
// the whitecaps as it has (ocean-surface.glsl's oceanFoamLifeAt), the rest drawn as without, so
// the sea the square moves onto is never bare.
const EASE_IN = 5;
// How long fresh foam lasts (s, e-folding), the share of it that is left as old foam, and the
// wind drift of the surface (of the wind speed).
const FRESH_LIFE = 2;
const FRESH_TO_OLD = 0.05;
const DRIFT = 0.03;
// The defines the waves compile with (ocean-surface.glsl).
const WAVE_DEFINES = [
  'SEA_LAYERS',
  'SEA_DETAIL',
  'OCEAN_CONTACT_COUNT',
  'OCEAN_NO_GUSTS',
];

/** What the foam's life is run with, a step. */
export type SeaFoamStep = {
  /** where the camera is in the wave plane (m) */
  at: { x: number; y: number };
  /**
   * the way the camera looks in the wave plane, as long as its look is level (1 looking at the
   * horizon, 0 straight down); none: about the camera
   */
  ahead?: { x: number; y: number } | null;
  /** the camera's height over the sea (m) */
  height: number;
  /** seconds the sea's clock ran since the last step */
  seconds: number;
  /** the wind's speed (m/s) and the way it blows toward in the wave plane */
  windSpeed: number;
  windDirection: Vector2;
};

/**
 * The life of an `OceanMaterial`'s whitecaps: a square of the wave plane about the camera, ahead
 * of it the way it looks, in which the foam a breaking crest leaves lasts on, drifts downwind and
 * is gathered by the wind into streaks, and fades (`foam-life-fragment.glsl`; documents/ocean.md,
 * "Foam with a life"). Sea the square moves onto eases into its life (b, over `EASE_IN`).
 * Run each frame with the waves (`OceanMaterial.renderWaves`), on the sea's clock: paused, it
 * holds. Its pass reads the waves as the surface does, sharing the material's uniforms.
 */
export class SeaFoamLife {
  /** read by the surface (`uFoamLife`, `uFoamLifeArea`) */
  readonly uniforms: {
    uFoamLife: IUniform<Texture | null>;
    uFoamLifeArea: IUniform<Vector4>;
  };
  private readonly targets: [WebGLRenderTarget, WebGLRenderTarget];
  private readonly material: ShaderMaterial;
  private readonly fullscreen = new FullscreenRenderer();
  private current = 0;
  private readonly now = new Vector3();
  private readonly before = new Vector3();
  private clock = 0;
  private fresh = true;
  private size = 0;

  /**
   * @param surface the material's uniforms, which the pass reads the waves by (by reference),
   *   and whose `uFoamLife` and `uFoamLifeArea` it keeps up to date for the surface
   * @param defines the material's defines the waves compile with (its layers, contacts)
   */
  constructor(
    surface: Record<string, IUniform>,
    defines: Record<string, unknown>,
  ) {
    const target = () =>
      new WebGLRenderTarget(SEA_FOAM_TEXELS, SEA_FOAM_TEXELS, {
        format: RGBAFormat,
        type: HalfFloatType,
        wrapS: ClampToEdgeWrapping,
        wrapT: ClampToEdgeWrapping,
        minFilter: LinearFilter,
        magFilter: LinearFilter,
        generateMipmaps: false,
        depthBuffer: false,
        stencilBuffer: false,
      });
    this.targets = [target(), target()];
    this.uniforms = {
      uFoamLife: surface.uFoamLife as IUniform<Texture | null>,
      uFoamLifeArea: surface.uFoamLifeArea as IUniform<Vector4>,
    };
    this.uniforms.uFoamLife.value = this.targets[0].texture;
    this.uniforms.uFoamLifeArea.value.set(0, 0, 1, 0);
    this.material = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      // What the waves compile with; none of the surface's own.
      defines: Object.fromEntries(
        Object.entries(defines).filter(([key]) => WAVE_DEFINES.includes(key)),
      ),
      uniforms: {
        ...surface,
        uFoamPrev: new Uniform<Texture | null>(null),
        uFoamNow: new Uniform(this.now),
        uFoamPrevArea: new Uniform(this.before),
        uFoamDrift: new Uniform(new Vector2()),
        uFoamStep: new Uniform(new Vector4()),
        uFoamStreaks: new Uniform(new Vector4(1, 0, 0.05, 0)),
        uFoamActive: new Uniform(SEA_FOAM_ACTIVE),
        uFoamEase: new Uniform(0),
      },
      depthTest: false,
      depthWrite: false,
    });
  }

  /** Stop drawing it (the camera too high, or no camera): the surface's whitecaps alone. */
  hide(): void {
    this.uniforms.uFoamLifeArea.value.w = 0;
  }

  /** Run it a step and hand the surface the square as it is now. */
  update(renderer: WebGLRenderer, step: SeaFoamStep): void {
    const height = Math.max(step.height, 0);
    const hold = 1 - smoothstep(HOLD_FROM, HOLD_TO, height);
    const area = this.uniforms.uFoamLifeArea.value;
    if (hold <= 0) {
      area.w = 0;
      this.fresh = true;
      return;
    }
    const wanted = Math.max(height * 6, 1);
    if (
      this.fresh ||
      wanted > this.size ||
      wanted < this.size * 0.5 * SIZE_SHRINK
    )
      this.size = Math.min(
        Math.max(2 ** Math.ceil(Math.log2(wanted)), SIZE_MIN),
        SIZE_MAX,
      );
    const size = this.size;
    const texel = size / SEA_FOAM_TEXELS;
    const ahead = step.ahead;
    const centreX = step.at.x + (ahead ? ahead.x * AHEAD * size : 0);
    const centreY = step.at.y + (ahead ? ahead.y * AHEAD * size : 0);
    // Snapped to its texels, so nothing swims as the camera moves.
    const x = Math.floor((centreX - size / 2) / texel) * texel;
    const y = Math.floor((centreY - size / 2) / texel) * texel;
    const seconds = this.fresh ? 0 : Math.max(step.seconds, 0);
    const now = this.now;
    const moved = now.x !== x || now.y !== y || now.z !== size;
    // Held still on a paused clock with the camera in place: as it is.
    if (!this.fresh && seconds === 0 && !moved) {
      area.w = hold;
      return;
    }
    if (this.fresh) this.before.set(x, y, size);
    else this.before.copy(now);
    now.set(x, y, size);

    const u = this.material.uniforms;
    const wind = Math.max(step.windSpeed, 0);
    const toward = step.windDirection;
    const length = Math.hypot(toward.x, toward.y) || 1;
    const dx = toward.x / length;
    const dy = toward.y / length;
    (u.uFoamDrift.value as Vector2).set(
      dx * DRIFT * wind * seconds,
      dy * DRIFT * wind * seconds,
    );
    // Old foam lasts longer in a stronger wind (thicker, its bubbles larger), and the wind
    // gathers it into streaks (windrows: Langmuir cells, converging at about 1.5 % of the wind)
    // from about Beaufort 4, spaced wider as it rises.
    const oldLife = Math.min(Math.max(2 * wind, 8), 40);
    const pull = 0.015 * wind * smoothstep(5, 12, wind);
    (u.uFoamStep.value as Vector4).set(
      Math.exp(-seconds / FRESH_LIFE),
      Math.exp(-seconds / oldLife),
      FRESH_TO_OLD,
      pull * seconds,
    );
    this.clock += seconds;
    u.uFoamEase.value = seconds / EASE_IN;
    (u.uFoamStreaks.value as Vector4).set(
      -dy,
      dx,
      1 / Math.min(Math.max(2.5 * wind, 6), 50),
      this.clock * 0.02,
    );

    const from = this.targets[this.current];
    const into = this.targets[1 - this.current];
    u.uFoamPrev.value = this.fresh ? null : from.texture;
    const previous = renderer.getRenderTarget();
    this.fullscreen.renderMaterial(renderer, into, this.material);
    renderer.setRenderTarget(previous);
    this.current = 1 - this.current;
    this.fresh = false;

    this.uniforms.uFoamLife.value = into.texture;
    area.set(x, y, size, hold);
  }

  /** Start over: the next step finds no foam left (a jump in time, another chart). */
  reset(): void {
    this.fresh = true;
  }

  dispose(): void {
    this.uniforms.uFoamLife.value = null;
    this.uniforms.uFoamLifeArea.value.w = 0;
    for (const target of this.targets) target.dispose();
    this.material.dispose();
    this.fullscreen.dispose();
  }
}

function smoothstep(a: number, b: number, t: number): number {
  const u = Math.min(Math.max((t - a) / (b - a), 0), 1);
  return u * u * (3 - 2 * u);
}
