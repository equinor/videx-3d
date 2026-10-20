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
  DoubleSide,
  Group,
  LightProbe,
  MathUtils,
  NoToneMapping,
  Object3D,
  PerspectiveCamera,
  ShaderMaterial,
  SphericalHarmonics3,
  Texture,
  Vector2,
  Vector3,
  Vector4,
} from 'three';
import { precompile } from '../../rendering/precompile';
import { surfaceDetailKey } from '../../sdk/materials/surface-detail';
import { Vec3 } from '../../sdk/types/common';
import { directionFromCompass } from '../../sdk/utils/vector-operations';
import { OceanMaterial } from '../Ocean/ocean-material';
import { applyOceanWaterProps } from '../Ocean/ocean-material-sync';
import standInFragmentShader from './shaders/sky-stand-in-fragment.glsl';
import skyVertexShader from './shaders/sky-vertex.glsl';
import { SkyBaker } from './sky-baker';
import {
  SkyContext,
  SkyOceanContext,
  SkyOceanState,
  SkyState,
} from './sky-context';
import { createSkyGeometry, SkyMaterial } from './sky-material';
import {
  SKY_HDR_SUN_RADIANCE,
  SkyAbyss,
  SkyClouds,
  SkyColors,
  skyDaylight,
  skyDefaults,
  SkyMoon,
  skyMoonlight,
  SkyOcean,
  SkySeabed,
  skyStarShare,
  SkyStars,
  SkyStudio,
  skyStudioColors,
  SkySun,
  skySunColor,
  skyWaterDimming,
  SkyZone,
  skyZone,
} from './sky-model';
import { createSkySurfaceMaterial } from './sky-stage';
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
 * How often the environment and the light probe are baked again while the sky keeps
 * changing, as while a slider is dragged. The last change is always baked, once the
 * interval has passed. A camera moving never bakes.
 */
export type SkyCaptureOptions = {
  /** least time between two bakes, in milliseconds. Default 250 */
  interval?: number;
};

/** A layer the {@link Sky} draws itself: its background, and its sea's surface layer. */
export type SkyLayer = 'background' | 'surface';

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
 * A cut through the sea's water and seabed in front of the view, so what lies under it is
 * seen clearly: everything nearer than a line across the view, where a row of the frame
 * meets the surface (or the seabed, with the camera in the water). Waves bend the line, a
 * rim marks it on the surface and a shadow falls just inside it. It follows the camera. An
 * occupant and the data are never cut.
 */
