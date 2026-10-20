import { IUniform, Vector2, Vector4 } from 'three';
import { Vec2 } from '../types/common';

/**
 * A rock/sediment "type" a surface can be drawn with, adding subtle procedural surface
 * relief up close.
 *
 * ⭐ The library ships the presets but never ASSIGNS one — which surface is sand
 * and which is shale is company-specific knowledge, exactly like colour (see the
 * "colour is config" rule in `documents/chunks.md`). The host maps its own
 * classification onto these names; the generated `SedimentClass` in
 * `surface-column.ts` uses the same vocabulary so a generated scenario can be
 * mapped straight through.
 *
 * `seabed` is the odd one out: it is not a sediment class but the sand-dune relief
 * the `Ocean` sea bed draws, for a surface that IS a sea bed.
 */
export type SurfaceDetailPreset =
  | 'sand'
  | 'silt'
  | 'shale'
  | 'carbonate'
  | 'salt'
  | 'coal'
  | 'basement'
  | 'seabed';

/**
 * Procedural surface detail: a {@link SurfaceDetailPreset}, or one with its overall
 * strength and feature size scaled.
 */
export type SurfaceDetail =
  | SurfaceDetailPreset
  | {
      preset: SurfaceDetailPreset;
      /** scales the whole preset. 0 = off, 1 = as designed. Default 1. */
      strength?: number;
      /**
       * Multiplies every feature size (default 1). The slopes stay the same, so the
       * look is kept and only the size changes — for a surface mostly seen from
       * further away than a preset resolves at (its coarsest cells are 5–20 m, gone
       * beyond a few km).
       */
      scale?: number;
    };

/**
 * What a preset actually asks the shader for. Internal: the public surface is the
 * preset name plus one strength, deliberately, so the look stays consistent
 * between layers and fields.
 *
 * Frequencies are in CELLS PER METRE and the pattern is anchored in world space, so
 * a feature keeps its size wherever it is drawn — the whole point of going
 * procedural rather than repeating a normal map per surface.
 */
export type SurfaceDetailParams = {
  /** isotropic bumps: grains, pebbles, a rough rock face */
  granular?: {
    strength: number;
    frequency: number;
    octaves: number;
    /** stretches the cells along the pattern's y axis (0..1) */
    anisotropy?: number;
  };
  /** directional grain: bedding, lamination, a fabric */
  grain?: {
    strength: number;
    frequency: number;
    /** radians; `PI/2` runs the ridges horizontally, i.e. bedding on a wall */
    angle: number;
    /** thins the ridges (0..1) */
    sharpness: number;
    /** irregular grain (0) .. regular flutes (1) */
    uniformity: number;
    octaves: number;
    /**
     * On a WALL, how far the vertical axis follows the UNIT instead of absolute
     * depth (0..1). At 1 a bed spans the same fraction of a thin unit as of a thick
     * one, so the lamination reads as a property of the unit rather than of the
     * depth it happens to sit at. Needs the unit-relative height (a chunk wall's
     * `wallV`); ignored without it.
     */
    bedding?: number;
    /** beds across the unit when `bedding` is 1 */
    laminae?: number;
  };
  /** large meandering ridges (a sand-dune sea bed); horizontal faces only */
  dunes?: {
    strength: number;
    /** crest spacing of the coarsest ridge, in metres */
    wavelength: number;
    direction?: Vec2;
  };
  /** how much the relief also modulates the surface's colour (0..1) */
  albedo: number;
  /** bump height; the perceived maximum slope is roughly `strength * height` */
  height: number;
};

const HALF_PI = Math.PI / 2;

/**
 * The presets.
 *
 * ⭐⭐ FEATURE SIZES ARE DELIBERATELY EXAGGERATED — a real sand grain or lamina cannot
 * be drawn at field scale. What can be sampled sets the size, not the geology: at a
 * ~50° fov a metre spans about `1000 / distance` pixels, and a pattern cell needs to
 * stay above ~2.5 px to be drawn without aliasing. So a 0.5 m cell is gone beyond ~200 m
 * — nothing but shimmer on the way out — while a 10 m cell survives to ~4 km. Each
 * preset therefore spans a BAND: a coarse octave (5–20 m) that carries the look at field
 * distance, down to a fine one (~0.5–1 m) that only resolves up close. Because an fbm
 * octave's slope is roughly constant, the coarse octaves read as the same material
 * rather than as terrain, and `pnFbmSigned2Filtered` drops the fine ones one at a time
 * as they stop being resolvable.
 *
 * `frequency` is in CELLS PER METRE, so `1 / frequency` is the COARSEST feature's size.
 */
