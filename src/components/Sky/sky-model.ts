import { Color, ColorRepresentation, MathUtils, type Texture } from 'three';
import type { SurfaceDetail } from '../../sdk/materials/surface-detail';
import type { Vec2, Vec3 } from '../../sdk/types/common';
import {
  equatorialToHorizontal,
  localSiderealTime,
  LunarPosition,
  lunarPosition,
  PlanetPosition,
  planetPosition,
  PLANETS,
  precessFromJ2000,
} from '../../sdk/utils/astronomy';
import { SolarPosition, solarPosition } from '../../sdk/utils/solar-position';
import {
  CompassFrame,
  compassBasis,
  directionFromCompass,
} from '../../sdk/utils/vector-operations';
import type { OceanWaterProps } from '../Ocean/ocean-material-sync';
import { DEFAULT_OCEAN_BODY_FOG_DENSITY } from '../Ocean/ocean-volume-material';

/**
 * The sun of a {@link Sky}.
 */
export type SkySun = {
  /** compass bearing in degrees: 0 = north (-Z), 90 = east (+X). Default 200 */
  azimuth?: number;
  /** degrees above the horizon. Default 35 */
  elevation?: number;
  /** intensity of the sky's directional light in full daylight. Default 1.5 */
  intensity?: number;
  /** angular radius of the visible disc, in degrees. Default 0.75 */
  size?: number;
  /** strength of the halo around the sun. Default 0.5 */
  glow?: number;
  /** strength of the bright glare hugging the disc. Default 0.5 */
  glare?: number;
  /** strength of the rays around the disc; 0 for none. Default 0 */
  rays?: number;
  /** the rays shimmer slowly. Default false */
  shimmer?: boolean;
  /** strength of the warm glow along the horizon at sunrise and sunset, and the pink belt opposite it; 0 for none. Default 1 */
  twilight?: number;
};

/**
 * The moon of a {@link Sky}: a full moon opposite the sun, so it is up at night — or,
 * with an observer, the real one, where it stands and as much of it lit as is, by day
 * too. The sky's directional light comes from it once the sun is well down.
 */
export type SkyMoon = {
  /** intensity of the sky's directional light by moonlight, at full night. Default 0.3 */
  intensity?: number;
  /** its colour, and its light's. Default `#c4cfdf` */
  color?: ColorRepresentation;
  /** angular radius of the visible disc, in degrees. Default 0.6 */
  size?: number;
  /** strength of the halo around the moon. Default 0.3 */
  glow?: number;
};

/**
 * The stars of a {@link Sky}, out once it is dark. With an observer they are the real
 * ones, to magnitude 5, and the planets, each out as the sky darkens enough for it,
 * over faint procedural ones; without one, procedural stars.
 */
export type SkyStars = {
  /** Default 1 */
  brightness?: number;
  /** how many procedural ones, from 0 (none) to 1. Default 0.5 */
  density?: number;
  /** without an observer, the latitude they turn for, in degrees: the celestial pole stands this high over north (below 0, south). Default 60 */
  latitude?: number;
};

/** Which of a {@link Sky}'s cloud layers are drawn (see {@link SkyClouds}). */
export type SkyCloudLayers = 'deck' | 'band' | 'both';

/**
 * Still clouds over a {@link Sky}, lit by the sun, or the moon at night, and not reflected by
 * the water: a deck overhead, on a sphere about the Earth's centre ({@link SKY_EARTH_RADIUS}
 * plus `altitude` in radius), and a band of distant clouds along the horizon (`layers`). The
 * deck fades out close to the camera, wisps before cores, so climbing to it clears it from
 * overhead outward.
 */
