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
  ShaderMaterial,
  SphericalHarmonics3,
  Vector2,
  Vector3,
} from 'three';
import { precompile, PRECOMPILE_PRIORITY } from '../../rendering/precompile';
import {
  graticuleDegreesPerPixel,
  type GraticuleStyle,
} from '../../sdk/materials/graticule';
import {
  type GeoFrame,
  geoFrameAt,
  geoFrameLocation,
  placeGeoFrame,
} from '../../sdk/projection/geo-frame';
import { Vec3 } from '../../sdk/types/common';
import { directionFromCompass } from '../../sdk/utils/vector-operations';
import { OceanMaterial } from '../Ocean/ocean-material';
import { applyOceanWaterProps } from '../Ocean/ocean-material-sync';
import { useWorld } from '../World/world-context';
import type { ProgressReport } from '../Progress/progress-store';
import {
  createOceanContactRegistry,
  OceanContactContext,
} from '../Ocean/ocean-contact';
import {
  createOceanSampler,
  OceanSamplerContext,
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
} from './scenery-registry';
import { createSceneryGeometry, SceneryMaterial } from './scenery-material';
import { sceneryOceanDefines } from './scenery-stage';
import {
  SKY_HDR_SUN_RADIANCE,
  SceneryAbyssProps,
  SkyAir,
  SceneryCloudsProps,
  SceneryGraticuleLabels,
  SceneryGraticuleLatLon,
  SceneryGraticuleProps,
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
} from './scenery-model';
import { bakeSkyCliffs } from './scenery-cliffs';
import {
  SceneryAbyssWallFrame,
  SceneryAbyssWallLayer,
} from './SceneryAbyssWallLayer';
import { SceneryCubeView } from './SceneryCubeView';
import { SceneryGraticuleLabelLayer } from './SceneryGraticuleLabels';

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
 * the sky itself, its clouds, the void, the sea seen from the air, the view from in the
 * water, the sea's surface), all of them at once (`background`), and its void's walls' mesh.
 */
