import {
  type BufferGeometry,
  type Camera,
  Color,
  type CubeTexture,
  DoubleSide,
  IUniform,
  MathUtils,
  Matrix3,
  type Object3D,
  type OrthographicCamera,
  type PerspectiveCamera,
  type Scene,
  ShaderMaterial,
  ShaderMaterialParameters,
  Texture,
  Uniform,
  UniformsLib,
  UniformsUtils,
  Vector2,
  Vector3,
  Vector4,
  type WebGLRenderer,
} from 'three';
import { attachOitVariants } from '../../rendering/oit-material';
import {
  applyFenceField,
  FenceFieldUniforms,
} from '../../sdk/materials/fence-field';
import {
  WATER_QUALITY,
  SeaState,
  type WaterQuality,
} from '../../sdk/weather/sea-state';
import type { SeaSwell } from '../../sdk/weather/sea-spectrum';
import { SEA_BREAK_DEPTH, seaDeepDepth } from '../../sdk/weather/sea-shallow';
import {
  type WaterOptics,
  waterOpticsOf,
} from '../../sdk/weather/water-optics';
import { sceneWaterBody, WaterBody } from '../../sdk/materials/water-body';
import {
  cubeUVSize,
  sceneSky,
  type SceneSkySource,
} from '../../sdk/materials/scene-sky';
import { sceneGroundMap } from '../../sdk/materials/ground-map';
import { depthMapHeightAt } from '../../sdk/materials/depth-map';
import { geometryFootprint } from '../../sdk/geometries/geometry-footprint';
import type { CameraWater } from '../../sdk/utils/camera-site';
import {
  type WeatherGusts,
  weatherGustsOf,
} from '../../sdk/weather/wind-field';
import { SeaWaveBake } from './sea-wave-bake';
import { SeaFoamLife } from './sea-foam-life';
import type { WeatherSea } from '../Weather/weather-sea';
import fragmentShader from './shaders/fragment.glsl';
import vertexShader from './shaders/vertex.glsl';

/**
 * A sea bed's depth grid, packed by `buildSurfaceDepthMap`: R the scene Y, G the
 * validity, sampled from OBJECT XZ through `toUv`.
 *
 * ⚠️ Structural on purpose — `ZoneDepthMap` satisfies it, without this material
 * having to depend on the zone components.
 */
export type WaterBathymetry = {
  texture: Texture;
  /** object XZ -> texture uv, as `uv = m * vec3(x, z, 1)` */
  toUv: Matrix3;
  /** grid spacing in metres, used to take the bed's gradient */
  cellSize: number;
};

/** Default feature size of the shore foam's ragged edge, in metres. */
const DEFAULT_WATER_SHORE_NOISE_SCALE = 200;

/**
 * How many times a sea layer's tile a pixel straight below the camera must span before
 * {@link WaterMaterial.renderWaves} stops baking it. A pixel off the view's axis spans less
 * of the sea in front of it (down to ~0.6× in a corner), as one rendered supersampled does.
 */
const SEA_BAKE_PIXEL_MARGIN = 2;

const drawingBuffer = new Vector2();

/** The world size of a pixel at `distance` along `camera`'s view, as `renderer` draws. */
function pixelSpan(
  renderer: WebGLRenderer,
  camera: Camera,
  distance: number,
): number {
  const rows = renderer.getDrawingBufferSize(drawingBuffer).y;
  if (rows <= 0) return 0;
  const perspective = camera as PerspectiveCamera;
  if (perspective.isPerspectiveCamera)
    return (
      (distance * 2 * Math.tan(MathUtils.degToRad(perspective.fov) / 2)) /
      perspective.zoom /
      rows
    );
  const orthographic = camera as OrthographicCamera;
  if (orthographic.isOrthographicCamera)
    return (orthographic.top - orthographic.bottom) / orthographic.zoom / rows;
  return 0;
}

/** Default strength of the shore foam, and the fraction of it lost at distance. */
const DEFAULT_WATER_SHORE_FOAM_STRENGTH = 0.65;
const DEFAULT_WATER_SHORE_FOAM_FADE = 0.3;

export type WaterMaterialParameters = ShaderMaterialParameters & {
  /**
   * How much of the sea's waves it draws ({@link WaterQuality}). Default `'medium'`.
   * ⚠️ Read at construction: another quality is another material.
   */
  quality?: WaterQuality;
  /** @deprecated the waves are a sea state's layers (`quality`); ignored */
  waveCount?: number;
  /** octaves of the shore's ragged edge noise. Default 4 */
  detailOctaves?: number;
  contactCount?: number;
  /**
   * Cut this material with a plane in OBJECT space (`dot(xyz, position) + w > 0`
   * is discarded) — a `ZoneStack`'s section, so the sea is cut with the block
   * under it. Omit for none, which compiles the branch out.
   *
   * ⭐ A SHARED uniform object: pass the stack's own and one write per frame
   * reaches this material, the volume material and every zone material, in all
   * four OIT passes. ⚠️ Read at CONSTRUCTION (it sets a define), so turning the
   * cut on or off means a new material; moving the plane does not.
   */
  sectionPlane?: IUniform<Vector4>;
  /**
   * Cut this material with a **fence** instead — the same shared uniforms the
   * zone materials read, so the sea is cut on exactly the curve the block is.
   * Omit for none, which compiles the branch out.
   *
   * ⭐ Read PER FRAGMENT, so a lid of a handful of triangles is cut at the
   * resolution of the curve rather than of its own tessellation.
   *
   * ⚠️ Read at CONSTRUCTION, like `sectionPlane`.
   */
  fence?: FenceFieldUniforms;
  /**
   * The sea bed's depth grid, which makes the water shoal: clearer and paler
   * where the bed is close to the surface, its full body colour where it is not.
   *
   * ⭐ Without it the shader has NO depth input and falls back to the view angle
   * as a stand-in — which cannot tell a metre of water over a bank from the open
   * sea. ⚠️ Read at CONSTRUCTION (it sets a define); the level and the shoal
   * scale are live uniforms.
   */
  bathymetry?: WaterBathymetry;
};

/**
 * An oriented footprint of a floating object resting on the ocean surface, used
 * to spread contact foam around it. All values are in the ocean's local frame
 * (sea level = local y 0).
 */
export type WaterContact = {
  /** Footprint centre X (local). */
  x: number;
  /** Footprint centre Z (local). */
  z: number;
  /** Heading in radians (rotation about +Y). */
  heading: number;
  /** Half-extent along the heading (e.g. half the hull length). */
  halfLength: number;
  /** Half-extent across the heading (e.g. half the beam). */
  halfWidth: number;
  /** Width (m) of the foam band straddling the footprint edge. */
  foamWidth: number;
  /**
   * Foam strength multiplier (0 = none, 1 = full). Contact foam is independent
   * of the wind-driven `foamAmount`, so this controls how much foam the object
   * generates. Default `1`.
   */
  intensity?: number;
  /**
   * How much the foam is reduced toward the bow/stern (the forward axis), 0..1.
   * 0 = an even collar all around; 1 = foam only along the sides (where a hull
   * pushes the most water). Default `0`.
   */
  endFalloff?: number;
  /**
   * The frame `x`, `z` and `heading` are in, when it is not the sea's (an object placed on a
   * globe, `Wgs84Position`): under a `Scenery` the footprint is taken from it into the plane
   * the sea's contact foam is drawn in. Default the sea's own frame.
   */
  frame?: Object3D | null;
};

/**
 * Default deep-water colour, seen looking straight down.
 *
 * @group Components
 */
export const DEFAULT_WATER_DEEP_COLOR = '#0a2540';

/**
 * Default base water opacity looking straight down (see
 * `WaterSettings.waterOpacity`).
 *
 * @group Components
 */
export const DEFAULT_WATER_OPACITY = 0.7;

/**
 * Default wind speed over the water, m/s (see `WaterSettings.windSpeed`): a moderate breeze,
 * the waves some 0.9 m high.
 *
 * @group Components
 */
export const DEFAULT_WATER_WIND_SPEED = 6.5;

/**
 * The uniforms the sea's layers are read with (`shaders/sea-layers.glsl`, and the detail
 * octave in `shaders/water-surface.glsl`: the finest layer's tile read again, smaller). A
 * material displaced with the surface (the water body's walls) points these at the same
 * uniform objects.
 */
