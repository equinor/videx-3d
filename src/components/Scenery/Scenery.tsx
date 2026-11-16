import { useFrame, useThree } from '@react-three/fiber';
import {
  ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Color,
  ColorRepresentation,
  DirectionalLight,
  DoubleSide,
  Group,
  LightProbe,
  MathUtils,
  Mesh,
  NoToneMapping,
  Object3D,
  Scene,
  ShaderMaterial,
  SphericalHarmonics3,
  Vector2,
  Vector3,
} from 'three';
import {
  precompile,
  PRECOMPILE_PRIORITY,
  releaseMaterial,
} from '../../rendering/precompile';
import {
  geoFrameAt,
  geoFrameLocation,
  placeGeoFrame,
} from '../../sdk/projection/geo-frame';
import { Vec3 } from '../../sdk/types/common';
import { directionFromCompass } from '../../sdk/utils/vector-operations';
import { sceneWaterBody } from '../../sdk/materials/water-body';
import { sceneSky, type SceneSkySource } from '../../sdk/materials/scene-sky';
import { setSceneGroundMap } from '../../sdk/materials/ground-map';
import { waterOpticsOf } from '../../sdk/weather/water-optics';
import { OceanMaterial } from '../Ocean/ocean-material';
import { applyOceanWaterProps } from '../Ocean/ocean-material-sync';
import { useWorld } from '../World/world-context';
import { useWorldRelief } from '../World/world-relief';
import { useWeatherOceanWind } from '../Weather/useWeatherOceanWind';
import { useWeather } from '../Weather/weather-context';
import { useWeatherOceanSea } from '../Weather/useWeatherOceanSea';
import { useWeatherStep } from '../Weather/useWeatherStep';
import type { ProgressReport } from '../Progress/progress-store';
import {
  createOceanContactRegistry,
  OceanContactContext,
} from '../Ocean/ocean-contact';
import {
  chartedSeaHeights,
  createOceanSampler,
  OceanSamplerContext,
  type OceanPlane,
} from '../Ocean/ocean-sampler';
import {
  createSceneryProgress,
  SCENERY_PROGRESS_LABELS,
  SceneryProgressLabels,
} from './scenery-progress';
import standInFragmentShader from './shaders/sky-stand-in-fragment.glsl';
import skyVertexShader from './shaders/sky-vertex.glsl';
import { SceneryBaker } from './scenery-baker';
import { SceneryBakeSchedule } from './scenery-bake-schedule';
import {
  SceneryContext,
  SceneryOceanContext,
  SceneryOceanState,
  SceneryState,
} from './scenery-context';
import {
  createSceneryLayerMaterial,
  SCENERY_LAYER_ORDER,
  SceneryLayerView,
  sceneryLayersShown,
  useSceneryLayerMaterial,
} from './scenery-layers';
import {
  SceneryFeatures,
  SceneryRegistry,
  SceneryRegistryContext,
  ScenerySkyOverlay,
} from './scenery-registry';
import { createSceneryGeometry, SceneryMaterial } from './scenery-material';
import {
  SceneryHollowParts,
  sceneryHollowAirGone,
  sceneryHollowInside,
  sceneryHollowRadiusRange,
  sceneryHollowLook,
} from './scenery-hollow';
import { SceneryHollowGrip } from './scenery-hollow-grip';
import { SceneryReliefHub } from './scenery-relief-hub';
import { SceneryGround } from './scenery-ground';
import { sceneryOceanDefines } from './scenery-stage';
import {
  SKY_HDR_SUN_RADIANCE,
  SceneryAbyssProps,
  SkyAir,
  SkyColors,
  skyDaylight,
  sceneryDefaults,
  skyCelestialFrame,
  skyEphemeris,
  SkyMoon,
  skyMoonlight,
  skyMoonShine,
  SkyObserver,
  skyObserverValid,
  SceneryOceanProps,
  ScenerySeabed,
  skyStarShare,
  skyStarFrame,
  SkyStars,
  ScenerySubsurface,
  scenerySubsurfaceColors,
  scenerySubsurfaceLightPosition,
  SkySun,
  skySunColor,
  skyTwilight,
  sceneryWaterDimming,
  SceneryZone,
  sceneryZone,
  sceneryLidOverCamera,
} from './scenery-model';
import { useCameraProbe } from '../../hooks/useCameraSite';
import {
  CAMERA_PROBE_ORDER,
  type CameraProbe,
  type CameraSite,
  reportCameraWater,
} from '../../sdk/utils/camera-site';
import { SceneryCubeView } from './SceneryCubeView';

export type SceneryEnvironmentOptions = {
  /** `scene.environmentIntensity` while the sky provides the environment. Default 1 */
  intensity?: number;
  /** cube face size of the bake. Default 128 */
  resolution?: number;
};

export type SceneryLightProbeOptions = {
  /** Default 1 */
  intensity?: number;
};

/**
 * When the environment and the light probe are baked again as the sky changes. A change is
 * baked once the sky has been still for `interval`, so a slider being dragged bakes nothing
 * on the way, and at least every `maxWait` while it keeps changing. The sky itself follows
 * at once; only the light it casts waits. A camera moving never bakes.
 */
export type SceneryCaptureOptions = {
  /** how long the sky must be still before it is baked, in milliseconds. Default 250 */
  interval?: number;
  /** longest a changing sky goes without a bake, in milliseconds. Default 1000 */
  maxWait?: number;
};

/**
 * A layer the {@link Scenery} draws itself: its background's (see `SceneryBackgroundLayer`:
 * the sky itself, the void, the sea seen from the air, the view from in the water, the sea's
 * surface), and all of them at once (`background`); and its clouds (`clouds`: the
 * `SceneryClouds` it holds, which draw themselves where the sky shows).
 */
export type SceneryLayer =
  | 'background'
  | 'sky'
  | 'clouds'
  | 'abyss'
  | 'sea'
  | 'water'
  | 'surface';

/**
 * Views for seeing how the sky and a `SceneryStage` fit together. They only change what
 * is drawn: nothing is rebuilt or baked again, and the bakes never see them.
 */
export type SceneryDebug = {
  /**
   * Tint each part by what draws it. The sky: its sea, seabed and void red, what it
   * leaves to a stage purple, its surface layer orange. A stage: its surface blue, flat
   * seabed green, relief amber. Untinted is the scene.
   */
  tint?: boolean;
  /** layers not to draw */
  hide?: SceneryLayer[];
  /** the environment's bake for the zone in view as its six faces, in the canvas' lower right corner (`+Y` over `-X -Z +X +Z`, `-Y` under) */
  environment?: boolean;
};

/**
 * Scenery props
 * @expand
 */
export type SceneryProps = {
  sun?: SkySun;
  /**
   * Where and when the sky is seen from: the sun and the moon — with its phase, up by
   * day too — are then the real ones for that moment and place, and so are the stars and
   * the planets. Inside a `World`, a date alone will do: the place is its origin's.
   * `sun.azimuth` and `elevation` are ignored while it is valid; without one, they set the
   * sun, the moon is a full one opposite it and the stars are procedural.
   */
  observer?: SkyObserver | null;
  colors?: SkyColors;
  /** the world's up direction. Default `[0, 1, 0]` */
  up?: Vec3;
  /**
   * compass north, i.e. azimuth 0. Default true north at the origin of the `World`'s frame —
   * the frame the globe lies on the Earth by; without one, `[0, 0, -1]` (see
   * `CRS.utmToWorld`)
   */
  north?: Vec3;
  /** scales the whole sky: background, environment and light probe. Default 1 */
  intensity?: number;
  /** width of the horizon -> ground transition, as a sine of the angle below the horizon. Default 0.04 */
  horizonBlend?: number;
  /**
   * The Earth is a fixed globe (`SceneryMaterial.globe`): the sea, the sky and the clouds follow
   * its curve, so the horizon drops as the camera climbs (about 1° at 1 km, 4° at 15 km).
   * Under a `SceneryStage` the sea stays flat over the disc that holds its `boundary`. The
   * bakes keep a level horizon. Default true
   *
   * Inside a `World` the globe is the World's, and so is this choice (its `globe`): this one
   * is not used there, so that drawing the scenery or not never moves what is placed.
   *
   * ⚠️ Off, the sea is a flat plane everywhere: right for one field seen from near it, wrong
   * far from it, where the relief and anchored content stay flat too and the horizon never
   * drops. Kept for comparison and for a host that needs a level horizon.
   */
  globe?: boolean;
  /**
   * Draw the sky, and its `SceneryStage`, behind the scene. Switched instantly: nothing
   * is rebuilt or baked again, and the environment and the light probe stay on, lit by
   * the `subsurface`. `'void'` draws the void's grey gradient in the sky's place (the
   * stand-in's, while the sky compiles): no air, sun, moon, stars or clouds, and the
   * scene lit by the `subsurface` everywhere; the void and a sea are drawn as
   * ever. Changing to or from it recompiles the sky's own layer. Default true
   */
  background?: boolean | 'void';
  /** bake the sky into `scene.environment`, which lights MeshStandard/MeshPhysical materials. Default true */
  environment?: boolean | SceneryEnvironmentOptions;
  /** bake the sky into a LightProbe, which lights every `lights: true` material. Default true */
  lightProbe?: boolean | SceneryLightProbeOptions;
  /**
   * The light below the seabed (or the abyss level), and wherever the sky is not drawn:
   * soft light panels on a dark backdrop, or a map of your own, and a steady directional
   * light in place of the sun's (see {@link ScenerySubsurface}). Default the panels and a fixed light
   */
  subsurface?: ScenerySubsurface;
  /** how often the bakes follow a changing sky (see {@link SceneryCaptureOptions}) */
  capture?: SceneryCaptureOptions;
  /** add a directional light from the sun, and from the moon at night. Default true */
  sunLight?: boolean;
  /** a moon opposite the sun, for some light at night (see {@link SkyMoon}). Default true */
  moon?: boolean | SkyMoon;
  /** stars at night, and with an `observer` the planets (see {@link SkyStars}). Default true */
  stars?: boolean | SkyStars;
  /** the air thinning with height, and hazing the far sea (see {@link SkyAir}). Default true */
  air?: boolean | SkyAir;
  /**
   * The output is tone mapped, so the sun disc may go past display white. Defaults to
   * the renderer's `toneMapping`; set it when a pipeline pass tone maps instead.
   */
  hdr?: boolean;
  /**
   * Default 1e9: the sky is drawn after the opaque scene, on the far plane with a depth
   * test, so only what nothing nearer covers is shaded; the background's other layers
   * after it, each at a fraction more (`SCENERY_LAYER_ORDER`), its sea's surface at the next
   * one. An opaque object that writes no depth is drawn over: make it `transparent`.
   */
  renderOrder?: number;
  /** debug views (see {@link SceneryDebug}) */
  debug?: SceneryDebug;
  /**
   * Told how far the scenery has come whenever that changes, for a progress display (see
   * `ProgressStore.source`): its `shaders` compiling, a run from when one is waited for until
   * all are done; once more with no items when the scenery goes away. A `GeoRelief` reports
   * its tiles loading on its own.
   */
  onProgress?: (report: ProgressReport) => void;
  /** the texts of its progress (see {@link SCENERY_PROGRESS_LABELS}) */
  progressLabels?: Partial<SceneryProgressLabels>;
  /**
   * What it holds: its features (`SceneryClouds`, `SceneryOcean`, `SceneryAbyss`,
   * `SceneryCutaway`), in any order and at any depth, and its stages and the scene, which
   * read its sun and sea (`useScenery`, `useSceneryOcean`).
   */
  children?: ReactNode;
};