export type SceneryLayer =
  | 'background'
  | 'sky'
  | 'clouds'
  | 'abyss'
  | 'sea'
  | 'water'
  | 'surface'
  | 'walls';

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
  /** the void's walls' mesh: its triangles drawn as lines in one colour (`wireframe`); shaded as its triangles face, without the rock's relief, with the faces of the cut drawn as geometry that hides what lies behind the rock (`flat`); and the plane they are cut along, as a grid over everything (`cut`) */
  walls?: { wireframe?: boolean; flat?: boolean; cut?: boolean };
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
   * the planets. Inside a `World`, a date alone will do: the place is its origin's; without
   * one, a `SceneryStage`'s relief `frame` gives it the same way.
   * `sun.azimuth` and `elevation` are ignored while it is valid; without one, they set the
   * sun, the moon is a full one opposite it and the stars are procedural.
   */
  observer?: SkyObserver | null;
  colors?: SkyColors;
  /** the world's up direction. Default `[0, 1, 0]` */
  up?: Vec3;
  /**
   * compass north, i.e. azimuth 0. Default true north at the origin of the `World`'s frame,
   * or without one a `SceneryStage`'s relief `frame` — the frame the globe lies on the Earth
   * by; with neither, `[0, 0, -1]` (see `CRS.utmToWorld`)
   */
  north?: Vec3;
  /** scales the whole sky: background, environment and light probe. Default 1 */
  intensity?: number;
  /** width of the horizon -> ground transition, as a sine of the angle below the horizon. Default 0.04 */
  horizonBlend?: number;
  /**
   * The Earth is a fixed globe (`SceneryMaterial.globe`): the sea, the sky and the clouds follow
   * its curve, so the horizon drops as the camera climbs (about 1° at 1 km, 4° at 15 km).
   * Under a `SceneryStage` the sea stays flat over the disc that holds its `bounds`. The
   * bakes keep a level horizon. Default true
   *
   * ⚠️ Off, the sea is a flat plane everywhere: right for one field seen from near it, wrong
   * far from it, where the relief and anchored content stay flat too and the horizon never
   * drops. Kept for comparison and for a host that needs a level horizon; to be revisited
   * with the view's origin (see `documents/world.md`).
   */
  globe?: boolean;
  /**
   * Draw the sky, and its `SceneryStage`, behind the scene. Switched instantly: nothing
   * is rebuilt or baked again, and the environment and the light probe stay on, lit by
   * the `subsurface`. `'void'` draws the void's grey gradient in the sky's place (the
   * stand-in's, while the sky compiles): no air, sun, moon, stars or clouds, and the
   * scene lit by the `subsurface` everywhere; the void, its walls and a sea are drawn as
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
   * `ProgressStore.source`): its `shaders` compiling, and with a tiled relief the
   * `relief` tiles loading, each a run from when it is waited for until it is done; once
   * more with no items when the scenery goes away.
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

const DEFAULT_ENVIRONMENT_RESOLUTION = 128;
const DEFAULT_CAPTURE_INTERVAL = 250;
// Seconds the scene's light probe takes to ease most of the way to a new bake: about as
// long as bakes come apart while the sky changes.
const PROBE_EASE = 0.15;
const DEFAULT_CAPTURE_MAX_WAIT = 1000;
// Roughness added to the sea's sun glint at the height of twilight (OceanMaterial.sunGlintSpread).
const SKY_TWILIGHT_GLINT_SPREAD = 0.08;
const DEFAULT_UP: Vec3 = [0, 1, 0];
const DEFAULT_NORTH: Vec3 = [0, 0, -1];

const scratch = new Color();
const lookScratch = new Vector3();
// Where the view is centred, for the graticule's step.
const graticuleView = {
  dir: new Vector3(),
  point: new Vector3(),
  up: new Vector3(),
  reach: { distance: 0, hit: false },
};
// The least the ground the view is centred on is taken to face it (the sine of its
// grazing angle): a view over the horizon is as foreshortened as this.
const GRATICULE_LEAST_FACING = 0.05;
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
  clouds: null,
  ocean: null,
  abyss: null,
  cutaway: null,
  graticule: null,
};

// Each layer mesh's own, for which compiles first (sceneryLayersShown).
const LAYER_DATA = {
  sky: { sceneryLayer: 'sky' },
  clouds: { sceneryLayer: 'clouds' },
  abyss: { sceneryLayer: 'abyss' },
  sea: { sceneryLayer: 'sea' },
  water: { sceneryLayer: 'water' },
};

/**
 * The world around the data: a procedural sky that shows where the horizon and the sun
 * are, and the light that comes from it — a directional sun light, an environment map and
 * a light probe, all from the same sky — and whatever else it holds: clouds
 * (`SceneryClouds`), an endless sea (`SceneryOcean`) with the void below it
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
 *   <SceneryClouds layers="both" />
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

  // Where the sky lies on the Earth: the World's frame, or without one the frame a stage
  // reads its relief in (SceneryOceanState.frame). Its place is an observer's that gives only
  // a date. Kept as a key, so a stage's frame made anew changes nothing.
  const world = useWorld();
  const [stageFrameKey, setStageFrameKey] = useState('');
  const reportStageFrame = useCallback(
    (frame: GeoFrame | null) =>
      setStageFrameKey(frame ? JSON.stringify(frame) : ''),
    [],
  );
  const stageFrame = useMemo(
    () => (stageFrameKey ? (JSON.parse(stageFrameKey) as GeoFrame) : null),
    [stageFrameKey],
  );
  const geoFrame = world?.frame ?? stageFrame;
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
  const cloudsOptions: SceneryCloudsProps | null = features.clouds;
  const cloudsOn = cloudsOptions !== null;
  const cloudDefaults = sceneryDefaults.clouds;
  const cloudCoverage = cloudsOptions?.coverage ?? cloudDefaults.coverage;
  const cloudAltitude = cloudsOptions?.altitude ?? cloudDefaults.altitude;
  const cloudScale = cloudsOptions?.scale ?? cloudDefaults.scale;
  const cloudLayers = cloudsOptions?.layers ?? cloudDefaults.layers;
  const cloudThickness = cloudsOptions?.thickness ?? cloudDefaults.thickness;
  const cloudBandDistance =
    cloudsOptions?.bandDistance ?? cloudDefaults.bandDistance;
  const cloudSoftness = cloudsOptions?.softness ?? cloudDefaults.softness;
  const cloudOpacity =
    cloudsOptions?.enabled === false
      ? 0
      : (cloudsOptions?.opacity ?? cloudDefaults.opacity);
  const cloudColor = toHex(cloudsOptions?.color ?? cloudDefaults.color);
  const cloudSeed = cloudsOptions?.seed ?? cloudDefaults.seed;
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
  const wallsOptions =
    abyssOptions?.walls === true ? {} : abyssOptions?.walls || null;
  const hasWalls = wallsOptions !== null;
  const wallDistance = wallsOptions?.distance ?? abyssDefaults.walls.distance;
  const wallColor = toHex(wallsOptions?.color ?? abyssDefaults.walls.color);
  const wallCutColor = toHex(
    wallsOptions?.cutColor ?? abyssDefaults.walls.cutColor,
  );
  const wallLightStrength =
    wallsOptions?.lightStrength ?? abyssDefaults.walls.lightStrength;
  const wallLightElevation =
    wallsOptions?.lightElevation ?? abyssDefaults.walls.lightElevation;
  const wallLightDepth =
    wallsOptions?.lightDepth ?? abyssDefaults.walls.lightDepth;
  const wallHazeDistance =
    wallsOptions?.hazeDistance ?? abyssDefaults.walls.hazeDistance;
  const wallHazeDepth =
    wallsOptions?.hazeDepth ?? abyssDefaults.walls.hazeDepth;
  const wallMist = wallsOptions?.mist ?? abyssDefaults.walls.mist;
  const wallMistReach =
    wallsOptions?.mistReach ?? abyssDefaults.walls.mistReach;
  const wallRockSize = wallsOptions?.rockSize ?? abyssDefaults.walls.rockSize;
  const wallRelief = wallsOptions?.relief ?? abyssDefaults.walls.relief;
  const wallFlare = wallsOptions?.flare ?? abyssDefaults.walls.flare;
  const wallWander = wallsOptions?.wander ?? abyssDefaults.walls.wander;
  const wallCutDistance =
    wallsOptions?.cutDistance ?? abyssDefaults.walls.cutDistance;
  const wallSand = wallsOptions?.sand ?? abyssDefaults.walls.sand;
  const wallSandColor = toHex(
    wallsOptions?.sandColor ?? abyssDefaults.walls.sandColor,
  );
  const wallGlow = wallsOptions?.glow ?? abyssDefaults.walls.glow;
  const wallGlowColor = toHex(
    wallsOptions?.glowColor ?? abyssDefaults.walls.glowColor,
  );
  const wallRimFade = wallsOptions?.rimFade ?? abyssDefaults.walls.rimFade;
  // Drawn at all; the void's gradient in the sky's place; the sky itself.
  const drawn = background !== false;
  const voided = background === 'void';
  const skyShown = background === true;

  const oceanOptions: SceneryOceanProps | null = features.ocean;
  const hasOcean = oceanOptions !== null;
  const oceanDefaults = sceneryDefaults.ocean;
  const oceanLevel = oceanOptions?.level ?? oceanDefaults.level;
  const airOptions: SkyAir | null = air === true ? {} : air || null;
  const airScaleHeight = airOptions
    ? (airOptions.scaleHeight ?? sceneryDefaults.air.scaleHeight)
    : 0;
  const airVisibility = airOptions
    ? (airOptions.visibility ?? sceneryDefaults.air.visibility)
    : 0;
  const airHaze = airOptions?.haze ?? sceneryDefaults.air.haze;
  const airHazeHeight =
    airOptions?.hazeHeight ?? sceneryDefaults.air.hazeHeight;
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
  const bodyFogDensity =
    oceanOptions?.bodyFogDensity ?? oceanDefaults.bodyFogDensity;

  const environmentOptions = environment === true ? {} : environment || null;
  const hasEnvironment = environmentOptions !== null;
  const environmentIntensity = environmentOptions?.intensity ?? 1;
  const environmentResolution =
    environmentOptions?.resolution ?? DEFAULT_ENVIRONMENT_RESOLUTION;

  const probeOptions = lightProbe === true ? {} : lightProbe || null;
  const hasProbe = probeOptions !== null;
  const probeIntensity = probeOptions?.intensity ?? 1;

  const [material] = useState(() => {
    const sky = new SceneryMaterial();
    // The bakes take the define, so they share its program, but not the depth test.
    sky.defines.SKY_AT_FAR = '';
    sky.depthTest = true;
    sky.name = 'scenery-sky';
    return sky;
  });
  const registry = useMemo<SceneryRegistry>(
    () => ({ material, set: setFeature }),
    [material, setFeature],
  );
  const [standIn] = useState(() => createSceneryStandInMaterial(material));
  const [geometry] = useState(createSceneryGeometry);
  const [baker] = useState(() => new SceneryBaker(material));
  const [probe] = useState(() => new LightProbe());
  const [lightTarget] = useState(() => new Object3D());
  // The sea's water: never drawn, the sky's sea shares its uniforms.
  const water = useMemo(
    () => (hasOcean ? new OceanMaterial() : null),
    [hasOcean],
  );

  useEffect(() => () => water?.dispose(), [water]);

  // For floating children, as in an `Ocean`: the waves they ride, and their contact foam.
  const sampler = useMemo(
    () => (water && oceanWater ? createOceanSampler(water, oceanLevel) : null),
    [water, oceanWater, oceanLevel],
  );
  const contacts = useMemo(createOceanContactRegistry, []);

  // Lines on the Earth, where the sky lies on it (a World's frame, or a stage's). By
  // uniforms alone: always compiled in, drawing nothing until a stage hands over its frame
  // (graticule.glsl), so adding or removing them compiles nothing.
  const graticuleOptions = features.graticule;
  const graticuleOn = graticuleOptions !== null;
  const graticuleKey = graticuleOn ? JSON.stringify(graticuleOptions) : '';
  useEffect(() => {
    if (!import.meta.env.DEV || !graticuleOptions || geoFrame) return;
    // A stage hands over its frame just after mounting: only one still missing warns.
    const timer = setTimeout(
      () =>
        console.warn(
          'SceneryGraticule draws nothing without the sky placed on the Earth: a World, or a stage relief with a frame',
        ),
      1000,
    );
    return () => clearTimeout(timer);
  }, [graticuleOptions, geoFrame]);
  useLayoutEffect(() => {
    if (!graticuleKey) {
      material.setGraticule({});
      return;
    }
    const options = JSON.parse(graticuleKey) as SceneryGraticuleProps;
    const { lines, minSpacing, ...on } = sceneryDefaults.graticule;
    const style = (kind: keyof typeof on): GraticuleStyle | null => {
      const value = options[kind] ?? on[kind];
      if (!value) return null;
      const own: SceneryGraticuleLatLon = value === true ? {} : value;
      return {
        color: own.color ?? lines.color,
        thickness: own.thickness ?? lines.thickness,
        opacity: own.opacity ?? lines.opacity,
        interval: own.interval,
        minSpacing: own.minSpacing ?? minSpacing,
      };
    };
    material.setGraticule({
      latLon: style('latLon'),
      utm: style('utm'),
      timeZones: style('timeZones'),
    });
  }, [material, graticuleKey]);
  // Latitude and longitude's labels: off unless asked for; in the lines' colour unless
  // given their own.
  const graticuleLabels = useMemo<SceneryGraticuleLabels | null>(() => {
    if (!graticuleKey) return null;
    const options = JSON.parse(graticuleKey) as SceneryGraticuleProps;
    const latLon = options.latLon ?? sceneryDefaults.graticule.latLon;
    if (!latLon || latLon === true || !latLon.labels) return null;
    const labels = latLon.labels === true ? {} : latLon.labels;
    const lineColor = latLon.color ?? sceneryDefaults.graticule.lines.color;
    return {
      ...labels,
      color: labels.color ?? `#${new Color(lineColor).getHexString()}`,
    };
  }, [graticuleKey]);

  // In render rather than an effect, so a stage or layer made in this commit compiles with
  // it. A no-op unless a switch changed. The waves' defines likewise, for the sea's layers.
  material.oceanBedDetail = bedDetail;
  material.abyssWalls = hasWalls;
  material.voidBackground = voided;
  material.clouds = cloudsOn;
  material.ocean = hasOcean;
  // With a sea, the void lies below its seabed.
  material.abyss = hasAbyss || hasOcean;
  if (water) material.linkOcean(water);
  // What a stage and its relief compile with from the sky, as a key (SceneryOceanState).
  const definesKey = JSON.stringify(sceneryOceanDefines(material));

  // The background's layers over the sky, each with only the switches it needs.
  const cloudsLayer = useSceneryLayerMaterial(
    material,
    'clouds',
    cloudsOn && !voided,
  );
  const abyssLayer = useSceneryLayerMaterial(
    material,
    'abyss',
    hasAbyss || hasOcean,
  );
  const seaLayer = useSceneryLayerMaterial(material, 'sea', hasOcean);
  const waterLayer = useSceneryLayerMaterial(material, 'water', hasOcean);
  const skyMesh = useRef<Mesh>(null);
  const cloudsMesh = useRef<Mesh>(null);
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
      material.dispose();
      standIn.dispose();
      geometry.dispose();
      baker.dispose();
    },
    [material, standIn, geometry, baker],
  );

  // The stand-in is drawn while the sky compiles, so it compiles first, ahead of the sky's
  // own, and is drawn once it has: drawn before, Chrome's GPU process waits for it behind
  // everything queued before it, freezing the browser (see `bakeSkyCliffs`).
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
  // The void's walls stand in the subsurface: raked by a light at its light's bearing, at
  // their own elevation, and filled in by its light map.
  const wallLightDirection = useMemo(
    () =>
      new Vector3().fromArray(
        directionFromCompass(subsurfaceAzimuth, wallLightElevation, {
          up: [upX, upY, upZ],
          north: [northX, northY, northZ],
        }),
      ),
    [
      subsurfaceAzimuth,
      wallLightElevation,
      upX,
      upY,
      upZ,
      northX,
      northY,
      northZ,
    ],
  );
  useLayoutEffect(() => {
    material.setAbyssWallLight(wallLightDirection, subsurfaceColor);
  }, [material, wallLightDirection, subsurfaceColor]);
  // Their cliffs, baked once while they are on; the walls are drawn once they are.
  useEffect(() => {
    if (!hasWalls) return;
    const cliffs = bakeSkyCliffs(gl, undefined, progress.compiles.track());
    void cliffs.ready.then(baked => {
      if (baked) material.abyssWallRock = cliffs.target.texture;
    });
    return () => {
      material.abyssWallRock = null;
      cliffs.dispose();
    };
  }, [gl, material, hasWalls, progress]);
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
            definesKey,
            abyssWalls: hasWalls,
            visible: drawn,
            ready,
            stage: addStage,
            relief: progress.relief,
            frame: reportStageFrame,
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
      definesKey,
      hasWalls,
      drawn,
      ready,
      addStage,
      progress,
      reportStageFrame,
    ],
  );

  // Made with the sea's water; the seabed's detail, which it does not draw, leaves it be.
  const surfaceLayer = useMemo(
    () => (water ? createSceneryLayerMaterial(material, 'surface') : null),
    [water, material],
  );
  const surfaceMesh = useRef<Mesh>(null);
  // The walls' layer's work each frame, run after their cut (see SceneryAbyssWallLayer).
  const wallFrame = useRef<SceneryAbyssWallFrame | null>(null);

  useEffect(() => () => surfaceLayer?.dispose(), [surfaceLayer]);

  const dirty = useRef(true);
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
    // A map of its own lights the scene; the walls keep to the panels.
    material.setAbyssWallFill(scenerySubsurfaceColors(subsurface));
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
    material.clouds = cloudsOn;
    material.setClouds({
      coverage: cloudCoverage,
      altitude: cloudAltitude,
      scale: cloudScale,
      layers: cloudLayers,
      thickness: cloudThickness,
      bandDistance: cloudBandDistance,
      softness: cloudSoftness,
      opacity: cloudOpacity,
      color: cloudColor,
      seed: cloudSeed,
    });
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
    cloudsOn,
    cloudCoverage,
    cloudAltitude,
    cloudScale,
    cloudLayers,
    cloudThickness,
    cloudBandDistance,
    cloudSoftness,
    cloudOpacity,
    cloudColor,
    cloudSeed,
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
    material.abyssCeilingColor = abyssCeiling;
    material.abyssHorizonColor = abyssHorizon;
    material.abyssDepthColor = abyssDepth;
    material.abyssFadeDistance = abyssFadeDistance;
    material.abyssTransition = abyssTransition;
    material.abyssDarkening = abyssDarkening;
    material.abyssDetail = abyssDetail;
    material.abyssDetailScale = abyssDetailScale;
    material.abyssDepthDetail = abyssDepthDetail;
    material.abyssDepthDetailScale = abyssDepthDetailScale;
    material.abyssFalloff = abyssFalloff;
    material.setAbyssWalls({
      distance: wallDistance,
      color: wallColor,
      cutColor: wallCutColor,
      lightStrength: wallLightStrength,
      lightElevation: wallLightElevation,
      lightDepth: wallLightDepth,
      hazeDistance: wallHazeDistance,
      hazeDepth: wallHazeDepth,
      mist: wallMist,
      mistReach: wallMistReach,
      rockSize: wallRockSize,
      relief: wallRelief,
      flare: wallFlare,
      wander: wallWander,
      cutDistance: wallCutDistance,
      sand: wallSand,
      sandColor: wallSandColor,
      glow: wallGlow,
      glowColor: wallGlowColor,
      rimFade: wallRimFade,
    });
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
    hasWalls,
    wallDistance,
    wallColor,
    wallCutColor,
    wallLightStrength,
    wallLightElevation,
    wallLightDepth,
    wallHazeDistance,
    wallHazeDepth,
    wallMist,
    wallMistReach,
    wallRockSize,
    wallRelief,
    wallFlare,
    wallWander,
    wallCutDistance,
    wallSand,
    wallSandColor,
    wallGlow,
    wallGlowColor,
    wallRimFade,
  ]);

  // Not baked: the bakes keep a level horizon.
  useLayoutEffect(() => {
    material.globeEnabled = globe;
  }, [material, globe]);

  // What a World places is set on this globe.
  const provideGlobe = world?.provideGlobe;
  useLayoutEffect(
    () => provideGlobe?.(material.globe),
    [provideGlobe, material],
  );
  // And it lies on the Earth where the World, or a stage, says.
  useLayoutEffect(() => {
    if (!geoFrame) return;
    material.globe.setFrame(geoFrame);
    return () => material.globe.setFrame(null);
  }, [material, geoFrame]);

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
    material.oceanFogDensity = oceanWater ? bodyFogDensity : 0;
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
    bodyFogDensity,
    oceanWater,
    oceanSeabed,
    oceanSeabedOpacity,
  ]);

  // Every render: the props are an inline object, and applying them is cheap.
  useLayoutEffect(() => {
    if (!water || !oceanOptions) return;
    applyOceanWaterProps(water, oceanOptions);
  });

  // The bakes see the water too, but an inline object is new every render. Not the seabed's
  // opacity: the bakes take the seabed whole.
  const waterKey = oceanOptions
    ? JSON.stringify({ ...oceanOptions, seabedOpacity: undefined })
    : '';
  useEffect(() => {
    dirty.current = true;
  }, [waterKey]);

  useLayoutEffect(() => {
    if (!water) return;
    water.sunDirection = lightDirection;
    // The glint goes with the light, as the sky does.
    water.sunColor = scratch
      .copy(lightColor)
      .multiplyScalar(lightIntensity / Math.max(sunIntensity, 1e-6));
    // A low sun lays a broad glitter path.
    water.sunGlintSpread =
      SKY_TWILIGHT_GLINT_SPREAD * state.twilight * sunTwilight;
  }, [
    water,
    lightDirection,
    lightColor,
    lightIntensity,
    sunIntensity,
    state.twilight,
    sunTwilight,
  ]);

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
    const layers = [
      cloudsLayer,
      abyssLayer,
      seaLayer,
      waterLayer,
      surfaceLayer,
    ];
    const key = [
      JSON.stringify(material.defines),
      JSON.stringify(material.switches),
      layers.map(layer => layer?.uuid ?? '').join(','),
      surfaceLayer !== null && oceanWater,
      stageVersion,
      resolution,
      sunLight,
      hasProbe,
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
    cloudsLayer,
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
    cloudsOn,
    definesKey,
    hasWalls,
    voided,
    progress,
  ]);

  // Bakes run here so several prop changes in one frame cost one bake.
  useFrame(({ camera }, delta) => {
    if (water) {
      water.time += delta;
      contacts.upload(water);
    }
    if (sunShimmer && sunRays > 0) material.sunRayPhase += delta;
    material.sunRadiance =
      (hdr ?? gl.toneMapping !== NoToneMapping) ? SKY_HDR_SUN_RADIANCE : 1;

    // Along up as it is measured over the field: the camera's altitude over the globe.
    const height = material.heightOf(camera.position);
    // Latitude and longitude's step follows how far the view is zoomed: by the ground the
    // view is centred on, foreshortened as it is seen there (the mean of along and across
    // the view), or, looking over the horizon, the horizon.
    if (graticuleOn) {
      const altitude = height - material.oceanLevel;
      const { dir, reach, point, up } = graticuleView;
      camera.getWorldDirection(dir);
      const centred = material.globe.reach(camera.position, dir, 0, reach);
      const R = material.globe.radius;
      let distance: number;
      let facing = GRATICULE_LEAST_FACING;
      if (centred.hit) {
        distance = centred.distance;
        point.copy(camera.position).addScaledVector(dir, distance);
        facing = Math.max(-dir.dot(material.globe.upAt(point, up)), facing);
      } else {
        distance = Math.sqrt(
          Math.max(2 * R * altitude + altitude * altitude, 1),
        );
      }
      material.setGraticuleView(
        graticuleDegreesPerPixel(camera, distance, gl.domElement.height) /
          Math.sqrt(facing),
      );
      material.setGraticuleOrigin(camera.position);
    }
    // Camera controls move the camera before this runs but leave its matrices to the render:
    // read with this frame's position, last frame's would swing the cuts as it moves. Once,
    // for the walls' cut and the cutaway alike.
    if (material.abyssWalls || cutaway) camera.updateMatrixWorld();
    if (material.abyssWalls) material.clipAbyssWalls(camera);
    // Under a stage's ground above the sea's own seabed, as from inside rock: below the sea
    // or in land above it.
    material.oceanBuried =
      material.ocean &&
      material.oceanGround !== null &&
      height <= material.oceanGround &&
      height > material.oceanLevel - material.oceanDepth;
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
      const step = delta / subsurfaceTransition;
      share =
        share < below
          ? Math.min(share + step, below)
          : Math.max(share - step, below);
    } else {
      share = below;
    }
    subsurfaceShare.current = share;
    if (light.current) {
      const t = share * share * (3 - 2 * share);
      light.current.position.copy(lightDirection).lerp(subsurfaceDirection, t);
      light.current.color.copy(lightColor).lerp(subsurfaceColor, t);
      light.current.intensity = MathUtils.lerp(
        lightIntensity,
        subsurfaceIntensity,
        t,
      );
    }

    // The cutaway's own work (SceneryCutaway), by this frame's height, zone and matrices.
    // Without one nothing is cut.
    let cutsSeabed = false;
    if (cutaway) cutsSeabed = cutaway.frame(camera, delta, height, zone);
    else {
      (material.uniforms.uSkyOceanCutawayShape.value as Vector3).y = 0;
      (material.uniforms.uSkyOceanCutawayGrip.value as Vector2).x = 0;
    }

    // The walls' own placements, by this frame's cut; from above the lid only while the
    // void can show there, as through this frame's cutaway.
    const voidOpen = material.abyssOpenFromAbove(cutsSeabed);
    if (material.abyssWalls) wallFrame.current?.(camera, voidOpen);

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
    showLayer(cloudsMesh.current, 'clouds');
    showLayer(abyssMesh.current, 'abyss');
    showLayer(seaMesh.current, 'sea');
    showLayer(waterMesh.current, 'water');

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
              intensity: lightIntensity,
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
        {cloudsLayer && (
          <mesh
            ref={cloudsMesh}
            geometry={geometry}
            material={cloudsLayer}
            frustumCulled={false}
            renderOrder={renderOrder + SCENERY_LAYER_ORDER.clouds}
            visible={false}
            userData={LAYER_DATA.clouds}
            onBeforeRender={material.onBeforeDraw}
            dispose={null}
          />
        )}
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
        {/* Shown each frame. Drawn just before the background, which fills only what it leaves. */}
        {hasWalls && (
          <SceneryAbyssWallLayer
            sky={material}
            renderOrder={renderOrder - 1}
            visible={drawn && ready && !debug?.hide?.includes('walls')}
            wireframe={debug?.walls?.wireframe}
            flat={debug?.walls?.flat}
            cut={debug?.walls?.cut}
            frame={wallFrame}
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
      {graticuleLabels && (
        <SceneryGraticuleLabelLayer
          material={material}
          options={graticuleLabels}
        />
      )}
      {debug?.environment && <SceneryCubeView cube={environmentCube} />}
    </SceneryContext.Provider>
  );
};