export const SEA_LAYER_UNIFORMS = [
  'uSeaSurface0',
  'uSeaSurface1',
  'uSeaSurface2',
  'uSeaSurface3',
  'uSeaLayers',
  'uSeaLayerStats',
  'uSeaResidual',
  'uSeaDetailLayer',
  'uSeaDetail',
  'uSeaHex',
  'uSeaBreakDepth',
  'uSeaDeepDepth',
] as const;

/**
 * ⚠️ Tuning, to be settled and then removed: the wave model's open choices, to compare by eye
 * (`WaterMaterial.waveTuning`, the `waveTuning` prop). Each left out is as drawn by default.
 */
export type WaterWaveTuning = {
  /** the least spreading exponent of the short waves (`SeaSpectrumInput.spreadFloor`), 1 */
  spreadFloor?: number;
  /** the wind sea's waves above this many times its peak frequency fade out, none */
  tail?: number;
  /** the ripples' (the detail octave's) strength, 1; what is left out roughens the glint */
  ripples?: number;
  /** the layers read hex-tiled, true; false reads one plain copy (repeats) */
  hex?: boolean;
  /** the hex cells' blend sharpened by this power, 1 */
  hexSharpness?: number;
  /**
   * how much rougher water (a gust's) turns the reflection up the sky and hides more of it
   * toward grazing, and smoother (a lull's, a slick's) mirrors the horizon; 1
   */
  roughReflect?: number;
};

/**
 * ⚠️ Tuning, to be settled and then removed: the foam's shaping, to compare by eye
 * (`WaterMaterial.foamTuning`, the `foamTuning` prop). Each left out is as drawn by default.
 */
export type WaterFoamTuning = {
  /** the finer waves' share in the crests the foam is cut from, ×; 0.8 */
  breakup?: number;
  /** the rim's width up close, in the crests' [0, 1]; 0.1 */
  edge?: number;
  /** how much the ripples dim the foam's inside; 0.45 */
  froth?: number;
  /** where thin foam turns opaque, up close; 0.6 */
  falloff?: number;
  /**
   * the share of the foam lost once below a pixel; 0 (its mean drawn, the far sea paling as
   * the wind rises; 0.85 until 2026-11-16, which left far whitecaps all but gone)
   */
  farFade?: number;
  /** the most foam covers; 1 */
  opacity?: number;
  /** how much the foam is lit by the wave under it (the sky toward its normal, the sun); 1 */
  lit?: number;
  /** a brighter rim; 0.5 */
  lift?: number;
  /** the grain's strength, smooth noise roughening the rim and speckling thin foam; 0.45 */
  grain?: number;
  /** the grain's cell, metres; 0.06 */
  grainScale?: number;
  /** how narrow the foam is drawn toward the crest lines (long along, thin across); 1 */
  narrow?: number;
  /**
   * ⚠️ Debug: a view in place of the surface. `whitecaps`: grey by the crests' height, red where
   * foam forms, blue on the crests' backs (where it trails), amber on their fronts. `crests`:
   * the crests' height as a ramp, the foam's threshold for the wind as a white line. `wind`:
   * the local wind over the mean (blue a lull, red a gust), green where a slick lies.
   */
  debug?: WaterDebugView;
};

/** ⚠️ Debug views of the sea ({@link WaterFoamTuning.debug}). */
export const WATER_DEBUG_VIEWS = [
  'none',
  'whitecaps',
  'crests',
  'wind',
] as const;
export type WaterDebugView = (typeof WATER_DEBUG_VIEWS)[number];

// [breakup, edge, froth, falloff], [farFade, opacity, lit, lift] and [grain, grainScale,
// narrow] as drawn by default (dialled in on the sea bench, 2026-11-13).
const WATER_FOAM_SHAPE_DEFAULT = [0.8, 0.1, 0.45, 0.6] as const;
const WATER_FOAM_LOOK_DEFAULT = [0, 1, 1, 0.5] as const;
const WATER_FOAM_GRAIN_DEFAULT = [0.45, 0.06, 1] as const;

/**
 * The uniforms `shaders/water-surface.glsl` reads, wave tables included. Another
 * material that includes it shares an {@link WaterMaterial}'s water by pointing
 * these entries at the same uniform objects.
 */
export const WATER_SURFACE_UNIFORMS = [
  'uTime',
  'uWaterDetailOctaves',
  'uWindDirection',
  'uWindSpeed',
  'uSignificantHeight',
  'uSteepness',
  'uReflectionIntensity',
  'uSunDirection',
  'uSunColor',
  'uSunShininess',
  'uSunGlintSpread',
  'uSparkle',
  'uCrestLight',
  'uFoamLife',
  'uFoamLifeArea',
  'uFoamColor',
  'uFoamAmount',
  'uFoamShape',
  'uFoamLook',
  'uFoamGrain',
  'uFresnelPower',
  'uDetailScale',
  'uDetailFade',
  'uWeatherGusts',
  'uWeatherGustTravel',
  'uWeatherGustRough',
  'uRoughReflect',
  ...SEA_LAYER_UNIFORMS,
  'uShore',
  'uShoreNoise',
  'uShoreFade',
  'uContactCount',
  'uContactA',
  'uContactB',
  'uContactC',
] as const;

/**
 * Stylized, OIT-compatible ocean surface material.
 *
 * Its waves are a {@link SeaState}'s: the spectrum the wind (m/s, U10) and swells ask for
 * (North Sea JONSWAP, so U = 10 m/s gives Hs ≈ 2.1 m and a peak wavelength ≈ 88 m), drawn as
 * a few hundred waves on each of a few layers' fixed grids. A new wind eases the sea toward
 * its spectrum over a minute or two rather than rewriting it. Each frame
 * {@link WaterMaterial.renderWaves} bakes the layers into tiling textures (`SeaWaveBake`),
 * which the surface reads hex-tiled, so they never repeat, and filtered to the pixel, what the
 * filtering leaves out roughening the sun's glint. Floating objects ride
 * {@link WaterMaterial.seaState}'s heights, the same waves.
 *
 * Everything is evaluated in world X/Z so patched geometry is seamless. The material is wired
 * for the OITRenderPass via {@link attachOitVariants}; because its OIT variants share this
 * material's `uniforms` object by reference, animated uniforms (time, wind, colours, the
 * layers) stay live through every transparency pass.
 */
/** The most layers a sea draws (`WATER_QUALITY`): the uniforms for them are always there. */
const WATER_MAX_SEA_LAYERS = 4;
// Its sun where neither it nor its scene's sky has one.
const WATER_SUN_DIRECTION = new Vector3(-0.3, 0.8, -0.5).normalize();
const WATER_SUN_COLOR = new Color('#fff6e0');

/**
 * How much of the sun's glitter each quality draws by default ({@link WaterMaterial.sparkle}):
 * none on low and medium, where its cost (about 5 % of the sea) is not spent unasked.
 */
export const WATER_SPARKLE_DEFAULT: Record<WaterQuality, number> = {
  low: 0,
  medium: 0,
  high: 1,
  ultra: 1,
};

/**
 * Whether each quality draws the whitecaps' life by default ({@link WaterMaterial.foamLife}):
 * from high up, where its pass (the waves read over a square about the camera) is spent.
 */
export const WATER_FOAM_LIFE_DEFAULT: Record<WaterQuality, boolean> = {
  low: false,
  medium: false,
  high: true,
  ultra: true,
};

/**
 * What each quality leaves out of the surface's shading, compiled out. `low`: the weather's
 * gusts and slicks (an even roughness, the mean's: {@link WaterMaterial.gusts} is not drawn),
 * the light through the crests ({@link WaterMaterial.crestLight}) and, in a `Scenery`'s sea,
 * the sky's twilight and the sun's halo in its reflection (the sky's gradient alone, in the
 * daylight where the camera is).
 */
export const WATER_QUALITY_DEFINES: Record<WaterQuality, readonly string[]> = {
  low: ['WATER_NO_GUSTS', 'WATER_NO_CREST_LIGHT', 'WATER_PLAIN_SKY'],
  medium: [],
  high: [],
  ultra: [],
};

/**
 * The share of the sea whitecaps cover for a wind (m/s, U10) and `foamAmount` (0.5 as measured
 * at sea): Monahan and O'Muircheartaigh 1980, 3.84e-6·U^3.41, about 1 % at 10 m/s and 10 % at
 * 20 m/s, at most half. The twin of `waterWhitecapCover` in `water-surface.glsl`, but for the
 * surf zone's breaking limit.
 */
export function waterWhitecapCover(windSpeed: number, foamAmount: number) {
  return Math.min(
    3.84e-6 * Math.max(windSpeed, 0) ** 3.41 * 2 * foamAmount,
    0.5,
  );
}