// The ground's maps are compiled for a scene of their own, without lights: three keys a program
// on the lights of the scene it is compiled for (see precompile).
const GROUND_SCENE = new Scene();
const DEFAULT_ENVIRONMENT_RESOLUTION = 128;
const DEFAULT_CAPTURE_INTERVAL = 250;
// Seconds the scene's light probe takes to ease most of the way to a new bake: about as
// long as bakes come apart while the sky changes.
const PROBE_EASE = 0.15;
const DEFAULT_CAPTURE_MAX_WAIT = 1000;
// Roughness added to the sea's sun glint at the height of twilight (OceanMaterial.sunGlintSpread).
const SKY_TWILIGHT_GLINT_SPREAD = 0.08;
// The elevation of the light raking the void's lid from below, in degrees: level.
const ABYSS_LIGHT_ELEVATION = 0;
const DEFAULT_UP: Vec3 = [0, 1, 0];
const DEFAULT_NORTH: Vec3 = [0, 0, -1];

const scratch = new Color();
const lookScratch = new Vector3();
// The camera's point on the still sea, and its coordinates in its chart, for the foam's life;
// with the way it looks there, charted FOAM_AHEAD_STEP metres on (m).
const foamPoint = new Vector3();
const foamCoords = new Vector2();
const foamUp = new Vector3();
const foamLook = new Vector3();
const foamAheadCoords = new Vector2();
const FOAM_AHEAD_STEP = 100;
// Primitive dependency for a colour prop, so an inline `new Color()` does not re-bake every render.
const toHex = (value: ColorRepresentation) => scratch.set(value).getHex();

// Drawn while the sky's shaders compile: the void's gradient, whatever the sky is.
function createSceneryStandInMaterial(sky: SceneryMaterial) {
  return new ShaderMaterial({
    name: 'scenery-stand-in',
    vertexShader: skyVertexShader,
    fragmentShader: standInFragmentShader,
    uniforms: sky.uniforms,
    defines: { SKY_AT_FAR: '' },
    side: DoubleSide,
    depthWrite: false,
    fog: true,
  });
}

const NO_FEATURES: SceneryFeatures = {
  ocean: null,
  abyss: null,
  cutaway: null,
};

// Each layer mesh's own, for which compiles first (sceneryLayersShown).
const LAYER_DATA = {
  sky: { sceneryLayer: 'sky' },
  abyss: { sceneryLayer: 'abyss' },
  sea: { sceneryLayer: 'sea' },
  water: { sceneryLayer: 'water' },
};

/**
 * The world around the data: a procedural sky that shows where the horizon and the sun
 * are, and the light that comes from it — a directional sun light, an environment map and
 * a light probe, all from the same sky — and whatever else it holds: clouds that draw
 * themselves (`SceneryClouds`), an endless sea (`SceneryOcean`) with the void below it
 * (`SceneryAbyss`) and a cut through it (`SceneryCutaway`), and stages that draw the sea
 * and the relief on real geometry (`SceneryStage`). Each is drawn as a layer of its own and
 * compiled on its own (see `SceneryBackgroundLayer`), so a scenery without a sea compiles
 * none of it. Nothing else in the library depends on this component.
 *
 * The environment and light probe are baked once for each zone the camera can be in —
 * the air over the sea, the water in it and, below the seabed, the `subsurface` —
 * and swapped as the camera crosses a level, so a moving camera never bakes. They are
 * baked again when the scenery changes. In the water they dim with depth.
 * Children can read the sun with {@link useScenery}.
 *
 * ⚠️ With both `environment` and `lightProbe`, MeshStandard materials receive diffuse
 * sky light from each.
 *
 * @example
 * <Scenery sun={{ azimuth: 200, elevation: 35 }}>
 *   <SceneryClouds />
 *   <SceneryOcean depth={120} />
 * </Scenery>
 *
 * @group Components
 */
