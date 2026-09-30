import { Vec2 } from '../../sdk';

/**
 * A rock/sediment "type" a chunk layer can be drawn with, adding subtle
 * procedural surface relief up close.
 *
 * ⭐ The library ships the presets but never ASSIGNS one — which surface is sand
 * and which is shale is company-specific knowledge, exactly like colour (see the
 * "colour is config" rule in `documents/chunks.md`). The host maps its own
 * classification onto these names; the generated `SedimentClass` in
 * `surface-column.ts` uses the same vocabulary so a generated scenario can be
 * mapped straight through.
 *
 * `seabed` is the odd one out: it is not a sediment class but the sand-dune relief
 * the `Ocean` sea bed draws, for a chunk layer that IS a sea bed.
 *
 * @group Components
 */
export type ChunkDetailPreset =
  | 'sand'
  | 'silt'
  | 'shale'
  | 'carbonate'
  | 'salt'
  | 'coal'
  | 'basement'
  | 'seabed';

/**
 * Procedural surface detail for a chunk layer: a {@link ChunkDetailPreset}, or one
 * with its overall strength scaled.
 *
 * @group Components
 */
export type ChunkDetail =
  | ChunkDetailPreset
  | {
      preset: ChunkDetailPreset;
      /** scales the whole preset. 0 = off, 1 = as designed. Default 1. */
      strength?: number;
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
export type ChunkDetailParams = {
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
     * depth it happens to sit at. Needs the wall's `wallV` attribute; ignored on
     * caps, which have no such axis.
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
  /** how much the relief also modulates the unit's colour (0..1) */
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
export const CHUNK_DETAIL_PRESETS: Record<
  ChunkDetailPreset,
  ChunkDetailParams
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
export const CHUNK_DETAIL_PRESET_NAMES = Object.keys(
  CHUNK_DETAIL_PRESETS,
) as ChunkDetailPreset[];

/** A resolved {@link ChunkDetail}, or `null` when there is nothing to draw. */ export type ResolvedChunkDetail =
  {
    preset: ChunkDetailPreset;
    params: ChunkDetailParams;
    strength: number;
  };

/**
 * Resolve a {@link ChunkDetail} to its preset parameters, or `null` for no detail
 * (which is what keeps the shader branch compiled out entirely).
 *
 * @group Components
 */
export function resolveChunkDetail(
  detail?: ChunkDetail,
): ResolvedChunkDetail | null {
  if (!detail) return null;
  const preset = typeof detail === 'string' ? detail : detail.preset;
  const params = CHUNK_DETAIL_PRESETS[preset];
  if (!params) return null;
  const strength = typeof detail === 'string' ? 1 : (detail.strength ?? 1);
  if (strength <= 0) return null;
  return { preset, params, strength };
}

/** A stable key for a resolved detail, for memo/content keys. */
export function chunkDetailKey(detail?: ChunkDetail): string {
  const resolved = resolveChunkDetail(detail);
  return resolved ? `${resolved.preset}:${resolved.strength}` : '';
}