/**
 * The defines the surface's shading compiles with besides its waves: its quality's
 * (`WATER_QUALITY_DEFINES`) and its options' (`sparkle`, `fresnelPower`, `foamLife`). A
 * material drawing an {@link WaterMaterial}'s water takes them over (a `Scenery`'s sea:
 * `SceneryMaterial.linkWater`), in this order.
 */
export const WATER_SHADING_DEFINES = [
  'WATER_SPARKLE',
  'WATER_FRESNEL_POWER',
  'WATER_FOAM_LIFE',
  'WATER_NO_GUSTS',
  'WATER_NO_CREST_LIGHT',
  'WATER_PLAIN_SKY',
] as const;
// The defines the scene's sky sets (setSky).
const WATER_SKY_DEFINES = [
  'WATER_SKY_ENV',
  'ENVMAP_TYPE_CUBE_UV',
  'CUBEUV_TEXEL_WIDTH',
  'CUBEUV_TEXEL_HEIGHT',
  'CUBEUV_MAX_MIP',
  'WATER_SKY_CLOUDS',
] as const;
// The local winds over the mean the short waves' answer is worked out at (uWeatherGustRough):
// linear between, none at 0, 1 at the mean.
const WATER_GUST_FACTORS = [0.25, 0.5, 1.5, 2] as const;

export class WaterMaterial extends ShaderMaterial {
  isWaterMaterial = true;

  /** how much of the sea's waves it draws */
  readonly quality: WaterQuality;
  /**
   * the water under the surface, as what lies in it reads it: its level, its seabed's depth,
   * its look ({@link WaterMaterial.optics}). Bound into this material's uniforms, and handed
   * down by the sea that draws it, so its seabed, its walls and the data in it fade alike.
   */
  readonly water = new WaterBody();
  /**
   * Whether its water is also the scene's (`sceneWaterBody`), for what reads that: an
   * `Water`'s is. A `ZoneStack`'s is its own, handed to its zones, so a `Scenery`'s sea about
   * it keeps the scene's. Default true
   */
  sharesSceneWater = true;
  /**
   * Whether a cut has taken the water where the camera is (world position): it is in air
   * there, over the footprint or not. A `ZoneStack` sets it for a section or a fence that
   * takes its sea. Default none
   */
  cameraCut: ((position: Vector3) => boolean) | null = null;
  /**
   * The seabed's height (world Y) under the camera's world position, or null where none is
   * known there: under it, the camera is in the ground, not in the water. Asked only while the
   * camera is over the water, under its level and over its deepest. A `Water` with a bed
   * casts a ray against it. Default none (the water ends at its {@link WaterBody.depth})
   */
  cameraFloor: ((position: Vector3) => number | null) | null = null;

  private _waveHeightScale!: number;
  private _directionalSpread!: number;
  private _swells: SeaSwell[] = [];
  private _waveTuning: WaterWaveTuning = {};
  private _foamTuning: WaterFoamTuning = {};
  private _gusts: WeatherGusts | null = null;
  private _optics!: Required<WaterOptics>;
  private _contactCount!: number;
  // Its own sea, and the weather's it draws instead while given one (`sea`).
  private readonly _ownState: SeaState;
  private readonly _ownBake: SeaWaveBake;
  private _sea: WeatherSea | null = null;
  // Whether the layers' uniforms hold the weather's sea's tiles, and whose tiles they hold.
  private _drawsShared = false;
  private _layerBake: SeaWaveBake | null = null;
  // The weather's sea's input the ratios below were worked out for.
  private _seaRevision = -1;
  // Whether the clock has run: until it does, a new wind is the sea's at once (settled).
  private _running = false;
  // The sea state's input last set, to set it only as it changes.
  private _inputKey = '';
  // Whether its sun is its own (set) rather than its scene's sky's (updateSky).
  private _ownSunDirection = false;
  private _ownSunColor = false;
  private _ownGlintSpread = false;
  // What the sky's defines were last set for (setSky).
  private _skyKey = '';
  // The whitecaps' life (foamLife), made as it is first run, and the seconds the clock has run
  // since it last was.
  private _foamLife: SeaFoamLife | null = null;
  private _foamSeconds = 0;

