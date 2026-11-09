import {
  AlwaysDepth,
  Camera,
  Color,
  CustomBlending,
  DepthTexture,
  FloatType,
  HalfFloatType,
  IUniform,
  LinearFilter,
  MathUtils,
  Matrix3,
  Mesh,
  NoBlending,
  OneFactor,
  OneMinusSrcAlphaFactor,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  SrcAlphaFactor,
  Texture,
  Uniform,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import { LAYERS } from '../../layers/layers';
import { conformalOffset } from '../../sdk/projection/conformal-sphere';
import type { Globe } from '../../sdk/projection/globe';
import {
  CUMULUS_BODY,
  CUMULUS_GRIDS,
  CUMULUS_MARGIN,
  CUMULUS_REACH,
  CUMULUS_WRAP,
  cumulusEpoch,
  cumulusGrids,
  cumulusGridSeed,
  cumulusGridTurn,
  STRATO_EDGE,
  STRATO_GAIN,
  STRATO_LACUNARITY,
  STRATO_OCTAVES,
  STRATO_PERIOD,
  STRATO_STRETCH,
  STRATO_WARP,
  stratoOctave,
  stratoOctaveShift,
  stratoStatistics,
  stratoThreshold,
} from '../../sdk/weather/cloud-field';
import { softCoverLevel } from '../../sdk/weather/soft-clouds';
import {
  cloudLayerWind,
  type CloudLayer,
  type CloudType,
  type WeatherWind,
} from '../../sdk/weather/weather';
import {
  acquireCloudNoiseVolumes,
  CloudNoiseVolumes,
  generateCloudNoiseVolumes,
  releaseCloudNoiseVolumes,
} from './scenery-cloud-noise';
import { CLOUD_COVER_SIZE, CloudCoverMap } from './scenery-cloud-cover';
import { createSceneryGeometry, SceneryMaterial } from './scenery-material';
import type {
  SceneryCloudVolumeDebug,
  SceneryCloudVolumeQuality,
} from './scenery-model';
import compositeShader from './shaders/cloud-volume-composite.glsl';
import marchShader from './shaders/cloud-volume-march.glsl';
import vertexShader from './shaders/cloud-volume-vertex.glsl';

/**
 * What a {@link SceneryCloudVolumeQuality} spends on a `SceneryCloudVolume`'s clouds
 * (`CLOUD_VOLUME_QUALITY`).
 *
 * @group Components
 */
export type CloudVolumeQualityLevel = {
  /** the share of the screen's resolution their image is drawn at */
  resolution: number;
  /** the most iterations along a view: crossings of the cumulus's cells and columns, and samples */
  iterations: number;
  /** samples across a cumulus's radius */
  samples: number;
  /** samples toward the light from each sample in a cumulus */
  lightSamples: number;
  /** samples along a view through the strato layer */
  stratoSamples: number;
  /** a size of cumulus is drawn as its clouds while they are this many pixels across; smaller, as their mean */
  pixels: number;
  /** stretches along each run of a view through the soft clouds' layer (`soft`) */
  softSamples: number;
  /** stretches toward the light from each stretch in the soft clouds: its skin, then the rest */
  softLightSamples: number;
};

/**
 * The qualities a `SceneryCloudVolume` draws at (`quality`): every pixel of their image marched
 * every frame, so what they cost depends only on what is in view (`documents/clouds.md`,
 * "Quality").
 *
 * @group Components
 */
export const CLOUD_VOLUME_QUALITY: Readonly<
  Record<SceneryCloudVolumeQuality, CloudVolumeQualityLevel>
> = {
  low: {
    resolution: 0.35,
    iterations: 96,
    samples: 3,
    lightSamples: 1,
    stratoSamples: 16,
    pixels: 3,
    softSamples: 24,
    softLightSamples: 2,
  },
  medium: {
    resolution: 0.5,
    iterations: 128,
    samples: 4,
    lightSamples: 2,
    stratoSamples: 24,
    pixels: 2,
    softSamples: 32,
    softLightSamples: 2,
  },
  high: {
    resolution: 0.75,
    iterations: 160,
    samples: 6,
    lightSamples: 2,
    stratoSamples: 32,
    pixels: 1.5,
    softSamples: 48,
    softLightSamples: 3,
  },
  ultra: {
    resolution: 1,
    iterations: 224,
    samples: 8,
    lightSamples: 3,
    stratoSamples: 48,
    pixels: 1,
    softSamples: 64,
    softLightSamples: 4,
  },
};

/** `quality`'s level, with a `resolution` of its own instead of the quality's. */
export function cloudVolumeQuality(
  quality: SceneryCloudVolumeQuality,
  { resolution }: { resolution?: number } = {},
): CloudVolumeQualityLevel {
  const level = CLOUD_VOLUME_QUALITY[quality] ?? CLOUD_VOLUME_QUALITY.medium;
  return { ...level, resolution: resolution ?? level.resolution };
}

/**
 * How a `SceneryCloudVolume` draws a {@link CloudType}: as separate heaped clouds
 * (`'cumulus'`), or as a soft field of veils drawn out along the wind (`'strato'`: stratus,
 * stratocumulus and nimbostratus for now). Null: not drawn yet (the middle and high types).
 *
 * @group Components
 */
export type CloudVolumeForm = 'cumulus' | 'strato';

/** How a `SceneryCloudVolume` draws `type` ({@link CloudVolumeForm}); null where it does not. */
export function cloudVolumeFormOf(type: CloudType): CloudVolumeForm | null {
  if (type === 'cumulus') return 'cumulus';
  if (type === 'stratus' || type === 'stratocumulus' || type === 'nimbostratus')
    return 'strato';
  return null;
}

// The extinction in a cumulus (1 / metre, at density 1), and the optical depth straight up
// through a strato veil's core (at density 1), whatever its thickness.
const CUMULUS_EXTINCTION = 0.02;
const STRATO_DEPTH = 5;
// The detail volume's period (metres, at scale 1).
const PERIOD_DETAIL = 600;
// A local weather's layer thins out over this outer share of its radius.
const LOCAL_EDGE = 0.2;
// The image's depth: log2 of the distance over this many doublings (cloud-volume-composite.glsl).
const DEPTH_RANGE = '32.0';
// The soft clouds (`soft`): their cover map's texel (metres, at scale 1: its tile 2048 of them),
// the extinction inside them (1 / metre, at density 1), and the size of a cloud (metres, at
// scale 1: how a stretch of cloud and sky mixed hides what lies behind). Their lumps are the
// shape volume tiled this many times over the map's tile.
const SOFT_TEXEL = 100;
const SOFT_EXTINCTION = 0.03;
const SOFT_CHUNK = 1500;
const SOFT_LUMP_TILES = 100;
// How the cover a column needs rises up the soft clouds' layer (a power): domed tops over flat
// bases.
const SOFT_DOME = 2;
// The most short steps through each part of a soft clouds' step holding cloud
// (cloud-volume-march.glsl, softFine): a part up to 16 mean free paths long is walked in steps of
// 2, a longer one in longer steps.
const SOFT_FINE_STEPS = 8;
// The most the composite draws the clouds nearer than their depth, to take in the spread of a
// texel's depth over a slanting layer: 2 % of the distance, in the image's depth units.
const DEPTH_MARGIN = (Math.log2(1 / 0.98) / Number(DEPTH_RANGE)).toFixed(7);

/** What a {@link CloudVolumeRenderer} draws, resolved. */
export type CloudVolumeSettings = {
  /** the layer drawn; null for none */
  layer: CloudLayer | null;
  /**
   * the local weather it lies in: about its middle (where the World's anchor lies as it is
   * first drawn, unless it says), within its radius (world units)
   */
  local: { latitude?: number; longitude?: number; radius: number };
  /** the wind over the sea: the layer's, turned and strengthened aloft, unless it has its own */
  wind: WeatherWind | null;
  scale: number;
  density: number;
  color: Color;
  seed: number;
  /** how much they spend for how they look (cloudVolumeQuality) */
  quality: CloudVolumeQualityLevel;
  /**
   * the low layer drawn as soft clouds instead (a spike: SceneryCloudVolumeSoft, resolved); null
   * for the layer's own form
   */
  soft: CloudVolumeSoft | null;
  debug: SceneryCloudVolumeDebug;
};

/** A {@link CloudVolumeSettings}'s soft clouds: each of SceneryCloudVolumeSoft's, resolved. */
export type CloudVolumeSoft = {
  softness: number;
  lumps: number;
  towering: number;
  masses: number;
};

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
      // A tent of four taps as the image is scaled up: there is no accumulation of frames.
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

const size = new Vector2();
const east = new Vector3();
const fromCentre = new Vector3();
const toWorld = new Matrix3();
const localOffset: [number, number] = [0, 0];

const gridVectors = () =>
  Array.from({ length: CUMULUS_GRIDS }, () => new Vector4());

/**
 * The 3D clouds of a `SceneryCloudVolume` (see `documents/clouds.md`): one layer of a local
 * weather, cumulus or strato (or soft clouds, a spike: `soft`), marched along each pixel's view
 * at a share of the screen's resolution every frame, and laid over the scene at the depth of
 * their front. Drawn from its {@link composite}'s `onBeforeRender`, with the camera drawing it.
 */
export class CloudVolumeRenderer {
  /** drawn in the scene, last (`LAYERS.OVERLAY` in an `OITRenderPass`) */
  readonly composite: Mesh;
  /** the march, drawn into the clouds' own image as the composite is drawn */
  readonly march: Mesh;
  readonly marchMaterial: ShaderMaterial;
  readonly compositeMaterial: ShaderMaterial;
  /**
   * The weather's time (seconds) the clouds are drawn at: they drift with the layer's wind
   * and form and fade as it runs. Set each frame (`SceneryCloudVolume`: its `Weather`'s clock).
   */
  time = 0;
  /** How fast the weather's clock runs (its seconds a second; 0 stood). Set each frame with {@link time}. */
  rate = 1;
  private readonly sky: SceneryMaterial;
  private readonly marchScene = new Scene();
  private readonly target = createImage();
  // The soft clouds' cover map (`soft`), drawn once they are.
  private readonly cover = new CloudCoverMap();
  private settings: CloudVolumeSettings | null = null;
  private form: CloudVolumeForm | 'soft' | null = null;
  // The cumulus's grids (cumulusGrids), for the clock and the drift.
  private grids: ReturnType<typeof cumulusGrids>['grids'] = [];
  // The noise volumes of the renderer drawing it (one at a time).
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
  // The field's axes in the world (east, north and up at the weather's middle), and the
  // layer's wind on it (the way it blows, east and north, and its speed).
  private readonly frameE = new Vector3(1, 0, 0);
  private readonly frameN = new Vector3(0, 0, -1);
  private readonly frameM = new Vector3(0, 1, 0);
  private readonly wind = new Vector3(0, 1, 0);

  constructor(sky: SceneryMaterial, renderOrder: number) {
    this.sky = sky;
    const geometry = createSceneryGeometry();
    const statistics = stratoStatistics();

    this.marchMaterial = new ShaderMaterial({
      name: 'scenery-cloud-volume-march',
      vertexShader,
      fragmentShader: marchShader,
      defines: {
        CLOUD_DEPTH_RANGE: DEPTH_RANGE,
        CLOUD_LOCAL_EDGE: LOCAL_EDGE.toFixed(2),
        CLOUD_GRIDS: CUMULUS_GRIDS,
        CLOUD_WRAP: CUMULUS_WRAP,
        CLOUD_REACH: CUMULUS_REACH.toFixed(4),
        CLOUD_CUMULUS_BODY: CUMULUS_BODY.toFixed(4),
        CLOUD_MARGIN: CUMULUS_MARGIN.toFixed(4),
        CLOUD_STRATO_OCTAVES: STRATO_OCTAVES,
        CLOUD_STRATO_STRETCH: STRATO_STRETCH.toFixed(4),
        CLOUD_STRATO_WARP: STRATO_WARP.toFixed(4),
        CLOUD_STRATO_EDGE: STRATO_EDGE.toFixed(4),
        CLOUD_STRATO_GAIN: STRATO_GAIN.toFixed(4),
        CLOUD_STRATO_LACUNARITY: STRATO_LACUNARITY.toFixed(4),
      },
      uniforms: {
        // The sky's own uniform objects: the sun, the air, the globe.
        ...sky.uniforms,
        uCloudShape: new Uniform<Texture | null>(null),
        uCloudDetail: new Uniform<Texture | null>(null),
        uCloudFrameE: new Uniform(this.frameE),
        uCloudFrameN: new Uniform(this.frameN),
        uCloudFrameM: new Uniform(this.frameM),
        uCloudCamera: new Uniform(new Vector3()),
        uCloudInvRadius: new Uniform(0),
        uCloudLayer: new Uniform(new Vector4()),
        uCloudWind: new Uniform(new Vector4(0, 1, 0, 0)),
        uCloudLook: new Uniform(
          new Vector4(CUMULUS_EXTINCTION, PERIOD_DETAIL, 1, 0),
        ),
        uCloudGrids: new Uniform(gridVectors()),
        uCloudGridClocks: new Uniform(gridVectors()),
        uCloudGridShifts: new Uniform(
          Array.from({ length: CUMULUS_GRIDS }, () => new Vector2()),
        ),
        uCloudGridTurns: new Uniform(
          Array.from(
            { length: CUMULUS_GRIDS },
            (_, k) =>
              new Vector2(
                Math.cos(cumulusGridTurn(k)),
                Math.sin(cumulusGridTurn(k)),
              ),
          ),
        ),
        uCloudGridMeans: new Uniform(gridVectors()),
        uCloudGridCount: new Uniform(CUMULUS_GRIDS),
        uCloudStratoMatrices: new Uniform(
          Array.from({ length: STRATO_OCTAVES + 1 }, (_, o) =>
            new Vector4().fromArray(stratoOctave(o - 1).matrix),
          ),
        ),
        uCloudStratoShifts: new Uniform(
          Array.from({ length: STRATO_OCTAVES + 1 }, () => new Vector3()),
        ),
        uCloudStrato: new Uniform(
          new Vector4(
            0,
            statistics.deviation,
            statistics.octaveVariance,
            STRATO_PERIOD,
          ),
        ),
        uCloudMarch: new Uniform(new Vector4(96, 3, 16, 1e-3)),
        uCloudPixels: new Uniform(2),
        uCloudLightSamples: new Uniform(1),
        uCloudDebug: new Uniform(0),
        uCloudAir: new Uniform(1),
        uSoftCover: new Uniform<Texture>(this.cover.target.texture),
        uSoftMap: new Uniform(
          new Vector4(CLOUD_COVER_SIZE * SOFT_TEXEL, 0, 0, SOFT_TEXEL),
        ),
        uSoftLevel: new Uniform(new Vector4(1, 1, 0.01, 2)),
        uSoftLumps: new Uniform(new Vector4(1000, 0, SOFT_CHUNK, 0)),
        uSoftLightSamples: new Uniform(4),
        uSoftFineSteps: new Uniform(SOFT_FINE_STEPS),
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
  }

  /** Draw `settings` from the next frame on. */
  set(settings: CloudVolumeSettings) {
    this.settings = settings;
    const u = this.marchMaterial.uniforms;
    const layer = settings.layer;
    const form = layer ? cloudVolumeFormOf(layer.type) : null;
    // Drawn soft (a spike), whatever the layer's type; else as its type is drawn.
    const soft = !!settings.soft && !!layer && layer.cover > 0;
    this.form = soft ? 'soft' : form && layer && layer.cover > 0 ? form : null;
    // The strato, the cumulus and the soft clouds are a program each: the others' code left out.
    const strato = !soft && form === 'strato';
    if ('CLOUD_STRATO' in this.marchMaterial.defines !== strato) {
      if (strato) this.marchMaterial.defines.CLOUD_STRATO = '';
      else delete this.marchMaterial.defines.CLOUD_STRATO;
      this.marchMaterial.needsUpdate = true;
    }
    if ('CLOUD_SOFT_CLOUDS' in this.marchMaterial.defines !== soft) {
      if (soft) this.marchMaterial.defines.CLOUD_SOFT_CLOUDS = '';
      else delete this.marchMaterial.defines.CLOUD_SOFT_CLOUDS;
      this.marchMaterial.needsUpdate = true;
    }
    // A local weather's middle as the anchor lies now, until it says.
    if (
      settings.local.latitude !== undefined &&
      settings.local.longitude !== undefined
    )
      this.localAnchor = null;
    this.globeVersion = -1;

    const scale = settings.scale;
    const base = layer ? Math.min(layer.base, layer.top) : 0;
    const top = layer ? Math.max(layer.top, base + 1) : 1;
    const cover = layer ? MathUtils.clamp(layer.cover, 0, 1) : 0;
    (u.uCloudLayer.value as Vector4).set(
      base,
      top,
      cover,
      settings.local.radius,
    );
    const look = u.uCloudLook.value as Vector4;
    look.set(
      soft
        ? SOFT_EXTINCTION * settings.density
        : strato
          ? (STRATO_DEPTH * settings.density) / (top - base)
          : CUMULUS_EXTINCTION * settings.density,
      PERIOD_DETAIL * scale,
      scale,
      0,
    );

    // The cumulus's grids: their cells, sizes and share held, and far off their mean.
    const { grids } = cumulusGrids({ base, top, cover }, scale);
    this.grids = grids;
    grids.forEach((grid, k) => {
      (u.uCloudGrids.value[k] as Vector4).set(
        grid.cell,
        grid.least,
        grid.most,
        grid.occupancy,
      );
      (u.uCloudGridMeans.value[k] as Vector4).set(
        grid.cover,
        grid.meanRadius,
        grid.meanHeight,
        0,
      );
    });
    // The strato field: the level it must pass for the cover.
    const strato4 = u.uCloudStrato.value as Vector4;
    strato4.x = stratoThreshold(cover);
    strato4.w = STRATO_PERIOD * scale;

    const quality = settings.quality;
    (u.uCloudMarch.value as Vector4).set(
      Math.max(Math.round(quality.iterations), 1),
      Math.max(quality.samples, 0.5),
      Math.max(
        Math.round(soft ? quality.softSamples : quality.stratoSamples),
        1,
      ),
      (u.uCloudMarch.value as Vector4).w,
    );
    u.uSoftLightSamples.value = Math.max(
      Math.round(quality.softLightSamples),
      1,
    );
    // The soft clouds' map's period and lumps' tile, by their scale.
    const period = CLOUD_COVER_SIZE * SOFT_TEXEL * scale;
    (u.uSoftMap.value as Vector4).x = period;
    (u.uSoftMap.value as Vector4).w = period / CLOUD_COVER_SIZE;
    const lumps = u.uSoftLumps.value as Vector4;
    lumps.x = period / SOFT_LUMP_TILES;
    lumps.z = SOFT_CHUNK * scale;
    u.uCloudPixels.value = Math.max(quality.pixels, 0.25);
    u.uCloudLightSamples.value = Math.max(Math.round(quality.lightSamples), 1);
    u.uCloudDebug.value =
      settings.debug.view === 'cost'
        ? 1
        : settings.debug.view === 'unlit'
          ? 2
          : 0;
    u.uCloudAir.value = settings.debug.air === false ? 0 : 1;
    (u.uCloudColor.value as Color).copy(settings.color);
  }

  /** Whether there is anything to draw: a layer of a form drawn, with cover. */
  get cloudy(): boolean {
    return this.form !== null;
  }

  // The frame fixed on the Earth (world -> Earth), and the scene's true east and north in it.
  private updateEarth(globe: Globe) {
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

  // Where `camera` lies on the field's frame (64-bit, then the shader's single precision), the
  // layer's wind on the field, and where the patterns have drifted and the clouds' clocks
  // stand at `time`; and the angle a pixel of the image `height` texels high spans.
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

    // The layer's wind at its level, at the scene's latitude: the way it blows toward on the
    // field (east, north), and how far it has carried the patterns.
    const layer = settings.layer;
    const latitude = globe.location?.latitude ?? 45;
    const wind = layer ? cloudLayerWind(layer, settings.wind, latitude) : null;
    const toward =
      (((wind?.from ?? settings.wind?.from ?? 0) + 180) * Math.PI) / 180;
    const speed = wind?.speed ?? 0;
    this.wind.set(Math.sin(toward), Math.cos(toward), speed);
    (u.uCloudWind.value as Vector4).set(this.wind.x, this.wind.y, speed, 0);
    const time = this.time;
    const driftE = this.wind.x * speed * time;
    const driftN = this.wind.y * speed * time;
    // The soft clouds' map, carried by the wind, wrapped to its period (the lumps' tile repeats
    // within it, so they wrap with it).
    const map = u.uSoftMap.value as Vector4;
    map.y = wrap(driftE, map.x);
    map.z = wrap(driftN, map.x);

    // Each grid's drift, wrapped to its cells' period, and its clock.
    this.grids.forEach((grid, k) => {
      const period = grid.cell * CUMULUS_WRAP;
      (u.uCloudGridShifts.value[k] as Vector2).set(
        wrap(driftE, period),
        wrap(driftN, period),
      );
      const { epoch, share } = cumulusEpoch(grid, time);
      (u.uCloudGridClocks.value[k] as Vector4).set(
        epoch,
        share,
        cumulusGridSeed(settings.seed, k),
        grid.lifetime,
      );
    });

    // The strato field's octaves, drifted along and across the wind and changing.
    const period = STRATO_PERIOD * settings.scale;
    const along =
      (driftE * this.wind.x + driftN * this.wind.y) / (period * STRATO_STRETCH);
    const across = (-driftE * this.wind.y + driftN * this.wind.x) / period;
    (u.uCloudStratoShifts.value as Vector3[]).forEach((shift, o) =>
      shift.fromArray(
        stratoOctaveShift(o - 1, along, across, time + settings.seed * 7919),
      ),
    );

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

  // The soft clouds' cover map drawn (`soft`), and the levels of it their layer's cover and
  // profile pick, from its distribution: false until that is read back.
  private updateSoft(renderer: WebGLRenderer): boolean {
    const settings = this.settings!;
    const soft = settings.soft!;
    if (!this.cover.update(renderer, settings.seed, soft.masses)) return false;
    const stats = this.cover.statistics!;
    const u = this.marchMaterial.uniforms;
    const cover = MathUtils.clamp(settings.layer?.cover ?? 0, 0, 1);
    // At its base the layer's share under cloud passes; at its top, the strongest columns of
    // it: more of them the more it towers.
    const base = softCoverLevel(stats, cover);
    const top = softCoverLevel(stats, cover * (0.02 + 0.3 * soft.towering));
    (u.uSoftLevel.value as Vector4).set(
      base,
      Math.max(top, base + 1e-4),
      Math.max(soft.softness * stats.deviation, 1e-4),
      SOFT_DOME,
    );
    (u.uSoftLumps.value as Vector4).y = soft.lumps * stats.deviation;
    return true;
  }

  /**
   * March the clouds as `camera` sees them into their image, for the composite to lay over the
   * scene. From the composite's `onBeforeRender`: within the scene's own render.
   */
  render(renderer: WebGLRenderer, camera: Camera) {
    const settings = this.settings;
    if (!settings || !this.form) return;
    this.generate(renderer);
    const outer = renderer.getRenderTarget();
    const cubeFace = renderer.getActiveCubeFace();
    const mipLevel = renderer.getActiveMipmapLevel();
    if (outer) size.set(outer.width, outer.height);
    else renderer.getDrawingBufferSize(size);

    this.sky.syncCamera(camera);
    const share = MathUtils.clamp(settings.quality.resolution, 0.25, 1);
    const width = Math.max(Math.round(size.x * share), 1);
    const height = Math.max(Math.round(size.y * share), 1);
    if (this.target.width !== width || this.target.height !== height)
      this.target.setSize(width, height);
    this.updateCamera(camera, height);
    if (this.form === 'soft' && !this.updateSoft(renderer)) return;

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

    (this.compositeMaterial.uniforms.uCloudImageSize.value as Vector2).set(
      width,
      height,
    );
  }

  /** Dispose of its image and its share of the noise; its materials are the owner's to release. */
  dispose() {
    this.target.dispose();
    this.march.geometry.dispose();
    this.cover.dispose();
    if (this.volumes) releaseCloudNoiseVolumes(this.volumes.renderer);
    this.volumes = null;
  }
}

const wrap = (x: number, period: number) => x - Math.floor(x / period) * period;
