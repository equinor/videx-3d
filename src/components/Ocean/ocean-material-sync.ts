import { Vector2, Vector3 } from 'three';
import { Vec2, Vec3 } from '../../sdk/types/common';
import type { SeaSwell } from '../../sdk/weather/sea-spectrum';
import {
  type WaterOptics,
  type WaterOpticsPreset,
  waterOpticsOf,
} from '../../sdk/weather/water-optics';
import type { WeatherGusts } from '../../sdk/weather/wind-field';
import { OceanBedMaterial } from './ocean-bed-material';
import {
  OceanMaterial,
  type OceanFoamTuning,
  type OceanWaveTuning,
} from './ocean-material';
import { OceanVolumeMaterial } from './ocean-volume-material';

/**
 * Sea state and water appearance — everything that describes the water itself,
 * as opposed to the geometry it is drawn on.
 *
 * Shared by the `Ocean` component and by a water layer inside a `Chunk`, which is
 * the point: the two drive the same materials, and a second copy of this list
 * would drift.
 *
 * @expand
 * @group Components
 */
export type OceanWaterProps = {
  /** Wind direction in world X/Z (drives wave + foam direction). */
  windDirection?: Vec2;
  /**
   * Wind speed in m/s (U10). Primary driver of the sea state: wave height,
   * wavelength and foam all follow North-Sea JONSWAP/Pierson-Moskowitz
   * relations (e.g. ~10 m/s ⇒ Hs ~ 2.1 m, peak wavelength ~ 88 m).
   */
  windSpeed?: number;
  /**
   * How the wind varies over the sea: gusts that roughen the short waves as they run downwind
   * (cat's paws to gust fronts), and slicks, calm streaks in light winds. Left out, the
   * enclosing `Weather`'s, else as the wind gives them; `{ strength: 0, slicks: 0 }`, none.
   */
  gusts?: WeatherGusts;
  /**
   * Wave height multiplier on top of the spectrum's physical Hs.
   * @deprecated the waves are as the wind gives them, wavelengths, foam and whitecaps with
   * them: scaling their height alone breaks that. For more wind, `windSpeed`; for waves from
   * weather far away, `swells`. Still applied
   */
  amplitude?: number;
  /**
   * Swells from weather far away, running on regardless of the wind here: each its
   * significant height (m), peak period (s) and the way it travels.
   */
  swells?: SeaSwell[];
  /**
   * ⚠️ Tuning, to be settled and then removed: the wave model's open choices, to compare by
   * eye ({@link OceanWaveTuning}).
   */
  waveTuning?: OceanWaveTuning;
  /**
   * ⚠️ Tuning, to be settled and then removed: the foam's shaping, to compare by eye
   * ({@link OceanFoamTuning}).
   */
  foamTuning?: OceanFoamTuning;
  /** @deprecated the waves spread about the wind as the spectrum has them; ignored */
  directionalSpread?: number;
  /** The waves' slopes scaled for show: 1 (the default) as the spectrum gives them. */
  steepness?: number;
  /**
   * Enables vertex displacement (`false` = off / flat, per-pixel normals
   * only). Off by default; at oilfield scale real displacement is
   * imperceptible except very close to the surface, where only the longest
   * swells displace. Mainly useful to let floating objects follow the surface
   * height.
   */
  displacement?: boolean;
  /**
   * How the water looks, one model for every sea ({@link WaterOptics}, documents/water.md):
   * a preset's name (`'realistic'`, `'clear'`) or the colour of deep water and how far one
   * sees through it. Default as `deepColor` and `bodyFogDensity` give it, else `'realistic'`.
   */
  optics?: WaterOptics | WaterOpticsPreset;
  /**
   * Deep water colour (seen looking straight down).
   * @deprecated `optics` (its `color`); still taken as the water's colour where `optics` is
   * left out
   */
  deepColor?: string;
  /**
   * Shallow/scatter water colour (seen at grazing angles).
   * @deprecated the water's look is one model (`optics`); no effect
   */
  shallowColor?: string;
  /**
   * Base body opacity looking straight down (0 = clear, 1 = opaque).
   * @deprecated how far one sees is `optics` (its `clarity`): no effect on the surface; still
   * the walls' densest tint where `bodyMaxOpacity` is left out
   */
  waterOpacity?: number;
  /**
   * Water depth at which the sea reaches ~86% of its full colour and opacity, in
   * metres. Shallower water is clearer and paler, so a shoal or a beach reads as
   * one.
   *
   * ⚠️ Needs a bathymetry grid to have any effect — a `ChunkStack` supplies the
   * column's shallowest surface. Without one the shader has no depth input and
   * falls back to the view angle, which cannot tell shallow from deep.
   * @deprecated shallow water shows its bed by `optics` (the water over it); no effect
   */
  shoalDepth?: number;
  /**
   * What is left of `waterOpacity` where the bed reaches the surface, 0..1.
   * Default 0 (fully clear, leaving only the reflection).
   * @deprecated shallow water shows its bed by `optics` (the water over it); no effect
   */
  shoalOpacity?: number;
  /**
   * Surf where the bed comes up to the surface, 0..1. Default 0 (off).
   *
   * ⚠️ Needs a bathymetry grid, like `shoalDepth`. ⚠️ Independent of the wind,
   * unlike whitecaps — a shore breaks in a calm.
   */
  shoreFoam?: number;
  /**
   * Depth at which waves break, as a multiple of the significant wave height.
   * Default 1.3 — the measured breaking criterion, so the surf zone widens and
   * narrows with the sea state rather than sitting at a fixed depth.
   *
   * ⚠️ The wave height is floored internally to stand in for background swell, so
   * an open coast still breaks in a dead calm.
   */
  shoreBreakDepth?: number;
  /**
   * Exaggeration of the surf zone's width. Default 1 — as measured.
   *
   * ⚠️ A realistic surf zone is a handful of pixels across at field scale, so this
   * exists for the same reason a pipeline's diameter exaggeration does. Raising it
   * costs the scale cue a correctly-sized shore gives.
   */
  surfScale?: number;
  /**
   * How far the swell carries the waterline up and down the shore, as a multiple
   * of the local wave height. Default 1; 0 pins it to the still level.
   */
  swash?: number;
  /**
   * How ragged the shore foam's landward edge is, in metres of water depth.
   * Default 0 — the edge then follows the bathymetry contour exactly, which reads
   * as unnaturally crisp.
   *
   * ⚠️ It perturbs the FOAM band only, not the water's depth: perturbing that
   * would make the transparency and colour ripple with it.
   */
  shoreNoise?: number;
  /** Feature size of that raggedness, in metres. Default 200. */
  shoreNoiseScale?: number;
  /**
   * How white the shore foam is drawn, 0..1. Default 0.65 — pure white surf reads
   * as a painted line at field scale. 0 removes it entirely, colour AND opacity.
   *
   * ⚠️ Distinct from `shoreFoam`, which decides how much of the band is COVERED
   * and so breaks it up against the foam noise; this one dims it evenly.
   */
  shoreFoamStrength?: number;
  /**
   * Fraction of `shoreFoamStrength` lost once the foam detail goes sub-pixel.
   * Default 0.3 — this is what softens the band as you zoom out.
   */
  shoreFoamFade?: number;
  /** @deprecated the tonal patches are no longer drawn; ignored */
  tonalVariation?: number;
  /** @deprecated ignored */
  tonalScale?: number;
  /** @deprecated ignored */
  tonalSharpness?: number;
  /** @deprecated ignored */
  tonalColor?: string;
  /** Zenith sky colour of the gradient reflected where the scene has no sky (`OceanMaterial.updateSky`). */
  skyColor?: string;
  /** Horizon sky colour of that gradient. */
  horizonColor?: string;
  /** Reflection intensity multiplier. */
  reflectionIntensity?: number;
  /**
   * Direction toward the sun in world space (the glint, the foam's light). Default the
   * scene's: a `Scenery`'s sun or moon, else the scene's brightest directional light.
   */
  sunDirection?: Vec3;
  /** Sun colour, its intensity in it. Default the scene's, as `sunDirection`. */
  sunColor?: string;
  /** Sun specular shininess exponent. */
  sunShininess?: number;
  /** Foam colour. */
  foamColor?: string;
  /**
   * Whitecaps, 0 = none: 0.5 (the default) covers the share of the sea measured at sea for
   * the wind (Monahan and O'Muircheartaigh, about 1 % at 10 m/s and 10 % at 20 m/s), 1 twice
   * that.
   */
  foamAmount?: number;
  /** Fresnel exponent (higher = reflections concentrated near the horizon). */
  fresnelPower?: number;
  /** The foam's feature frequency, per metre. Default 0.05. */
  detailScale?: number;
  /** @deprecated the fine ripples are the sea's finest layer; ignored */
  detailStrength?: number;
  /**
   * Distances from the camera, `[start, end]`, over which the waves and foam fade
   * out, leaving a flat mirror. Default `[15000, 60000]`.
   */
  detailFadeDistance?: [number, number];
};

