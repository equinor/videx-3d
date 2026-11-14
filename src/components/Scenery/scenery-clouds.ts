import {
  AlwaysDepth,
  Camera,
  ClampToEdgeWrapping,
  Color,
  CubeCamera,
  CubeTexture,
  CustomBlending,
  DataTexture,
  DataUtils,
  DepthTexture,
  FloatType,
  HalfFloatType,
  IUniform,
  LinearFilter,
  LinearMipmapLinearFilter,
  Material,
  MathUtils,
  Matrix3,
  Matrix4,
  Mesh,
  NoBlending,
  RedFormat,
  OneFactor,
  OneMinusSrcAlphaFactor,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  SrcAlphaFactor,
  Texture,
  Uniform,
  UnsignedByteType,
  Vector2,
  Vector3,
  Vector4,
  WebGLCubeRenderTarget,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import { LAYERS } from '../../layers/layers';
import { conformalOffset } from '../../sdk/projection/conformal-sphere';
import type { Globe } from '../../sdk/projection/globe';
import {
  SOFT_COVER_QUANTILES,
  softCoverLevel,
} from '../../sdk/weather/soft-clouds';
import {
  cloudLayerWind,
  cloudLevelOf,
  CLOUD_LEVELS,
  CLOUD_TYPE_HEIGHTS,
  type CloudLayer,
  type CloudLevel,
  type CloudType,
  type WeatherWind,
} from '../../sdk/weather/weather';
import {
  acquireCloudNoiseVolumes,
  CloudNoiseVolumes,
  generateCloudNoiseVolumes,
  releaseCloudNoiseVolumes,
} from './scenery-cloud-noise';
import {
  CLOUD_COVER_LODS,
  CLOUD_COVER_PATCHES,
  CLOUD_COVER_VOLUME_SIZE,
  CloudCoverVolume,
} from './scenery-cloud-cover';
import { CloudCoverMap } from './scenery-cloud-cover-map';
import { CloudLightMap } from './scenery-cloud-light';
import { CloudPlaceMap } from './scenery-cloud-place-map';
import { CLOUD_MAP_SIZE } from './scenery-cloud-map';
import { CloudGround, earthFrame } from './scenery-ground';
import { CloudWeather } from './scenery-cloud-weather';
import { createSceneryGeometry, SceneryMaterial } from './scenery-material';
import type {
  ScenerySkyOverlay,
  ScenerySkyReflection,
  ScenerySkyShadow,
} from './scenery-registry';
import type {
  SceneryCloudLook,
  SceneryCloudsDebug,
  SceneryCloudsQuality,
  SceneryCloudsTemporal,
} from './scenery-model';
import compositeShader from './shaders/cloud-composite.glsl';
import marchShader from './shaders/cloud-march.glsl';
import rebuildShader from './shaders/cloud-rebuild.glsl';
import vertexShader from './shaders/cloud-vertex.glsl';

/**
 * What a {@link SceneryCloudsQuality} spends on a `SceneryClouds`'s clouds
 * (`CLOUDS_QUALITY`).
 *
 * @group Components
 */
export type CloudsQualityLevel = {
  /** the share of the screen's resolution in CSS pixels their image is drawn at, whatever its pixel ratio */
  resolution: number;
  /** stretches along each run of a view through a dense level (thin levels take fewer) */
  steps: number;
  /** stretches toward the light from each point lit: its skin, then the rest */
  lightSamples: number;
};

/**
 * The qualities a `SceneryClouds` draws at (`quality`): every pixel of their image marched
 * every frame, so what they cost depends only on what is in view (`documents/clouds.md`,
 * "Quality").
 *
 * @group Components
 */
export const CLOUDS_QUALITY: Readonly<
  Record<SceneryCloudsQuality, CloudsQualityLevel>
> = {
  low: { resolution: 0.35, steps: 24, lightSamples: 2 },
  medium: { resolution: 0.5, steps: 32, lightSamples: 2 },
  high: { resolution: 0.75, steps: 48, lightSamples: 3 },
  ultra: { resolution: 1, steps: 64, lightSamples: 4 },
};

/** `quality`'s level, with a `resolution` of its own instead of the quality's. */
export function cloudsQuality(
  quality: SceneryCloudsQuality,
  { resolution }: { resolution?: number } = {},
): CloudsQualityLevel {
  const level = CLOUDS_QUALITY[quality] ?? CLOUDS_QUALITY.medium;
  return { ...level, resolution: resolution ?? level.resolution };
}

/**
 * How a `SceneryClouds` draws a {@link CloudType}: each of {@link SceneryCloudLook}'s.
 *
 * @group Components
 */
export type CloudsLook = Required<SceneryCloudLook>;

/**
 * How a `SceneryClouds` draws each {@link CloudType} unless told (`looks`): heaped
 * cumulus, lumpy stratocumulus decks, flat stratus sheets, deep soft nimbostratus, small
 * altocumulus puffs in patches, thin altostratus veils, and ice — cirrus streaks drawn out
 * along the wind, cirrostratus milky veils. Cumulus form and fade in twenty minutes, their lumps
 * boiling up; sheets last hours.
 *
 * @group Components
 */
export const CLOUDS_LOOKS: Readonly<Record<CloudType, CloudsLook>> = {
  cumulus: {
    scale: 1,
    stretch: 1,
    softness: 0.05,
    lumps: 0.3,
    towering: 0.4,
    masses: 0.6,
    extinction: 0.03,
    lifetime: 1200,
    rise: 0.6,
  },
  stratocumulus: {
    scale: 1.2,
    stretch: 1.3,
    softness: 0.08,
    lumps: 0.3,
    towering: 0.2,
    masses: 0.4,
    extinction: 0.03,
    lifetime: 3600,
    rise: 0.1,
  },
  stratus: {
    scale: 2,
    stretch: 1.5,
    softness: 0.15,
    lumps: 0.15,
    towering: 0.05,
    masses: 0.1,
    extinction: 0.02,
    lifetime: 7200,
    rise: 0,
  },
  nimbostratus: {
    scale: 3,
    stretch: 1.5,
    softness: 0.2,
    lumps: 0.2,
    towering: 0.3,
    masses: 0.2,
    extinction: 0.03,
    lifetime: 5400,
    rise: 0,
  },
  altocumulus: {
    scale: 0.4,
    stretch: 1.5,
    softness: 0.08,
    lumps: 0.25,
    towering: 0.2,
    masses: 0.8,
    extinction: 0.02,
    lifetime: 2400,
    rise: 0.2,
  },
  altostratus: {
    scale: 2,
    stretch: 2,
    softness: 0.3,
    lumps: 0.1,
    towering: 0.05,
    masses: 0.1,
    extinction: 0.004,
    lifetime: 7200,
    rise: 0,
  },
  cirrus: {
    scale: 1,
    stretch: 6,
    softness: 0.3,
    lumps: 0.1,
    towering: 0.1,
    masses: 0.3,
    extinction: 0.002,
    lifetime: 3600,
    rise: 0,
  },
  cirrostratus: {
    scale: 3,
    stretch: 2,
    softness: 0.5,
    lumps: 0.05,
    towering: 0.02,
    masses: 0,
    extinction: 0.0015,
    lifetime: 7200,
    rise: 0,
  },
};

/**
 * The most cloud levels a `SceneryClouds` draws: one at each `CloudLevel`.
 *
 * @group Components
 */
export const CLOUDS_LEVELS = 3;

/**
 * Each `CloudLevel`'s types in a global weather, from heaped to sheet: where its cloud lies along
 * them is the weather systems' (the cloud map's types, `scenery-cloud-map.ts`), and it is drawn
 * as the looks between which it lies.
 *
 * @group Components
 */
export const CLOUDS_CHAINS: Readonly<Record<CloudLevel, readonly CloudType[]>> =
  {
    low: ['cumulus', 'stratocumulus', 'stratus'],
    mid: ['altocumulus', 'altostratus'],
    high: ['cirrus', 'cirrostratus'],
  };

// The types' rows in the march's tables (uCloudType*, uCloudCoverTable): each chain's types
// next to each other, in its order, so a level's place along its chain reads between two
// neighbouring rows.
const TYPE_ROWS: readonly CloudType[] = [
  'cumulus',
  'stratocumulus',
  'stratus',
  'nimbostratus',
  'altocumulus',
  'altostratus',
  'cirrus',
  'cirrostratus',
];

/**
 * Where a global weather's level's shell lies (`CLOUDS_CHAINS`): from the lowest base of
 * its types to the highest top (`CLOUD_TYPE_HEIGHTS`).
 *
 * @group Components
 */
export function cloudsChainLayer(level: CloudLevel): CloudLayer {
  const chain = CLOUDS_CHAINS[level];
  const base = Math.min(...chain.map(type => CLOUD_TYPE_HEIGHTS[type].base));
  const top = Math.max(...chain.map(type => CLOUD_TYPE_HEIGHTS[type].top[1]));
  return { type: chain[0], cover: 1, base, top };
}

// A local weather's clouds give way, breaking up, over this outer share of its radius, and a
// broad noise pushes its edge in and out by this share of it, so it is no circle
// (cloud-march.glsl, cloudLocalEdge): over the outer fifth of a circle it showed from
// high up as a disc.
const LOCAL_FADE = 0.5;
const LOCAL_WOBBLE = 0.2;
// The image's depth: log2 of the distance over this many doublings (cloud-composite.glsl).
const DEPTH_RANGE = '32.0';
// The size of a cloud (metres, at scale 1 and a look's scale 1: how a stretch of cloud and sky
// mixed hides what lies behind).
const CHUNK = 1500;
// The cover volume's tile (metres, at scale 1 and a look's scale 1): its broadest masses (four
// cells across it) some 8.5 km across. The lumps (the shape volume) tile it this many times.
const VOLUME_TILE = 204800 / 6;
const VOLUME_LUMP_TILES = 100 / 6;
// The clouds that last one lifetime as they form and fade (a look's `lifetime`): this many
// metres across (at scale 1 and a look's scale 1). The cover is read on through its noise by
// this much in a lifetime, so a cloud this size comes and goes in it, a broader one lasts as
// much longer as it is broader.
const LIFE_SIZE = 1500;
// A local weather's cover maps reach this far past its radius: its clouds keep within it.
const COVER_MARGIN = 1.02;
// A global weather's map about the camera reaches as far as clouds this high show (m).
const PLACE_TOP = 15000;
// The light maps reach this much past a local weather's radius at most (m): a ray toward a low
// light leaves a level's base that far out from the cloud it lights at its top.
const LIGHT_MARGIN = 25000;
// The film for the bakes of the air and the sea's reflection (ScenerySkyOverlay.texture): texels
// a face, each face marched once at this share of them, a still (no frames before it), coarser
// than the view's: its samples toward the light, and its share of each level's steps. Blurred in
// the bakes and the sea, a face of 64² costs as long as its slowest ray: the view's march took
// 49 ms for the six (Iris Xe), this 19.
const FILM_SIZE = 128;
const FILM_MARCH = 0.5;
const FILM_LIGHT_SAMPLES = 1;
const FILM_STEPS = 0.5;
// The film is drawn again once the sun has turned this far since (1 − its cosine: half a degree).
const FILM_TURN = 4e-5;
// As the clock runs, the film is due again (version) once the lowest level's clouds have drifted
// or formed and faded this share of a cloud since, at most this often (wall ms).
const FILM_SHARE = 0.25;
const FILM_LONGEST = 3000;
// The scene's light eases toward the share the clouds let through over this long (s); the bakes
// are due again once it has moved this much.
const LIGHT_EASE = 0.4;
const LIGHT_TOLD = 0.02;
// The share of a level's thickness the light crosses on its slant through its clouds
// (cloudsLight): most of a heaped cumulus's, more of a sheet's.
const LIGHT_SLANT: Readonly<Record<CloudType, number>> = {
  cumulus: 0.6,
  stratocumulus: 0.7,
  stratus: 0.8,
  nimbostratus: 0.9,
  altocumulus: 0.7,
  altostratus: 0.8,
  cirrus: 0.5,
  cirrostratus: 0.8,
};
// The shadows: texels a side; the square's reach to its sides, from the least to the most, the
// camera's height over the sea times the last; drawn again once the camera's foot or the clouds
// have moved this share of it, the light has turned (1 − its cosine), or the lowest level's
// clouds have lived this share of their lifetime; none from higher up than this (m).
const SHADOW_SIZE = 512;
// Samples across each level toward the light, a texel of the shadows (cloud-march.glsl):
// 2 cost 0.3–1.0 ms a drawing, 8 cost 1.3–3.0 (Iris Xe, 2026-11-10), alike enough for shadows.
const SHADOW_SAMPLES = 2;
const SHADOW_REACH = [20000, 200000, 8] as const;
const SHADOW_MOVE = 0.1;
const SHADOW_TURN = 1.5e-4;
const SHADOW_LIVED = 0.02;
const SHADOW_HIGHEST = 400000;
// The sea reflects the scene's own clouds out to this far from its middle, and a global weather's
// map's from the second on (ScenerySkyReflection).
const REFLECTION_NEAR = 100000;
const REFLECTION_FAR = 400000;
// The lumps' second tiling (cloud-march.glsl): broader (and turned, LUMPS_TURN).
const LUMP_BROADER = 1.618;
// Turns fixed on the Earth (column-major, a GLSL mat3's): the cover volume's lattice, so no
// place on the Earth has a tile's axis for its up; the cover's broad read; and the lumps' second
// tiling. Odd axes and angles, so none lines up with another.
const VOLUME_TURN = [
  0.775201, 0.545966, -0.31778, -0.45794, 0.832192, 0.312647, 0.435149,
  -0.09684, 0.895135,
];
const PATCHES_TURN = [
  0.8748, 0.281142, 0.394568, -0.478752, 0.626535, 0.61502, -0.074303, -0.72692,
  0.682691,
];
const LUMPS_TURN = [
  0.83523, 0.277143, -0.474955, -0.39732, 0.901263, -0.172806, 0.380168,
  0.333042, 0.862876,
];
const glslMat3 = (m: number[]) => `mat3(${m.join(', ')})`;
// By a level's top, the cover a column needs is past the most any reaches by this many of the
// lumps' and the edge's widths: no cloud reaches the top (cloud-march.glsl, cloudDensity).
const ROUND_REACH = 3;
// The march's detail (cloud-march.glsl, uCloudDetail): steps no longer than this many of
// the pixel's footprints (the pattern resolved along the view as across it); the
// lumps read where the footprint resolves features this share of the shape volume's tile across;
// and the march stops once this little of the light comes through (5 %: unseen, 0.77–0.89 of the
// time through an overcast).
const DETAIL = [2, 0.25, 0.05] as const;
// The march's steps (cloud-march.glsl, uCloudMarch, cloudMarchRuns), at a quality's
// `steps`: this share of them up a level's depth, and the optical depth a step through cloud hides
// at 32 (fewer steps, more).
const LAYER_STEPS = 0.4;
const STEP_DEPTH = 1;
// The phase's two lobes (cloud-light.glsl, uCloudPhase): the forward lobe's g, the backward's,
// the forward's share, and the most it reaches (4π times: 1 all round).
const PHASE = [0.6, -0.3, 0.7, 4] as const;
// How the sun's light is shared (cloud-light.glsl, uCloudScatter): the light scattered once (by
// the phase), the light scattered many times over (all round), and how much slower than the light
// straight through that falls off with the optical depth toward the light.
const SCATTER = [0.4, 0.6, 0.3] as const;
// A level as optically deep straight through as this, or deeper, takes the quality's steps; a
// thinner one, fewer (down to a quarter).
const DEEP = 8;
// The most the composite draws the clouds nearer than their depth, to take in the spread of a
// texel's depth over a slanting layer: 2 % of the distance, in the image's depth units.
const DEPTH_MARGIN = (Math.log2(1 / 0.98) / Number(DEPTH_RANGE)).toFixed(7);

/** A level a {@link CloudsRenderer} draws: its layer, and how its type is drawn. */
export type CloudsLevel = {
  layer: CloudLayer;
  look: CloudsLook;
};

/**
 * A global weather a {@link CloudsRenderer} draws: the weather systems' (their `seed`), each
 * level's cover from their map, kept in proportion as `dominance` says; `types` whether a level's
 * look follows its place along its chain, and `thickness` whether the low cloud's thickness sets
 * how deep and dense the cloud is.
 */
export type CloudsGlobal = {
  seed: number;
  dominance: number;
  types: boolean;
  thickness: boolean;
};

/** What a {@link CloudsRenderer} draws, resolved. */
export type CloudsSettings = {
  /**
   * the levels drawn, from the ground up (at most {@link CLOUDS_LEVELS}); none for none. In
   * a global weather, a level's layer is its chain's (`cloudsChainLayer`), its cover unused
   */
  levels: CloudsLevel[];
  /** each type's look, for a global weather's levels to blend between */
  looks: Record<CloudType, CloudsLook>;
  /** a global weather; null for a local one */
  global: CloudsGlobal | null;
  /**
   * the local weather they lie in: about its middle (where the World's anchor lies as it is
   * first drawn, unless it says), within its radius (world units)
   */
  local: { latitude?: number; longitude?: number; radius: number };
  /** the wind over the sea: each layer's, turned and strengthened aloft, unless it has its own */
  wind: WeatherWind | null;
  scale: number;
  density: number;
  color: Color;
  seed: number;
  /** how much they spend for how they look (cloudsQuality) */
  quality: CloudsQualityLevel;
  /** a local weather's clouds lit from light maps (see {@link CloudLightMap}) */
  lightMap: boolean;
  debug: SceneryCloudsDebug;
};

/**
 * The share of the light (the sun's, or the moon's) the scene's one light keeps through cloud
 * `levels` at `density`, the light's elevation having sine `sine`: each level's clouds letting
 * e^(−optical depth) of it through along the light's slant through them (most of a heaped
 * cumulus's thickness, more of a sheet's), weighed by its cover squared. Not the mean over the
 * ground, which is the cover itself: the one light stands for the sunlit ground as much as the
 * shaded where the clouds' shadows are not drawn, and dimmed by the mean a scattered sky read as
 * dull; squared, scattered cloud keeps most of the sun and overcast takes it.
 *
 * @group Components
 */
export function cloudsLight(
  levels: readonly CloudsLevel[],
  density: number,
  sine: number,
): number {
  let through = 1;
  for (const { layer, look } of levels) {
    const cover = MathUtils.clamp(layer.cover, 0, 1);
    if (cover <= 0) continue;
    const thickness = Math.max(Math.abs(layer.top - layer.base), 1);
    const depth =
      (look.extinction *
        Math.max(density, 0) *
        thickness *
        LIGHT_SLANT[layer.type]) /
      Math.max(sine, 0.05);
    through *= 1 - cover * cover * (1 - Math.exp(-depth));
  }
  return through;
}

// The clouds' image: premultiplied colour and alpha, and the distance to their front as depth
// (log2, over DEPTH_RANGE).
const createImage = () =>
  new WebGLRenderTarget(1, 1, {
    type: HalfFloatType,
    format: RGBAFormat,
    depthBuffer: true,
    depthTexture: new DepthTexture(1, 1, FloatType),
    minFilter: LinearFilter,
    magFilter: LinearFilter,
    generateMipmaps: false,
  });

// What lays the clouds' `image` over what is drawn (cloud-composite.glsl), at the
// depth of their front, times the sky's `intensity`.
const createCompositeMaterial = (
  name: string,
  image: WebGLRenderTarget,
  intensity: IUniform,
) =>
  new ShaderMaterial({
    name,
    vertexShader,
    fragmentShader: compositeShader,
    defines: {
      CLOUD_DEPTH_RANGE: DEPTH_RANGE,
      CLOUD_DEPTH_MARGIN: DEPTH_MARGIN,
    },
    uniforms: {
      uCloudImage: new Uniform<Texture>(image.texture),
      uCloudDepth: new Uniform<Texture | null>(image.depthTexture),
      uCloudImageSize: new Uniform(new Vector2(1, 1)),
      // A tent of four taps as the image is scaled up: there is no accumulation of frames.
      uCloudSoften: new Uniform(1),
      uCloudRays: new Uniform(new Vector4(1, 1, 0, 0)),
      uSkyIntensity: intensity,
    },
    transparent: true,
    depthTest: true,
    depthWrite: false,
    // ⚠️ Alpha as three's normal blending does, or the canvas turns see-through here.
    blending: CustomBlending,
    blendSrc: SrcAlphaFactor,
    blendDst: OneMinusSrcAlphaFactor,
    blendSrcAlpha: OneFactor,
    blendDstAlpha: OneMinusSrcAlphaFactor,
  });

const size = new Vector2();
const east = new Vector3();
const fromCentre = new Vector3();
const toWorld = new Matrix3();
const localOffset: [number, number] = [0, 0];
const cameraEarth = new Vector3();
const cameraAt = new Vector3();
const middleUp = new Vector3();
const wayEarth = new Vector3();
const axis = new Vector3();
const moved = new Vector3();
const here = new Vector3();
const broad = new Vector3();
const upTurned = new Vector3();
const clearColor = new Color();
// What draws a global weather's cover over the scene into its texel (readSceneCover).
const coverCamera = new Camera();
const shadowFoot = new Vector3();
const shadowCentre = new Vector3();
const shadowUp = new Vector3();
const shadowNorth = new Vector3();
const shadowEast = new Vector3();
const shadowDrift = new Vector3();
const readAt = new Vector3();
const lumpAt = new Vector3();
const drift = new Matrix4();
const carried = new Matrix3();
const stretched = new Matrix3();
const volumeTurn = new Matrix3().fromArray(VOLUME_TURN);
const patchesTurn = new Matrix3().fromArray(PATCHES_TURN);
const lumpsTurn = new Matrix3().fromArray(LUMPS_TURN);

// The interleaved march's parts (`temporal`): one pixel of each 2 × 2 block (x + 2 y), drawn in
// this order, diagonals first, so any two frames running cover the block evenly.
const PARTS = 4;
const PART_ORDER = [0, 3, 1, 2];
const viewNow = new Matrix4();
// `camera`'s projection times its view's turn alone, into `target`: a point from the camera
// (world) to clip space.
const partView = (camera: Camera, target: Matrix4) =>
  target
    .copy(camera.matrixWorldInverse)
    .setPosition(0, 0, 0)
    .premultiply(camera.projectionMatrix);

const levelVectors = () =>
  Array.from({ length: CLOUDS_LEVELS }, () => new Vector4());
const typeVectors = () => Array.from(TYPE_ROWS, () => new Vector4());

// Each type's cover map's quantiles, a row each (cloud-march.glsl, cloudPlace): half
// floats, which WebGL 2 filters linearly everywhere, as it does not 32-bit ones.
const createCoverTable = () => {
  const width = SOFT_COVER_QUANTILES + 1;
  const table = new DataTexture(
    new Uint16Array(width * TYPE_ROWS.length),
    width,
    TYPE_ROWS.length,
    RedFormat,
    HalfFloatType,
  );
  table.minFilter = LinearFilter;
  table.magFilter = LinearFilter;
  table.wrapS = ClampToEdgeWrapping;
  table.wrapT = ClampToEdgeWrapping;
  table.generateMipmaps = false;
  table.needsUpdate = true;
  return table;
};

/**
 * The 3D clouds of a `SceneryClouds` (see `documents/clouds.md`): up to three levels of a
 * local weather, or of a global one's weather systems, each rounded masses from a map of the
 * cover fixed to the Earth drawn as its type's look says, marched along each pixel's view at a
 * share of the screen's resolution, and laid over the scene at the depth of their front every
 * frame. Marched again only as what they are marched from changes: the camera, the clock, the
 * light, the weather. Drawn from its {@link composite}'s `onBeforeRender`, with the camera
 * drawing it.
 */
export class CloudsRenderer implements ScenerySkyOverlay {
  /** drawn in the scene, last (`LAYERS.OVERLAY` in an `OITRenderPass`) */
  readonly composite: Mesh;
  readonly compositeMaterial: ShaderMaterial;
  /**
   * The weather's time (seconds) the clouds are drawn at: they drift with each level's wind.
   * Set each frame (`SceneryClouds`: its `Weather`'s clock).
   */
  time = 0;
  /** How fast the weather's clock runs (its seconds a second; 0 stood). Set each frame with {@link time}. */
  rate = 1;
  private readonly sky: SceneryMaterial;
  private readonly marchScene = new Scene();
  private readonly target = createImage();
  // The cover volume the levels read, drawn once they are.
  private readonly coverVolume = new CloudCoverVolume();
  // A global weather's maps of the weather systems, and each type's quantiles of the cover map
  // (and what they were filled for).
  private readonly weather: CloudWeather;
  /** the ground under the clouds, the scenery's (see {@link CloudGround}): none until given one */
  readonly terrain = new CloudGround();
  /** a local weather's light maps (see {@link CloudLightMap}) */
  readonly lightMaps = new CloudLightMap(CLOUDS_LEVELS);
  /** a local weather's cover maps (see {@link CloudCoverMap}) */
  readonly coverMap = new CloudCoverMap();
  /** a global weather's cloud map and types about the camera (see {@link CloudPlaceMap}) */
  readonly placeMap = new CloudPlaceMap();
  // Counts the settings set: the light maps are drawn anew for each.
  private settingsSerial = 0;
  // Each level's wind on the field: the way it blows toward (east, north) times its speed (m/s).
  private readonly levelWinds = Array.from(
    { length: CLOUDS_LEVELS },
    () => new Vector2(),
  );
  private readonly coverTable = createCoverTable();
  private coverTableKey = '';
  private settings: CloudsSettings | null = null;
  // The noise volume of the renderer drawing it (one at a time).
  private volumes: {
    renderer: WebGLRenderer;
    noise: CloudNoiseVolumes;
  } | null = null;
  // World -> fixed on the Earth, and the scene's true east and north there, fixed on the Earth.
  private readonly earth = new Matrix3();
  private readonly eastEarth = new Vector3(0, 1, 0);
  private readonly northEarth = new Vector3(0, 0, 1);
  private globeVersion = -1;
  // A local weather's middle as the World's anchor lay when it was first drawn (degrees), kept
  // as the anchor moves; null while the weather says where.
  private localAnchor: { latitude: number; longitude: number } | null = null;
  // The field's axes in the world: east, north and up at the weather's middle.
  private readonly frameE = new Vector3(1, 0, 0);
  private readonly frameN = new Vector3(0, 0, -1);
  private readonly frameM = new Vector3(0, 1, 0);

  // What the march was last drawn from (marchUnchanged), whether it was drawn since anything
  // else could have changed (settings, a frame it was not drawn in), and the uniforms its
  // program reads, by the program they were found for.
  private readonly marchInputs = new MarchInputs();
  private marchDrawn = false;
  private marchProgram: object | null = null;
  private marchNames: string[] = [];

  /**
   * How the march reuses what it drew over the last frames (`SceneryCloudsTemporal`):
   * `'off'` every pixel every frame; else one pixel of each 2 × 2 block a frame (a part, each in
   * turn), each part into an image of its own, the full image rebuilt from the four
   * (cloud-rebuild.glsl).
   */
  temporal: SceneryCloudsTemporal = 'off';
  /** the interleaved march's rebuild (`temporal`): compile it before it draws */
  readonly rebuild: Mesh;
  private readonly rebuildMaterial: ShaderMaterial;
  private readonly rebuildScene = new Scene();
  // The interleaved march's parts, each with the camera it was drawn from (its projection times
  // its view's turn, where it was, and the pose it was drawn at: poseSerial) and whether it holds
  // a march; the part drawn next; how many were drawn from what the march is drawn from now
  // (marchUnchanged); the mode last drawn; the camera last drawn for (cameraMoved) and its pose,
  // counted up as it moves.
  private readonly parts = Array.from({ length: 4 }, createImage);
  private readonly partViews = Array.from({ length: 4 }, () => new Matrix4());
  private readonly partAt = Array.from({ length: 4 }, () => new Vector3());
  private readonly partPose = [-1, -1, -1, -1];
  private readonly partHeld = [false, false, false, false];
  private phase = 0;
  private partsFresh = 0;
  private temporalDrawn: SceneryCloudsTemporal = 'off';
  private readonly cameraSeen: number[] = [];
  private poseSerial = 0;
  // The pose the full march last drew at (`'still'` as the camera moved), and what splits its
  // image into the parts as it stops.
  private fullPose = -1;
  private readonly splitMaterial: ShaderMaterial;
  private readonly splitScene = new Scene();

  // For the scene's light (ScenerySkyOverlay): what they look like from the scene, how much of
  // its light they let through, their shadows and what the sea reflects of them.
  /** counts changes to what they look like, but for the sky's own: the bakes are drawn again */
  version = 0;
  /** how much of the light (the sun's, or the moon's) the scene's light keeps past them */
  light = 1;
  /** their shadows about the camera (updateShadow); null for none */
  shadow: ScenerySkyShadow | null = null;
  /** what the sea reflects of them away from where they were filmed (updateReflection) */
  readonly reflection: ScenerySkyReflection = {
    base: 0,
    map: null,
    earth: new Matrix3(),
    texels: 0,
    strength: 0,
    near: REFLECTION_NEAR,
    far: REFLECTION_FAR,
  };
  /** the film's composite, each face's march laid into it (`film`): compile it before it films */
  readonly still: Mesh;
  /**
   * The film's march: each run through a level taken whole (CLOUD_FILM: 0.6–1.1 ms the six
   * faces), or (false) marched as the view is (3.8–6.7 ms; Iris Xe, 2026-11-10). Compile
   * {@link filmMesh} before it films.
   */
  filmWhole = true;
  private readonly filmMarchScene = new Scene();

  // The march's own defines and uniforms, which its film and its shadows share: each mode's
  // programs read the same uniform objects, set once for all of them.
  private readonly geometry = createSceneryGeometry();
  private readonly marchDefines: Record<string, unknown>;
  private readonly marchUniforms: Record<string, IUniform>;
  private readonly shadowUniforms: Record<string, IUniform>;
  // The march's, its film's and its shadows' programs for a local weather and for a global one
  // (CLOUD_GLOBAL), each made the first time it is asked for and kept, and those drawn. Flipping
  // the define on one set instead, the next draw compiled the other mode's three, and three let
  // go of the mode left: each switch stood the page for 9–13 s (Iris Xe, 2026-11-11).
  private readonly modes: { local?: CloudsPrograms; global?: CloudsPrograms } =
    {};
  private programs: CloudsPrograms;

  /** the march, drawn into the clouds' own image as the composite is drawn: its mode's ({@link programsOf}) */
  get march(): Mesh {
    return this.programs.march;
  }
  /** the march's program: its uniforms are every mode's, its film's and, with more, its shadows' */
  get marchMaterial(): ShaderMaterial {
    return this.programs.march.material as ShaderMaterial;
  }
  /** the film's own march (`filmWhole`), its mode's: compile it before it films */
  get filmMesh(): Mesh {
    return this.programs.film;
  }
  /** the shadows' pass (`updateShadow`), its mode's: compile it before it draws */
  get shadowMesh(): Mesh {
    return this.programs.shadow;
  }

  /** Samples across each level toward the light, a texel of the shadows: drawn anew as it changes. */
  get shadowSamples(): number {
    return this.shadowUniforms.uCloudShadowSamples.value as number;
  }
  set shadowSamples(value: number) {
    const samples = Math.max(Math.round(value), 1);
    const u = this.shadowUniforms.uCloudShadowSamples;
    if (u.value === samples) return;
    u.value = samples;
    this.shadowDrawn.valid = false;
  }
  private readonly filmTarget = new WebGLCubeRenderTarget(FILM_SIZE, {
    type: HalfFloatType,
    generateMipmaps: true,
    minFilter: LinearMipmapLinearFilter,
  });
  private readonly filmCamera = new CubeCamera(1, 1e7, this.filmTarget);
  private readonly filmScene = new Scene();
  private readonly stillImage = createImage();
  private readonly stillMaterial: ShaderMaterial;
  // What the film was last drawn for: where, at which version (the clouds' drift and lives
  // counted in it: updateFilm) and with the sun where (within FILM_TURN). The bakes film twice,
  // the environment's and the probe's, from the same place, and again as the sun moves on the
  // weather's clock: in a few minutes, what lights the clouds hardly changes.
  private readonly filmedAt = new Vector3(NaN, NaN, NaN);
  private filmedVersion = -1;
  private readonly filmedSun = new Vector3();
  // Whether they show (filmable); when the film was last due as the clock ran (weather seconds,
  // and wall ms); the light last told the bakes; the weather's and the ground's versions counted;
  // whether the cover is drawn (render).
  private shown = false;
  private filmTime = 0;
  private filmWall = 0;
  private lightTold = 1;
  private weatherSeen = -1;
  private terrainSeen = -1;
  private levelsReady = false;
  private readonly shadowTarget = new WebGLRenderTarget(
    SHADOW_SIZE,
    SHADOW_SIZE,
    {
      type: UnsignedByteType,
      format: RedFormat,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      depthBuffer: false,
      generateMipmaps: false,
    },
  );
  private readonly shadowScene = new Scene();
  // What the shadows were drawn for.
  private readonly shadowDrawn = {
    valid: false,
    version: -1,
    terrain: -1,
    globe: -1,
    light: new Vector3(),
    centre: new Vector3(),
    reach: 0,
    time: 0,
  };
  // A global weather's cover over the scene (readSceneCover): low, thickness, middle, high, -1
  // until read; what it was read for.
  private readonly sceneCover = new Vector4(-1, 0, 0, 0);
  private readonly sceneCoverFor: { map: Texture | null; globe: number } = {
    map: null,
    globe: -1,
  };
  private sceneCoverReading = false;
  private readonly sceneCoverTarget = new WebGLRenderTarget(1, 1, {
    depthBuffer: false,
  });
  private readonly sceneCoverMaterial: ShaderMaterial;
  private readonly sceneCoverScene = new Scene();
  private readonly sceneCoverPixel = new Uint8Array(4);

  constructor(sky: SceneryMaterial, renderOrder: number) {
    this.sky = sky;
    const geometry = this.geometry;

    this.marchDefines = {
      CLOUD_DEPTH_RANGE: DEPTH_RANGE,
      CLOUD_LEVELS_MOST: CLOUDS_LEVELS,
      CLOUD_COVER_SIZE: CLOUD_COVER_VOLUME_SIZE.toFixed(1),
      CLOUD_COVER_LODS,
      CLOUD_LUMP_TILES: VOLUME_LUMP_TILES.toFixed(4),
      CLOUD_PATCHES_TURN: glslMat3(PATCHES_TURN),
      CLOUD_PATCHES_BROADER: CLOUD_COVER_PATCHES.broader.toFixed(1),
      CLOUD_PATCHES_FINE: CLOUD_COVER_PATCHES.fine.toFixed(3),
      CLOUD_LUMPS_TURN: glslMat3(LUMPS_TURN),
      CLOUD_TYPES: TYPE_ROWS.length,
      CLOUD_QUANTILES: SOFT_COVER_QUANTILES,
    };
    this.marchUniforms = {
      // The sky's own uniform objects: the sun, the air, the globe.
      ...sky.uniforms,
      uCloudShape: new Uniform<Texture | null>(null),
      uCloudCover: new Uniform<Texture>(this.coverVolume.target.texture),
      // The spread each level of the cover volume's mipmaps averages away (CloudCoverVolume.spread).
      uCloudCoverSpread: new Uniform(
        Array.from({ length: CLOUD_COVER_LODS }, () => new Vector2()),
      ),
      uCloudFrameE: new Uniform(this.frameE),
      uCloudFrameN: new Uniform(this.frameN),
      uCloudFrameM: new Uniform(this.frameM),
      uCloudCamera: new Uniform(new Vector3()),
      uCloudInvRadius: new Uniform(0),
      uCloudLocalRadius: new Uniform(1),
      uCloudLocalShape: new Uniform(new Vector2(LOCAL_FADE, LOCAL_WOBBLE)),
      uCloudScale: new Uniform(1),
      uCloudLevelCount: new Uniform(0),
      uCloudShells: new Uniform(levelVectors()),
      uCloudNeeds: new Uniform(levelVectors()),
      uCloudLooks: new Uniform(levelVectors()),
      uCloudTurns: new Uniform(
        Array.from({ length: CLOUDS_LEVELS }, () => new Matrix3()),
      ),
      uCloudPlaces: new Uniform(
        Array.from({ length: 4 * CLOUDS_LEVELS }, () => new Vector3()),
      ),
      uCloudKinds: new Uniform(levelVectors()),
      uCloudWinds: new Uniform(levelVectors()),
      uCloudCovers: new Uniform(new Array<number>(CLOUDS_LEVELS).fill(0)),
      ...this.terrain.uniforms,
      ...this.lightMaps.uniforms,
      ...this.coverMap.uniforms,
      ...this.placeMap.uniforms,
      uCloudMap: new Uniform<CubeTexture | null>(null),
      uCloudMapNext: new Uniform<CubeTexture | null>(null),
      uCloudTypes: new Uniform<CubeTexture | null>(null),
      uCloudTypesNext: new Uniform<CubeTexture | null>(null),
      uCloudMapTimes: new Uniform(new Vector3()),
      uCloudFieldEarth: new Uniform(new Matrix3()),
      uCloudEarthRadius: new Uniform(1),
      uCloudMapTexels: new Uniform(0),
      uCloudCoverTable: new Uniform<Texture>(this.coverTable),
      uCloudTypeLooks: new Uniform(typeVectors()),
      uCloudTypeHeights: new Uniform(typeVectors()),
      uCloudTypeMore: new Uniform(typeVectors()),
      uCloudGlobal: new Uniform(new Vector4(0, 1, 1, 0)),
      uCloudMarch: new Uniform(new Vector4(32, 12.8, STEP_DEPTH, 1e-3)),
      uCloudStepScale: new Uniform(1),
      uCloudLightSamples: new Uniform(2),
      uCloudDetail: new Uniform(new Vector3(...DETAIL)),
      uCloudPhase: new Uniform(new Vector4(...PHASE)),
      uCloudScatter: new Uniform(new Vector3(...SCATTER)),
      uCloudMarchMost: new Uniform(0),
      uCloudDebug: new Uniform(0),
      uCloudAir: new Uniform(1),
      // The interleaved march's (`temporal`): set for its draws alone, then put back.
      uCloudRays: new Uniform(new Vector4(1, 1, 0, 0)),
      uCloudDerivative: new Uniform(1),
      uCloudColor: new Uniform(new Color(1, 1, 1)),
    };
    const u = this.marchUniforms;
    this.weather = new CloudWeather({
      uCloudMap: u.uCloudMap,
      uCloudMapNext: u.uCloudMapNext,
      uCloudTypes: u.uCloudTypes,
      uCloudTypesNext: u.uCloudTypesNext,
      uCloudMapTimes: u.uCloudMapTimes,
    });
    // The shadows' own, over the march's.
    this.shadowUniforms = {
      ...u,
      uCloudShadowPlace: new Uniform(new Vector4()),
      uCloudShadowEast: new Uniform(new Vector3(1, 0, 0)),
      uCloudShadowNorth: new Uniform(new Vector3(0, 0, -1)),
      uCloudShadowSize: new Uniform(SHADOW_SIZE),
      uCloudShadowSamples: new Uniform(SHADOW_SAMPLES),
    };
    // A local weather's programs until set says otherwise.
    this.programs = this.modeOf(false);
    this.marchScene.add(this.programs.march);
    this.filmMarchScene.add(this.programs.film);
    this.shadowScene.add(this.programs.shadow);

    this.compositeMaterial = createCompositeMaterial(
      'scenery-clouds',
      this.target,
      sky.uniforms.uSkyIntensity,
    );
    this.composite = new Mesh(geometry, this.compositeMaterial);
    this.composite.name = 'scenery-clouds';
    this.composite.frustumCulled = false;
    this.composite.renderOrder = renderOrder;
    this.composite.visible = false;
    this.composite.layers.enable(LAYERS.OVERLAY);
    // For debugging and profiling from the scene graph.
    this.composite.userData.clouds = this;
    this.composite.onBeforeRender = (renderer, _scene, camera) =>
      this.render(renderer, camera);

    // The interleaved march's image, rebuilt from its parts (`temporal`).
    const partUniforms: Record<string, IUniform> = {};
    this.parts.forEach((part, k) => {
      partUniforms[`uCloudPart${k}`] = new Uniform<Texture>(part.texture);
      partUniforms[`uCloudPartDepth${k}`] = new Uniform<Texture | null>(
        part.depthTexture,
      );
    });
    this.rebuildMaterial = new ShaderMaterial({
      name: 'scenery-clouds-rebuild',
      vertexShader,
      fragmentShader: rebuildShader,
      defines: { CLOUD_DEPTH_RANGE: DEPTH_RANGE },
      uniforms: {
        ...partUniforms,
        uCloudRays: new Uniform(new Vector4(1, 1, 0, 0)),
        uCloudPartView: new Uniform(this.partViews),
        uCloudPartUnview: new Uniform(
          Array.from({ length: 4 }, () => new Matrix4()),
        ),
        uCloudPartAt: new Uniform(
          Array.from({ length: 4 }, () => new Vector3()),
        ),
        uCloudPartState: new Uniform(
          Array.from({ length: 4 }, () => new Vector2()),
        ),
        uCloudPhase: new Uniform(0),
        uCloudImageSize: new Uniform(new Vector2(1, 1)),
        uCloudPartSize: new Uniform(new Vector2(1, 1)),
      },
      depthTest: true,
      depthFunc: AlwaysDepth,
      depthWrite: true,
      blending: NoBlending,
    });
    this.rebuild = new Mesh(geometry, this.rebuildMaterial);
    this.rebuild.frustumCulled = false;
    this.rebuild.layers.enableAll();
    this.rebuildScene.add(this.rebuild);
    // The full image split into the parts: each part's pixel of each 2 × 2 block.
    this.splitMaterial = new ShaderMaterial({
      name: 'scenery-clouds-split',
      vertexShader: /* glsl */ `
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`,
      fragmentShader: /* glsl */ `
uniform sampler2D uCloudImage;
uniform sampler2D uCloudDepth;
uniform vec2 uCloudOffset;
void main() {
  ivec2 at = min(ivec2(gl_FragCoord.xy) * 2 + ivec2(uCloudOffset), textureSize(uCloudImage, 0) - 1);
  gl_FragColor = texelFetch(uCloudImage, at, 0);
  gl_FragDepth = texelFetch(uCloudDepth, at, 0).r;
}`,
      uniforms: {
        uCloudImage: new Uniform<Texture>(this.target.texture),
        uCloudDepth: new Uniform<Texture | null>(this.target.depthTexture),
        uCloudOffset: new Uniform(new Vector2()),
      },
      depthTest: true,
      depthFunc: AlwaysDepth,
      depthWrite: true,
      blending: NoBlending,
    });
    const splitMesh = new Mesh(geometry, this.splitMaterial);
    splitMesh.frustumCulled = false;
    splitMesh.layers.enableAll();
    this.splitScene.add(splitMesh);

    // The film: each face's march laid into it, as a still, without the sky's intensity.
    this.stillMaterial = createCompositeMaterial(
      'scenery-clouds-still',
      this.stillImage,
      new Uniform(1),
    );
    this.still = new Mesh(geometry, this.stillMaterial);
    this.still.frustumCulled = false;
    this.still.onBeforeRender = (renderer, _scene, camera) =>
      this.renderStill(renderer, camera);
    this.filmScene.add(this.still);

    // A global weather's cover over the scene: its newer map read at the scene's up, over some
    // 40 km (its third level), into one texel read back (readSceneCover).
    this.sceneCoverMaterial = new ShaderMaterial({
      name: 'scenery-clouds-scene-cover',
      vertexShader: /* glsl */ `
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`,
      fragmentShader: /* glsl */ `
uniform samplerCube uCloudMap;
uniform vec3 uCloudSceneUp;
void main() {
  gl_FragColor = textureLod(uCloudMap, uCloudSceneUp, 2.0);
}`,
      uniforms: {
        uCloudMap: new Uniform<CubeTexture | null>(null),
        uCloudSceneUp: new Uniform(new Vector3(0, 0, 1)),
      },
      depthTest: false,
      depthWrite: false,
      blending: NoBlending,
    });
    const coverMesh = new Mesh(geometry, this.sceneCoverMaterial);
    coverMesh.frustumCulled = false;
    this.sceneCoverScene.add(coverMesh);
  }

  /** Draw `settings` from the next frame on. */
  set(settings: CloudsSettings) {
    this.settings = settings;
    this.marchDrawn = false;
    this.settingsSerial++;
    const u = this.marchMaterial.uniforms;
    // A local weather's middle as the anchor lies now, until it says.
    if (
      settings.local.latitude !== undefined &&
      settings.local.longitude !== undefined
    )
      this.localAnchor = null;
    this.globeVersion = -1;

    // What they look like changed: the bakes are drawn again.
    this.version++;

    const global = settings.global;
    // The mode's programs drawn: compiled first (programsOf), the switch compiles nothing.
    const programs = this.modeOf(!!global);
    if (programs !== this.programs) {
      const was = this.programs;
      this.marchScene.remove(was.march);
      this.filmMarchScene.remove(was.film);
      this.shadowScene.remove(was.shadow);
      this.marchScene.add(programs.march);
      this.filmMarchScene.add(programs.film);
      this.shadowScene.add(programs.shadow);
      this.programs = programs;
    }
    // A local weather's maps let go of, what draws them kept.
    if (!global) this.weather.clear();
    (u.uCloudGlobal.value as Vector4).set(
      global?.dominance ?? 0,
      global?.types === false ? 0 : 1,
      global?.thickness === false ? 0 : 1,
      0,
    );
    this.coverTableKey = '';
    const texel = VOLUME_TILE / CLOUD_COVER_VOLUME_SIZE;

    const scale = settings.scale;
    const quality = settings.quality;
    const levels = settings.levels.slice(0, CLOUDS_LEVELS);
    u.uCloudLevelCount.value = levels.length;
    u.uCloudLocalRadius.value = settings.local.radius;
    u.uCloudScale.value = scale;
    // Each level's shell, above the one under it, and its look: a thin level takes fewer steps.
    let under = -Infinity;
    levels.forEach(({ layer, look }, k) => {
      const base = Math.max(Math.min(layer.base, layer.top), under);
      const top = Math.max(layer.top, base + 1);
      under = top;
      // Its kind: its chain's first row and last place, its channel of the cloud map, its index.
      const level = cloudLevelOf(layer.type);
      const chain = global ? CLOUDS_CHAINS[level] : [layer.type];
      (u.uCloudKinds.value[k] as Vector4).set(
        TYPE_ROWS.indexOf(chain[0]),
        chain.length - 1,
        CLOUD_LEVELS.indexOf(level),
        k,
      );
      // A local weather's cover, for the ground to gain on or lose (cloudSet).
      (u.uCloudCovers.value as number[])[k] = global
        ? 0
        : MathUtils.clamp(layer.cover, 0, 1);
      // As thin as its densest type.
      const densest = global
        ? Math.max(...chain.map(type => settings.looks[type].extinction))
        : look.extinction;
      const extinction = densest * settings.density;
      const deep = MathUtils.clamp((extinction * (top - base)) / DEEP, 0.25, 1);
      (u.uCloudShells.value[k] as Vector4).set(
        base,
        top,
        extinction,
        Math.max(Math.round(quality.steps * deep), 4),
      );
      const reach = scale * look.scale;
      (u.uCloudLooks.value[k] as Vector4).set(
        look.masses,
        0,
        CHUNK * reach,
        texel * reach,
      );
    });
    const layerSteps = Math.max(quality.steps * LAYER_STEPS, 2);
    const stepDepth = (STEP_DEPTH * 32) / Math.max(quality.steps, 1);
    (u.uCloudMarch.value as Vector4).set(
      Math.max(Math.round(quality.steps), 1),
      layerSteps,
      stepDepth,
      (u.uCloudMarch.value as Vector4).w,
    );
    u.uCloudLightSamples.value = Math.max(Math.round(quality.lightSamples), 1);
    // The march's turns at most (cloud-march.glsl, cloudMarchRuns), so none is cut short:
    // two runs a level, each its layout's stretches looked into and halved down to a step where
    // they may hold cloud, its depth's steps, and those through cloud until the view is hidden
    // (some 3 of optical depth, a step's each, and the steps walked again on entering it).
    u.uCloudMarchMost.value = Math.ceil(
      (u.uCloudShells.value as Vector4[])
        .slice(0, levels.length)
        .reduce(
          (most, shell) =>
            most + 2 * (4 * shell.w + layerSteps + 8 / stepDepth + 32),
          0,
        ) / Math.min(u.uCloudStepScale.value as number, 1),
    );
    u.uCloudDebug.value =
      settings.debug.view === 'cost'
        ? 1
        : settings.debug.view === 'unlit'
          ? 2
          : settings.debug.view === 'map'
            ? 3
            : 0;
    u.uCloudAir.value = settings.debug.air === false ? 0 : 1;
    (u.uCloudColor.value as Color).copy(settings.color);
  }

  /**
   * The march's, its film's and its shadows' programs for a local weather or a global one
   * (`global`), made the first time: compile them before {@link set} switches to that mode, or
   * the first frame drawn with them compiles them, standing the page for seconds.
   */
  programsOf(global: boolean): readonly Mesh[] {
    const programs = this.modeOf(global);
    return [programs.march, programs.film, programs.shadow];
  }

  private modeOf(global: boolean): CloudsPrograms {
    const mode = global ? 'global' : 'local';
    return (this.modes[mode] ??= this.makePrograms(global));
  }

  // A mode's programs: the march's own code on its uniforms (the same objects), its film's runs
  // taken whole (CLOUD_FILM) and its shadows' main the pass's (CLOUD_SHADOW). Each drawn with
  // whatever layers the camera has on.
  private makePrograms(global: boolean): CloudsPrograms {
    const defines = global
      ? { ...this.marchDefines, CLOUD_GLOBAL: '' }
      : { ...this.marchDefines };
    const mesh = (material: ShaderMaterial) => {
      const drawn = new Mesh(this.geometry, material);
      drawn.frustumCulled = false;
      drawn.layers.enableAll();
      return drawn;
    };
    // Every pixel writes its depth: the distance to the clouds' front.
    const marched = {
      vertexShader,
      fragmentShader: marchShader,
      uniforms: this.marchUniforms,
      depthTest: true,
      depthFunc: AlwaysDepth,
      depthWrite: true,
      blending: NoBlending,
    };
    return {
      march: mesh(
        new ShaderMaterial({
          name: 'scenery-clouds-march',
          defines,
          ...marched,
        }),
      ),
      film: mesh(
        new ShaderMaterial({
          name: 'scenery-clouds-film',
          defines: { ...defines, CLOUD_FILM: '' },
          ...marched,
        }),
      ),
      shadow: mesh(
        new ShaderMaterial({
          name: 'scenery-clouds-shadow',
          vertexShader,
          fragmentShader: marchShader,
          defines: { ...defines, CLOUD_SHADOW: '' },
          uniforms: this.shadowUniforms,
          depthTest: false,
          depthWrite: false,
          blending: NoBlending,
        }),
      ),
    };
  }

  /** Whether there is anything to draw: a level with cover. */
  get cloudy(): boolean {
    return (this.settings?.levels.length ?? 0) > 0;
  }

  // The frame fixed on the Earth (world -> Earth), and the scene's true east and north in it.
  private updateEarth(globe: Globe) {
    earthFrame(globe, this.earth);
    // The Earth's directions of the scene's east and north.
    const sphere = globe.uniforms.uGlobeSphere.value;
    const located = sphere.w > 0.5;
    const sinChi = located ? sphere.x : 0;
    const cosChi = located ? sphere.y : 1;
    const lambda = located ? globe.uniforms.uGlobeLocation.value.x : 0;
    const sinL = Math.sin(lambda);
    const cosL = Math.cos(lambda);
    this.eastEarth.set(-sinL, cosL, 0);
    this.northEarth.set(-sinChi * cosL, -sinChi * sinL, cosChi);
  }

  // The field's axes in the world: east, north and up at the local weather's middle (where it
  // says, else where the World's anchor lay as it was first drawn, kept as the anchor moves),
  // and where that middle lies. Without the Earth's frame (or with the globe off), the scene's
  // own, about the disc's centre.
  private updateFrame(globe: Globe) {
    if (globe.version === this.globeVersion) return;
    this.globeVersion = globe.version;
    this.updateEarth(globe);
    const local = this.settings!.local;
    const given =
      local.latitude !== undefined && local.longitude !== undefined
        ? { latitude: local.latitude, longitude: local.longitude }
        : null;
    if (!given && !this.localAnchor && globe.location)
      this.localAnchor = { ...globe.location };
    const place = given ?? this.localAnchor;
    const origin = globe.conformalOrigin;
    east.crossVectors(globe.north, globe.up).normalize();
    if (!globe.enabled || !place || !origin) {
      this.frameE.copy(east);
      this.frameN.copy(globe.north);
      this.frameM.copy(globe.up);
      return;
    }
    // On the conformal sphere the frame fixed on the Earth is built on.
    conformalOffset(origin, place.latitude, place.longitude, localOffset);
    const chi = origin.sphere.chi0 + localOffset[0];
    const lambda = origin.longitude0 + localOffset[1];
    const sinChi = Math.sin(chi);
    const cosChi = Math.cos(chi);
    const sinL = Math.sin(lambda);
    const cosL = Math.cos(lambda);
    // Back from the Earth's frame to the world's: the frame's transpose (a rotation).
    toWorld.copy(this.earth).transpose();
    this.frameE.set(-sinL, cosL, 0).applyMatrix3(toWorld);
    this.frameN
      .set(-sinChi * cosL, -sinChi * sinL, cosChi)
      .applyMatrix3(toWorld);
    this.frameM.set(cosChi * cosL, cosChi * sinL, sinChi).applyMatrix3(toWorld);
  }

  // Where `camera` lies on the field's frame (64-bit, then the shader's single precision), each
  // level's map on the field (turned with its wind, stretched along it) and how far its wind has
  // carried it at `time`; and the angle a pixel of the image `height` texels high spans.
  private updateCamera(camera: Camera, height: number) {
    const settings = this.settings!;
    const globe = this.sky.globe;
    this.updateFrame(globe);
    const u = this.marchMaterial.uniforms;
    const radius = globe.radius;
    fromCentre.setFromMatrixPosition(camera.matrixWorld);
    if (globe.enabled) {
      fromCentre.sub(globe.centre);
      (u.uCloudCamera.value as Vector3).set(
        fromCentre.dot(this.frameE),
        fromCentre.dot(this.frameN),
        fromCentre.dot(this.frameM) - radius,
      );
      u.uCloudInvRadius.value = 1 / radius;
    } else {
      fromCentre.sub(globe.discCentre);
      (u.uCloudCamera.value as Vector3).set(
        fromCentre.dot(this.frameE),
        fromCentre.dot(this.frameN),
        fromCentre.dot(this.frameM),
      );
      u.uCloudInvRadius.value = 0;
    }

    // Each level's wind at its height, at the scene's latitude: the way it blows toward on the
    // field (east, north), its map turned to it and stretched along it, and the map's drift (in
    // tiles, wrapped: 64-bit here, so it keeps its precision however long the clock runs).
    const latitude = globe.location?.latitude ?? 45;
    const time = this.time;
    // The field's frame to the Earth's (columns: east, north and up at the weather's middle,
    // fixed on the Earth), and the camera fixed on the Earth (64-bit): from the Earth's centre,
    // or with the globe off from the disc's.
    toWorld
      .set(
        this.frameE.x,
        this.frameN.x,
        this.frameM.x,
        this.frameE.y,
        this.frameN.y,
        this.frameM.y,
        this.frameE.z,
        this.frameN.z,
        this.frameM.z,
      )
      .premultiply(this.earth);
    (u.uCloudFieldEarth.value as Matrix3).copy(toWorld);
    u.uCloudEarthRadius.value = radius;
    const onField = u.uCloudCamera.value as Vector3;
    cameraEarth
      .set(onField.x, onField.y, onField.z + (globe.enabled ? radius : 0))
      .applyMatrix3(toWorld);
    middleUp.set(0, 0, 1).applyMatrix3(toWorld);
    const places = u.uCloudPlaces.value as Vector3[];
    settings.levels.slice(0, CLOUDS_LEVELS).forEach(({ layer, look }, k) => {
      const wind = cloudLayerWind(layer, settings.wind, latitude);
      const toward = (((wind?.from ?? 0) + 180) * Math.PI) / 180;
      const speed = wind?.speed ?? 0;
      const ae = Math.sin(toward);
      const an = Math.cos(toward);
      this.levelWinds[k].set(ae * speed, an * speed);

      // Its pattern on the Earth (the cover volume's): from metres fixed on the Earth to the
      // volume's tiles, turned as its wind has carried it about the Earth's centre (so it
      // drifts along the surface, neither rising nor sinking through it; with the globe off,
      // moved along the plane), stretched along the wind, the volume's lattice turned; and
      // where the camera lies in it, in the cover, its broad read and the lumps' two tilings.
      const tile = VOLUME_TILE * settings.scale * look.scale;
      wayEarth.set(ae, an, 0).applyMatrix3(toWorld);
      (u.uCloudWinds.value[k] as Vector4).set(
        wayEarth.x,
        wayEarth.y,
        wayEarth.z,
        speed,
      );
      moved.set(0, 0, 0);
      if (globe.enabled) {
        drift.makeRotationAxis(
          axis.crossVectors(middleUp, wayEarth).normalize(),
          -(speed * time) / radius,
        );
        carried.setFromMatrix4(drift);
      } else {
        carried.identity();
        moved.copy(wayEarth).multiplyScalar(speed * time);
      }
      const stretch = 1 / Math.max(look.stretch, 1e-3) - 1;
      const w = wayEarth;
      stretched
        .set(
          1 + stretch * w.x * w.x,
          stretch * w.x * w.y,
          stretch * w.x * w.z,
          stretch * w.y * w.x,
          1 + stretch * w.y * w.y,
          stretch * w.y * w.z,
          stretch * w.z * w.x,
          stretch * w.z * w.y,
          1 + stretch * w.z * w.z,
        )
        .premultiply(volumeTurn);
      const turn = (u.uCloudTurns.value as Matrix3[])[k]
        .multiplyMatrices(stretched, carried)
        .multiplyScalar(1 / tile);
      const at = here
        .copy(cameraEarth)
        .applyMatrix3(turn)
        .sub(moved.applyMatrix3(stretched).divideScalar(tile));
      const wrap = (target: Vector3, v: Vector3, j: number) =>
        target.set(
          fract(v.x + 0.371 * k + 0.137 * j),
          fract(v.y + 0.719 * k + 0.293 * j),
          fract(v.z + 0.137 * k + 0.611 * j),
        );
      // How its clouds form and fade (its look's lifetime): the cover read on through its
      // noise at `pace` (m/s), so a cloud LIFE_SIZE across comes and goes in a lifetime, a
      // broader one lasting as much longer, and the lumps read on down through theirs at their
      // `rise`, so they rise through the cloud. Along the up at the weather's middle (turned:
      // the up where the field reads the pattern), added here in 64 bits, so exact however long
      // the clock runs; far round the Earth, where that up lies along the ground, a drift of
      // `pace`. Read on along each column's own up instead, the pattern grew as the sphere it
      // is read on shrank; faded between two reads so read, it cost a third more.
      const pace =
        (LIFE_SIZE * settings.scale * look.scale) / Math.max(look.lifetime, 1);
      upTurned.copy(middleUp).applyMatrix3(turn);
      const read = readAt.copy(at).addScaledVector(upTurned, -pace * time);
      const p = 4 * k;
      wrap(places[p], read, 0);
      wrap(
        places[p + 1],
        broad
          .copy(read)
          .applyMatrix3(patchesTurn)
          .divideScalar(CLOUD_COVER_PATCHES.broader),
        1,
      );
      lumpAt.copy(at).addScaledVector(upTurned, -look.rise * time);
      wrap(
        places[p + 2],
        broad.copy(lumpAt).multiplyScalar(VOLUME_LUMP_TILES),
        2,
      );
      wrap(
        places[p + 3],
        broad
          .copy(lumpAt)
          .applyMatrix3(lumpsTurn)
          .multiplyScalar(VOLUME_LUMP_TILES / LUMP_BROADER),
        3,
      );
    });

    // A global weather's: the cloud map's texels a metre.
    if (settings.global)
      u.uCloudMapTexels.value = CLOUD_MAP_SIZE / (2 * radius);

    // The angle a pixel of the clouds' image spans, at the middle of the view. Its magnitude:
    // a CubeCamera's faces are drawn with a field of view of −90°.
    const focal = Math.abs(camera.projectionMatrix.elements[5]);
    (u.uCloudMarch.value as Vector4).w = 2 / (Math.max(focal, 1e-6) * height);
  }

  /**
   * The noise volume `renderer` draws it with: acquired the first time, not drawn yet. Compile
   * their generator, then {@link generate} them before it shows.
   */
  noise(renderer: WebGLRenderer): CloudNoiseVolumes {
    if (this.volumes?.renderer !== renderer) {
      if (this.volumes) releaseCloudNoiseVolumes(this.volumes.renderer);
      const noise = acquireCloudNoiseVolumes(renderer);
      this.volumes = { renderer, noise };
      this.marchMaterial.uniforms.uCloudShape.value = noise.shape.texture;
    }
    return this.volumes.noise;
  }

  /** What draws a global weather's maps with `renderer`: compile them before it shows. */
  weatherGenerators(renderer: WebGLRenderer): readonly Mesh[] {
    return this.weather.generators(renderer);
  }

  /** Draw the noise volume `renderer` draws it with, unless done already. */
  generate(renderer: WebGLRenderer) {
    generateCloudNoiseVolumes(renderer, this.noise(renderer));
  }

  // A global weather's: each type's quantiles of the cover (its masses weighed against the
  // patches), its look as the march takes it, its heights and its extinction, and the most its
  // cover reaches; once for each set of looks.
  private updateTypes() {
    const settings = this.settings!;
    const cover = this.coverVolume;
    const key = JSON.stringify([settings.looks, settings.density]);
    if (key === this.coverTableKey) return;
    this.coverTableKey = key;
    const u = this.marchMaterial.uniforms;
    const width = SOFT_COVER_QUANTILES + 1;
    const data = this.coverTable.image.data as Uint16Array;
    TYPE_ROWS.forEach((type, row) => {
      const look = settings.looks[type];
      const stats = cover.statistics(look.masses)!;
      stats.quantiles.forEach((q, i) => {
        data[row * width + i] = DataUtils.toHalfFloat(q);
      });
      (u.uCloudTypeLooks.value[row] as Vector4).set(
        Math.max(look.softness * stats.deviation, 1e-4),
        look.lumps * stats.deviation,
        look.towering,
        look.masses,
      );
      const { base, top } = CLOUD_TYPE_HEIGHTS[type];
      (u.uCloudTypeHeights.value[row] as Vector4).set(
        base,
        top[0],
        top[1],
        look.extinction * settings.density,
      );
      (u.uCloudTypeMore.value[row] as Vector4).set(
        stats.quantiles[SOFT_COVER_QUANTILES],
        0,
        0,
        0,
      );
    });
    this.coverTable.needsUpdate = true;
  }

  // The cover drawn, and the cover each level's columns need, from its distribution (with
  // the level's masses weighed against the patches; in a global weather, place by place from
  // each type's: updateTypes): false until that is read back.
  private updateLevels(renderer: WebGLRenderer): boolean {
    const settings = this.settings!;
    const source = this.coverVolume;
    if (!source.update(renderer, settings.seed)) return false;
    const u = this.marchMaterial.uniforms;
    const spread = source.spread!;
    (u.uCloudCoverSpread.value as Vector2[]).forEach((level, k) =>
      level.set(spread[2 * k], spread[2 * k + 1]),
    );
    // Each type's row: a global weather's levels' place by place, a local one's over the ground.
    this.updateTypes();
    if (settings.global) return true;
    settings.levels.slice(0, CLOUDS_LEVELS).forEach(({ layer, look }, k) => {
      const stats = source.statistics(look.masses)!;
      const cover = MathUtils.clamp(layer.cover, 0, 1);
      // At its base the level's share under cloud passes; at its top, the strongest columns of
      // it: more of them the more it towers.
      const base = softCoverLevel(stats, cover);
      const top = Math.max(
        softCoverLevel(stats, cover * (0.02 + 0.3 * look.towering)),
        base + 1e-4,
      );
      const edge = Math.max(look.softness * stats.deviation, 1e-4);
      const lumps = look.lumps * stats.deviation;
      // Over its upper part the need climbs on past the most any column reaches.
      const round = Math.max(
        stats.quantiles[SOFT_COVER_QUANTILES] +
          ROUND_REACH * (lumps + edge) -
          top,
        0,
      );
      (u.uCloudNeeds.value[k] as Vector4).set(base, top, edge, round);
      (u.uCloudLooks.value[k] as Vector4).y = lumps;
    });
    return true;
  }

  /**
   * March the clouds as `camera` sees them into their image, for the composite to lay over the
   * scene, unless nothing they are marched from changed since. From the composite's
   * `onBeforeRender`: within the scene's own render.
   */
  render(renderer: WebGLRenderer, camera: Camera) {
    const settings = this.settings;
    if (!settings || settings.levels.length === 0) {
      this.marchDrawn = false;
      return;
    }
    this.generate(renderer);
    const outer = renderer.getRenderTarget();
    const cubeFace = renderer.getActiveCubeFace();
    const mipLevel = renderer.getActiveMipmapLevel();
    if (outer) size.set(outer.width, outer.height);
    else renderer.getDrawingBufferSize(size);
    // A share of the CSS pixels, whatever the screen's pixel ratio: soft as the clouds are, a 2×
    // screen's own pixels cost 4× the march for little to see (2026-11-10, 1280 × 720 CSS at 2×,
    // `medium`: 33.8 ms against 11.3).
    size.divideScalar(Math.max(renderer.getPixelRatio(), 1e-3));

    this.sky.syncCamera(camera);
    const share = MathUtils.clamp(settings.quality.resolution, 0.25, 1);
    const width = Math.max(Math.round(size.x * share), 1);
    const height = Math.max(Math.round(size.y * share), 1);
    if (this.target.width !== width || this.target.height !== height)
      this.target.setSize(width, height);
    this.updateCamera(camera, height);
    this.levelsReady = this.updateLevels(renderer);
    if (!this.levelsReady) {
      this.marchDrawn = false;
      return;
    }
    // A global weather's maps, a few strips a frame, over the ground once its Earth is drawn
    // (none begun while it comes in: one without it would be drawn again at once); nothing drawn
    // until the first is.
    if (settings.global) {
      const terrain = this.terrain.mapTerrain;
      const drawn = this.terrain.waiting
        ? this.weather.ready
        : this.weather.update(
            renderer,
            settings.global.seed,
            this.time,
            terrain && {
              ...terrain,
              steer: settings.debug.steer !== false,
            },
          );
      if (!drawn) {
        this.marchDrawn = false;
        return;
      }
    }
    // Nothing it is marched from changed since it was last: its image laid over the scene again
    // as it is. A still view with the clock held costs the composite alone.
    this.updateCoverMap(renderer);
    this.updatePlaceMap(renderer);
    this.updateLightMaps(renderer);
    // Interleaved (`temporal`), but for `'still'` while the camera moves: every pixel then.
    const shifted = this.temporal !== 'off' && this.cameraMoved(camera);
    if (shifted) this.poseSerial++;
    if (this.temporal === 'moving' || (this.temporal === 'still' && !shifted)) {
      this.renderParts(renderer, camera, width, height);
      return;
    }
    if (this.temporalDrawn !== this.temporal) {
      this.temporalDrawn = this.temporal;
      this.marchDrawn = false;
    }
    // The parts no longer as the camera saw them, but this image, at its pose, to split into
    // them as it stops (renderParts).
    this.partHeld.fill(false);
    this.fullPose = this.poseSerial;
    if (this.marchUnchanged(renderer, camera)) return;

    // Nested in the scene's render: leave its counters, shadows and clearing alone.
    const autoClear = renderer.autoClear;
    const autoReset = renderer.info.autoReset;
    const shadows = renderer.shadowMap.autoUpdate;
    renderer.autoClear = false;
    renderer.info.autoReset = false;
    renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(this.target);
    renderer.render(this.marchScene, camera);
    renderer.setRenderTarget(outer, cubeFace, mipLevel);
    renderer.autoClear = autoClear;
    renderer.info.autoReset = autoReset;
    renderer.shadowMap.autoUpdate = shadows;
    this.marchDrawn = true;

    (this.compositeMaterial.uniforms.uCloudImageSize.value as Vector2).set(
      width,
      height,
    );
  }

  // The interleaved march (`temporal`): this frame's part of each 2 × 2 block marched into its own
  // image (all four with none to build from), then the full image rebuilt from the four. Each
  // part's rays pass through exactly the full image's pixels it stands for, with their footprint,
  // so a part holds what the full march would there. Nothing marched once all four were drawn
  // from what the march is drawn from now.
  private renderParts(
    renderer: WebGLRenderer,
    camera: Camera,
    width: number,
    height: number,
  ) {
    const partWidth = Math.ceil(width / 2);
    const partHeight = Math.ceil(height / 2);
    let reset = this.temporalDrawn !== this.temporal || !this.marchDrawn;
    this.temporalDrawn = this.temporal;
    if (
      this.parts[0].width !== partWidth ||
      this.parts[0].height !== partHeight
    ) {
      for (const part of this.parts) part.setSize(partWidth, partHeight);
      reset = true;
    }
    const unchanged = this.marchUnchanged(renderer, camera);
    if (!unchanged) this.partsFresh = 0;
    if (reset) {
      this.partHeld.fill(false);
      this.partsFresh = 0;
    }
    // Stopped after marching every pixel as it moved (`'still'`): that image, at this pose, split
    // into the parts, rather than all four marched at once (1.6 times the full march's cost:
    // each part's rays two pixels apart read the volumes less coherently).
    const split =
      !reset &&
      this.temporal === 'still' &&
      !this.partHeld.some(Boolean) &&
      this.fullPose === this.poseSerial;
    if (split) this.partsFresh = unchanged ? PARTS : 0;
    else if (this.partsFresh >= PARTS) return;
    // This frame's part; all four with none held to build from.
    const count =
      this.partsFresh >= PARTS
        ? 0
        : split || this.partHeld.some(Boolean)
          ? 1
          : PARTS;

    const outer = renderer.getRenderTarget();
    const cubeFace = renderer.getActiveCubeFace();
    const mipLevel = renderer.getActiveMipmapLevel();
    const autoClear = renderer.autoClear;
    const autoReset = renderer.info.autoReset;
    const shadows = renderer.shadowMap.autoUpdate;
    renderer.autoClear = false;
    renderer.info.autoReset = false;
    renderer.shadowMap.autoUpdate = false;

    cameraAt.setFromMatrixPosition(camera.matrixWorld);
    partView(camera, viewNow);
    if (split) {
      const s = this.splitMaterial.uniforms;
      for (let k = 0; k < PARTS; k++) {
        (s.uCloudOffset.value as Vector2).set(k & 1, k >> 1);
        renderer.setRenderTarget(this.parts[k]);
        renderer.render(this.splitScene, camera);
        this.partViews[k].copy(viewNow);
        this.partAt[k].copy(cameraAt);
        this.partPose[k] = this.poseSerial;
        this.partHeld[k] = true;
      }
    }

    const u = this.marchMaterial.uniforms;
    const rays = u.uCloudRays.value as Vector4;
    const scaleX = (2 * partWidth) / width;
    const scaleY = (2 * partHeight) / height;
    let drawn = PART_ORDER[this.phase];
    for (let n = 0; n < count; n++) {
      const k = PART_ORDER[this.phase];
      this.phase = (this.phase + 1) % PARTS;
      drawn = k;
      rays.set(
        scaleX,
        scaleY,
        scaleX - 1 + (2 * (k & 1) - 1) / width,
        scaleY - 1 + (2 * (k >> 1) - 1) / height,
      );
      u.uCloudDerivative.value = 0.5;
      renderer.setRenderTarget(this.parts[k]);
      renderer.render(this.marchScene, camera);
      this.partViews[k].copy(viewNow);
      this.partAt[k].copy(cameraAt);
      this.partPose[k] = this.poseSerial;
      this.partHeld[k] = true;
    }
    rays.set(1, 1, 0, 0);
    u.uCloudDerivative.value = 1;
    this.partsFresh = Math.min(this.partsFresh + count, PARTS);

    const r = this.rebuildMaterial.uniforms;
    r.uCloudPhase.value = drawn;
    (r.uCloudImageSize.value as Vector2).set(width, height);
    (r.uCloudPartSize.value as Vector2).set(partWidth, partHeight);
    for (let k = 0; k < PARTS; k++) {
      (r.uCloudPartUnview.value[k] as Matrix4).copy(this.partViews[k]).invert();
      (r.uCloudPartAt.value[k] as Vector3).subVectors(this.partAt[k], cameraAt);
      (r.uCloudPartState.value[k] as Vector2).set(
        this.partHeld[k] ? 1 : 0,
        this.partPose[k] === this.poseSerial ? 0 : 1,
      );
    }
    renderer.setRenderTarget(this.target);
    renderer.render(this.rebuildScene, camera);

    renderer.setRenderTarget(outer, cubeFace, mipLevel);
    renderer.autoClear = autoClear;
    renderer.info.autoReset = autoReset;
    renderer.shadowMap.autoUpdate = shadows;
    this.marchDrawn = true;
    (this.compositeMaterial.uniforms.uCloudImageSize.value as Vector2).set(
      width,
      height,
    );
  }

  // Whether the camera moved since the last frame (its projection's sub-pixel jitter aside), and
  // notes it.
  private cameraMoved(camera: Camera): boolean {
    const seen = this.cameraSeen;
    let differs = seen.length === 0;
    let i = 0;
    const note = (value: number) => {
      if (seen[i] !== value) differs = true;
      seen[i++] = value;
    };
    for (const value of camera.matrixWorld.elements) note(value);
    const projection = camera.projectionMatrix.elements;
    for (let j = 0; j < 16; j++) if (j !== 8 && j !== 9) note(projection[j]);
    return differs;
  }

  // Whether the march would draw what it drew last, and notes what it is drawn from now: the
  // camera (its projection's sub-pixel jitter aside, as a temporal pass sets it on a still
  // view), the image's size, the clock, what is drawn into its maps (the ground's, the weather
  // systems'), and the values of the uniforms its program reads. Only those: it shares the sky's
  // uniforms, some of which change every frame (the hollow's embers). Until its program is
  // linked, all of them.
  private marchUnchanged(renderer: WebGLRenderer, camera: Camera): boolean {
    const material = this.marchMaterial;
    const program =
      (renderer.properties.get(material) as MarchProperties).currentProgram ??
      null;
    if (program !== this.marchProgram) {
      this.marchProgram = program;
      const read = program?.getUniforms().map;
      this.marchNames = Object.keys(material.uniforms).filter(
        name => !read || name in read,
      );
    }
    const inputs = this.marchInputs;
    inputs.begin(this.marchDrawn && program !== null);
    for (const value of camera.matrixWorld.elements) inputs.add(value);
    const projection = camera.projectionMatrix.elements;
    for (let i = 0; i < 16; i++)
      if (i !== 8 && i !== 9) inputs.add(projection[i]);
    inputs.add(this.target.width);
    inputs.add(this.target.height);
    inputs.add(this.time);
    inputs.add(this.terrain.version);
    inputs.add(this.weather.version);
    inputs.add(this.lightMaps.version);
    inputs.add(this.coverMap.version);
    inputs.add(this.placeMap.version);
    inputs.add(material.version);
    for (const name of this.marchNames)
      inputs.addValue(material.uniforms[name].value);
    return inputs.end();
  }

  // A local weather's light maps, with `lightMap`, drawn on a few rows a frame (CloudLightMap):
  // over its disc and as far again as a ray toward the light runs out under its deepest level's
  // base, the texel the finest level's cover's, drawn anew as the settings, the light's way or
  // the ground change, or as the clock runs on by a twentieth of the shortest lifetime (its
  // clouds formed and faded so far). A global weather's clouds are lit as marched.
  private updateLightMaps(renderer: WebGLRenderer) {
    const settings = this.settings!;
    if (settings.global || !settings.lightMap) {
      this.lightMaps.update(renderer, null);
      return;
    }
    const u = this.marchMaterial.uniforms;
    const levels = settings.levels.slice(0, CLOUDS_LEVELS);
    // The light's way at the weather's middle (cloud-light.glsl, cloudLightWay).
    const sun = u.uSkySunDirection.value as Vector3;
    const way =
      sun.dot(this.frameM) > -0.105
        ? sun
        : (u.uSkyMoonDirection.value as Vector3);
    const rising = Math.max(way.dot(this.frameM), 0.05);
    const shells = u.uCloudShells.value as Vector4[];
    const texel = VOLUME_TILE / CLOUD_COVER_VOLUME_SIZE;
    let deepest = 0;
    let finest = Infinity;
    let shortest = Infinity;
    levels.forEach(({ look }, k) => {
      deepest = Math.max(deepest, shells[k].y - shells[k].x);
      finest = Math.min(finest, texel * settings.scale * look.scale);
      shortest = Math.min(shortest, look.lifetime);
    });
    this.lightMaps.update(renderer, {
      levels: levels.length,
      half: settings.local.radius + Math.min(deepest / rising, LIGHT_MARGIN),
      texel: finest,
      key: [
        this.settingsSerial,
        way.x.toFixed(3),
        way.y.toFixed(3),
        way.z.toFixed(3),
        this.terrain.version,
      ].join(','),
      time: this.time,
      refresh: MathUtils.clamp(shortest / 20, 30, 600),
      winds: this.levelWinds,
    });
  }

  /** What draws a local weather's light maps: compile it before it shows. */
  lightGenerator(): Mesh {
    return this.lightMaps.generator(this.marchMaterial);
  }

  // A local weather's cover maps (CloudCoverMap): over its disc, the texel the finest level's
  // cover's, drawn anew as the clock runs or the settings or the globe change. A global
  // weather's cover is read from the volume where its map places it.
  private updateCoverMap(renderer: WebGLRenderer) {
    const settings = this.settings!;
    if (settings.global) {
      this.coverMap.update(renderer, null);
      return;
    }
    const levels = settings.levels.slice(0, CLOUDS_LEVELS);
    const texel = VOLUME_TILE / CLOUD_COVER_VOLUME_SIZE;
    const finest = Math.min(
      ...levels.map(({ look }) => texel * settings.scale * look.scale),
    );
    this.coverMap.update(renderer, {
      levels: levels.length,
      half: settings.local.radius * COVER_MARGIN,
      texel: finest,
      key: `${this.settingsSerial},${this.sky.globe.version}`,
      time: this.time,
    });
  }

  /** What draws a local weather's cover maps: compile it before it shows. */
  coverGenerator(): Mesh {
    return this.coverMap.generator(this.marchMaterial);
  }

  // A global weather's cloud map and types about the camera (CloudPlaceMap), drawn anew as the
  // clock drifts them, they are drawn anew, the settings change or the camera moves on. After
  // updateCamera: the camera fixed on the Earth (cameraEarth) is the frame's.
  private updatePlaceMap(renderer: WebGLRenderer) {
    const settings = this.settings!;
    const globe = this.sky.globe;
    if (!settings.global || !globe.enabled || !this.weather.ready) {
      this.placeMap.update(renderer, null);
      return;
    }
    const u = this.marchMaterial.uniforms;
    const radius = u.uCloudEarthRadius.value as number;
    const times = u.uCloudMapTimes.value as Vector3;
    this.placeMap.update(renderer, {
      camera: cameraEarth,
      radius,
      height: cameraEarth.length() - radius,
      top: PLACE_TOP,
      texel: (2 * radius) / CLOUD_MAP_SIZE,
      key: [
        this.settingsSerial,
        globe.version,
        this.weather.version,
        times.x,
        times.y,
        times.z,
      ].join(','),
    });
  }

  /** What draws a global weather's map about the camera: compile it before it shows. */
  placeGenerator(): Mesh {
    return this.placeMap.generator(this.marchMaterial);
  }

  /** as seen from the scene all round (`film`): premultiplied colour and alpha, with mipmaps */
  get texture(): CubeTexture {
    return this.filmTarget.texture;
  }

  /**
   * Whether they show (enabled, cloudy, compiled): what {@link film} films, and what takes the
   * light ({@link updateLight}). A change is a change to what they look like.
   */
  get filmable(): boolean {
    return this.shown;
  }
  set filmable(value: boolean) {
    if (value === this.shown) return;
    this.shown = value;
    this.version++;
  }

  /**
   * Film the clouds as seen from `position` (world) into {@link texture}, all round: each face
   * marched once, a still, at FILM_MARCH of its texels. Clear while they do not show. For a
   * `Scenery`'s bakes of the air (`ScenerySkyOverlay`), and the sea's reflection.
   */
  film(renderer: WebGLRenderer, position: Vector3) {
    // Filmed already as it is, from there.
    const sun = this.sky.sunDirection;
    if (
      this.filmedAt.distanceToSquared(position) < 1 &&
      this.filmedVersion === this.version &&
      this.filmedSun.dot(sun) > 1 - FILM_TURN
    )
      return;
    this.filmedAt.copy(position);
    this.filmedVersion = this.version;
    this.filmedSun.copy(sun);
    const autoClear = renderer.autoClear;
    const clearAlpha = renderer.getClearAlpha();
    renderer.getClearColor(clearColor);
    renderer.autoClear = true;
    renderer.setClearColor(0x000000, 0);
    this.still.visible = this.shown && this.settings !== null;
    this.filmCamera.position.copy(position);
    this.filmCamera.updateMatrixWorld();
    this.filmCamera.update(renderer, this.filmScene);
    renderer.setClearColor(clearColor, clearAlpha);
    renderer.autoClear = autoClear;
  }

  // The march for one of the film's faces, `camera` its, as the still composite is drawn into it:
  // FILM_MARCH of its texels, into an image of its own, so the frame's own (and what it was
  // marched from) is left as it is.
  private renderStill(renderer: WebGLRenderer, camera: Camera) {
    const settings = this.settings;
    if (!settings || settings.levels.length === 0 || !this.levelsReady) return;
    if (settings.global && !this.weather.ready) return;
    this.generate(renderer);
    const outer = renderer.getRenderTarget();
    const cubeFace = renderer.getActiveCubeFace();
    const mipLevel = renderer.getActiveMipmapLevel();
    const side = Math.max(Math.round(FILM_SIZE * FILM_MARCH), 8);
    if (this.stillImage.width !== side) this.stillImage.setSize(side, side);
    this.sky.syncCamera(camera);
    this.updateCamera(camera, side);
    // Coarser than the view's, set back after.
    const u = this.marchMaterial.uniforms;
    const samples = u.uCloudLightSamples.value as number;
    const shells = u.uCloudShells.value as Vector4[];
    const steps = shells.map(shell => shell.w);
    u.uCloudLightSamples.value = Math.min(samples, FILM_LIGHT_SAMPLES);
    shells.forEach(shell => {
      shell.w = Math.max(Math.round(shell.w * FILM_STEPS), 4);
    });
    const autoClear = renderer.autoClear;
    const autoReset = renderer.info.autoReset;
    const shadows = renderer.shadowMap.autoUpdate;
    renderer.autoClear = false;
    renderer.info.autoReset = false;
    renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(this.stillImage);
    renderer.render(
      this.filmWhole ? this.filmMarchScene : this.marchScene,
      camera,
    );
    renderer.setRenderTarget(outer, cubeFace, mipLevel);
    renderer.autoClear = autoClear;
    renderer.info.autoReset = autoReset;
    renderer.shadowMap.autoUpdate = shadows;
    u.uCloudLightSamples.value = samples;
    shells.forEach((shell, k) => {
      shell.w = steps[k];
    });
    (this.stillMaterial.uniforms.uCloudImageSize.value as Vector2).set(
      side,
      side,
    );
  }

  /**
   * As the clock runs and the weather or the ground come in: mark what was filmed of them stale
   * ({@link version}: the bakes of the air and the sea's reflection are drawn again) once the
   * lowest level's clouds have drifted or formed and faded a share of a cloud since
   * (FILM_SHARE), at most every few seconds; and at once as the weather's maps or the ground are
   * drawn anew. In the frame loop.
   */
  updateFilm() {
    if (this.weather.version !== this.weatherSeen) {
      this.weatherSeen = this.weather.version;
      this.version++;
    }
    if (this.terrain.version !== this.terrainSeen) {
      this.terrainSeen = this.terrain.version;
      this.version++;
    }
    const elapsed = Math.abs(this.time - this.filmTime);
    const lowest = this.settings?.levels[0];
    if (elapsed === 0 || !this.shown || !lowest) {
      this.filmTime = this.time;
      return;
    }
    const now = performance.now();
    if (now - this.filmWall < FILM_LONGEST) return;
    const breadth = LIFE_SIZE * this.settings!.scale * lowest.look.scale;
    const drifted = this.levelWinds[0].length() * elapsed;
    if (
      drifted > FILM_SHARE * breadth ||
      elapsed > FILM_SHARE * Math.max(lowest.look.lifetime, 1)
    ) {
      this.filmTime = this.time;
      this.filmWall = now;
      this.version++;
    }
  }

  /**
   * Ease {@link light} toward the share of the light the levels let through about the scene
   * (`cloudsLight`), by the light's elevation there, over LIGHT_EASE; all of it while they
   * do not show. A global weather's levels take the cover its map gives over the scene
   * (readSceneCover), none until it is read. In the frame loop, `delta` seconds after the last.
   */
  updateLight(renderer: WebGLRenderer, delta: number) {
    const settings = this.settings;
    const up = this.sky.up;
    let sine = up.dot(this.sky.sunDirection);
    // By night, the moon's (as cloudLightWay takes it).
    if (sine < -0.105)
      sine = up.dot(
        this.marchMaterial.uniforms.uSkyMoonDirection.value as Vector3,
      );
    let levels: readonly CloudsLevel[] = settings?.levels ?? [];
    if (settings?.global) {
      this.readSceneCover(renderer);
      const cover = this.sceneCover;
      const covers = [cover.x, cover.z, cover.w];
      levels =
        cover.x < 0
          ? []
          : levels.map(level => ({
              ...level,
              layer: {
                ...level.layer,
                cover:
                  covers[CLOUD_LEVELS.indexOf(cloudLevelOf(level.layer.type))],
              },
            }));
    }
    const target =
      settings && this.shown ? cloudsLight(levels, settings.density, sine) : 1;
    this.light +=
      (target - this.light) * (1 - Math.exp(-Math.max(delta, 0) / LIGHT_EASE));
    if (Math.abs(target - this.light) < 1e-3) this.light = target;
    // The bakes are lit as the scene is: told again once it has moved enough.
    if (Math.abs(this.light - this.lightTold) > LIGHT_TOLD) {
      this.lightTold = this.light;
      this.version++;
    }
  }

  // A global weather's cover over the scene (sceneCover, for the scene's light): the newer map
  // read at the scene's up into one texel, read back without waiting for it; once a drawing of
  // the map, and again as the globe moves.
  private readSceneCover(renderer: WebGLRenderer) {
    const map = this.marchMaterial.uniforms.uCloudMapNext
      .value as CubeTexture | null;
    const globe = this.sky.globe;
    const read = this.sceneCoverFor;
    if (
      !map ||
      this.sceneCoverReading ||
      (read.map === map && read.globe === globe.version)
    )
      return;
    this.updateEarth(globe);
    read.map = map;
    read.globe = globe.version;
    const u = this.sceneCoverMaterial.uniforms;
    u.uCloudMap.value = map;
    (u.uCloudSceneUp.value as Vector3)
      .copy(globe.up)
      .applyMatrix3(this.earth)
      .normalize();
    const outer = renderer.getRenderTarget();
    const cubeFace = renderer.getActiveCubeFace();
    const mipLevel = renderer.getActiveMipmapLevel();
    renderer.setRenderTarget(this.sceneCoverTarget);
    renderer.render(this.sceneCoverScene, coverCamera);
    renderer.setRenderTarget(outer, cubeFace, mipLevel);
    this.sceneCoverReading = true;
    const pixel = this.sceneCoverPixel;
    renderer
      .readRenderTargetPixelsAsync(this.sceneCoverTarget, 0, 0, 1, 1, pixel)
      .then(() =>
        this.sceneCover.set(
          pixel[0] / 255,
          pixel[1] / 255,
          pixel[2] / 255,
          pixel[3] / 255,
        ),
      )
      .catch(() => {
        read.map = null;
      })
      .finally(() => {
        this.sceneCoverReading = false;
      });
  }

  /**
   * Draw the clouds' shadows ({@link shadow}) about the foot of `camera` when it has moved far
   * enough from where they were drawn, the light has turned, the clouds or the ground changed,
   * or the clouds have drifted or formed and faded enough since: SHADOW_SIZE² texels over a
   * square reaching further the higher the camera is. Between, carried with the lowest level's
   * wind, which casts most of them. None from high up, where the scene's light stands as dimmed
   * ({@link light}). In the frame loop.
   */
  updateShadow(renderer: WebGLRenderer, camera: Camera) {
    const settings = this.settings;
    const globe = this.sky.globe;
    cameraAt.setFromMatrixPosition(camera.matrixWorld);
    const altitude = globe.altitude(cameraAt);
    const drawn = this.shadowDrawn;
    if (
      !settings ||
      !this.shown ||
      !this.levelsReady ||
      (settings.global && !this.weather.ready) ||
      altitude > SHADOW_HIGHEST
    ) {
      this.shadow = null;
      drawn.valid = false;
      return;
    }
    const reach = MathUtils.clamp(
      SHADOW_REACH[0] + SHADOW_REACH[2] * altitude,
      SHADOW_REACH[0],
      SHADOW_REACH[1],
    );
    // Its middle on the sea under the camera, east and north there.
    globe.foot(cameraAt, shadowFoot);
    const centre = globe.place(shadowFoot.x, shadowFoot.z, 0, shadowCentre);
    const up = globe.upAt(centre, shadowUp);
    const north = shadowNorth
      .copy(globe.north)
      .addScaledVector(up, -globe.north.dot(up))
      .normalize();
    const eastward = shadowEast.crossVectors(north, up).normalize();
    // The light, as cloudLightWay takes it at the middle.
    const sun = this.sky.sunDirection;
    const light =
      up.dot(sun) > -0.105
        ? sun
        : (this.marchMaterial.uniforms.uSkyMoonDirection.value as Vector3);
    // The lowest level's drift (world, m/s), and how much of a cloud has formed and faded since.
    const wind = this.levelWinds[0];
    shadowDrift
      .copy(this.frameE)
      .multiplyScalar(wind.x)
      .addScaledVector(this.frameN, wind.y);
    const elapsed = Math.abs(this.time - drawn.time);
    const lowest = settings.levels[0];
    const lived = lowest ? elapsed / Math.max(lowest.look.lifetime, 1) : 0;
    const stale =
      !drawn.valid ||
      drawn.version !== this.version ||
      drawn.terrain !== this.terrain.version ||
      drawn.globe !== globe.version ||
      drawn.light.dot(light) < 1 - SHADOW_TURN ||
      drawn.centre.distanceTo(centre) > SHADOW_MOVE * drawn.reach ||
      shadowDrift.length() * elapsed > SHADOW_MOVE * drawn.reach ||
      lived > SHADOW_LIVED ||
      Math.abs(Math.log(reach / Math.max(drawn.reach, 1))) > Math.log(1.2);
    if (stale) {
      this.sky.syncCamera(camera);
      this.updateCamera(camera, SHADOW_SIZE);
      const u = this.shadowUniforms;
      (u.uCloudShadowPlace.value as Vector4).set(
        centre.x - cameraAt.x,
        centre.y - cameraAt.y,
        centre.z - cameraAt.z,
        reach,
      );
      (u.uCloudShadowEast.value as Vector3).copy(eastward);
      (u.uCloudShadowNorth.value as Vector3).copy(north);
      const outer = renderer.getRenderTarget();
      const cubeFace = renderer.getActiveCubeFace();
      const mipLevel = renderer.getActiveMipmapLevel();
      const autoClear = renderer.autoClear;
      const autoReset = renderer.info.autoReset;
      const shadows = renderer.shadowMap.autoUpdate;
      renderer.autoClear = false;
      renderer.info.autoReset = false;
      renderer.shadowMap.autoUpdate = false;
      renderer.setRenderTarget(this.shadowTarget);
      renderer.render(this.shadowScene, camera);
      renderer.setRenderTarget(outer, cubeFace, mipLevel);
      renderer.autoClear = autoClear;
      renderer.info.autoReset = autoReset;
      renderer.shadowMap.autoUpdate = shadows;
      drawn.valid = true;
      drawn.version = this.version;
      drawn.terrain = this.terrain.version;
      drawn.globe = globe.version;
      drawn.light.copy(light);
      drawn.centre.copy(centre);
      drawn.reach = reach;
      drawn.time = this.time;
      const shadow = (this.shadow ??= {
        texture: this.shadowTarget.texture,
        centre: new Vector3(),
        east: new Vector3(),
        north: new Vector3(),
        reach: 0,
      });
      shadow.east.copy(eastward);
      shadow.north.copy(north);
      shadow.reach = reach;
    }
    this.shadow?.centre
      .copy(drawn.centre)
      .addScaledVector(shadowDrift, this.time - drawn.time);
  }

  /**
   * Bring {@link reflection} up to date: the lowest clouds' base, and while they show, a global
   * weather's cover far off as its newer map has it. In the frame loop.
   */
  updateReflection() {
    const settings = this.settings;
    const globe = this.sky.globe;
    this.updateEarth(globe);
    const reflection = this.reflection;
    const lowest = settings?.levels[0];
    reflection.base = lowest
      ? Math.min(lowest.layer.base, lowest.layer.top)
      : 0;
    reflection.map =
      settings?.global && this.shown
        ? (this.marchMaterial.uniforms.uCloudMapNext
            .value as CubeTexture | null)
        : null;
    reflection.earth.copy(this.earth);
    reflection.texels = CLOUD_MAP_SIZE / (2 * globe.radius);
    reflection.strength = settings?.global ? 1 : 0;
  }

  /** Take what the scenery has drawn of its ground. In the frame loop, while it is drawn. */
  updateTerrain() {
    this.terrain.update();
  }

  /**
   * Dispose of its image and its share of the noise; its composite's material is the owner's
   * to release, the rest of its materials through `release` (default `dispose`).
   */
  dispose(release?: (material: Material) => void) {
    this.target.dispose();
    this.geometry.dispose();
    this.lightMaps.dispose(release);
    this.coverMap.dispose(release);
    this.placeMap.dispose(release);
    this.filmTarget.dispose();
    this.stillImage.dispose();
    this.shadowTarget.dispose();
    this.sceneCoverTarget.dispose();
    for (const part of this.parts) part.dispose();
    const programs = [this.modes.local, this.modes.global].flatMap(mode =>
      mode ? [mode.march, mode.film, mode.shadow] : [],
    );
    for (const material of [
      this.stillMaterial,
      this.sceneCoverMaterial,
      this.rebuildMaterial,
      this.splitMaterial,
      ...programs.map(mesh => mesh.material as ShaderMaterial),
    ])
      if (release) release(material);
      else material.dispose();
    this.coverVolume.dispose();
    this.weather.dispose();
    this.coverTable.dispose();
    if (this.volumes) releaseCloudNoiseVolumes(this.volumes.renderer);
    this.volumes = null;
  }
}

const fract = (x: number) => x - Math.floor(x);

// One mode's programs (CloudsRenderer.programsOf): the march's, its film's and its shadows'.
type CloudsPrograms = { march: Mesh; film: Mesh; shadow: Mesh };

// The renderer's properties of a material: the program it was linked into (three's own).
type MarchProperties = {
  currentProgram?: { getUniforms(): { map: Record<string, unknown> } };
};

// What a march is drawn from, as numbers, noted frame by frame: whether any differs from the
// last frame's (CloudsRenderer.marchUnchanged).
class MarchInputs {
  private readonly values: number[] = [];
  private count = 0;
  private differs = false;

  /** Note them anew; `valid` false: as if every one differs. */
  begin(valid: boolean) {
    this.count = 0;
    this.differs = !valid;
  }

  add(value: number) {
    const i = this.count++;
    if (!this.differs && !Object.is(this.values[i], value)) this.differs = true;
    this.values[i] = value;
  }

  /** A uniform's value: numbers, vectors, colours, matrices, textures and arrays of them. */
  addValue(value: unknown) {
    if (typeof value === 'number') this.add(value);
    else if (typeof value === 'boolean') this.add(value ? 1 : 0);
    else if (value === null || value === undefined) this.add(-1);
    else if (Array.isArray(value) || ArrayBuffer.isView(value)) {
      const items = value as ArrayLike<unknown>;
      for (let i = 0; i < items.length; i++) this.addValue(items[i]);
    } else if ((value as Texture).isTexture) {
      // Drawn into, a target's texture keeps its version: its owner's counts that (above).
      this.add((value as Texture).id);
      this.add((value as Texture).version);
    } else if ((value as Color).isColor) {
      const color = value as Color;
      this.add(color.r);
      this.add(color.g);
      this.add(color.b);
    } else if ('elements' in (value as object))
      for (const element of (value as Matrix3).elements) this.add(element);
    else if ('x' in (value as object)) {
      const vector = value as Vector4;
      this.add(vector.x);
      this.add(vector.y);
      if ('z' in vector) this.add(vector.z);
      if ('w' in vector) this.add(vector.w);
    } else this.add(NaN);
  }

  /** Whether none differed from the last time they were noted. */
  end(): boolean {
    if (this.count !== this.values.length) {
      this.values.length = this.count;
      this.differs = true;
    }
    return !this.differs;
  }
}
