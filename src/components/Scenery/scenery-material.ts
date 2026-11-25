import {
  BufferGeometry,
  Camera,
  Color,
  ColorRepresentation,
  CubeTexture,
  DataTexture,
  DoubleSide,
  Float32BufferAttribute,
  FloatType,
  MathUtils,
  Matrix3,
  Matrix4,
  NearestFilter,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  ShaderMaterialParameters,
  Texture,
  Uniform,
  UniformsLib,
  UniformsUtils,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderer,
} from 'three';
import { colorRampTexture } from '../../common/color-ramps';
import { shareTexture } from '../../common/shared-textures';
import { GroundMap } from '../../sdk/materials/ground-map';
import { Boundary, boundaryDisc } from '../../sdk/geometries/boundary';
import {
  applySurfaceDetail,
  createSurfaceDetailUniforms,
  SURFACE_DETAIL_DEFINES,
  SurfaceDetail,
  surfaceDetailKey,
  SurfaceDetailUniforms,
} from '../../sdk/materials/surface-detail';
import { Globe } from '../../sdk/projection/globe';
import { WaterCharts } from '../../sdk/projection/water-charts';
import { Vec2, Vec3 } from '../../sdk/types/common';
import {
  type WaterOptics,
  waterColorOf,
  waterExtinctionOf,
  waterOpticsOf,
} from '../../sdk/weather/water-optics';
import {
  compassBasis,
  CompassFrame,
  directionFromCompass,
} from '../../sdk/utils/vector-operations';
import {
  WATER_SHADING_DEFINES,
  WATER_SURFACE_UNIFORMS,
  WaterMaterial,
} from '../Water/water-material';
import fragmentShader from './shaders/sky-fragment.glsl';
import vertexShader from './shaders/scenery-vertex.glsl';
import { SkyAirColors } from './scenery-air-colors';
import {
  SCENERY_EARTH_RADIUS,
  SCENERY_HOLLOW_RIM,
  SCENERY_HOLLOW_RIM_WEIGHT,
  skyDaylight,
  sceneryDefaults,
  skyMoonlight,
  skySunColor,
  skyTwilight,
} from './scenery-model';
import type {
  ScenerySkyReflection,
  ScenerySkyShadow,
} from './scenery-registry';

// The naked-eye planets (`PLANETS`); scenery.glsl's `uSkyPlanets` has as many.
const SKY_PLANET_COUNT = 5;

// An empty rectangle: nothing is on a stage.
const NO_STAGE = [1, 1, -1, -1] as const;

// The look the background's seabed takes under a relief until it hands its own over
// (seaReliefLooks), in relief-look.glsl's rows: the land flat grey, no contours, and the seabed
// the sea's own colour, plain.
const NO_RELIEF_LOOK = shareTexture(
  (() => {
    const texture = new DataTexture(
      new Float32Array([
        -1, 0, 0, 0, 0.5, 0.5, 0.5, 0, -2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      ]),
      1,
      5,
      RGBAFormat,
      FloatType,
    );
    texture.minFilter = NearestFilter;
    texture.magFilter = NearestFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    return texture;
  })(),
);

/**
 * The defines a material drawing the sky's sea takes over from the {@link SceneryMaterial}:
 * its waves and its water's shading ({@link WATER_SHADING_DEFINES}). In this order wherever a
 * program is made, as a program is keyed on the order of its defines.
 */
export const SCENERY_SEA_DEFINES = [
  'SEA_LAYERS',
  'SEA_DETAIL',
  'SEA_ANISO',
  'WATER_CONTACT_COUNT',
  ...WATER_SHADING_DEFINES,
];

/** The same and the seabed's detail: what a stage's sea compiles with. */
export const SCENERY_SHARED_DEFINES = [
  ...SCENERY_SEA_DEFINES,
  ...SURFACE_DETAIL_DEFINES,
];

/**
 * The clip-space fullscreen triangle a {@link SceneryMaterial} is drawn on. Render it
 * with `frustumCulled = false`.
 */
export function createSceneryGeometry() {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    'position',
    new Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3),
  );
  return geometry;
}

/**
 * The {@link Scenery}'s own material: the uniforms and switches of every layer of its
 * background, and the first of those layers, the sky itself, drawn on
 * {@link createSceneryGeometry}. The other layers share its uniform objects (see
 * `scenery-layers.ts`). The view ray is rebuilt from the camera, so it needs no size or
 * position and also renders into a CubeCamera. Depth test and write are off: draw it first,
 * as three draws `scene.background`.
 *
 * ⚠️ Setters write into the existing uniform values, never replace them — the
 * environment bake shares these uniform objects by reference.
 *
 * The seabed is lit by the scene's lights (`lights: true`), as a `ZoneMaterial` is.
 *
 * @group Materials
 */
export class SceneryMaterial extends ShaderMaterial {
  isSceneryMaterial = true;
  /**
   * The Earth the sky draws: flat over the stage's disc, at the sea's level, curved while
   * {@link globeEnabled}. A `World`'s, given at construction, whose frame, disc and curvature
   * the `World` sets; or, without one, its own, which the sky and its stage set. What else lies
   * on the globe — the relief, a route, an anchored field — takes it from here.
   */
  readonly globe: Globe;
  /**
   * The charts the sea's waves are drawn in on the {@link globe}: the field's wave plane
   * over the field, fixed ones on the Earth far off. Kept in step with the globe and the
   * camera ({@link syncCamera}).
   */
  readonly seaCharts: WaterCharts;
  /**
   * The ground's maps (`GroundMap`): how deep the sea is under its surface where they cover.
   * None until a `Scenery`'s ground draws them (`SceneryGround`); its uniforms are the sky's.
   */
  readonly groundMap = new GroundMap();
  /**
   * The colours the air fades what it hazes into, as the camera drawing sees them: drawn for
   * each place it draws from ({@link prepareDraw}), read by the relief's, the sea's and the
   * clouds' haze. Its owner precompiles its pass and sets it `ready`.
   */
  readonly airColors: SkyAirColors;
  // Whether the globe is the sky's own, which it then sets (curvature): not a World's.
  private readonly ownsGlobe: boolean;
  private bedDetail: SurfaceDetail | undefined;
  private bedDetailKey = '';
  // The disc the sea is flat over (setFlatSea): the globe's.
  private get flatSea(): Vector4 {
    return this.uniforms.uSceneryStageFlat.value;
  }
  private starTextures: { cells: DataTexture; list: DataTexture } | null = null;
  private observing = false;
  private starsLoading = false;
  // Bumped on dispose: what is still loading then (the star catalogue, the moon's map) is
  // dropped when it arrives.
  private generation = 0;
  private moonMap: Texture | null = null;
  private moonLoading = false;
  /**
   * The field's light, as {@link setSun} and the light's setters leave it: the scene's
   * lights and the bakes take it. The sky's own uniforms hold the light where the camera
   * is ({@link setSeenSun}), the same over the field.
   */
  readonly fieldLight = {
    sunColor: new Color(),
    daylight: 1,
    twilight: 0,
    moonlight: 0,
    night: 0,
  };
  // The sun's elevation where the camera is (setSeenSun), null for the field's.
  private seenElevation: number | null = null;
  private seenMoonShine = 1;
  // The stage's reach as set (setSeaStage); the uniform holds it only while the stage
  // can draw what it claims (claimStage).
  private stageReach = 0;
  // How far the hollow's rim wanders (hollowRimWander); the uniform holds its waves.
  private rimWander: number = sceneryDefaults.void.hollow.rimWander;