/**
 * Appearance of the water BODY — the volume seen through the sides of a water
 * box, or through the walls of a chunk's water layer.
 *
 * @expand
 * @group Components
 */
export type OceanBodyProps = {
  /**
   * Per-meter tint build-up of the water body's walls, with the camera's distance to them.
   * Also the water's clarity where `optics` is left out, and a `ChunkStack`'s immersion fog in
   * its water.
   */
  bodyFogDensity?: number;
  /** Densest tint the water body's walls reach far from the camera (0..1). */
  bodyMaxOpacity?: number;
  /** Animated shimmer amount of the water body, 0 = off. */
  bodyShimmer?: number;
};

/**
 * Appearance of a sea bed drawn by the `Ocean` component itself. A chunk draws
 * its sea bed as an ordinary layer instead, so these do not apply there.
 *
 * @expand
 * @group Components
 */
export type OceanBedProps = {
  /** Sea-bed base (sandy/yellowish) colour. Default `#b8a06a`. */
  seaBedColor?: string;
  /**
   * Strength of the water-colour tint applied to the water-facing (top) side
   * of the sea bed (0..1).
   * @deprecated the bed is seen through the water over it by `optics`; no effect
   */
  seaBedWaterTint?: number;
  /**
   * Sea-bed opacity (0..1). The sea bed is OIT-routed, so values below 1 let the
   * subsurface geometry below it show through; 1 (default) makes it a solid
   * occluder.
   */
  seaBedOpacity?: number;
  /**
   * Sea-bed sand-dune relief strength (0 = off). Perturbs the bed's shading
   * normal by a procedural, footprint-anti-aliased dune height field, adding a
   * subtle sense of depth and scale that resolves up close and fades to flat far
   * out. Default 0.15.
   */
  seaBedDuneStrength?: number;
  /** Base sand-dune crest spacing in meters. Default 180. */
  seaBedDuneWavelength?: number;
  /** Sand-dune ridge direction in world X/Z. Default `[1, 0.6]`. */
  seaBedDuneDirection?: Vec2;
  /**
   * Extra sand-dune crest/trough albedo banding (0 = off). Lightens the dune
   * crests and darkens the troughs on top of the relief shading for a stronger
   * depth cue; fades out far away like the rest of the dune detail. Default 0.
   */
  seaBedDuneSharpness?: number;
};

