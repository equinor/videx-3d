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
import { type Atmosphere } from '../../sdk/weather/atmosphere';
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
import {
  CLOUD_ATMOSPHERE_CONDENSATE,
  CLOUD_ATMOSPHERE_HALF,
  CLOUD_ATMOSPHERE_SIZE,
  CloudAtmosphereVolume,
} from './scenery-cloud-atmosphere';
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
  },
  medium: {
    resolution: 0.5,
    iterations: 128,
    samples: 4,
    lightSamples: 2,
    stratoSamples: 24,
    pixels: 2,
  },
  high: {
    resolution: 0.75,
    iterations: 160,
    samples: 6,
    lightSamples: 2,
    stratoSamples: 32,
    pixels: 1.5,
  },
  ultra: {
    resolution: 1,
    iterations: 224,
    samples: 8,
    lightSamples: 3,
    stratoSamples: 48,
    pixels: 1,
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
// The reference's march (debug: SceneryCloudVolumeDebug.reference): the shortest step (metres)
// and the step's growth with distance.
const REFERENCE_STEP = 10;
const REFERENCE_GROWTH = 0.0015;
// The extinction of cloud per g/kg of condensate (1/m): some 150 / m per kg/m³ of liquid water
// (droplets some 10 µm across), in air of some 1 kg/m³.
const EXTINCTION_PER_CONDENSATE = 0.15;
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
   * the atmosphere the clouds come out of (sdk/weather/atmosphere.ts), drawn instead of the
   * layer as the reference (debug) draws it; null for none
   */
  atmosphere: Atmosphere | null;
  debug: SceneryCloudVolumeDebug;
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
const lightWay = new Vector3();
const east = new Vector3();
const fromCentre = new Vector3();
const toWorld = new Matrix3();
const localOffset: [number, number] = [0, 0];

const gridVectors = () =>
  Array.from({ length: CUMULUS_GRIDS }, () => new Vector4());

/**
 * The 3D clouds of a `SceneryCloudVolume` (see `documents/clouds.md`): one layer of a local
 * weather, cumulus or strato, marched along each pixel's view at a share of the screen's
 * resolution every frame, and laid over the scene at the depth of their front. Drawn from its
 * {@link composite}'s `onBeforeRender`, with the camera drawing it.
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
  // The atmosphere's clouds baked into a density volume (the reference's: debug).
  private readonly atmosphere = new CloudAtmosphereVolume();
  // The clock's time they count from (s): 0, or the first seen where that is far from it (an
  // epoch's seconds), so their drift keeps its precision in the shaders.
  private origin: number | null = null;
  private settings: CloudVolumeSettings | null = null;
  private form: ReturnType<typeof cloudVolumeFormOf> = null;
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
          Array.from({ length: CUMULUS_GRIDS }, (_, k) =>
            new Vector2(Math.cos(cumulusGridTurn(k)), Math.sin(cumulusGridTurn(k))),
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
        uCloudAtmosphere: new Uniform<Texture>(this.atmosphere.from.density),
        uCloudAtmosphereNext: new Uniform<Texture>(this.atmosphere.to.density),
        uCloudBlend: new Uniform(0),
        uCloudDomain: new Uniform(
          new Vector4(
            CLOUD_ATMOSPHERE_HALF,
            0,
            1,
            (2 * CLOUD_ATMOSPHERE_HALF) / CLOUD_ATMOSPHERE_SIZE[0],
          ),
        ),
        uCloudExtent: new Uniform(this.atmosphere.extent),
        uCloudDrift: new Uniform(new Vector4()),
        uCloudDriftNext: new Uniform(new Vector4()),
        uCloudLight: new Uniform<Texture>(this.atmosphere.from.light),
        uCloudLightNext: new Uniform<Texture>(this.atmosphere.to.light),
        uCloudLightBake: new Uniform(new Vector2(100, 10)),
        uCloudRefMarch: new Uniform(
          new Vector4(REFERENCE_STEP, REFERENCE_GROWTH, 16, 8),
        ),
        uCloudRefSteps: new Uniform(1500),
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
    const atmosphere = settings.atmosphere;
    this.form = atmosphere ? 'cumulus' : form && layer && layer.cover > 0 ? form : null;
    // The strato and the cumulus are two programs: the other's code left out; and the
    // atmosphere's reference (debug) a third.
    const strato = !atmosphere && form === 'strato';
    if ('CLOUD_STRATO' in this.marchMaterial.defines !== strato) {
      if (strato) this.marchMaterial.defines.CLOUD_STRATO = '';
      else delete this.marchMaterial.defines.CLOUD_STRATO;
      this.marchMaterial.needsUpdate = true;
    }
    const referenced = !!atmosphere;
    if ('CLOUD_REFERENCE' in this.marchMaterial.defines !== referenced) {
      if (referenced) this.marchMaterial.defines.CLOUD_REFERENCE = '';
      else delete this.marchMaterial.defines.CLOUD_REFERENCE;
      this.marchMaterial.needsUpdate = true;
    }
    // Its light from the light volume, or marched in full: a program each, so neither carries
    // the other's code (and registers).
    const marched = referenced && settings.debug.reference?.bakedLight === false;
    if ('CLOUD_REF_MARCHED_LIGHT' in this.marchMaterial.defines !== marched) {
      if (marched) this.marchMaterial.defines.CLOUD_REF_MARCHED_LIGHT = '';
      else delete this.marchMaterial.defines.CLOUD_REF_MARCHED_LIGHT;
      this.marchMaterial.needsUpdate = true;
    }
    // Blended between the bakes the clock lies between, or stepped from one to the next.
    const stepped = referenced && settings.debug.reference?.blend === false;
    if ('CLOUD_REF_STEPPED' in this.marchMaterial.defines !== stepped) {
      if (stepped) this.marchMaterial.defines.CLOUD_REF_STEPPED = '';
      else delete this.marchMaterial.defines.CLOUD_REF_STEPPED;
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
      strato
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
      Math.max(Math.round(quality.stratoSamples), 1),
      (u.uCloudMarch.value as Vector4).w,
    );
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

    // The atmosphere's clouds, baked at the next render; and the reference's march.
    if (atmosphere) {
      this.atmosphere.set(atmosphere, settings.seed, settings.wind);
      (u.uCloudDomain.value as Vector4).y = this.atmosphere.mixedTop;
      (u.uCloudDomain.value as Vector4).z =
        CLOUD_ATMOSPHERE_CONDENSATE * EXTINCTION_PER_CONDENSATE * settings.density;
      const reference: NonNullable<SceneryCloudVolumeDebug['reference']> =
        settings.debug.reference ?? {};
      (u.uCloudRefMarch.value as Vector4).set(
        REFERENCE_STEP,
        REFERENCE_GROWTH,
        Math.max(Math.round(reference.lightSamples ?? 16), 1),
        Math.max(Math.round(reference.skySamples ?? 8), 1),
      );
      u.uCloudRefSteps.value = Math.max(Math.round(reference.steps ?? 1500), 1);
    }
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

  // The atmosphere's clouds at the clock's time and their light from the light's way now (the
  // sun's, or the moon's once the sun's light is gone, as cloudLightWay picks at the weather's
  // middle): baked as CloudAtmosphereVolume.update says; between bakes, the march carries the
  // volume on with the wind at each height. After updateCamera: on the field's frame as it is.
  private updateAtmosphere(renderer: WebGLRenderer) {
    const u = this.marchMaterial.uniforms;
    const volume = this.atmosphere;
    this.origin ??= Math.abs(this.time) < 1e7 ? 0 : this.time;
    const now = this.time - this.origin;
    const sun = u.uSkySunDirection.value as Vector3;
    const light =
      this.frameM.dot(sun) > -0.105 ? sun : (u.uSkyMoonDirection.value as Vector3);
    lightWay
      .set(light.dot(this.frameE), light.dot(this.frameN), light.dot(this.frameM))
      .normalize();
    volume.update(renderer, this.noise(renderer).shape.texture, now, this.rate, lightWay);
    // Blended: the clouds the clock has passed and those it is coming to, each carried on by the
    // wind from its own time. Stepped (debug): the last it has reached, alone.
    const from = volume.from;
    const to = volume.to;
    const blend = volume.blend(now);
    const shown = 'CLOUD_REF_STEPPED' in this.marchMaterial.defines && blend >= 1 ? to : from;
    u.uCloudAtmosphere.value = shown.density;
    u.uCloudLight.value = shown.light;
    u.uCloudAtmosphereNext.value = to.density;
    u.uCloudLightNext.value = to.light;
    u.uCloudBlend.value = blend;
    (u.uCloudLightBake.value as Vector2).copy(volume.lightTexel);
    const wind = volume.wind;
    (u.uCloudDrift.value as Vector4).set(
      wind.x * (now - shown.time),
      wind.y * (now - shown.time),
      wind.z,
      wind.w,
    );
    (u.uCloudDriftNext.value as Vector4).set(
      wind.x * (now - to.time),
      wind.y * (now - to.time),
      wind.z,
      wind.w,
    );
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
    if (settings.atmosphere) this.updateAtmosphere(renderer);

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
    this.atmosphere.dispose();
    if (this.volumes) releaseCloudNoiseVolumes(this.volumes.renderer);
    this.volumes = null;
  }
}

const wrap = (x: number, period: number) => x - Math.floor(x / period) * period;
