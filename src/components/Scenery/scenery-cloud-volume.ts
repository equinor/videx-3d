import {
  AlwaysDepth,
  Camera,
  Color,
  CubeCamera,
  CubeTexture,
  CustomBlending,
  Data3DTexture,
  DataTexture,
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
  NearestFilter,
  NoBlending,
  OneFactor,
  OneMinusSrcAlphaFactor,
  RedFormat,
  RepeatWrapping,
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
import { createBlueNoise } from '../../sdk/materials/blue-noise';
import {
  CLOUD_NOISE_BROAD,
  CLOUD_NOISE_SECOND,
  CLOUD_VALUE_NOISE_PERIOD,
  CloudNoise,
  createCloudNoise,
} from '../../sdk/materials/cloud-noise';
import type { Globe } from '../../sdk/projection/globe';
import {
  CLOUD_LEVELS,
  cloudLayerPreset,
  cloudLayerWind,
  cloudLevelOf,
  cloudLayersByLevel,
  cloudStreetsOf,
  type CloudLayer,
  type CloudLevel,
  type CloudType,
  type WeatherWind,
} from '../../sdk/weather/weather';
import {
  acquireCloudMap,
  bakeCloudMap,
  CLOUD_MAP_SIZE,
  CLOUD_MAP_STRIPS,
  CloudMap,
  cloudMapKey,
  releaseCloudMap,
} from './scenery-cloud-map';
import {
  acquireCloudNoiseVolumes,
  CLOUD_SHAPE_SIZE,
  CloudNoiseVolumes,
  generateCloudNoiseVolumes,
  releaseCloudNoiseVolumes,
} from './scenery-cloud-noise';
import { CloudTerrain } from './scenery-cloud-terrain';
import { createSceneryGeometry, SceneryMaterial } from './scenery-material';
import type { SceneryCloudVolumeQuality } from './scenery-model';
import type {
  ScenerySkyReflection,
  ScenerySkyShadow,
} from './scenery-registry';
import compositeShader from './shaders/cloud-volume-composite.glsl';
import marchShader from './shaders/cloud-volume-march.glsl';
import resolveShader from './shaders/cloud-volume-resolve.glsl';
import vertexShader from './shaders/cloud-volume-vertex.glsl';

/**
 * How many cloud layers a `SceneryCloudVolume` draws at most: one at each `CloudLevel`
 * (`cloudLayersByLevel`).
 *
 * @group Components
 */
export const CLOUD_VOLUME_LAYERS = CLOUD_LEVELS.length;

/**
 * What a {@link SceneryCloudVolumeQuality} spends on a `SceneryCloudVolume`'s clouds
 * (`CLOUD_VOLUME_QUALITY`).
 *
 * @group Components
 */
export type CloudVolumeQualityLevel = {
  /** the share of the screen's resolution their image is drawn at */
  resolution: number;
  /** from these heights over the sea (world units, highest first), at least this share instead */
  aloft: readonly (readonly [number, number])[];
  /** the most rays marched a frame: past it, the image is drawn smaller */
  rays: number;
  /**
   * one pixel in each 2 × 2 of the image marched a frame, in turn, the rest taken from the
   * frames before (with `temporal` only)
   */
  sparse: boolean;
  /** most steps along each view */
  steps: number;
  /** samples toward the light close up (further off, one) */
  lightSamples: number;
};

/**
 * The qualities a `SceneryCloudVolume` draws at (`quality`). On an integrated laptop GPU
 * (Iris Xe, 1464 × 909 at a pixel ratio of 2) while the view moves: `'low'` some 2.5–4 ms a
 * frame, `'medium'` 4.5–8, `'high'` 12–27, `'ultra'` 23–60; at rest, none
 * (`documents/clouds.md`, "Quality").
 *
 * @group Components
 */
export const CLOUD_VOLUME_QUALITY: Readonly<
  Record<SceneryCloudVolumeQuality, CloudVolumeQualityLevel>
> = {
  low: {
    resolution: 0.35,
    aloft: [],
    rays: 60000,
    sparse: true,
    steps: 28,
    lightSamples: 1,
  },
  medium: {
    resolution: 0.5,
    aloft: [[150000, 0.75]],
    rays: 150000,
    sparse: true,
    steps: 40,
    lightSamples: 2,
  },
  high: {
    resolution: 0.5,
    aloft: [
      [500000, 1],
      [150000, 0.75],
    ],
    rays: 1000000,
    sparse: false,
    steps: 40,
    lightSamples: 2,
  },
  ultra: {
    resolution: 0.75,
    aloft: [[150000, 1]],
    rays: Infinity,
    sparse: false,
    steps: 64,
    lightSamples: 2,
  },
};

/**
 * `quality`'s level, with a `resolution` (then without a budget of rays) or `steps` of its
 * own instead of the quality's.
 */
export function cloudVolumeQuality(
  quality: SceneryCloudVolumeQuality,
  { resolution, steps }: { resolution?: number; steps?: number } = {},
): CloudVolumeQualityLevel {
  const level = CLOUD_VOLUME_QUALITY[quality] ?? CLOUD_VOLUME_QUALITY.medium;
  return {
    ...level,
    resolution: resolution ?? level.resolution,
    rays: resolution === undefined ? level.rays : Infinity,
    steps: steps ?? level.steps,
  };
}

// Texels along a side of the noise's tile.
const NOISE_SIZE = 32;
// Texels along a side of the blue noise's tile (createBlueNoise): the march reads it by pixel,
// wrapped (CLOUD_BLUE_NOISE_MASK in the shader).
const BLUE_NOISE_SIZE = 64;
// The detail volume's period (world units, at scale 1; scenery-cloud-noise.ts).
const PERIOD_DETAIL = 1000;
// From the middle of the scene (world units), where its layers start giving way to the weather
// systems, and where they have; the border moved by up to this far, by a field of this period
// (CLOUD_SCENE_WARP in the shader), so it follows no circle.
const SCENE_NEAR = 100000;
const SCENE_FAR = 400000;
const SCENE_WARP = 120000;
const PERIOD_SCENE_WARP = 150000;
// Strips of the cloud map drawn a frame (scenery-cloud-map.ts): the first map, which the clouds
// wait for (some half a second), and a new one for another seed, or the next ahead as the clock
// runs, drawn while the clouds show the old (some three seconds).
const MAP_STRIPS_FIRST = 16;
const MAP_STRIPS_NEXT = 1;
// As the clock runs, the map is drawn again for times this far apart (weather seconds) at
// least, and blended between: the systems travel some 20 km in it. Under a timelapse, further
// apart, so each is drawn (in the background) in at most MAP_DRAW_SHARE of the time between:
// MAP_STRIPS_NEXT strips a frame, more (up to MAP_STRIPS_MOST) where that would set them more
// than MAP_SPAN_MOST apart. On a laptop's GPU at an hour a second, some 6 h.
const MAP_SPAN = 1800;
const MAP_SPAN_MOST = 6 * 3600;
const MAP_DRAW_SHARE = 0.5;
const MAP_STRIPS_MOST = 4;
// A jump of the clock this far (weather seconds) from the maps drawn starts them over.
const MAP_JUMP = 12 * 3600;
// The field that warps where the coverage is read (at scale 1), so its tiles do not line up.
const PERIOD_WARP = 22000;
// The clouds as seen from the scene (film): texels along a side of each face, and the share of
// it each face is marched at.
const CUBE_SIZE = 128;
const STILL_SHARE = 0.5;
// How fast the share of the light let through follows the layers (seconds), and how far it
// moves before the bakes are told (CloudVolumeRenderer.updateLight).
const LIGHT_EASE = 0.4;
const LIGHT_TOLD = 0.02;
// The clouds' shadows (CloudVolumeRenderer.updateShadow): texels along the square's side; how
// far it reaches from its middle at the least (x) and the most (y), and per unit of the
// camera's height (z); drawn again once the camera's foot is this share of that from its
// middle; and none from higher up than this (world units).
const SHADOW_SIZE = 512;
const SHADOW_REACH = new Vector3(20000, 200000, 8);
const SHADOW_MOVE = 0.1;
const SHADOW_HIGHEST = 400000;
// 1 − the cosine of how far the light turns (1°) before the shadows are drawn again: a cloud's
// at 2 km, with the sun at 35°, moves some 100 m, under a texel of the map from 3 km up. A
// timelapse at 1 h/s draws them some 15 times a second.
const SHADOW_TURN = 1.5e-4;
// The share of the lowest layer's clouds' lifetime after which their shadows are drawn again,
// as the clouds have changed (they are carried with the drift meanwhile): some 25 s of weather
// for cumulus, every frame or so under a timelapse.
const SHADOW_LIVED = 0.02;
// What was filmed of them for the bakes is stale once the lowest layer's clouds have drifted
// this share of a cloud's breadth, or lived this share of their lifetime; but no sooner than
// this long after the last (ms): each bake films them all round.
const FILM_SHARE = 0.25;
const FILM_LONGEST = 3000;

// What a type of cloud looks like (cloud-volume-march.glsl), at scale and density 1.
type CloudLook = {
  // The coverage's period (world units): the noise's tile spans one, and a cell of it, a
  // cloud's breadth, a quarter (CLOUD_CELL in the shader). And the shape volume's
  // (scenery-cloud-noise.ts).
  period: number;
  shapePeriod: number;
  // Extinction in cloud (1 / world unit), and its edge's softness.
  extinction: number;
  softness: number;
  // How far its billows (the shape volume) and its detail move its edges (in the coverage's
  // standard deviations, per standard deviation of theirs), how much flatter its billows are
  // than they are broad, and how much they take of the Worley billows rather than the
  // Perlin-Worley.
  shapes: [number, number, number, number];
  // How far the coverage's level rises toward its tops: 1 heaped, as cumulus; 0 a sheet.
  heap: number;
  // How far it lines up into rows (0 none): along the wind (streets) or across it (billows),
  // this far apart (world units); streets only in a fresh wind (cloudStreetsOf).
  rows: number;
  rowsAcross: boolean;
  rowSpacing: number;
  // Its density up the layer: from none at its base to all at the first share of its
  // thickness, and back to none from the second to its top.
  profile: [number, number];
  // How far its base rises and falls with its cover's pattern (a share of its thickness): a
  // deck's undulating base.
  undulation: number;
  // Its detail at its base: wisps (1), or its billows' undersides (0).
  wisps: number;
  // How much longer its clouds are along the wind than across.
  stretch: number;
  // The share of its thickness the light crosses on its slant through it (cloudVolumeLight).
  slant: number;
  // How long one of its clouds lasts, forming and fading (weather seconds): its patterns are
  // read on through the noise, a cloud's breadth in this long (CLOUD_LIFE_*). And how fast its
  // billows rise in it (m/s): heaped clouds boil upward.
  lifetime: number;
  rise: number;
};
const LOOKS: Record<CloudType, CloudLook> = {
  // Heaped, separate clouds with flat bases.
  cumulus: {
    period: 6000,
    shapePeriod: 4500,
    extinction: 0.02,
    softness: 0.05,
    shapes: [1.0, 0.5, 1.0, 0.6],
    heap: 1,
    rows: 1,
    rowsAcross: false,
    rowSpacing: 3000,
    profile: [0.06, 0.9],
    undulation: 0,
    wisps: 0,
    stretch: 1,
    slant: 0.6,
    lifetime: 1200,
    rise: 0.6,
  },
  // A lumpy deck of rolls and cells, broken by gaps, their tops gently domed.
  stratocumulus: {
    period: 10000,
    shapePeriod: 4000,
    extinction: 0.016,
    softness: 0.07,
    shapes: [1.1, 0.45, 2.0, 0.55],
    heap: 0.1,
    rows: 0.6,
    rowsAcross: false,
    rowSpacing: 5000,
    profile: [0.12, 0.75],
    undulation: 0.3,
    wisps: 0.4,
    stretch: 1.3,
    slant: 0.7,
    lifetime: 3600,
    rise: 0.1,
  },
  // A low, even sheet, its base undulating.
  stratus: {
    period: 36000,
    shapePeriod: 12000,
    extinction: 0.012,
    softness: 0.1,
    shapes: [0.8, 0.4, 3.0, 0.3],
    heap: 0,
    rows: 0,
    rowsAcross: false,
    rowSpacing: 1,
    profile: [0.2, 0.65],
    undulation: 0.3,
    wisps: 1,
    stretch: 1,
    slant: 0.8,
    lifetime: 7200,
    rise: 0,
  },
  // Deep and dark, its base ragged.
  nimbostratus: {
    period: 60000,
    shapePeriod: 15000,
    extinction: 0.02,
    softness: 0.15,
    shapes: [0.6, 0.7, 2.5, 0.3],
    heap: 0,
    rows: 0,
    rowsAcross: false,
    rowSpacing: 1,
    profile: [0.05, 0.85],
    undulation: 0.12,
    wisps: 1,
    stretch: 1,
    slant: 0.9,
    lifetime: 5400,
    rise: 0,
  },
  // Small puffs in rows across the wind: a mackerel sky.
  altocumulus: {
    period: 4000,
    shapePeriod: 2000,
    extinction: 0.01,
    softness: 0.05,
    shapes: [1.0, 0.5, 1.5, 0.7],
    heap: 0.5,
    rows: 1.2,
    rowsAcross: true,
    rowSpacing: 1500,
    profile: [0.15, 0.7],
    undulation: 0,
    wisps: 0,
    stretch: 1,
    slant: 0.7,
    lifetime: 2400,
    rise: 0.2,
  },
  // A thin grey sheet the sun shows through.
  altostratus: {
    period: 50000,
    shapePeriod: 15000,
    extinction: 0.0025,
    softness: 0.12,
    shapes: [0.7, 0.3, 3.0, 0.3],
    heap: 0,
    rows: 0,
    rowsAcross: false,
    rowSpacing: 1,
    profile: [0.15, 0.7],
    undulation: 0.2,
    wisps: 1,
    stretch: 1.5,
    slant: 0.8,
    lifetime: 7200,
    rise: 0,
  },
  // Streaks of ice drawn out along the wind.
  cirrus: {
    period: 16000,
    shapePeriod: 8000,
    extinction: 0.0012,
    softness: 0.08,
    shapes: [1.0, 0.9, 3.0, 0.2],
    heap: 0,
    rows: 0,
    rowsAcross: false,
    rowSpacing: 1,
    profile: [0.2, 0.6],
    undulation: 0,
    wisps: 1,
    stretch: 6,
    slant: 0.5,
    lifetime: 3600,
    rise: 0,
  },
  // A milky veil of ice.
  cirrostratus: {
    period: 80000,
    shapePeriod: 20000,
    extinction: 0.0004,
    softness: 0.25,
    shapes: [0.5, 0.3, 3.0, 0.2],
    heap: 0,
    rows: 0,
    rowsAcross: false,
    rowSpacing: 1,
    profile: [0.2, 0.7],
    undulation: 0,
    wisps: 1,
    stretch: 2,
    slant: 0.8,
    lifetime: 7200,
    rise: 0,
  },
};

// The optical depth straight up through a layer of `look`, as its cover lets it through: a
// layer under it sees the sky, and the sun, through this much (cloud-volume-march.glsl).
function columnDepth(layer: CloudLayer, look: CloudLook, density: number) {
  const cover = Math.min(Math.max(layer.cover, 0), 1);
  const thickness = Math.max(Math.abs(layer.top - layer.base), 1);
  // The profile's mean up the layer.
  const mean = (1 + look.profile[1] - look.profile[0]) / 2;
  const depth = look.extinction * density * thickness * mean;
  return -Math.log(Math.max(1 - cover * (1 - Math.exp(-depth)), 1e-6));
}
// Each level's layer where none is given: drawn only far off, where the weather systems lay
// their cloud at its level (the cloud map's channel for it), so at no cover of its own.
const FAR_TYPES: Record<CloudLevel, CloudType> = {
  low: 'cumulus',
  mid: 'altostratus',
  high: 'cirrus',
};

/**
 * The layers the clouds draw of `layers`, one at each of `levels` in their order
 * (`cloudLayersByLevel`): where none is given, the level's far type at no cover. A level left
 * out is not drawn at all, not even far off.
 */
function cloudVolumeSlots(
  layers: readonly CloudLayer[],
  levels: readonly CloudLevel[],
): CloudLayer[] {
  return cloudLayersByLevel(layers).flatMap((layer, i) => {
    if (!levels.includes(CLOUD_LEVELS[i])) return [];
    if (layer) return [layer];
    const far = cloudLayerPreset('scattered', FAR_TYPES[CLOUD_LEVELS[i]])!;
    far.cover = 0;
    return [far];
  });
}

// A slot's level's index in CLOUD_LEVELS (uCloudLayers.w: the cloud map's channel for it).
const levelIndexOf = (layer: CloudLayer) =>
  CLOUD_LEVELS.indexOf(cloudLevelOf(layer.type));
// The clouds' image holds log2 of their distance over this as its depth (cloud-volume-*.glsl):
// out to 4 · 10⁹ world units.
const DEPTH_RANGE = '32.0';
// The most the composite draws the clouds nearer than their depth, to take in the spread of a
// texel's depth over a slanting layer (cloud-volume-composite.glsl): 2 % of the distance, in
// the image's depth units. Within a few pixels of a cloud close up, a few tens of metres.
const DEPTH_MARGIN = (Math.log2(1 / 0.98) / Number(DEPTH_RANGE)).toFixed(7);
// The shortest step along a view, and how much longer it grows per unit of distance at least
// (each ray grows its steps faster where its runs would not fit them).
const MARCH_STEP = 80;
const MARCH_GROWTH = 0.04;
// The coverage's broad octave and its second tap read the pattern in a frame turned from the
// Earth's, so they never line up with the first.
const TURN = new Matrix3().set(0.36, 0.48, -0.8, -0.8, 0.6, 0, 0.48, 0.64, 0.6);

// One noise for the page, and the blue noise that jitters the march's steps, kept while
// anything draws with them.
let shared: {
  noise: CloudNoise;
  texture: Data3DTexture;
  blue: DataTexture;
  users: number;
} | null = null;

function acquireNoise() {
  if (!shared) {
    const noise = createCloudNoise(NOISE_SIZE);
    const texture = new Data3DTexture(
      noise.data,
      noise.size,
      noise.size,
      noise.size,
    );
    texture.format = RGBAFormat;
    texture.wrapS = texture.wrapT = texture.wrapR = RepeatWrapping;
    texture.minFilter = LinearMipmapLinearFilter;
    texture.magFilter = LinearFilter;
    texture.generateMipmaps = true;
    texture.needsUpdate = true;
    const blue = new DataTexture(
      createBlueNoise(BLUE_NOISE_SIZE),
      BLUE_NOISE_SIZE,
      BLUE_NOISE_SIZE,
      RedFormat,
      UnsignedByteType,
    );
    blue.minFilter = blue.magFilter = NearestFilter;
    blue.unpackAlignment = 1;
    blue.needsUpdate = true;
    shared = { noise, texture, blue, users: 0 };
  }
  shared.users++;
  return shared;
}

function releaseNoise() {
  if (!shared || --shared.users > 0) return;
  shared.texture.dispose();
  shared.blue.dispose();
  shared = null;
}

/** What a {@link CloudVolumeRenderer} draws, resolved. */
export type CloudVolumeSettings = {
  layers: readonly CloudLayer[];
  /** the levels drawn: one left out is not drawn at all, not even far off */
  levels: readonly CloudLevel[];
  /** the weather systems' strength far off, 0 to 1 */
  systems: number;
  /** the wind at the scene: what lines its cumulus up into streets */
  wind: WeatherWind | null;
  scale: number;
  density: number;
  color: Color;
  seed: number;
  /** how much they spend for how they look (cloudVolumeQuality) */
  quality: CloudVolumeQualityLevel;
  temporal: boolean;
};

/**
 * The share of the light (the sun's, or the moon's) that the scene's one light keeps through
 * cloud `layers` at `density`, where the light's elevation has sine `sine`: each layer's
 * clouds letting e^(−optical depth) of it through, along the light's slant through them (most
 * of a heaped cumulus's thickness, more of a stratus sheet's), weighed by its cover squared.
 * Not the mean over the ground, which is the cover itself: the light stands for the sunlit
 * ground as much as the shaded where the clouds' shadows are not drawn (what the scenery's sea
 * and relief do not shade), and dimmed by the mean a scattered sky read as dull; squared,
 * scattered cloud keeps most of the sun and overcast takes it. One layer at each level, as
 * drawn (`cloudLayersByLevel`).
 *
 * @group Components
 */
export function cloudVolumeLight(
  layers: readonly CloudLayer[],
  density: number,
  sine: number,
): number {
  let through = 1;
  for (const layer of cloudLayersByLevel(layers)) {
    const cover = Math.min(Math.max(layer?.cover ?? 0, 0), 1);
    if (!layer || cover <= 0) continue;
    const thickness = Math.max(Math.abs(layer.top - layer.base), 1);
    const { extinction, slant } = LOOKS[layer.type];
    const depth =
      (extinction * Math.max(density, 0) * thickness * slant) /
      Math.max(sine, 0.05);
    through *= 1 - cover * cover * (1 - Math.exp(-depth));
  }
  return through;
}

// How much of each frame the temporal resolve takes: the rest is the frames before it. Where one
// pixel in four is marched a frame (CloudVolumeQualityLevel.sparse), each marched pixel's share:
// it is marched again only four frames on.
const TEMPORAL_BLEND = 0.1;
const TEMPORAL_BLEND_SPARSE = 0.2;
// The most of a sparse march's frame the pixels it did not reach take, as the clouds change
// where they are fast on the screen (from some 0.02 to 0.3 of a pixel a frame). Under a
// timelapse their drift counts too: their cover changes in place as fast (the map's systems
// and its dissolve), and held three frames in four they stood out as dotted streaks. At real
// time the drift alone took a share each march at rest, and the march's jitter shook the
// whole layer with it.
const SPARSE_FAST = 0.3;
// The clock running more than this many times faster than the wall: a timelapse.
const TIMELAPSE_RATE = 2;
// The share of TEMPORAL_BLEND (or _SPARSE) a frame takes once the view has stood still, what
// the march reads but the clock has changed less than CALM_INPUTS of itself (the sun on a
// real-time clock moves less: a slider more), and the clouds changed less than CALM_CHANGE of
// a pixel (beyond their drift) and moved less than CALM_DRIFT since the frame before, for
// CALM_FRAMES frames, eased in over those: a quarter halves the grain left. Never under a
// timelapse. Calm, a change of light took some 5 s to settle rather than 1.5.
const CALM_SHARE = 0.25;
const CALM_FRAMES = 20;
const CALM_INPUTS = 1e-4;
const CALM_CHANGE = 0.05;
const CALM_DRIFT = 0.5;
// Far clouds softened, where a pixel's grain is as large as their shapes: the resolve blends a
// frame's rays about a pixel by how far from its middle they crossed, by a Gaussian of up to
// BLUR_MOST pixels of the image, from the nearest the clouds lie along the view (at least
// BLUR_NEAR, world units) to BLUR_OCTAVES doublings of it further.
const BLUR_MOST = 1;
const BLUR_NEAR = 1000;
const BLUR_OCTAVES = 3;
// Longer than this (ms) between two frames of a camera, its history starts over.
const TEMPORAL_GAP = 500;
// The pixel of each 2 × 2 a sparse march takes in turn: across the block first, so a moving
// view is filled in evenly.
const CELLS = [
  [0, 0],
  [1, 1],
  [1, 0],
  [0, 1],
];
// Frames a camera's view and what the march reads stay unchanged before its march stops and
// its image is held (holdAtRest): by then the frames before have settled into it.
const REST_FRAMES = 48;
// With the clock stopped, frames marched at its time before the image is held: the history
// keeps more of them once calm (CALM_SHARE).
const REST_SETTLED = 2 * REST_FRAMES;
// At rest with the clock running: marched again once any level may have moved or changed this
// share of a pixel of the image, or this long after the last (ms); a layer the camera is in
// counts as this near (world units).
const REST_CHANGE = 0.3;
const REST_LONGEST = 2000;
const REST_NEAR = 50;
// The shallowest a view's slope toward a layer counts as (sine): the Earth's curve brings even
// a level view down to it some way off.
const REST_SLOPE = 0.02;
// The view's corners (NDC), for the rays steepest toward a layer.
const CORNERS = [
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1],
];
// The march's uniforms the clock moves.
const CLOCK_UNIFORMS = [
  'uCloudFrame',
  'uCloudOffsets',
  'uCloudRows',
  'uCloudMapTimes',
];
// The sub-pixel places the march's rays take in turn (Halton 2, 3), in pixels from the middle.
const JITTER = [
  [0.5, 0.333],
  [0.25, 0.667],
  [0.75, 0.111],
  [0.125, 0.444],
  [0.625, 0.778],
  [0.375, 0.222],
  [0.875, 0.556],
  [0.0625, 0.889],
].map(([x, y]) => [x - 0.5, y - 0.5]);

