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
  PerspectiveCamera,
  ShaderMaterial,
  SphericalHarmonics3,
  Vector2,
  Vector3,
  Vector4,
} from 'three';
import { precompile } from '../../rendering/precompile';
import { surfaceDetailKey } from '../../sdk/materials/surface-detail';
import {
  geoFrameAt,
  geoFrameLocation,
  placeGeoFrame,
} from '../../sdk/projection/geo-frame';
import { Vec3 } from '../../sdk/types/common';
import { directionFromCompass } from '../../sdk/utils/vector-operations';
import { OceanMaterial } from '../Ocean/ocean-material';
import { applyOceanWaterProps } from '../Ocean/ocean-material-sync';
import { useWorld } from '../World/world-context';
import {
  createOceanContactRegistry,
  OceanContactContext,
} from '../Ocean/ocean-contact';
import {
  createOceanSampler,
  OceanSamplerContext,
} from '../Ocean/ocean-sampler';
import standInFragmentShader from './shaders/sky-stand-in-fragment.glsl';
import skyVertexShader from './shaders/sky-vertex.glsl';
import { SkyBaker } from './sky-baker';
import { SkyBakeSchedule } from './sky-bake-schedule';
import {
  SkyContext,
  SkyOceanContext,
  SkyOceanState,
  SkyState,
} from './sky-context';
import { SkyCutawayHandle } from './sky-cutaway-handle';
import { createSkyGeometry, SkyMaterial } from './sky-material';
import {
  SKY_EARTH_RADIUS,
  SKY_HDR_SUN_RADIANCE,
  SkyAbyss,
  SkyAir,
  SkyClouds,
  SkyColors,
  skyDaylight,
  skyDefaults,
  skyCelestialFrame,
  skyEphemeris,
  SkyMoon,
  skyMoonlight,
  skyMoonShine,
  SkyObserver,
  skyObserverValid,
  SkyOcean,
  SkySeabed,
  skyStarShare,
  skyStarFrame,
  SkyStars,
  SkySubsurface,
  skySubsurfaceColors,
  skySubsurfaceLightPosition,
  SkySun,
  skySunColor,
  skyTwilight,
  skyWaterDimming,
  SkyZone,
  skyZone,
} from './sky-model';
import { createSkySurfaceMaterial } from './sky-stage';
import { bakeSkyCliffs } from './sky-cliffs';
import { SkyAbyssWallFrame, SkyAbyssWallLayer } from './SkyAbyssWallLayer';
import { SkyCubeView } from './SkyCubeView';

export type SkyEnvironmentOptions = {
  /** `scene.environmentIntensity` while the sky provides the environment. Default 1 */
  intensity?: number;
  /** cube face size of the bake. Default 128 */
  resolution?: number;
};

export type SkyLightProbeOptions = {
  /** Default 1 */
  intensity?: number;
};

/**
 * When the environment and the light probe are baked again as the sky changes. A change is
 * baked once the sky has been still for `interval`, so a slider being dragged bakes nothing
 * on the way, and at least every `maxWait` while it keeps changing. The sky itself follows
 * at once; only the light it casts waits. A camera moving never bakes.
 */
export type SkyCaptureOptions = {
  /** how long the sky must be still before it is baked, in milliseconds. Default 250 */
  interval?: number;
  /** longest a changing sky goes without a bake, in milliseconds. Default 1000 */
  maxWait?: number;
};

/** A layer the {@link Sky} draws itself: its background, its sea's surface layer, and its void's walls' mesh. */
export type SkyLayer = 'background' | 'surface' | 'walls';

/** A wave along a {@link SkyCutaway}'s edge. */
export type SkyCutawayWave = {
  /** how far the edge swings ahead and back, relative to the frame's half-width at the edge; it levels out as the cut shrinks in the frame (see `SkyCutaway.zoomFollow`). Default 0 */
  amplitude?: number;
  /** waves across the frame's width. Default 1 */
  frequency?: number;
  /** where along the edge the wave starts, in waves. Default 0 */
  phase?: number;
};

/**
 * A cut through the sea's water (as much of it as `water` says) and seabed (unless `seabed`
 * is false) in front of the view, so what lies under it is seen clearly: everything nearer
 * than a line across the view, where a row of the frame meets the surface (or the seabed,
 * with the camera in the water or the sea dry). Waves bend the line, a rim marks it on the
 * surface and a shadow falls just inside it. It follows the camera. An occupant and the data
 * are never cut.
 */