export type SkyClouds = {
  /** false hides them, still compiled in, so showing them again is instant. Default true */
  enabled?: boolean;
  /**
   * `'deck'` the deck alone, out to the horizon; `'band'` the band alone; `'both'` the band,
   * with the deck meeting it at its base and dissolving where seen nearly edge-on. Switching
   * is instant. Default 'band'
   */
  layers?: SkyCloudLayers;
  /** how much of the sky they cover, from 0 (none) to 1. Default 0.2 */
  coverage?: number;
  /** height of their base along `up`, in world units. Default 6000 */
  altitude?: number;
  /** size of the clouds, in world units. Default 4000 */
  scale?: number;
  /** depth of the clouds, in world units: the band's tops reach this far above their base, and the deck's thicker parts shift against their outlines as the view moves, so it reads as a slab rather than a sheet. Default 1500 */
  thickness?: number;
  /** how far off the band's clouds are, in world units: further, they sit lower, look smaller and are hazier. Default 75000 */
  bandDistance?: number;
  /** width of their edges, from 0 (crisp) to 1. Default 0.25 */
  softness?: number;
  /** how much they stand out from the sky behind them, from 0 (none: no clouds) to 1; the sun, moon and stars stay hidden behind them as if opaque, from 0.5 down less so. Default 1 */
  opacity?: number;
  /** their colour in full light. Default `#ffffff` */
  color?: ColorRepresentation;
  /** picks another pattern. Default 0 */
  seed?: number;
  /** TEMPORARY, to compare: with a curved horizon, the band also sinks a little as the camera climbs, as on a flat sea. Default false */
  bandSink?: boolean;
};

/**
 * The air over a {@link Sky}, thinning with height: higher up the sky deepens and its haze
 * closes onto the horizon, and seen from low down the far sea fades into the horizon.
 */
export type SkyAir = {
  /** height over which the air thins by e, in world units; 0 for no change with height. Default 8000 */
  scaleHeight?: number;
  /** distance over which the air at sea level hazes the sea by e, in world units; 0 for no haze. Default 60000 */
  visibility?: number;
};

/**
 * Sky gradient colours, as display colours: the sky reproduces them exactly
 * without tone mapping.
 */
export type SkyColors = {
  /** straight up */
  zenith?: ColorRepresentation;
  /** just above the horizon */
  horizon?: ColorRepresentation;
  /** just below the horizon */
  ground?: ColorRepresentation;
  /** straight down */
  nadir?: ColorRepresentation;
};

/**
 * Below `level`, an endless lid overhead hides the sky and a bottomless gradient fills
 * the view below the horizon. It is part of the background, so it never hides anything
 * in the scene, including objects above the level.
 */
export type SkyAbyss = {
  /** height of the lid along `up`, in world units. Default 0 */
  level?: number;
  colors?: {
    /** the lid overhead */
    ceiling?: ColorRepresentation;
    /** where lid and depths meet, far away */
    horizon?: ColorRepresentation;
    /** straight down */
    depth?: ColorRepresentation;
  };
  /** distance over which the lid recedes into the horizon colour, in world units. Default 20000 */
  fadeDistance?: number;
  /** depth below `level` over which the void fades in, in world units. Default 200 */
  transition?: number;
  /** depth below `level` over which the void dims toward black, in world units. Default 0 (off) */
  darkening?: number;
  /** strength of the noise relief on the lid; 0 for none. Default 0.2 */
  detail?: number;
  /** size of the noise relief, in world units. Default 1000 */
  detailScale?: number;
  /** strength of the faint distant rock in the depths, wavy strata broken by crags; 0 for none. Default 0.08 */
  depthDetail?: number;
  /** size of that rock's features, relative. Default 1 */
  depthDetailScale?: number;
  /** how the depths darken below the horizon: the gradient's exponent; smaller reaches the depth colour sooner. Default 0.5 */
  falloff?: number;
};

/**
 * The water settings an endless sea shares with the `Ocean` component, under the same
 * names. The sun and the reflected sky come from the {@link Sky}; shoaling and surf
 * need a bathymetry grid, which a flat seabed does not have.
 */
export type SkyOceanWater = Omit<
  OceanWaterProps,
  | 'skyColor'
  | 'horizonColor'
  | 'sunDirection'
  | 'sunColor'
  | 'displacement'
  | 'shoalDepth'
  | 'shoalOpacity'
  | 'shoreFoam'
  | 'shoreBreakDepth'
  | 'surfScale'
  | 'swash'
  | 'shoreNoise'
  | 'shoreNoiseScale'
  | 'shoreFoamStrength'
  | 'shoreFoamFade'
>;

/**
 * The look of a {@link SkyOcean}'s seabed. It is lit by the scene's lights with the
 * model and options of a `ChunkMaterial`, so a chunk layer given the same values
 * continues it without a seam.
 */