/** A master opacity multiplier, which also drives OIT routing. */
type WithOpacity = { opacity?: number };

/**
 * Push the water props onto an {@link OceanMaterial}'s uniforms.
 *
 * @group Components
 */
export function applyOceanWaterProps(
  material: OceanMaterial,
  props: OceanWaterProps & Pick<OceanBodyProps, 'bodyFogDensity'> & WithOpacity,
): void {
  const opacity = props.opacity ?? 1;

  // One look for the water (water-optics.ts): the deprecated deep colour and body fog where
  // no `optics` is given.
  const optics = waterOpticsOf(props.optics, props);
  const current = material.optics;
  if (optics.color !== current.color || optics.clarity !== current.clarity)
    material.optics = optics;

  if (props.windDirection)
    material.windDirection = new Vector2(
      props.windDirection[0],
      props.windDirection[1],
    );
  if (props.windSpeed !== undefined) material.windSpeed = props.windSpeed;
  // Left out is as the wind gives them, so only where the caller speaks of them at all.
  if ('gusts' in props) material.gusts = props.gusts ?? null;
  if (props.amplitude !== undefined) material.amplitude = props.amplitude;
  if (props.swells) material.swells = props.swells;
  if (props.waveTuning) material.waveTuning = props.waveTuning;
  if (props.foamTuning) material.foamTuning = props.foamTuning;
  if (props.directionalSpread !== undefined)
    material.directionalSpread = props.directionalSpread;
  if (props.steepness !== undefined) material.steepness = props.steepness;
  if (props.displacement !== undefined)
    material.displacement = props.displacement ? 1 : 0;
  if (props.deepColor) material.deepColor = props.deepColor;
  if (props.shallowColor) material.shallowColor = props.shallowColor;
  if (props.waterOpacity !== undefined)
    material.waterOpacity = props.waterOpacity;
  if (props.shoalDepth !== undefined) material.shoalDepth = props.shoalDepth;
  if (props.shoalOpacity !== undefined)
    material.shoalOpacity = props.shoalOpacity;
  if (props.shoreFoam !== undefined) material.shoreFoam = props.shoreFoam;
  if (props.shoreBreakDepth !== undefined)
    material.shoreBreakDepth = props.shoreBreakDepth;
  if (props.surfScale !== undefined) material.surfScale = props.surfScale;
  if (props.swash !== undefined) material.swash = props.swash;
  if (props.shoreNoise !== undefined) material.shoreNoise = props.shoreNoise;
  if (props.shoreNoiseScale !== undefined)
    material.shoreNoiseScale = props.shoreNoiseScale;
  if (props.shoreFoamStrength !== undefined)
    material.shoreFoamStrength = props.shoreFoamStrength;
  if (props.shoreFoamFade !== undefined)
    material.shoreFoamFade = props.shoreFoamFade;
  if (props.tonalVariation !== undefined)
    material.tonalVariation = props.tonalVariation;
  if (props.tonalScale !== undefined) material.tonalScale = props.tonalScale;
  if (props.tonalSharpness !== undefined)
    material.tonalSharpness = props.tonalSharpness;
  if (props.tonalColor) material.tonalColor = props.tonalColor;
  if (props.skyColor) material.skyColor = props.skyColor;
  if (props.horizonColor) material.horizonColor = props.horizonColor;
  if (props.reflectionIntensity !== undefined)
    material.reflectionIntensity = props.reflectionIntensity;
  // Left out, the scene's sky's sun (OceanMaterial.updateSky).
  material.sunDirection = props.sunDirection
    ? new Vector3(
        props.sunDirection[0],
        props.sunDirection[1],
        props.sunDirection[2],
      )
    : null;
  material.sunColor = props.sunColor ?? null;
  if (props.sunShininess !== undefined)
    material.sunShininess = props.sunShininess;
  if (props.foamColor) material.foamColor = props.foamColor;
  if (props.foamAmount !== undefined) material.foamAmount = props.foamAmount;
  if (props.fresnelPower !== undefined)
    material.fresnelPower = props.fresnelPower;
  if (props.detailScale !== undefined) material.detailScale = props.detailScale;
  if (props.detailStrength !== undefined)
    material.detailStrength = props.detailStrength;
  if (props.detailFadeDistance)
    material.detailFadeDistance = props.detailFadeDistance;

  material.uniforms.uMasterOpacity.value = opacity;
  // Drive OIT opacity-aware routing via material.opacity (the pass reads the
  // ShaderMaterial's `uniforms.opacity` first, then falls back to this). The
  // ocean has no `opacity` uniform, so this value is what classifies it as
  // transparent and keeps it in the OIT passes (so subsurface geometry shows
  // through it instead of being depth-rejected by an opaque-pass draw).
  material.opacity = Math.min(
    opacity * (props.waterOpacity ?? material.waterOpacity),
    0.999,
  );
}

