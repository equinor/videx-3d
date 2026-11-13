import {
  type Camera,
  Color,
  DoubleSide,
  IUniform,
  MathUtils,
  Matrix3,
  type OrthographicCamera,
  type PerspectiveCamera,
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
  SEA_QUALITY,
  SeaState,
  type SeaQuality,
} from '../../sdk/weather/sea-state';
import type { SeaSwell } from '../../sdk/weather/sea-spectrum';
import {
  type WeatherGusts,
  weatherGustsOf,
} from '../../sdk/weather/wind-field';
import { SeaWaveBake } from './sea-wave-bake';
import fragmentShader from './shaders/fragment.glsl';
import vertexShader from './shaders/vertex.glsl';

/**
 * A sea bed's depth grid, packed by `buildSurfaceDepthMap`: R the scene Y, G the
 * validity, sampled from OBJECT XZ through `toUv`.
 *
 * ⚠️ Structural on purpose — `ChunkDepthMap` satisfies it, without this material
 * having to depend on the chunk components.
 */
export type OceanBathymetry = {
  texture: Texture;
  /** object XZ -> texture uv, as `uv = m * vec3(x, z, 1)` */
  toUv: Matrix3;
  /** grid spacing in metres, used to take the bed's gradient */
  cellSize: number;
};

/** Default depth over which water shoals from clear to its full body colour. */
export const DEFAULT_OCEAN_SHOAL_DEPTH = 25;

/**
 * Default depth at which waves break, as a multiple of the significant wave
 * height. Waves break at roughly 1.3x their own height.
 */
export const DEFAULT_OCEAN_SHORE_BREAK_DEPTH = 1.3;

/** Default feature size of the shore foam's ragged edge, in metres. */
export const DEFAULT_OCEAN_SHORE_NOISE_SCALE = 200;

/**
 * How many times a sea layer's tile a pixel straight below the camera must span before
 * {@link OceanMaterial.renderWaves} stops baking it. A pixel off the view's axis spans less
 * of the sea in front of it (down to ~0.6× in a corner), as one rendered supersampled does.
 */
export const SEA_BAKE_PIXEL_MARGIN = 2;

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
export const DEFAULT_OCEAN_SHORE_FOAM_STRENGTH = 0.65;
export const DEFAULT_OCEAN_SHORE_FOAM_FADE = 0.3;