export type SkySeabed = {
  /** Default `#b8a06a` */
  color?: ColorRepresentation;
  /** specular highlight colour. Default `#1a1a1a`, as on `ChunkMaterial` */
  specular?: ColorRepresentation;
  /** specular exponent. Default 24, as on `ChunkMaterial` */
  shininess?: number;
  /** ambient multipliers facing up / facing down, or `false` for none. Default `[1.35, 0.5]`, as on `ChunkMaterial` */
  ambient?: Vec2 | false;
  /** procedural relief, or `false` for none. Default `'seabed'` */
  detail?: SurfaceDetail | false;
};

/**
 * An endless sea: a wavy surface at `level` over a flat seabed `depth` below it, seen
 * from above, from inside the water and, below the seabed, as the abyss (which the
 * ocean turns on, at the seabed). The water takes the `Ocean` component's props, so
 * one object can drive both. It is part of the background, so it never hides anything
 * in the scene.
 */
export type SkyOcean = SkyOceanWater & {
  /** the water; off leaves the seabed dry, with no surface or fog. Default true */
  water?: boolean;
  /** the seabed, and its look; off leaves the void below the water, with no lid seen from it. Default true */
  seabed?: boolean | SkySeabed;
  /**
   * How much of what lies beyond the seabed it hides, 0 to 1, as `waterOpacity` is the
   * water's: below 1 the data under it shows through, and so does a `SkyBoxStage`
   * occupant's seabed. Default 1
   */
  seabedOpacity?: number;
  /** height of the sea surface along `up`, in world units. Default 0 */
  level?: number;
  /** depth of the seabed below the surface, in world units. Default 100 */
  depth?: number;
  /** how quickly the water tints what is seen through it, per world unit, as on `Ocean`. Default 0.004 */
  bodyFogDensity?: number;
};

/** The colour and intensity of a {@link SkySubsurface}'s light panels. */
export type SkySubsurfacePanel = {
  /** Default `#ffffff` */
  color?: ColorRepresentation;
  /** radiance of the panels; above 1 they outshine display white. Default 3 */
  intensity?: number;
};

/**
 * The directional light below a {@link Sky}'s seabed, in place of the sun's and the moon's:
 * steady, whatever the time of day. Fixed by default; with `followSun` it turns with the
 * sun's compass bearing.
 */
export type SkySubsurfaceLight = {
  /** turn with the sun's compass bearing, its elevation held within `elevationRange`. Default false */
  followSun?: boolean;
  /** compass bearing in degrees, while not following the sun. Default 200 */
  azimuth?: number;
  /** degrees above the horizon, while not following the sun. Default 45 */
  elevation?: number;
  /** the elevations, in degrees, the sun's is held within while following it. Default [30, 60] */
  elevationRange?: Vec2;
  /** Default `#ffffff`, so it does not tint the data it lights */
  color?: ColorRepresentation;
  /** Default the sun's `intensity` */
  intensity?: number;
  /** seconds the light eases over between the sun's and this as the camera crosses into or out of the subsurface; 0 for at once. Default 0 */
  transition?: number;
};

/**
 * The light below a {@link Sky}'s seabed (or its abyss level), and wherever the sky is not
 * drawn, where its own light means nothing: a dark backdrop and soft light panels, some
 * above the horizon and some below, fixed in the sky's up/north frame, or a map of your
 * own; and a steady directional light in place of the sun's.
 */
export type SkySubsurface = {
  /** a map of your own instead of the backdrop and the panels: an equirectangular or cube texture, as for `scene.background` */
  map?: Texture;
  /** scales the backdrop and the panels. Default 1 */
  intensity?: number;
  /** the backdrop's gradient */
  colors?: {
    /** straight up. Default `#4a5058` */
    top?: ColorRepresentation;
    /** straight down. Default `#1c1f24` */
    bottom?: ColorRepresentation;
  };
  /** the light panels; the ones below the horizon take `below` where given */
  panels?: SkySubsurfacePanel & { below?: SkySubsurfacePanel };
  /** the directional light (see {@link SkySubsurfaceLight}); it needs the Sky's `sunLight` */
  light?: SkySubsurfaceLight;
};

/** Which of a {@link Sky}'s environments lights the scene. */
export type SkyZone = 'air' | 'water' | 'subsurface';