  /**
   * @param globe the Earth to draw on: a `World`'s, which sets its frame, disc and curvature
   *   ({@link globeEnabled} then follows it). Default a globe of its own.
   */
  constructor(parameters: ShaderMaterialParameters = {}, globe?: Globe) {
    const {
      sun,
      colors,
      void: voidDefaults,
      sea: seaDefaults,
      relief: { seabed: bedDefaults },
    } = sceneryDefaults;
    const seaOptics = waterOpticsOf();
    super({
      vertexShader,
      fragmentShader,
      uniforms: {
        ...UniformsUtils.clone(UniformsLib.lights),
        // `fog: true` makes three write these once a scene has fog (see `useMediumFog`).
        ...UniformsUtils.clone(UniformsLib.fog),
        ...createSurfaceDetailUniforms(),
        uSceneryUp: new Uniform(new Vector3(0, 1, 0)),
        uSceneryNorth: new Uniform(new Vector3(0, 0, -1)),
        uSceneryEast: new Uniform(new Vector3(1, 0, 0)),
        uSkyZenithColor: new Uniform(new Color(colors.zenith)),
        uSkyHorizonColor: new Uniform(new Color(colors.horizon)),
        uSkyGroundColor: new Uniform(new Color(colors.ground)),
        uSkyNadirColor: new Uniform(new Color(colors.nadir)),
        uSkySunDirection: new Uniform(new Vector3()),
        uSkySunColor: new Uniform(new Color()),
        uSkySunSize: new Uniform(MathUtils.degToRad(sun.size)),
        uSkySunGlow: new Uniform(sun.glow),
        uSkySunGlare: new Uniform(new Vector3(sun.glare, sun.rays, 0)),
        uSkyTwilight: new Uniform(new Vector2(sun.twilight, 0)),
        uSkyMoonDirection: new Uniform(new Vector3(0, 1, 0)),
        uSkyMoonColor: new Uniform(new Color()),
        uSkyMoonSize: new Uniform(0),
        uSkyMoonGlow: new Uniform(0),
        uSkyMoonPhase: new Uniform(1),
        uSkyMoonDay: new Uniform(0),
        uSkyMoonMap: new Uniform<Texture | null>(null),
        uSkyMoonMapped: new Uniform(0),
        uSkyNight: new Uniform(0),
        uSkyMoonlight: new Uniform(0),
        uSkyAirLight: new Uniform(new Vector4()),
        uSkyAirSunColor: new Uniform(new Color()),
        uSkyStars: new Uniform(new Vector2()),
        uSkyStarFrame: new Uniform(new Matrix3()),
        uSkyObserved: new Uniform(0),
        uSkyPlanets: new Uniform(
          Array.from(
            { length: SKY_PLANET_COUNT },
            () => new Vector4(0, 0, 1, 99),
          ),
        ),
        uSkyPlanetCount: new Uniform(0),
        uSkyStarCells: new Uniform<DataTexture | null>(null),
        uSkyStarList: new Uniform<DataTexture | null>(null),
        uSkySunRadiance: new Uniform(1),
        uSkySunDisc: new Uniform(1),
        uSkyHorizonBlend: new Uniform(sceneryDefaults.horizonBlend),
        uSkyDaylight: new Uniform(1),
        uSceneryIntensity: new Uniform(sceneryDefaults.intensity),
        uSceneryDebug: new Uniform(0),
        uSceneryVoidLevel: new Uniform(voidDefaults.level),
        uSceneryVoidCeilingColor: new Uniform(
          new Color(voidDefaults.colors.ceiling),
        ),
        uSceneryVoidHorizonColor: new Uniform(
          new Color(voidDefaults.colors.horizon),
        ),
        uSceneryVoidDepthColor: new Uniform(
          new Color(voidDefaults.colors.depth),
        ),
        uSceneryVoidTransition: new Uniform(voidDefaults.transition),
        uSceneryVoidDetail: new Uniform(voidDefaults.detail),
        uSceneryVoidDetailScale: new Uniform(voidDefaults.detailScale),
        uSceneryVoidFalloff: new Uniform(voidDefaults.falloff),
        // 1 while the sky is drawn; 0 with none, its light the void's gradient (sky).
        uScenerySky: new Uniform(1),
        // Toward the subsurface's light raking the lid (setVoidLight).
        uSceneryVoidLight: new Uniform(new Vector3(0, 1, 0)),
        // The hollow under the seabed (hollow.glsl): on, open, its rim's angle, its radius;
        // and how its rim wanders round it.
        uSceneryHollow: new Uniform(
          new Vector4(0, 0, 0, voidDefaults.hollow.radius),
        ),
        uSceneryHollowRim: new Uniform(
          SCENERY_HOLLOW_RIM.map(
            ([k, weight, p]) =>
              new Vector3(
                k,
                (voidDefaults.hollow.rimWander * weight) /
                  SCENERY_HOLLOW_RIM_WEIGHT,
                p,
              ),
          ),
        ),
        // The hollow's look (hollow-look.glsl), set by the Scenery: its rock (a RockTexture),
        // its shape (floor depth, radius, cooling band, light falloff), its colours, and how
        // much its fissures glow and its air darkens. Its walls and floor read them, and so
        // does the void's lid over it.
        uHollowRock: new Uniform<Texture | null>(null),
        uHollowRockSlope: new Uniform(1),
        uHollowCliff: new Uniform<Texture | null>(null),
        uHollowShape: new Uniform(
          new Vector4(
            voidDefaults.hollow.floorDepth,
            voidDefaults.hollow.radius,
            Math.max(40000, 0.35 * voidDefaults.hollow.radius),
            voidDefaults.hollow.lightFalloff,
          ),
        ),
        uHollowWallColor: new Uniform(
          new Color(voidDefaults.hollow.styles.calm.colors.walls),
        ),
        uHollowFloorColor: new Uniform(
          new Color(voidDefaults.hollow.styles.calm.colors.floor),
        ),
        uHollowEmberColor: new Uniform(
          new Color(voidDefaults.hollow.styles.calm.colors.embers),
        ),
        uHollowLidColor: new Uniform(
          new Color(voidDefaults.hollow.styles.calm.colors.lid),
        ),
        // How much its fissures glow, how much its air darkens, 1 for the calm style, and how
        // much of the air is left over it while open.
        uHollowLook: new Uniform(
          new Vector4(
            voidDefaults.hollow.styles.calm.embers,
            voidDefaults.hollow.murk,
            1,
            voidDefaults.hollow.styles.calm.air,
          ),
        ),
        // Where the camera is, set each frame (SceneryHollowParts.setView): x 1 inside the
        // hollow's rim, at any depth; y how shut it is, 1 under the lid, eased; z how much of
        // the air about it has drained into the open hollow; w how far under the floor it is.
        uHollowView: new Uniform(new Vector4()),
        // The embers' pulse: its two waves' phases, and how far it dims (sceneryHollowPulse).
        uHollowPulse: new Uniform(new Vector3()),
        uSkyAir: new Uniform(new Vector3()),
        uSkyHaze: new Uniform(
          new Vector2(sceneryDefaults.air.hazeHeight, sceneryDefaults.air.haze),
        ),
        uSceneryCurvature: new Uniform(
          sceneryDefaults.globe ? 1 / SCENERY_EARTH_RADIUS : 0,
        ),
        uSceneryStageFlat: new Uniform(new Vector4()),
        uScenerySeaLevel: new Uniform(seaDefaults.level),
        uScenerySeaDepth: new Uniform(seaDefaults.depth),
        uScenerySeabedColor: new Uniform(new Color(bedDefaults.color)),
        uScenerySeabedSpecular: new Uniform(new Color(bedDefaults.specular)),
        uScenerySeabedShininess: new Uniform(bedDefaults.shininess),
        uScenerySeabedAmbient: new Uniform(new Vector2(...bedDefaults.ambient)),
        uScenerySeaExtinction: new Uniform(
          new Vector3(...waterExtinctionOf(seaOptics)),
        ),
        uScenerySeaWaterColor: new Uniform(
          new Color().fromArray(waterColorOf(seaOptics)),
        ),
        uScenerySeaBuried: new Uniform(0),
        uScenerySeaTrench: new Uniform(0),
        uScenerySeaStageOpen: new Uniform(0),
        uScenerySeaCutawayAnchor: new Uniform(new Vector3()),
        uScenerySeaCutawayHeading: new Uniform(new Vector3(0, 0, -1)),
        uScenerySeaCutawayShape: new Uniform(new Vector3()),
        uScenerySeaCutawayWaveA: new Uniform(new Vector3()),
        uScenerySeaCutawayWaveB: new Uniform(new Vector3()),
        uScenerySeaCutawayRim: new Uniform(new Vector4(1, 1, 1, 0)),
        uScenerySeaCutawayShadow: new Uniform(new Vector2()),
        uScenerySeaCutawayCuts: new Uniform(new Vector2(1, 1)),
        uScenerySeaCutawayGrip: new Uniform(new Vector2(0, 1)),
        uScenerySeaWater: new Uniform(1),
        uScenerySeabed: new Uniform(1),
        uScenerySeabedOpacity: new Uniform(1),
        uScenerySeaStage: new Uniform(new Vector4(...NO_STAGE)),
        uScenerySeaStageReach: new Uniform(0),
        uScenerySeaReliefReach: new Uniform(0),
        // The relief's looks, for the background's seabed under it (seaReliefBed).
        uReliefLook: new Uniform<Texture>(NO_RELIEF_LOOK),
        uColorRamps: new Uniform(colorRampTexture),
        uScenerySeaClouds: new Uniform<CubeTexture | null>(null),
        uScenerySeaCloudsOn: new Uniform(0),
        // What the sea reflects of them away from where they were baked (setSeaCloudReflection).
        uScenerySeaCloudBase: new Uniform(0),
        uScenerySeaCloudMap: new Uniform<CubeTexture | null>(null),
        uScenerySeaCloudEarth: new Uniform(new Matrix3()),
        uScenerySeaCloudFar: new Uniform(new Vector4(0, 0, 1, 0)),
        // The clouds' shadows (cloud-shadow.glsl, setCloudShadow).
        uSkyCloudShadow: new Uniform<Texture | null>(null),
        uSkyCloudShadowPlace: new Uniform(new Vector4()),
        uSkyCloudShadowEast: new Uniform(new Vector3(1, 0, 0)),
        uSkyCloudShadowNorth: new Uniform(new Vector3(0, 0, -1)),
        uSkyCloudShadowLight: new Uniform(new Vector2(1, 0)),
        // The colours the air fades what it hazes into, by bearing about the camera
        // (SkyAirColors, sky-air-colors.glsl): its lookup, and its bearings' frame.
        uSkyAirColors: new Uniform<Texture | null>(null),
        uSkyAirEast: new Uniform(new Vector3(1, 0, 0)),
        uSkyAirNorth: new Uniform(new Vector3(0, 0, -1)),
        uSceneryStageInverseProjection: new Uniform(new Matrix4()),
        uSceneryStageViewport: new Uniform(new Vector4()),
      },
      side: DoubleSide,
      depthTest: false,
      depthWrite: false,
      // Breaks up the steps of the dark night gradient.
      dithering: true,
      fog: true,
      lights: true,
    });

    this.setSun(sun.azimuth, sun.elevation);
    this.seabedDetail = bedDefaults.detail;
    this.globe = globe ?? new Globe();
    this.ownsGlobe = !globe;
    this.seaCharts = new WaterCharts(this.globe);
    // The globe's own uniform objects, so every material sharing the sky's shares them too;
    // the same for the sea's charts and the ground's maps.
    Object.assign(this.uniforms, this.globe.uniforms, this.seaCharts.uniforms);
    this.groundMap.bind(this.uniforms);
    if (this.ownsGlobe)
      this.globe.enabled = this.uniforms.uSceneryCurvature.value > 0;
    else this.syncCurvature();
    this.globe.level = this.seaLevel;
    // After the globe's uniforms: its frame follows the camera's look.
    this.airColors = new SkyAirColors(this.uniforms, createSceneryGeometry());
    this.uniforms.uSkyAirColors.value = this.airColors.texture;

    if (Object.keys(parameters).length) this.setValues(parameters);
  }