  constructor(parameters: WaterMaterialParameters = {}) {
    const {
      quality = 'medium',
      // Deprecated: the waves are the sea state's layers.
      waveCount: _waveCount,
      detailOctaves = 4,
      contactCount = 8,
      sectionPlane,
      fence,
      bathymetry,
      ...rest
    } = parameters;

    // The sea and its layers' textures, before `this` is there to hold them.
    const spec = WATER_QUALITY[quality] ?? WATER_QUALITY.medium;
    const sea = new SeaState(
      { windSpeed: DEFAULT_WATER_WIND_SPEED, windDirection: [1, 0] },
      { layers: spec.layers, detail: spec.detail },
    );
    const bake = new SeaWaveBake(sea.layers, spec.anisotropy);
    const layerUniforms: Record<string, IUniform> = {};
    for (let i = 0; i < WATER_MAX_SEA_LAYERS; i++)
      layerUniforms[`uSeaSurface${i}`] = new Uniform<Texture | null>(
        bake.layers[i]?.surface ?? null,
      );

    // Preallocated contact-footprint tables (filled by setContacts()).
    const contactA: Vector4[] = [];
    const contactB: Vector4[] = [];
    const contactC: Vector4[] = [];
    for (let i = 0; i < contactCount; i++) {
      contactA.push(new Vector4());
      contactB.push(new Vector4());
      contactC.push(new Vector4());
    }

    super({
      vertexShader,
      fragmentShader,
      transparent: true,
      // Visible from below too, so the surface still reads when the camera is
      // underwater / inside the ocean box.
      side: DoubleSide,
      defines: {
        SEA_LAYERS: sea.layers.length,
        ...(sea.detail ? { SEA_DETAIL: '' } : {}),
        // The layers filtered along a pixel's footprint, at most this much (anisotropy).
        ...((spec.anisotropy ?? 1) > 1
          ? { SEA_ANISO: spec.anisotropy!.toFixed(1) }
          : {}),
        // The sun's glitter, where it is drawn (sparkle).
        ...(WATER_SPARKLE_DEFAULT[quality] > 0 ? { WATER_SPARKLE: '' } : {}),
        // The whitecaps' life, where it is drawn (foamLife).
        ...(WATER_FOAM_LIFE_DEFAULT[quality] ? { WATER_FOAM_LIFE: '' } : {}),
        // What the quality leaves out.
        ...Object.fromEntries(
          (WATER_QUALITY_DEFINES[quality] ?? []).map(name => [name, '']),
        ),
        WATER_CONTACT_COUNT: contactCount,
        ...(sectionPlane ? { WATER_SECTION: '' } : {}),
        ...(fence ? { WATER_FENCE: '' } : {}),
        ...(bathymetry ? { WATER_BATHYMETRY: '' } : {}),
      },
      uniforms: {
        // ⚠⚠ `fog = true` makes three refresh fogColor/fogDensity/fogNear/fogFar on
        // THIS material, and a hand-built uniform block has none of them — which
        // throws inside the renderer rather than just failing to fog. A material
        // merging a `ShaderLib` entry gets these for free; this one does not.
        ...UniformsUtils.clone(UniformsLib.fog),
        uTime: new Uniform(0),
        uWaterDetailOctaves: new Uniform(detailOctaves),
        uWindDirection: new Uniform(new Vector2(1, 0).normalize()),
        uWindSpeed: new Uniform(DEFAULT_WATER_WIND_SPEED),
        uSteepness: new Uniform(1),
        uDisplacement: new Uniform(0),

        // The sea's layers (sea-layers.glsl), and its significant wave height.
        ...layerUniforms,
        uSeaLayers: new Uniform(
          sea.layers.map(
            layer =>
              new Vector4(
                1 / layer.size,
                Math.cos(layer.angle),
                Math.sin(layer.angle),
                layer.texels,
              ),
          ),
        ),
        uSeaLayerStats: new Uniform(sea.layers.map(() => new Vector2())),
        uSeaResidual: new Uniform(0),
        uSeaDetailLayer: new Uniform(
          sea.detail
            ? new Vector4(
                1 / sea.detail.size,
                Math.cos(sea.detail.angle),
                Math.sin(sea.detail.angle),
                sea.detail.texels,
              )
            : new Vector4(1, 1, 0, 1),
        ),
        uSeaDetail: new Uniform(new Vector3()),
        uSeaHex: new Uniform(new Vector2(1, 1)),
        uSignificantHeight: new Uniform(1),
        // The depth waves break at, × their height (sea-shallow.ts): the waves are cut to it
        // as the water shallows, and the surf stands where they are.
        uSeaBreakDepth: new Uniform(SEA_BREAK_DEPTH),
        // Deeper, the bottom changes no layer's waves (seaDeepDepth): set as they change.
        uSeaDeepDepth: new Uniform(0),
        // The surf (water-surface.glsl's waterShoreFoam): x how much, y its zone's width ×,
        // z the swash, w the step a bathymetry grid's slope is taken over (m).
        uShore: new Uniform(new Vector4(0, 1, 1, 0)),
        // x its landward edge's raggedness (m), y that's frequency (1 / m).
        uShoreNoise: new Uniform(
          new Vector2(0, 1 / DEFAULT_WATER_SHORE_NOISE_SCALE),
        ),
        // x how white it is drawn, y the share of that lost once below a pixel.
        uShoreFade: new Uniform(
          new Vector2(
            DEFAULT_WATER_SHORE_FOAM_STRENGTH,
            DEFAULT_WATER_SHORE_FOAM_FADE,
          ),
        ),

        // Deprecated (no longer drawn): kept so their accessors still answer.
        uTonalVariation: new Uniform(0.4),
        // Stored as cycles per meter; the public `tonalScale` property exposes
        // it as a patch size in kilometers (default ~4 km => 1 / 4000).
        uTonalScale: new Uniform(1 / 4000),
        uTonalSharpness: new Uniform(0.5),
        uTonalColor: new Uniform(new Color('#cfe3f2')),

        uSkyColor: new Uniform(new Color('#7fb2e6')),
        uHorizonColor: new Uniform(new Color('#cfe3f2')),
        uReflectionIntensity: new Uniform(1),
        // The scene's sky (setSky): its environment, prefiltered, and the clouds over it.
        uSkyEnv: new Uniform<Texture | null>(null),
        uSkyEnvIntensity: new Uniform(1),
        uSkyEnvRotation: new Uniform(new Matrix3()),
        uSkyClouds: new Uniform<CubeTexture | null>(null),
        uSkyCloudBase: new Uniform(0),

        uSunDirection: new Uniform(WATER_SUN_DIRECTION.clone()),
        uSunColor: new Uniform(WATER_SUN_COLOR.clone()),
        uSunShininess: new Uniform(200),
        uSunGlintSpread: new Uniform(0),
        uSparkle: new Uniform(WATER_SPARKLE_DEFAULT[quality] ?? 0),
        // Light through the crests (crestLight), as modelled.
        uCrestLight: new Uniform(1),
        // The foam's life (foamLife, SeaFoamLife): its square and where it lies.
        uFoamLife: new Uniform<Texture | null>(null),
        uFoamLifeArea: new Uniform(new Vector4(0, 0, 1, 0)),

        uFoamColor: new Uniform(new Color('#ffffff')),
        uFoamAmount: new Uniform(0.5),
        // ⚠️ Tuning (foamTuning), as drawn by default.
        uFoamShape: new Uniform(new Vector4(...WATER_FOAM_SHAPE_DEFAULT)),
        uFoamLook: new Uniform(new Vector4(...WATER_FOAM_LOOK_DEFAULT)),
        uFoamGrain: new Uniform(new Vector4(...WATER_FOAM_GRAIN_DEFAULT, 0)),

        // Floating-object contact-foam footprints (filled by setContacts()).
        uContactCount: new Uniform(0),
        uContactA: new Uniform(contactA),
        uContactB: new Uniform(contactB),
        uContactC: new Uniform(contactC),

        uFresnelPower: new Uniform(4),
        uDetailScale: new Uniform(0.05),
        // Deprecated (no longer drawn).
        uDetailStrength: new Uniform(0.2),
        uDetailFade: new Uniform(new Vector2(15000, 60000)),

        // The weather's gusts and slicks (updateGusts), none until given a wind.
        uWeatherGusts: new Uniform(new Vector4()),
        uWeatherGustTravel: new Uniform(new Vector2()),
        uWeatherGustRough: new Uniform(new Vector4(1, 1, 1, 1)),
        // ⚠️ Tuning (waveTuning.roughReflect).
        uRoughReflect: new Uniform(1),

        uMasterOpacity: new Uniform(1),
      },
    });

    this._ownState = sea;
    this._ownBake = bake;
    this._layerBake = bake;
    this.quality = quality;
    this.water.bind(this.uniforms);
    this.optics = waterOpticsOf();
    this._waveHeightScale = 1;
    this._directionalSpread = 1.2;
    this._contactCount = contactCount;

    if (Object.keys(rest).length) this.setValues(rest);

    if (sectionPlane) this.uniforms.sectionPlane = sectionPlane;

    if (fence) applyFenceField(this.uniforms, fence);

    if (bathymetry) {
      const image = bathymetry.texture.image as {
        width: number;
        height: number;
      };
      this.uniforms.uBathyMap = new Uniform(bathymetry.texture);
      this.uniforms.uBathyToUv = new Uniform(bathymetry.toUv);
      this.uniforms.uBathySize = new Uniform(
        new Vector2(image.width, image.height),
      );
      this.bathymetryLevel = 0;
      // The step the grid's slope is taken over (uShore.w): two of its cells.
      (this.uniforms.uShore.value as Vector4).w = 2 * bathymetry.cellSize;
    }

    this.updateWaves();

    // Looking up at the surface from inside the water body, there IS water in the
    // way. ⚠️ A ShaderMaterial's `fog` defaults to false, so the shader's fog
    // zones would compile to nothing without this.
    this.fog = true;

    attachOitVariants(this);
  }

  /** the sea's waves, which floating objects ride (`SeaState.heightAt`): the weather's while it draws that ({@link WaterMaterial.sea}), else its own */
  get seaState(): SeaState {
    return this._sea?.state(this.quality) ?? this._ownState;
  }

  /** the sea's layers as textures, baked each frame by {@link WaterMaterial.renderWaves} */
  get waveBake(): SeaWaveBake {
    return this._sea?.bakeOf(this.quality) ?? this._ownBake;
  }

  /**
   * The weather's sea (`WeatherSea`, `useWeatherSea`) to draw instead of its own, or null for
   * its own: all the seas under a weather that take its wind and swells draw one sea, on its
   * clock, baked once a frame. Its own wind, swells and wave height are then not the sea's:
   * set while it draws its own. One without a wind leaves it its own.
   */
  get sea(): WeatherSea | null {
    return this._sea;
  }
  set sea(value: WeatherSea | null) {
    if (value === this._sea) return;
    this._sea = value;
    this.syncSea();
  }

  // Point the layers' uniforms at the tiles of the sea it draws, as that changes: another
  // `sea`, or the weather's gaining or losing its wind.
  private syncSea(): void {
    const shared = this._sea?.active ?? false;
    const bake = this.waveBake;
    if (shared === this._drawsShared && this._layerBake === bake) return;
    this._drawsShared = shared;
    this._layerBake = bake;
    this._seaRevision = -1;
    for (let i = 0; i < WATER_MAX_SEA_LAYERS; i++)
      this.uniforms[`uSeaSurface${i}`].value = bake.layers[i]?.surface ?? null;
    if (shared) this.updateSeaRatios();
    else {
      // Back to its own: from its own input, as it stands now.
      this._inputKey = '';
      this.updateWaves(true);
    }
  }

  /**
   * The sea state's input from the wind, the swells and the height scale: eased toward as the
   * clock runs, or the sea's at once while it has not run yet. Cheap enough per change, but
   * not per frame (some milliseconds). Drawing the weather's sea, only the gusts.
   */
  private updateWaves(resettle = false): void {
    this.updateGusts();
    if (this._drawsShared) return;
    const direction = this.uniforms.uWindDirection.value as Vector2;
    const input = {
      windSpeed: this.uniforms.uWindSpeed.value as number,
      windDirection: [direction.x, direction.y] as [number, number],
      swells: this._swells,
      heightScale: this._waveHeightScale,
      spreadFloor: this._waveTuning.spreadFloor,
      tail: this._waveTuning.tail,
    };
    // Props are often new objects each render, with the same values.
    const key = JSON.stringify(input);
    if (key === this._inputKey) return;
    this._inputKey = key;
    this._ownState.setInput(input);
    if (!this._running || resettle) this._ownState.settle();
    this.updateSeaRatios();
  }