export const SURFACE_DETAIL_PRESETS: Record<
  SurfaceDetailPreset,
  SurfaceDetailParams
> = {
  sand: {
    // 8 m .. 0.5 m
    granular: { strength: 1, frequency: 0.125, octaves: 5 },
    albedo: 0.03,
    height: 0.175,
  },
  silt: {
    // 6 m .. 0.75 m
    granular: { strength: 0.7, frequency: 0.167, octaves: 4 },
    albedo: 0.02,
    height: 0.15,
  },
  shale: {
    granular: { strength: 0.35, frequency: 0.167, octaves: 4 },
    grain: {
      strength: 1,
      frequency: 0.25, // 4 m beds
      angle: HALF_PI,
      sharpness: 0.55,
      uniformity: 0.45,
      octaves: 4,
      bedding: 0.8,
      laminae: 10,
    },
    albedo: 0.04,
    height: 0.2,
  },
  carbonate: {
    // 12 m .. 0.75 m
    granular: { strength: 0.9, frequency: 0.083, octaves: 5 },
    grain: {
      strength: 0.3,
      frequency: 0.083,
      angle: 0.35,
      sharpness: 0.3,
      uniformity: 0.15,
      octaves: 3,
      bedding: 0.4,
      laminae: 4,
    },
    albedo: 0.025,
    height: 0.2,
  },
  salt: {
    // 20 m .. 1.25 m — broad, smooth, crystalline swirls
    granular: { strength: 0.6, frequency: 0.05, octaves: 5, anisotropy: 0.35 },
    albedo: 0.015,
    height: 0.125,
  },
  coal: {
    granular: { strength: 0.5, frequency: 0.2, octaves: 4 },
    grain: {
      strength: 0.9,
      frequency: 0.3, // 3.3 m beds
      angle: HALF_PI,
      sharpness: 0.8,
      uniformity: 0.6,
      octaves: 3,
      bedding: 0.9,
      laminae: 16,
    },
    albedo: 0.05,
    height: 0.225,
  },
  basement: {
    // 16 m .. 0.5 m — the widest band, for the roughest rock
    granular: { strength: 1.4, frequency: 0.0625, octaves: 6 },
    grain: {
      strength: 0.5,
      frequency: 0.05,
      angle: 0.6,
      sharpness: 0.35,
      uniformity: 0,
      octaves: 4,
    },
    albedo: 0.045,
    height: 0.275,
  },
  seabed: {
    granular: { strength: 0.6, frequency: 0.125, octaves: 4 },
    dunes: { strength: 0.25, wavelength: 180, direction: [1, 0.35] },
    albedo: 0.025,
    height: 0.15,
  },
};

/** Every preset name, in declaration order (for pickers and controls). */
export const SURFACE_DETAIL_PRESET_NAMES = Object.keys(
  SURFACE_DETAIL_PRESETS,
) as SurfaceDetailPreset[];

/** A resolved {@link SurfaceDetail}, or `null` when there is nothing to draw. */
export type ResolvedSurfaceDetail = {
  preset: SurfaceDetailPreset;
  params: SurfaceDetailParams;
  strength: number;
  scale: number;
};

/**
 * Resolve a {@link SurfaceDetail} to its preset parameters, or `null` for no detail
 * (which is what keeps the shader branch compiled out entirely).
 */
export function resolveSurfaceDetail(
  detail?: SurfaceDetail,
): ResolvedSurfaceDetail | null {
  if (!detail) return null;
  const preset = typeof detail === 'string' ? detail : detail.preset;
  const params = SURFACE_DETAIL_PRESETS[preset];
  if (!params) return null;
  const strength = typeof detail === 'string' ? 1 : (detail.strength ?? 1);
  if (strength <= 0) return null;
  const scale = typeof detail === 'string' ? 1 : (detail.scale ?? 1);
  return { preset, params, strength, scale: scale > 0 ? scale : 1 };
}