  /**
   * Point the sun at a compass bearing and elevation (degrees), and derive its
   * colour and the daylight level from the elevation. Pass the same `frame` as
   * {@link setFrame}, or the sun and the horizon will disagree.
   */
  setSun(azimuth: number, elevation: number, frame?: CompassFrame) {
    const direction = directionFromCompass(azimuth, elevation, frame);
    this.uniforms.uSkySunDirection.value.fromArray(direction);
    this.sunColor = skySunColor(elevation, this.fieldLight.sunColor);
    this.daylight = skyDaylight(elevation);
    this.twilight = skyTwilight(elevation);
    this.moonlight = skyMoonlight(elevation);
    this.setAirLight(elevation, 0);
  }

  /**
   * The sky's own light, for the sun `elevation` degrees over the level the camera sees the
   * sky by (`Globe.lookUp`): far round the Earth from the field it is not the field's.
   * `null` for the field's, as over the field. `moonShine` scales the moonlight, as for an
   * observer's moon. The scene's lights and the bakes keep the field's ({@link fieldLight}).
   */
  setSeenSun(elevation: number | null, moonShine = 1) {
    if (elevation === this.seenElevation && moonShine === this.seenMoonShine)
      return;
    this.seenElevation = elevation;
    this.seenMoonShine = moonShine;
    const u = this.uniforms;
    const field = this.fieldLight;
    if (elevation === null) {
      u.uSkySunColor.value.copy(field.sunColor);
      u.uSkyDaylight.value = field.daylight;
      u.uSkyTwilight.value.y = field.twilight;
      u.uSkyMoonlight.value = field.moonlight;
      u.uSkyNight.value = field.night;
      return;
    }
    skySunColor(elevation, u.uSkySunColor.value);
    const daylight = skyDaylight(elevation);
    u.uSkyDaylight.value = daylight;
    u.uSkyTwilight.value.y = skyTwilight(elevation);
    u.uSkyMoonlight.value = MathUtils.clamp(
      skyMoonlight(elevation) * moonShine,
      0,
      1,
    );
    // As the sky's own stars show by the field's: by night.
    u.uSkyNight.value = 1 - daylight;
  }

  /**
   * The sky's light seen from the camera's height, where the Earth's curve lowers the horizon
   * by `dip` (radians): for the sun at `elevation` (degrees, over the level the camera sees
   * the sky by; see {@link setSeenSun}) plus that drop, so from high up the air stays lit
   * after the sea's sunset. The sea keeps the sun at `elevation` ({@link setSeenSun}), the
   * scene's light and the bakes the field's ({@link fieldLight}). `moonShine` scales the
   * moonlight, as for an observer's moon.
   */
  setAirLight(elevation: number, dip: number, moonShine = 1) {
    const seen = elevation + MathUtils.radToDeg(dip);
    this.uniforms.uSkyAirLight.value.set(
      skyDaylight(seen),
      skyTwilight(seen),
      skyMoonlight(seen) * moonShine,
      Math.max(dip, 0),
    );
    skySunColor(seen, this.uniforms.uSkyAirSunColor.value);
  }

