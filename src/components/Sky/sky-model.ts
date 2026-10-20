import { Color, ColorRepresentation, MathUtils } from 'three';
import type { SurfaceDetail } from '../../sdk/materials/surface-detail';
import type { Vec2 } from '../../sdk/types/common';
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
};

/**
 * The moon of a {@link Sky}, kept simple: a full moon opposite the sun, so it is up at
 * night. The sky's directional light comes from it once the sun is well down.
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

/** Faint stars of a {@link Sky}, out once it is dark. */
export type SkyStars = {
  /** Default 0.6 */
  brightness?: number;
  /** how many, from 0 (none) to 1. Default 0.5 */
  density?: number;
};

/**
 * A deck of still clouds over a {@link Sky}, seen from below and lit by the sun, or the
 * moon at night. They fade out as the camera climbs to the deck, and are not reflected
 * by the water.
 */
export type SkyClouds = {
  /** how much of the sky they cover, from 0 to 1. Default 0.4 */
  coverage?: number;
  /** height of the deck along `up`, in world units. Default 6000 */
  altitude?: number;
  /** size of the clouds, in world units. Default 4000 */
  scale?: number;
  /** width of their edges, from 0 (crisp) to 1. Default 0.25 */
  softness?: number;
  /** Default 0.9 */
  opacity?: number;
  /** their colour in full light. Default `#ffffff` */
  color?: ColorRepresentation;
  /** picks another pattern. Default 0 */
  seed?: number;
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
export type SkySubsurfaceLight = {
  /** Default `#ffffff` */
  color?: ColorRepresentation;
  /** radiance of the panels; above 1 they outshine display white. Default 3 */
  intensity?: number;
};

/**
 * The light below a {@link Sky}'s seabed (or its abyss level), and wherever the sky is not
 * drawn, where its own light means nothing: a dark backdrop and soft light panels, some
 * above the horizon and some below, fixed in the sky's up/north frame.
 */
export type SkySubsurface = {
  /** scales the whole subsurface light. Default 1 */
  intensity?: number;
  /** the backdrop's gradient */
  colors?: {
    /** straight up. Default `#4a5058` */
    top?: ColorRepresentation;
    /** straight down. Default `#1c1f24` */
    bottom?: ColorRepresentation;
  };
  /** the light panels; the ones below the horizon take `below` where given */
  lights?: SkySubsurfaceLight & { below?: SkySubsurfaceLight };
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
  /** the sky is drawn */
  background: boolean;
};

/**
 * The environment for a camera at `height` along up: the air above the sea (or the
 * abyss level), the water below its surface, and the subsurface below its seabed — an
 * occupant's own where it has one. A dry sea is air down to the seabed, and an undrawn
 * sky is all subsurface.
 */
export function skyZone(height: number, levels: SkyZoneLevels): SkyZone {
  if (!levels.background) return 'subsurface';
  if (levels.ocean) {
    if (height > levels.oceanLevel) return 'air';
    const ground = levels.oceanGround ?? levels.oceanLevel - levels.oceanDepth;
    if (height > ground) return levels.oceanWater ? 'water' : 'air';
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
  const light = subsurface.lights ?? {};
  const color = light.color ?? defaults.lights.color;
  const intensity = light.intensity ?? defaults.lights.intensity;
  return {
    top: new Color(
      subsurface.colors?.top ?? defaults.colors.top,
    ).multiplyScalar(scale),
    bottom: new Color(
      subsurface.colors?.bottom ?? defaults.colors.bottom,
    ).multiplyScalar(scale),
    above: new Color(color).multiplyScalar(intensity * scale),
    below: new Color(light.below?.color ?? color).multiplyScalar(
      (light.below?.intensity ?? intensity) * scale,
    ),
  };
}

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
  },
  moon: { intensity: 0.3, color: '#c4cfdf', size: 0.6, glow: 0.3 },
  stars: { brightness: 0.6, density: 0.5 },
  clouds: {
    coverage: 0.4,
    altitude: 6000,
    scale: 4000,
    softness: 0.25,
    opacity: 0.9,
    color: '#ffffff',
    seed: 0,
  },
  colors: {
    zenith: '#6f8fb3',
    horizon: '#c9d3dc',
    ground: '#7a7f86',
    nadir: '#3a3e44',
  },
  intensity: 1,
  horizonBlend: 0.04,
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
    lights: { color: '#ffffff', intensity: 3 },
  },
} as const;

/** Sun disc multiplier when the output is tone mapped. */
export const SKY_HDR_SUN_RADIANCE = 16;

const SUN_LOW = new Color('#ffb36b');
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

/** The share of the sky's cells holding a star, for a {@link SkyStars} density. */
export function skyStarShare(density: number) {
  return MathUtils.clamp(density, 0, 1) * 0.06;
}

/**
 * Sun colour for an elevation in degrees: warm near the horizon, near white higher up.
 */
export function skySunColor(elevation: number, target = new Color()) {
  return target
    .copy(SUN_LOW)
    .lerp(SUN_HIGH, MathUtils.smoothstep(elevation, 0, 25));
}
