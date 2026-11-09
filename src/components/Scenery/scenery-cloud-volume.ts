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
  SOFT_COVER_QUANTILES,
  softCoverLevel,
} from '../../sdk/weather/soft-clouds';
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
  SceneryCloudLook,
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
  /** stretches along each run of a view through a dense level (thin levels take fewer) */
  steps: number;
  /** stretches toward the light from each point lit: its skin, then the rest */
  lightSamples: number;
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
  low: { resolution: 0.35, steps: 24, lightSamples: 2 },
  medium: { resolution: 0.5, steps: 32, lightSamples: 2 },
  high: { resolution: 0.75, steps: 48, lightSamples: 3 },
  ultra: { resolution: 1, steps: 64, lightSamples: 4 },
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
 * How a `SceneryCloudVolume` draws a {@link CloudType}: each of {@link SceneryCloudLook}'s.
 *
 * @group Components
 */
export type CloudVolumeLook = Required<SceneryCloudLook>;

/**
 * How a `SceneryCloudVolume` draws each {@link CloudType} unless told (`looks`): heaped
 * cumulus, lumpy stratocumulus decks, flat stratus sheets, deep soft nimbostratus, small
 * altocumulus puffs in patches, thin altostratus veils, and ice — cirrus streaks drawn out
 * along the wind, cirrostratus milky veils.
 *
 * @group Components
 */
export const CLOUD_VOLUME_LOOKS: Readonly<Record<CloudType, CloudVolumeLook>> =
  {
    cumulus: {
      scale: 1,
      stretch: 1,
      softness: 0.05,
      lumps: 0.3,
      towering: 0.4,
      masses: 0.6,
      extinction: 0.03,
    },
    stratocumulus: {
      scale: 1.2,
      stretch: 1.3,
      softness: 0.08,
      lumps: 0.3,
      towering: 0.2,
      masses: 0.4,
      extinction: 0.03,
    },
    stratus: {
      scale: 2,
      stretch: 1.5,
      softness: 0.15,
      lumps: 0.15,
      towering: 0.05,
      masses: 0.1,
      extinction: 0.02,
    },
    nimbostratus: {
      scale: 3,
      stretch: 1.5,
      softness: 0.2,
      lumps: 0.2,
      towering: 0.3,
      masses: 0.2,
      extinction: 0.03,
    },
    altocumulus: {
      scale: 0.4,
      stretch: 1.5,
      softness: 0.08,
      lumps: 0.25,
      towering: 0.2,
      masses: 0.8,
      extinction: 0.02,
    },
    altostratus: {
      scale: 2,
      stretch: 2,
      softness: 0.3,
      lumps: 0.1,
      towering: 0.05,
      masses: 0.1,
      extinction: 0.004,
    },
    cirrus: {
      scale: 1,
      stretch: 6,
      softness: 0.3,
      lumps: 0.1,
      towering: 0.1,
      masses: 0.3,
      extinction: 0.002,
    },
    cirrostratus: {
      scale: 3,
      stretch: 2,
      softness: 0.5,
      lumps: 0.05,
      towering: 0.02,
      masses: 0,
      extinction: 0.0015,
    },
  };

/**
 * The most cloud levels a `SceneryCloudVolume` draws: one at each `CloudLevel`.
 *
 * @group Components
 */
export const CLOUD_VOLUME_LEVELS = 3;

// A local weather's clouds give way, breaking up, over this outer share of its radius, and a
// broad noise pushes its edge in and out by this share of it, so it is no circle
// (cloud-volume-march.glsl, cloudLocalEdge): over the outer fifth of a circle it showed from
// high up as a disc.
const LOCAL_FADE = 0.5;
const LOCAL_WOBBLE = 0.2;
// The image's depth: log2 of the distance over this many doublings (cloud-volume-composite.glsl).
const DEPTH_RANGE = '32.0';
// The cover map's texel (metres, at scale 1 and a look's scale 1: its tile CLOUD_COVER_SIZE of
// them), and the size of a cloud (metres, likewise: how a stretch of cloud and sky mixed hides
// what lies behind). The lumps are the shape volume tiled this many times over the map's tile.
const COVER_TEXEL = 100;
const CHUNK = 1500;
const LUMP_TILES = 100;
// The lumps' second tiling (cloud-volume-march.glsl): turned (cosine, sine) and broader.
const LUMP_TURN = [0.8, 0.6] as const;
const LUMP_BROADER = 1.618;
// By a level's top, the cover a column needs is past the most any reaches by this many of the
// lumps' and the edge's widths: no cloud reaches the top (cloud-volume-march.glsl, cloudShare).
const ROUND_REACH = 3;
// The most short steps through each part of a step holding cloud (cloud-volume-march.glsl,
// cloudFine): a part up to 16 mean free paths long is walked in steps of 1, a longer one in
// longer steps.
const FINE_STEPS = 16;
// A level as optically deep straight through as this, or deeper, takes the quality's steps; a
// thinner one, fewer (down to a quarter).
const DEEP = 8;
// The most the composite draws the clouds nearer than their depth, to take in the spread of a
// texel's depth over a slanting layer: 2 % of the distance, in the image's depth units.
const DEPTH_MARGIN = (Math.log2(1 / 0.98) / Number(DEPTH_RANGE)).toFixed(7);