  /** Set which way is up (the horizon is perpendicular to it) and which way is north. */
  setFrame(frame: CompassFrame) {
    const { up, north, east } = compassBasis(frame);
    this.uniforms.uSceneryUp.value.fromArray(up);
    this.uniforms.uSceneryNorth.value.fromArray(north);
    this.uniforms.uSceneryEast.value.fromArray(east);
    this.globe.setUp(this.uniforms.uSceneryUp.value);
    // The wave plane's X and Z: east and south (scenerySeaPlane).
    this.seaCharts.setPlane(
      this.uniforms.uSceneryEast.value,
      planeZ.copy(this.uniforms.uSceneryNorth.value).negate(),
    );
  }

  /** the world's up direction (normalised); see {@link setFrame} */
  get up(): Vector3 {
    return this.uniforms.uSceneryUp.value;
  }

  /**
   * `point`'s height along {@link up} as it is measured over the field: its altitude over
   * the {@link globe}, from the sea's level. Far off, scene Y is not that height. With the
   * globe off, `point · up`. The shaders' `globeHeight`.
   */
  heightOf(point: Vector3): number {
    return this.globe.altitude(point) + this.globe.level;
  }

  get zenithColor(): Color {
    return this.uniforms.uSkyZenithColor.value;
  }
  set zenithColor(value: ColorRepresentation) {
    this.uniforms.uSkyZenithColor.value.set(value);
  }

  get horizonColor(): Color {
    return this.uniforms.uSkyHorizonColor.value;
  }
  set horizonColor(value: ColorRepresentation) {
    this.uniforms.uSkyHorizonColor.value.set(value);
  }

  get groundColor(): Color {
    return this.uniforms.uSkyGroundColor.value;
  }
  set groundColor(value: ColorRepresentation) {
    this.uniforms.uSkyGroundColor.value.set(value);
  }

  get nadirColor(): Color {
    return this.uniforms.uSkyNadirColor.value;
  }
  set nadirColor(value: ColorRepresentation) {
    this.uniforms.uSkyNadirColor.value.set(value);
  }

  /** world-space direction toward the sun (normalised); see {@link setSun} */
  get sunDirection(): Vector3 {
    return this.uniforms.uSkySunDirection.value;
  }
  set sunDirection(value: Vector3) {
    this.uniforms.uSkySunDirection.value.copy(value).normalize();
  }

  /** the sun's colour at the field ({@link fieldLight}) */
  get sunColor(): Color {
    return this.fieldLight.sunColor;
  }
  set sunColor(value: ColorRepresentation) {
    this.fieldLight.sunColor.set(value);
    if (this.seenElevation === null)
      this.uniforms.uSkySunColor.value.copy(this.fieldLight.sunColor);
  }

  /** angular radius of the sun disc, in degrees */
  get sunSize(): number {
    return MathUtils.radToDeg(this.uniforms.uSkySunSize.value);
  }
  set sunSize(value: number) {
    this.uniforms.uSkySunSize.value = MathUtils.degToRad(Math.max(value, 0));
  }

  get sunGlow(): number {
    return this.uniforms.uSkySunGlow.value;
  }
  set sunGlow(value: number) {
    this.uniforms.uSkySunGlow.value = Math.max(value, 0);
  }

  /** strength of the glow along the horizon at sunrise and sunset (see {@link twilight}) */
  get sunTwilight(): number {
    return this.uniforms.uSkyTwilight.value.x;
  }
  set sunTwilight(value: number) {
    this.uniforms.uSkyTwilight.value.x = Math.max(value, 0);
  }

  /**
   * how much the horizon glows for the sun's elevation at the field, 0 to 1 (`skyTwilight`;
   * {@link fieldLight})
   */
  get twilight(): number {
    return this.fieldLight.twilight;
  }
  set twilight(value: number) {
    this.fieldLight.twilight = MathUtils.clamp(value, 0, 1);
    if (this.seenElevation === null)
      this.uniforms.uSkyTwilight.value.y = this.fieldLight.twilight;
  }

  /**
   * how much the moon lights the clouds for the sun's elevation at the field, 0 to 1
   * (`skyMoonlight`; {@link fieldLight})
   */
  get moonlight(): number {
    return this.fieldLight.moonlight;
  }
  set moonlight(value: number) {
    this.fieldLight.moonlight = MathUtils.clamp(value, 0, 1);
    if (this.seenElevation === null)
      this.uniforms.uSkyMoonlight.value = this.fieldLight.moonlight;
  }

  /** strength of the bright glare hugging the sun disc */
  get sunGlare(): number {
    return this.uniforms.uSkySunGlare.value.x;
  }
  set sunGlare(value: number) {
    this.uniforms.uSkySunGlare.value.x = Math.max(value, 0);
  }

  /** strength of the rays around the sun disc; 0 for none */
  get sunRays(): number {
    return this.uniforms.uSkySunGlare.value.y;
  }
  set sunRays(value: number) {
    this.uniforms.uSkySunGlare.value.y = Math.max(value, 0);
  }

  /** how far the rays' shimmer has got, in radians: advance it with time to animate them */
  get sunRayPhase(): number {
    return this.uniforms.uSkySunGlare.value.z;
  }
  set sunRayPhase(value: number) {
    this.uniforms.uSkySunGlare.value.z = value;
  }

  /** sun disc multiplier: 1 for display output, higher when tone mapped */
  get sunRadiance(): number {
    return this.uniforms.uSkySunRadiance.value;
  }
  set sunRadiance(value: number) {
    this.uniforms.uSkySunRadiance.value = Math.max(value, 0);
  }

  get sunDisc(): boolean {
    return this.uniforms.uSkySunDisc.value > 0;
  }
  set sunDisc(value: boolean) {
    this.uniforms.uSkySunDisc.value = value ? 1 : 0;
  }

  /** world-space direction toward the moon (normalised) */
  get moonDirection(): Vector3 {
    return this.uniforms.uSkyMoonDirection.value;
  }
  set moonDirection(value: Vector3) {
    this.uniforms.uSkyMoonDirection.value.copy(value).normalize();
  }

  get moonColor(): Color {
    return this.uniforms.uSkyMoonColor.value;
  }
  set moonColor(value: ColorRepresentation) {
    this.uniforms.uSkyMoonColor.value.set(value);
  }

  /**
   * angular radius of the moon disc, in degrees. Shown, its map is loaded (its own chunk)
   * and uploaded the first time; until it is in, the disc is plain.
   */
  get moonSize(): number {
    return MathUtils.radToDeg(this.uniforms.uSkyMoonSize.value);
  }
  set moonSize(value: number) {
    this.uniforms.uSkyMoonSize.value = MathUtils.degToRad(Math.max(value, 0));
    if (value > 0) this.loadMoonMap();
  }

  private loadMoonMap() {
    if (this.moonMap || this.moonLoading) return;
    this.moonLoading = true;
    const generation = this.generation;
    import('./sky-moon')
      .then(({ loadSkyMoonTexture }) => loadSkyMoonTexture())
      .then(texture => {
        if (generation !== this.generation) {
          texture?.dispose();
          return;
        }
        if (!texture) return;
        this.moonMap = texture;
        this.uniforms.uSkyMoonMap.value = texture;
        this.uniforms.uSkyMoonMapped.value = 1;
      })
      .catch(error => console.warn('SceneryMaterial: no moon map', error))
      .finally(() => {
        if (generation === this.generation) this.moonLoading = false;
      });
  }