export const Scenery = ({
  sun,
  observer,
  colors,
  up,
  north,
  intensity = sceneryDefaults.intensity,
  horizonBlend = sceneryDefaults.horizonBlend,
  globe = sceneryDefaults.globe,
  background = true,
  environment = true,
  lightProbe = true,
  subsurface,
  capture,
  sunLight = true,
  moon = true,
  stars = true,
  air = true,
  hdr,
  renderOrder = 1e9,
  debug,
  onProgress,
  progressLabels,
  children,
}: SceneryProps) => {
  const gl = useThree(state => state.gl);
  const scene = useThree(state => state.scene);
  const sceneCamera = useThree(state => state.camera);

  // What its feature components hand it (see useSceneryFeature).
  const [features, setFeatures] = useState<SceneryFeatures>(NO_FEATURES);
  const setFeature = useCallback<SceneryRegistry['set']>(
    (feature, value) =>
      setFeatures(current =>
        current[feature] === value ? current : { ...current, [feature]: value },
      ),
    [],
  );
  const cutaway = features.cutaway;

  // Where the sky lies on the Earth: the World's frame. Its place is an observer's that gives
  // only a date.
  const world = useWorld();
  const worldRelief = useWorldRelief();
  const geoFrame = world?.frame ?? null;
  const geoPlace = useMemo(
    () => (geoFrame ? geoFrameLocation(geoFrame) : null),
    [geoFrame],
  );
  const located = observer && {
    date: observer.date,
    latitude: observer.latitude ?? geoPlace?.latitude,
    longitude: observer.longitude ?? geoPlace?.longitude,
  };
  // Primitives, so an observer object made each render recomputes nothing.
  const observing = skyObserverValid(located);
  const observedAt = observing ? located.date.getTime() : NaN;
  const observedLatitude = observing ? located.latitude : NaN;
  const observedLongitude = observing ? located.longitude : NaN;
  const ephemeris = useMemo(
    () =>
      Number.isFinite(observedAt)
        ? skyEphemeris(
            new Date(observedAt),
            observedLatitude,
            observedLongitude,
          )
        : null,
    [observedAt, observedLatitude, observedLongitude],
  );

  const azimuth =
    ephemeris?.sun.azimuth ?? sun?.azimuth ?? sceneryDefaults.sun.azimuth;
  const elevation =
    ephemeris?.sun.elevation ?? sun?.elevation ?? sceneryDefaults.sun.elevation;
  const sunIntensity = sun?.intensity ?? sceneryDefaults.sun.intensity;
  const sunSize = sun?.size ?? sceneryDefaults.sun.size;
  const sunGlow = sun?.glow ?? sceneryDefaults.sun.glow;
  const sunGlare = sun?.glare ?? sceneryDefaults.sun.glare;
  const sunRays = sun?.rays ?? sceneryDefaults.sun.rays;
  const sunShimmer = sun?.shimmer ?? sceneryDefaults.sun.shimmer;
  const sunTwilight = sun?.twilight ?? sceneryDefaults.sun.twilight;
  const moonOptions: SkyMoon | null = moon === true ? {} : moon || null;
  const hasMoon = moonOptions !== null;
  const moonDefaults = sceneryDefaults.moon;
  const moonIntensity = moonOptions?.intensity ?? moonDefaults.intensity;
  const moonHex = toHex(moonOptions?.color ?? moonDefaults.color);
  const moonColor = useMemo(() => new Color(moonHex), [moonHex]);
  const moonSize = moonOptions ? (moonOptions.size ?? moonDefaults.size) : 0;
  const moonGlow = moonOptions ? (moonOptions.glow ?? moonDefaults.glow) : 0;
  const starsOptions: SkyStars | null = stars === true ? {} : stars || null;
  const starBrightness = starsOptions
    ? (starsOptions.brightness ?? sceneryDefaults.stars.brightness)
    : 0;
  const starShare = skyStarShare(
    starsOptions?.density ?? sceneryDefaults.stars.density,
  );
  const starLatitude = starsOptions?.latitude ?? sceneryDefaults.stars.latitude;
  const zenith = toHex(colors?.zenith ?? sceneryDefaults.colors.zenith);
  const horizon = toHex(colors?.horizon ?? sceneryDefaults.colors.horizon);
  const ground = toHex(colors?.ground ?? sceneryDefaults.colors.ground);
  const nadir = toHex(colors?.nadir ?? sceneryDefaults.colors.nadir);
  const [upX, upY, upZ] = up ?? DEFAULT_UP;
  // On the Earth (a World's frame, or a stage's), compass north is true north at the frame's
  // origin: its map's grid north turned by the map's convergence there, as the globe's.
  const trueNorth = useMemo((): Vec3 | null => {
    if (!geoFrame || !geoPlace) return null;
    const { rotation } = placeGeoFrame(
      geoFrameAt(geoPlace.longitude, geoPlace.latitude),
      { projection: geoFrame.projection, origin: geoFrame.origin },
    );
    return [-Math.sin(rotation), 0, -Math.cos(rotation)];
  }, [geoFrame, geoPlace]);
  const [northX, northY, northZ] = north ?? trueNorth ?? DEFAULT_NORTH;

  const abyssOptions: SceneryAbyssProps | null = features.abyss;
  const hasAbyss = abyssOptions !== null;
  const abyssDefaults = sceneryDefaults.abyss;
  const abyssLevel = abyssOptions?.level ?? abyssDefaults.level;
  const abyssCeiling = toHex(
    abyssOptions?.colors?.ceiling ?? abyssDefaults.colors.ceiling,
  );
  const abyssHorizon = toHex(
    abyssOptions?.colors?.horizon ?? abyssDefaults.colors.horizon,
  );
  const abyssDepth = toHex(
    abyssOptions?.colors?.depth ?? abyssDefaults.colors.depth,
  );
  const abyssFadeDistance =
    abyssOptions?.fadeDistance ?? abyssDefaults.fadeDistance;
  const abyssTransition = abyssOptions?.transition ?? abyssDefaults.transition;
  const abyssDarkening = abyssOptions?.darkening ?? abyssDefaults.darkening;
  const abyssDetail = abyssOptions?.detail ?? abyssDefaults.detail;
  const abyssDetailScale =
    abyssOptions?.detailScale ?? abyssDefaults.detailScale;
  const abyssDepthDetail =
    abyssOptions?.depthDetail ?? abyssDefaults.depthDetail;
  const abyssDepthDetailScale =
    abyssOptions?.depthDetailScale ?? abyssDefaults.depthDetailScale;
  const abyssFalloff = abyssOptions?.falloff ?? abyssDefaults.falloff;
  // The void as a hollow in the crust about the field: on by default. Compared by value, as
  // the props are an inline object.
  const hollowKey = JSON.stringify(abyssOptions?.hollow ?? null);
  const hollowLook = useMemo(
    () => sceneryHollowLook(JSON.parse(hollowKey) ?? undefined),
    [hollowKey],
  );
  // Drawn at all; the void's gradient in the sky's place; the sky itself.
  const drawn = background !== false;
  const voided = background === 'void';
  const skyShown = background === true;

  const oceanOptions: SceneryOceanProps | null = features.ocean;
  const hasOcean = oceanOptions !== null;
  const oceanDefaults = sceneryDefaults.ocean;
  const oceanLevel = oceanOptions?.level ?? oceanDefaults.level;
  const airOptions: SkyAir | null = air === true ? {} : air || null;
  // What its air leaves out, the enclosing Weather's.
  const weatherAir = useWeather()?.air;
  const airScaleHeight = airOptions
    ? (airOptions.scaleHeight ?? sceneryDefaults.air.scaleHeight)
    : 0;
  const airVisibility = airOptions
    ? (airOptions.visibility ??
      weatherAir?.visibility ??
      sceneryDefaults.air.visibility)
    : 0;
  const airHaze =
    airOptions?.haze ?? weatherAir?.haze ?? sceneryDefaults.air.haze;
  const airHazeHeight =
    airOptions?.hazeHeight ??
    weatherAir?.hazeHeight ??
    sceneryDefaults.air.hazeHeight;
  // The air's ground: the sea's surface, or the void's lid.
  const airLevel = hasOcean ? oceanLevel : hasAbyss ? abyssLevel : 0;
  const oceanDepth = oceanOptions?.depth ?? oceanDefaults.depth;
  const oceanWater = oceanOptions?.water ?? true;
  const oceanSeabed = oceanOptions?.seabed !== false;
  const oceanSeabedOpacity = MathUtils.clamp(
    oceanOptions?.seabedOpacity ?? oceanDefaults.seabedOpacity,
    0,
    1,
  );
  const seabedOptions: ScenerySeabed | null =
    typeof oceanOptions?.seabed === 'object' ? oceanOptions.seabed : null;
  const bedDefaults = oceanDefaults.seabed;
  const bedColor = toHex(seabedOptions?.color ?? bedDefaults.color);
  const bedSpecular = toHex(seabedOptions?.specular ?? bedDefaults.specular);
  const bedShininess = seabedOptions?.shininess ?? bedDefaults.shininess;
  const bedAmbient = seabedOptions?.ambient ?? bedDefaults.ambient;
  const [bedAmbientUp, bedAmbientDown] = bedAmbient || [1, 1];
  const bedDetail =
    seabedOptions?.detail === false
      ? undefined
      : (seabedOptions?.detail ?? bedDefaults.detail);
  const oceanOptics = waterOpticsOf(oceanOptions?.optics, {
    deepColor: oceanOptions?.deepColor,
    bodyFogDensity: oceanOptions?.bodyFogDensity,
  });
  const oceanOpticsColor = oceanOptics.color;
  const oceanClarity = oceanOptics.clarity;

  const environmentOptions = environment === true ? {} : environment || null;
  const hasEnvironment = environmentOptions !== null;
  const environmentIntensity = environmentOptions?.intensity ?? 1;
  const environmentResolution =
    environmentOptions?.resolution ?? DEFAULT_ENVIRONMENT_RESOLUTION;

  const probeOptions = lightProbe === true ? {} : lightProbe || null;
  const hasProbe = probeOptions !== null;
  const probeIntensity = probeOptions?.intensity ?? 1;

  const [material] = useState(() => {
    // On the World's globe, inside one: what the World places, and the sky, lie on one Earth.
    const sky = new SceneryMaterial(undefined, world?.globe);
    // The bakes take the define, so they share its program, but not the depth test.
    sky.defines.SKY_AT_FAR = '';
    sky.depthTest = true;
    sky.name = 'scenery-sky';
    return sky;
  });
  // The ground under it, from its World's relief: how deep its sea is, what its clouds rise
  // over. Drawn into the sky's maps, so every material sharing the sky's uniforms reads them.
  const [sceneryGround] = useState(() => new SceneryGround(material.groundMap));
  // What draws itself in the sky (the 3D clouds), for the light: see ScenerySkyOverlay.
  const overlay = useRef<ScenerySkyOverlay | null>(null);
  const registry = useMemo<SceneryRegistry>(
    () => ({
      material,
      set: setFeature,
      view: { clouds: false, renderOrder: 0 },
      overlay,
      ground: sceneryGround,
    }),
    [material, setFeature, sceneryGround],
  );
  const [standIn] = useState(() => createSceneryStandInMaterial(material));
  const [geometry] = useState(createSceneryGeometry);
  const [baker] = useState(() => new SceneryBaker(material));
  // The hollow under the seabed: on with the void, unless turned off.
  const hollowOn = (hasAbyss || hasOcean) && hollowLook !== null;
  const hollowOpen = hollowOn && hasOcean && !oceanSeabed;
  const [hollow] = useState(() => new SceneryHollowParts(material));
  useEffect(() => () => hollow.dispose(), [hollow]);
  // The radius the rim grip left (SceneryHollow.handle), kept until `radius` changes.
  const hollowDragged = useRef<number | null>(null);
  const hollowRadius = () => hollowDragged.current ?? hollowLook?.radius ?? 0;
  const onHollowRadius = useRef<((radius: number) => void) | undefined>(
    undefined,
  );
  useLayoutEffect(() => {
    const given = abyssOptions?.hollow;
    onHollowRadius.current =
      typeof given === 'object' ? given.onRadiusChange : undefined;
  });
  const hollowGrip = useRef<SceneryHollowGrip | null>(null);
  useEffect(() => {
    if (!hollowGrip.current?.active) hollowDragged.current = null;
    if (hollowLook) material.hollowRadius = hollowRadius();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on a new radius
  }, [hollowLook?.radius]);
  const getThree = useThree(state => state.get);
  const hollowHandleOn = !!hollowLook?.handle && hollowOn;
  useEffect(() => {
    if (!hollowHandleOn) return;
    const grip = new SceneryHollowGrip(
      material.globe,
      gl.domElement,
      () => getThree().camera,
      {
        drop: radius => {
          hollowDragged.current = radius;
          material.hollowRadius = radius;
          onHollowRadius.current?.(radius);
        },
        reset: () => {
          const radius = sceneryDefaults.abyss.hollow.radius;
          hollowDragged.current = radius;
          material.hollowRadius = radius;
          onHollowRadius.current?.(radius);
        },
      },
    );
    hollowGrip.current = grip;
    scene.add(grip.object);
    return () => {
      scene.remove(grip.object);
      grip.dispose();
      hollowGrip.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the radius is read when used
  }, [hollowHandleOn, material, gl, scene, getThree]);
  // Uniforms only: nothing recompiles, and the bakes take the seabed whole, so nothing bakes.
  useLayoutEffect(() => {
    material.hollow = hollowOn;
    material.hollowOpen = hollowOpen;
    if (!hollowLook) return;
    material.hollowRadius = hollowDragged.current ?? hollowLook.radius;
    hollow.setLook(hollowLook);
  }, [material, hollow, hollowOn, hollowOpen, hollowLook]);
  const [probe] = useState(() => new LightProbe());
  const [lightTarget] = useState(() => new Object3D());
  // The sea's water: never drawn, the sky's sea shares its uniforms.
  const seaQuality = oceanOptions?.quality ?? 'medium';
  const water = useMemo(
    () => (hasOcean ? new OceanMaterial({ quality: seaQuality }) : null),
    [hasOcean, seaQuality],
  );

  useEffect(() => () => water?.dispose(), [water]);

  // For floating children, as in an `Ocean`: the waves they ride, and their contact foam.
  // Both in the waves' plane, true east and south at the field (skyOceanPlane), which a
  // projected grid turns from the scene's X and Z; read live, so it follows the frame.
  const wavePlane = useMemo<OceanPlane>(
    () => ({
      east: material.uniforms.uSkyEast.value,
      north: material.uniforms.uSkyNorth.value,
    }),
    [material],
  );
  const contacts = useMemo(createOceanContactRegistry, []);

  // In render rather than an effect, so a stage or layer made in this commit compiles with
  // it. A no-op unless a switch changed. The waves' defines likewise, for the sea's layers.
  material.oceanBedDetail = bedDetail;
  material.voidBackground = voided;
  material.ocean = hasOcean;
  // With a sea, the void lies below its seabed.
  material.abyss = hasAbyss || hasOcean;
  // Its Fresnel, glitter and whitecaps' life defines (OceanMaterial.fresnelPower, sparkle,
  // foamLife), so here too, before the switches are read.
  if (water) {
    water.fresnelPower = oceanOptions?.fresnelPower ?? null;
    water.sparkle = oceanOptions?.sparkle ?? null;
    water.foamLife = oceanOptions?.foamLife ?? null;
  }
  if (water) material.linkOcean(water);
  // What a stage and its relief compile with from the sky, as a key (SceneryOceanState).
  const definesKey = JSON.stringify(sceneryOceanDefines(material));

  // The background's layers over the sky, each with only the switches it needs.
  const abyssLayer = useSceneryLayerMaterial(
    material,
    'abyss',
    hasAbyss || hasOcean,
  );
  const seaLayer = useSceneryLayerMaterial(material, 'sea', hasOcean);
  const waterLayer = useSceneryLayerMaterial(material, 'water', hasOcean);
  const skyMesh = useRef<Mesh>(null);
  const abyssMesh = useRef<Mesh>(null);
  const seaMesh = useRef<Mesh>(null);
  const waterMesh = useRef<Mesh>(null);
  // Where the camera is, for which layers can show there (sceneryLayersShown).
  const cutawayWater = cutaway?.water ?? 0;
  const layerView = useCallback(
    (height: number, voidOpen: boolean): SceneryLayerView => ({
      height,
      ocean: material.ocean
        ? {
            level: material.oceanLevel,
            depth: material.oceanDepth,
            water: material.oceanWater,
            buried: material.oceanBuried,
            trench: material.oceanTrench,
          }
        : null,
      abyss: material.abyss
        ? { level: material.abyssLevel, transition: material.abyssTransition }
        : null,
      cutawayWater,
      voidOpen,
    }),
    [material, cutawayWater],
  );

  useEffect(
    () => () => {
      // Let go once their programs have linked (`releaseMaterial`): a Scenery mounted again
      // in their place takes them over rather than compiling them anew.
      releaseMaterial(gl, material);
      releaseMaterial(gl, standIn);
      geometry.dispose();
      baker.dispose(m => releaseMaterial(gl, m));
      sceneryGround.dispose(m => releaseMaterial(gl, m));
    },
    [gl, material, standIn, geometry, baker, sceneryGround],
  );

  // The ground from the World's relief, drawn once its program is compiled (in a scene of its
  // own, without lights: see precompile), and the scene's while this is mounted.
  const groundSource = worldRelief?.loader ?? null;
  useEffect(() => {
    sceneryGround.setSource(groundSource);
  }, [sceneryGround, groundSource]);
  const [groundReady, setGroundReady] = useState(false);
  useLayoutEffect(() => {
    const pending = precompile(
      gl,
      sceneryGround.generator,
      sceneCamera,
      GROUND_SCENE,
      'offscreen',
      { priority: PRECOMPILE_PRIORITY.background },
    );
    if (!pending) {
      setGroundReady(true);
      return;
    }
    let current = true;
    pending.then(() => {
      if (current) setGroundReady(true);
    });
    return () => {
      current = false;
    };
  }, [gl, sceneryGround, sceneCamera]);
  useEffect(() => {
    setSceneGroundMap(scene, sceneryGround.map, sceneryGround);
    return () => setSceneGroundMap(scene, null, sceneryGround);
  }, [scene, sceneryGround]);

  // The stand-in is drawn while the sky compiles, so it compiles first, ahead of the sky's
  // own, and is drawn once it has: drawn before, Chrome's GPU process waits for it behind
  // everything queued before it, freezing the browser.
  // What the sky reports to `onProgress`: its compiles and its stages' relief tiles.
  const reportRef = useRef(onProgress);
  const labelsRef = useRef(progressLabels);
  useEffect(() => {
    reportRef.current = onProgress;
    labelsRef.current = progressLabels;
  });
  const [progress] = useState(() =>
    createSceneryProgress(
      report => reportRef.current?.(report),
      () => ({ ...SCENERY_PROGRESS_LABELS, ...labelsRef.current }),
    ),
  );
  // Told again on mounting: a remount (React's strict mode) follows a report of none.
  useEffect(() => {
    progress.emit();
    return () => progress.close();
  }, [progress]);

  // The hollow's rock and cliffs, baked once their programs compile.
  useLayoutEffect(() => {
    hollow.makeTextures(gl, progress.compiles.track());
  }, [hollow, gl, progress]);

  const [standInReady, setStandInReady] = useState(false);
  useLayoutEffect(() => {
    const pending = precompile(
      gl,
      new Mesh(geometry, standIn),
      sceneCamera,
      scene,
      'scene',
      {
        priority: PRECOMPILE_PRIORITY.first,
        onProgress: progress.compiles.track(),
      },
    );
    if (!pending) {
      setStandInReady(true);
      return;
    }
    let current = true;
    pending.then(() => {
      if (current) setStandInReady(true);
    });
    return () => {
      current = false;
    };
  }, [gl, scene, sceneCamera, standIn, geometry, progress]);

  const state = useMemo<SceneryState>(() => {
    const frame = {
      up: [upX, upY, upZ] as Vec3,
      north: [northX, northY, northZ] as Vec3,
    };
    const sunDirection = new Vector3().fromArray(
      directionFromCompass(azimuth, elevation, frame),
    );
    const observed = ephemeris?.moon;
    return {
      sunDirection,
      sunColor: skySunColor(elevation),
      daylight: skyDaylight(elevation),
      twilight: skyTwilight(elevation),
      moonDirection: observed
        ? new Vector3().fromArray(
            directionFromCompass(observed.azimuth, observed.elevation, frame),
          )
        : sunDirection.clone().negate(),
      moonlight:
        skyMoonlight(elevation) * (observed ? skyMoonShine(observed) : 1),
      moonPhase: observed?.illumination ?? 1,
    };
  }, [azimuth, elevation, ephemeris, upX, upY, upZ, northX, northY, northZ]);
  const moonShine = ephemeris ? skyMoonShine(ephemeris.moon) : 1;

  // One directional light, so nothing recompiles at dusk: the sun's fades out by
  // twilight, and only then does the moon's fade in.
  const byMoon = moonOptions !== null && state.daylight <= 0;
  const lightDirection = byMoon ? state.moonDirection : state.sunDirection;
  const lightColor = byMoon ? moonColor : state.sunColor;
  const lightIntensity = byMoon
    ? moonIntensity * state.moonlight
    : sunIntensity * state.daylight;

  // Below the seabed, a steady light in place of the sun's and the moon's.
  const subsurfaceLight = subsurface?.light;
  const subsurfaceDefaults = sceneryDefaults.subsurface.light;
  const { azimuth: subsurfaceAzimuth, elevation: subsurfaceElevation } =
    scenerySubsurfaceLightPosition(azimuth, elevation, subsurfaceLight);
  const subsurfaceDirection = useMemo(
    () =>
      new Vector3().fromArray(
        directionFromCompass(subsurfaceAzimuth, subsurfaceElevation, {
          up: [upX, upY, upZ],
          north: [northX, northY, northZ],
        }),
      ),
    [
      subsurfaceAzimuth,
      subsurfaceElevation,
      upX,
      upY,
      upZ,
      northX,
      northY,
      northZ,
    ],
  );
  const subsurfaceHex = toHex(
    subsurfaceLight?.color ?? subsurfaceDefaults.color,
  );
  const subsurfaceColor = useMemo(
    () => new Color(subsurfaceHex),
    [subsurfaceHex],
  );
  const subsurfaceIntensity = subsurfaceLight?.intensity ?? sunIntensity;
  const subsurfaceTransition = Math.max(
    subsurfaceLight?.transition ?? subsurfaceDefaults.transition,
    0,
  );
  // The void's lid is raked by a light level at the subsurface light's bearing, so a relief's
  // underside shows its shape.
  const abyssLightDirection = useMemo(
    () =>
      new Vector3().fromArray(
        directionFromCompass(subsurfaceAzimuth, ABYSS_LIGHT_ELEVATION, {
          up: [upX, upY, upZ],
          north: [northX, northY, northZ],
        }),
      ),
    [subsurfaceAzimuth, upX, upY, upZ, northX, northY, northZ],
  );
  useLayoutEffect(() => {
    material.setAbyssLight(abyssLightDirection);
  }, [material, abyssLightDirection]);
  const light = useRef<DirectionalLight>(null);
  // 0 the sky's light, 1 the subsurface's; null until the first frame, which takes the zone's.
  const subsurfaceShare = useRef<number | null>(null);

  // Whether what the sky draws is compiled; until then the stand-in is drawn instead.
  const [ready, setReady] = useState(false);
  // Whether what its bakes draw with is compiled: compiled after what it draws.
  const [bakeReady, setBakeReady] = useState(false);
  // Stages hand over their parts, compiled with the sky's own (see SceneryOceanState.stage).
  const stages = useRef(new Set<Object3D>());
  const [stageVersion, setStageVersion] = useState(0);
  const addStage = useCallback((object: Object3D) => {
    stages.current.add(object);
    setStageVersion(version => version + 1);
    return () => {
      stages.current.delete(object);
      setStageVersion(version => version + 1);
    };
  }, []);

  // The relief tiles drawn, for layers lying on them: the World's, inside one.
  const ownReliefHub = useMemo(() => new SceneryReliefHub(), []);
  const reliefHub = worldRelief?.tiles ?? ownReliefHub;

  // The waves floating children ride (wavePlane above) shoal and break by the depth there, as
  // the drawn ones do by the scene's ground (its map is the GPU's alone): the relief's ground
  // under them where its tiles are in, else the sea's own depth.
  const sampler = useMemo(() => {
    if (!water || !oceanWater) return null;
    const point = new Vector3();
    const at = { latitude: 0, longitude: 0 };
    // The still water's depth under a world point on the sea.
    const depthUnder = (sea: Vector3) => {
      const earth = material.globe;
      if (!earth.frame) return oceanDepth;
      earth.geographic(sea, at);
      const height = reliefHub.current?.heightAt(at.longitude, at.latitude);
      return height == null ? oceanDepth : Math.max(-height, 0);
    };
    const depthAt = (x: number, z: number) =>
      depthUnder(point.set(x, oceanLevel, z));
    // Anywhere on the globe, in the charts the sea is drawn in: what floating objects placed
    // far off ride (useBuoyancy).
    return Object.assign(
      createOceanSampler(water, oceanLevel, wavePlane, depthAt),
      chartedSeaHeights({
        globe: material.globe,
        charts: material.oceanCharts,
        heightAt: (x, z, depth) =>
          water.seaState.heightAtDepth(x, z, depth, water.shoreBreakDepth),
        depthAt: depthUnder,
      }),
    );
  }, [
    water,
    oceanWater,
    oceanLevel,
    oceanDepth,
    wavePlane,
    material,
    reliefHub,
  ]);

  const oceanState = useMemo<SceneryOceanState | null>(
    () =>
      water
        ? {
            material,
            renderOrder,
            level: oceanLevel,
            depth: oceanDepth,
            water: oceanWater,
            seabed: oceanSeabed,
            seabedOpacity: oceanSeabedOpacity,
            hollow: hollowOn,
            definesKey,
            visible: drawn,
            ready,
            stage: addStage,
            reliefTiles: reliefHub,
          }
        : null,
    [
      water,
      material,
      renderOrder,
      oceanLevel,
      oceanDepth,
      oceanWater,
      oceanSeabed,
      oceanSeabedOpacity,
      hollowOn,
      definesKey,
      drawn,
      ready,
      addStage,
      reliefHub,
    ],
  );
  // The World's relief is shaded with this sky's sea.
  const provideSky = worldRelief?.provideSky;
  useLayoutEffect(
    () => (oceanState && provideSky ? provideSky(oceanState) : undefined),
    [oceanState, provideSky],
  );

  // Made with the sea's water; the seabed's detail, which it does not draw, leaves it be.
  const surfaceLayer = useMemo(
    () => (water ? createSceneryLayerMaterial(material, 'surface') : null),
    [water, material],
  );
  const surfaceMesh = useRef<Mesh>(null);

  useEffect(
    () => () => {
      if (surfaceLayer) releaseMaterial(gl, surfaceLayer);
    },
    [gl, surfaceLayer],
  );

  const dirty = useRef(true);
  // The version of what draws itself in the sky (overlay) the bakes were last due for.
  const overlayVersion = useRef(-1);
  // The subsurface's bakes owe nothing to the sky: they are due only when their own inputs change.
  const subsurfaceDirty = useRef(true);
  // The zones whose environment and light probe are due a bake; each zone's coefficients.
  const stale = useRef({
    environment: new Set<SceneryZone>(),
    probe: new Set<SceneryZone>(),
  });
  const zoneProbes = useRef<Partial<Record<SceneryZone, SphericalHarmonics3>>>(
    {},
  );
  const appliedProbe = useRef<SceneryZone | null>(null);
  const zoneInView = useRef<SceneryZone>('air');
  const [schedule] = useState(() => new SceneryBakeSchedule());
  // One readback at a time: they are slow to come back, and piled up they stall.
  const probeBusy = useRef(false);
  const captureInterval = capture?.interval ?? DEFAULT_CAPTURE_INTERVAL;
  const captureMaxWait = capture?.maxWait ?? DEFAULT_CAPTURE_MAX_WAIT;
  // The zones the camera can be in; the subsurface also lights an undrawn sky, and the
  // void's gradient everywhere, so then nothing else is baked.
  const zones = useMemo<SceneryZone[]>(
    () =>
      voided
        ? ['subsurface']
        : hasOcean && oceanWater
          ? ['air', 'water', 'subsurface']
          : ['air', 'subsurface'],
    [voided, hasOcean, oceanWater],
  );

  const subsurfaceMap = subsurface?.map ?? null;
  // The backdrop and the panels: the light is not baked.
  const panelsKey = JSON.stringify(
    subsurfaceMap
      ? null
      : [subsurface?.intensity, subsurface?.colors, subsurface?.panels],
  );
  useLayoutEffect(() => {
    baker.setSubsurface(
      subsurfaceMap
        ? { map: subsurfaceMap }
        : { light: scenerySubsurfaceColors(subsurface) },
    );
    subsurfaceDirty.current = true;
    // `subsurface` is an inline object: compared by value, as `panelsKey`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baker, material, subsurfaceMap, panelsKey]);

  // The subsurface's panels turn with the frame; what is baked, with the environment.
  useEffect(() => {
    subsurfaceDirty.current = true;
  }, [
    upX,
    upY,
    upZ,
    northX,
    northY,
    northZ,
    hasEnvironment,
    hasProbe,
    environmentResolution,
  ]);

  // Its program is small and compiles on its own, so its bakes light the scene first.
  const [subsurfaceReady, setSubsurfaceReady] = useState(false);
  useLayoutEffect(() => {
    const pending = baker.precompileSubsurface(
      gl,
      hasEnvironment ? environmentResolution : null,
      progress.compiles.track,
    );
    if (!pending) {
      setSubsurfaceReady(true);
      return;
    }
    let current = true;
    setSubsurfaceReady(false);
    pending.then(() => {
      if (current) setSubsurfaceReady(true);
    });
    return () => {
      current = false;
    };
  }, [gl, baker, hasEnvironment, environmentResolution, progress]);

  useLayoutEffect(() => {
    material.setFrame({
      up: [upX, upY, upZ],
      north: [northX, northY, northZ],
    });
    material.sunDirection = state.sunDirection;
    material.sunColor = state.sunColor;
    material.daylight = state.daylight;
    material.twilight = state.twilight;
    material.moonlight = state.moonlight;
    material.sunSize = sunSize;
    material.sunGlow = sunGlow;
    material.sunTwilight = sunTwilight;
    material.sunGlare = sunGlare;
    material.sunRays = sunRays;
    material.moonDirection = state.moonDirection;
    material.moonColor = moonColor;
    material.moonSize = moonSize;
    material.moonGlow = moonGlow;
    material.moonPhase = state.moonPhase;
    // Only an observer's moon can be up by day; the one opposite the sun never is.
    material.moonDay = ephemeris && hasMoon ? 1 : 0;
    material.night = 1 - state.daylight;
    material.setStars(starBrightness, starShare);
    const compass = {
      up: [upX, upY, upZ] as Vec3,
      north: [northX, northY, northZ] as Vec3,
    };
    material.setStarFrame(
      Number.isFinite(observedAt)
        ? skyCelestialFrame(
            new Date(observedAt),
            observedLatitude,
            observedLongitude,
            compass,
          )
        : skyStarFrame(azimuth, elevation, starLatitude, compass),
    );
    material.observed = !!ephemeris && starBrightness > 0;
    if (ephemeris) {
      material.setPlanets(
        ephemeris.planets.map(planet => ({
          direction: directionFromCompass(
            planet.azimuth,
            planet.elevation,
            compass,
          ),
          magnitude: planet.magnitude,
        })),
      );
    }
    material.setAir(
      airLevel,
      airScaleHeight,
      airVisibility,
      airHaze,
      airHazeHeight,
    );
    material.zenithColor = zenith;
    material.horizonColor = horizon;
    material.groundColor = ground;
    material.nadirColor = nadir;
    material.horizonBlend = horizonBlend;
    material.intensity = intensity;
    dirty.current = true;
  }, [
    material,
    state,
    upX,
    upY,
    upZ,
    northX,
    northY,
    northZ,
    sunSize,
    sunGlow,
    sunTwilight,
    sunGlare,
    sunRays,
    moonColor,
    moonSize,
    moonGlow,
    starBrightness,
    starShare,
    starLatitude,
    azimuth,
    elevation,
    ephemeris,
    hasMoon,
    observedAt,
    observedLatitude,
    observedLongitude,
    airLevel,
    airScaleHeight,
    airVisibility,
    airHaze,
    airHazeHeight,
    zenith,
    horizon,
    ground,
    nadir,
    horizonBlend,
    intensity,
  ]);

  useLayoutEffect(() => {
    material.abyss = hasAbyss || hasOcean;
    material.abyssLevel = hasOcean ? oceanLevel - oceanDepth : abyssLevel;
    // The hollow is all of the void there is: past its walls and under its floor, the rock is
    // black below the horizon, and the void's lid overhead recedes into black.
    material.abyssCeilingColor = abyssCeiling;
    material.abyssHorizonColor = hollowOn ? 0x000000 : abyssHorizon;
    material.abyssDepthColor = hollowOn ? 0x000000 : abyssDepth;
    material.abyssFadeDistance = abyssFadeDistance;
    material.abyssTransition = abyssTransition;
    material.abyssDarkening = abyssDarkening;
    material.abyssDetail = abyssDetail;
    material.abyssDetailScale = abyssDetailScale;
    material.abyssDepthDetail = abyssDepthDetail;
    material.abyssDepthDetailScale = abyssDepthDetailScale;
    material.abyssFalloff = abyssFalloff;
    dirty.current = true;
  }, [
    material,
    hasAbyss,
    hasOcean,
    oceanLevel,
    oceanDepth,
    abyssLevel,
    abyssCeiling,
    abyssHorizon,
    abyssDepth,
    abyssFadeDistance,
    abyssTransition,
    abyssDarkening,
    abyssDetail,
    abyssDetailScale,
    abyssDepthDetail,
    abyssDepthDetailScale,
    abyssFalloff,
    hollowOn,
  ]);

  // Not baked: the bakes keep a level horizon. Inside a World, the World's `globe` says.
  const inWorld = world !== null;
  useLayoutEffect(() => {
    if (!inWorld) material.globeEnabled = globe;
  }, [material, globe, inWorld]);

  // Without a World, the sky's own globe lies on the Earth where a stage says (a World sets
  // its own globe's frame).
  useLayoutEffect(() => {
    if (inWorld || !geoFrame) return;
    material.globe.setFrame(geoFrame);
    return () => material.globe.setFrame(null);
  }, [material, geoFrame, inWorld]);

  useLayoutEffect(() => {
    if (water) material.linkOcean(water);
    material.ocean = water !== null;
    material.oceanLevel = oceanLevel;
    material.oceanDepth = oceanDepth;
    material.oceanBedColor = bedColor;
    material.oceanBedSpecular = bedSpecular;
    material.oceanBedShininess = bedShininess;
    material.oceanBedAmbient = [bedAmbientUp, bedAmbientDown];
    // A dry seabed is lit as if no water lay over it.
    material.oceanOptics = oceanWater
      ? { color: oceanOpticsColor, clarity: oceanClarity }
      : null;
    material.oceanWater = oceanWater;
    material.oceanSeabed = oceanSeabed;
    material.oceanSeabedOpacity = oceanSeabedOpacity;
    dirty.current = true;
  }, [
    material,
    water,
    oceanLevel,
    oceanDepth,
    bedColor,
    bedSpecular,
    bedShininess,
    bedAmbientUp,
    bedAmbientDown,
    oceanOpticsColor,
    oceanClarity,
    oceanWater,
    oceanSeabed,
    oceanSeabedOpacity,
  ]);

  // Its own wind and swells where given, the enclosing Weather's for what it leaves out: in
  // the wave plane, true east and south, as the default compass frame's X and Z.
  const {
    windSpeed: seaWindSpeed,
    windDirection: seaWindDirection,
    gusts: seaGusts,
    swells: seaSwells,
  } = useWeatherOceanWind(
    oceanOptions?.windSpeed,
    oceanOptions?.windDirection,
    oceanOptions?.gusts,
    oceanOptions?.swells,
  );
  // Leaving its waves to the weather, it draws the weather's sea.
  useWeatherOceanSea(water, {
    windSpeed: oceanOptions?.windSpeed,
    windDirection: oceanOptions?.windDirection,
    swells: oceanOptions?.swells,
    amplitude: oceanOptions?.amplitude,
    waveTuning: oceanOptions?.waveTuning,
  });

  // Every render: the props are an inline object, and applying them is cheap.
  useLayoutEffect(() => {
    if (!water || !oceanOptions) return;
    applyOceanWaterProps(water, {
      ...oceanOptions,
      windSpeed: seaWindSpeed,
      windDirection: seaWindDirection,
      gusts: seaGusts,
      swells: seaSwells,
    });
  });

  // The bakes see the water too, but an inline object is new every render. Not the seabed's
  // opacity: the bakes take the seabed whole.
  const waterKey = oceanOptions
    ? JSON.stringify({
        ...oceanOptions,
        windSpeed: seaWindSpeed,
        windDirection: seaWindDirection,
        seabedOpacity: undefined,
      })
    : '';
  useEffect(() => {
    dirty.current = true;
  }, [waterKey]);

  // The glint's colour is set each frame, with the light the sky's clouds let through.
  // A low sun lays a broad glitter path.
  const glintSpread = SKY_TWILIGHT_GLINT_SPREAD * state.twilight * sunTwilight;
  useLayoutEffect(() => {
    if (!water) return;
    water.sunDirection = lightDirection;
    water.sunGlintSpread = glintSpread;
  }, [water, lightDirection, glintSpread]);

  // The sky the scene's other seas reflect (an `Ocean`'s, a `ChunkStack`'s: sceneSky),
  // written each frame as its own sea's.
  const [publishedSky] = useState(() => ({
    direction: new Vector3(),
    color: new Color(),
    glintSpread: 0,
  }));
  const skySource = useRef<SceneSkySource | null>(null);
  useLayoutEffect(() => {
    const sky = sceneSky(scene);
    const source = sky.claim(material);
    source.sun = publishedSky;
    skySource.current = source;
    return () => {
      sky.release(material);
      skySource.current = null;
    };
  }, [scene, material, publishedSky]);

  useEffect(() => {
    dirty.current = true;
  }, [
    hasEnvironment,
    hasProbe,
    environmentResolution,
    sunLight,
    lightIntensity,
    lightColor,
    probeIntensity,
    zones,
  ]);

  // Hand back whatever environment the host had before.
  useEffect(() => {
    if (!hasEnvironment) return;
    const previous = scene.environment;
    const previousIntensity = scene.environmentIntensity;
    return () => {
      scene.environment = previous;
      scene.environmentIntensity = previousIntensity;
    };
  }, [scene, hasEnvironment]);

  // Not a bake: the bakes override it.
  const debugTint = debug?.tint === true;
  useLayoutEffect(() => {
    material.debugTint = debugTint;
  }, [material, debugTint]);

  const environmentCube = useCallback(
    () => baker.cubeOf(zoneInView.current),
    [baker],
  );
  // What lights a bake's seabed: the light probe of its own zone.
  const [bakeProbe] = useState(() => new LightProbe());

  // After the effects above set the defines: anything new compiles in the background while
  // the stand-in is drawn, and the bakes wait for theirs, compiled after it.
  const own = useRef<Group>(null);
  const compiling = useRef('');
  useLayoutEffect(() => {
    const group = own.current;
    if (!group) return;
    const resolution = hasEnvironment ? environmentResolution : null;
    const layers = [abyssLayer, seaLayer, waterLayer, surfaceLayer];
    const key = [
      JSON.stringify(material.defines),
      JSON.stringify(material.switches),
      layers.map(layer => layer?.uuid ?? '').join(','),
      surfaceLayer !== null && oceanWater,
      stageVersion,
      resolution,
      sunLight,
      hasProbe,
      hollowOn,
    ].join('|');
    if (key === compiling.current) return;
    compiling.current = key;
    // Which lights the bakes have is compiled in; their values are not.
    baker.setLights(
      sunLight
        ? {
            direction: lightDirection,
            color: lightColor,
            intensity: lightIntensity,
          }
        : null,
      hasProbe ? bakeProbe : null,
    );
    // What is drawn first, then what only bakes: without a RenderingPipeline the bakes
    // draw with copies of the background's programs, which wait behind it. Of the
    // background's layers, those the camera's zone draws first, the others after them.
    const now = sceneryLayersShown(
      layerView(material.heightOf(sceneCamera.position), false),
    );
    const soon = (root: Object3D) => {
      const layer = root.userData.sceneryLayer as
        | keyof ReturnType<typeof sceneryLayersShown>
        | undefined;
      return layer === undefined || now[layer];
    };
    const shown = [...group.children, ...stages.current]
      .map(root =>
        precompile(gl, root, sceneCamera, scene, 'scene', {
          priority: soon(root)
            ? PRECOMPILE_PRIORITY.background
            : PRECOMPILE_PRIORITY.later,
          onProgress: progress.compiles.track(),
        }),
      )
      .filter(wait => wait !== null);
    const bakes = baker.precompile(gl, progress.compiles.track());
    setReady(shown.length === 0);
    setBakeReady(bakes === null);
    if (shown.length > 0)
      Promise.all(shown).then(() => {
        if (compiling.current === key) setReady(true);
      });
    bakes?.then(() => {
      if (compiling.current === key) setBakeReady(true);
    });
    // The defines are read from the material: the props that set them are deps too.
  }, [
    gl,
    scene,
    sceneCamera,
    material,
    baker,
    bakeProbe,
    abyssLayer,
    seaLayer,
    waterLayer,
    surfaceLayer,
    layerView,
    oceanWater,
    stageVersion,
    hasEnvironment,
    environmentResolution,
    sunLight,
    hasProbe,
    lightDirection,
    lightColor,
    lightIntensity,
    water,
    hasAbyss,
    hasOcean,
    definesKey,
    voided,
    progress,
    hollowOn,
  ]);

  // The scene's water (sceneWaterBody), for what lies in the sea wherever it is in the tree:
  // the sea's level along up, its seabed's depth, its look and the daylight. Everywhere: the
  // sea has no edge. Let go of when the Scenery goes.
  useEffect(() => {
    const sceneWater = sceneWaterBody(scene);
    return () => sceneWater.release(material);
  }, [scene, material]);

  // Where the camera is under this sky (the camera site's, `CAMERA_PROBE_ORDER.sky`): its
  // height and altitude over the sea; the ground of the relief this sky shades under it, and
  // from that whether it is in the ground (the void's lid over it) or in a trench; how far
  // inside the hollow's rim; and its sea's water. The latest closure, as the hollow's radius
  // is read through refs.
  const skyProbeLatest = useRef<CameraProbe | null>(null);
  useLayoutEffect(() => {
    skyProbeLatest.current = site => {
      const height = material.heightOf(site.position);
      const level = material.oceanLevel;
      site.height = height;
      site.seaLevel = level;
      site.altitude = height - level;
      const under = skyGroundOf(site);
      const bed = level - material.oceanDepth;
      // Under the relief's ground above the sea's own seabed, as from inside rock: below the
      // sea or in land above it.
      site.buried =
        material.ocean && under !== null && height <= under && height > bed;
      // Over the relief's ground below the sea's own seabed, as in a trench: in the water, or
      // over a dry sea's bed in the air.
      site.trench =
        material.ocean && under !== null && height > under && height <= bed;
      site.lid = sceneryLidOverCamera(height, {
        ocean: material.ocean,
        oceanLevel: level,
        oceanDepth: material.oceanDepth,
        oceanGround: under,
      });
      // How far inside the hollow's rim: its walls about the camera and its lid over it, at
      // any depth; under its floor, seen through the rock.
      site.hollow =
        hollowLook && hollowOn
          ? sceneryHollowInside(
              material.globe,
              hollowRadius(),
              site.position,
              // The simple style's rim is round.
              hollowLook.style === 'simple' ? 1 : undefined,
            )
          : -Infinity;
      // Its sea has no edge: under it, over the ground (or the seabed) under it, is in it.
      if (material.ocean && material.oceanWater) {
        const floor = under ?? bed;
        reportCameraWater(site, {
          depth: level - height,
          over: true,
          inside: height < level && height > floor,
          owner: material,
          endless: true,
        });
      }
    };
  });
  // The relief's ground under the camera, while the relief this sky shades is drawn.
  const skyGroundOf = (site: CameraSite) =>
    worldRelief?.present && worldRelief.sky === oceanState ? site.ground : null;
  const skyProbe = useCallback<CameraProbe>(
    (site, probeCamera) => skyProbeLatest.current?.(site, probeCamera),
    [],
  );
  const cameraSite = useCameraProbe(skyProbe, CAMERA_PROBE_ORDER.sky);

  // Bakes run here so several prop changes in one frame cost one bake.
  const step = useWeatherStep();
  useFrame(({ camera }, delta) => {
    const sceneWater = sceneWaterBody(scene);
    const seaUp = material.up;
    sceneWater.up = [seaUp.x, seaUp.y, seaUp.z];
    sceneWater.level = material.oceanLevel;
    sceneWater.depth = material.oceanDepth;
    sceneWater.daylight = material.daylight;
    sceneWater.extent = null;
    sceneWater.optics =
      water && oceanWater
        ? { color: oceanOpticsColor, clarity: oceanClarity }
        : null;
    if (sceneWater.owner !== material) {
      sceneWater.setBed(null);
      sceneWater.owner = material;
    }
    // Its ground: drawn as it comes in and asked for about the camera as it moves; the sea's
    // seabed where it covers.
    if (groundReady) sceneryGround.update(gl, material.globe, camera.position);
    sceneWater.setGround(sceneryGround.map, 1, material.oceanLevel);
    // The waves at the enclosing Weather's pace.
    const waveStep = step(delta);
    if (water) {
      // Its waves on the weather's clock while it draws the weather's sea.
      water.step(waveStep);
      // Before the sky draws the sea: its layers for this frame, but those too fine to show
      // from the camera's altitude over it; and the whitecaps' life about the camera, in the
      // chart every pixel takes (none while a line where two meet is in view), ahead of it the
      // way it looks: the level part of its look, as the chart has it a short way on.
      const charts = material.oceanCharts;
      let foamAt: Vector2 | null = null;
      let foamAhead: Vector2 | null = null;
      if ((charts.uniforms.uOceanChartOnly.value as number) >= 0) {
        const earth = material.globe;
        const stillUp = earth.upAt(camera.position, foamUp);
        const still = foamPoint
          .copy(stillUp)
          .multiplyScalar(-earth.altitude(camera.position))
          .add(camera.position);
        const chart = charts.chartAt(still).chart;
        foamAt = charts.coords(chart, still, foamCoords);
        const look = camera.getWorldDirection(foamLook);
        look.addScaledVector(stillUp, -look.dot(stillUp));
        const on = charts.coords(
          chart,
          look.multiplyScalar(FOAM_AHEAD_STEP).add(still),
          foamAheadCoords,
        );
        foamAhead = on.sub(foamAt).divideScalar(FOAM_AHEAD_STEP);
      }
      water.renderWaves(
        gl,
        camera,
        material.heightOf(camera.position) - material.oceanLevel,
        foamAt,
        foamAhead,
      );
      contacts.upload(water, { plane: wavePlane, from: camera.position });
    }
    // What draws itself in the sky (the 3D clouds): in the air's bakes, which are due again
    // as it changes; in the sea's reflection; and the share of the light it lets through.
    const skyOverlay = overlay.current;
    baker.setOverlay(skyOverlay);
    material.oceanClouds = skyOverlay?.texture ?? null;
    material.setOceanCloudReflection(skyOverlay?.reflection ?? null);
    const overlayKey = skyOverlay ? skyOverlay.version : -1;
    if (overlayKey !== overlayVersion.current) {
      overlayVersion.current = overlayKey;
      dirty.current = true;
    }
    const lightThrough = skyOverlay ? skyOverlay.light : 1;
    // The glint goes with the light, as the sky does.
    publishedSky.color
      .copy(lightColor)
      .multiplyScalar(
        (lightIntensity / Math.max(sunIntensity, 1e-6)) * lightThrough,
      );
    if (water) water.sunColor.copy(publishedSky.color);
    const published = skySource.current;
    if (published) {
      published.environment = hasEnvironment
        ? baker.environmentOf('air')
        : null;
      published.intensity = environmentIntensity;
      published.clouds = skyOverlay?.texture ?? null;
      published.cloudBase = skyOverlay?.reflection.base ?? 0;
      publishedSky.direction.copy(lightDirection);
      publishedSky.glintSpread = glintSpread;
    }
    if (sunShimmer && sunRays > 0) material.sunRayPhase += delta;
    material.sunRadiance =
      (hdr ?? gl.toneMapping !== NoToneMapping) ? SKY_HDR_SUN_RADIANCE : 1;

    // Where the camera is (the camera site's, worked out once a frame): its altitude over the
    // globe along up as it is measured over the field, the relief's ground under it (the void
    // starts under it, at whatever depth), in it or in a trench, and inside the hollow.
    const site = cameraSite.get(camera);
    const height = site.height ?? material.heightOf(camera.position);
    // Camera controls move the camera before this runs but leave its matrices to the render:
    // read with this frame's position, last frame's would swing the cutaway as it moves.
    if (cutaway) camera.updateMatrixWorld();
    material.oceanGround = skyGroundOf(site);
    material.oceanBuried = site.buried;
    material.oceanTrench = site.trench;
    const cameraInside = site.hollow;
    const inHollow = !!hollowLook && cameraInside > 0;
    // From the sea surface down the layer is clear everywhere (skyOceanSurfaceLayer), and
    // in rock there is no sea to see.
    if (surfaceMesh.current)
      surfaceMesh.current.visible =
        drawn &&
        ready &&
        !debug?.hide?.includes('surface') &&
        height > material.oceanLevel &&
        !material.oceanBuried;
    // The sky's own light where the camera is: by the sun over the level it sees the sky by
    // (Globe.lookUp), the field's over the field. From high up, over the horizon the
    // Earth's curve lowers. The scene's lights and the bakes stay the field's.
    const look = material.globe.lookUp(camera.position, lookScratch);
    const seen = look.equals(material.globe.up)
      ? null
      : MathUtils.radToDeg(
          Math.asin(MathUtils.clamp(look.dot(material.sunDirection), -1, 1)),
        );
    material.setSeenSun(seen, moonShine);
    const airHeight = height - airLevel;
    const earth = material.globe.radius;
    const dip =
      material.globeEnabled && airHeight > 0
        ? Math.acos(earth / (earth + airHeight))
        : 0;
    material.setAirLight(seen ?? elevation, dip, moonShine);
    const zone = sceneryZone(height, {
      ocean: material.ocean,
      oceanLevel: material.oceanLevel,
      oceanDepth: material.oceanDepth,
      oceanWater: material.oceanWater,
      oceanGround: material.oceanGround,
      cutaway: cutawayWater > 0,
      abyss: material.abyss,
      abyssLevel: material.abyssLevel,
      background: skyShown,
    });
    zoneInView.current = zone;

    // The subsurface's own light below the seabed, eased into over `transition`.
    const below = zone === 'subsurface' ? 1 : 0;
    let share = subsurfaceShare.current ?? below;
    if (subsurfaceTransition > 0) {
      const ease = delta / subsurfaceTransition;
      share =
        share < below
          ? Math.min(share + ease, below)
          : Math.max(share - ease, below);
    } else {
      share = below;
    }
    subsurfaceShare.current = share;
    const toSubsurface = share * share * (3 - 2 * share);
    if (light.current) {
      const t = toSubsurface;
      light.current.position.copy(lightDirection).lerp(subsurfaceDirection, t);
      light.current.color.copy(lightColor).lerp(subsurfaceColor, t);
      // The sky's light, as much as its clouds let through; the subsurface's is its own.
      light.current.intensity = MathUtils.lerp(
        lightIntensity * lightThrough,
        subsurfaceIntensity,
        t,
      );
    }
    // Where the sea and the relief read the clouds' shadows, their share of the light there
    // in place of the share it was dimmed to: the sky's light's, not the subsurface's.
    material.setCloudShadow(
      skyOverlay?.shadow ?? null,
      lightThrough,
      skyOverlay && sunLight ? 1 - toSubsurface : 0,
    );

    // The cutaway's own work (SceneryCutaway), by this frame's height, zone and matrices.
    // Without one nothing is cut.
    let cutsSeabed = false;
    if (cutaway) cutsSeabed = cutaway.frame(camera, delta, height, zone);
    else {
      (material.uniforms.uSkyOceanCutawayShape.value as Vector3).y = 0;
      (material.uniforms.uSkyOceanCutawayGrip.value as Vector2).x = 0;
    }

    // Whether the void can show from above the lid, as through this frame's cutaway.
    const voidOpen = material.abyssOpenFromAbove(cutsSeabed);

    // The background's layers where they can show from here; each draws nothing elsewhere.
    const shown = sceneryLayersShown(layerView(height, voidOpen));
    const showLayer = (mesh: Mesh | null, layer: keyof typeof shown) => {
      if (mesh)
        mesh.visible =
          drawn &&
          ready &&
          shown[layer] &&
          !debug?.hide?.includes(layer) &&
          !debug?.hide?.includes('background');
    };
    showLayer(skyMesh.current, 'sky');
    showLayer(abyssMesh.current, 'abyss');
    // The hollow, where it can show: through an opening in the seabed, or from below it inside
    // its rim. Below it outside the rim the camera is in solid crust: the void's own layer.
    if (hollowLook) {
      hollow.update({
        radius: hollowRadius(),
        floorDepth: hollowLook.floorDepth,
        bed: material.abyssLevel - material.globe.level,
        simple: hollowLook.style === 'simple',
      });
      const belowBed = height < material.abyssLevel || material.oceanBuried;
      const hollowShown =
        hollowOn &&
        drawn &&
        ready &&
        hollow.ready &&
        (voidOpen || belowBed) &&
        (inHollow || !belowBed) &&
        !debug?.hide?.includes('abyss') &&
        !debug?.hide?.includes('background');
      hollow.floor.visible = hollowShown;
      hollow.walls.visible = hollowShown;
      if (hollowShown) hollow.cull(camera);
      // The rim grips over the open hollow, seen from over the seabed.
      hollowGrip.current?.update(
        hollowRadius(),
        sceneryHollowRadiusRange(hollowLook.floorDepth),
        hollowShown && voidOpen && !belowBed,
      );
      hollow.setView(
        inHollow,
        !voidOpen || belowBed,
        hollowOpen
          ? sceneryHollowAirGone(
              cameraInside,
              hollowRadius(),
              height - material.globe.level,
              hollowLook.air,
            )
          : 0,
        material.abyssLevel - hollowLook.floorDepth - height,
        delta,
      );
      hollow.setOrder(renderOrder);
    } else {
      hollow.floor.visible = false;
      hollow.walls.visible = false;
    }
    showLayer(seaMesh.current, 'sea');
    showLayer(waterMesh.current, 'water');
    // For the clouds, which draw themselves (SceneryClouds): where the sky shows.
    registry.view.renderOrder = renderOrder;
    registry.view.clouds =
      drawn &&
      ready &&
      !voided &&
      shown.sky &&
      !debug?.hide?.includes('clouds') &&
      !debug?.hide?.includes('background');

    const { environment: environmentDue, probe: probeDue } = stale.current;
    const now = performance.now();
    if (dirty.current || subsurfaceDirty.current) schedule.change(now);
    for (const z of zones) {
      const changed =
        z === 'subsurface' ? subsurfaceDirty.current : dirty.current;
      if (!changed) continue;
      if (hasEnvironment) environmentDue.add(z);
      if (hasProbe) probeDue.add(z);
    }
    dirty.current = false;
    subsurfaceDirty.current = false;

    const next = schedule.next(
      now,
      zones,
      zone,
      z =>
        environmentDue.has(z)
          ? 'due'
          : probeDue.has(z)
            ? probeBusy.current
              ? 'blocked'
              : 'due'
            : 'none',
      { sky: bakeReady, subsurface: subsurfaceReady },
      captureInterval,
      captureMaxWait,
    );
    if (next) {
      const nextProbe = zoneProbes.current[next];
      // There without coefficients too: its light is compiled into the bakes' programs.
      if (nextProbe) bakeProbe.sh.copy(nextProbe);
      else bakeProbe.sh.zero();
      bakeProbe.intensity = probeIntensity;
      baker.setLights(
        sunLight
          ? {
              direction: lightDirection,
              color: lightColor,
              intensity: lightIntensity * lightThrough,
            }
          : null,
        hasProbe ? bakeProbe : null,
      );
      if (environmentDue.delete(next)) {
        baker.environment(gl, next, environmentResolution);
      }
      if (!probeBusy.current && probeDue.delete(next)) {
        probeBusy.current = true;
        baker
          .lightProbe(gl, next)
          .then(sh => {
            if (!sh) return;
            // The first lit the zone's seabed without a probe: once more, with this one.
            if (next !== 'subsurface' && !zoneProbes.current[next]) {
              if (hasEnvironment) environmentDue.add(next);
              probeDue.add(next);
              schedule.change(performance.now());
            }
            zoneProbes.current[next] = sh;
          })
          .finally(() => {
            probeBusy.current = false;
          });
      }
    }

    // The zone's bakes, swapped in as the camera crosses a level: no GPU work. Until it has
    // its own, the subsurface's light the scene.
    const dim =
      zone === 'water'
        ? sceneryWaterDimming(
            material.oceanLevel - height,
            material.oceanFogDensity,
          )
        : 1;
    if (hasEnvironment) {
      const map =
        baker.environmentOf(zone) ?? baker.environmentOf('subsurface');
      if (map && scene.environment !== map) scene.environment = map;
      scene.environmentIntensity = environmentIntensity * dim;
    }
    const probeZone = zoneProbes.current[zone] ? zone : 'subsurface';
    const zoneProbe = zoneProbes.current[probeZone];
    if (zoneProbe) {
      // Eased toward each new bake of the zone, so a moving sun does not step the light; a
      // zone's first, or another zone's, at once.
      if (appliedProbe.current !== probeZone) {
        probe.sh.copy(zoneProbe);
        appliedProbe.current = probeZone;
      } else {
        probe.sh.lerp(zoneProbe, 1 - Math.exp(-delta / PROBE_EASE));
      }
    }
    probe.intensity = probeIntensity * dim;
  });

  return (
    <SceneryContext.Provider value={state}>
      <group ref={own}>
        {/* The background's layers, in order (scenery-layers.ts). Shown each frame. */}
        <mesh
          ref={skyMesh}
          geometry={geometry}
          material={material}
          frustumCulled={false}
          renderOrder={renderOrder + SCENERY_LAYER_ORDER.sky}
          visible={false}
          userData={LAYER_DATA.sky}
          onBeforeRender={material.onBeforeDraw}
          dispose={null}
        />
        {abyssLayer && (
          <mesh
            ref={abyssMesh}
            geometry={geometry}
            material={abyssLayer}
            frustumCulled={false}
            renderOrder={renderOrder + SCENERY_LAYER_ORDER.abyss}
            visible={false}
            userData={LAYER_DATA.abyss}
            onBeforeRender={material.onBeforeDraw}
            dispose={null}
          />
        )}
        {/* The hollow under the seabed, just before the background, which skips it by depth. */}
        {hollowOn && (
          <>
            <primitive object={hollow.walls} dispose={null} />
            <primitive object={hollow.floor} dispose={null} />
          </>
        )}
        {seaLayer && (
          <mesh
            ref={seaMesh}
            geometry={geometry}
            material={seaLayer}
            frustumCulled={false}
            renderOrder={renderOrder + SCENERY_LAYER_ORDER.sea}
            visible={false}
            userData={LAYER_DATA.sea}
            onBeforeRender={material.onBeforeDraw}
            dispose={null}
          />
        )}
        {waterLayer && (
          <mesh
            ref={waterMesh}
            geometry={geometry}
            material={waterLayer}
            frustumCulled={false}
            renderOrder={renderOrder + SCENERY_LAYER_ORDER.water}
            visible={false}
            userData={LAYER_DATA.water}
            onBeforeRender={material.onBeforeDraw}
            dispose={null}
          />
        )}
        {surfaceLayer && oceanWater && (
          <mesh
            ref={surfaceMesh}
            geometry={geometry}
            material={surfaceLayer}
            frustumCulled={false}
            renderOrder={renderOrder + SCENERY_LAYER_ORDER.surface}
            // Shown each frame.
            visible={false}
            onBeforeRender={material.onBeforeDraw}
            dispose={null}
          />
        )}
      </group>
      <mesh
        geometry={geometry}
        material={standIn}
        frustumCulled={false}
        renderOrder={renderOrder}
        visible={drawn && !ready && standInReady}
        dispose={null}
      />
      {hasProbe && <primitive object={probe} />}
      {sunLight && (
        <>
          {/* Set each frame: the sky's light, or below the seabed the subsurface's. */}
          <directionalLight ref={light} target={lightTarget} />
          <primitive object={lightTarget} />
        </>
      )}
      <SceneryOceanContext.Provider value={oceanState}>
        <OceanSamplerContext.Provider value={sampler}>
          <OceanContactContext.Provider value={sampler && contacts}>
            <SceneryRegistryContext.Provider value={registry}>
              {children}
            </SceneryRegistryContext.Provider>
          </OceanContactContext.Provider>
        </OceanSamplerContext.Provider>
      </SceneryOceanContext.Provider>
      {debug?.environment && <SceneryCubeView cube={environmentCube} />}
    </SceneryContext.Provider>
  );
};