// A uniform's vectors, one for each layer.
const layerVectors = () =>
  Array.from({ length: CLOUD_VOLUME_LAYERS }, () => new Vector4());

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

// What lays the clouds' `image` over what is drawn (cloud-volume-composite.glsl), at the
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
      uCloudSoften: new Uniform(1),
      uCloudJitter: new Uniform(new Vector2()),
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

// What a camera's frames leave the next: the images resolved (one read, the other written),
// where the camera was and how it looked, and what the march last read (holdAtRest): its
// values, and for how many frames they have not changed; the weather's time at the last
// resolve, and at the last march (and the wall time then), how many marches since that time
// last changed, and how many frames in a row have been calm (CALM_SHARE).
type TemporalState = {
  images: [WebGLRenderTarget, WebGLRenderTarget];
  index: number;
  frame: number;
  valid: boolean;
  time: number;
  rotation: Matrix3;
  projection: Matrix4;
  position: Vector3;
  inputs: number[];
  still: number;
  weather: number;
  marched: number;
  marchedWall: number;
  calm: number;
  steady: number;
};

const v = new Vector3();
const clearColor = new Color();

// A uniform's value as numbers, onto `out` (CloudVolumeRenderer.inputsOf): a texture by which
// it is and how often it was changed, none as −1.
function pushInput(out: number[], value: unknown) {
  if (typeof value === 'number') out.push(value);
  else if (typeof value === 'boolean') out.push(value ? 1 : 0);
  else if (Array.isArray(value)) for (const item of value) pushInput(out, item);
  else if (value instanceof Texture) out.push(value.id, value.version);
  else if (
    value !== null &&
    typeof value === 'object' &&
    'toArray' in value &&
    typeof value.toArray === 'function'
  )
    value.toArray(out, out.length);
  else out.push(-1);
}