  get moonGlow(): number {
    return this.uniforms.uSkyMoonGlow.value;
  }
  set moonGlow(value: number) {
    this.uniforms.uSkyMoonGlow.value = Math.max(value, 0);
  }

  /** share of the moon's disc lit, 0 (new) to 1 (full): its halo and earthshine follow it */
  get moonPhase(): number {
    return this.uniforms.uSkyMoonPhase.value;
  }
  set moonPhase(value: number) {
    this.uniforms.uSkyMoonPhase.value = MathUtils.clamp(value, 0, 1);
  }

  /** 1 while the moon can be up by day, drawn as a pale disc; 0 hides it until night */
  get moonDay(): number {
    return this.uniforms.uSkyMoonDay.value;
  }
  set moonDay(value: number) {
    this.uniforms.uSkyMoonDay.value = MathUtils.clamp(value, 0, 1);
  }

  /**
   * 0 by day to 1 at night at the field: how much the moon and the stars show; 0 hides them
   * ({@link fieldLight})
   */
  get night(): number {
    return this.fieldLight.night;
  }
  set night(value: number) {
    this.fieldLight.night = MathUtils.clamp(value, 0, 1);
    if (this.seenElevation === null)
      this.uniforms.uSkyNight.value = this.fieldLight.night;
  }

  /** the stars' brightness, and the share of the sky's cells holding one (0 for none) */
  setStars(brightness: number, share: number) {
    this.uniforms.uSkyStars.value.set(
      Math.max(brightness, 0),
      MathUtils.clamp(share, 0, 1),
    );
  }

  /** the frame the stars are fixed in, as rows of world directions (see `skyStarFrame`) */
  setStarFrame([x, y, z]: [Vec3, Vec3, Vec3]) {
    (this.uniforms.uSkyStarFrame.value as Matrix3).set(
      x[0],
      x[1],
      x[2],
      y[0],
      y[1],
      y[2],
      z[0],
      z[1],
      z[2],
    );
  }

  /**
   * The real sky of an observer: the catalogue's stars in the star frame (then
   * `skyCelestialFrame`'s) and the planets, with the procedural stars a faint filler.
   * The catalogue is loaded (its own chunk) and uploaded the first time; until it is
   * in, the procedural stars show.
   */
  get observed(): boolean {
    return this.observing;
  }
  set observed(value: boolean) {
    this.observing = value;
    this.uniforms.uSkyObserved.value = value && this.starTextures ? 1 : 0;
    if (!value || this.starTextures || this.starsLoading) return;
    this.starsLoading = true;
    const generation = this.generation;
    import('./sky-star-catalogue')
      .then(({ createSkyStarTextures }) => {
        if (generation !== this.generation) return;
        this.starTextures = createSkyStarTextures();
        this.uniforms.uSkyStarCells.value = this.starTextures.cells;
        this.uniforms.uSkyStarList.value = this.starTextures.list;
        this.uniforms.uSkyObserved.value = this.observing ? 1 : 0;
      })
      .catch(error => console.warn('SceneryMaterial: no star catalogue', error))
      .finally(() => {
        if (generation === this.generation) this.starsLoading = false;
      });
  }

  /** the planets (`PLANETS` order), by world direction and apparent magnitude */
  setPlanets(planets: { direction: Vec3; magnitude: number }[]) {
    const uniform = this.uniforms.uSkyPlanets.value as Vector4[];
    uniform.forEach((value, i) => {
      const planet = planets[i];
      if (planet) value.set(...planet.direction, planet.magnitude);
      else value.w = 99;
    });
    this.uniforms.uSkyPlanetCount.value = Math.min(
      planets.length,
      SKY_PLANET_COUNT,
    );
  }

  dispose() {
    // What is still loading is dropped when it arrives.
    this.generation++;
    this.starsLoading = false;
    this.moonLoading = false;
    // Only the owner's: a bake's material shares these uniforms.
    if (this.starTextures) {
      this.starTextures.cells.dispose();
      this.starTextures.list.dispose();
      this.starTextures = null;
      this.uniforms.uSkyObserved.value = 0;
      this.uniforms.uSkyStarCells.value = null;
      this.uniforms.uSkyStarList.value = null;
    }
    if (this.moonMap) {
      this.moonMap.dispose();
      this.moonMap = null;
      this.uniforms.uSkyMoonMapped.value = 0;
      this.uniforms.uSkyMoonMap.value = null;
    }
    this.airColors.dispose();
    super.dispose();
  }

  /** width of the horizon -> ground transition, as a sine of the angle below the horizon */
  get horizonBlend(): number {
    return this.uniforms.uSkyHorizonBlend.value;
  }
  set horizonBlend(value: number) {
    this.uniforms.uSkyHorizonBlend.value = Math.max(value, 1e-4);
  }

  /** 0 (night) to 1 (day) at the field; see {@link setSun} and {@link fieldLight} */
  get daylight(): number {
    return this.fieldLight.daylight;
  }
  set daylight(value: number) {
    this.fieldLight.daylight = MathUtils.clamp(value, 0, 1);
    if (this.seenElevation === null)
      this.uniforms.uSkyDaylight.value = this.fieldLight.daylight;
  }

  get intensity(): number {
    return this.uniforms.uSceneryIntensity.value;
  }
  set intensity(value: number) {
    this.uniforms.uSceneryIntensity.value = Math.max(value, 0);
  }

  /** tint what the sky, and a stage drawing its sea, draw by part (see `SceneryDebug.tint`) */
  get debugTint(): boolean {
    return this.uniforms.uSceneryDebug.value > 0;
  }
  set debugTint(value: boolean) {
    this.uniforms.uSceneryDebug.value = value ? 1 : 0;
  }

  /** the void below the level (see {@link SceneryVoidProps}); changing it recompiles the layers that draw it */
  get void(): boolean {
    return this.switches.SCENERY_VOID !== undefined;
  }
  set void(value: boolean) {
    this.setSwitch('SCENERY_VOID', value);
  }

  /**
   * The sky is drawn (the `Scenery`'s `sky`): off, its surface everywhere it is read (the
   * seas' reflections, Snell's window, the bakes) is the void's gradient in its place. A
   * uniform: nothing recompiles.
   */
  get sky(): boolean {
    return this.uniforms.uScenerySky.value > 0.5;
  }
  set sky(value: boolean) {
    this.uniforms.uScenerySky.value = value ? 1 : 0;
  }

  /**
   * What the background's layers, its stages and its relief are compiled with, beyond the
   * sky's own (`defines`, the sky's layer alone): its features and the sea's (its waves, the
   * seabed's detail). Each layer takes only those it needs (see `sceneryLayerDefines`), so a
   * change recompiles only them. Bumps {@link switchesVersion}.
   */
  readonly switches: Record<string, unknown> = {};
  /** bumped whenever {@link switches} change */
  switchesVersion = 0;

  private setSwitch(name: string, on: boolean) {
    this.setSwitchValue(name, on ? '' : undefined);
  }

  // A switch with a value (undefined: off).
  private setSwitchValue(name: string, value: unknown) {
    if (this.switches[name] === value) return;
    if (value === undefined) delete this.switches[name];
    else this.switches[name] = value;
    this.switchesVersion++;
  }