export type SkyCutaway = {
  /** opacity of the water left in the cut, surface and fog alike; 0 cuts it all. Default 0 */
  waterOpacity?: number;
  /** opacity of the seabed left in the cut; 0 opens it to the void, and what lies behind it. Default 0 */
  seabedOpacity?: number;
  /** the frame row whose sight line sets the edge looking level: 0 the bottom, 1 the top. Tilting down raises it to the top, looking straight down. Default 0.5 */
  reach?: number;
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

/**
 * Views for seeing how the sky and a `SkyBoxStage` fit together. They only change what
 * is drawn: nothing is rebuilt or baked again, and the bakes never see them.
 */
export type SkyDebug = {
  /**
   * Tint each part by what draws it. The sky: its sea, seabed and void red, what it
   * leaves to a stage purple, its surface layer orange. A stage: its surface blue, flat
   * seabed green, relief cyan, an occupant's seabed magenta, walls yellow. Untinted is
   * the scene.
   */
  tint?: boolean;
  /** layers not to draw */
  hide?: SkyLayer[];
  /** the environment's bake for the zone in view as its six faces, in the canvas' lower right corner (`+Y` over `-X -Z +X +Z`, `-Y` under) */
  environment?: boolean;
};

/**
 * Sky props
 * @expand
 */
export type SkyProps = {
  sun?: SkySun;
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
   * Draw the sky, and its `SkyBoxStage`, behind the scene. Switched instantly: nothing
   * is rebuilt or baked again, and the environment and the light probe stay on, lit by
   * the `subsurface` studio. Default true
   */
  background?: boolean;
  /** below a level, a lid hides the sky and a void fills the view (see {@link SkyAbyss}). Default false */
  abyss?: boolean | SkyAbyss;
  /** an endless sea; below its seabed the abyss takes over (see {@link SkyOcean}). Default false */
  ocean?: boolean | SkyOcean;
  /** bake the sky into `scene.environment`, which lights MeshStandard/MeshPhysical materials. Default true */
  environment?: boolean | SkyEnvironmentOptions;
  /** bake the sky into a LightProbe, which lights every `lights: true` material. Default true */
  lightProbe?: boolean | SkyLightProbeOptions;
  /**
   * The light below the seabed (or the abyss level), and wherever the sky is not drawn: a
   * studio (see {@link SkyStudio}), or a map of your own (an equirectangular or cube
   * texture, as for `scene.background`). Default a studio
   */
  subsurface?: SkyStudio | Texture;
  /** how often the bakes follow a changing sky (see {@link SkyCaptureOptions}) */
  capture?: SkyCaptureOptions;
  /** cut away the sea's water and seabed in front of the view (see {@link SkyCutaway}). Default false */
  cutaway?: boolean | SkyCutaway;
  /** add a directional light from the sun, and from the moon at night. Default true */
  sunLight?: boolean;
  /** a moon opposite the sun, for some light at night (see {@link SkyMoon}). Default true */
  moon?: boolean | SkyMoon;
  /** faint stars at night (see {@link SkyStars}). Default true */
  stars?: boolean | SkyStars;
  /** a deck of still clouds (see {@link SkyClouds}). Default false */
  clouds?: boolean | SkyClouds;
  /**
   * The output is tone mapped, so the sun disc may go past display white. Defaults to
   * the renderer's `toneMapping`; set it when a pipeline pass tone maps instead.
   */
  hdr?: boolean;
  /** Default -1e9, so the sky is drawn before everything else */
  renderOrder?: number;
  /** debug views (see {@link SkyDebug}) */
  debug?: SkyDebug;
  children?: ReactNode;
};

const DEFAULT_ENVIRONMENT_RESOLUTION = 128;
const DEFAULT_CAPTURE_INTERVAL = 250;
// Narrowest edge, in world units: a fade of none is undefined in the shader.
const CUTAWAY_MIN_EDGE = 0.01;
// The cutaway's tip row never looks flatter than this (sine; about 0.6° below the horizon).
const CUTAWAY_MIN_DOWN = 0.01;
// Past the frame's top, for the rim and its antialiasing: of the frame's half-width there.
const CUTAWAY_EXIT_MARGIN = 0.05;
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
    side: DoubleSide,
    depthTest: false,
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
 * the air over the sea, the water in it and, below the seabed, the `subsurface` studio —
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
  colors,
  up,
  north,
  intensity = skyDefaults.intensity,
  horizonBlend = skyDefaults.horizonBlend,
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
  clouds = false,
  hdr,
  renderOrder = -1e9,
  debug,
  children,
}: SkyProps) => {
  const gl = useThree(state => state.gl);
  const scene = useThree(state => state.scene);
  const sceneCamera = useThree(state => state.camera);

  const azimuth = sun?.azimuth ?? skyDefaults.sun.azimuth;
  const elevation = sun?.elevation ?? skyDefaults.sun.elevation;
  const sunIntensity = sun?.intensity ?? skyDefaults.sun.intensity;
  const sunSize = sun?.size ?? skyDefaults.sun.size;
  const sunGlow = sun?.glow ?? skyDefaults.sun.glow;
  const sunGlare = sun?.glare ?? skyDefaults.sun.glare;
  const sunRays = sun?.rays ?? skyDefaults.sun.rays;
  const sunShimmer = sun?.shimmer ?? skyDefaults.sun.shimmer;
  const moonOptions: SkyMoon | null = moon === true ? {} : moon || null;
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
  const cloudsOptions: SkyClouds | null = clouds === true ? {} : clouds || null;
  const cloudsOn = cloudsOptions !== null;
  const cloudDefaults = skyDefaults.clouds;
  const cloudCoverage = cloudsOptions?.coverage ?? cloudDefaults.coverage;
  const cloudAltitude = cloudsOptions?.altitude ?? cloudDefaults.altitude;
  const cloudScale = cloudsOptions?.scale ?? cloudDefaults.scale;
  const cloudSoftness = cloudsOptions?.softness ?? cloudDefaults.softness;
  const cloudOpacity = cloudsOptions?.opacity ?? cloudDefaults.opacity;
  const cloudColor = toHex(cloudsOptions?.color ?? cloudDefaults.color);
  const cloudSeed = cloudsOptions?.seed ?? cloudDefaults.seed;
  const zenith = toHex(colors?.zenith ?? skyDefaults.colors.zenith);
  const horizon = toHex(colors?.horizon ?? skyDefaults.colors.horizon);
  const ground = toHex(colors?.ground ?? skyDefaults.colors.ground);
  const nadir = toHex(colors?.nadir ?? skyDefaults.colors.nadir);
  const [upX, upY, upZ] = up ?? DEFAULT_UP;
  const [northX, northY, northZ] = north ?? DEFAULT_NORTH;

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

  const oceanOptions: SkyOcean | null = ocean === true ? {} : ocean || null;
  const hasOcean = oceanOptions !== null;
  const oceanDefaults = skyDefaults.ocean;
  const oceanLevel = oceanOptions?.level ?? oceanDefaults.level;
  const oceanDepth = oceanOptions?.depth ?? oceanDefaults.depth;
  const oceanWater = oceanOptions?.water ?? true;
  const oceanSeabed = oceanOptions?.seabed !== false;
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

  const [material] = useState(() => new SkyMaterial());
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

  // In render rather than an effect, so a stage made in this commit compiles with it. A
  // no-op unless the detail changed. The waves' defines likewise, for the surface layer.
  material.oceanBedDetail = bedDetail;
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
    const sunDirection = new Vector3().fromArray(
      directionFromCompass(azimuth, elevation, {
        up: [upX, upY, upZ],
        north: [northX, northY, northZ],
      }),
    );
    return {
      sunDirection,
      sunColor: skySunColor(elevation),
      daylight: skyDaylight(elevation),
      moonDirection: sunDirection.clone().negate(),
      moonlight: skyMoonlight(elevation),
    };
  }, [azimuth, elevation, upX, upY, upZ, northX, northY, northZ]);

  // One directional light, so nothing recompiles at dusk: the sun's fades out by
  // twilight, and only then does the moon's fade in.
  const byMoon = moonOptions !== null && state.daylight <= 0;
  const lightDirection = byMoon ? state.moonDirection : state.sunDirection;
  const lightColor = byMoon ? moonColor : state.sunColor;
  const lightIntensity = byMoon
    ? moonIntensity * state.moonlight
    : sunIntensity * state.daylight;

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
            level: oceanLevel,
            depth: oceanDepth,
            water: oceanWater,
            seabed: oceanSeabed,
            bedDetail: bedDetailKey,
            visible: background,
            ready,
            stage: addStage,
          }
        : null,
    [
      water,
      material,
      oceanLevel,
      oceanDepth,
      oceanWater,
      oceanSeabed,
      bedDetailKey,
      background,
      ready,
      addStage,
    ],
  );

  const surfaceLayer = useMemo(
    () => (water ? createSkySurfaceMaterial(material) : null),
    [water, material],
  );

  useEffect(() => () => surfaceLayer?.dispose(), [surfaceLayer]);

  const dirty = useRef(true);
  // The zones whose environment and light probe are due a bake; each zone's coefficients.
  const stale = useRef({
    environment: new Set<SkyZone>(),
    probe: new Set<SkyZone>(),
  });
  const zoneProbes = useRef<Partial<Record<SkyZone, SphericalHarmonics3>>>({});
  const appliedProbe = useRef<SphericalHarmonics3 | null>(null);
  const zoneInView = useRef<SkyZone>('air');
  const lastBake = useRef(-Infinity);
  // One readback at a time: they are slow to come back, and piled up they stall.
  const probeBusy = useRef(false);
  const captureInterval = capture?.interval ?? DEFAULT_CAPTURE_INTERVAL;
  // The zones the camera can be in; the studio also lights an undrawn sky.
  const zones = useMemo<SkyZone[]>(
    () =>
      hasOcean && oceanWater
        ? ['air', 'water', 'subsurface']
        : ['air', 'subsurface'],
    [hasOcean, oceanWater],
  );

  const subsurfaceMap = (subsurface as Texture | undefined)?.isTexture
    ? (subsurface as Texture)
    : null;
  const studio = subsurfaceMap ? null : (subsurface as SkyStudio | undefined);
  const studioKey = JSON.stringify(studio ?? null);
  useLayoutEffect(() => {
    baker.setSubsurface(
      subsurfaceMap
        ? { map: subsurfaceMap }
        : { studio: skyStudioColors(studio ?? undefined) },
    );
    dirty.current = true;
    // `studio` is an inline object: compared by value, as `studioKey`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baker, subsurfaceMap, studioKey]);

  useLayoutEffect(() => {
    material.setFrame({
      up: [upX, upY, upZ],
      north: [northX, northY, northZ],
    });
    material.sunDirection = state.sunDirection;
    material.sunColor = state.sunColor;
    material.daylight = state.daylight;
    material.sunSize = sunSize;
    material.sunGlow = sunGlow;
    material.sunGlare = sunGlare;
    material.sunRays = sunRays;
    material.moonDirection = state.moonDirection;
    material.moonColor = moonColor;
    material.moonSize = moonSize;
    material.moonGlow = moonGlow;
    material.night = 1 - state.daylight;
    material.setStars(starBrightness, starShare);
    material.clouds = cloudsOn;
    material.setClouds({
      coverage: cloudCoverage,
      altitude: cloudAltitude,
      scale: cloudScale,
      softness: cloudSoftness,
      opacity: cloudOpacity,
      color: cloudColor,
      seed: cloudSeed,
    });
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
    sunGlare,
    sunRays,
    moonColor,
    moonSize,
    moonGlow,
    starBrightness,
    starShare,
    cloudsOn,
    cloudCoverage,
    cloudAltitude,
    cloudScale,
    cloudSoftness,
    cloudOpacity,
    cloudColor,
    cloudSeed,
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
  ]);

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
  ]);

  // Every render: the props are an inline object, and applying them is cheap.
  useLayoutEffect(() => {
    if (!water || !oceanOptions) return;
    applyOceanWaterProps(water, oceanOptions);
    material.oceanShimmer =
      oceanOptions.bodyShimmer ?? oceanDefaults.bodyShimmer;
    material.oceanBodyOpacity =
      oceanOptions.bodyMaxOpacity ?? water.waterOpacity;
  });

  // The bakes see the water too, but an inline object is new every render.
  const waterKey = oceanOptions ? JSON.stringify(oceanOptions) : '';
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
  }, [water, lightDirection, lightColor, lightIntensity, sunIntensity]);

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
      baker.precompile(gl, resolution),
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
  ]);

  const cutawayOptions = cutaway === true ? {} : cutaway || null;
  const cutawayWaterOpacity = MathUtils.clamp(
    cutawayOptions?.waterOpacity ?? 0,
    0,
    1,
  );
  const cutawaySeabedOpacity = MathUtils.clamp(
    cutawayOptions?.seabedOpacity ?? 0,
    0,
    1,
  );
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
  });
  const [cutawayRay] = useState(() => new Vector3());

  // Bakes run here so several prop changes in one frame cost one bake.
  useFrame(({ camera }, delta) => {
    if (water) water.time += delta;
    if (sunShimmer && sunRays > 0) material.sunRayPhase += delta;
    material.sunRadiance =
      (hdr ?? gl.toneMapping !== NoToneMapping) ? SKY_HDR_SUN_RADIANCE : 1;

    const height = camera.position.dot(material.up);
    const zone = skyZone(height, {
      ocean: material.ocean,
      oceanLevel: material.oceanLevel,
      oceanDepth: material.oceanDepth,
      oceanWater: material.oceanWater,
      oceanDrained: material.oceanDrained,
      oceanGround: material.oceanGround,
      abyss: material.abyss,
      abyssLevel: material.abyssLevel,
      background,
    });
    zoneInView.current = zone;
    // Inside an occupant's seabed above the sea's own, the stage's relief is seen from below.
    material.oceanBuried =
      material.ocean &&
      material.oceanGround !== null &&
      height <= material.oceanGround &&
      height > material.oceanLevel - material.oceanDepth;

    // The cutaway: from below the camera to where the `reach` row meets its plane, the
    // surface from above the water and the seabed from in it.
    const cutawayShape = material.uniforms.uSkyOceanCutawayShape
      .value as Vector4;
    const size = cutawaySize.current;
    const plane =
      zone === 'air' && height > material.oceanLevel
        ? material.oceanLevel
        : zone === 'water'
          ? material.oceanLevel - material.oceanDepth
          : null;
    const altitude = plane === null ? 0 : height - plane;
    if (
      !cutawayOptions ||
      !material.ocean ||
      !material.oceanWater ||
      plane === null ||
      altitude <= 0
    ) {
      cutawayShape.y = 0;
      size.active = false;
    } else {
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
      let target = reach * scale;
      const exit = MathUtils.smoothstep(tilt, cutawayExitTilt / 90, 1);
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
        target = MathUtils.lerp(
          target,
          Math.max(target, top - shift + clearance),
          exit,
        );
      }
      // The size eases, so a tilt near the horizon never makes the edge jump. Switching
      // plane starts it over: the cutaway keeps its place in the frame either way.
      if (size.plane !== plane) size.active = false;
      const ease =
        size.active && cutawayEase > 0 ? 1 - Math.exp(-delta / cutawayEase) : 1;
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
        cutawayWaterOpacity,
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
      material.uniforms.uSkyOceanCutawaySeabedOpacity.value =
        cutawaySeabedOpacity;
      // Thinning with the cut, down to a pixel.
      (material.uniforms.uSkyOceanCutawayRim.value as Vector4).set(
        cutawayRimColor.r,
        cutawayRimColor.g,
        cutawayRimColor.b,
        Math.max(cutawayRimWidth * far, Math.min(cutawayRimWidth, 1)),
      );
      (material.uniforms.uSkyOceanCutawayShadow.value as Vector2).set(
        cutawayShadowOpacity,
        width * cutawayShadowWidth,
      );
    }

    const { environment: environmentDue, probe: probeDue } = stale.current;
    if (dirty.current) {
      dirty.current = false;
      for (const z of zones) {
        if (hasEnvironment) environmentDue.add(z);
        if (hasProbe) probeDue.add(z);
      }
    }

    // The zone in view first, then the others: one zone a frame, one readback at a time.
    const due = (z: SkyZone) =>
      environmentDue.has(z) || (probeDue.has(z) && !probeBusy.current);
    const next = due(zone) ? zone : zones.find(due);
    const now = performance.now();
    if (ready && next && now - lastBake.current >= captureInterval) {
      lastBake.current = now;
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
            }
            zoneProbes.current[next] = sh;
          })
          .finally(() => {
            probeBusy.current = false;
          });
      }
    }

    // The zone's bakes, swapped in as the camera crosses a level: no GPU work.
    const dim =
      zone === 'water'
        ? skyWaterDimming(
            material.oceanLevel - height,
            material.oceanFogDensity,
          )
        : 1;
    if (hasEnvironment) {
      const map = baker.environmentOf(zone);
      if (map && scene.environment !== map) scene.environment = map;
      scene.environmentIntensity = environmentIntensity * dim;
    }
    const zoneProbe = zoneProbes.current[zone];
    if (zoneProbe && appliedProbe.current !== zoneProbe) {
      probe.sh.copy(zoneProbe);
      appliedProbe.current = zoneProbe;
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
          visible={background && ready && !debug?.hide?.includes('background')}
          dispose={null}
        />
        {surfaceLayer && oceanWater && (
          <mesh
            geometry={geometry}
            material={surfaceLayer}
            frustumCulled={false}
            renderOrder={renderOrder + 1}
            visible={background && ready && !debug?.hide?.includes('surface')}
            dispose={null}
          />
        )}
      </group>
      <mesh
        geometry={geometry}
        material={standIn}
        frustumCulled={false}
        renderOrder={renderOrder}
        visible={background && !ready}
        dispose={null}
      />
      {hasProbe && <primitive object={probe} />}
      {sunLight && (
        <>
          <directionalLight
            position={lightDirection}
            target={lightTarget}
            color={lightColor}
            intensity={lightIntensity}
          />
          <primitive object={lightTarget} />
        </>
      )}
      <SkyOceanContext.Provider value={oceanState}>
        {children}
      </SkyOceanContext.Provider>
      {debug?.environment && <SkyCubeView cube={environmentCube} />}
    </SkyContext.Provider>
  );
};