// Whether two lists of inputs are the same, each within `tolerance` of the larger (or of 1).
function sameInputs(a: number[], b: number[], tolerance = 0) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (
      x !== y &&
      !(Math.abs(x - y) <= tolerance * Math.max(Math.abs(x), Math.abs(y), 1))
    )
      return false;
  }
  return true;
}
const shadowCentre = new Vector3();
const shadowUp = new Vector3();
const shadowNorth = new Vector3();
const shadowEast = new Vector3();
const fromCentre = new Vector3();
const east = new Vector3();
const size = new Vector2();
const turned = new Vector3();
const stretched = new Vector3();
const windEarth = new Vector3();
const across = new Vector3();
const v4 = new Vector3();
const cameraAt = new Vector3();
const way = new Vector3();
const moved = new Vector3();
const sliced = new Vector3();
const toWorld = new Matrix3();
const upAt = new Vector3();
const ray = new Vector3();
const rotationNow = new Matrix3();
const pace = { moving: 0, changing: 0, nearest: 0 };

// How far a pattern is read on through the noise in a cloud's lifetime: a quarter of its
// period, a cloud's breadth (CLOUD_CELL in the shader), so one cloud has made way for another.
const CLOUD_CELL_SHARE = 0.25;
// A lifetime where no layer says (weather seconds); how many times longer the broad octave's
// clusters last, and the second tap's; how long the detail's wisps last, and the warp.
const CLOUD_LIFE_DEFAULT = 3600;
const CLOUD_LIFE_BROAD = 4;
const CLOUD_LIFE_SECOND = 1.5;
const CLOUD_LIFE_DETAIL = 600;
const CLOUD_LIFE_WARP = 7200;

/**
 * The 3D clouds of a `SceneryCloudVolume`: a march through each layer at a share of the
 * screen's resolution (`cloud-volume-march.glsl`), into an image of its own; with `temporal`
 * on, a resolve that accumulates the frames, whose steps and sub-pixel places the march
 * jitters (`cloud-volume-resolve.glsl`); and the {@link composite}, a fullscreen mesh drawn
 * after the scene that lays the result over at the depth of the clouds' front. The
 * march and the resolve run as the composite is drawn (`onBeforeRender`), with the camera
 * drawing it, and keep a history per camera. The noise is read in a frame fixed to the Earth
 * (the globe's frame and place), with where the camera lies in it worked out here, in 64-bit
 * floats, so the clouds stay put and keep their detail from sea level to space.
 */
export class CloudVolumeRenderer {
  /** drawn in the scene, last (`LAYERS.OVERLAY` in an `OITRenderPass`) */
  readonly composite: Mesh;
  /** the march, drawn into the clouds' own image as the composite is drawn */
  readonly march: Mesh;
  /** the temporal resolve, drawn after the march */
  readonly resolve: Mesh;
  readonly marchMaterial: ShaderMaterial;
  readonly resolveMaterial: ShaderMaterial;
  readonly compositeMaterial: ShaderMaterial;
  /** the ground under the clouds, from a relief (see {@link CloudTerrain}): none until given one */
  readonly terrain = new CloudTerrain();
  /**
   * the clouds as seen from the scene all round ({@link film}), by direction (world):
   * premultiplied colour and alpha, without the sky's intensity
   */
  readonly texture: CubeTexture;
  /** counts changes to what they look like, but for the sky's own: what was filmed of them is stale */
  version = 0;
  /** how much of the light (the sun's, or the moon's) reaches the scene past them, 0 to 1 ({@link updateLight}) */
  light = 1;
  private readonly cube = new WebGLCubeRenderTarget(CUBE_SIZE, {
    type: HalfFloatType,
    // The sea reads it blurred where it would blow its clouds up (ScenerySkyReflection).
    generateMipmaps: true,
    minFilter: LinearMipmapLinearFilter,
    magFilter: LinearFilter,
  });
  private readonly cubeCamera = new CubeCamera(1, 10, this.cube);
  private readonly cubeScene = new Scene();
  private readonly stillTarget = createImage();
  private readonly stillMaterial: ShaderMaterial;
  private readonly still: Mesh;
  private shown = false;
  // The light share the bakes were last told of (version).
  private lightTold = 1;
  // The clouds' shadows (updateShadow): their pass, what it draws into, and what it was drawn for.
  private readonly shadowMaterial: ShaderMaterial;
  private readonly shadowScene = new Scene();
  private readonly shadowTarget = new WebGLRenderTarget(
    SHADOW_SIZE,
    SHADOW_SIZE,
    {
      format: RedFormat,
      type: UnsignedByteType,
      depthBuffer: false,
      generateMipmaps: false,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
    },
  );
  private readonly shadowDrawn = {
    valid: false,
    centre: new Vector3(),
    reach: 0,
    light: new Vector3(),
    version: -1,
    terrain: -1,
    globe: -1,
    time: 0,
  };
  /**
   * the clouds' shadows over a square about the camera's foot ({@link updateShadow}), null
   * while there are none
   */
  shadow: ScenerySkyShadow | null = null;
  /** what the sea reflects of them away from where they were filmed ({@link updateReflection}) */
  readonly reflection: ScenerySkyReflection = {
    base: 0,
    map: null,
    earth: new Matrix3(),
    texels: 0,
    strength: 0,
    near: SCENE_NEAR,
    far: SCENE_FAR,
  };
  /** the shadow pass: compile it with the march */
  readonly shadowMesh: Mesh;
  private readonly sky: SceneryMaterial;
  private readonly marchScene = new Scene();
  private readonly resolveScene = new Scene();
  private readonly target: WebGLRenderTarget;
  private readonly histories = new Map<Camera, TemporalState>();
  /**
   * The weather's time (seconds) the clouds are drawn at: they drift with each level's wind
   * and form and fade as it runs. Set each frame (`SceneryCloudVolume`: its `Weather`'s clock).
   */
  time = 0;
  /** each level's wind in the world (m/s, by its index in `CLOUD_LEVELS`): how its clouds drift */
  readonly drifts = CLOUD_LEVELS.map(() => new Vector3());
  // The heights (over the sea) between the low and middle levels and the middle and high: which
  // level's drift a cloud's front follows (the resolve).
  private splits = [3000, 6500];
  // The weather's time and the wall time (ms) they were last marked stale for the film at.
  private filmTime = 0;
  private filmWall = 0;
  /**
   * Stop marching a camera's view once it and what the march reads have not changed for some
   * frames, and hold the image the frames settled into until they do: none of the march's cost
   * while the view rests. False marches every frame (to time it).
   */
  holdAtRest = true;
  // The uniforms the march reads but for its frame's count, which it compares from frame to
  // frame (holdAtRest); and what it compares them into.
  private readonly inputNames: string[];
  private inputs: number[] = [];
  private readonly earth = new Matrix3();
  // The scene's true east and north at the disc's centre, fixed on the Earth.
  private readonly eastEarth = new Vector3(0, 1, 0);
  private readonly northEarth = new Vector3(0, 0, 1);
  private globeVersion = -1;
  private settings: CloudVolumeSettings | null = null;
  // The layer drawn at each level (cloudVolumeSlots).
  private slots: CloudLayer[] = [];
  // The noise volumes of the renderer drawing it (one at a time).
  private volumes: {
    renderer: WebGLRenderer;
    noise: CloudNoiseVolumes;
  } | null = null;
  // The cloud maps of the renderer drawing it: the two it blends between as the clock runs
  // (older and newer, from blendStart; one alone while older is null), and one being drawn
  // meanwhile: the next ahead, or for another seed, ground or a jump of the clock (fresh).
  private maps: {
    renderer: WebGLRenderer;
    older: CloudMap | null;
    newer: CloudMap | null;
    next: CloudMap | null;
    fresh: boolean;
    blendStart: number;
  } | null = null;
  // How fast the clock runs (weather seconds a wall second) and a frame's wall time (s), eased;
  // and the clock and the wall time at the last bakeMap.
  private pace = 0;
  private frameWall = 1 / 60;
  private paceTime = 0;
  private paceWall = 0;