  /**
   * The air: the height of its ground along {@link up}, the height over which its clear air thins
   * by e (0 for none) and the distance over which it hazes the sea at that ground (0 for none);
   * how much of that haze is the low haze layer (0 to 1), and the height it thins by e over.
   */
  setAir(
    level: number,
    scaleHeight: number,
    visibility: number,
    haze: number = sceneryDefaults.air.haze,
    hazeHeight: number = sceneryDefaults.air.hazeHeight,
  ) {
    this.uniforms.uSkyHaze.value.set(
      Math.max(hazeHeight, 0),
      MathUtils.clamp(haze, 0, 1),
    );
    this.uniforms.uSkyAir.value.set(
      level,
      Math.max(scaleHeight, 0),
      Math.max(visibility, 0),
    );
  }

  /**
   * The sea, the sky and the clouds lie on the {@link globe}, so the horizon drops as the
   * camera climbs; off, on a flat plane everywhere. The `Scenery`'s `globe`, or a `World`'s:
   * on a `World`'s globe it follows the globe ({@link syncCamera}), and is not to be set.
   */
  get globeEnabled(): boolean {
    return this.globe.enabled;
  }
  set globeEnabled(value: boolean) {
    this.globe.enabled = value;
    this.syncCurvature();
  }

  // The shaders' curvature, the globe's: 1 over the Earth's radius, 0 for a flat sea.
  private syncCurvature() {
    this.uniforms.uSceneryCurvature.value = this.globe.enabled
      ? 1 / SCENERY_EARTH_RADIUS
      : 0;
  }

  /**
   * Keep the sea flat over the disc that holds `boundary` (world X/Z; see
   * {@link boundaryDisc}): where the scene is, so what meets the water there meets it level.
   * On its own {@link globe} this is the globe's disc too; a `World`'s globe has its disc set
   * by the `World` (its `boundary`), or by the stage where it has none. `null` for none.
   */
  setFlatSea(boundary: Boundary | null) {
    if (!boundary) {
      this.flatSea.set(0, 0, 0, 0);
    } else {
      const { centre, radius } = boundaryDisc(boundary);
      this.flatSea.set(centre[0], 0, centre[1], radius);
    }
    if (this.ownsGlobe) this.globe.setDisc(boundary);
  }

  /** height of the lid along {@link up} */
  get voidLevel(): number {
    return this.uniforms.uSceneryVoidLevel.value;
  }
  set voidLevel(value: number) {
    this.uniforms.uSceneryVoidLevel.value = value;
  }

  get voidCeilingColor(): Color {
    return this.uniforms.uSceneryVoidCeilingColor.value;
  }
  set voidCeilingColor(value: ColorRepresentation) {
    this.uniforms.uSceneryVoidCeilingColor.value.set(value);
  }

  get voidHorizonColor(): Color {
    return this.uniforms.uSceneryVoidHorizonColor.value;
  }
  set voidHorizonColor(value: ColorRepresentation) {
    this.uniforms.uSceneryVoidHorizonColor.value.set(value);
  }

  get voidDepthColor(): Color {
    return this.uniforms.uSceneryVoidDepthColor.value;
  }
  set voidDepthColor(value: ColorRepresentation) {
    this.uniforms.uSceneryVoidDepthColor.value.set(value);
  }

  /** depth below the level over which the void fades in */
  get voidTransition(): number {
    return this.uniforms.uSceneryVoidTransition.value;
  }
  set voidTransition(value: number) {
    this.uniforms.uSceneryVoidTransition.value = Math.max(value, 1e-3);
  }

  /** strength of the noise relief on the lid */
  get voidDetail(): number {
    return this.uniforms.uSceneryVoidDetail.value;
  }
  set voidDetail(value: number) {
    this.uniforms.uSceneryVoidDetail.value = Math.max(value, 0);
  }

  /** size of the noise relief, in world units */
  get voidDetailScale(): number {
    return this.uniforms.uSceneryVoidDetailScale.value;
  }
  set voidDetailScale(value: number) {
    this.uniforms.uSceneryVoidDetailScale.value = Math.max(value, 1e-3);
  }

  /** exponent of the depths' gradient below the horizon */
  get voidFalloff(): number {
    return this.uniforms.uSceneryVoidFalloff.value;
  }
  set voidFalloff(value: number) {
    this.uniforms.uSceneryVoidFalloff.value = Math.max(value, 0.01);
  }

  /**
   * Openings to the void from above that stages make (a `SceneryStage` occupant's cut),
   * each telling whether it is open now.
   */
  readonly voidOpenings = new Set<() => boolean>();

  /**
   * Whether the void can show from above the lid: through a seabed that is off or
   * see-through, a cutaway taking the seabed (`cutaway`), or a stage's opening
   * ({@link voidOpenings}). Sets whether a stage's opening is open now.
   */
  voidOpenFromAbove(cutaway: boolean) {
    const covers = this.sea && this.seabed && this.seabedOpacity >= 1;
    let opening = false;
    for (const open of this.voidOpenings) {
      if (open()) {
        opening = true;
        break;
      }
    }
    this.uniforms.uScenerySeaStageOpen.value = opening ? 1 : 0;
    if (!this.sea) return false;
    return !covers || cutaway || opening;
  }

  /** the light raking the void's lid from below, to show a relief's shape: `direction` toward it */
  setVoidLight(direction: Vector3) {
    this.uniforms.uSceneryVoidLight.value.copy(direction).normalize();
  }

  /**
   * The hollow under the seabed is drawn (`SceneryVoidProps.hollow`): the void confined to a
   * gap in the crust about the field, its lid the hollow's, curved down inside the rim. Set once
   * the hollow can be drawn, its textures baked and the sky's programs compiled: until then the
   * void is the plain void. A uniform: nothing recompiles.
   */
  get hollow(): boolean {
    return this.uniforms.uSceneryHollow.value.x > 0.5;
  }
  set hollow(value: boolean) {
    this.uniforms.uSceneryHollow.value.x = value ? 1 : 0;
  }

  /**
   * The hollow's opening is open: the seabed is peeled, so the relief and the sea's seabed are
   * cut inside its rim, and stay whole around it. Only while {@link hollow}.
   */
  get hollowOpen(): boolean {
    return this.uniforms.uSceneryHollow.value.y > 0.5;
  }
  set hollowOpen(value: boolean) {
    this.uniforms.uSceneryHollow.value.y = value ? 1 : 0;
  }

  /** the hollow's radius along the sea, about the globe's disc centre, in world units */
  get hollowRadius(): number {
    return this.uniforms.uSceneryHollow.value.w;
  }
  set hollowRadius(value: number) {
    this.uniforms.uSceneryHollow.value.w = Math.max(value, 0);
    this.syncHollow();
  }

  /**
   * how far the hollow's rim wanders in and out of its radius, at most, as a share of it
   * (`SceneryHollow.rimWander`; 0 round): its waves' shares (SCENERY_HOLLOW_RIM). A uniform
   */
  get hollowRimWander(): number {
    return this.rimWander;
  }
  set hollowRimWander(value: number) {
    this.rimWander = Math.max(value, 0);
    const waves = this.uniforms.uSceneryHollowRim.value as Vector3[];
    SCENERY_HOLLOW_RIM.forEach(([, weight], i) => {
      waves[i].y = (this.rimWander * weight) / SCENERY_HOLLOW_RIM_WEIGHT;
    });
  }

  // The rim's angle about the globe's centre, as hollow.glsl takes it: the globe's radius may
  // have changed since (a World's frame).
  private syncHollow() {
    const hollow = this.uniforms.uSceneryHollow.value as Vector4;
    hollow.z = Math.min(hollow.w / this.globe.radius, 1.5);
  }

