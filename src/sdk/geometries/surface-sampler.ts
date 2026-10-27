import type { TinSample } from './tin-sampler';

/**
 * Read-only height queries against ground as it is DRAWN: the surfaces a `ChunkStack`
 * draws (`createSurfaceSampler`), or a relief a `SceneryStage` draws from tiles
 * (`ReliefSampler`). What is placed on the ground — a pipeline, a structure, a marker —
 * asks one, through `useSurfaceSampler`.
 *
 * ⭐ It samples the triangles on screen, not the source grid: a grid sample and
 * the drawn mesh differ by up to the tessellation's `maxError`, which at field
 * scale is metres — enough for an object to visibly float above the sea bed it is
 * meant to be standing on.
 *
 * The counterpart to `OceanSampler`: that one is analytic because the sea is a
 * function of time, this one reads geometry because a horizon is a function of
 * data. Both return the caller's own scene frame, and both are `null` when there
 * is nothing to sample, so a consumer keeps its static pose rather than jumping to
 * the origin.
 *
 * @group Geometries
 */
export type SurfaceSampler = {
  /**
   * Height and surface normal at a world X/Z, or `null` where nothing is drawn —
   * outside the outline, in a hole, or where the unit has pinched out.
   *
   * @param surface a surface id to sample that horizon alone; omitted, the
   *   HIGHEST drawn surface answers, which is the ground as it is seen from above
   * @param out reused to avoid allocating on a per-pointer-move path
   */
  sampleAt(
    x: number,
    z: number,
    surface?: string,
    out?: TinSample,
  ): TinSample | null;
  /** Just the height, or `null` where nothing is drawn. */
  getHeightAt(x: number, z: number, surface?: string): number | null;
  /**
   * How far inside the drawn block a point is, in metres to the nearest face, or
   * `null` when it is in open air.
   *
   * ⭐ Asked per CHUNK. "Below the highest surface and above the block's base" is
   * only the same question while the stack is one solid extrusion; give two chunks
   * different footprints and there is open air between them wherever the narrower
   * one is absent, which that test reads as rock.
   *
   * ⚠️ A chunk whose caps meet — a horizon its neighbour draws under the seam rule,
   * or a unit pinched out to nothing — spans zero here, so a sliver at such a seam
   * reads as air. The union over chunks covers most of it.
   *
   * @param floor the block's base below the deepest horizon, for a carrier fill
   *   that is deliberately not sampleable
   */
  solidAt(x: number, y: number, z: number, floor?: number): number | null;
  /** Ids of the surfaces currently drawn, and so sampleable. */
  readonly surfaces: string[];
  /**
   * Keep the finest data under these squares (min X, min Z, max X, max Z) at hand,
   * whatever the view, so the answers there hold still; returns the release. Only a
   * sampler that reads what streams in has one — a relief's (`ReliefSampler`): its
   * identity changes when the data under a pin comes in, which is the signal to settle
   * again.
   */
  pin?: (squares: [number, number, number, number][]) => () => void;
};