/** A level a {@link CloudVolumeRenderer} draws: its layer, and how its type is drawn. */
export type CloudVolumeLevel = {
  layer: CloudLayer;
  look: CloudVolumeLook;
};

/** What a {@link CloudVolumeRenderer} draws, resolved. */
export type CloudVolumeSettings = {
  /** the levels drawn, from the ground up (at most {@link CLOUD_VOLUME_LEVELS}); none for none */
  levels: CloudVolumeLevel[];
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
  /** how much they spend for how they look (cloudVolumeQuality) */
  quality: CloudVolumeQualityLevel;
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
const east = new Vector3();
const fromCentre = new Vector3();
const toWorld = new Matrix3();
const localOffset: [number, number] = [0, 0];

const levelVectors = () =>
  Array.from({ length: CLOUD_VOLUME_LEVELS }, () => new Vector4());

/**
 * The 3D clouds of a `SceneryCloudVolume` (see `documents/clouds.md`): up to three levels of a
 * local weather, each rounded masses from a map of the cover fixed to the Earth drawn as its
 * type's look says, marched along each pixel's view at a share of the screen's resolution every
 * frame, and laid over the scene at the depth of their front. Drawn from its {@link composite}'s
 * `onBeforeRender`, with the camera drawing it.
 */
export class CloudVolumeRenderer {
  /** drawn in the scene, last (`LAYERS.OVERLAY` in an `OITRenderPass`) */
  readonly composite: Mesh;
  /** the march, drawn into the clouds' own image as the composite is drawn */
  readonly march: Mesh;
  readonly marchMaterial: ShaderMaterial;
  readonly compositeMaterial: ShaderMaterial;
  /**
   * The weather's time (seconds) the clouds are drawn at: they drift with each level's wind.
   * Set each frame (`SceneryCloudVolume`: its `Weather`'s clock).
   */
  time = 0;
  /** How fast the weather's clock runs (its seconds a second; 0 stood). Set each frame with {@link time}. */
  rate = 1;
  private readonly sky: SceneryMaterial;
  private readonly marchScene = new Scene();
  private readonly target = createImage();
  // The cover map the levels read, drawn once they are.
  private readonly cover = new CloudCoverMap();
  private settings: CloudVolumeSettings | null = null;
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
  // The field's axes in the world: east, north and up at the weather's middle.
  private readonly frameE = new Vector3(1, 0, 0);
  private readonly frameN = new Vector3(0, 0, -1);
  private readonly frameM = new Vector3(0, 1, 0);

  constructor(sky: SceneryMaterial, renderOrder: number) {
    this.sky = sky;
    const geometry = createSceneryGeometry();

    this.marchMaterial = new ShaderMaterial({
      name: 'scenery-cloud-volume-march',
      vertexShader,
      fragmentShader: marchShader,
      defines: {
        CLOUD_DEPTH_RANGE: DEPTH_RANGE,
        CLOUD_LEVELS_MOST: CLOUD_VOLUME_LEVELS,
        CLOUD_COVER_SIZE: CLOUD_COVER_SIZE.toFixed(1),
        CLOUD_LUMP_TILES: LUMP_TILES.toFixed(1),
      },
      uniforms: {
        // The sky's own uniform objects: the sun, the air, the globe.
        ...sky.uniforms,
        uCloudShape: new Uniform<Texture | null>(null),
        uCloudCover: new Uniform<Texture>(this.cover.target.texture),
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
        uCloudMaps: new Uniform(levelVectors()),
        uCloudShifts: new Uniform(levelVectors()),
        uCloudMarch: new Uniform(new Vector4(32, 0, 0, 1e-3)),
        uCloudLightSamples: new Uniform(2),
        uCloudFineSteps: new Uniform(FINE_STEPS),
        uCloudRunsMost: new Uniform(0),
        uCloudDebug: new Uniform(0),
        uCloudAir: new Uniform(1),
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
    // A local weather's middle as the anchor lies now, until it says.
    if (
      settings.local.latitude !== undefined &&
      settings.local.longitude !== undefined
    )
      this.localAnchor = null;
    this.globeVersion = -1;

    const scale = settings.scale;
    const quality = settings.quality;
    const levels = settings.levels.slice(0, CLOUD_VOLUME_LEVELS);
    u.uCloudLevelCount.value = levels.length;
    u.uCloudRunsMost.value = 2 * levels.length;
    u.uCloudLocalRadius.value = settings.local.radius;
    u.uCloudScale.value = scale;
    // Each level's shell, above the one under it, and its look: a thin level takes fewer steps.
    let under = -Infinity;
    levels.forEach(({ layer, look }, k) => {
      const base = Math.max(Math.min(layer.base, layer.top), under);
      const top = Math.max(layer.top, base + 1);
      under = top;
      const extinction = look.extinction * settings.density;
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
        COVER_TEXEL * reach,
      );
    });
    (u.uCloudMarch.value as Vector4).set(
      Math.max(Math.round(quality.steps), 1),
      0,
      0,
      (u.uCloudMarch.value as Vector4).w,
    );
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

  /** Whether there is anything to draw: a level with cover. */
  get cloudy(): boolean {
    return (this.settings?.levels.length ?? 0) > 0;
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
    settings.levels
      .slice(0, CLOUD_VOLUME_LEVELS)
      .forEach(({ layer, look }, k) => {
        const wind = cloudLayerWind(layer, settings.wind, latitude);
        const toward = (((wind?.from ?? 0) + 180) * Math.PI) / 180;
        const speed = wind?.speed ?? 0;
        const ae = Math.sin(toward);
        const an = Math.cos(toward);
        const period =
          CLOUD_COVER_SIZE * COVER_TEXEL * settings.scale * look.scale;
        const along = 1 / (period * Math.max(look.stretch, 1e-3));
        const across = 1 / period;
        // Rows: along the wind, across it. Column-major for the shader's mat2.
        const m = [ae * along, -an * across, an * along, ae * across];
        (u.uCloudMaps.value[k] as Vector4).fromArray(m);
        const de = ae * speed * time;
        const dn = an * speed * time;
        // Each level its own place in the tile.
        const x = m[0] * de + m[2] * dn + 0.37 * k;
        const y = m[1] * de + m[3] * dn + 0.61 * k;
        const s = LUMP_TILES / LUMP_BROADER;
        (u.uCloudShifts.value[k] as Vector4).set(
          fract(x),
          fract(y),
          fract((LUMP_TURN[0] * x - LUMP_TURN[1] * y) * s + 0.37),
          fract((LUMP_TURN[1] * x + LUMP_TURN[0] * y) * s + 0.71),
        );
      });

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
      this.marchMaterial.uniforms.uCloudShape.value = noise.shape.texture;
    }
    return this.volumes.noise;
  }

  /** Draw the noise volumes `renderer` draws it with, unless done already. */
  generate(renderer: WebGLRenderer) {
    generateCloudNoiseVolumes(renderer, this.noise(renderer));
  }

  // The cover map drawn, and the cover each level's columns need, from its distribution (with
  // the level's masses weighed against the patches): false until that is read back.
  private updateLevels(renderer: WebGLRenderer): boolean {
    const settings = this.settings!;
    if (!this.cover.update(renderer, settings.seed)) return false;
    const u = this.marchMaterial.uniforms;
    settings.levels
      .slice(0, CLOUD_VOLUME_LEVELS)
      .forEach(({ layer, look }, k) => {
        const stats = this.cover.statistics(look.masses)!;
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
   * scene. From the composite's `onBeforeRender`: within the scene's own render.
   */
  render(renderer: WebGLRenderer, camera: Camera) {
    const settings = this.settings;
    if (!settings || settings.levels.length === 0) return;
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
    if (!this.updateLevels(renderer)) return;

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

const fract = (x: number) => x - Math.floor(x);
