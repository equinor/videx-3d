import { Color, ColorRepresentation, MathUtils, type Texture } from 'three';
import type { SurfaceDetail } from '../../sdk/materials/surface-detail';
import { EARTH_RADIUS } from '../../sdk/projection/globe';
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
import type {
  CloudLayer,
  CloudLayersPreset,
  CloudLevel,
  CloudType,
} from '../../sdk/weather/weather';
import type { OceanWaterProps } from '../Ocean/ocean-material-sync';
import type { SeaQuality } from '../../sdk/weather/sea-state';

/**
 * The sun of a {@link Scenery}.
 */
export type SkySun = {
  /** compass bearing in degrees: 0 = north (-Z), 90 = east (+X). Default 200 */
  azimuth?: number;
  /** degrees above the horizon. Default 35 */
  elevation?: number;
  /** intensity of the sky's directional light in full daylight. Default 1.5 */
  intensity?: number;
  /** angular radius of the visible disc, in degrees. Default 0.267, the real sun's */
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
 * The moon of a {@link Scenery}: a full moon opposite the sun, so it is up at night — or,
 * with an observer, the real one, where it stands and as much of it lit as is, by day
 * too. The sky's directional light comes from it once the sun is well down.
 */
export type SkyMoon = {
  /** intensity of the sky's directional light by moonlight, at full night. Default 0.3 */
  intensity?: number;
  /** its colour, and its light's. Default `#c4cfdf` */
  color?: ColorRepresentation;
  /** angular radius of the visible disc, in degrees. Default the real moon's: 0.259 at its mean distance, or with an observer as far as it then is (0.245 to 0.279) */
  size?: number;
  /** strength of its glare at night, at the disc's edge, as the sun's `glare` (by its phase's light, and dimmed with it by the air). Default 0.3 */
  glow?: number;
};

/**
 * The stars of a {@link Scenery}, out once it is dark. With an observer they are the real
 * ones, to magnitude 5, and the planets, each out as the sky darkens enough for it,
 * over faint procedural ones (none brighter than magnitude 6.5); without one, procedural
 * stars.
 */
export type SkyStars = {
  /** Default 1 */
  brightness?: number;
  /** how many procedural ones, from 0 (none) to 1. Default 0.5 */
  density?: number;
  /** without an observer, the latitude they turn for, in degrees: the celestial pole stands this high over north (below 0, south). Default 60 */
  latitude?: number;
};

/**
 * How much a {@link SceneryCloudsProps}'s clouds spend for how they look (`CLOUDS_QUALITY`),
 * from `'low'` (a laptop's integrated GPU) to `'ultra'` (powerful GPUs). `'medium'` takes some
 * 5–6.5 ms a frame at 1920 × 1080 on a laptop's RTX A1000 as the camera moves about the clouds.
 * Low and medium read the clouds' shape once a step, high and ultra twice: a march program each,
 * compiled off the main thread as the quality switches to it, the clouds drawn as they were
 * meanwhile. Low and medium draw their shadows on the ground 512² texels, high and ultra 1024²,
 * as sharp from some 6.5 km up as 512² from 2 km.
 */
export type SceneryCloudsQuality = 'low' | 'medium' | 'high' | 'ultra';

/**
 * How a {@link SceneryCloudsProps}'s clouds reuse what they marched over the last frames.
 * `'off'`: every pixel marched every frame. `'still'`: while the camera holds still (the
 * weather's clock running), a quarter of the pixels a frame, each of the rest as it was marched
 * at most three frames before; every pixel once the camera moves. `'moving'`: a quarter a frame
 * however the camera moves, the rest moved to where their clouds lie in the view now.
 */
export type SceneryCloudsTemporal = 'off' | 'still' | 'moving';

/**
 * What a {@link SceneryCloudsProps}'s clouds show instead of themselves, to see how they
 * are made: `view` `'cost'` the march's iterations along each view (blue none, through green and
 * yellow, to red at the quality's most), `'unlit'` white, as opaque as they are, `'map'` a global
 * weather's map: each level's cover where the view meets the sea (low red, middle green, high
 * blue), `'temporal'` where each pixel of an interleaved march ({@link SceneryCloudsTemporal})
 * came from: this frame's march as it is, an older one's taken where it was green, moved to
 * where its cloud lies now blue, turning red the more this frame's march held it, and this
 * frame's between its pixels where the older one's camera did not see yellow; `air` false
 * leaves out the air's haze between them and the camera.
 */
export type SceneryCloudsDebug = {
  view?: 'cost' | 'unlit' | 'map' | 'temporal';
  air?: boolean;
  /** Being chosen (2026-11-09), then removed: a global weather's level looks as its place along its chain of types (true) or as the chain's first type. Default true */
  types?: boolean;
  /** Being chosen, then removed: the low cloud's thickness sets how deep and dense a global weather's cloud is (true), or its type alone. Default true */
  thickness?: boolean;
};

/**
 * How a {@link SceneryCloudsProps}'s clouds draw a `CloudType` (`CLOUDS_LOOKS` its
 * defaults): rounded masses of many sizes, domed over flat bases and rounding off below their
 * layer's top, from a map of how much each column is clouded over (fixed to the Earth, drifting
 * with the layer's wind). Shares and weights from 0 to 1 unless said.
 */
export type SceneryCloudLook = {
  /** how large its clouds and the gaps between them are, relative to cumulus' */
  scale?: number;
  /** how far its pattern is drawn out along the wind: 1 not at all, 6 cirrus' streaks */
  stretch?: number;
  /** how soft its clouds' edges are */
  softness?: number;
  /** how far lumps of a few hundred metres move its clouds' surface, close up */
  lumps?: number;
  /** how many of its columns reach far up its layer: few, flat clouds; many, tall */
  towering?: number;
  /** how much rounded masses weigh against broad patches in its pattern (to 1.5) */
  masses?: number;
  /** how much light a metre of its cloud takes (1 / metre, by the `density`): thin veils far less */
  extinction?: number;
  /**
   * how long one of its clouds lasts as it forms and fades (seconds of the weather's clock), one
   * some 1.5 km across at its `scale`; the larger ones last longer, the smaller less
   */
  lifetime?: number;
  /** how fast its lumps rise through it (m/s of the weather's clock): cumulus' boil */
  rise?: number;
};

/**
 * 3D clouds over a {@link Scenery} (see `documents/clouds.md`): a local weather's layers, one at
 * each level (low, middle, high), or a global weather's weather systems over the whole Earth,
 * each level its type's rounded masses marched through on the globe, lit by the sun, or the
 * moon, where they lie, the levels over a cloud shading it, and drawn over the scene at the
 * depth of their front: marched again only as the view, the clock or the light change. Fixed to
 * the Earth, each level drifting with its wind, its clouds forming and fading on the weather's
 * clock. The scenery's bakes of the air and its sea's reflection take them in, the scene's light
 * is dimmed by the share of it they let through, and their shadows fall on the sea and the
 * relief.
 */
export type SceneryCloudsProps = {
  /** false hides them, still compiled, so showing them again is instant. Default true */
  enabled?: boolean;
  /**
   * The cloud layers of a local weather, its own whatever the weather's: one a level is drawn
   * (`CloudLevel`; of two there, the one covering more), kept in proportion (`dominance`). Or by
   * name (`CloudLayersPreset`): a sky (`SKY_PRESETS`), or a report's cover, cumulus unless the
   * type follows (`'broken'`, `'overcast stratus'`). Given, the weather is local (about the
   * enclosing `Weather`'s `local`, or its defaults). Default the enclosing `Weather`'s, and
   * without one a few high clouds (`'few-high'`), local, so they hide little of the scene
   */
  layers?: CloudLayer[] | CloudLayersPreset;
  /**
   * how far the level covering most dominates the sky (`cloudLayersInProportion`): every other
   * level's cover is cut by this times its cover. 1: under an overcast no other level shows; 0:
   * each level as given. Default 0.8
   */
  dominance?: number;
  /** how each type is drawn, by type, over `CLOUDS_LOOKS`. Default those */
  looks?: Partial<Record<CloudType, SceneryCloudLook>>;
  /**
   * a global weather's levels drawn: false leaves one out, a quality control as much as a look
   * (each costs its share of the march). A local weather draws the levels its layers lie at.
   * Default all
   */
  levels?: Partial<Record<CloudLevel, boolean>>;
  /** size of the clouds and the gaps between them, relative: 2 makes them twice as large. Default 1 */
  scale?: number;
  /** how dense they are inside, relative: lower lets more light through their edges. Default 1 */
  density?: number;
  /** their colour in full light. Default `#ffffff` */
  color?: ColorRepresentation;
  /** picks another pattern of clouds. Default 0 */
  seed?: number;
  /**
   * how much they spend for how they look (`CLOUDS_QUALITY`): the share of the screen's
   * resolution they are marched at, how finely, how much of it a frame (`temporal`), and how
   * finely their shadows are drawn. Default `'medium'`
   */
  quality?: SceneryCloudsQuality;
  /**
   * the share of the screen's resolution in CSS pixels their image is drawn at (whatever the
   * screen's pixel ratio), from 0.25 to 1, instead of the quality's. Default the quality's
   */
  resolution?: number;
  /** what they show instead of themselves, to see how they are made. Default none */
  debug?: SceneryCloudsDebug;
  /**
   * a local weather's clouds lit from light maps — for each level, how much of its cloud lies
   * toward the light from anywhere in it, drawn a few rows a frame and faded in — rather than
   * marched toward the light from every point lit. A moving view or clock costs some 12–15 %
   * less, for some 25 MB and about 1 ms a frame while a map is drawn anew: as the clouds form
   * and fade and the sun moves, so under a fast clock (a timelapse) the light lags and the maps
   * are drawn on and on. A global weather's are marched. Default false
   */
  lightMap?: boolean;
  /**
   * how they reuse what they marched over the last frames (see
   * {@link SceneryCloudsTemporal}), instead of the quality's: the march costs a quarter as much
   * while the clock runs (`'still'`) or the camera moves too (`'moving'`). Default the quality's:
   * `'moving'` at low and medium, `'still'` at high and ultra
   */
  temporal?: SceneryCloudsTemporal;
};

/**
 * The air over a {@link Scenery}, thinning with height: higher up the sky deepens and its haze
 * closes onto the horizon, and seen from low down the far sea fades into the horizon. Most of
 * its haze lies low, in a layer that thins far faster than the clear air above it.
 */
export type SkyAir = {
  /** height over which the clear air thins by e, in world units; 0 for no change with height. Default 8000 */
  scaleHeight?: number;
  /** distance over which the air at sea level hazes the sea by e, in world units; 0 for no haze. Default 60000 */
  visibility?: number;
  /** how much of that haze at sea level is the low haze layer rather than the clear air, 0 to 1. Default 0.75 */
  haze?: number;
  /** height over which the low haze thins by e, in world units: a hazier day, or a warmer one, lifts it. Default 1500 */
  hazeHeight?: number;
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
 * Below `level`, the void: by default a hollow in the crust about the field (`hollow`), else
 * an endless lid overhead and a bottomless gradient below the horizon. It is part of the
 * background, so it never hides anything in the scene, including objects above the level.
 */
export type SceneryVoidProps = {
  /** height of the lid along `up`, in world units; with a sea, its seabed's. Default 0 */
  level?: number;
  colors?: {
    /** the lid overhead */
    ceiling?: ColorRepresentation;
    /** where lid and depths meet, far away. The plain void's only (`hollow: false`): past the hollow the void is black */
    horizon?: ColorRepresentation;
    /** straight down. The plain void's only (`hollow: false`) */
    depth?: ColorRepresentation;
  };
  /** distance over which the lid recedes into the horizon colour, in world units; 0 for never. Default 20000 */
  fadeDistance?: number;
  /** depth below `level` over which the void fades in, in world units; without a sea only, as under one it begins at the seabed. Default 200 */
  transition?: number;
  /** depth of the camera below `level` over which the whole void dims toward black, in world units; 0 for none. Default 0 */
  darkening?: number;
  /** strength of the noise relief on the lid; 0 for none. Default 0.2 */
  detail?: number;
  /** size of the noise relief, in world units. Default 1000 */
  detailScale?: number;
  /** strength of the faint distant rock in the depths, wavy strata broken by crags; 0 for none. The plain void's only (`hollow: false`). Default 0.08 */
  depthDetail?: number;
  /** size of that rock's features, relative. The plain void's only (`hollow: false`). Default 1 */
  depthDetailScale?: number;
  /** how the depths darken below the horizon: the gradient's exponent; smaller reaches the depth colour sooner. The plain void's only (`hollow: false`). Default 0.5 */
  falloff?: number;
  /**
   * The void as a hollow in the crust under the field (see {@link SceneryHollow}): a floor
   * deep under the seabed and walls about it, which the seabed is the lid of. Peeling the
   * seabed (`SceneryOcean`'s `seabed: false`) opens it: the relief and the sea's seabed are
   * cut away inside its rim and stay whole around it. Past its walls and under its floor the
   * void is black, with the lid overhead. `false` for the plain void, its bottomless gradient
   * alone, and a peeled seabed gone everywhere. See documents/void.md. Default on
   */
  hollow?: boolean | SceneryHollow;
};

/**
 * How a hollow looks ({@link SceneryHollow.style}):
 * - `'calm'`: grey rock, the crust in section on its walls, the floor's cracks dark: a sober
 *   backdrop. The default.
 * - `'molten'`: the floor the mantle's cooled top, warm, its cracks glowing and pulsing dully.
 * - `'simple'`: a diagram: walls a plain even slope, flat shading, lines every 5 km of depth on
 *   the walls and every 50 km across the floor, a ring along the rim on the ground.
 */
export type SceneryHollowStyle = 'calm' | 'molten' | 'simple';

/**
 * The hollow under a {@link Scenery}'s seabed ({@link SceneryVoidProps.hollow}): the void
 * as a gap in the crust, from the seabed down to a floor where the mantle would begin, closed
 * by walls of rock about the field — dark, dull rock that frames the data in it. Centred on
 * the field (the `World`'s anchor, the globe's disc), a fixed size: from the sea over the
 * field its rim lies at the horizon. Real geometry, drawn with the background: it never hides
 * the scene. Changing any of it recompiles nothing and bakes nothing.
 */
export type SceneryHollow = {
  /** how it looks, and what its colours, `embers` and `pulse` default to. Default `'calm'` */
  style?: SceneryHollowStyle;
  /** its rim's radius along the sea, in world units. Default 500 000 */
  radius?: number;
  /** depth of its floor under the seabed, in world units. Default 35 000 */
  floorDepth?: number;
  colors?: {
    /** the walls' rock. Default `#3d3f41` (calm), `#42403d` (molten), `#7c7d7e` (simple) */
    walls?: ColorRepresentation;
    /** the floor's rock. Default `#36393c` (calm), `#3d3937` (molten), `#252525` (simple) */
    floor?: ColorRepresentation;
    /** the glow in the floor's cracks, and its warmth on the walls. Default `#ff7326` */
    embers?: ColorRepresentation;
    /** the lid's underside, seen from inside: the simple style's only (the others' is the sediments' rock). Default `#b0b0b0` */
    lid?: ColorRepresentation;
  };
  /** how much the floor's cracks glow; 0 for none. Default 0 (calm, simple), 1 (molten) */
  embers?: number;
  /** width of the band inside the rim over which the floor cools to plain rock, in world units. Default 0.35 of the radius, at least 40 000 */
  cooling?: number;
  /** depth under the seabed over which the light from above falls by e, in world units. Default 11 000 */
  lightFalloff?: number;
  /** how much the void's air darkens with depth, 0 for none. Default 1 */
  murk?: number;
  /** how far the embers' glow dims, at most, as it slowly pulses across the floor (a share of it; 0 holds it steady). It moves only while frames are drawn. Default 0 (calm, simple), 0.2 (molten) */
  pulse?: number;
  /** how much of the air is left over the open hollow, 0 to 1: the rest drains into it, darkening the sky over it and taking the haze off the land about its rim. Default 0.35 (calm), 0.1 (molten), 1 (simple) */
  air?: number;
  /**
   * Grips on the rim, in the simple style only (four small cubes at its true east, north,
   * west and south), that drag its
   * radius: a ghost ring follows the pointer, and on release the hollow takes the new radius
   * (`onRadiusChange`). The dragged radius is kept until `radius` changes; a double click or
   * tap puts the default radius (500 km) back. Default false
   */
  handle?: boolean;
  /** called with the radius a drag of a grip (`handle`) leaves, or a reset puts back */
  onRadiusChange?: (radius: number) => void;
};

/**
 * How a hollow's rim (see {@link SceneryHollow}) wanders round its axis, in and out of its
 * radius: per wave its number round the rim, its share of the radius and its phase. Some 6%
 * at most, so the size holds: broad bays and headlands, and a ragged edge some tens of km
 * across that reads from across the hollow. The walls are built along it, and the relief and
 * the seabed are cut along it (`uSkyHollowRim`).
 */
export const SCENERY_HOLLOW_RIM: readonly (readonly [
  number,
  number,
  number,
])[] = [
  [3, 0.016, 0.4],
  [5, 0.011, 2.1],
  [7, 0.008, 4.0],
  [11, 0.006, 1.2],
  [17, 0.004, 5.3],
  [29, 0.003, 0.7],
  [43, 0.0025, 3.3],
  [71, 0.002, 2.6],
  [97, 0.0035, 1.9],
  [151, 0.0025, 4.4],
  [233, 0.0015, 0.3],
];

/**
 * The water settings an endless sea shares with the `Ocean` component, under the same
 * names. The sun and the reflected sky come from the {@link Scenery}. Its waves shoal and
 * break, and its surf stands, by the depth of the scene's ground under it (`documents/scenery.md`).
 */
export type SceneryOceanWater = Omit<
  OceanWaterProps,
  | 'skyColor'
  | 'horizonColor'
  | 'sunDirection'
  | 'sunColor'
  | 'displacement'
  | 'shoalDepth'
  | 'shoalOpacity'
>;

/**
 * The look of a {@link SceneryOceanProps}'s seabed. It is lit by the scene's lights with the
 * model and options of a `ZoneMaterial`, so a zone layer given the same values
 * continues it without a seam.
 */
export type ScenerySeabed = {
  /**
   * Default `#8c8573`. Under a `GeoRelief` in the `World`, whose tiles are the seabed, the
   * background's own (where none is drawn yet, or past their edge) takes the relief's look
   * instead: its seabed's ramp, or this colour where the look gives it none
   */
  color?: ColorRepresentation;
  /** specular highlight colour. Default `#1a1a1a`, as on `ZoneMaterial` */
  specular?: ColorRepresentation;
  /** specular exponent. Default 24, as on `ZoneMaterial` */
  shininess?: number;
  /** ambient multipliers facing up / facing down, or `false` for none. Default `[1.35, 0.5]`, as on `ZoneMaterial` */
  ambient?: Vec2 | false;
  /** procedural relief, or `false` for none; not drawn under a `GeoRelief`, whose tiles are the seabed. Default `'seabed'` */
  detail?: SurfaceDetail | false;
};

/**
 * An endless sea: a wavy surface at `level` over a flat seabed `depth` below it, seen
 * from above, from inside the water and, below the seabed, as the abyss (which the
 * ocean turns on, at the seabed). The water takes the `Ocean` component's props, so
 * one object can drive both. It is part of the background, so it never hides anything
 * in the scene.
 */
export type SceneryOceanProps = SceneryOceanWater & {
  /** the water; off leaves the seabed dry, with no surface or fog. Default true */
  water?: boolean;
  /** the seabed, and its look; off leaves the void below the water, seen through it from above, its lid still a roof from below. Default true */
  seabed?: boolean | ScenerySeabed;
  /**
   * How much of what lies beyond the seabed it hides, 0 to 1, as `waterOpacity` is the
   * water's: below 1 the data under it shows through, and so does a `SceneryStage`'s
   * relief over the stage's own area. Default 1
   */
  seabedOpacity?: number;
  /** height of the sea surface along `up`, in world units. Default 0 */
  level?: number;
  /** depth of the seabed below the surface, in world units. Default 100 */
  depth?: number;
  /**
   * How much of the sea it draws, as `Ocean`'s `quality` (`SEA_QUALITY`,
   * `OCEAN_QUALITY_DEFINES`); at `low` its reflection takes the sky's gradient alone, without
   * the twilight's glow or the sun's halo. Default `'medium'`, sized for a mid-range laptop's
   * integrated GPU.
   */
  quality?: SeaQuality;
};

/** The colour and intensity of a {@link ScenerySubsurface}'s light panels. */
export type ScenerySubsurfacePanel = {
  /** Default `#ffffff` */
  color?: ColorRepresentation;
  /** radiance of the panels; above 1 they outshine display white. Default 3 */
  intensity?: number;
};

/**
 * The directional light below a {@link Scenery}'s seabed, in place of the sun's and the moon's:
 * steady, whatever the time of day. Fixed by default; with `followSun` it turns with the
 * sun's compass bearing.
 */
export type ScenerySubsurfaceLight = {
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
 * The light below a {@link Scenery}'s seabed (or its abyss level), and wherever the sky is not
 * drawn, where its own light means nothing: a dark backdrop and soft light panels, some
 * above the horizon and some below, fixed in the sky's up/north frame, or a map of your
 * own; and a steady directional light in place of the sun's.
 */
export type ScenerySubsurface = {
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
  panels?: ScenerySubsurfacePanel & { below?: ScenerySubsurfacePanel };
  /** the directional light (see {@link ScenerySubsurfaceLight}); it needs the Scenery's `sunLight` */
  light?: ScenerySubsurfaceLight;
};

/** Which of a {@link Scenery}'s environments lights the scene. */
export type SceneryZone = 'air' | 'water' | 'subsurface';

/** What decides a {@link SceneryZone}: the sky's levels and switches, as on `SceneryMaterial`. */
export type SceneryZoneLevels = {
  ocean: boolean;
  oceanLevel: number;
  oceanDepth: number;
  oceanWater: boolean;
  abyss: boolean;
  abyssLevel: number;
  /** the ground's height under the camera where a stage draws its own — the seabed, or land above the sea; else the sea's flat seabed */
  oceanGround?: number | null;
  /** a cutaway is on: the scene is lit as from above the water, wherever the camera is */
  cutaway?: boolean;
  /** the sky itself is drawn: neither hidden nor the void's gradient in its place */
  background: boolean;
};

/**
 * The environment for a camera at `height` along up: the air above the sea (or the
 * abyss level), the water below its surface, and the subsurface below its seabed — an
 * occupant's own where it has one, which above the sea is land: in it, the camera is in
 * rock. A dry sea, or one with a cutaway, is air down to the seabed, and a sky not drawn,
 * or drawn as the void's gradient, is all subsurface.
 */
export function sceneryZone(
  height: number,
  levels: SceneryZoneLevels,
): SceneryZone {
  if (!levels.background) return 'subsurface';
  if (levels.ocean) {
    const ground = levels.oceanGround ?? levels.oceanLevel - levels.oceanDepth;
    if (height <= ground) return 'subsurface';
    if (height > levels.oceanLevel) return 'air';
    return levels.oceanWater && !levels.cutaway ? 'water' : 'air';
  }
  return levels.abyss && height < levels.abyssLevel ? 'subsurface' : 'air';
}

/** How far below the sea surface its water is filmed from, in world units. */
export const SCENERY_WATER_BAKE_DEPTH = 1;

/**
 * The void's lid over a camera at `height` along up, while it is in the ground: the ground
 * under it where a stage draws its own (`oceanGround`), else the sea's flat seabed. From
 * there the lid hides all above it — the relief draws its underside, the sea and the sky
 * are not drawn — so nothing lying above it need be drawn either. Null over the ground, and
 * without a sea. A dry sea's seabed, or one with a cutaway, is a lid all the same.
 */
export function sceneryLidOverCamera(
  height: number,
  levels: Pick<
    SceneryZoneLevels,
    'ocean' | 'oceanLevel' | 'oceanDepth' | 'oceanGround'
  >,
): number | null {
  if (!levels.ocean) return null;
  const ground = levels.oceanGround ?? levels.oceanLevel - levels.oceanDepth;
  return height <= ground ? ground : null;
}

/**
 * The daylight left `depth` below the surface relative to what the water's bake saw, as
 * the sky's water dims it (`waterFogDim`).
 */
export function sceneryWaterDimming(depth: number, fogDensity: number) {
  return Math.exp(
    -Math.max(depth - SCENERY_WATER_BAKE_DEPTH, 0) * fogDensity * 0.5,
  );
}

/** A {@link ScenerySubsurface} with its defaults filled in, as colours in the working space. */
export type ScenerySubsurfaceColors = {
  top: Color;
  bottom: Color;
  /** the panels above the horizon, colour times intensity */
  above: Color;
  /** the panels below it */
  below: Color;
};

export function scenerySubsurfaceColors(
  subsurface: ScenerySubsurface = {},
): ScenerySubsurfaceColors {
  const defaults = sceneryDefaults.subsurface;
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
 * Where a {@link ScenerySubsurfaceLight} shines from, in degrees, with the sun at `sunAzimuth`
 * and `sunElevation`: fixed, or the sun's bearing at its elevation held within the range.
 */
export function scenerySubsurfaceLightPosition(
  sunAzimuth: number,
  sunElevation: number,
  light: ScenerySubsurfaceLight = {},
) {
  const defaults = sceneryDefaults.subsurface.light;
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

/**
 * The Earth's mean radius, in world units (metres): the sdk's `EARTH_RADIUS`. The globe's
 * radius without a frame; with one, the sky takes the globe's (`Globe.radius`).
 */
export const SCENERY_EARTH_RADIUS = EARTH_RADIUS;

export const sceneryDefaults = {
  sun: {
    azimuth: 200,
    elevation: 35,
    intensity: 1.5,
    size: 0.267,
    glow: 0.5,
    glare: 0.5,
    rays: 0,
    shimmer: false,
    twilight: 1,
  },
  moon: { intensity: 0.3, color: '#c4cfdf', size: 0.259, glow: 0.3 },
  stars: { brightness: 1, density: 0.5, latitude: 60 },
  clouds: {
    scale: 1,
    density: 1,
    color: '#ffffff',
    seed: 0,
    quality: 'medium' as SceneryCloudsQuality,
    dominance: 0.8,
    lightMap: false,
  },
  air: { scaleHeight: 8000, visibility: 60000, haze: 0.75, hazeHeight: 1500 },
  colors: {
    zenith: '#6f8fb3',
    horizon: '#c9d3dc',
    ground: '#7a7f86',
    nadir: '#3a3e44',
  },
  intensity: 1,
  horizonBlend: 0.04,
  globe: true,
  discScale: 1,
  void: {
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
    hollow: {
      style: 'calm' as SceneryHollowStyle,
      radius: 500000,
      floorDepth: 35000,
      cooling: null as number | null,
      lightFalloff: 11000,
      murk: 1,
      // What each style defaults to; anything set on the hollow overrides it.
      styles: {
        calm: {
          colors: {
            walls: '#3d3f41',
            floor: '#36393c',
            embers: '#ff7326',
            lid: '#b0b0b0',
          },
          embers: 0,
          pulse: 0,
          air: 0.35,
        },
        molten: {
          colors: {
            walls: '#42403d',
            floor: '#3d3937',
            embers: '#ff7326',
            lid: '#b0b0b0',
          },
          embers: 1,
          pulse: 0.2,
          air: 0.1,
        },
        simple: {
          colors: {
            walls: '#7c7d7e',
            floor: '#252525',
            embers: '#ff7326',
            lid: '#b0b0b0',
          },
          embers: 0,
          pulse: 0,
          air: 1,
        },
      } satisfies Record<
        SceneryHollowStyle,
        {
          colors: { walls: string; floor: string; embers: string; lid: string };
          embers: number;
          pulse: number;
          air: number;
        }
      >,
    },
  },
  ocean: {
    level: 0,
    depth: 100,
    seabed: {
      color: '#8c8573',
      specular: '#1a1a1a',
      shininess: 24,
      ambient: [1.35, 0.5],
      detail: 'seabed',
    },
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
 * The air's optical depth per air mass in red, green and blue (about 605, 540 and 455 nm):
 * Rayleigh, a moderately hazy sea air (aerosol optical depth 0.15 at 550 nm) and ozone.
 * `SKY_AIR_DEPTH` in `sky-gradient.glsl`.
 */
const SKY_AIR_DEPTH = [0.24, 0.29, 0.41] as const;
/** How much of the air's dimming of the moon a screen shows: its cube root (`SKY_MOON_CONTRAST` in `sky-gradient.glsl`). */
const SKY_MOON_CONTRAST = 1 / 3;
/** The moon's mean radius, in km. */
const MOON_RADIUS_KM = 1737.4;

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
 * Where and when a {@link Scenery} is seen from: the sun, the moon and its phase are then
 * the real ones for that moment and place.
 */
export type SkyObserver = {
  /** the moment */
  date: Date;
  /** degrees north. Default the enclosing `World`'s origin's */
  latitude?: number;
  /** degrees east. Default the enclosing `World`'s origin's */
  longitude?: number;
};

/** Whether a sky can be computed for `observer`: a real moment and a place on Earth. */
export function skyObserverValid(
  observer: SkyObserver | null | undefined,
): observer is Required<SkyObserver> {
  return (
    !!observer &&
    observer.date instanceof Date &&
    Number.isFinite(observer.date.getTime()) &&
    Number.isFinite(observer.latitude) &&
    Math.abs(observer.latitude ?? NaN) <= 90 &&
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

/**
 * Light through the air from an `elevation` in degrees, over that from overhead: by the air
 * mass it crosses (Kasten and Young's). At 10° a quarter of it is left, cream; at 3° 2%,
 * orange; on the horizon a twenty-thousandth, red. The twin of `skyThroughAir` in
 * `sky-gradient.glsl`.
 */
export function skyThroughAir(elevation: number, target = new Color()) {
  const degrees = MathUtils.clamp(elevation, 0, 90);
  const mass =
    1 /
    (Math.sin(MathUtils.degToRad(degrees)) +
      0.50572 * Math.pow(degrees + 6.07995, -1.6364));
  const through = Math.max(mass - 1, 0);
  return target.setRGB(
    Math.exp(-SKY_AIR_DEPTH[0] * through),
    Math.exp(-SKY_AIR_DEPTH[1] * through),
    Math.exp(-SKY_AIR_DEPTH[2] * through),
  );
}

/**
 * The moon's `color` as its light reaches the field from an `elevation` in degrees: dimmed by
 * the air as its disc is (the cube root of {@link skyThroughAir}'s luminance: 0.64 at 10°,
 * 0.27 at 3°), but not tinted: what moonlight lights is seen by night eyes, without colour.
 * Its disc takes the air's hue too (`skyMoonThroughAir` in `sky.glsl`).
 */
export function skyMoonColor(
  color: Color,
  elevation: number,
  target = new Color(),
) {
  skyThroughAir(elevation, target);
  const dimmed = Math.pow(
    0.2126 * target.r + 0.7152 * target.g + 0.0722 * target.b,
    SKY_MOON_CONTRAST,
  );
  return target.copy(color).multiplyScalar(dimmed);
}

/**
 * The moon's angular radius in degrees seen from `distance` km: 0.245 at its farthest, 0.279
 * at its nearest, 0.259 at its mean distance (the default `moon.size`).
 */
export function skyMoonSize(distance: number) {
  return MathUtils.radToDeg(Math.asin(Math.min(MOON_RADIUS_KM / distance, 1)));
}