  /** the endless sea (see {@link ScenerySeaProps}); link its water first ({@link linkWater}). Changing it recompiles the layers that draw it */
  get sea(): boolean {
    return this.switches.SCENERY_SEA !== undefined;
  }
  set sea(value: boolean) {
    this.setSwitch('SCENERY_SEA', value);
  }

  /**
   * Draw the sea with an {@link WaterMaterial}'s water. Its uniform objects are shared
   * by reference, so its setters, sea layers and clock drive the sky's sea too; the water
   * bakes its layers each frame (`WaterMaterial.renderWaves`).
   */
  linkWater(water: WaterMaterial) {
    for (const name of WATER_SURFACE_UNIFORMS) {
      this.uniforms[name] = water.uniforms[name];
    }
    const layers = water.seaState.layers.length;
    const contacts = water.contactCount;
    if (
      this.switches.SEA_LAYERS !== layers ||
      this.switches.WATER_CONTACT_COUNT !== contacts
    ) {
      this.switches.SEA_LAYERS = layers;
      this.switches.WATER_CONTACT_COUNT = contacts;
      this.switchesVersion++;
    }
    this.setSwitch('SEA_DETAIL', water.seaState.detail !== null);
    this.setSwitchValue('SEA_ANISO', water.defines.SEA_ANISO);
    // Its shading as the water's: what its quality leaves out, its glitter, its Fresnel and
    // its whitecaps' life (`sparkle`, `fresnelPower`, `foamLife`).
    for (const name of WATER_SHADING_DEFINES)
      this.setSwitch(name, name in water.defines);
  }

  /** height of the sea surface along {@link up} */
  get seaLevel(): number {
    return this.uniforms.uScenerySeaLevel.value;
  }
  set seaLevel(value: number) {
    this.uniforms.uScenerySeaLevel.value = value;
    this.globe.level = value;
  }

  /** depth of the seabed below the surface */
  get seaDepth(): number {
    return this.uniforms.uScenerySeaDepth.value;
  }
  set seaDepth(value: number) {
    this.uniforms.uScenerySeaDepth.value = Math.max(value, 0);
  }

  get seabedColor(): Color {
    return this.uniforms.uScenerySeabedColor.value;
  }
  set seabedColor(value: ColorRepresentation) {
    this.uniforms.uScenerySeabedColor.value.set(value);
  }

  /** the seabed's specular highlight colour */
  get seabedSpecular(): Color {
    return this.uniforms.uScenerySeabedSpecular.value;
  }
  set seabedSpecular(value: ColorRepresentation) {
    this.uniforms.uScenerySeabedSpecular.value.set(value);
  }

  /** the seabed's specular exponent */
  get seabedShininess(): number {
    return this.uniforms.uScenerySeabedShininess.value;
  }
  set seabedShininess(value: number) {
    this.uniforms.uScenerySeabedShininess.value = Math.max(value, 0);
  }

  /** the seabed's ambient multipliers facing up / facing down; `false` leaves the ambient flat */
  get seabedAmbient(): Vector2 {
    return this.uniforms.uScenerySeabedAmbient.value;
  }
  set seabedAmbient(value: Readonly<Vec2> | false) {
    if (value)
      this.uniforms.uScenerySeabedAmbient.value.set(value[0], value[1]);
    else this.uniforms.uScenerySeabedAmbient.value.set(1, 1);
  }

  /** the seabed's procedural relief; `undefined` for none. Changing it recompiles the layers that draw it */
  get seabedDetail(): SurfaceDetail | undefined {
    return this.bedDetail;
  }
  set seabedDetail(value: SurfaceDetail | undefined) {
    const key = surfaceDetailKey(value);
    if (key === this.bedDetailKey) return;
    this.bedDetail = value;
    this.bedDetailKey = key;
    applySurfaceDetail(
      this.uniforms as unknown as SurfaceDetailUniforms,
      this.switches,
      value,
    );
    this.switchesVersion++;
  }

  /**
   * the water's look (`waterOpticsOf`), or `null` where the seabed lies dry: lit as if no water
   * lay over it
   */
  set seaOptics(value: Required<WaterOptics> | null) {
    const extinction = this.uniforms.uScenerySeaExtinction.value as Vector3;
    if (value) {
      extinction.fromArray(waterExtinctionOf(value));
      (this.uniforms.uScenerySeaWaterColor.value as Color).fromArray(
        waterColorOf(value),
      );
    } else extinction.set(0, 0, 0);
  }

  /** how quickly the water tints what is seen through it, per world unit: its mean extinction */
  get seaFogDensity(): number {
    const e = this.uniforms.uScenerySeaExtinction.value as Vector3;
    return (e.x + e.y + e.z) / 3;
  }

  /** the camera is under the ground a stage draws, above the sea's own seabed (see {@link seaGround}) */
  get seaBuried(): boolean {
    return this.uniforms.uScenerySeaBuried.value > 0;
  }
  set seaBuried(value: boolean) {
    this.uniforms.uScenerySeaBuried.value = value ? 1 : 0;
  }

  /**
   * the camera is over the ground a stage draws but below the sea's own seabed, as in a
   * trench of a relief deeper than the sea's `depth` (see {@link seaGround}): the
   * background's view starts just above that seabed, in the water
   */
  get seaTrench(): boolean {
    return this.uniforms.uScenerySeaTrench.value > 0;
  }
  set seaTrench(value: boolean) {
    this.uniforms.uScenerySeaTrench.value = value ? 1 : 0;
  }

  /**
   * The ground's height under the camera where a stage draws its own (`SceneryStage`, its
   * relief drawn from tiles): the seabed, or land above the sea, at whatever depth — deeper
   * than the sea's own seabed in a trench. `null` where the sea's flat seabed is.
   */
  seaGround: number | null = null;

  /** half the width of a stage occupant's outline (`SceneryStage`): the scale a cutaway keeps to (see `SceneryCutawayProps.zoomFollow`) */
  occupantRadius: number | null = null;

  /** the sea has water; without it the seabed lies dry */
  get seaWater(): boolean {
    return this.uniforms.uScenerySeaWater.value > 0;
  }
  set seaWater(value: boolean) {
    this.uniforms.uScenerySeaWater.value = value ? 1 : 0;
  }

  /** the sea has a seabed (the `World`'s `GeoRelief`), not peeled; without it the void lies below the water */
  get seabed(): boolean {
    return this.uniforms.uScenerySeabed.value > 0;
  }
  set seabed(value: boolean) {
    this.uniforms.uScenerySeabed.value = value ? 1 : 0;
  }

  /**
   * How far from the camera the relief draws its ground from tiles (a `GeoRelief`,
   * out to the far plane), 0 without one. From in the water and over a dry sea it
   * draws the seabed there too, which hides what lies below it by depth: there the
   * background's seabed covers nothing for what is drawn under it (`scenerySeaCover`).
   */
  get seaReliefReach(): number {
    return this.uniforms.uScenerySeaReliefReach.value;
  }
  set seaReliefReach(value: number) {
    this.uniforms.uScenerySeaReliefReach.value = Math.max(value, 0);
  }

  /**
   * Whether a relief is the seabed (a `GeoRelief` in the `World`): the background's own then
   * shows only where none of its tiles is drawn yet, or past their edge, so it is drawn plain,
   * in the relief's look ({@link seaReliefLooks}) by the ground's height under it, without
   * the seabed's detail. Changing it recompiles the sea's layers.
   */
  get seaReliefBed(): boolean {
    return this.switches.SCENERY_SEABED_LOOK !== undefined;
  }
  set seaReliefBed(value: boolean) {
    this.setSwitch('SCENERY_SEABED_LOOK', value);
  }