/** A stable key for a resolved detail, for memo/content keys. */
export function surfaceDetailKey(detail?: SurfaceDetail): string {
  const resolved = resolveSurfaceDetail(detail);
  return resolved
    ? `${resolved.preset}:${resolved.strength}:${resolved.scale}`
    : '';
}

/**
 * The uniforms `shaderLib/surface-detail.glsl` reads. Packed so a preset costs a
 * handful of uniforms rather than a dozen.
 */
export type SurfaceDetailUniforms = {
  /** overall multiplier (the caller's one knob) */
  detailStrength: IUniform<number>;
  /** x: albedo modulation, y: bump height */
  detailShade: IUniform<Vector2>;
  /** x: strength, y: frequency, z: octaves, w: anisotropy */
  detailGranular: IUniform<Vector4>;
  /** x: strength, y: frequency, z: angle, w: sharpness */
  detailGrain: IUniform<Vector4>;
  /** x: uniformity, y: octaves, z: bedding mix, w: laminae */
  detailGrainB: IUniform<Vector4>;
  /** x: strength, y: wavelength, zw: direction */
  detailDunes: IUniform<Vector4>;
};

/** {@link SurfaceDetailUniforms} with no detail in them. */
export function createSurfaceDetailUniforms(): SurfaceDetailUniforms {
  return {
    detailStrength: { value: 1 },
    detailShade: { value: new Vector2() },
    detailGranular: { value: new Vector4() },
    detailGrain: { value: new Vector4() },
    detailGrainB: { value: new Vector4() },
    detailDunes: { value: new Vector4() },
  };
}

/** The defines {@link applySurfaceDetail} sets: a material's program depends on them. */
export const SURFACE_DETAIL_DEFINES = [
  'SURFACE_DETAIL',
  'SURFACE_DETAIL_GRANULAR',
  'SURFACE_DETAIL_GRAIN',
  'SURFACE_DETAIL_DUNES',
  'SURFACE_DETAIL_BEDDING',
] as const;

/**
 * Write `detail` into `uniforms` and set the defines `surface-detail.glsl` compiles
 * by, clearing them for none. `bedding`: the surface has a unit-relative height to lay
 * bedding along (see {@link SurfaceDetailParams}). Returns whether there is any detail.
 *
 * ⚠️ The defines are read at compile time: a material whose detail changes needs
 * `needsUpdate`.
 */
export function applySurfaceDetail(
  uniforms: SurfaceDetailUniforms,
  defines: Record<string, unknown>,
  detail: SurfaceDetail | undefined,
  bedding = false,
): boolean {
  for (const key of SURFACE_DETAIL_DEFINES) delete defines[key];
  const resolved = resolveSurfaceDetail(detail);
  if (!resolved) return false;

  const { params, strength, scale } = resolved;
  defines.SURFACE_DETAIL = '';
  if (bedding) defines.SURFACE_DETAIL_BEDDING = '';
  uniforms.detailStrength.value = strength;
  uniforms.detailShade.value.set(params.albedo, params.height);

  // Slopes are frequency-independent in the shader, so scaling sizes keeps the look.
  if (params.granular) {
    const g = params.granular;
    defines.SURFACE_DETAIL_GRANULAR = '';
    uniforms.detailGranular.value.set(
      g.strength,
      g.frequency / scale,
      g.octaves,
      g.anisotropy ?? 0,
    );
  }
  if (params.grain) {
    const g = params.grain;
    defines.SURFACE_DETAIL_GRAIN = '';
    uniforms.detailGrain.value.set(
      g.strength,
      g.frequency / scale,
      g.angle,
      g.sharpness,
    );
    uniforms.detailGrainB.value.set(
      g.uniformity,
      g.octaves,
      bedding ? (g.bedding ?? 0) : 0,
      g.laminae ?? 1,
    );
  }
  if (params.dunes) {
    const d = params.dunes;
    defines.SURFACE_DETAIL_DUNES = '';
    const [dx, dz] = d.direction ?? [1, 0];
    uniforms.detailDunes.value.set(d.strength, d.wavelength * scale, dx, dz);
  }
  return true;
}