export type SkyCutaway = {
  /** how much of the water it cuts: 1 all, 0 none, 0.5 half of it. Default 1 */
  water?: number;
  /** cut the seabed too; for a see-through seabed, set the sea's `seabedOpacity` instead. Default true */
  seabed?: boolean;
  /** the frame row whose sight line sets the edge looking level: 0 the bottom, 1 the top. Tilting down raises it to the top, looking straight down. Default 0.5 */
  reach?: number;
  /** moves the edge ahead (+) or back (−) of where `reach` puts it, relative to the frame's half-width at the edge, so it keeps its proportions through a zoom or tilt. Default 0 */
  offset?: number;
  /** a grip on the rim, in the middle of the view, that drags the edge (see `offset`); a double click or tap puts it back. Default false */
  handle?: boolean;
  /** called with the new `offset` when a drag of the grip ends, and on a reset. The sky keeps the dragged offset until `offset` changes */
  onOffsetChange?: (offset: number) => void;
  /** the downward tilt, in degrees, from which the edge slides up out of the view, gone looking straight down. Default 45 */
  exitTilt?: number;
  /** width of the edge's fade, relative to the frame's half-width at the edge. Default 0.01 */
  softness?: number;
  /** waves bending the edge; the first two are used. Default an S across the frame */
  waves?: SkyCutawayWave[];
  /** the line along the edge, on the surface: its colour, and width in pixels (0 for none), thinning toward 1 as the cut shrinks in the frame. Default white, 3 */
  rim?: { color?: ColorRepresentation; width?: number };
  /** the shadow just inside the edge, over what shows through: its opacity, and width relative to the frame's half-width at the edge. Default 0.5, 0.15 */
  shadow?: { opacity?: number; width?: number };
  /** seconds for its size to settle after a zoom or tilt; 0 follows the camera exactly. Default 0 */
  ease?: number;
  /**
   * How much of a zoom its size follows on screen: 1 keeps it fixed in the frame, 0 fixed in
   * the world. It has its frame size with the camera `reference` high over it. Default 0.5
   */
  zoomFollow?: number;
  /** the camera height at which it has its frame size (see `zoomFollow`), in world units. Default half the width of a stage's occupant; without one, it stays fixed in the frame */
  reference?: number;
};

const DEFAULT_CUTAWAY_WAVES: SkyCutawayWave[] = [
  { amplitude: 0.12, frequency: 1, phase: 0 },
  { amplitude: 0.04, frequency: 2.6, phase: 0.3 },
];

// A wave as the shader takes it, for a frame `frame` from its centre to its side and a
// cut `far` (<= 1) of its frame size.
function setCutawayWave(
  target: Vector3,
  wave: SkyCutawayWave | undefined,
  frame: number,
  far: number,
) {
  const { amplitude = 0, frequency = 1, phase = 0 } = wave ?? {};
  target.set(
    amplitude * frame * far,
    (Math.PI * frequency) / frame,
    2 * Math.PI * phase,
  );
}

// How far ahead of its anchor the edge runs, `side` across its heading (see waterFogCutawayEdge).
function cutawayEdgeAhead(side: number, reach: number, a: Vector3, b: Vector3) {
  return (
    reach + a.x * Math.sin(a.y * side + a.z) + b.x * Math.sin(b.y * side + b.z)
  );
}

/**
 * Views for seeing how the sky and a `SkyBoxStage` fit together. They only change what
 * is drawn: nothing is rebuilt or baked again, and the bakes never see them.
 */
export type SkyDebug = {
  /**
   * Tint each part by what draws it. The sky: its sea, seabed and void red, what it
   * leaves to a stage purple, its surface layer orange. A stage: its surface blue, flat
   * seabed green, relief amber. Untinted is the scene.
   */
  tint?: boolean;
  /** layers not to draw */
  hide?: SkyLayer[];
  /** the environment's bake for the zone in view as its six faces, in the canvas' lower right corner (`+Y` over `-X -Z +X +Z`, `-Y` under) */
  environment?: boolean;
  /** the void's walls' mesh: its triangles drawn as lines in one colour (`wireframe`); shaded as its triangles face, without the rock's relief, with the faces of the cut drawn as geometry that hides what lies behind the rock (`flat`); and the plane they are cut along, as a grid over everything (`cut`) */
  walls?: { wireframe?: boolean; flat?: boolean; cut?: boolean };
};

/**
 * Sky props
 * @expand
 */
export type SkyProps = {
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
  /** compass north, i.e. azimuth 0. Default `[0, 0, -1]` (see `CRS.utmToWorld`) */
  north?: Vec3;
  /** scales the whole sky: background, environment and light probe. Default 1 */
  intensity?: number;
  /** width of the horizon -> ground transition, as a sine of the angle below the horizon. Default 0.04 */
  horizonBlend?: number;
  /**
   * The Earth is a fixed globe (`SkyMaterial.globe`): the sea, the sky and the clouds follow
   * its curve, so the horizon drops as the camera climbs (about 1° at 1 km, 4° at 15 km).
   * Under a `SkyBoxStage` the sea stays flat over the disc that holds its `bounds`. The
   * bakes keep a level horizon. Default true
   *
   * ⚠️ Off, the sea is a flat plane everywhere: right for one field seen from near it, wrong
   * far from it, where the relief and anchored content stay flat too and the horizon never
   * drops. Kept for comparison and for a host that needs a level horizon; to be revisited
   * with the view's origin (see `documents/world.md`).
   */
  globe?: boolean;
  /**
   * Draw the sky, and its `SkyBoxStage`, behind the scene. Switched instantly: nothing
   * is rebuilt or baked again, and the environment and the light probe stay on, lit by
   * the `subsurface`. `'void'` draws the void's grey gradient in the sky's place (the
   * stand-in's, while the sky compiles): no air, sun, moon, stars or clouds, and the
   * scene lit by the `subsurface` everywhere; the void, its walls and a sea are drawn as
   * ever. Changing to or from it recompiles. Default true
   */
  background?: boolean | 'void';
  /** below a level, a lid hides the sky and a void fills the view (see {@link SkyAbyss}). Default false */
  abyss?: boolean | SkyAbyss;
  /** an endless sea; below its seabed the abyss takes over (see {@link SkyOcean}). Default false */
  ocean?: boolean | SkyOcean;
  /** bake the sky into `scene.environment`, which lights MeshStandard/MeshPhysical materials. Default true */
  environment?: boolean | SkyEnvironmentOptions;
  /** bake the sky into a LightProbe, which lights every `lights: true` material. Default true */
  lightProbe?: boolean | SkyLightProbeOptions;
  /**
   * The light below the seabed (or the abyss level), and wherever the sky is not drawn:
   * soft light panels on a dark backdrop, or a map of your own, and a steady directional
   * light in place of the sun's (see {@link SkySubsurface}). Default the panels and a fixed light
   */
  subsurface?: SkySubsurface;
  /** how often the bakes follow a changing sky (see {@link SkyCaptureOptions}) */
  capture?: SkyCaptureOptions;
  /** cut away the sea's water and seabed, or some of each, in front of the view (see {@link SkyCutaway}). Default false */
  cutaway?: boolean | SkyCutaway;
  /** add a directional light from the sun, and from the moon at night. Default true */
  sunLight?: boolean;
  /** a moon opposite the sun, for some light at night (see {@link SkyMoon}). Default true */
  moon?: boolean | SkyMoon;
  /** stars at night, and with an `observer` the planets (see {@link SkyStars}). Default true */
  stars?: boolean | SkyStars;
  /** still clouds: a band along the horizon, a deck overhead, or both (see {@link SkyClouds}). Default true */
  clouds?: boolean | SkyClouds;
  /** the air thinning with height, and hazing the far sea (see {@link SkyAir}). Default true */
  air?: boolean | SkyAir;
  /**
   * The output is tone mapped, so the sun disc may go past display white. Defaults to
   * the renderer's `toneMapping`; set it when a pipeline pass tone maps instead.
   */
  hdr?: boolean;
  /**
   * Default 1e9: the sky is drawn after the opaque scene, on the far plane with a depth
   * test, so only what nothing nearer covers is shaded. An opaque object that writes no
   * depth is drawn over: make it `transparent`.
   */
  renderOrder?: number;
  /** debug views (see {@link SkyDebug}) */
  debug?: SkyDebug;
  children?: ReactNode;
};