/** What decides a {@link SkyZone}: the sky's levels and switches, as on `SkyMaterial`. */
export type SkyZoneLevels = {
  ocean: boolean;
  oceanLevel: number;
  oceanDepth: number;
  oceanWater: boolean;
  abyss: boolean;
  abyssLevel: number;
  /** the seabed's height under the camera where a stage occupant draws its own; else the sea's flat one */
  oceanGround?: number | null;
  /** a cutaway is on: the scene is lit as from above the water, wherever the camera is */
  cutaway?: boolean;
  /** the sky is drawn */
  background: boolean;
};

/**
 * The environment for a camera at `height` along up: the air above the sea (or the
 * abyss level), the water below its surface, and the subsurface below its seabed — an
 * occupant's own where it has one. A dry sea, or one with a cutaway, is air down to the
 * seabed, and an undrawn sky is all subsurface.
 */
export function skyZone(height: number, levels: SkyZoneLevels): SkyZone {
  if (!levels.background) return 'subsurface';
  if (levels.ocean) {
    if (height > levels.oceanLevel) return 'air';
    const ground = levels.oceanGround ?? levels.oceanLevel - levels.oceanDepth;
    if (height > ground)
      return levels.oceanWater && !levels.cutaway ? 'water' : 'air';
    return 'subsurface';
  }
  return levels.abyss && height < levels.abyssLevel ? 'subsurface' : 'air';
}

/** How far below the sea surface its water is filmed from, in world units. */
export const SKY_WATER_BAKE_DEPTH = 1;

/**
 * The daylight left `depth` below the surface relative to what the water's bake saw, as
 * the sky's water dims it (`waterFogDim`).
 */
export function skyWaterDimming(depth: number, fogDensity: number) {
  return Math.exp(
    -Math.max(depth - SKY_WATER_BAKE_DEPTH, 0) * fogDensity * 0.5,
  );
}

/** A {@link SkySubsurface} with its defaults filled in, as colours in the working space. */
export type SkySubsurfaceColors = {
  top: Color;
  bottom: Color;
  /** the panels above the horizon, colour times intensity */
  above: Color;
  /** the panels below it */
  below: Color;
};

export function skySubsurfaceColors(
  subsurface: SkySubsurface = {},
): SkySubsurfaceColors {
  const defaults = skyDefaults.subsurface;
  const scale = subsurface.intensity ?? defaults.intensity;
  const panels = subsurface.panels ?? {};
  const color = panels.color ?? defaults.panels.color;
  const intensity = panels.intensity ?? defaults.panels.intensity;
  return {
    top: new Color(
      subsurface.colors?.top ?? defaults.colors.top,
    ).multiplyScalar(scale),
    bottom: new Color(
      subsurface.colors?.bottom ?? defaults.colors.bottom,
    ).multiplyScalar(scale),
    above: new Color(color).multiplyScalar(intensity * scale),
    below: new Color(panels.below?.color ?? color).multiplyScalar(
      (panels.below?.intensity ?? intensity) * scale,
    ),
  };
}

/**
 * Where a {@link SkySubsurfaceLight} shines from, in degrees, with the sun at `sunAzimuth`
 * and `sunElevation`: fixed, or the sun's bearing at its elevation held within the range.
 */
export function skySubsurfaceLightPosition(
  sunAzimuth: number,
  sunElevation: number,
  light: SkySubsurfaceLight = {},
) {
  const defaults = skyDefaults.subsurface.light;
  if (!(light.followSun ?? defaults.followSun)) {
    return {
      azimuth: light.azimuth ?? defaults.azimuth,
      elevation: light.elevation ?? defaults.elevation,
    };
  }
  const [a, b] = light.elevationRange ?? defaults.elevationRange;
  return {
    azimuth: sunAzimuth,
    elevation: MathUtils.clamp(sunElevation, Math.min(a, b), Math.max(a, b)),
  };
}

/** The Earth's mean radius, in world units (metres). */
export const SKY_EARTH_RADIUS = 6371000;