  // What the surface takes of the sea state's input: the height it is drawn for, and how the
  // short waves answer the gusts.
  private updateSeaRatios(): void {
    const sea = this.seaState;
    this.uniforms.uSignificantHeight.value = sea.stats().targetHeight;
    // From the finest layer's band up on medium and finer (it answers by half, the ripples
    // and what no layer draws in full), else from what no layer draws.
    const layers = sea.layers;
    const kMin =
      layers.length > 3 ? layers[3].kMin : layers[layers.length - 1].kMax;
    (this.uniforms.uWeatherGustRough.value as Vector4).fromArray(
      sea.shortWaveRatios(WATER_GUST_FACTORS, kMin),
    );
  }

  // The gust field for the wind and the gusts given (weatherGustsOf).
  private updateGusts(): void {
    const field = weatherGustsOf(
      this.uniforms.uWindSpeed.value as number,
      this._gusts,
    );
    (this.uniforms.uWeatherGusts.value as Vector4).set(
      Math.max(field.strength, 0),
      Math.max(field.scale, 1),
      Math.min(Math.max(field.slicks, 0), 1),
      Math.max(field.slickScale, 1),
    );
    (this.uniforms.uWeatherGustTravel.value as Vector2).y = field.seed;
  }

  /**
   * The weather's gusts and slicks over the sea ({@link WeatherGusts}): the short waves
   * roughen in a gust and calm in a lull and a slick. `null`, as the wind gives them; with
   * `strength` and `slicks` 0, none. Not drawn at `low` quality (`WATER_QUALITY_DEFINES`).
   */
  get gusts(): WeatherGusts | null {
    return this._gusts;
  }
  set gusts(value: WeatherGusts | null) {
    this._gusts = value ? { ...value } : null;
    this.updateGusts();
  }

  /**
   * The sea's clock, seconds. Run on (a step under an hour) it eases the sea toward its
   * input; set back or far on, the waves just move to it. Drawing the weather's sea
   * ({@link WaterMaterial.sea}), only its foam and gusts run on it: setting it moves that sea
   * to the weather's time (`WeatherSea.advance`), whose waves follow that clock alone.
   */
  get time(): number {
    return this.uniforms.uTime.value;
  }
  set time(value: number) {
    const dt = value - (this.uniforms.uTime.value as number);
    this.uniforms.uTime.value = value;
    // The gusts run with the mean wind.
    const travel = this.uniforms.uWeatherGustTravel.value as Vector2;
    const speed = this.uniforms.uWindSpeed.value as number;
    const run = dt > 0 && dt < 3600;
    if (run) travel.x += speed * dt;
    else travel.x = speed * value;
    // The foam's life runs as the clock does; a jump starts it over.
    if (run) this._foamSeconds += dt;
    else if (dt !== 0) this._foamLife?.reset();
    this.syncSea();
    if (this._drawsShared) {
      this._sea!.advance();
      return;
    }
    if (run) {
      this._ownState.update(dt);
      this._running = true;
    } else this._ownState.time = value;
  }

  /**
   * Run its clock a frame, on by `seconds` (the weather's steps, `useWeatherStep`): its own
   * time stays small for the shaders' single precision. Drawing the weather's sea
   * ({@link WaterMaterial.sea}), that sea is moved to the weather's time as well, in double
   * precision on the CPU: its waves follow that clock alone.
   */
  step(seconds: number): void {
    this.time = this.time + seconds;
  }

  /**
   * Bake the sea's layers as they are now into their textures, for this frame: call once a
   * frame, after the clock has run, before the surface is drawn (and before any material
   * sharing its uniforms is, a `Scenery`'s).
   *
   * Given the `camera` and its `distance` to the nearest of the sea (its height over it, the
   * nearest a pixel is finest), a layer whose whole tile a pixel there spans (with a margin,
   * `SEA_BAKE_PIXEL_MARGIN`) is left as it was: the surface reads none of it, only its
   * variance. From high up that is all but the longest layers, or all of them.
   *
   * With the whitecaps' life on ({@link foamLife}), `at`, the camera's point in the wave plane
   * (the plane the surface reads its waves in: world X/Z for a `Water`, the camera's chart for
   * a `Scenery`), runs it a step about there, ahead of it the way it looks (`ahead`, in the wave
   * plane, as long as the look is level: `SeaFoamStep.ahead`); without it (or a camera) it is
   * not drawn.
   */
  renderWaves(
    renderer: WebGLRenderer,
    camera?: Camera,
    distance?: number,
    at?: { x: number; y: number } | null,
    ahead?: { x: number; y: number } | null,
  ): void {
    const pixel =
      camera && distance !== undefined
        ? pixelSpan(renderer, camera, Math.abs(distance)) *
          SEA_BAKE_PIXEL_MARGIN
        : 0;
    this.syncSea();
    const layers = this.seaState.layers;
    const drawn = pixel > 0 ? (i: number) => layers[i].size > pixel : undefined;
    const shared = this._drawsShared ? this._sea : null;
    if (shared) {
      // Baked once a frame for every sea drawing it; its input is the weather's.
      shared.bake(renderer, this.quality, drawn);
      if (this._seaRevision !== shared.revision) {
        this._seaRevision = shared.revision;
        this.updateSeaRatios();
      }
    } else this._ownBake.update(renderer, this._ownState.layerTables(), drawn);
    const stats = this.seaState.stats();
    const ripples = Math.max(this._waveTuning.ripples ?? 1, 0);
    const layerStats = this.uniforms.uSeaLayerStats.value as Vector2[];
    stats.layers.forEach((layer, i) =>
      layerStats[i].set(layer.slopeVariance, layer.variance),
    );
    this.uniforms.uSeaDeepDepth.value = seaDeepDepth(
      stats.layers,
      this.uniforms.uSeaBreakDepth.value,
    );
    this.uniforms.uSeaResidual.value =
      stats.residualSlopeVariance +
      (1 - ripples * ripples) * stats.detail.slopeVariance;
    (this.uniforms.uSeaDetail.value as Vector3).set(
      stats.detail.gain * ripples,
      stats.detail.offset[0],
      stats.detail.offset[1],
    );
    this.runFoamLife(renderer, camera, distance, at, ahead);
  }

  // A step of the whitecaps' life about `at`, after the waves it reads are baked.
  private runFoamLife(
    renderer: WebGLRenderer,
    camera: Camera | undefined,
    distance: number | undefined,
    at: { x: number; y: number } | null | undefined,
    ahead: { x: number; y: number } | null | undefined,
  ): void {
    if (!this.foamLife) return;
    this._foamLife ??= new SeaFoamLife(this.uniforms, this.defines);
    const seconds = this._foamSeconds;
    this._foamSeconds = 0;
    if (!camera || !at || distance === undefined) {
      this._foamLife.hide();
      return;
    }
    this._foamLife.update(renderer, {
      at,
      ahead,
      height: Math.abs(distance),
      seconds,
      windSpeed: this.uniforms.uWindSpeed.value as number,
      windDirection: this.uniforms.uWindDirection.value as Vector2,
    });
  }

  /**
   * Whether the whitecaps live on: the foam a breaking crest leaves trailing behind it, drifting
   * downwind and fading, the old foam gathered by the wind into streaks, in a square about the
   * camera run a step each frame ({@link renderWaves}, `SeaFoamLife`). A pass reading the waves
   * over 512² texels, so null takes its quality's ({@link WATER_FOAM_LIFE_DEFAULT}: high and
   * ultra). Turning it on or off compiles it again.
   */
  get foamLife(): boolean {
    return 'WATER_FOAM_LIFE' in this.defines;
  }
  set foamLife(value: boolean | null) {
    const on = value ?? WATER_FOAM_LIFE_DEFAULT[this.quality] ?? false;
    if (on === this.foamLife) return;
    if (on) this.defines.WATER_FOAM_LIFE = '';
    else {
      delete this.defines.WATER_FOAM_LIFE;
      this._foamLife?.dispose();
      this._foamLife = null;
    }
    this.needsUpdate = true;
  }

  /**
   * ⚠️ Tuning, to be settled and then removed: the wave model's open choices, to compare by
   * eye ({@link WaterWaveTuning}).
   */
  get waveTuning(): WaterWaveTuning {
    return this._waveTuning;
  }
  set waveTuning(value: WaterWaveTuning) {
    this._waveTuning = { ...value };
    const hex = this.uniforms.uSeaHex.value as Vector2;
    hex.set(value.hex === false ? 0 : 1, value.hexSharpness ?? 1);
    this.uniforms.uRoughReflect.value = value.roughReflect ?? 1;
    this.updateWaves(true);
  }