const DEFAULT_ENVIRONMENT_RESOLUTION = 128;
const DEFAULT_CAPTURE_INTERVAL = 250;
// Seconds the scene's light probe takes to ease most of the way to a new bake: about as
// long as bakes come apart while the sky changes.
const PROBE_EASE = 0.15;
const DEFAULT_CAPTURE_MAX_WAIT = 1000;
// Narrowest edge, in world units: a fade of none is undefined in the shader.
const CUTAWAY_MIN_EDGE = 0.01;
// The cutaway's tip row never looks flatter than this (sine; about 0.6° below the horizon).
const CUTAWAY_MIN_DOWN = 0.01;
// Past the frame's top, for the rim and its antialiasing: of the frame's half-width there.
const CUTAWAY_EXIT_MARGIN = 0.05;
// Roughness added to the sea's sun glint at the height of twilight (OceanMaterial.sunGlintSpread).
const SKY_TWILIGHT_GLINT_SPREAD = 0.08;
const DEFAULT_UP: Vec3 = [0, 1, 0];
const DEFAULT_NORTH: Vec3 = [0, 0, -1];

const scratch = new Color();
// Primitive dependency for a colour prop, so an inline `new Color()` does not re-bake every render.
const toHex = (value: ColorRepresentation) => scratch.set(value).getHex();

// Drawn while the sky's shaders compile: the void's gradient, whatever the sky is.
function createSkyStandInMaterial(sky: SkyMaterial) {
  return new ShaderMaterial({
    vertexShader: skyVertexShader,
    fragmentShader: standInFragmentShader,
    uniforms: sky.uniforms,
    defines: { SKY_AT_FAR: '' },
    side: DoubleSide,
    depthWrite: false,
    fog: true,
  });
}

/**
 * Procedural sky: a background that shows where the horizon and the sun are, and the
 * light that comes from it — a directional sun light, an environment map and a light
 * probe, all from the same sky. Each part can be switched off, and nothing else in the
 * library depends on this component.
 *
 * The environment and light probe are baked once for each zone the camera can be in —
 * the air over the sea, the water in it and, below the seabed, the `subsurface` —
 * and swapped as the camera crosses a level, so a moving camera never bakes. They are
 * baked again when the sky changes. In the water they dim with depth.
 * Children can read the sun with {@link useSky}.
 *
 * ⚠️ With both `environment` and `lightProbe`, MeshStandard materials receive diffuse
 * sky light from each.
 *
 * @example
 * <Sky sun={{ azimuth: 200, elevation: 35 }} />
 *
 * @group Components
 */