/**
 * Push the water/body props onto an {@link OceanVolumeMaterial}'s uniforms.
 *
 * @param surface the matching surface material, whose wave tables the walls
 *   share by reference so their top edge tracks the surface for free
 *
 * @group Components
 */
export function applyOceanBodyProps(
  material: OceanVolumeMaterial,
  props: OceanWaterProps & OceanBodyProps & WithOpacity,
  surface?: OceanMaterial | null,
): void {
  const opacity = props.opacity ?? 1;

  if (props.deepColor) material.deepColor = props.deepColor;
  if (props.shallowColor) material.shallowColor = props.shallowColor;
  if (props.bodyFogDensity !== undefined)
    material.fogDensity = props.bodyFogDensity;
  // Densest tint the water body reaches: follows the surface water opacity so
  // the body reads "denser" blue as the water gets more opaque. An explicit
  // bodyMaxOpacity overrides this coupling.
  material.maxOpacity =
    props.bodyMaxOpacity ?? props.waterOpacity ?? material.maxOpacity;
  if (props.bodyShimmer !== undefined) material.shimmer = props.bodyShimmer;
  material.masterOpacity = opacity;
  material.opacity = Math.min(opacity, 0.999);

  // Make the wall top ring follow the same wave heights as the surface so the rim
  // stays sealed: its sea layers, shared by reference.
  if (surface) {
    material.linkSea(surface);
    material.displacement = surface.displacement;
  }
}