  constructor(sky: SceneryMaterial, renderOrder: number) {
    this.sky = sky;
    const { noise, texture, blue } = acquireNoise();
    const geometry = createSceneryGeometry();

    this.marchMaterial = new ShaderMaterial({
      name: 'scenery-cloud-volume-march',
      vertexShader,
      fragmentShader: marchShader,
      defines: {
        CLOUD_LAYERS: CLOUD_VOLUME_LAYERS,
        CLOUD_DEPTH_RANGE: DEPTH_RANGE,
        CLOUD_BLUE_NOISE_MASK: BLUE_NOISE_SIZE - 1,
        CLOUD_SCENE_WARP: `vec2(${PERIOD_SCENE_WARP.toFixed(1)}, ${SCENE_WARP.toFixed(1)})`,
      },
      uniforms: {
        // The sky's own uniform objects: the sun, the air, the globe.
        ...sky.uniforms,
        uCloudNoise: new Uniform(texture),
        uCloudNoiseSize: new Uniform(noise.size),
        uCloudBlueNoise: new Uniform(blue),
        uCloudShape: new Uniform<Texture | null>(null),
        uCloudDetail: new Uniform<Texture | null>(null),
        uCloudVolumes: new Uniform(
          new Vector2(PERIOD_DETAIL, CLOUD_SHAPE_SIZE),
        ),
        uCloudEarth: new Uniform(new Matrix3()),
        uCloudTurn: new Uniform(TURN),
        uCloudCameraEarth: new Uniform(new Vector3()),
        uCloudUpEarth: new Uniform(new Vector3(0, 0, 1)),
        uCloudOffsets: new Uniform(
          Array.from(
            { length: 4 * CLOUD_VOLUME_LAYERS + 3 },
            () => new Vector3(),
          ),
        ),
        uCloudLayers: new Uniform(layerVectors()),
        uCloudLooks: new Uniform(layerVectors()),
        uCloudShapes: new Uniform(layerVectors()),
        uCloudForms: new Uniform(layerVectors()),
        uCloudStyles: new Uniform(layerVectors()),
        uCloudRows: new Uniform(layerVectors()),
        // Each layer's wind, fixed on the Earth: the way it blows (xyz) and its speed (w, m/s).
        uCloudWinds: new Uniform(layerVectors()),
        uCloudLayerCount: new Uniform(0),
        uCloudQuantiles: new Uniform(Array.from(noise.coverage.quantiles)),
        uCloudCoverage: new Uniform(
          new Vector2(noise.coverage.deviation, noise.coverage.mean),
        ),
        uCloudMap: new Uniform<CubeTexture | null>(null),
        // The map blended into as the clock runs, and the blend (cloudMapRead): the newer's
        // share, and the older's and the newer's age (weather seconds).
        uCloudMapNext: new Uniform<CubeTexture | null>(null),
        uCloudMapTimes: new Uniform(new Vector3()),
        uCloudWeather: new Uniform(new Vector4(1, SCENE_NEAR, SCENE_FAR, 0)),
        uCloudWarp: new Uniform(PERIOD_WARP),
        ...this.terrain.uniforms,
        uCloudWind: new Uniform(new Vector4()),
        uCloudMarch: new Uniform(
          new Vector4(40, MARCH_STEP, MARCH_GROWTH, 1e-3),
        ),
        uCloudLightSamples: new Uniform(2),
        uCloudFrame: new Uniform(0),
        uCloudJitter: new Uniform(new Vector2()),
        uCloudColor: new Uniform(new Color(1, 1, 1)),
      },
      // Every pixel writes its depth: the distance to the clouds' front.
      depthTest: true,
      depthFunc: AlwaysDepth,
      depthWrite: true,
      blending: NoBlending,
    });
    this.march = new Mesh(geometry, this.marchMaterial);
    this.march.frustumCulled = false;
    // Drawn with whatever layers the camera has on as the composite is drawn.
    this.march.layers.enableAll();
    this.marchScene.add(this.march);
    const uniforms = this.marchMaterial.uniforms;
    this.inputNames = [
      ...marchShader.matchAll(/uniform\s+\w+\s+(\w+)\s*(?:\[[^\]]*\])?\s*;/g),
    ]
      .map(match => match[1])
      // The frame's count, and what the clock moves (where the camera lies among the drifting
      // patterns): the clock's run is weighed apart (paceOf).
      .filter(name => !CLOCK_UNIFORMS.includes(name) && name in uniforms);

    this.target = createImage();

    this.resolveMaterial = new ShaderMaterial({
      name: 'scenery-cloud-volume-resolve',
      vertexShader,
      fragmentShader: resolveShader,
      defines: { CLOUD_DEPTH_RANGE: DEPTH_RANGE },
      uniforms: {
        uCloudCurrent: new Uniform(this.target.texture),
        uCloudCurrentDepth: new Uniform(this.target.depthTexture),
        uCloudHistory: new Uniform<Texture | null>(null),
        uCloudHistoryDepth: new Uniform<Texture | null>(null),
        uCloudImageSize: new Uniform(new Vector2(1, 1)),
        uCloudCurrentSize: new Uniform(new Vector2(1, 1)),
        uCloudSparse: new Uniform(new Vector4()),
        uCloudPreviousRotation: new Uniform(new Matrix3()),
        uCloudPreviousProjection: new Uniform(new Matrix4()),
        uCloudCameraMove: new Uniform(new Vector3()),
        uCloudDrift: new Uniform(CLOUD_LEVELS.map(() => new Vector3())),
        uCloudLevels: new Uniform(new Vector4(0, 0, 3000, 6500)),
        uCloudUp: new Uniform(new Vector3(0, 1, 0)),
        uCloudBlend: new Uniform(1),
        uCloudJitter: new Uniform(new Vector2()),
        uCloudSample: new Uniform(new Vector2(0.5, 0.5)),
        uCloudBlur: new Uniform(new Vector3()),
      },
      depthTest: true,
      depthFunc: AlwaysDepth,
      depthWrite: true,
      blending: NoBlending,
    });
    this.resolve = new Mesh(geometry, this.resolveMaterial);
    this.resolve.frustumCulled = false;
    this.resolve.layers.enableAll();
    this.resolveScene.add(this.resolve);

    this.compositeMaterial = createCompositeMaterial(
      'scenery-cloud-volume',
      this.target,
      sky.uniforms.uSkyIntensity,
    );
    this.composite = new Mesh(geometry, this.compositeMaterial);
    this.composite.name = 'scenery-cloud-volume';
    this.composite.frustumCulled = false;
    this.composite.renderOrder = renderOrder;
    this.composite.visible = false;
    this.composite.layers.enable(LAYERS.OVERLAY);
    // For debugging and profiling from the scene graph.
    this.composite.userData.cloudVolume = this;
    this.composite.onBeforeRender = (renderer, _scene, camera) =>
      this.render(renderer, camera);

    // The clouds as seen from the scene (film): the composite over each of the cube's faces,
    // without the sky's intensity, which what draws it applies.
    this.stillMaterial = createCompositeMaterial(
      'scenery-cloud-volume-still',
      this.stillTarget,
      new Uniform(1),
    );
    this.still = new Mesh(geometry, this.stillMaterial);
    this.still.frustumCulled = false;
    this.still.onBeforeRender = (renderer, _scene, camera) =>
      this.renderStill(renderer, camera);
    this.cubeScene.add(this.still);
    this.texture = this.cube.texture;