export const skyDefaults = {
  sun: {
    azimuth: 200,
    elevation: 35,
    intensity: 1.5,
    size: 0.75,
    glow: 0.5,
    glare: 0.5,
    rays: 0,
    shimmer: false,
    twilight: 1,
  },
  moon: { intensity: 0.3, color: '#c4cfdf', size: 0.6, glow: 0.3 },
  stars: { brightness: 1, density: 0.5, latitude: 60 },
  clouds: {
    layers: 'band' as SkyCloudLayers,
    coverage: 0.2,
    altitude: 6000,
    scale: 4000,
    thickness: 1500,
    bandDistance: 75000,
    softness: 0.25,
    opacity: 1,
    color: '#ffffff',
    seed: 0,
    bandSink: false,
  },
  air: { scaleHeight: 8000, visibility: 60000 },
  colors: {
    zenith: '#6f8fb3',
    horizon: '#c9d3dc',
    ground: '#7a7f86',
    nadir: '#3a3e44',
  },
  intensity: 1,
  horizonBlend: 0.04,
  curvedHorizon: true,
  abyss: {
    level: 0,
    colors: { ceiling: '#2a2d32', horizon: '#4a5058', depth: '#0e1013' },
    fadeDistance: 20000,
    transition: 200,
    darkening: 0,
    detail: 0.2,
    detailScale: 1000,
    depthDetail: 0.08,
    depthDetailScale: 1,
    falloff: 0.5,
  },
  ocean: {
    level: 0,
    depth: 100,
    seabed: {
      color: '#b8a06a',
      specular: '#1a1a1a',
      shininess: 24,
      ambient: [1.35, 0.5],
      detail: 'seabed',
    },
    bodyFogDensity: DEFAULT_OCEAN_BODY_FOG_DENSITY,
    seabedOpacity: 1,
  },
  subsurface: {
    intensity: 1,
    colors: { top: '#4a5058', bottom: '#1c1f24' },
    panels: { color: '#ffffff', intensity: 3 },
    light: {
      followSun: false,
      azimuth: 200,
      elevation: 45,
      elevationRange: [30, 60],
      color: '#ffffff',
      transition: 0,
    },
  },
} as const;

/** Sun disc multiplier when the output is tone mapped. */
export const SKY_HDR_SUN_RADIANCE = 16;

const SUN_HORIZON = new Color('#ff6e33');
const SUN_LOW = new Color('#ffa552');
const SUN_HIGH = new Color('#fff6e8');

/**
 * Daylight for a sun elevation in degrees: 0 below civil twilight (-6), 1 from 10 up.
 */
export function skyDaylight(elevation: number) {
  return MathUtils.smoothstep(elevation, -6, 10);
}

/**
 * Moonlight for a sun elevation in degrees: 0 down to civil twilight (-6), where the
 * daylight is gone, 1 from nautical twilight (-12) down.
 */
export function skyMoonlight(elevation: number) {
  return 1 - MathUtils.smoothstep(elevation, -12, -6);
}

/**
 * Where and when a {@link Sky} is seen from: the sun, the moon and its phase are then
 * the real ones for that moment and place.
 */
export type SkyObserver = {
  /** the moment */
  date: Date;
  /** degrees north */
  latitude: number;
  /** degrees east */
  longitude: number;
};

/** Whether a sky can be computed for `observer`: a real moment and a place on Earth. */
export function skyObserverValid(
  observer: SkyObserver | null | undefined,
): observer is SkyObserver {
  return (
    !!observer &&
    observer.date instanceof Date &&
    Number.isFinite(observer.date.getTime()) &&
    Number.isFinite(observer.latitude) &&
    Math.abs(observer.latitude) <= 90 &&
    Number.isFinite(observer.longitude)
  );
}

/** The sun, the moon and the planets an observer sees. */
export type SkyEphemeris = {
  sun: SolarPosition;
  moon: LunarPosition;
  /** in `PLANETS` order */
  planets: PlanetPosition[];
};

/** The sun, the moon and the planets at `date`, seen from `latitude` and `longitude` (degrees, north and east). */
export function skyEphemeris(
  date: Date,
  latitude: number,
  longitude: number,
): SkyEphemeris {
  return {
    sun: solarPosition(date, latitude, longitude),
    moon: lunarPosition(date, latitude, longitude),
    planets: PLANETS.map(planet =>
      planetPosition(planet, date, latitude, longitude),
    ),
  };
}