  /**
   * The relief's looks (`SceneryReliefLooks.texture`), which the background's seabed takes
   * under it ({@link seaReliefBed}): its own; null for the sea's seabed colour, plain.
   */
  set seaReliefLooks(value: Texture | null) {
    this.uniforms.uReliefLook.value = value ?? NO_RELIEF_LOOK;
  }

  /**
   * What draws itself in the sky (the 3D clouds) as seen from the scene, a cube map of
   * premultiplied colour and alpha without the sky's intensity: the sea reflects it over the
   * sky. Null for none.
   */
  get seaClouds(): CubeTexture | null {
    return this.uniforms.uScenerySeaClouds.value;
  }
  set seaClouds(value: CubeTexture | null) {
    this.uniforms.uScenerySeaClouds.value = value;
    this.uniforms.uScenerySeaCloudsOn.value = value ? 1 : 0;
  }

  /**
   * What the sea reflects of what draws itself in the sky away from where {@link seaClouds}
   * was baked (`ScenerySkyReflection`): the bake blurred as much as reading it by direction
   * alone blows its clouds up from over the sea, and far off the weather's own cover. Null for
   * neither.
   */
  setSeaCloudReflection(reflection: ScenerySkyReflection | null) {
    const u = this.uniforms;
    const far = u.uScenerySeaCloudFar.value as Vector4;
    if (!reflection) {
      u.uScenerySeaCloudBase.value = 0;
      u.uScenerySeaCloudMap.value = null;
      far.set(0, 0, 1, 0);
      return;
    }
    u.uScenerySeaCloudBase.value = reflection.base;
    u.uScenerySeaCloudMap.value = reflection.map;
    (u.uScenerySeaCloudEarth.value as Matrix3).copy(reflection.earth);
    far.set(
      reflection.map ? reflection.strength : 0,
      reflection.near,
      reflection.far,
      reflection.texels,
    );
  }

  /**
   * The shadows of what draws itself in the sky (the 3D clouds) on the sea and the relief
   * (cloud-shadow.glsl): `shadow`, their map about the camera, or null for none; `dimmed`, the
   * share of the light the scene's light was already dimmed to, which the map's share
   * replaces where they read it, and which stands past the map; and `strength`, how much they
   * apply (0 where the scene's light is not the sky's).
   */
  setCloudShadow(
    shadow: ScenerySkyShadow | null,
    dimmed: number,
    strength: number,
  ) {
    const u = this.uniforms;
    u.uSkyCloudShadow.value = shadow?.texture ?? null;
    const place = u.uSkyCloudShadowPlace.value as Vector4;
    if (shadow) {
      place.set(
        shadow.centre.x,
        shadow.centre.y,
        shadow.centre.z,
        shadow.reach,
      );
      (u.uSkyCloudShadowEast.value as Vector3).copy(shadow.east);
      (u.uSkyCloudShadowNorth.value as Vector3).copy(shadow.north);
    } else place.w = 0;
    (u.uSkyCloudShadowLight.value as Vector2).set(dimmed, strength);
  }

  /** how much of what lies beyond the seabed it hides, 0 to 1 (the relief's `fieldOpacity`) */
  get seabedOpacity(): number {
    return this.uniforms.uScenerySeabedOpacity.value;
  }
  set seabedOpacity(value: number) {
    this.uniforms.uScenerySeabedOpacity.value = Math.min(Math.max(value, 0), 1);
  }

  /**
   * Leave the sea inside this rectangle, `[minX, minZ, maxX, maxZ]` in the wave plane, and
   * within `reach` of the camera, to a stage's real geometry; `null` for none. On the globe,
   * only while the camera is over the rectangle on the field's half of it (see claimStage).
   */
  setSeaStage(bounds: [number, number, number, number] | null, reach = 1e30) {
    this.uniforms.uScenerySeaStage.value.fromArray(bounds ?? NO_STAGE);
    this.stageReach = bounds ? reach : 0;
    this.claimStage(cameraAt);
  }

  // The stage claims the sea only while the camera is on the field's half of the globe and
  // over its rectangle in the wave plane. Then every ray it claims crosses its planes, which
  // lie over the rectangle between the camera and the globe, sunk or not (stage-vertex). Off
  // the rectangle its sunk planes miss some of them, and past the field's half a point on
  // the far side projects back inside it, where the stage draws nothing: the void or the bare
  // seabed showed. The same for the sky, the stage and the relief, which all take the test.
  private claimStage(camera: Vector3) {
    let reach = this.stageReach;
    if (reach > 0 && this.globe.enabled) {
      const u = this.uniforms;
      const stage = u.uScenerySeaStage.value;
      const x = camera.dot(u.uSceneryEast.value);
      const z = -camera.dot(u.uSceneryNorth.value);
      const fieldSide =
        stageAway.subVectors(camera, this.globe.centre).dot(this.globe.up) > 0;
      const over = x > stage.x && x < stage.z && z > stage.y && z < stage.w;
      if (!fieldSide || !over) reach = 0;
    }
    this.uniforms.uScenerySeaStageReach.value = reach;
  }

  /** For stage geometry, which rebuilds each pixel's view ray: call before drawing it. */
  setStageView(renderer: WebGLRenderer, camera: Camera) {
    renderer.getCurrentViewport(this.uniforms.uSceneryStageViewport.value);
    this.uniforms.uSceneryStageInverseProjection.value.copy(
      camera.projectionMatrixInverse,
    );
    this.prepareDraw(renderer, camera);
  }

  /**
   * The {@link globe}'s camera uniforms for `camera` (`Globe.setCamera`): what every shader
   * of this sky reads of the camera's height, up and horizon. Call it before each mesh drawn
   * with them is drawn, with the camera drawing it, as {@link prepareDraw} does: a bake or a
   * second view draws from a camera of its own. Returns at once for the same place.
   */
  syncCamera(camera: Camera) {
    // A World's globe may have been curved or flattened since.
    if (!this.ownsGlobe) this.syncCurvature();
    this.globe.setCamera(cameraAt.setFromMatrixPosition(camera.matrixWorld));
    // Out to where the sea's detail has faded (WaterMaterial.detailFadeDistance).
    const fade = this.uniforms.uDetailFade?.value as Vector2 | undefined;
    this.seaCharts.setCamera(cameraAt, fade ? fade.y : Infinity);
    this.syncHollow();
    this.claimStage(cameraAt);
  }

  /**
   * Everything this sky's shaders read of `camera`, for a mesh it is about to draw: its
   * uniforms ({@link syncCamera}) and the air's colours as seen from there
   * ({@link airColors}), drawn at most once per render for its place. Call it before each mesh
   * drawn with them is drawn, as {@link onBeforeDraw} does.
   */
  prepareDraw(renderer: WebGLRenderer, camera: Camera) {
    this.syncCamera(camera);
    this.airColors.update(renderer, camera);
  }

  /** An `onBeforeRender` for a mesh drawn with this sky's shaders: {@link prepareDraw}. */
  readonly onBeforeDraw = (
    renderer: WebGLRenderer,
    _scene: Scene,
    camera: Camera,
  ) => this.prepareDraw(renderer, camera);
}

const cameraAt = new Vector3();
const stageAway = new Vector3();
const planeZ = new Vector3();