  /**
   * ⚠️ Tuning, to be settled and then removed: the foam's shaping, to compare by eye
   * ({@link WaterFoamTuning}).
   */
  get foamTuning(): WaterFoamTuning {
    return this._foamTuning;
  }
  set foamTuning(value: WaterFoamTuning) {
    this._foamTuning = { ...value };
    const [breakup, edge, froth, falloff] = WATER_FOAM_SHAPE_DEFAULT;
    const [farFade, opacity, lit, lift] = WATER_FOAM_LOOK_DEFAULT;
    (this.uniforms.uFoamShape.value as Vector4).set(
      value.breakup ?? breakup,
      value.edge ?? edge,
      value.froth ?? froth,
      value.falloff ?? falloff,
    );
    (this.uniforms.uFoamLook.value as Vector4).set(
      value.farFade ?? farFade,
      value.opacity ?? opacity,
      value.lit ?? lit,
      value.lift ?? lift,
    );
    const [grain, grainScale, narrow] = WATER_FOAM_GRAIN_DEFAULT;
    (this.uniforms.uFoamGrain.value as Vector4).set(
      value.grain ?? grain,
      value.grainScale ?? grainScale,
      value.narrow ?? narrow,
      WATER_DEBUG_VIEWS.indexOf(value.debug ?? 'none'),
    );
  }

  /**
   * How the water looks (`waterOpticsOf`): the colour of water too deep to see through, and how
   * far one sees through it. Kept by {@link WaterMaterial.water}.
   */
  get optics(): Required<WaterOptics> {
    return this._optics;
  }
  set optics(value: Required<WaterOptics>) {
    this._optics = { ...value };
    this.water.optics = this._optics;
  }

  /** Swells from weather far away, running on regardless of the wind here. */
  get swells(): readonly SeaSwell[] {
    return this._swells;
  }
  set swells(value: readonly SeaSwell[]) {
    this._swells = [...value];
    this.updateWaves();
  }

  get windDirection(): Vector2 {
    return this.uniforms.uWindDirection.value;
  }
  set windDirection(value: Vector2) {
    this.uniforms.uWindDirection.value.copy(value).normalize();
    this.updateWaves();
  }

  get windSpeed(): number {
    return this.uniforms.uWindSpeed.value;
  }
  set windSpeed(value: number) {
    this.uniforms.uWindSpeed.value = value;
    this.updateWaves();
  }

  /**
   * Wave height multiplier applied on top of the spectrum's physical Hs.
   * @deprecated the waves are as the wind gives them, wavelengths, foam and whitecaps with
   * them: scaling their height alone breaks that. For more wind, `windSpeed`; for waves from
   * weather far away, `swells`. Still applied
   */
  get amplitude(): number {
    return this._waveHeightScale;
  }
  set amplitude(value: number) {
    this._waveHeightScale = value;
    this.updateWaves();
  }

  /**
   * @deprecated the waves spread about the wind as the spectrum has them (Mitsuyasu); ignored
   */
  get directionalSpread(): number {
    return this._directionalSpread;
  }
  set directionalSpread(value: number) {
    this._directionalSpread = value;
  }

  /** Significant wave height (m) derived from the current wind/height scale. */
  get significantHeight(): number {
    return this.uniforms.uSignificantHeight.value;
  }

  /** The waves' slopes scaled for show: 1 as the spectrum gives them. Default 1 */
  get steepness(): number {
    return this.uniforms.uSteepness.value;
  }
  set steepness(value: number) {
    this.uniforms.uSteepness.value = value;
  }

  get displacement(): number {
    return this.uniforms.uDisplacement.value;
  }
  set displacement(value: number) {
    // Clamped to [0, 1]: displacement is off (0) or the sea's own heights (1).
    this.uniforms.uDisplacement.value = Math.min(Math.max(value, 0), 1);
  }

  // Kept for the deprecated `deepColor`, `shallowColor` and `waterOpacity`, which nothing
  // draws with: the water's look is its optics.
  private readonly legacyLook = {
    deep: new Color(DEFAULT_WATER_DEEP_COLOR),
    shallow: new Color('#1b6f8a'),
    opacity: DEFAULT_WATER_OPACITY,
  };

  /** @deprecated the water's colour is its `optics` (`WaterSettings.optics`); no effect */
  get deepColor(): Color {
    return this.legacyLook.deep;
  }
  set deepColor(value: Color | string | number) {
    this.legacyLook.deep.set(value as Color);
  }

  /** @deprecated the water's look is one model, its `optics`; no effect */
  get shallowColor(): Color {
    return this.legacyLook.shallow;
  }
  set shallowColor(value: Color | string | number) {
    this.legacyLook.shallow.set(value as Color);
  }

  /** @deprecated how far one sees is the water's `optics` (its `clarity`); no effect */
  get waterOpacity(): number {
    return this.legacyLook.opacity;
  }
  set waterOpacity(value: number) {
    this.legacyLook.opacity = value;
  }

  // The sea level against the bathymetry grid (waterLevel); null without one.
  private bathymetryLevel: number | null = null;

  /**
   * Sea level in the material's OBJECT frame (Y up), against which the
   * bathymetry is measured. No effect without a bathymetry grid.
   */
  get waterLevel(): number {
    return this.bathymetryLevel ?? 0;
  }
  set waterLevel(value: number) {
    if (this.bathymetryLevel !== null) this.bathymetryLevel = value;
  }

  /**
   * The still water's depth at X/Z `x`, `z` of the material's object frame, as its waves
   * read it to shoal and break by (`sea-shallow.ts`): under {@link WaterMaterial.waterLevel}
   * to the bathymetry grid where that covers, else the water's flat floor (`WaterBody.depth`,
   * endless 1e30). ⚠️ The scene's ground, which an endless sea's shaders read where it has
   * one, is the GPU's alone: give a sampler that sea's depth (`createWaterSampler`).
   */
  depthAt(x: number, z: number): number {
    const map = this.uniforms.uBathyMap?.value as Texture | undefined;
    if (map) {
      const bed = depthMapHeightAt(
        { texture: map, toUv: this.uniforms.uBathyToUv.value as Matrix3 },
        x,
        z,
      );
      if (bed !== null) return this.waterLevel - bed;
    }
    return this.water.depth;
  }

  /**
   * Surf where the bed comes up to the surface, 0..1. Default 0 (off).
   *
   * ⚠️ Independent of the wind, unlike whitecaps: a shore breaks in a calm. It
   * is folded into the same foam coverage, so it picks up the same noise, froth
   * and distance fade. Needs the water's depth to vary: a bathymetry grid, or the
   * scene's ground under an endless sea.
   */
  get shoreFoam(): number {
    return this.uniforms.uShore.value.x;
  }
  set shoreFoam(value: number) {
    this.uniforms.uShore.value.x = value;
  }

  /**
   * Depth at which waves break, as a multiple of the significant wave height.
   * Default 1.3 (`SEA_BREAK_DEPTH`) — the measured breaking criterion. The
   * waves are cut down to it as the water shallows (`sea-shallow.ts`), and the
   * surf zone sits where they are, so both widen and narrow with the sea state.
   *
   * ⚠️ For the surf, the wave height is floored internally to stand in for
   * background swell, so an open coast still breaks in a dead calm.
   */
  get shoreBreakDepth(): number {
    return this.uniforms.uSeaBreakDepth.value;
  }
  set shoreBreakDepth(value: number) {
    this.uniforms.uSeaBreakDepth.value = value;
  }

  /**
   * Exaggeration of the surf zone's width. Default 1 — as measured.
   *
   * ⚠️ A realistic surf zone is only a handful of pixels across at field scale, so
   * this exists for the same reason a pipeline's diameter exaggeration does. Raising
   * it makes the shore visible from further out at the cost of the scale cue a
   * correctly-sized one gives. The waves themselves still break at
   * {@link WaterMaterial.shoreBreakDepth}.
   */
  get surfScale(): number {
    return this.uniforms.uShore.value.y;
  }
  set surfScale(value: number) {
    this.uniforms.uShore.value.y = value;
  }

  /**
   * How far the swell carries the waterline up and down the shore, as a multiple
   * of the local wave height. Default 1; 0 pins the shore to the still level.
   */
  get swash(): number {
    return this.uniforms.uShore.value.z;
  }
  set swash(value: number) {
    this.uniforms.uShore.value.z = value;
  }