/**
 * How much of the full moon's light a moon gives: its phase, as a lit sphere scatters
 * it, and nothing once it is below the horizon.
 */
export function skyMoonShine(moon: LunarPosition) {
  const phase = Math.acos(MathUtils.clamp(2 * moon.illumination - 1, -1, 1));
  const scattered =
    (Math.sin(phase) + (Math.PI - phase) * Math.cos(phase)) / Math.PI;
  return scattered * MathUtils.smoothstep(moon.elevation, -1, 3);
}

/**
 * The frame the stars are fixed in for an observer, as {@link skyStarFrame}'s: the
 * celestial sphere of J2000 — the frame star catalogues use — as it stands over
 * `latitude` and `longitude` (degrees) at `date`.
 */
export function skyCelestialFrame(
  date: Date,
  latitude: number,
  longitude: number,
  frame: CompassFrame = {},
): [Vec3, Vec3, Vec3] {
  const lst = localSiderealTime(date, longitude);
  const axis = (rightAscension: number, declination: number): Vec3 => {
    const now = precessFromJ2000(rightAscension, declination, date);
    const { azimuth, elevation } = equatorialToHorizontal(
      now.rightAscension,
      now.declination,
      lst,
      latitude,
    );
    return directionFromCompass(azimuth, elevation, frame);
  };
  return [axis(0, 0), axis(90, 0), axis(0, 90)];
}

/**
 * How much the horizon glows at sunrise and sunset, for a sun elevation in degrees: most
 * with the sun from just above the horizon to a few degrees below it, none from about 12
 * up nor below -12.
 */
export function skyTwilight(elevation: number) {
  return (
    MathUtils.smoothstep(elevation, -12, -3) *
    (1 - MathUtils.smoothstep(elevation, 1, 12))
  );
}

/** The share of the sky's cells holding a star, for a {@link SkyStars} density. */
export function skyStarShare(density: number) {
  return MathUtils.clamp(density, 0, 1) * 0.06;
}

/**
 * The frame the stars are fixed in, as three world directions: a direction's dot with each
 * is where it points on the star sphere. The sphere turns about the celestial pole, which
 * stands `latitude` degrees over north, with the sun at `azimuth` and `elevation`
 * (degrees), as a day turns it (the sun's drift through the year aside): the stars wheel
 * with the time of day.
 */
export function skyStarFrame(
  azimuth: number,
  elevation: number,
  latitude: number,
  frame: CompassFrame = {},
): [Vec3, Vec3, Vec3] {
  const { up, north, east } = compassBasis(frame);
  const phi = MathUtils.degToRad(latitude);
  const az = MathUtils.degToRad(azimuth);
  const el = MathUtils.degToRad(elevation);
  // In north, east, up: the sun, the pole, and the equator on the meridian.
  const sun = [
    Math.cos(az) * Math.cos(el),
    Math.sin(az) * Math.cos(el),
    Math.sin(el),
  ];
  const pole = [Math.cos(phi), 0, Math.sin(phi)];
  const meridian = [-Math.sin(phi), 0, Math.cos(phi)];
  // The sun's hour angle, westward from the meridian.
  const hour = Math.atan2(-sun[1], sun[0] * meridian[0] + sun[2] * meridian[2]);
  const c = Math.cos(hour);
  const s = Math.sin(hour);
  const toWorld = ([n, e, u]: number[]): Vec3 => [
    north[0] * n + east[0] * e + up[0] * u,
    north[1] * n + east[1] * e + up[1] * u,
    north[2] * n + east[2] * e + up[2] * u,
  ];
  // West is (0, -1, 0).
  return [
    toWorld([meridian[0] * c, -s, meridian[2] * c]),
    toWorld([-meridian[0] * s, -c, -meridian[2] * s]),
    toWorld(pole),
  ];
}

/**
 * Sun colour for an elevation in degrees: deep red-orange on the horizon, orange a few
 * degrees up, near white from 25.
 */
export function skySunColor(elevation: number, target = new Color()) {
  if (elevation < 6) {
    return target
      .copy(SUN_HORIZON)
      .lerp(SUN_LOW, MathUtils.smoothstep(elevation, -2, 6));
  }
  return target
    .copy(SUN_LOW)
    .lerp(SUN_HIGH, MathUtils.smoothstep(elevation, 6, 25));
}
