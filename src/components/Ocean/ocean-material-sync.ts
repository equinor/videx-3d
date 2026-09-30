import { Vector2, Vector3 } from 'three';
import { Vec2, Vec3 } from '../../sdk/types/common';
import { OceanBedMaterial } from './ocean-bed-material';
import { OceanMaterial } from './ocean-material';
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
  /** Wave height multiplier on top of the spectrum's physical Hs. */
  amplitude?: number;
  /** Angular spread (radians) of the wave directions around the wind. */
  directionalSpread?: number;
  /** Apparent surface choppiness (normal exaggeration / Gerstner sharpness). */
  steepness?: number;
  /**
   * Enables vertex displacement (`false` = off / flat, per-pixel normals
   * only). Off by default; at oilfield scale real displacement is
   * imperceptible except very close to the surface, where only the longest
   * swells displace. Mainly useful to let floating objects follow the surface
   * height.
   */
  displacement?: boolean;
  /** Deep water colour (seen looking straight down). */
  deepColor?: string;
  /** Shallow/scatter water colour (seen at grazing angles). */
  shallowColor?: string;
  /** Base body opacity looking straight down (0 = clear, 1 = opaque). */
  waterOpacity?: number;
  /**
   * Water depth at which the sea reaches ~86% of its full colour and opacity, in
   * metres. Shallower water is clearer and paler, so a shoal or a beach reads as
   * one.
   *
   * ⚠️ Needs a bathymetry grid to have any effect — a `ChunkStack` supplies the
   * column's shallowest surface. Without one the shader has no depth input and
   * falls back to the view angle, which cannot tell shallow from deep.
   */
  shoalDepth?: number;
  /**
   * What is left of `waterOpacity` where the bed reaches the surface, 0..1.
   * Default 0 (fully clear, leaving only the reflection).
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
  /** Strength of the large-scale tonal variation (currents / slicks), 0 = off. */
  tonalVariation?: number;
  /** Approximate size of the tonal variation patches, in kilometers. */
  tonalScale?: number;
  /** Crispness of the tonal variation patch edges (0 = soft, 1 = hard). */
  tonalSharpness?: number;
  /** Colour the water drifts toward in the tonal variation (current / algae / pollution tint). */
  tonalColor?: string;
  /** Zenith sky colour used for the procedural reflection. */
  skyColor?: string;
  /** Horizon sky colour used for the procedural reflection. */
  horizonColor?: string;
  /** Reflection intensity multiplier. */
  reflectionIntensity?: number;
  /** Sun direction in world space (specular highlight + reflected glow). */
  sunDirection?: Vec3;
  /** Sun colour. */
  sunColor?: string;
  /** Sun specular shininess exponent. */
  sunShininess?: number;
  /** Foam colour. */
  foamColor?: string;
  /** Foam amount, 0 = none. */
  foamAmount?: number;
  /** Fresnel exponent (higher = reflections concentrated near the horizon). */
  fresnelPower?: number;
  /** Micro-ripple frequency (waves per world unit) for close-up detail. */
  detailScale?: number;
  /** Micro-ripple normal strength. */
  detailStrength?: number;
};

/**
 * Appearance of the water BODY — the volume seen through the sides of a water
 * box, or through the walls of a chunk's water layer.
 *
 * @expand
 * @group Components
 */
export type OceanBodyProps = {
  /** Per-meter tint build-up of the water body. */
  bodyFogDensity?: number;
  /** Densest water-body tint reached far through the water (0..1). */
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
  props: OceanWaterProps & WithOpacity,
): void {
  const opacity = props.opacity ?? 1;

  if (props.windDirection)
    material.windDirection = new Vector2(
      props.windDirection[0],
      props.windDirection[1],
    );
  if (props.windSpeed !== undefined) material.windSpeed = props.windSpeed;
  if (props.amplitude !== undefined) material.amplitude = props.amplitude;
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
  if (props.sunDirection)
    material.sunDirection = new Vector3(
      props.sunDirection[0],
      props.sunDirection[1],
      props.sunDirection[2],
    );
  if (props.sunColor) material.sunColor = props.sunColor;
  if (props.sunShininess !== undefined)
    material.sunShininess = props.sunShininess;
  if (props.foamColor) material.foamColor = props.foamColor;
  if (props.foamAmount !== undefined) material.foamAmount = props.foamAmount;
  if (props.fresnelPower !== undefined)
    material.fresnelPower = props.fresnelPower;
  if (props.detailScale !== undefined) material.detailScale = props.detailScale;
  if (props.detailStrength !== undefined)
    material.detailStrength = props.detailStrength;

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

  // Make the wall top ring follow the same wave displacement as the surface so
  // the rim stays sealed. The surface mutates its tables in place on sea-state
  // changes, so sharing them by reference keeps the walls in step for free.
  if (surface) {
    material.setWaveTables(
      surface.uniforms.uWaveA.value,
      surface.uniforms.uWaveB.value,
    );
    material.steepness = surface.steepness;
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