  /**
   * How ragged the shore foam's landward edge is, in metres of water depth.
   * Default 0 (the edge follows the depth's contour exactly, which reads as
   * unnaturally crisp).
   *
   * ⚠️ It perturbs the FOAM band only, not the water's depth — perturbing that
   * would make the transparency and colour ripple with it.
   */
  get shoreNoise(): number {
    return this.uniforms.uShoreNoise.value.x;
  }
  set shoreNoise(value: number) {
    this.uniforms.uShoreNoise.value.x = value;
  }

  /** Feature size of that raggedness, in metres. Default 200. */
  get shoreNoiseScale(): number {
    const inverse = this.uniforms.uShoreNoise.value.y;
    return inverse > 0 ? 1 / inverse : 0;
  }
  set shoreNoiseScale(value: number) {
    this.uniforms.uShoreNoise.value.y = 1 / Math.max(value, 1e-3);
  }

  /**
   * How white the shore foam is drawn, 0..1. Default 0.65 — pure white surf reads
   * as a painted line at field scale. 0 removes it entirely, colour AND opacity.
   *
   * ⚠️ Distinct from {@link WaterMaterial.shoreFoam}, which decides how much of the
   * band is COVERED and so breaks it up against the foam noise; this one dims the
   * whole band evenly.
   */
  get shoreFoamStrength(): number {
    return this.uniforms.uShoreFade.value.x;
  }
  set shoreFoamStrength(value: number) {
    this.uniforms.uShoreFade.value.x = value;
  }

  /**
   * Fraction of {@link WaterMaterial.shoreFoamStrength} lost once the foam detail
   * goes sub-pixel. Default 0.3.
   *
   * ⚠️ This is what softens the band with distance, NOT the analytic AA: that only
   * engages once the band itself is sub-pixel, and a band measured in metres of
   * DEPTH stays hundreds of metres across on a gentle shelf.
   */
  get shoreFoamFade(): number {
    return this.uniforms.uShoreFade.value.y;
  }
  set shoreFoamFade(value: number) {
    this.uniforms.uShoreFade.value.y = value;
  }

  /** @deprecated no longer drawn (their repeating, cloud-like patches are gone) */
  get tonalVariation(): number {
    return this.uniforms.uTonalVariation.value;
  }
  set tonalVariation(value: number) {
    this.uniforms.uTonalVariation.value = value;
  }

  /** @deprecated no longer drawn */
  get tonalScale(): number {
    const freq = this.uniforms.uTonalScale.value;
    return freq > 0 ? 1 / (freq * 1000) : 0;
  }
  set tonalScale(value: number) {
    this.uniforms.uTonalScale.value = value > 0 ? 1 / (value * 1000) : 0;
  }

  /** @deprecated no longer drawn */
  get tonalSharpness(): number {
    return this.uniforms.uTonalSharpness.value;
  }
  set tonalSharpness(value: number) {
    this.uniforms.uTonalSharpness.value = value;
  }

  /** @deprecated no longer drawn */
  get tonalColor(): Color {
    return this.uniforms.uTonalColor.value;
  }
  set tonalColor(value: Color | string | number) {
    this.uniforms.uTonalColor.value.set(value as Color);
  }

  get skyColor(): Color {
    return this.uniforms.uSkyColor.value;
  }
  set skyColor(value: Color | string | number) {
    this.uniforms.uSkyColor.value.set(value as Color);
  }

  get horizonColor(): Color {
    return this.uniforms.uHorizonColor.value;
  }
  set horizonColor(value: Color | string | number) {
    this.uniforms.uHorizonColor.value.set(value as Color);
  }

  get reflectionIntensity(): number {
    return this.uniforms.uReflectionIntensity.value;
  }
  set reflectionIntensity(value: number) {
    this.uniforms.uReflectionIntensity.value = value;
  }

  /**
   * The direction toward the sun its glint and foam are lit by (world). Set to a direction to
   * keep it; null to take its scene's sky's sun ({@link updateSky}), its scene's brightest
   * directional light outside a `Scenery`. Default its scene's.
   */
  get sunDirection(): Vector3 {
    return this.uniforms.uSunDirection.value;
  }
  set sunDirection(value: Vector3 | null) {
    this._ownSunDirection = value !== null;
    if (value) this.uniforms.uSunDirection.value.copy(value).normalize();
  }

  /** The sun's colour, intensity in it; null to take its scene's sky's ({@link sunDirection}). Default its scene's */
  get sunColor(): Color {
    return this.uniforms.uSunColor.value;
  }
  set sunColor(value: Color | string | number | null) {
    this._ownSunColor = value !== null;
    if (value !== null) this.uniforms.uSunColor.value.set(value as Color);
  }

  get sunShininess(): number {
    return this.uniforms.uSunShininess.value;
  }
  set sunShininess(value: number) {
    this.uniforms.uSunShininess.value = value;
  }

  /**
   * Roughness added to the sun glint, widening its path at the same energy; 0 = none. Null to
   * take its scene's sky's (a `Scenery`'s low sun lays a broad path). Default its scene's
   */
  get sunGlintSpread(): number {
    return this.uniforms.uSunGlintSpread.value;
  }
  set sunGlintSpread(value: number | null) {
    this._ownGlintSpread = value !== null;
    if (value !== null)
      this.uniforms.uSunGlintSpread.value = Math.max(value, 0);
  }

  /**
   * Reflect the sky of `scene` (`sceneSky`): a `Scenery`'s, else the scene's environment
   * and brightest directional light, else its own gradient ({@link skyColor},
   * {@link horizonColor}) and sun. Once a frame, before it is drawn: it may prefilter the
   * scene's environment. The `Water` and `ZoneStack` do.
   */
  updateSky(renderer: WebGLRenderer, scene: Scene): void {
    this.setSky(sceneSky(scene).resolve(renderer, scene));
  }

  /**
   * Reflect `source`, or the gradient and its own sun for null. Its sun is the source's where
   * it has none of its own ({@link sunDirection}). An environment appearing, going or changing
   * its size, or clouds doing so, compiles the material again.
   */
  setSky(source: SceneSkySource | null): void {
    const u = this.uniforms;
    const environment = source?.environment ?? null;
    const clouds = source?.clouds ?? null;
    const height = environment
      ? (environment.image as { height: number }).height
      : 0;
    const key = `${height}|${clouds ? 1 : 0}`;
    if (key !== this._skyKey) {
      this._skyKey = key;
      const d = this.defines;
      for (const name of WATER_SKY_DEFINES) delete d[name];
      if (environment) {
        const size = cubeUVSize(height);
        d.WATER_SKY_ENV = '';
        d.ENVMAP_TYPE_CUBE_UV = '';
        d.CUBEUV_TEXEL_WIDTH = size.texelWidth;
        d.CUBEUV_TEXEL_HEIGHT = size.texelHeight;
        d.CUBEUV_MAX_MIP = `${size.maxMip}.0`;
      }
      if (clouds) d.WATER_SKY_CLOUDS = '';
      this.needsUpdate = true;
    }
    u.uSkyEnv.value = environment;
    if (source) {
      u.uSkyEnvIntensity.value = source.intensity;
      (u.uSkyEnvRotation.value as Matrix3).copy(source.rotation);
    }
    u.uSkyClouds.value = clouds;
    u.uSkyCloudBase.value = source?.cloudBase ?? 0;
    const sun = source?.sun ?? null;
    if (!this._ownSunDirection)
      (u.uSunDirection.value as Vector3).copy(
        sun ? sun.direction : WATER_SUN_DIRECTION,
      );
    if (!this._ownSunColor)
      (u.uSunColor.value as Color).copy(sun ? sun.color : WATER_SUN_COLOR);
    if (!this._ownGlintSpread) u.uSunGlintSpread.value = sun?.glintSpread ?? 0;
  }

  get foamColor(): Color {
    return this.uniforms.uFoamColor.value;
  }
  set foamColor(value: Color | string | number) {
    this.uniforms.uFoamColor.value.set(value as Color);
  }

  get foamAmount(): number {
    return this.uniforms.uFoamAmount.value;
  }
  set foamAmount(value: number) {
    this.uniforms.uFoamAmount.value = value;
  }