    // The clouds' shadows: the march's own code, its main the pass's (CLOUD_SHADOW), with its
    // uniform objects.
    this.shadowMaterial = new ShaderMaterial({
      name: 'scenery-cloud-volume-shadow',
      vertexShader,
      fragmentShader: marchShader,
      defines: { ...this.marchMaterial.defines, CLOUD_SHADOW: '' },
      uniforms: {
        ...this.marchMaterial.uniforms,
        uCloudShadowPlace: new Uniform(new Vector4()),
        uCloudShadowEast: new Uniform(new Vector3(1, 0, 0)),
        uCloudShadowNorth: new Uniform(new Vector3(0, 0, -1)),
        uCloudShadowSize: new Uniform(SHADOW_SIZE),
      },
      depthTest: false,
      depthWrite: false,
      blending: NoBlending,
    });
    this.shadowMesh = new Mesh(geometry, this.shadowMaterial);
    this.shadowMesh.frustumCulled = false;
    this.shadowMesh.layers.enableAll();
    this.shadowScene.add(this.shadowMesh);
  }

  /** Draw `settings` from the next frame on. */
  set(settings: CloudVolumeSettings) {
    this.settings = settings;
    this.version++;
    const u = this.marchMaterial.uniforms;
    const scale = settings.scale;
    this.slots = cloudVolumeSlots(settings.layers, settings.levels);
    // Each level's heights, as drawn or as its far type's.
    const heights = CLOUD_LEVELS.map(level => {
      const layer =
        this.slots.find(slot => cloudLevelOf(slot.type) === level) ??
        cloudLayerPreset('scattered', FAR_TYPES[level])!;
      return [Math.min(layer.base, layer.top), Math.max(layer.base, layer.top)];
    });
    this.splits = [
      0.5 * (heights[0][1] + heights[1][0]),
      0.5 * (heights[1][1] + heights[2][0]),
    ];
    u.uCloudLayerCount.value = this.slots.length;
    const streets = cloudStreetsOf(settings.wind);
    this.slots.forEach((layer, i) => {
      const look = LOOKS[layer.type];
      const base = Math.min(layer.base, layer.top);
      (u.uCloudLayers.value[i] as Vector4).set(
        base,
        Math.max(layer.top, base + 1),
        Math.min(Math.max(layer.cover, 0), 1),
        levelIndexOf(layer),
      );
      (u.uCloudLooks.value[i] as Vector4).set(
        look.extinction * settings.density,
        look.softness,
        look.heap,
        look.rows * (look.rowsAcross ? 1 : streets),
      );
      (u.uCloudShapes.value[i] as Vector4).fromArray(look.shapes);
      (u.uCloudForms.value[i] as Vector4).set(
        look.period * scale,
        look.shapePeriod * scale,
        look.profile[0],
        look.profile[1],
      );
      // The layers over it, as it sees the sky and the sun through them.
      let above = 0;
      for (const higher of this.slots.slice(i + 1))
        above += columnDepth(higher, LOOKS[higher.type], settings.density);
      (u.uCloudStyles.value[i] as Vector4).set(
        1 / look.stretch - 1,
        look.wisps,
        above,
        look.undulation,
      );
    });
    (u.uCloudVolumes.value as Vector2).x = PERIOD_DETAIL * scale;
    u.uCloudWarp.value = PERIOD_WARP * scale;
    (u.uCloudWeather.value as Vector4).x = Math.min(
      Math.max(settings.systems, 0),
      1,
    );
    (u.uCloudMarch.value as Vector4).x = Math.max(
      Math.round(settings.quality.steps),
      1,
    );
    u.uCloudLightSamples.value = Math.max(
      Math.round(settings.quality.lightSamples),
      1,
    );
    (u.uCloudColor.value as Color).copy(settings.color);
  }

  /** Whether any layer can show: with cover, or far off through the weather systems. */
  get cloudy(): boolean {
    const settings = this.settings;
    if (!settings || this.slots.length === 0) return false;
    return settings.systems > 0 || this.slots.some(layer => layer.cover > 0);
  }

  /**
   * Whether they show (enabled, cloudy, their map drawn): what {@link film} films, and what
   * takes the light ({@link updateLight}). A change is a change to what they look like.
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
   * Bring {@link reflection} up to date: the lowest clouds' base, and while they show, the
   * weather far off as the clouds draw it. In the frame loop.
   */
  updateReflection() {
    const settings = this.settings;
    const globe = this.sky.globe;
    this.updateEarth(globe);
    const reflection = this.reflection;
    // The lowest layer with cover of its own, else the low level's.
    const lowest =
      this.slots.find(layer => layer.cover > 0) ?? this.slots[0] ?? null;
    reflection.base = lowest ? Math.min(lowest.base, lowest.top) : 0;
    reflection.map = this.shown ? (this.maps?.newer?.texture ?? null) : null;
    reflection.earth.copy(this.earth);
    reflection.texels = CLOUD_MAP_SIZE / (2 * globe.radius);
    reflection.strength = settings
      ? Math.min(Math.max(settings.systems, 0), 1)
      : 0;
  }

  /**
   * As the clock runs: mark what was filmed of them stale ({@link version}: the bakes of the air
   * and the sea's reflection are drawn again) once the clouds have drifted or changed enough
   * since, a share of a cloud, at most every few seconds. In the frame loop.
   */
  updateFilm() {
    const elapsed = Math.abs(this.time - this.filmTime);
    if (elapsed === 0 || !this.shown) {
      this.filmTime = this.time;
      return;
    }
    const now = performance.now();
    if (now - this.filmWall < FILM_LONGEST) return;
    const lowest = this.slots[0];
    if (!lowest) return;
    const look = LOOKS[lowest.type];
    const breadth =
      CLOUD_CELL_SHARE * look.period * (this.settings?.scale ?? 1);
    const drifted = this.shadowDrift().length() * elapsed;
    if (
      drifted > FILM_SHARE * breadth ||
      elapsed > FILM_SHARE * look.lifetime
    ) {
      this.filmTime = this.time;
      this.filmWall = now;
      this.version++;
    }
  }

  /**
   * Ease {@link light} toward the share of the light the layers let through about the scene
   * (`cloudVolumeLight`), by the light's elevation there, over some half a second; all of it
   * while they do not show. In the frame loop.
   */
  updateLight(delta: number) {
    const settings = this.settings;
    const up = this.sky.up;
    let sine = up.dot(this.sky.sunDirection);
    // By night, the moon's (as cloudLightWay takes it).
    if (sine < -0.105)
      sine = up.dot(this.sky.uniforms.uSkyMoonDirection.value as Vector3);
    const shown = settings !== null && this.shown;
    const target = shown
      ? cloudVolumeLight(this.slots, settings.density, sine)
      : 1;
    this.light += (target - this.light) * (1 - Math.exp(-delta / LIGHT_EASE));
    if (Math.abs(target - this.light) < 1e-3) this.light = target;
    // The bakes' seabed is lit as the scene is: told again once it has moved enough.
    if (Math.abs(this.light - this.lightTold) > LIGHT_TOLD) {
      this.lightTold = this.light;
      this.version++;
    }
  }

  /**
   * Draw the clouds' shadows ({@link shadow}) about the foot of `camera`, when it has moved
   * far enough from where they were drawn, or the light, the clouds or the ground changed:
   * {@link SHADOW_SIZE}² texels over a square reaching further the higher the camera is. None
   * from high up, where the scene's light stands as dimmed ({@link light}). In the frame loop.
   */
  updateShadow(renderer: WebGLRenderer, camera: Camera) {
    const settings = this.settings;
    const globe = this.sky.globe;
    cameraAt.setFromMatrixPosition(camera.matrixWorld);
    const altitude = globe.altitude(cameraAt);
    if (!settings || !this.shown || altitude > SHADOW_HIGHEST) {
      this.shadow = null;
      this.shadowDrawn.valid = false;
      return;
    }
    const reach = MathUtils.clamp(
      SHADOW_REACH.x + SHADOW_REACH.z * altitude,
      SHADOW_REACH.x,
      SHADOW_REACH.y,
    );
    // Its middle on the sea under the camera, east and north there.
    globe.foot(cameraAt, v);
    const centre = globe.place(v.x, v.z, 0, shadowCentre);
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
        : (this.sky.uniforms.uSkyMoonDirection.value as Vector3);

    const drawn = this.shadowDrawn;
    // The clouds' drift since drawn, as far as the map has been carried, and how much of a
    // cloud has changed meanwhile (a cloud's breadth a lifetime, of the lowest layer's).
    const elapsed = Math.abs(this.time - drawn.time);
    const lowest = this.slots[0];
    const lived = lowest ? elapsed / LOOKS[lowest.type].lifetime : 0;
    const stale =
      !drawn.valid ||
      drawn.version !== this.version ||
      drawn.terrain !== this.terrain.version ||
      drawn.globe !== globe.version ||
      drawn.light.dot(light) < 1 - SHADOW_TURN ||
      drawn.centre.distanceTo(centre) > SHADOW_MOVE * drawn.reach ||
      this.shadowDrift().length() * elapsed > SHADOW_MOVE * drawn.reach ||
      lived > SHADOW_LIVED ||
      Math.abs(Math.log(reach / Math.max(drawn.reach, 1))) > Math.log(1.2);
    if (stale) {
      this.sky.syncCamera(camera);
      this.updateCamera(camera, SHADOW_SIZE);
      const u = this.shadowMaterial.uniforms;
      (u.uCloudShadowPlace.value as Vector4).set(
        centre.x,
        centre.y,
        centre.z,
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
    // Carried with the clouds since they were drawn: the lowest level's drift, which casts most
    // of them.
    if (this.shadow)
      this.shadow.centre
        .copy(drawn.centre)
        .addScaledVector(this.shadowDrift(), this.time - drawn.time);
  }

  // The drift the clouds' shadows are carried with (world, m/s): the lowest level drawn's.
  private shadowDrift() {
    const lowest = this.slots[0];
    return lowest ? this.drifts[levelIndexOf(lowest)] : this.drifts[0];
  }

  // The frame fixed to the Earth: its axes toward latitude and longitude 0, longitude 90°
  // east and the north pole, from the globe's true east, north and up at the disc's centre,
  // and where that lies on the conformal sphere. Without a frame, the scene's own east, north
  // and up.
  private updateEarth(globe: Globe) {
    if (globe.version === this.globeVersion) return;
    this.globeVersion = globe.version;
    const up = globe.up;
    const north = globe.north;
    east.crossVectors(north, up).normalize();
    const sphere = globe.uniforms.uGlobeSphere.value;
    const located = sphere.w > 0.5;
    const sinChi = located ? sphere.x : 0;
    const cosChi = located ? sphere.y : 1;
    const lambda = located ? globe.uniforms.uGlobeLocation.value.x : 0;
    const sinL = Math.sin(lambda);
    const cosL = Math.cos(lambda);
    // The Earth's directions of the local east, north and up there.
    const e = [-sinL, cosL, 0];
    const n = [-sinChi * cosL, -sinChi * sinL, cosChi];
    const u = [cosChi * cosL, cosChi * sinL, sinChi];
    this.eastEarth.fromArray(e);
    this.northEarth.fromArray(n);
    const m = this.earth.elements;
    // Column-major: m[col * 3 + row] = e[row] east[col] + n[row] north[col] + u[row] up[col].
    for (let col = 0; col < 3; col++)
      for (let row = 0; row < 3; row++)
        m[col * 3 + row] =
          e[row] * east.getComponent(col) +
          n[row] * north.getComponent(col) +
          u[row] * up.getComponent(col);
    this.marchMaterial.uniforms.uCloudEarth.value.copy(this.earth);
    this.marchMaterial.uniforms.uCloudUpEarth.value
      .copy(up)
      .applyMatrix3(this.earth);
  }

  // `target` (fixed on the Earth, at the scene) the way a wind from bearing `from` (degrees)
  // blows.
  private wayOf(from: number, target: Vector3) {
    const toward = ((from + 180) * Math.PI) / 180;
    return target
      .copy(this.northEarth)
      .multiplyScalar(Math.cos(toward))
      .addScaledVector(this.eastEarth, Math.sin(toward));
  }

  // Each layer's wind (uCloudWinds), turned and strengthened to its level (cloudLayerWind) at
  // the scene's latitude, and each level's in the world (drifts), for the resolve and the rest.
  private updateWinds() {
    const settings = this.settings!;
    const u = this.marchMaterial.uniforms;
    const upEarth = u.uCloudUpEarth.value as Vector3;
    const latitude =
      (Math.asin(MathUtils.clamp(upEarth.z, -1, 1)) * 180) / Math.PI;
    const winds = u.uCloudWinds.value as Vector4[];
    // Back from the Earth's frame to the world's: the frame's transpose (a rotation).
    toWorld.copy(this.earth).transpose();
    for (const drift of this.drifts) drift.set(0, 0, 0);
    for (let i = 0; i < CLOUD_VOLUME_LAYERS; i++) {
      const layer = this.slots[i];
      const wind = layer
        ? cloudLayerWind(layer, settings.wind, latitude)
        : null;
      this.wayOf(wind?.from ?? settings.wind?.from ?? 0, way);
      const speed = wind?.speed ?? 0;
      winds[i].set(way.x, way.y, way.z, speed);
      if (layer)
        this.drifts[levelIndexOf(layer)]
          .copy(way)
          .applyMatrix3(toWorld)
          .multiplyScalar(speed);
    }
  }

  // How fast `camera` sees the clouds at the image's middle from `altitude`, in its pixels a
  // weather second: any level's moving or changing (`moving`: its drift, its clouds' change, a
  // cloud's breadth a lifetime, and rise), and changing alone (`changing`: what the resolve
  // does not follow), each over the nearest the level lies along the view (along its corner
  // rays: the steepest toward it; REST_NEAR inside it); and the nearest any lies (`nearest`).
  private paceOf(altitude: number, camera: Camera) {
    const u = this.marchMaterial.uniforms;
    const winds = u.uCloudWinds.value as Vector4[];
    cameraAt.setFromMatrixPosition(camera.matrixWorld);
    const up = this.sky.globe.upAt(cameraAt, upAt);
    let down = 0;
    let rising = 0;
    for (const [x, y] of CORNERS) {
      const s = ray
        .set(x, y, 0.5)
        .unproject(camera)
        .sub(cameraAt)
        .normalize()
        .dot(up);
      down = Math.max(down, -s);
      rising = Math.max(rising, s);
    }
    let moving = 0;
    let changing = 0;
    let nearest = Infinity;
    this.slots.forEach((layer, i) => {
      const look = LOOKS[layer.type];
      const forms = u.uCloudForms.value[i] as Vector4;
      const change = (CLOUD_CELL_SHARE * forms.x) / look.lifetime + look.rise;
      const base = Math.min(layer.base, layer.top);
      const top = Math.max(layer.base, layer.top);
      const near =
        altitude < base
          ? (base - altitude) / Math.max(rising, REST_SLOPE)
          : altitude > top
            ? (altitude - top) / Math.max(down, REST_SLOPE)
            : 0;
      nearest = Math.min(nearest, near);
      const reach = Math.max(near, REST_NEAR);
      moving = Math.max(moving, (Math.abs(winds[i].w) + change) / reach);
      changing = Math.max(changing, change / reach);
    });
    const pixel = Math.max((u.uCloudMarch.value as Vector4).w, 1e-9);
    pace.moving = moving / pixel;
    pace.changing = changing / pixel;
    pace.nearest = nearest;
    return pace;
  }

  // The march's uniforms for `camera`: where it lies in each pattern's tile, from 64-bit
  // floats; and how large a pixel of the clouds' image is.
  private updateCamera(camera: Camera, height: number) {
    const settings = this.settings!;
    const globe = this.sky.globe;
    this.updateEarth(globe);
    const u = this.marchMaterial.uniforms;
    fromCentre.setFromMatrixPosition(camera.matrixWorld).sub(globe.centre);
    const earth = v.copy(fromCentre).applyMatrix3(this.earth);
    (u.uCloudCameraEarth.value as Vector3).copy(earth);
    // The way the wind blows over the sea, fixed on the Earth.
    this.wayOf(settings.wind?.from ?? 0, windEarth);
    this.updateWinds();
    const time = this.time;
    const upEarth = u.uCloudUpEarth.value as Vector3;

    const offsets = u.uCloudOffsets.value as Vector3[];
    const seed = settings.seed;
    // Where `from` lies in a pattern of `period`: within its tile for the noise's, modulo the
    // value noise's period for the procedural ones (`cells`), each moved by the seed.
    const place = (
      target: Vector3,
      from: Vector3,
      period: number,
      k: number,
      cells = false,
    ) => {
      const wrap = cells ? cellWrap : fract;
      const shift = cells ? CLOUD_VALUE_NOISE_PERIOD : 1;
      return target.set(
        wrap(from.x / period + (seed * 0.371 + k * 0.137) * shift),
        wrap(from.y / period + (seed * 0.719 + k * 0.293) * shift),
        wrap(from.z / period + (seed * 0.137 + k * 0.611) * shift),
      );
    };
    // `from` read on through the noise along up by `share` of `period` (CLOUD_LIFE_*): the
    // pattern changes where it lies rather than moving.
    const through = (from: Vector3, period: number, share: number) =>
      sliced.copy(from).addScaledVector(upEarth, -share * period);
    // Each layer's coverage, its broad octave, its second tap and its shape volume (the
    // shader's CLOUD_OFFSET_*), where the camera lies among its clouds as they have drifted
    // with its wind (`time` × its wind), in a frame drawn out along that wind as far as its
    // type is (cloudStretched); read on through the noise as they form and fade (a quarter of
    // a period, a cloud's breadth, each lifetime), the billows rising.
    const winds = u.uCloudWinds.value as Vector4[];
    for (let i = 0; i < CLOUD_VOLUME_LAYERS; i++) {
      const forms = u.uCloudForms.value[i] as Vector4;
      const k = (u.uCloudStyles.value[i] as Vector4).x;
      const wind = winds[i];
      way.set(wind.x, wind.y, wind.z);
      moved.copy(earth).addScaledVector(way, -wind.w * time);
      stretched.copy(moved).addScaledVector(way, moved.dot(way) * k);
      const look = this.slots[i] ? LOOKS[this.slots[i].type] : null;
      const lives = time / (look?.lifetime ?? CLOUD_LIFE_DEFAULT);
      const shapes = u.uCloudShapes.value[i] as Vector4;
      const first = 11 * i;
      place(
        offsets[4 * i],
        through(stretched, forms.x, CLOUD_CELL_SHARE * lives),
        forms.x,
        first,
      );
      turned
        .copy(
          through(
            stretched,
            forms.x * CLOUD_NOISE_BROAD,
            (CLOUD_CELL_SHARE * lives) / CLOUD_LIFE_BROAD,
          ),
        )
        .applyMatrix3(TURN);
      place(
        offsets[4 * i + 1],
        turned,
        forms.x * CLOUD_NOISE_BROAD,
        first + 1,
        true,
      );
      turned
        .copy(
          through(
            stretched,
            forms.x * CLOUD_NOISE_SECOND,
            (CLOUD_CELL_SHARE * lives) / CLOUD_LIFE_SECOND,
          ),
        )
        .applyMatrix3(TURN);
      place(
        offsets[4 * i + 2],
        turned,
        forms.x * CLOUD_NOISE_SECOND,
        first + 5,
      );
      // The billows: flattened by shapes.z up the layer, as the shader reads them.
      const risen = (look?.rise ?? 0) * time * shapes.z;
      place(
        offsets[4 * i + 3],
        through(stretched, forms.y, CLOUD_CELL_SHARE * lives + risen / forms.y),
        forms.y,
        first + 9,
      );
    }
    // The detail and the warp drift with the lowest layer drawn, the nearest the camera
    // most often, and the detail changes in minutes.
    const low = winds[0];
    way.set(low.x, low.y, low.z);
    moved.copy(earth).addScaledVector(way, -low.w * time);
    const detail = (u.uCloudVolumes.value as Vector2).x;
    place(
      offsets[4 * CLOUD_VOLUME_LAYERS],
      through(moved, detail, (CLOUD_CELL_SHARE * time) / CLOUD_LIFE_DETAIL),
      detail,
      4,
    );
    place(
      offsets[4 * CLOUD_VOLUME_LAYERS + 1],
      earth,
      PERIOD_SCENE_WARP,
      7,
      true,
    );
    const warp = u.uCloudWarp.value as number;
    place(
      offsets[4 * CLOUD_VOLUME_LAYERS + 2],
      through(moved, warp, (CLOUD_CELL_SHARE * time) / CLOUD_LIFE_WARP),
      warp,
      8,
    );

    // Each layer's rows: across the way they run (along its wind, or across it), over their
    // spacing, and where the camera lies among them as they drift.
    this.slots.forEach((layer, i) => {
      const look = LOOKS[layer.type];
      const wind = winds[i];
      way.set(wind.x, wind.y, wind.z);
      // Across the wind: its way turned a quarter clockwise about up.
      across.crossVectors(way, upEarth);
      const rows = u.uCloudRows.value[i] as Vector4;
      v4.copy(look.rowsAcross ? way : across).divideScalar(
        look.rowSpacing * settings.scale,
      );
      moved.copy(earth).addScaledVector(way, -wind.w * time);
      rows.set(v4.x, v4.y, v4.z, fract(moved.dot(v4) + seed * 0.43 + i * 0.29));
    });
    // The wind the ground lifts the air by: the way it blows, and its speed.
    (u.uCloudWind.value as Vector4).set(
      windEarth.x,
      windEarth.y,
      windEarth.z,
      settings.wind?.speed ?? 0,
    );

    // The cloud map's texels per world unit, at a face's middle.
    (u.uCloudWeather.value as Vector4).w = CLOUD_MAP_SIZE / (2 * globe.radius);

    // The angle a pixel of the clouds' image spans, at the middle of the view. Its magnitude:
    // a CubeCamera's faces are drawn with a field of view of −90°.
    const focal = Math.abs(camera.projectionMatrix.elements[5]);
    (u.uCloudMarch.value as Vector4).w = 2 / (Math.max(focal, 1e-6) * height);
  }

  /**
   * The noise volumes `renderer` draws it with: acquired the first time, not drawn yet. Compile
   * their generator, then {@link generate} them before it shows.
   */
  noise(renderer: WebGLRenderer): CloudNoiseVolumes {
    if (this.volumes?.renderer !== renderer) {
      if (this.volumes) releaseCloudNoiseVolumes(this.volumes.renderer);
      const noise = acquireCloudNoiseVolumes(renderer);
      this.volumes = { renderer, noise };
      const u = this.marchMaterial.uniforms;
      u.uCloudShape.value = noise.shape.texture;
      u.uCloudDetail.value = noise.detail.texture;
    }
    return this.volumes.noise;
  }

  /** Draw the noise volumes `renderer` draws it with, unless done already. */
  generate(renderer: WebGLRenderer) {
    generateCloudNoiseVolumes(renderer, this.noise(renderer));
  }

  /**
   * What draws `renderer`'s cloud maps, the same for every seed: compile them before
   * {@link bakeMap}.
   */
  mapGenerators(renderer: WebGLRenderer) {
    const maps = this.ensureMaps(renderer);
    const any = maps.next ?? maps.newer;
    if (any) return any.generators;
    // Made (not drawn) to compile with: the first one bakeMap draws.
    maps.next = acquireCloudMap(renderer, 0, this.terrain.mapTerrain, 0);
    maps.fresh = true;
    return maps.next.generators;
  }

  private ensureMaps(renderer: WebGLRenderer) {
    if (this.maps?.renderer !== renderer) {
      this.releaseMaps();
      this.maps = {
        renderer,
        older: null,
        newer: null,
        next: null,
        fresh: true,
        blendStart: 0,
      };
    }
    return this.maps;
  }

  /**
   * Draw more of the cloud maps for `seed` with `renderer`, a few strips a frame, and draw with
   * them once done; until then, with the ones before. As the clock runs, the next one ahead is
   * drawn in the background and blended into (`documents/clouds.md`, "Motion"). While its
   * terrain is coming in, none is begun: one without the ground would be drawn again at once.
   * Whether it has a map to draw with.
   */
  bakeMap(renderer: WebGLRenderer, seed: number): boolean {
    const maps = this.ensureMaps(renderer);
    const time = this.time;
    // The clock's pace, and a frame's wall time, eased over some half a second.
    const wall = performance.now() / 1000;
    if (this.paceWall > 0) {
      const dw = Math.min(Math.max(wall - this.paceWall, 1e-3), 0.25);
      const ease = 1 - Math.exp(-dw / 0.5);
      this.pace += ((time - this.paceTime) / dw - this.pace) * ease;
      this.frameWall += (dw - this.frameWall) * ease;
    }
    this.paceTime = time;
    this.paceWall = wall;
    if (this.terrain.waiting) return maps.newer !== null;

    const terrain = this.terrain.mapTerrain;
    const base = cloudMapKey(seed, terrain);
    const newer = maps.newer;
    const fresh =
      !newer ||
      newer.base !== base ||
      time > newer.time + MAP_JUMP ||
      time < (maps.older ?? newer).time - MAP_SPAN;
    if (fresh) {
      // Drawn anew at the time now, and shown alone once drawn.
      if (!maps.fresh || maps.next?.base !== base) this.dropNext();
      if (!maps.next) {
        maps.next = acquireCloudMap(renderer, seed, terrain, time);
        maps.fresh = true;
      }
    } else if (
      !maps.next &&
      this.pace > 0 &&
      newer.time < time + this.mapSpan()
    ) {
      // The next one ahead, while the clock runs on toward the newer.
      maps.next = acquireCloudMap(
        renderer,
        seed,
        terrain,
        newer.time + this.mapSpan(),
      );
      maps.fresh = false;
    }

    const next = maps.next;
    if (next) {
      const strips = !newer ? MAP_STRIPS_FIRST : this.mapStrips();
      // The next one ahead takes over once the clock has come to the newer.
      const due = maps.fresh || !newer || time >= newer.time;
      if (bakeCloudMap(renderer, next, strips) && due) {
        if (maps.fresh) {
          this.releaseMap(maps.older);
          this.releaseMap(maps.newer);
          maps.older = null;
        } else {
          this.releaseMap(maps.older);
          maps.older = maps.newer;
        }
        maps.newer = next;
        maps.next = null;
        maps.blendStart = time;
        this.version++;
      }
    }
    this.updateMapUniforms();
    return maps.newer !== null;
  }

  // Strips of the next map drawn a frame as the clock runs: enough to draw it in MAP_DRAW_SHARE
  // of MAP_SPAN_MOST at the pace, if they can.
  private mapStrips() {
    const wall =
      (MAP_DRAW_SHARE * MAP_SPAN_MOST) / Math.max(Math.abs(this.pace), 1e-6);
    const strips = Math.ceil((CLOUD_MAP_STRIPS * this.frameWall) / wall);
    return MathUtils.clamp(strips, MAP_STRIPS_NEXT, MAP_STRIPS_MOST);
  }

  // The time between two maps as the clock runs (weather seconds): MAP_SPAN, or as long as one
  // takes to draw at the pace, over MAP_DRAW_SHARE.
  private mapSpan() {
    const drawn = (CLOUD_MAP_STRIPS / this.mapStrips()) * this.frameWall;
    return Math.max(MAP_SPAN, (drawn * Math.abs(this.pace)) / MAP_DRAW_SHARE);
  }

  // The march's maps and how it blends them (cloudMapRead): the older and the newer, the newer's
  // share by the clock between the blend's start and the newer's time, and each one's age.
  private updateMapUniforms() {
    const u = this.marchMaterial.uniforms;
    const maps = this.maps;
    const newer = maps?.newer ?? null;
    const older = maps?.older ?? newer;
    u.uCloudMap.value = older?.texture ?? null;
    u.uCloudMapNext.value = newer?.texture ?? null;
    let share = 0;
    if (maps && older && newer && older !== newer) {
      const span = newer.time - maps.blendStart;
      share =
        span > 1
          ? MathUtils.clamp((this.time - maps.blendStart) / span, 0, 1)
          : 1;
    }
    (u.uCloudMapTimes.value as Vector3).set(
      share,
      older ? this.time - older.time : 0,
      newer ? this.time - newer.time : 0,
    );
  }

  private dropNext() {
    const maps = this.maps;
    if (!maps?.next) return;
    releaseCloudMap(maps.renderer, maps.next);
    maps.next = null;
  }

  private releaseMap(map: CloudMap | null) {
    if (map && this.maps) releaseCloudMap(this.maps.renderer, map);
  }

  private releaseMaps() {
    const maps = this.maps;
    if (!maps) return;
    for (const map of [maps.older, maps.newer, maps.next])
      if (map) releaseCloudMap(maps.renderer, map);
    this.maps = null;
    const u = this.marchMaterial.uniforms;
    u.uCloudMap.value = null;
    u.uCloudMapNext.value = null;
  }

  /** March the clouds for `camera` into their image, at the share of `renderer`'s target. */
  render(renderer: WebGLRenderer, camera: Camera) {
    const settings = this.settings;
    if (!settings) return;
    this.generate(renderer);
    const outer = renderer.getRenderTarget();
    const cubeFace = renderer.getActiveCubeFace();
    const mipLevel = renderer.getActiveMipmapLevel();
    if (outer) size.set(outer.width, outer.height);
    else renderer.getDrawingBufferSize(size);

    this.sky.syncCamera(camera);
    const quality = settings.quality;
    // From high up a layer is a few steps: there the image may take more of the screen.
    const altitude = this.sky.globe.uniforms.uGlobeCamera.value.z;
    let share = Math.min(Math.max(quality.resolution, 0.25), 1);
    for (const [above, aloft] of quality.aloft)
      if (altitude > above) {
        share = Math.max(share, aloft);
        break;
      }
    // One pixel in each 2 × 2 marched a frame, in turn, the rest from the frames before; and
    // the image smaller where it would take more rays than the quality's.
    const sparse = quality.sparse && settings.temporal;
    const rays = (size.x * size.y * share * share) / (sparse ? 4 : 1);
    if (rays > quality.rays) share *= Math.sqrt(quality.rays / rays);
    let width = Math.max(Math.round(size.x * share), 1);
    let height = Math.max(Math.round(size.y * share), 1);
    if (sparse) {
      width = 2 * Math.max(Math.round(width / 2), 1);
      height = 2 * Math.max(Math.round(height / 2), 1);
    }
    const marchWidth = sparse ? width / 2 : width;
    const marchHeight = sparse ? height / 2 : height;
    if (this.target.width !== marchWidth || this.target.height !== marchHeight)
      this.target.setSize(marchWidth, marchHeight);

    const state = settings.temporal
      ? this.historyOf(camera, width, height)
      : null;
    const u = this.marchMaterial.uniforms;
    const frame = state ? state.frame : 0;
    u.uCloudFrame.value = frame % 1024;
    // Each ray moved within its pixel of the image, and in a sparse march to the pixel of its
    // 2 × 2 it takes this frame (in NDC): each of those takes every place in turn.
    const [cx, cy] = sparse ? CELLS[frame % CELLS.length] : [0.5, 0.5];
    const turn = sparse ? Math.floor(frame / CELLS.length) : frame;
    const [jx, jy] = state ? JITTER[turn % JITTER.length] : [0, 0];
    (u.uCloudJitter.value as Vector2).set(
      (2 * (cx - 0.5 + jx)) / width,
      (2 * (cy - 0.5 + jy)) / height,
    );
    this.updateCamera(camera, height);
    this.paceOf(altitude, camera);

    const composite = this.compositeMaterial.uniforms;
    // What the march reads, against the frame before: unchanged (still), or nearly (calm).
    let near = false;
    if (state) {
      const inputs = this.inputsOf(camera, width, height, this.inputs);
      near = state.valid && sameInputs(inputs, state.inputs, CALM_INPUTS);
      state.still =
        state.valid && sameInputs(inputs, state.inputs) ? state.still + 1 : 0;
      this.inputs = state.inputs;
      state.inputs = inputs;
    }
    // At rest: the image the frames settled into, held while nothing the march reads changes
    // but the clock; as it runs, marched again once the clouds may have moved a share of a
    // pixel (paceOf), or a while has passed.
    if (state && this.holdAtRest) {
      if (state.still >= REST_FRAMES) {
        // The clock running: held until enough has changed. Stopped: marched on until the
        // frames have settled at its time (calm), then held.
        const elapsed = Math.abs(this.time - state.marched);
        const hold =
          elapsed > 0
            ? pace.moving * elapsed < REST_CHANGE &&
              performance.now() - state.marchedWall < REST_LONGEST
            : state.calm >= REST_SETTLED;
        if (hold) {
          const image = state.images[state.index];
          composite.uCloudImage.value = image.texture;
          composite.uCloudDepth.value = image.depthTexture;
          composite.uCloudSoften.value = 0;
          (composite.uCloudImageSize.value as Vector2).set(width, height);
          return;
        }
      }
    }

    // Nested in the scene's render: leave its counters, shadows and clearing alone.
    const autoClear = renderer.autoClear;
    const autoReset = renderer.info.autoReset;
    const shadows = renderer.shadowMap.autoUpdate;
    renderer.autoClear = false;
    renderer.info.autoReset = false;
    renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(this.target);
    renderer.render(this.marchScene, camera);
    const wall = performance.now();
    const wallElapsed = state ? (wall - state.marchedWall) / 1000 : 0;
    if (state) {
      state.calm = this.time === state.marched ? state.calm + 1 : 0;
      state.marched = this.time;
      state.marchedWall = wall;
    }

    if (state) {
      const read = state.images[state.index];
      const write = state.images[1 - state.index];
      const r = this.resolveMaterial.uniforms;
      cameraAt.setFromMatrixPosition(camera.matrixWorld);
      const move = (r.uCloudCameraMove.value as Vector3).subVectors(
        cameraAt,
        state.position,
      );
      // And the clouds' drift since the last frame, each level's (a jump of the clock moves
      // them out of the view, and the history starts over).
      const elapsed = state.valid ? this.time - state.weather : 0;
      const timelapse = Math.abs(elapsed) > TIMELAPSE_RATE * wallElapsed;
      // What the reprojection does not follow, in pixels: the clouds' change where they are,
      // and under a timelapse their drift too (SPARSE_FAST).
      const changed =
        (timelapse ? pace.moving : pace.changing) * Math.abs(elapsed);
      // Changing fast, the pixels a sparse march did not reach take some of it.
      (r.uCloudSparse.value as Vector4).set(
        sparse ? 1 : 0,
        cx,
        cy,
        sparse ? SPARSE_FAST * MathUtils.smoothstep(changed, 0.02, 0.3) : 0,
      );
      // Where this frame's rays crossed their texels, from each one's first pixel of the image.
      (r.uCloudSample.value as Vector2).set(
        cx + (sparse ? 0.5 : 0) + jx,
        cy + (sparse ? 0.5 : 0) + jy,
      );
      (r.uCloudBlur.value as Vector3).set(
        Math.log2(Math.max(Math.min(pace.nearest, 1e9), BLUR_NEAR)),
        1 / BLUR_OCTAVES,
        BLUR_MOST,
      );
      (r.uCloudDrift.value as Vector3[]).forEach((drift, l) =>
        drift.copy(this.drifts[l]).multiplyScalar(elapsed),
      );
      const globe = this.sky.globe;
      (r.uCloudLevels.value as Vector4).set(
        altitude,
        globe.uniforms.uGlobe.value.w > 0.5 ? 0.5 / globe.radius : 0,
        this.splits[0],
        this.splits[1],
      );
      globe.upAt(cameraAt, r.uCloudUp.value as Vector3);
      state.weather = this.time;
      // A jump (a move to a place, a new view) starts over rather than smearing the old.
      const jump = move.length() > Math.max(1000, 0.25 * altitude);
      (r.uCloudImageSize.value as Vector2).set(width, height);
      (r.uCloudCurrentSize.value as Vector2).set(marchWidth, marchHeight);
      // Calm (the view still, what the march reads nearly so, the clouds changing slowly): the
      // frames before kept longer.
      const unmoved =
        move.lengthSq() === 0 &&
        rotationNow
          .setFromMatrix4(camera.matrixWorldInverse)
          .equals(state.rotation) &&
        camera.projectionMatrix.equals(state.projection);
      state.steady =
        near &&
        unmoved &&
        !timelapse &&
        changed < CALM_CHANGE &&
        pace.moving * Math.abs(elapsed) < CALM_DRIFT
          ? state.steady + 1
          : 0;
      const calm = MathUtils.smoothstep(state.steady, 0, CALM_FRAMES);
      const blend =
        state.valid && !jump
          ? (sparse ? TEMPORAL_BLEND_SPARSE : TEMPORAL_BLEND) *
            (1 - (1 - CALM_SHARE) * calm)
          : 1;
      r.uCloudHistory.value = read.texture;
      // ⚠️ Only once it holds a frame at this size: its depth texture keeps its old size until
      // its target is drawn into again, and bound before that, the target is left incomplete.
      r.uCloudHistoryDepth.value =
        blend < 1 ? read.depthTexture : this.target.depthTexture;
      (r.uCloudPreviousRotation.value as Matrix3).copy(state.rotation);
      (r.uCloudPreviousProjection.value as Matrix4).copy(state.projection);
      r.uCloudBlend.value = blend;
      renderer.setRenderTarget(write);
      renderer.render(this.resolveScene, camera);
      state.index = 1 - state.index;
      state.frame++;
      state.valid = true;
      state.rotation.setFromMatrix4(camera.matrixWorldInverse);
      state.projection.copy(camera.projectionMatrix);
      state.position.copy(cameraAt);
      composite.uCloudImage.value = write.texture;
      composite.uCloudDepth.value = write.depthTexture;
      composite.uCloudSoften.value = 0;
    } else {
      composite.uCloudImage.value = this.target.texture;
      composite.uCloudDepth.value = this.target.depthTexture;
      composite.uCloudSoften.value = 1;
    }
    (composite.uCloudImageSize.value as Vector2).set(width, height);

    renderer.setRenderTarget(outer, cubeFace, mipLevel);
    renderer.autoClear = autoClear;
    renderer.info.autoReset = autoReset;
    renderer.shadowMap.autoUpdate = shadows;
  }

  // What the march reads for `camera` with an image `width` by `height`, as numbers, into
  // `out` (holdAtRest): the view, what the clouds and their ground are, and its uniforms.
  private inputsOf(
    camera: Camera,
    width: number,
    height: number,
    out: number[],
  ) {
    out.length = 0;
    out.push(width, height, this.terrain.version);
    camera.matrixWorld.toArray(out, out.length);
    camera.projectionMatrix.toArray(out, out.length);
    const uniforms = this.marchMaterial.uniforms;
    for (const name of this.inputNames) pushInput(out, uniforms[name].value);
    return out;
  }

  /**
   * Film the clouds as seen from `position` (world) into {@link texture}, all round: each
   * face marched once, without the frames' accumulation, at half its resolution. Clear when
   * they do not show ({@link filmable}). For a `Scenery`'s bakes of the air
   * (`ScenerySkyOverlay`), and the sea's reflection.
   */
  film(renderer: WebGLRenderer, position: Vector3) {
    const autoClear = renderer.autoClear;
    const clearAlpha = renderer.getClearAlpha();
    renderer.getClearColor(clearColor);
    renderer.autoClear = true;
    renderer.setClearColor(0x000000, 0);
    this.still.visible = this.filmable && this.settings !== null;
    this.cubeCamera.position.copy(position);
    this.cubeCamera.updateMatrixWorld();
    this.cubeCamera.update(renderer, this.cubeScene);
    renderer.setClearColor(clearColor, clearAlpha);
    renderer.autoClear = autoClear;
  }

  // The march for one of the cube's faces, `camera` its, as the still composite is drawn into
  // it: STILL_SHARE of its resolution, no jitter, no history.
  private renderStill(renderer: WebGLRenderer, camera: Camera) {
    if (!this.settings) return;
    this.generate(renderer);
    const outer = renderer.getRenderTarget();
    const cubeFace = renderer.getActiveCubeFace();
    const mipLevel = renderer.getActiveMipmapLevel();
    const side = Math.max(
      Math.round((outer ? outer.width : CUBE_SIZE) * STILL_SHARE),
      8,
    );
    if (this.stillTarget.width !== side) this.stillTarget.setSize(side, side);

    this.sky.syncCamera(camera);
    const u = this.marchMaterial.uniforms;
    u.uCloudFrame.value = 0;
    (u.uCloudJitter.value as Vector2).set(0, 0);
    this.updateCamera(camera, side);

    const autoClear = renderer.autoClear;
    const autoReset = renderer.info.autoReset;
    const shadows = renderer.shadowMap.autoUpdate;
    renderer.autoClear = false;
    renderer.info.autoReset = false;
    renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(this.stillTarget);
    renderer.render(this.marchScene, camera);
    renderer.setRenderTarget(outer, cubeFace, mipLevel);
    renderer.autoClear = autoClear;
    renderer.info.autoReset = autoReset;
    renderer.shadowMap.autoUpdate = shadows;
    (this.stillMaterial.uniforms.uCloudImageSize.value as Vector2).set(
      side,
      side,
    );
  }

  // `camera`'s history, at `width` by `height`: made the first time, and started over after a
  // pause or at a new size. Those of cameras long unused are let go.
  private historyOf(camera: Camera, width: number, height: number) {
    const now = performance.now();
    for (const [other, state] of this.histories)
      if (other !== camera && now - state.time > 10 * TEMPORAL_GAP) {
        state.images.forEach(image => image.dispose());
        this.histories.delete(other);
      }
    let state = this.histories.get(camera);
    if (!state) {
      state = {
        images: [createImage(), createImage()],
        index: 0,
        frame: 0,
        valid: false,
        time: now,
        rotation: new Matrix3(),
        projection: new Matrix4(),
        position: new Vector3(),
        inputs: [],
        still: 0,
        weather: 0,
        marched: 0,
        marchedWall: 0,
        calm: 0,
        steady: 0,
      };
      this.histories.set(camera, state);
    }
    const [first, second] = state.images;
    if (first.width !== width || first.height !== height) {
      first.setSize(width, height);
      second.setSize(width, height);
      state.valid = false;
    }
    if (now - state.time > TEMPORAL_GAP) state.valid = false;
    if (!state.valid) state.still = 0;
    state.time = now;
    return state;
  }

  /** Its images and its share of the noise and the maps; the materials are the owner's to release. */
  /**
   * Draw what has come in of its terrain, and ask for the ground about `camera` as it moves.
   * In the frame loop.
   */
  updateTerrain(renderer: WebGLRenderer, camera: Camera) {
    cameraAt.setFromMatrixPosition(camera.matrixWorld);
    this.terrain.update(renderer, this.sky.globe, cameraAt);
  }

  /**
   * Dispose of everything it holds; its terrain's material through `release` (default
   * `dispose`), such as `releaseMaterial`, so none goes while its program still links.
   */
  dispose(release: (material: Material) => void = m => m.dispose()) {
    this.target.dispose();
    for (const state of this.histories.values())
      state.images.forEach(image => image.dispose());
    this.histories.clear();
    this.march.geometry.dispose();
    releaseNoise();
    if (this.volumes) releaseCloudNoiseVolumes(this.volumes.renderer);
    this.volumes = null;
    this.releaseMaps();
    this.terrain.dispose(release);
    this.cube.dispose();
    this.stillTarget.dispose();
    release(this.stillMaterial);
    this.shadowTarget.dispose();
    release(this.shadowMaterial);
    this.shadow = null;
  }
}

const fract = (x: number) => x - Math.floor(x);
const cellWrap = (x: number) =>
  x - Math.floor(x / CLOUD_VALUE_NOISE_PERIOD) * CLOUD_VALUE_NOISE_PERIOD;