/**
 * Push the water/bed props onto an {@link OceanBedMaterial}'s uniforms.
 *
 * @group Components
 */
export function applyOceanBedProps(
  material: OceanBedMaterial,
  props: OceanWaterProps & OceanBedProps & WithOpacity,
): void {
  const opacity = props.opacity ?? 1;

  if (props.seaBedColor) material.color = props.seaBedColor;
  // Match the bed's water tint to the surface's deep colour.
  if (props.deepColor) material.waterColor = props.deepColor;
  // Strength of the blue water tint over the bed: follows the surface water
  // opacity so the bed reads "denser" blue as the water gets more opaque. An
  // explicit seaBedWaterTint overrides this coupling.
  material.waterTint =
    props.seaBedWaterTint ?? props.waterOpacity ?? material.waterTint;
  if (props.sunDirection)
    material.sunDirection = new Vector3(
      props.sunDirection[0],
      props.sunDirection[1],
      props.sunDirection[2],
    );
  if (props.sunColor) material.sunColor = props.sunColor;

  if (props.seaBedDuneStrength !== undefined)
    material.duneStrength = props.seaBedDuneStrength;
  if (props.seaBedDuneWavelength !== undefined)
    material.duneWavelength = props.seaBedDuneWavelength;
  if (props.seaBedDuneDirection)
    material.duneDirection = new Vector2(
      props.seaBedDuneDirection[0],
      props.seaBedDuneDirection[1],
    );
  if (props.seaBedDuneSharpness !== undefined)
    material.duneSharpness = props.seaBedDuneSharpness;

  const bedAlpha = props.seaBedOpacity ?? 1;
  material.bedOpacity = bedAlpha;
  material.masterOpacity = opacity;
  // Drive OIT opacity-aware routing via material.opacity (>= 1 makes the bed an
  // opaque occluder; < 1 keeps it in the transparency passes so the subsurface
  // geometry below it still shows through).
  material.opacity = Math.min(bedAlpha * opacity, 1);
}