  /**
   * How much of the sun's light through the waves' crests is drawn, with the sun behind them:
   * the water's own light tinted by the short path through a crest. 0 none, 1 (the default)
   * as modelled, more for more. A few operations a pixel; not drawn at `low` quality
   * (`WATER_QUALITY_DEFINES`).
   */
  get crestLight(): number {
    return this.uniforms.uCrestLight.value;
  }
  set crestLight(value: number) {
    this.uniforms.uCrestLight.value = Math.max(value, 0);
  }

  /**
   * How much of the sun's glitter is drawn: the glint broken into the glints of ripples too
   * small to draw, where a pixel holds few of them (the same mean). 0 for none, which compiles
   * it out (about 5 % of the sea where it is drawn); 1 as modelled; more for more of it. Null
   * for its quality's ({@link WATER_SPARKLE_DEFAULT}: none on low and medium, 1 on high and
   * ultra). Turning it on or off compiles it again.
   */
  get sparkle(): number {
    return this.uniforms.uSparkle.value;
  }
  set sparkle(value: number | null) {
    const amount = Math.max(
      value ?? WATER_SPARKLE_DEFAULT[this.quality] ?? 0,
      0,
    );
    this.uniforms.uSparkle.value = amount;
    const on = amount > 0;
    if (on === 'WATER_SPARKLE' in this.defines) return;
    if (on) this.defines.WATER_SPARKLE = '';
    else delete this.defines.WATER_SPARKLE;
    this.needsUpdate = true;
  }

  /**
   * Null (the default) for the reflection water has (Fresnel's equations, IOR 1.333); an
   * exponent for the old look, Schlick's curve from 2 % with it (4 was the default: more
   * reflection at middle angles than water has). Changing between the two compiles it again.
   */
  get fresnelPower(): number | null {
    return 'WATER_FRESNEL_POWER' in this.defines
      ? this.uniforms.uFresnelPower.value
      : null;
  }
  set fresnelPower(value: number | null) {
    if (value !== null) this.uniforms.uFresnelPower.value = value;
    const on = value !== null;
    if (on === 'WATER_FRESNEL_POWER' in this.defines) return;
    if (on) this.defines.WATER_FRESNEL_POWER = '';
    else delete this.defines.WATER_FRESNEL_POWER;
    this.needsUpdate = true;
  }

  /** The foam's feature frequency, per metre. Default 0.05 */
  get detailScale(): number {
    return this.uniforms.uDetailScale.value;
  }
  set detailScale(value: number) {
    this.uniforms.uDetailScale.value = value;
  }

  /** @deprecated the fine ripples are the sea state's finest layer; ignored */
  get detailStrength(): number {
    return this.uniforms.uDetailStrength.value;
  }
  set detailStrength(value: number) {
    this.uniforms.uDetailStrength.value = value;
  }

  /**
   * Distances from the camera, `[start, end]`, over which the waves and foam fade out,
   * leaving a flat mirror whose sun glint keeps the waves' spread.
   */
  get detailFadeDistance(): [number, number] {
    const fade = this.uniforms.uDetailFade.value as Vector2;
    return [fade.x, fade.y];
  }
  set detailFadeDistance([start, end]: [number, number]) {
    this.uniforms.uDetailFade.value.set(start, Math.max(end, start + 1));
  }

  /** Maximum number of contact footprints this material can render at once. */
  get contactCount(): number {
    return this._contactCount;
  }

  /**
   * Upload the current set of floating-object contact footprints. Excess
   * entries beyond {@link contactCount} are ignored. Cheap: it only copies into
   * the preallocated uniform vectors, so it is safe to call every frame.
   */
  setContacts(contacts: WaterContact[]): void {
    const a = this.uniforms.uContactA.value as Vector4[];
    const b = this.uniforms.uContactB.value as Vector4[];
    const c = this.uniforms.uContactC.value as Vector4[];
    const n = Math.min(contacts.length, this._contactCount);
    for (let i = 0; i < n; i++) {
      const k = contacts[i];
      // ⚠️ The FORWARD DIRECTION in world XZ, not (cos, sin) of the heading: a
      // rotation about +Y takes the body's +X to (cos, -sin) in XZ. Uploading the
      // direction itself is also what makes the shader's projection onto it and
      // its perpendicular correct without either end naming an angle convention.
      a[i].set(k.x, k.z, Math.cos(k.heading), -Math.sin(k.heading));
      b[i].set(k.halfLength, k.halfWidth, k.foamWidth, k.intensity ?? 1);
      c[i].set(k.endFalloff ?? 0, 0, 0, 0);
    }
    this.uniforms.uContactCount.value = n;
  }

  /** Clear all contact footprints (no contact foam). */
  clearContacts(): void {
    this.uniforms.uContactCount.value = 0;
  }

  /**
   * The water's place in the world as the surface is drawn: its level, its extent (the
   * surface geometry's box) and its seabed's map (endless, the scene's ground where the map
   * does not cover: `sceneGroundMap`), from the drawn object's frame (Y up, turned
   * about it at most); whether `camera` is over it, exactly; and the scene's water
   * (`sceneWaterBody`) taken from it, so what lies in it fades by it wherever it is in the
   * tree. Runs as the surface renders (the OIT variants too), and from the camera site's probe
   * (`Water`) before the frame, so what draws before the surface has it. Returns where the
   * camera is at this water.
   */
  syncWater(
    scene: Scene,
    camera: Camera,
    geometry: BufferGeometry,
    object: Object3D,
  ): CameraWater {
    const water = this.water;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    const box = geometry.boundingBox!;
    const e = object.matrixWorld.elements;
    const levelY = this.bathymetryLevel ?? (box.min.y + box.max.y) / 2;
    water.level = e[5] * levelY + e[13];
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    for (const x of [box.min.x, box.max.x])
      for (const z of [box.min.z, box.max.z]) {
        const wx = e[0] * x + e[8] * z + e[12];
        const wz = e[2] * x + e[10] * z + e[14];
        minX = Math.min(minX, wx);
        maxX = Math.max(maxX, wx);
        minZ = Math.min(minZ, wz);
        maxZ = Math.max(maxZ, wz);
      }
    water.extent = [minX, minZ, maxX, maxZ];
    // World X/Z into the object's.
    const toObject = this._toObject
      .set(e[0], e[8], e[12], e[2], e[10], e[14], 0, 0, 1)
      .invert();
    const footprint = geometryFootprint(geometry);
    const map = this.uniforms.uBathyMap?.value as Texture | undefined;
    if (map) {
      water.setBed({
        texture: map,
        toUv: this._bedToUv
          .copy(this.uniforms.uBathyToUv.value as Matrix3)
          .multiply(toObject),
        yScale: e[5],
        yOffset: e[13],
      });
    }
    // Endless (no floor of its own), its seabed is the scene's ground where it has one, its
    // level the sea's: a sea of its own size keeps its own.
    water.setGround(
      water.depth >= 1e30 ? sceneGroundMap(scene) : null,
      e[5],
      water.level,
    );
    // The camera over the footprint, on its triangles; how deep, and over the seabed.
    camera.updateWorldMatrix(true, false);
    const eye = this._eye.setFromMatrixPosition(camera.matrixWorld);
    const at = this._eyeXZ.set(eye.x, eye.z, 1).applyMatrix3(toObject);
    const over = footprint.contains(at.x, at.y) && !this.cameraCut?.(eye);
    const depth = water.level - eye.y;
    // Under its seabed the camera is in the ground: over the water, but not in it.
    let aboveBed = true;
    if (over && depth > 0 && depth < water.depth && this.cameraFloor) {
      const bed = this.cameraFloor(eye);
      aboveBed = bed === null || eye.y > bed;
    }
    water.cameraOver = over && aboveBed;
    if (this.sharesSceneWater) {
      sceneWaterBody(scene).copyFrom(water, this);
      this._scene = scene;
    }
    return {
      depth,
      over,
      inside: over && aboveBed && depth > 0 && depth < water.depth,
      owner: this,
    };
  }

  onBeforeRender(
    _renderer: WebGLRenderer,
    scene: Scene,
    camera: Camera,
    geometry: BufferGeometry,
    object: Object3D,
  ): void {
    this.syncWater(scene, camera, geometry, object);
  }
  private readonly _toObject = new Matrix3();
  private readonly _bedToUv = new Matrix3();
  private readonly _eye = new Vector3();
  private readonly _eyeXZ = new Vector3();
  // The scene whose water this last wrote, let go of on dispose.
  private _scene: Scene | null = null;

  dispose(): void {
    super.dispose();
    this._ownBake.dispose();
    this._foamLife?.dispose();
    this._foamLife = null;
    if (this._scene) sceneWaterBody(this._scene).release(this);
  }
}