export type OceanMaterialParameters = ShaderMaterialParameters & {
  /**
   * How much of the sea's waves it draws ({@link SeaQuality}). Default `'medium'`.
   * ⚠️ Read at construction: another quality is another material.
   */
  quality?: SeaQuality;
  /** @deprecated the waves are a sea state's layers (`quality`); ignored */
  waveCount?: number;
  /** octaves of the shore's ragged edge noise. Default 4 */
  detailOctaves?: number;
  contactCount?: number;
  /**
   * Cut this material with a plane in OBJECT space (`dot(xyz, position) + w > 0`
   * is discarded) — a `ChunkStack`'s section, so the sea is cut with the block
   * under it. Omit for none, which compiles the branch out.
   *
   * ⭐ A SHARED uniform object: pass the stack's own and one write per frame
   * reaches this material, the volume material and every chunk material, in all
   * four OIT passes. ⚠️ Read at CONSTRUCTION (it sets a define), so turning the
   * cut on or off means a new material; moving the plane does not.
   */
  sectionPlane?: IUniform<Vector4>;
  /**
   * Cut this material with a **fence** instead — the same shared uniforms the
   * chunk materials read, so the sea is cut on exactly the curve the block is.
   * Omit for none, which compiles the branch out.
   *
   * ⭐ Read PER FRAGMENT, so a lid of a handful of triangles is cut at the
   * resolution of the curve rather than of its own tessellation.
   *
   * ⚠️ Read at CONSTRUCTION, like {@link OceanMaterialParameters.sectionPlane}.
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
  bathymetry?: OceanBathymetry;
};

/**
 * An oriented footprint of a floating object resting on the ocean surface, used
 * to spread contact foam around it. All values are in the ocean's local frame
 * (sea level = local y 0).
 */
export type OceanContact = {
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
};

/**
 * Default deep-water colour, seen looking straight down.
 *
 * @group Components
 */
export const DEFAULT_OCEAN_DEEP_COLOR = '#0a2540';

/**
 * Default base water opacity looking straight down (see
 * `OceanWaterProps.waterOpacity`).
 *
 * @group Components
 */
export const DEFAULT_OCEAN_WATER_OPACITY = 0.7;

/**
 * The uniforms the sea's layers are read with (`shaders/sea-layers.glsl`, and the detail
 * octave in `shaders/ocean-surface.glsl`: the finest layer's tile read again, smaller). A
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
] as const;

/**
 * ⚠️ Tuning, to be settled and then removed: the wave model's open choices, to compare by eye
 * (`OceanMaterial.waveTuning`, the `waveTuning` prop). Each left out is as drawn by default.
 */
export type OceanWaveTuning = {
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
 * (`OceanMaterial.foamTuning`, the `foamTuning` prop). Each left out is as drawn by default.
 */
export type OceanFoamTuning = {
  /** the finer waves' share in the crests the foam is cut from, ×; 0.8 */
  breakup?: number;
  /** the rim's width up close, in the crests' [0, 1]; 0.1 */
  edge?: number;
  /** how much the ripples dim the foam's inside; 0.45 */
  froth?: number;
  /** where thin foam turns opaque, up close; 0.6 */
  falloff?: number;
  /** the share of the foam lost once below a pixel; 0.85 */
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
  debug?: OceanDebugView;
};

/** ⚠️ Debug views of the sea ({@link OceanFoamTuning.debug}). */
export const OCEAN_DEBUG_VIEWS = [
  'none',
  'whitecaps',
  'crests',
  'wind',
] as const;
export type OceanDebugView = (typeof OCEAN_DEBUG_VIEWS)[number];

// [breakup, edge, froth, falloff], [farFade, opacity, lit, lift] and [grain, grainScale,
// narrow] as drawn by default (dialled in on the sea bench, 2026-11-13).
const OCEAN_FOAM_SHAPE_DEFAULT = [0.8, 0.1, 0.45, 0.6] as const;
const OCEAN_FOAM_LOOK_DEFAULT = [0.85, 1, 1, 0.5] as const;
const OCEAN_FOAM_GRAIN_DEFAULT = [0.45, 0.06, 1] as const;

/**
 * The uniforms `shaders/ocean-surface.glsl` reads, wave tables included. Another
 * material that includes it shares an {@link OceanMaterial}'s water by pointing
 * these entries at the same uniform objects.
 */
export const OCEAN_SURFACE_UNIFORMS = [
  'uTime',
  'uOceanDetailOctaves',
  'uWindDirection',
  'uWindSpeed',
  'uSignificantHeight',
  'uSteepness',
  'uDeepColor',
  'uShallowColor',
  'uOpacity',
  'uReflectionIntensity',
  'uSunDirection',
  'uSunColor',
  'uSunShininess',
  'uSunGlintSpread',
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
 * {@link OceanMaterial.renderWaves} bakes the layers into tiling textures (`SeaWaveBake`),
 * which the surface reads hex-tiled, so they never repeat, and filtered to the pixel, what the
 * filtering leaves out roughening the sun's glint. Floating objects ride
 * {@link OceanMaterial.seaState}'s heights, the same waves.
 *
 * Everything is evaluated in world X/Z so patched geometry is seamless. The material is wired
 * for the OITRenderPass via {@link attachOitVariants}; because its OIT variants share this
 * material's `uniforms` object by reference, animated uniforms (time, wind, colours, the
 * layers) stay live through every transparency pass.
 */
/** The most layers a sea draws (`SEA_QUALITY`): the uniforms for them are always there. */
const OCEAN_MAX_SEA_LAYERS = 4;
// The local winds over the mean the short waves' answer is worked out at (uWeatherGustRough):
// linear between, none at 0, 1 at the mean.
const OCEAN_GUST_FACTORS = [0.25, 0.5, 1.5, 2] as const;

export class OceanMaterial extends ShaderMaterial {
  isOceanMaterial = true;

  /** the sea's waves, which floating objects ride ({@link SeaState.heightAt}) */
  readonly seaState: SeaState;
  /** the sea's layers as textures, baked each frame by {@link OceanMaterial.renderWaves} */
  readonly waveBake: SeaWaveBake;
  /** how much of the sea's waves it draws */
  readonly quality: SeaQuality;

  private _waveHeightScale!: number;
  private _directionalSpread!: number;
  private _swells: SeaSwell[] = [];
  private _waveTuning: OceanWaveTuning = {};
  private _foamTuning: OceanFoamTuning = {};
  private _gusts: WeatherGusts | null = null;
  private _contactCount!: number;
  // Whether the clock has run: until it does, a new wind is the sea's at once (settled).
  private _running = false;
  // The sea state's input last set, to set it only as it changes.
  private _inputKey = '';

  constructor(parameters: OceanMaterialParameters = {}) {
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
    const spec = SEA_QUALITY[quality] ?? SEA_QUALITY.medium;
    const sea = new SeaState(
      { windSpeed: 10, windDirection: [1, 0] },
      { layers: spec.layers, detail: spec.detail },
    );
    const bake = new SeaWaveBake(sea.layers);
    const layerUniforms: Record<string, IUniform> = {};
    for (let i = 0; i < OCEAN_MAX_SEA_LAYERS; i++)
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
        OCEAN_CONTACT_COUNT: contactCount,
        ...(sectionPlane ? { OCEAN_SECTION: '' } : {}),
        ...(fence ? { OCEAN_FENCE: '' } : {}),
        ...(bathymetry ? { OCEAN_BATHYMETRY: '' } : {}),
      },
      uniforms: {
        // ⚠⚠ `fog = true` makes three refresh fogColor/fogDensity/fogNear/fogFar on
        // THIS material, and a hand-built uniform block has none of them — which
        // throws inside the renderer rather than just failing to fog. A material
        // merging a `ShaderLib` entry gets these for free; this one does not.
        ...UniformsUtils.clone(UniformsLib.fog),
        uTime: new Uniform(0),
        uOceanDetailOctaves: new Uniform(detailOctaves),
        uWindDirection: new Uniform(new Vector2(1, 0).normalize()),
        uWindSpeed: new Uniform(10),
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

        uDeepColor: new Uniform(new Color(DEFAULT_OCEAN_DEEP_COLOR)),
        uShallowColor: new Uniform(new Color('#1b6f8a')),
        uOpacity: new Uniform(DEFAULT_OCEAN_WATER_OPACITY),

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

        uSunDirection: new Uniform(new Vector3(-0.3, 0.8, -0.5).normalize()),
        uSunColor: new Uniform(new Color('#fff6e0')),
        uSunShininess: new Uniform(200),
        uSunGlintSpread: new Uniform(0),

        uFoamColor: new Uniform(new Color('#ffffff')),
        uFoamAmount: new Uniform(0.5),
        // ⚠️ Tuning (foamTuning), as drawn by default.
        uFoamShape: new Uniform(new Vector4(...OCEAN_FOAM_SHAPE_DEFAULT)),
        uFoamLook: new Uniform(new Vector4(...OCEAN_FOAM_LOOK_DEFAULT)),
        uFoamGrain: new Uniform(new Vector4(...OCEAN_FOAM_GRAIN_DEFAULT, 0)),

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

    this.seaState = sea;
    this.waveBake = bake;
    this.quality = quality;
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
      // x: water level (object Y), y: 1 / shoal depth, z: opacity factor at zero depth
      this.uniforms.uShoal = new Uniform(
        new Vector3(0, 1 / DEFAULT_OCEAN_SHOAL_DEPTH, 0),
      );
      // x: shore foam amount, y: break depth (x wave height), z: swash, w: gradient step (m)
      this.uniforms.uShore = new Uniform(
        new Vector4(
          0,
          DEFAULT_OCEAN_SHORE_BREAK_DEPTH,
          1,
          2 * bathymetry.cellSize,
        ),
      );
      this.uniforms.uSurfScale = new Uniform(1);
      // x: edge raggedness (m), y: its frequency (1 / m)
      this.uniforms.uShoreNoise = new Uniform(
        new Vector2(0, 1 / DEFAULT_OCEAN_SHORE_NOISE_SCALE),
      );
      // x: foam strength (1 = full white surf), y: fraction lost at distance
      this.uniforms.uShoreFade = new Uniform(
        new Vector2(
          DEFAULT_OCEAN_SHORE_FOAM_STRENGTH,
          DEFAULT_OCEAN_SHORE_FOAM_FADE,
        ),
      );
    }

    this.updateWaves();

    // Looking up at the surface from inside the water body, there IS water in the
    // way. ⚠️ A ShaderMaterial's `fog` defaults to false, so the shader's fog
    // chunks would compile to nothing without this.
    this.fog = true;

    attachOitVariants(this);
  }

  /**
   * The sea state's input from the wind, the swells and the height scale: eased toward as the
   * clock runs, or the sea's at once while it has not run yet. Cheap enough per change, but
   * not per frame (some milliseconds).
   */
  private updateWaves(resettle = false): void {
    this.updateGusts();
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
    this.seaState.setInput(input);
    if (!this._running || resettle) this.seaState.settle();
    this.uniforms.uSignificantHeight.value = this.seaState.stats().targetHeight;
    // How the short waves answer the gusts, from the finest layer's band up on medium and
    // finer (it answers by half, the ripples and what no layer draws in full), else from
    // what no layer draws.
    const layers = this.seaState.layers;
    const kMin =
      layers.length > 3 ? layers[3].kMin : layers[layers.length - 1].kMax;
    (this.uniforms.uWeatherGustRough.value as Vector4).fromArray(
      this.seaState.shortWaveRatios(OCEAN_GUST_FACTORS, kMin),
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
   * `strength` and `slicks` 0, none.
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
   * input; set back or far on, the waves just move to it.
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
    if (dt > 0 && dt < 3600) {
      this.seaState.update(dt);
      this._running = true;
      travel.x += speed * dt;
    } else {
      this.seaState.time = value;
      travel.x = speed * value;
    }
  }

  /**
   * Bake the sea's layers as they are now into their textures, for this frame: call once a
   * frame, after the clock has run, before the surface is drawn (and before any material
   * sharing its uniforms is, a `Scenery`'s).
   *
   * Given the `camera` and its `distance` to the nearest of the sea (its height over it, the
   * nearest a pixel is finest), a layer whose whole tile a pixel there spans (with a margin,
   * {@link SEA_BAKE_PIXEL_MARGIN}) is left as it was: the surface reads none of it, only its
   * variance. From high up that is all but the longest layers, or all of them.
   */
  renderWaves(
    renderer: WebGLRenderer,
    camera?: Camera,
    distance?: number,
  ): void {
    const pixel =
      camera && distance !== undefined
        ? pixelSpan(renderer, camera, Math.abs(distance)) *
          SEA_BAKE_PIXEL_MARGIN
        : 0;
    const layers = this.seaState.layers;
    this.waveBake.update(
      renderer,
      this.seaState.layerTables(),
      pixel > 0 ? i => layers[i].size > pixel : undefined,
    );
    const stats = this.seaState.stats();
    const ripples = Math.max(this._waveTuning.ripples ?? 1, 0);
    const layerStats = this.uniforms.uSeaLayerStats.value as Vector2[];
    stats.layers.forEach((layer, i) =>
      layerStats[i].set(layer.slopeVariance, layer.variance),
    );
    this.uniforms.uSeaResidual.value =
      stats.residualSlopeVariance +
      (1 - ripples * ripples) * stats.detail.slopeVariance;
    (this.uniforms.uSeaDetail.value as Vector3).set(
      stats.detail.gain * ripples,
      stats.detail.offset[0],
      stats.detail.offset[1],
    );
  }

  /**
   * ⚠️ Tuning, to be settled and then removed: the wave model's open choices, to compare by
   * eye ({@link OceanWaveTuning}).
   */
  get waveTuning(): OceanWaveTuning {
    return this._waveTuning;
  }
  set waveTuning(value: OceanWaveTuning) {
    this._waveTuning = { ...value };
    const hex = this.uniforms.uSeaHex.value as Vector2;
    hex.set(value.hex === false ? 0 : 1, value.hexSharpness ?? 1);
    this.uniforms.uRoughReflect.value = value.roughReflect ?? 1;
    this.updateWaves(true);
  }

  /**
   * ⚠️ Tuning, to be settled and then removed: the foam's shaping, to compare by eye
   * ({@link OceanFoamTuning}).
   */
  get foamTuning(): OceanFoamTuning {
    return this._foamTuning;
  }
  set foamTuning(value: OceanFoamTuning) {
    this._foamTuning = { ...value };
    const [breakup, edge, froth, falloff] = OCEAN_FOAM_SHAPE_DEFAULT;
    const [farFade, opacity, lit, lift] = OCEAN_FOAM_LOOK_DEFAULT;
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
    const [grain, grainScale, narrow] = OCEAN_FOAM_GRAIN_DEFAULT;
    (this.uniforms.uFoamGrain.value as Vector4).set(
      value.grain ?? grain,
      value.grainScale ?? grainScale,
      value.narrow ?? narrow,
      OCEAN_DEBUG_VIEWS.indexOf(value.debug ?? 'none'),
    );
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

  /** Wave height multiplier applied on top of the spectrum's physical Hs. */
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

  get deepColor(): Color {
    return this.uniforms.uDeepColor.value;
  }
  set deepColor(value: Color | string | number) {
    this.uniforms.uDeepColor.value.set(value as Color);
  }

  get shallowColor(): Color {
    return this.uniforms.uShallowColor.value;
  }
  set shallowColor(value: Color | string | number) {
    this.uniforms.uShallowColor.value.set(value as Color);
  }

  get waterOpacity(): number {
    return this.uniforms.uOpacity.value;
  }
  set waterOpacity(value: number) {
    this.uniforms.uOpacity.value = value;
  }

  /**
   * Sea level in the material's OBJECT frame (Y up), against which the
   * bathymetry is measured. No effect without a bathymetry grid.
   */
  get waterLevel(): number {
    return this.uniforms.uShoal?.value.x ?? 0;
  }
  set waterLevel(value: number) {
    if (this.uniforms.uShoal) this.uniforms.uShoal.value.x = value;
  }

  /**
   * Water depth at which the sea reaches ~86% of its full body colour and
   * opacity, in metres. Small values keep the shoaling to a narrow band along a
   * shore; large ones spread it over the whole shelf.
   */
  get shoalDepth(): number {
    const inverse = this.uniforms.uShoal?.value.y ?? 0;
    return inverse > 0 ? 1 / inverse : 0;
  }
  set shoalDepth(value: number) {
    if (this.uniforms.uShoal)
      this.uniforms.uShoal.value.y = 1 / Math.max(value, 1e-3);
  }

  /**
   * What is left of the water's own opacity where the bed reaches the surface,
   * 0..1. Default 0 — water with no depth is fully clear, and only the Fresnel
   * reflection remains.
   */
  get shoalOpacity(): number {
    return this.uniforms.uShoal?.value.z ?? 0;
  }
  set shoalOpacity(value: number) {
    if (this.uniforms.uShoal) this.uniforms.uShoal.value.z = value;
  }

  /**
   * Surf where the bed comes up to the surface, 0..1. Default 0 (off).
   *
   * ⚠️ Independent of the wind, unlike whitecaps: a shore breaks in a calm. It
   * is folded into the same foam coverage, so it picks up the same noise, froth
   * and distance fade. No effect without a bathymetry grid.
   */
  get shoreFoam(): number {
    return this.uniforms.uShore?.value.x ?? 0;
  }
  set shoreFoam(value: number) {
    if (this.uniforms.uShore) this.uniforms.uShore.value.x = value;
  }

  /**
   * Depth at which waves break, as a multiple of the significant wave height.
   * Default 1.3 — the measured breaking criterion, so the surf zone widens and
   * narrows with the sea state instead of sitting at a fixed depth.
   *
   * ⚠️ The wave height is floored internally to stand in for background swell, so
   * an open coast still breaks in a dead calm.
   */
  get shoreBreakDepth(): number {
    return this.uniforms.uShore?.value.y ?? 0;
  }
  set shoreBreakDepth(value: number) {
    if (this.uniforms.uShore) this.uniforms.uShore.value.y = value;
  }

  /**
   * Exaggeration of the surf zone's width. Default 1 — as measured.
   *
   * ⚠️ A realistic surf zone is only a handful of pixels across at field scale, so
   * this exists for the same reason a pipeline's diameter exaggeration does. Raising
   * it makes the shore visible from further out at the cost of the scale cue a
   * correctly-sized one gives.
   */
  get surfScale(): number {
    return this.uniforms.uSurfScale?.value ?? 1;
  }
  set surfScale(value: number) {
    if (this.uniforms.uSurfScale) this.uniforms.uSurfScale.value = value;
  }

  /**
   * How far the swell carries the waterline up and down the shore, as a multiple
   * of the local wave height. Default 1; 0 pins the shore to the still level.
   */
  get swash(): number {
    return this.uniforms.uShore?.value.z ?? 0;
  }
  set swash(value: number) {
    if (this.uniforms.uShore) this.uniforms.uShore.value.z = value;
  }

  /**
   * How ragged the shore foam's landward edge is, in metres of water depth.
   * Default 0 (the edge follows the bathymetry contour exactly, which reads as
   * unnaturally crisp).
   *
   * ⚠️ It perturbs the FOAM band only, not the water's depth — perturbing that
   * would make the transparency and colour ripple with it.
   */
  get shoreNoise(): number {
    return this.uniforms.uShoreNoise?.value.x ?? 0;
  }
  set shoreNoise(value: number) {
    if (this.uniforms.uShoreNoise) this.uniforms.uShoreNoise.value.x = value;
  }

  /** Feature size of that raggedness, in metres. Default 200. */
  get shoreNoiseScale(): number {
    const inverse = this.uniforms.uShoreNoise?.value.y ?? 0;
    return inverse > 0 ? 1 / inverse : 0;
  }
  set shoreNoiseScale(value: number) {
    if (this.uniforms.uShoreNoise)
      this.uniforms.uShoreNoise.value.y = 1 / Math.max(value, 1e-3);
  }

  /**
   * How white the shore foam is drawn, 0..1. Default 0.65 — pure white surf reads
   * as a painted line at field scale. 0 removes it entirely, colour AND opacity.
   *
   * ⚠️ Distinct from {@link OceanMaterial.shoreFoam}, which decides how much of the
   * band is COVERED and so breaks it up against the foam noise; this one dims the
   * whole band evenly.
   */
  get shoreFoamStrength(): number {
    return this.uniforms.uShoreFade?.value.x ?? 0;
  }
  set shoreFoamStrength(value: number) {
    if (this.uniforms.uShoreFade) this.uniforms.uShoreFade.value.x = value;
  }

  /**
   * Fraction of {@link OceanMaterial.shoreFoamStrength} lost once the foam detail
   * goes sub-pixel. Default 0.3.
   *
   * ⚠️ This is what softens the band with distance, NOT the analytic AA: that only
   * engages once the band itself is sub-pixel, and a band measured in metres of
   * DEPTH stays hundreds of metres across on a gentle shelf.
   */
  get shoreFoamFade(): number {
    return this.uniforms.uShoreFade?.value.y ?? 0;
  }
  set shoreFoamFade(value: number) {
    if (this.uniforms.uShoreFade) this.uniforms.uShoreFade.value.y = value;
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

  get sunDirection(): Vector3 {
    return this.uniforms.uSunDirection.value;
  }
  set sunDirection(value: Vector3) {
    this.uniforms.uSunDirection.value.copy(value).normalize();
  }

  get sunColor(): Color {
    return this.uniforms.uSunColor.value;
  }
  set sunColor(value: Color | string | number) {
    this.uniforms.uSunColor.value.set(value as Color);
  }

  get sunShininess(): number {
    return this.uniforms.uSunShininess.value;
  }
  set sunShininess(value: number) {
    this.uniforms.uSunShininess.value = value;
  }

  /** roughness added to the sun glint, widening its path at the same energy; 0 = none */
  get sunGlintSpread(): number {
    return this.uniforms.uSunGlintSpread.value;
  }
  set sunGlintSpread(value: number) {
    this.uniforms.uSunGlintSpread.value = Math.max(value, 0);
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

  get fresnelPower(): number {
    return this.uniforms.uFresnelPower.value;
  }
  set fresnelPower(value: number) {
    this.uniforms.uFresnelPower.value = value;
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
  setContacts(contacts: OceanContact[]): void {
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

  dispose(): void {
    super.dispose();
    this.waveBake.dispose();
  }
}
