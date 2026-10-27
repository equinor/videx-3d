import {
  BufferGeometry,
  Camera,
  Color,
  ColorRepresentation,
  DataTexture,
  DoubleSide,
  Float32BufferAttribute,
  MathUtils,
  Matrix3,
  Matrix4,
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
import {
  applySurfaceDetail,
  createSurfaceDetailUniforms,
  SURFACE_DETAIL_DEFINES,
  SurfaceDetail,
  surfaceDetailKey,
  SurfaceDetailUniforms,
} from '../../sdk/materials/surface-detail';
import { Globe } from '../../sdk/projection/globe';
import { OceanCharts } from '../../sdk/projection/ocean-charts';
import { Vec2, Vec3 } from '../../sdk/types/common';
import {
  compassBasis,
  CompassFrame,
  directionFromCompass,
} from '../../sdk/utils/vector-operations';
import { OCEAN_SURFACE_UNIFORMS, OceanMaterial } from '../Ocean/ocean-material';
import fragmentShader from './shaders/sky-fragment.glsl';
import vertexShader from './shaders/sky-vertex.glsl';
import {
  SkyAbyssWallCut,
  skyAbyssWallClipPlane,
  skyAbyssWallGrid,
} from './sky-abyss-walls';
import {
  SKY_EARTH_RADIUS,
  SkyAbyssWalls,
  SkyClouds,
  skyDaylight,
  skyDefaults,
  skyMoonlight,
  skySunColor,
  SkySubsurfaceColors,
  skyTwilight,
} from './sky-model';

// The naked-eye planets (`PLANETS`); sky.glsl's `uSkyPlanets` has as many.
const SKY_PLANET_COUNT = 5;

// An empty rectangle: nothing is on a stage.
const NO_STAGE = [1, 1, -1, -1] as const;

/** The defines a material drawing the sky's sea takes over from the {@link SkyMaterial}. */
export const SKY_SHARED_DEFINES = [
  'OCEAN_WAVE_COUNT',
  'OCEAN_DETAIL_OCTAVES',
  'OCEAN_CONTACT_COUNT',
  ...SURFACE_DETAIL_DEFINES,
];

/**
 * The clip-space fullscreen triangle a {@link SkyMaterial} is drawn on. Render it
 * with `frustumCulled = false`.
 */
export function createSkyGeometry() {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    'position',
    new Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3),
  );
  return geometry;
}

/**
 * Procedural sky, drawn on {@link createSkyGeometry}. The view ray is rebuilt from
 * the camera, so it needs no size or position and also renders into a CubeCamera.
 * Depth test and write are off: draw it first, as three draws `scene.background`.
 *
 * ⚠️ Setters write into the existing uniform values, never replace them — the
 * environment bake shares these uniform objects by reference.
 *
 * The seabed is lit by the scene's lights (`lights: true`), as a `ChunkMaterial` is.
 *
 * @group Materials
 */
export class SkyMaterial extends ShaderMaterial {
  isSkyMaterial = true;
  /**
   * The Earth the sky draws: flat over the stage's disc ({@link setFlatSea}), at the
   * sea's level, curved while {@link globeEnabled}. What else lies on the globe — the
   * relief, a route, an anchored field — takes it from here. Kept in step by the setters;
   * not to be set directly.
   */
  readonly globe = new Globe();
  /**
   * The charts the sea's waves are drawn in on the {@link globe}: the field's wave plane
   * over the field, fixed ones on the Earth far off. Kept in step with the globe and the
   * camera ({@link syncCamera}).
   */
  readonly oceanCharts = new OceanCharts(this.globe);
  private bedDetail: SurfaceDetail | undefined;
  private bedDetailKey = '';
  // How far in front of the camera clipAbyssWalls cuts the walls away.
  private abyssWallCutDistance: number = skyDefaults.abyss.walls.cutDistance;
  // What clipAbyssWalls cuts by, kept to fill in each frame.
  private readonly abyssWallCut: SkyAbyssWallCut = {
    centre: [0, 0],
    half: [0, 0],
    level: 0,
    depth: 0,
    cutDistance: 0,
    distance: 0,
    flare: 0,
    wander: 0,
    relief: 0,
  };
  // The disc the sea is flat over (setFlatSea): the globe's.
  private get flatSea(): Vector4 {
    return this.uniforms.uSkyStageFlat.value;
  }
  private starTextures: { cells: DataTexture; list: DataTexture } | null = null;
  private observing = false;
  private starsLoading = false;
  private starGeneration = 0;
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
  // The stage's reach as set (setOceanStage); the uniform holds it only while the stage
  // can draw what it claims (claimStage).
  private stageReach = 0;