export const Sky = ({
  sun,
  observer,
  colors,
  up,
  north,
  intensity = skyDefaults.intensity,
  horizonBlend = skyDefaults.horizonBlend,
  globe = skyDefaults.globe,
  background = true,
  abyss = false,
  ocean = false,
  environment = true,
  lightProbe = true,
  subsurface,
  capture,
  cutaway,
  sunLight = true,
  moon = true,
  stars = true,
  clouds = true,
  air = true,
  hdr,
  renderOrder = 1e9,
  debug,
  children,
}: SkyProps) => {
  const gl = useThree(state => state.gl);
  const scene = useThree(state => state.scene);
  const sceneCamera = useThree(state => state.camera);
  const getThree = useThree(state => state.get);

  // The World's place, for an observer that gives only a date.
  const world = useWorld();
  const worldFrame = world?.frame ?? null;
  const worldPlace = useMemo(
    () => (worldFrame ? geoFrameLocation(worldFrame) : null),
    [worldFrame],
  );
  const located = observer && {
    date: observer.date,
    latitude: observer.latitude ?? worldPlace?.latitude,
    longitude: observer.longitude ?? worldPlace?.longitude,
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
    ephemeris?.sun.azimuth ?? sun?.azimuth ?? skyDefaults.sun.azimuth;
  const elevation =
    ephemeris?.sun.elevation ?? sun?.elevation ?? skyDefaults.sun.elevation;
  const sunIntensity = sun?.intensity ?? skyDefaults.sun.intensity;
  const sunSize = sun?.size ?? skyDefaults.sun.size;
  const sunGlow = sun?.glow ?? skyDefaults.sun.glow;
  const sunGlare = sun?.glare ?? skyDefaults.sun.glare;
  const sunRays = sun?.rays ?? skyDefaults.sun.rays;
  const sunShimmer = sun?.shimmer ?? skyDefaults.sun.shimmer;
  const sunTwilight = sun?.twilight ?? skyDefaults.sun.twilight;
  const moonOptions: SkyMoon | null = moon === true ? {} : moon || null;
  const hasMoon = moonOptions !== null;
  const moonDefaults = skyDefaults.moon;
  const moonIntensity = moonOptions?.intensity ?? moonDefaults.intensity;
  const moonHex = toHex(moonOptions?.color ?? moonDefaults.color);
  const moonColor = useMemo(() => new Color(moonHex), [moonHex]);
  const moonSize = moonOptions ? (moonOptions.size ?? moonDefaults.size) : 0;
  const moonGlow = moonOptions ? (moonOptions.glow ?? moonDefaults.glow) : 0;
  const starsOptions: SkyStars | null = stars === true ? {} : stars || null;
  const starBrightness = starsOptions
    ? (starsOptions.brightness ?? skyDefaults.stars.brightness)
    : 0;
  const starShare = skyStarShare(
    starsOptions?.density ?? skyDefaults.stars.density,
  );
  const starLatitude = starsOptions?.latitude ?? skyDefaults.stars.latitude;
  const cloudsOptions: SkyClouds | null = clouds === true ? {} : clouds || null;
  const cloudsOn = cloudsOptions !== null;
  const cloudDefaults = skyDefaults.clouds;
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
  const zenith = toHex(colors?.zenith ?? skyDefaults.colors.zenith);
  const horizon = toHex(colors?.horizon ?? skyDefaults.colors.horizon);
  const ground = toHex(colors?.ground ?? skyDefaults.colors.ground);
  const nadir = toHex(colors?.nadir ?? skyDefaults.colors.nadir);
  const [upX, upY, upZ] = up ?? DEFAULT_UP;
  // In a World, compass north is true north at its origin: its map's grid north turned by
  // the map's convergence there.
  const trueNorth = useMemo((): Vec3 | null => {
    if (!worldFrame || !worldPlace) return null;
    const { rotation } = placeGeoFrame(
      geoFrameAt(worldPlace.longitude, worldPlace.latitude),
      { projection: worldFrame.projection, origin: worldFrame.origin },
    );
    return [-Math.sin(rotation), 0, -Math.cos(rotation)];
  }, [worldFrame, worldPlace]);
  const [northX, northY, northZ] = north ?? trueNorth ?? DEFAULT_NORTH;

  const abyssOptions: SkyAbyss | null = abyss === true ? {} : abyss || null;
  const hasAbyss = abyssOptions !== null;
  const abyssDefaults = skyDefaults.abyss;
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

  const oceanOptions: SkyOcean | null = ocean === true ? {} : ocean || null;
  const hasOcean = oceanOptions !== null;
  const oceanDefaults = skyDefaults.ocean;
  const oceanLevel = oceanOptions?.level ?? oceanDefaults.level;
  const airOptions: SkyAir | null = air === true ? {} : air || null;
  const airScaleHeight = airOptions
    ? (airOptions.scaleHeight ?? skyDefaults.air.scaleHeight)
    : 0;
  const airVisibility = airOptions
    ? (airOptions.visibility ?? skyDefaults.air.visibility)
    : 0;
  const airHaze = airOptions?.haze ?? skyDefaults.air.haze;
  const airHazeHeight = airOptions?.hazeHeight ?? skyDefaults.air.hazeHeight;
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
  const seabedOptions: SkySeabed | null =
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
  const bedDetailKey = surfaceDetailKey(bedDetail);
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
    const sky = new SkyMaterial();
    // The bakes take the define, so they share its program, but not the depth test.
    sky.defines.SKY_AT_FAR = '';
    sky.depthTest = true;
    return sky;
  });
  const [standIn] = useState(() => createSkyStandInMaterial(material));
  const [geometry] = useState(createSkyGeometry);
  const [baker] = useState(() => new SkyBaker(material));
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

  // In render rather than an effect, so a stage made in this commit compiles with it. A
  // no-op unless the detail changed. The waves' defines likewise, for the surface layer.
  material.oceanBedDetail = bedDetail;
  material.abyssWalls = hasWalls;
  material.voidBackground = voided;
  if (water) material.linkOcean(water);

  useEffect(
    () => () => {
      material.dispose();
      standIn.dispose();
      geometry.dispose();
      baker.dispose();
    },
    [material, standIn, geometry, baker],
  );

  const state = useMemo<SkyState>(() => {
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
  const subsurfaceDefaults = skyDefaults.subsurface.light;
  const { azimuth: subsurfaceAzimuth, elevation: subsurfaceElevation } =
    skySubsurfaceLightPosition(azimuth, elevation, subsurfaceLight);
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
  // Their cliffs, baked once while they are on.
  useEffect(() => {
    if (!hasWalls) return;
    const cliffs = bakeSkyCliffs(gl);
    material.abyssWallRock = cliffs.texture;
    return () => {
      material.abyssWallRock = null;
      cliffs.dispose();
    };
  }, [gl, material, hasWalls]);
  const light = useRef<DirectionalLight>(null);
  // 0 the sky's light, 1 the subsurface's; null until the first frame, which takes the zone's.
  const subsurfaceShare = useRef<number | null>(null);

  // Whether what the sky draws is compiled; until then the stand-in is drawn instead.
  const [ready, setReady] = useState(false);
  // Stages hand over their parts, compiled with the sky's own (see SkyOceanState.stage).
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

  const oceanState = useMemo<SkyOceanState | null>(
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
            bedDetail: bedDetailKey,
            abyssWalls: hasWalls,
            visible: drawn,
            ready,
            stage: addStage,
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
      bedDetailKey,
      hasWalls,
      drawn,
      ready,
      addStage,
    ],
  );

  const surfaceLayer = useMemo(() => {
    if (!water) return null;
    const layer = createSkySurfaceMaterial(material);
    layer.depthTest = true;
    return layer;
  }, [water, material]);
  const surfaceMesh = useRef<Mesh>(null);
  // The walls' layer's work each frame, run after their cut (see SkyAbyssWallLayer).
  const wallFrame = useRef<SkyAbyssWallFrame | null>(null);

  useEffect(() => () => surfaceLayer?.dispose(), [surfaceLayer]);

  const dirty = useRef(true);
  // The subsurface's bakes owe nothing to the sky: they are due only when their own inputs change.
  const subsurfaceDirty = useRef(true);
  // The zones whose environment and light probe are due a bake; each zone's coefficients.
  const stale = useRef({
    environment: new Set<SkyZone>(),
    probe: new Set<SkyZone>(),
  });
  const zoneProbes = useRef<Partial<Record<SkyZone, SphericalHarmonics3>>>({});
  const appliedProbe = useRef<SkyZone | null>(null);
  const zoneInView = useRef<SkyZone>('air');
  const [schedule] = useState(() => new SkyBakeSchedule());
  // One readback at a time: they are slow to come back, and piled up they stall.
  const probeBusy = useRef(false);
  const captureInterval = capture?.interval ?? DEFAULT_CAPTURE_INTERVAL;
  const captureMaxWait = capture?.maxWait ?? DEFAULT_CAPTURE_MAX_WAIT;
  // The zones the camera can be in; the subsurface also lights an undrawn sky, and the
  // void's gradient everywhere, so then nothing else is baked.
  const zones = useMemo<SkyZone[]>(
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
        : { light: skySubsurfaceColors(subsurface) },
    );
    subsurfaceDirty.current = true;
    // A map of its own lights the scene; the walls keep to the panels.
    material.setAbyssWallFill(skySubsurfaceColors(subsurface));
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
  }, [gl, baker, hasEnvironment, environmentResolution]);

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
  // And it lies on the Earth where the World says.
  useLayoutEffect(() => {
    if (!worldFrame) return;
    material.globe.setFrame(worldFrame);
    return () => material.globe.setFrame(null);
  }, [material, worldFrame]);

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
  // the stand-in is drawn, and the bakes wait for it.
  const own = useRef<Group>(null);
  const compiling = useRef('');
  useLayoutEffect(() => {
    const group = own.current;
    if (!group) return;
    const resolution = hasEnvironment ? environmentResolution : null;
    const key = [
      JSON.stringify(material.defines),
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
    const pending = [
      ...[group, ...stages.current].map(root =>
        precompile(gl, root, sceneCamera, scene),
      ),
      baker.precompile(gl),
    ].filter(wait => wait !== null);
    if (pending.length === 0) {
      setReady(true);
      return;
    }
    setReady(false);
    Promise.all(pending).then(() => {
      if (compiling.current === key) setReady(true);
    });
    // The defines are read from the material: the props that set them are deps too.
  }, [
    gl,
    scene,
    sceneCamera,
    material,
    baker,
    bakeProbe,
    surfaceLayer,
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
    bedDetailKey,
    hasWalls,
    voided,
  ]);

  const cutawayOptions = cutaway === true ? {} : cutaway || null;
  const cutawayWater = MathUtils.clamp(cutawayOptions?.water ?? 1, 0, 1);
  const cutawaySeabed = cutawayOptions?.seabed ?? true;
  const cutawayReach = MathUtils.clamp(cutawayOptions?.reach ?? 0.5, 0, 1);
  const cutawayExitTilt = MathUtils.clamp(
    cutawayOptions?.exitTilt ?? 45,
    0,
    90,
  );
  const cutawaySoftness = Math.max(cutawayOptions?.softness ?? 0.01, 0);
  const cutawayWaves = cutawayOptions?.waves ?? DEFAULT_CUTAWAY_WAVES;
  const cutawayRimHex = toHex(cutawayOptions?.rim?.color ?? '#ffffff');
  const cutawayRimColor = useMemo(
    () => new Color(cutawayRimHex),
    [cutawayRimHex],
  );
  const cutawayRimWidth = Math.max(cutawayOptions?.rim?.width ?? 3, 0);
  const cutawayShadowOpacity = MathUtils.clamp(
    cutawayOptions?.shadow?.opacity ?? 0.5,
    0,
    1,
  );
  const cutawayShadowWidth = Math.max(cutawayOptions?.shadow?.width ?? 0.15, 0);
  const cutawayEase = Math.max(cutawayOptions?.ease ?? 0, 0);
  const cutawayZoomFollow = MathUtils.clamp(
    cutawayOptions?.zoomFollow ?? 0.5,
    0,
    1,
  );
  const cutawaySize = useRef({
    reach: 0,
    width: 0,
    frame: 0,
    shift: 0,
    plane: 0,
    active: false,
    // This frame's edge without its offset, the offset's unit, and the slide-out holding the
    // edge past `floor`, for the grip.
    base: 0,
    unit: 1,
    exit: 0,
    floor: 0,
  });
  const [cutawayRay] = useState(() => new Vector3());
  const [cutawayScratch] = useState(() => ({
    a: new Vector3(),
    b: new Vector3(),
    side: new Vector3(),
  }));

  const cutawayOffset = cutawayOptions?.offset ?? 0;
  const cutawayHandleOn = !!cutawayOptions?.handle;
  const cutawayGrip = useRef<SkyCutawayHandle | null>(null);
  // The dragged offset, kept until `offset` changes.
  const cutawayDragged = useRef<number | null>(null);
  const onCutawayOffset = useRef(cutawayOptions?.onOffsetChange);
  useLayoutEffect(() => {
    onCutawayOffset.current = cutawayOptions?.onOffsetChange;
  });
  useEffect(() => {
    if (!cutawayGrip.current?.active) cutawayDragged.current = null;
  }, [cutawayOffset]);

  useEffect(() => {
    if (!cutawayHandleOn) return;
    const canvas = gl.domElement;
    const { a, b, side } = cutawayScratch;
    // The offset that puts the edge under client point `x`, `y`, where its sight line comes
    // down to the cut's plane.
    const offsetAt = (x: number, y: number) => {
      const size = cutawaySize.current;
      if (!size.active) return null;
      const { camera } = getThree();
      const skyUp = material.up;
      const altitude = camera.position.dot(skyUp) - size.plane;
      const box = canvas.getBoundingClientRect();
      const ray = a
        .set(
          ((x - box.left) / box.width) * 2 - 1,
          1 - ((y - box.top) / box.height) * 2,
          0.5,
        )
        .unproject(camera)
        .sub(camera.position)
        .normalize();
      const down = -ray.dot(skyUp);
      if (altitude <= 0 || down <= 0) return null;
      const anchor = material.uniforms.uSkyOceanCutawayAnchor.value as Vector3;
      const heading = material.uniforms.uSkyOceanCutawayHeading
        .value as Vector3;
      const point = b
        .copy(camera.position)
        .addScaledVector(ray, altitude / Math.max(down, CUTAWAY_MIN_DOWN))
        .sub(anchor);
      const wave = cutawayEdgeAhead(
        point.dot(side.crossVectors(heading, skyUp)),
        0,
        material.uniforms.uSkyOceanCutawayWaveA.value,
        material.uniforms.uSkyOceanCutawayWaveB.value,
      );
      let edge = point.dot(heading) - wave;
      // Sliding out, the edge is eased toward `floor` from below it (see the frame): undone.
      if (size.exit > 0 && edge < size.floor) {
        if (size.exit >= 1) return null;
        edge = (edge - size.floor * size.exit) / (1 - size.exit);
      }
      const offset = (edge - size.base) / size.unit;
      // No nearer than straight below the camera.
      return Math.max(offset, (-size.shift - size.base) / size.unit);
    };
    // Reported once a drag ends: reports on the way would come back as props behind it.
    let dragged = false;
    const grip = new SkyCutawayHandle(canvas.parentElement ?? document.body, {
      drag: (x, y) => {
        const offset = offsetAt(x, y);
        if (offset === null) return;
        cutawayDragged.current = offset;
        dragged = true;
      },
      release: () => {
        if (!dragged || cutawayDragged.current === null) return;
        dragged = false;
        onCutawayOffset.current?.(cutawayDragged.current);
      },
      reset: () => {
        cutawayDragged.current = 0;
        onCutawayOffset.current?.(0);
      },
    });
    cutawayGrip.current = grip;
    return () => {
      grip.dispose();
      cutawayGrip.current = null;
    };
  }, [cutawayHandleOn, gl, material, getThree, cutawayScratch]);

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
    // Camera controls move the camera before this runs but leave its matrices to the render:
    // read with this frame's position, last frame's would swing the cuts as it moves. Once,
    // for the walls' cut and the cutaway alike.
    if (material.abyssWalls || cutawayOptions) camera.updateMatrixWorld();
    if (material.abyssWalls) material.clipAbyssWalls(camera);
    // From the sea surface down the layer is clear everywhere (skyOceanSurfaceLayer).
    if (surfaceMesh.current)
      surfaceMesh.current.visible =
        drawn &&
        ready &&
        !debug?.hide?.includes('surface') &&
        height > material.oceanLevel;
    // From high up the sky's own light goes by the sun over the lowered horizon; the sea's,
    // the scene's and the bakes' stay by the sea's.
    const airHeight = height - airLevel;
    const dip =
      material.globeEnabled && airHeight > 0
        ? Math.acos(SKY_EARTH_RADIUS / (SKY_EARTH_RADIUS + airHeight))
        : 0;
    material.setAirLight(elevation, dip, moonShine);
    const zone = skyZone(height, {
      ocean: material.ocean,
      oceanLevel: material.oceanLevel,
      oceanDepth: material.oceanDepth,
      oceanWater: material.oceanWater,
      oceanGround: material.oceanGround,
      cutaway: !!cutawayOptions && cutawayWater > 0,
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
    // Under a stage's ground above the sea's own seabed, as from inside rock.
    material.oceanBuried =
      material.ocean &&
      material.oceanGround !== null &&
      height <= material.oceanGround &&
      height > material.oceanLevel - material.oceanDepth;

    // The cutaway: from below the camera to where the `reach` row meets its plane, the
    // surface from above the water and the seabed from in it, or from above a dry one.
    // The camera's matrices are this frame's (above).
    const cutawayShape = material.uniforms.uSkyOceanCutawayShape
      .value as Vector3;
    const size = cutawaySize.current;
    const bedLevel = material.oceanLevel - material.oceanDepth;
    // A cutaway lights the water as the air (see skyZone), so the plane goes by height.
    const plane = !material.oceanWater
      ? height > bedLevel
        ? bedLevel
        : null
      : zone === 'subsurface'
        ? null
        : height > material.oceanLevel
          ? material.oceanLevel
          : bedLevel;
    const altitude = plane === null ? 0 : height - plane;
    const cutsAny =
      (cutawayWater > 0 && material.oceanWater) ||
      (cutawaySeabed && material.oceanSeabed);
    if (
      !cutawayOptions ||
      !material.ocean ||
      !cutsAny ||
      plane === null ||
      altitude <= 0
    ) {
      cutawayShape.y = 0;
      size.active = false;
      (material.uniforms.uSkyOceanCutawayGrip.value as Vector2).x = 0;
      cutawayGrip.current?.hide();
    } else {
      (material.uniforms.uSkyOceanCutawayCuts.value as Vector2).set(
        cutawayWater,
        cutawaySeabed ? 1 : 0,
      );
      const skyUp = material.up;
      const anchor = material.uniforms.uSkyOceanCutawayAnchor.value as Vector3;
      anchor.copy(camera.position).addScaledVector(skyUp, -altitude);
      // The frame's up plus its view direction, laid level: defined looking straight down too.
      const heading = material.uniforms.uSkyOceanCutawayHeading
        .value as Vector3;
      const m = camera.matrixWorld.elements;
      cutawayRay.set(m[4] - m[8], m[5] - m[9], m[6] - m[10]);
      cutawayRay.addScaledVector(skyUp, -cutawayRay.dot(skyUp));
      if (cutawayRay.lengthSq() > 1e-12) heading.copy(cutawayRay).normalize();

      // The tip's row climbs from `reach` looking level to the frame's top looking straight down.
      const tilt =
        Math.asin(
          MathUtils.clamp(
            m[8] * skyUp.x + m[9] * skyUp.y + m[10] * skyUp.z,
            0,
            1,
          ),
        ) /
        (Math.PI / 2);
      const row = cutawayReach + (1 - cutawayReach) * tilt;
      cutawayRay
        .set(0, 2 * row - 1, 0.5)
        .unproject(camera)
        .sub(camera.position)
        .normalize();
      const down = -cutawayRay.dot(skyUp);
      // At least just below the horizon: in proportion to the height, so any zoom frames it alike.
      const distance = altitude / Math.max(down, CUTAWAY_MIN_DOWN);
      const reach = Math.max(distance * cutawayRay.dot(heading), 0);
      const view = camera as PerspectiveCamera;
      const halfWidth =
        distance *
        Math.tan(MathUtils.degToRad(view.fov ?? 60) / 2) *
        (view.aspect ?? 1);
      // Toward a fixed size in the world by `zoomFollow`, around the view's centre, so a zoom
      // grows and shrinks it as it does the world, only less.
      let scale = 1;
      let shift = 0;
      const reference = cutawayOptions.reference ?? material.occupantRadius;
      if (reference && reference > 0 && cutawayZoomFollow < 1) {
        scale = Math.pow(reference / altitude, 1 - cutawayZoomFollow);
        cutawayRay
          .set(0, 0, 0.5)
          .unproject(camera)
          .sub(camera.position)
          .normalize();
        const centre =
          (altitude / Math.max(-cutawayRay.dot(skyUp), CUTAWAY_MIN_DOWN)) *
          cutawayRay.dot(heading);
        shift = centre * (1 - scale);
      }
      // Zoomed out the cut shrinks in the frame: its waves level out with it.
      const far = Math.min(scale, 1);
      // Looking down, from `exitTilt` on, the edge slides past the frame's top.
      size.base = reach * scale;
      size.unit = Math.max(halfWidth * scale, 1e-6);
      const offset = cutawayDragged.current ?? cutawayOffset;
      let target = Math.max(size.base + offset * size.unit, -shift);
      const exit = MathUtils.smoothstep(tilt, cutawayExitTilt / 90, 1);
      size.exit = exit;
      size.floor = -Infinity;
      if (exit > 0) {
        cutawayRay
          .set(0, 1, 0.5)
          .unproject(camera)
          .sub(camera.position)
          .normalize();
        const top =
          (altitude / Math.max(-cutawayRay.dot(skyUp), CUTAWAY_MIN_DOWN)) *
          cutawayRay.dot(heading);
        const swing =
          (Math.abs(cutawayWaves[0]?.amplitude ?? 0) +
            Math.abs(cutawayWaves[1]?.amplitude ?? 0)) *
          far;
        const inside = scale * (cutawayShadowWidth + cutawaySoftness);
        const clearance = halfWidth * (swing + inside + CUTAWAY_EXIT_MARGIN);
        size.floor = top - shift + clearance;
        target = MathUtils.lerp(target, Math.max(target, size.floor), exit);
      }
      // The size eases, so a tilt near the horizon never makes the edge jump. Switching
      // plane starts it over: the cutaway keeps its place in the frame either way.
      if (size.plane !== plane) size.active = false;
      const grip = cutawayGrip.current;
      // Dragged, the edge stays under the pointer.
      const ease =
        size.active && cutawayEase > 0 && !grip?.active
          ? 1 - Math.exp(-delta / cutawayEase)
          : 1;
      size.reach += (target - size.reach) * ease;
      size.width += (halfWidth * scale - size.width) * ease;
      size.frame += (halfWidth - size.frame) * ease;
      size.shift += (shift - size.shift) * ease;
      size.plane = plane;
      size.active = true;
      anchor.addScaledVector(heading, size.shift);
      const width = size.width;
      cutawayShape.set(
        size.reach,
        width,
        Math.max(width * cutawaySoftness, CUTAWAY_MIN_EDGE),
      );
      setCutawayWave(
        material.uniforms.uSkyOceanCutawayWaveA.value,
        cutawayWaves[0],
        size.frame,
        far,
      );
      setCutawayWave(
        material.uniforms.uSkyOceanCutawayWaveB.value,
        cutawayWaves[1],
        size.frame,
        far,
      );
      // Thinning with the cut, down to a pixel; wider while the grip is held or hovered.
      const held = !!grip && (grip.active || grip.hover);
      const rimWidth = cutawayRimWidth * (held ? 1.5 : 1);
      (material.uniforms.uSkyOceanCutawayRim.value as Vector4).set(
        cutawayRimColor.r,
        cutawayRimColor.g,
        cutawayRimColor.b,
        Math.max(rimWidth * far, Math.min(rimWidth, 1)),
      );
      (material.uniforms.uSkyOceanCutawayShadow.value as Vector2).set(
        cutawayShadowOpacity,
        width * cutawayShadowWidth,
      );

      // The grip, drawn on the rim in the middle of the view, and the element taking the
      // pointer over it. Like the rim, only on the surface seen from above.
      const gripUniform = material.uniforms.uSkyOceanCutawayGrip
        .value as Vector2;
      gripUniform.set(0, held ? 1.2 : 1);
      if (grip) {
        const { a, b, side } = cutawayScratch;
        const waveA = material.uniforms.uSkyOceanCutawayWaveA.value as Vector3;
        const waveB = material.uniforms.uSkyOceanCutawayWaveB.value as Vector3;
        side.crossVectors(heading, skyUp);
        const edgeAt = (s: number, out: Vector3) =>
          out
            .copy(anchor)
            .addScaledVector(
              heading,
              cutawayEdgeAhead(s, size.reach, waveA, waveB),
            )
            .addScaledVector(side, s)
            .project(camera);
        const centre = edgeAt(0, a);
        const along = edgeAt(width * 0.1, b);
        if (
          plane !== material.oceanLevel ||
          Math.abs(centre.x) > 1 ||
          Math.abs(centre.y) > 1 ||
          Math.abs(centre.z) > 1
        ) {
          grip.hide();
        } else {
          gripUniform.x = 1;
          const canvas = gl.domElement;
          const w = canvas.clientWidth;
          const h = canvas.clientHeight;
          grip.place(
            canvas.offsetLeft + ((centre.x + 1) / 2) * w,
            canvas.offsetTop + ((1 - centre.y) / 2) * h,
            Math.atan2(
              ((centre.y - along.y) * h) / 2,
              ((along.x - centre.x) * w) / 2,
            ),
          );
        }
      }
    }

    // The walls' own placements, by this frame's cut; from above the lid only while the
    // void can show there, as through this frame's cutaway.
    if (material.abyssWalls)
      wallFrame.current?.(
        camera,
        material.abyssOpenFromAbove(size.active && cutawaySeabed),
      );

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
      { sky: ready, subsurface: subsurfaceReady },
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
        ? skyWaterDimming(
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
    <SkyContext.Provider value={state}>
      <group ref={own}>
        <mesh
          geometry={geometry}
          material={material}
          frustumCulled={false}
          renderOrder={renderOrder}
          visible={drawn && ready && !debug?.hide?.includes('background')}
          onBeforeRender={material.onBeforeDraw}
          dispose={null}
        />
        {surfaceLayer && oceanWater && (
          <mesh
            ref={surfaceMesh}
            geometry={geometry}
            material={surfaceLayer}
            frustumCulled={false}
            renderOrder={renderOrder + 1}
            // Shown each frame.
            visible={false}
            onBeforeRender={material.onBeforeDraw}
            dispose={null}
          />
        )}
        {/* Shown each frame. Drawn just before the background, which fills only what it leaves. */}
        {hasWalls && (
          <SkyAbyssWallLayer
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
        visible={drawn && !ready}
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
      <SkyOceanContext.Provider value={oceanState}>
        <OceanSamplerContext.Provider value={sampler}>
          <OceanContactContext.Provider value={sampler && contacts}>
            {children}
          </OceanContactContext.Provider>
        </OceanSamplerContext.Provider>
      </SkyOceanContext.Provider>
      {debug?.environment && <SkyCubeView cube={environmentCube} />}
    </SkyContext.Provider>
  );
};