  constructor(parameters: ShaderMaterialParameters = {}) {
    const { sun, colors, abyss, ocean } = skyDefaults;
    super({
      vertexShader,
      fragmentShader,
      uniforms: {
        ...UniformsUtils.clone(UniformsLib.lights),
        // `fog: true` makes three write these once a scene has fog (see `useImmersionFog`).
        ...UniformsUtils.clone(UniformsLib.fog),
        ...createSurfaceDetailUniforms(),
        uSkyUp: new Uniform(new Vector3(0, 1, 0)),
        uSkyNorth: new Uniform(new Vector3(0, 0, -1)),
        uSkyEast: new Uniform(new Vector3(1, 0, 0)),
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
        uSkyStarCells: new Uniform<DataTexture | null>(null),
        uSkyStarList: new Uniform<DataTexture | null>(null),
        uSkySunRadiance: new Uniform(1),
        uSkySunDisc: new Uniform(1),
        uSkyHorizonBlend: new Uniform(skyDefaults.horizonBlend),
        uSkyDaylight: new Uniform(1),
        uSkyIntensity: new Uniform(skyDefaults.intensity),
        uSkyDebug: new Uniform(0),
        uSkyAbyssLevel: new Uniform(abyss.level),
        uSkyAbyssCeilingColor: new Uniform(new Color(abyss.colors.ceiling)),
        uSkyAbyssHorizonColor: new Uniform(new Color(abyss.colors.horizon)),
        uSkyAbyssDepthColor: new Uniform(new Color(abyss.colors.depth)),
        uSkyAbyssFadeDistance: new Uniform(abyss.fadeDistance),
        uSkyAbyssTransition: new Uniform(abyss.transition),
        uSkyAbyssDarkening: new Uniform(abyss.darkening),
        uSkyAbyssDetail: new Uniform(abyss.detail),
        uSkyAbyssDetailScale: new Uniform(abyss.detailScale),
        uSkyAbyssDepthDetail: new Uniform(
          new Vector2(abyss.depthDetail, abyss.depthDetailScale),
        ),
        uSkyAbyssFalloff: new Uniform(abyss.falloff),
        uSkyAbyssWalls: new Uniform(
          new Vector4(
            abyss.walls.distance,
            abyss.walls.lightStrength,
            abyss.walls.hazeDistance,
            abyss.walls.rockSize,
          ),
        ),
        uSkyAbyssWallShape: new Uniform(
          new Vector4(
            abyss.walls.relief,
            abyss.walls.flare,
            abyss.walls.lightDepth,
            abyss.walls.wander,
          ),
        ),
        // The depth over which the haze in the hollow darkens; 0 for never.
        uSkyAbyssWallHazeDepth: new Uniform(abyss.walls.hazeDepth),
        // Their sand: how thick, how bright the glow over the stage, and its colour.
        uSkyAbyssWallSand: new Uniform(
          new Vector2(abyss.walls.sand, abyss.walls.glow),
        ),
        uSkyAbyssWallSandColor: new Uniform(new Color(abyss.walls.sandColor)),
        uSkyAbyssWallGlowColor: new Uniform(new Color(abyss.walls.glowColor)),
        // The distance beyond their rim the hollow's light and haze fade out over.
        uSkyAbyssWallFade: new Uniform(abyss.walls.rimFade),
        // 1 while the seabed beyond the stage, which the background draws, hides them from above.
        uSkyAbyssWallCover: new Uniform(0),
        // The plane they are cut away up to (clipAbyssWalls): what is on the far side of its normal shows.
        uSkyAbyssWallClip: new Uniform(new Vector4(0, 0, 1, -1e30)),
        uSkyAbyssWallColor: new Uniform(new Color(abyss.walls.color)),
        uSkyAbyssWallCutColor: new Uniform(new Color(abyss.walls.cutColor)),
        uSkyAbyssWallMist: new Uniform(
          new Vector2(abyss.walls.mist, abyss.walls.mistReach),
        ),
        uSkyAbyssWallLight: new Uniform(new Vector3(0, 1, 0)),
        uSkyAbyssWallLightColor: new Uniform(new Color(1, 1, 1)),
        // The subsurface's light map (skySubsurfaceColors), filling in their shade.
        uSkyAbyssWallFillTop: new Uniform(new Color()),
        uSkyAbyssWallFillBottom: new Uniform(new Color()),
        uSkyAbyssWallFillBelow: new Uniform(new Color()),
        uSkyAbyssWallRock: new Uniform<Texture | null>(null),
        // The grid their mesh is laid on (updateAbyssWallGrid): columns, rows and depth.
        uSkyAbyssWallGrid: new Uniform(new Vector3()),
        uSkyClouds: new Uniform(new Vector4()),
        uSkyCloudsColor: new Uniform(new Vector4(1, 1, 1, 1)),
        uSkyCloudsSeed: new Uniform(new Vector2()),
        uSkyCloudsShape: new Uniform(new Vector4()),
        uSkyAir: new Uniform(new Vector3()),
        uSkyHaze: new Uniform(
          new Vector2(skyDefaults.air.hazeHeight, skyDefaults.air.haze),
        ),
        uSkyCurvature: new Uniform(
          skyDefaults.globe ? 1 / SKY_EARTH_RADIUS : 0,
        ),
        uSkyStageFlat: new Uniform(new Vector4()),
        // The rectangle setFlatSea was given: its centre and half extents, world X/Z.
        uSkyStageBox: new Uniform(new Vector4()),
        uSkyOceanLevel: new Uniform(ocean.level),
        uSkyOceanDepth: new Uniform(ocean.depth),
        uSkyOceanBedColor: new Uniform(new Color(ocean.seabed.color)),
        uSkyOceanBedSpecular: new Uniform(new Color(ocean.seabed.specular)),
        uSkyOceanBedShininess: new Uniform(ocean.seabed.shininess),
        uSkyOceanBedAmbient: new Uniform(new Vector2(...ocean.seabed.ambient)),
        uSkyOceanFogDensity: new Uniform(ocean.bodyFogDensity),
        uSkyOceanBuried: new Uniform(0),
        uSkyOceanCutawayAnchor: new Uniform(new Vector3()),
        uSkyOceanCutawayHeading: new Uniform(new Vector3(0, 0, -1)),
        uSkyOceanCutawayShape: new Uniform(new Vector3()),
        uSkyOceanCutawayWaveA: new Uniform(new Vector3()),
        uSkyOceanCutawayWaveB: new Uniform(new Vector3()),
        uSkyOceanCutawayRim: new Uniform(new Vector4(1, 1, 1, 0)),
        uSkyOceanCutawayShadow: new Uniform(new Vector2()),
        uSkyOceanCutawayCuts: new Uniform(new Vector2(1, 1)),
        uSkyOceanCutawayGrip: new Uniform(new Vector2(0, 1)),
        uSkyOceanWater: new Uniform(1),
        uSkyOceanSeabed: new Uniform(1),
        uSkyOceanSeabedOpacity: new Uniform(1),
        uSkyOceanStage: new Uniform(new Vector4(...NO_STAGE)),
        uSkyOceanStageReach: new Uniform(0),
        uSkyStageInverseProjection: new Uniform(new Matrix4()),
        uSkyStageViewport: new Uniform(new Vector4()),
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
    this.oceanBedDetail = ocean.seabed.detail;
    // The globe's own uniform objects, so every material sharing the sky's shares them too;
    // the same for the sea's charts.
    Object.assign(
      this.uniforms,
      this.globe.uniforms,
      this.oceanCharts.uniforms,
    );
    this.globe.enabled = this.globeEnabled;
    this.globe.level = this.oceanLevel;

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
    this.uniforms.uSkyUp.value.fromArray(up);
    this.uniforms.uSkyNorth.value.fromArray(north);
    this.uniforms.uSkyEast.value.fromArray(east);
    this.globe.setUp(this.uniforms.uSkyUp.value);
    // The wave plane's X and Z: east and south (skyOceanPlane).
    this.oceanCharts.setPlane(
      this.uniforms.uSkyEast.value,
      planeZ.copy(this.uniforms.uSkyNorth.value).negate(),
    );
  }

  /** the world's up direction (normalised); see {@link setFrame} */
  get up(): Vector3 {
    return this.uniforms.uSkyUp.value;
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

  /** angular radius of the moon disc, in degrees */
  get moonSize(): number {
    return MathUtils.radToDeg(this.uniforms.uSkyMoonSize.value);
  }
  set moonSize(value: number) {
    this.uniforms.uSkyMoonSize.value = MathUtils.degToRad(Math.max(value, 0));
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
    const generation = this.starGeneration;
    import('./sky-star-catalogue')
      .then(({ createSkyStarTextures }) => {
        if (generation !== this.starGeneration) return;
        this.starTextures = createSkyStarTextures();
        this.uniforms.uSkyStarCells.value = this.starTextures.cells;
        this.uniforms.uSkyStarList.value = this.starTextures.list;
        this.uniforms.uSkyObserved.value = this.observing ? 1 : 0;
      })
      .catch(error => console.warn('SkyMaterial: no star catalogue', error))
      .finally(() => {
        if (generation === this.starGeneration) this.starsLoading = false;
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
  }

  dispose() {
    // A catalogue still loading is dropped when it arrives.
    this.starGeneration++;
    this.starsLoading = false;
    // Only the owner's: a bake's material shares these uniforms.
    if (this.starTextures) {
      this.starTextures.cells.dispose();
      this.starTextures.list.dispose();
      this.starTextures = null;
      this.uniforms.uSkyObserved.value = 0;
      this.uniforms.uSkyStarCells.value = null;
      this.uniforms.uSkyStarList.value = null;
    }
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
    return this.uniforms.uSkyIntensity.value;
  }
  set intensity(value: number) {
    this.uniforms.uSkyIntensity.value = Math.max(value, 0);
  }

  /** tint what the sky, and a stage drawing its sea, draw by part (see `SkyDebug.tint`) */
  get debugTint(): boolean {
    return this.uniforms.uSkyDebug.value > 0;
  }
  set debugTint(value: boolean) {
    this.uniforms.uSkyDebug.value = value ? 1 : 0;
  }

  /** the void below the level (see {@link SkyAbyss}); changing it recompiles */
  get abyss(): boolean {
    return this.defines.SKY_ABYSS !== undefined;
  }
  set abyss(value: boolean) {
    if (value === this.abyss) return;
    if (value) this.defines.SKY_ABYSS = '';
    else delete this.defines.SKY_ABYSS;
    this.needsUpdate = true;
  }

  /**
   * No sky: the void's gradient in its place, with no air, sun, moon, stars or clouds
   * (`background: 'void'`); changing it recompiles
   */
  get voidBackground(): boolean {
    return this.defines.SKY_VOID !== undefined;
  }
  set voidBackground(value: boolean) {
    if (value === this.voidBackground) return;
    if (value) this.defines.SKY_VOID = '';
    else delete this.defines.SKY_VOID;
    this.needsUpdate = true;
  }

  /** a deck of still clouds (see {@link setClouds}); changing it recompiles */
  get clouds(): boolean {
    return this.defines.SKY_CLOUDS !== undefined;
  }
  set clouds(value: boolean) {
    if (value === this.clouds) return;
    if (value) this.defines.SKY_CLOUDS = '';
    else delete this.defines.SKY_CLOUDS;
    this.needsUpdate = true;
  }

  /** the clouds' look (see `SkyClouds`) */
  setClouds(clouds: Required<Omit<SkyClouds, 'enabled'>>) {
    this.uniforms.uSkyClouds.value.set(
      MathUtils.clamp(clouds.coverage, 0, 1),
      Math.max(clouds.altitude, 1),
      Math.max(clouds.scale, 1),
      MathUtils.clamp(clouds.softness, 0, 1),
    );
    this.uniforms.uSkyCloudsShape.value.set(
      this.globe.radius + Math.max(clouds.altitude, 1),
      Math.max(clouds.thickness, 0),
      { deck: 0, band: 1, both: 2 }[clouds.layers],
      Math.max(clouds.bandDistance, 1),
    );
    const color = new Color(clouds.color);
    this.uniforms.uSkyCloudsColor.value.set(
      color.r,
      color.g,
      color.b,
      MathUtils.clamp(clouds.opacity, 0, 1),
    );
    // Any seed lands somewhere else in the pattern, far from the others.
    this.uniforms.uSkyCloudsSeed.value.set(
      (clouds.seed * 12.9898) % 1000,
      (clouds.seed * 78.233) % 1000,
    );
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
    haze: number = skyDefaults.air.haze,
    hazeHeight: number = skyDefaults.air.hazeHeight,
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
   * camera climbs; off, on a flat plane everywhere. The `Sky`'s `globe`.
   */
  get globeEnabled(): boolean {
    return this.uniforms.uSkyCurvature.value > 0;
  }
  set globeEnabled(value: boolean) {
    this.uniforms.uSkyCurvature.value = value ? 1 / SKY_EARTH_RADIUS : 0;
    this.globe.enabled = value;
  }

  /**
   * With {@link globeEnabled}, keep the sea flat over the disc that holds this rectangle,
   * `[minX, minZ, maxX, maxZ]` in world X/Z: where the scene is, so what meets the water
   * there meets it level. The {@link globe}'s disc: beyond it, the sea is the sphere. `null`
   * for none.
   */
  setFlatSea(bounds: [number, number, number, number] | null) {
    if (!bounds) {
      this.flatSea.set(0, 0, 0, 0);
      this.uniforms.uSkyStageBox.value.set(0, 0, 0, 0);
    } else {
      const [minX, minZ, maxX, maxZ] = bounds;
      this.flatSea.set(
        (minX + maxX) / 2,
        0,
        (minZ + maxZ) / 2,
        Math.hypot(maxX - minX, maxZ - minZ) / 2,
      );
      this.uniforms.uSkyStageBox.value.set(
        (minX + maxX) / 2,
        (minZ + maxZ) / 2,
        (maxX - minX) / 2,
        (maxZ - minZ) / 2,
      );
    }
    this.globe.setDisc(bounds);
    this.updateAbyssWallGrid();
  }

  /** height of the lid along {@link up} */
  get abyssLevel(): number {
    return this.uniforms.uSkyAbyssLevel.value;
  }
  set abyssLevel(value: number) {
    this.uniforms.uSkyAbyssLevel.value = value;
  }

  get abyssCeilingColor(): Color {
    return this.uniforms.uSkyAbyssCeilingColor.value;
  }
  set abyssCeilingColor(value: ColorRepresentation) {
    this.uniforms.uSkyAbyssCeilingColor.value.set(value);
  }

  get abyssHorizonColor(): Color {
    return this.uniforms.uSkyAbyssHorizonColor.value;
  }
  set abyssHorizonColor(value: ColorRepresentation) {
    this.uniforms.uSkyAbyssHorizonColor.value.set(value);
  }

  get abyssDepthColor(): Color {
    return this.uniforms.uSkyAbyssDepthColor.value;
  }
  set abyssDepthColor(value: ColorRepresentation) {
    this.uniforms.uSkyAbyssDepthColor.value.set(value);
  }

  /** distance over which the lid recedes into the horizon colour; 0 for never (without walls) */
  get abyssFadeDistance(): number {
    return this.uniforms.uSkyAbyssFadeDistance.value;
  }
  set abyssFadeDistance(value: number) {
    this.uniforms.uSkyAbyssFadeDistance.value = Math.max(value, 0);
  }

  /** depth below the level over which the void fades in */
  get abyssTransition(): number {
    return this.uniforms.uSkyAbyssTransition.value;
  }
  set abyssTransition(value: number) {
    this.uniforms.uSkyAbyssTransition.value = Math.max(value, 1e-3);
  }

  /** depth below the level over which the void dims toward black; 0 = off */
  get abyssDarkening(): number {
    return this.uniforms.uSkyAbyssDarkening.value;
  }
  set abyssDarkening(value: number) {
    this.uniforms.uSkyAbyssDarkening.value = Math.max(value, 0);
  }

  /** strength of the noise relief on the lid */
  get abyssDetail(): number {
    return this.uniforms.uSkyAbyssDetail.value;
  }
  set abyssDetail(value: number) {
    this.uniforms.uSkyAbyssDetail.value = Math.max(value, 0);
  }

  /** size of the noise relief, in world units */
  get abyssDetailScale(): number {
    return this.uniforms.uSkyAbyssDetailScale.value;
  }
  set abyssDetailScale(value: number) {
    this.uniforms.uSkyAbyssDetailScale.value = Math.max(value, 1e-3);
  }

  /** strength of the faint rock in the depths; 0 for none */
  get abyssDepthDetail(): number {
    return this.uniforms.uSkyAbyssDepthDetail.value.x;
  }
  set abyssDepthDetail(value: number) {
    this.uniforms.uSkyAbyssDepthDetail.value.x = Math.max(value, 0);
  }

  /** size of the rock's features in the depths, relative */
  get abyssDepthDetailScale(): number {
    return this.uniforms.uSkyAbyssDepthDetail.value.y;
  }
  set abyssDepthDetailScale(value: number) {
    this.uniforms.uSkyAbyssDepthDetail.value.y = Math.max(value, 1e-3);
  }

  /** exponent of the depths' gradient below the horizon */
  get abyssFalloff(): number {
    return this.uniforms.uSkyAbyssFalloff.value;
  }
  set abyssFalloff(value: number) {
    this.uniforms.uSkyAbyssFalloff.value = Math.max(value, 0.01);
  }

  /** the void's walls (see {@link SkyAbyssWalls}); changing it recompiles */
  get abyssWalls(): boolean {
    return this.defines.SKY_ABYSS_WALLS !== undefined;
  }
  set abyssWalls(value: boolean) {
    if (value === this.abyssWalls) return;
    if (value) this.defines.SKY_ABYSS_WALLS = '';
    else delete this.defines.SKY_ABYSS_WALLS;
    this.needsUpdate = true;
  }

  /**
   * Openings to the void from above that stages make (a `SkyBoxStage` occupant's cut),
   * each telling whether it is open now. While one is, the walls are drawn from above the lid.
   */
  readonly abyssOpenings = new Set<() => boolean>();

  /**
   * Whether the void, and with it the walls, can show from above the lid: through a seabed
   * that is off or see-through, a cutaway taking the seabed (`cutaway`), or a stage's
   * opening ({@link abyssOpenings}). Sets whether the seabed beyond the stage, which the
   * background draws, hides them there.
   */
  abyssOpenFromAbove(cutaway: boolean) {
    const covers =
      this.ocean && this.oceanSeabed && this.oceanSeabedOpacity >= 1;
    this.uniforms.uSkyAbyssWallCover.value = covers ? 1 : 0;
    if (!this.ocean) return false;
    if (!covers || cutaway) return true;
    for (const open of this.abyssOpenings) if (open()) return true;
    return false;
  }

  /** the walls' look (see {@link SkyAbyssWalls}) */
  setAbyssWalls(walls: Required<SkyAbyssWalls>) {
    const distance = Math.max(walls.distance, 1);
    const relief = MathUtils.clamp(walls.relief, 1, 0.9 * distance);
    this.uniforms.uSkyAbyssWalls.value.set(
      distance,
      MathUtils.clamp(walls.lightStrength, 0, 1),
      Math.max(walls.hazeDistance, 0),
      Math.max(walls.rockSize, 1),
    );
    this.uniforms.uSkyAbyssWallShape.value.set(
      relief,
      Math.max(walls.flare, 0),
      Math.max(walls.lightDepth, 1),
      MathUtils.clamp(walls.wander, 0, distance - relief),
    );
    this.uniforms.uSkyAbyssWallHazeDepth.value = Math.max(walls.hazeDepth, 0);
    (this.uniforms.uSkyAbyssWallColor.value as Color).set(walls.color);
    (this.uniforms.uSkyAbyssWallCutColor.value as Color).set(walls.cutColor);
    (this.uniforms.uSkyAbyssWallMist.value as Vector2).set(
      MathUtils.clamp(walls.mist, 0, 1),
      Math.max(walls.mistReach, 1),
    );
    (this.uniforms.uSkyAbyssWallSand.value as Vector2).set(
      Math.max(walls.sand, 0),
      MathUtils.clamp(walls.glow, 0, 1),
    );
    (this.uniforms.uSkyAbyssWallSandColor.value as Color).set(walls.sandColor);
    (this.uniforms.uSkyAbyssWallGlowColor.value as Color).set(walls.glowColor);
    this.uniforms.uSkyAbyssWallFade.value = Math.max(walls.rimFade, 0);
    this.abyssWallCutDistance = Math.max(walls.cutDistance, 0);
    this.updateAbyssWallGrid();
  }

  // The grid the walls' mesh is laid on, for the stage, the walls and their cliffs.
  private updateAbyssWallGrid() {
    const rock = this.uniforms.uSkyAbyssWallRock.value as Texture | null;
    if (!rock) return;
    const box = this.uniforms.uSkyStageBox.value as Vector4;
    const walls = this.uniforms.uSkyAbyssWalls.value as Vector4;
    const shape = this.uniforms.uSkyAbyssWallShape.value as Vector4;
    const grid = skyAbyssWallGrid(
      [box.z, box.w],
      walls.x,
      walls.w,
      shape.z,
      (rock.image as { width: number }).width,
    );
    (this.uniforms.uSkyAbyssWallGrid.value as Vector3).set(
      grid.columns,
      grid.rows,
      grid.depth,
    );
  }

  /** the subsurface's light map, filling in the walls' shade */
  setAbyssWallFill(colors: SkySubsurfaceColors) {
    this.uniforms.uSkyAbyssWallFillTop.value.copy(colors.top);
    this.uniforms.uSkyAbyssWallFillBottom.value.copy(colors.bottom);
    this.uniforms.uSkyAbyssWallFillBelow.value.copy(colors.below);
  }

  /**
   * Cut the walls away up to a vertical plane facing `camera`'s heading, as the cutaway's
   * does: through the stage's centre, or {@link SkyAbyssWalls.cutDistance} in front of the camera
   * once that is further, and below the lid past the stage, until the whole stage is in view
   * through the hollow (see `skyAbyssWallClipPlane`). Every frame, with the camera's
   * matrices this frame's.
   */
  clipAbyssWalls(camera: Camera) {
    const u = this.uniforms;
    const box = u.uSkyStageBox.value as Vector4;
    const walls = u.uSkyAbyssWalls.value as Vector4;
    const shape = u.uSkyAbyssWallShape.value as Vector4;
    const cut = this.abyssWallCut;
    cut.centre[0] = box.x;
    cut.centre[1] = box.y;
    cut.half[0] = box.z;
    cut.half[1] = box.w;
    cut.level = this.abyssLevel;
    cut.depth = (u.uSkyAbyssWallGrid.value as Vector3).z;
    cut.cutDistance = this.abyssWallCutDistance;
    cut.distance = walls.x;
    cut.flare = shape.y;
    cut.wander = shape.w;
    cut.relief = shape.x;
    skyAbyssWallClipPlane(
      camera.matrixWorld,
      camera.position,
      this.up,
      cut,
      u.uSkyAbyssWallClip.value as Vector4,
    );
  }

  /** the raking light the walls are shaded by: `direction` toward it, in the subsurface light's `color` */
  setAbyssWallLight(direction: Vector3, color: Color) {
    this.uniforms.uSkyAbyssWallLight.value.copy(direction).normalize();
    this.uniforms.uSkyAbyssWallLightColor.value.copy(color);
  }

  /** the cliffs the walls are drawn from (`bakeSkyCliffs`) */
  get abyssWallRock(): Texture | null {
    return this.uniforms.uSkyAbyssWallRock.value;
  }
  set abyssWallRock(value: Texture | null) {
    this.uniforms.uSkyAbyssWallRock.value = value;
    this.updateAbyssWallGrid();
  }

  /** the endless sea (see {@link SkyOcean}); link its water first ({@link linkOcean}). Changing it recompiles */
  get ocean(): boolean {
    return this.defines.SKY_OCEAN !== undefined;
  }
  set ocean(value: boolean) {
    if (value === this.ocean) return;
    if (value) this.defines.SKY_OCEAN = '';
    else delete this.defines.SKY_OCEAN;
    this.needsUpdate = true;
  }

  /**
   * Draw the sea with an {@link OceanMaterial}'s water. Its uniform objects are shared
   * by reference, so its setters, wave tables and clock drive the sky's sea too.
   */
  linkOcean(water: OceanMaterial) {
    for (const name of OCEAN_SURFACE_UNIFORMS) {
      this.uniforms[name] = water.uniforms[name];
    }
    const waves = water.uniforms.uWaveA.value.length;
    const octaves = water.defines.OCEAN_DETAIL_OCTAVES;
    const contacts = water.contactCount;
    if (
      this.defines.OCEAN_WAVE_COUNT !== waves ||
      this.defines.OCEAN_DETAIL_OCTAVES !== octaves ||
      this.defines.OCEAN_CONTACT_COUNT !== contacts
    ) {
      this.defines.OCEAN_WAVE_COUNT = waves;
      this.defines.OCEAN_DETAIL_OCTAVES = octaves;
      this.defines.OCEAN_CONTACT_COUNT = contacts;
      this.needsUpdate = true;
    }
  }

  /** height of the sea surface along {@link up} */
  get oceanLevel(): number {
    return this.uniforms.uSkyOceanLevel.value;
  }
  set oceanLevel(value: number) {
    this.uniforms.uSkyOceanLevel.value = value;
    this.globe.level = value;
  }

  /** depth of the seabed below the surface */
  get oceanDepth(): number {
    return this.uniforms.uSkyOceanDepth.value;
  }
  set oceanDepth(value: number) {
    this.uniforms.uSkyOceanDepth.value = Math.max(value, 0);
  }

  get oceanBedColor(): Color {
    return this.uniforms.uSkyOceanBedColor.value;
  }
  set oceanBedColor(value: ColorRepresentation) {
    this.uniforms.uSkyOceanBedColor.value.set(value);
  }

  /** the seabed's specular highlight colour */
  get oceanBedSpecular(): Color {
    return this.uniforms.uSkyOceanBedSpecular.value;
  }
  set oceanBedSpecular(value: ColorRepresentation) {
    this.uniforms.uSkyOceanBedSpecular.value.set(value);
  }

  /** the seabed's specular exponent */
  get oceanBedShininess(): number {
    return this.uniforms.uSkyOceanBedShininess.value;
  }
  set oceanBedShininess(value: number) {
    this.uniforms.uSkyOceanBedShininess.value = Math.max(value, 0);
  }

  /** the seabed's ambient multipliers facing up / facing down; `false` leaves the ambient flat */
  get oceanBedAmbient(): Vector2 {
    return this.uniforms.uSkyOceanBedAmbient.value;
  }
  set oceanBedAmbient(value: Readonly<Vec2> | false) {
    if (value) this.uniforms.uSkyOceanBedAmbient.value.set(value[0], value[1]);
    else this.uniforms.uSkyOceanBedAmbient.value.set(1, 1);
  }

  /** the seabed's procedural relief; `undefined` for none. Changing it recompiles */
  get oceanBedDetail(): SurfaceDetail | undefined {
    return this.bedDetail;
  }
  set oceanBedDetail(value: SurfaceDetail | undefined) {
    const key = surfaceDetailKey(value);
    if (key === this.bedDetailKey) return;
    this.bedDetail = value;
    this.bedDetailKey = key;
    applySurfaceDetail(
      this.uniforms as unknown as SurfaceDetailUniforms,
      this.defines,
      value,
    );
    this.needsUpdate = true;
  }

  /** how quickly the water tints what is seen through it, per world unit */
  get oceanFogDensity(): number {
    return this.uniforms.uSkyOceanFogDensity.value;
  }
  set oceanFogDensity(value: number) {
    this.uniforms.uSkyOceanFogDensity.value = Math.max(value, 0);
  }

  /** the camera is under the ground a stage draws, above the sea's own seabed (see {@link oceanGround}) */
  get oceanBuried(): boolean {
    return this.uniforms.uSkyOceanBuried.value > 0;
  }
  set oceanBuried(value: boolean) {
    this.uniforms.uSkyOceanBuried.value = value ? 1 : 0;
  }

  /**
   * The ground's height under the camera where a stage draws its own (`SkyBoxStage`, its
   * relief drawn from tiles): the seabed, or land above the sea, no lower than the sea's own
   * seabed. `null` where the sea's flat seabed is.
   */
  oceanGround: number | null = null;

  /** half the width of a stage occupant's outline (`SkyBoxStage`): the scale a cutaway keeps to (see `SkyCutaway.zoomFollow`) */
  occupantRadius: number | null = null;

  /** the sea has water; without it the seabed lies dry */
  get oceanWater(): boolean {
    return this.uniforms.uSkyOceanWater.value > 0;
  }
  set oceanWater(value: boolean) {
    this.uniforms.uSkyOceanWater.value = value ? 1 : 0;
  }

  /** the sea has a seabed; without it the void lies below the water */
  get oceanSeabed(): boolean {
    return this.uniforms.uSkyOceanSeabed.value > 0;
  }
  set oceanSeabed(value: boolean) {
    this.uniforms.uSkyOceanSeabed.value = value ? 1 : 0;
  }

  /** how much of what lies beyond the seabed it hides, 0 to 1 */
  get oceanSeabedOpacity(): number {
    return this.uniforms.uSkyOceanSeabedOpacity.value;
  }
  set oceanSeabedOpacity(value: number) {
    this.uniforms.uSkyOceanSeabedOpacity.value = Math.min(
      Math.max(value, 0),
      1,
    );
  }

  /**
   * Leave the sea inside this rectangle, `[minX, minZ, maxX, maxZ]` in the wave plane, and
   * within `reach` of the camera, to a stage's real geometry; `null` for none. On the globe,
   * only while the camera is over the rectangle on the field's half of it (see claimStage).
   */
  setOceanStage(bounds: [number, number, number, number] | null, reach = 1e30) {
    this.uniforms.uSkyOceanStage.value.fromArray(bounds ?? NO_STAGE);
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
      const stage = u.uSkyOceanStage.value;
      const x = camera.dot(u.uSkyEast.value);
      const z = -camera.dot(u.uSkyNorth.value);
      const fieldSide =
        stageAway.subVectors(camera, this.globe.centre).dot(this.globe.up) > 0;
      const over = x > stage.x && x < stage.z && z > stage.y && z < stage.w;
      if (!fieldSide || !over) reach = 0;
    }
    this.uniforms.uSkyOceanStageReach.value = reach;
  }

  /** For stage geometry, which rebuilds each pixel's view ray: call before drawing it. */
  setStageView(renderer: WebGLRenderer, camera: Camera) {
    renderer.getCurrentViewport(this.uniforms.uSkyStageViewport.value);
    this.uniforms.uSkyStageInverseProjection.value.copy(
      camera.projectionMatrixInverse,
    );
    this.syncCamera(camera);
  }

  /**
   * The {@link globe}'s camera uniforms for `camera` (`Globe.setCamera`): what every shader
   * of this sky reads of the camera's height, up and horizon. Call it before each mesh drawn
   * with them is drawn, with the camera drawing it, as {@link onBeforeDraw} does: a bake or a
   * second view draws from a camera of its own. Returns at once for the same place.
   */
  syncCamera(camera: Camera) {
    this.globe.setCamera(cameraAt.setFromMatrixPosition(camera.matrixWorld));
    // Out to where the sea's detail has faded (OceanMaterial.detailFadeDistance).
    const fade = this.uniforms.uDetailFade?.value as Vector2 | undefined;
    this.oceanCharts.setCamera(cameraAt, fade ? fade.y : Infinity);
    // The deck lies at its altitude over the globe, whose radius its frame sets.
    this.uniforms.uSkyCloudsShape.value.x =
      this.globe.radius + this.uniforms.uSkyClouds.value.y;
    this.claimStage(cameraAt);
  }

  /** An `onBeforeRender` for a mesh drawn with this sky's shaders: {@link syncCamera}. */
  readonly onBeforeDraw = (
    _renderer: WebGLRenderer,
    _scene: Scene,
    camera: Camera,
  ) => this.syncCamera(camera);
}

const cameraAt = new Vector3();
const stageAway = new Vector3();
const planeZ = new Vector3();
