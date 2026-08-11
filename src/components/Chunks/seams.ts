import { PlanarPolygonGeometry } from '../../sdk/geometries/planar-geometry';
import {
  polygonArea,
  polygonRelation,
} from '../../sdk/geometries/polygon-outline';

/**
 * A chunk's claim on one surface: it declares the surface as one of its layers,
 * and once its outline has resolved, with what footprint.
 */
export type SeamClaim = {
  /** the claiming chunk's registry key */
  key: string;
  /** bumped whenever this chunk publishes a different footprint */
  version: number;
  /** resolved footprint, or `null` when the chunk has none */
  polygon: PlanarPolygonGeometry | null;
  /**
   * the rim spacing that footprint is densified with. ⚠️ A cut has to be inserted
   * at the SAME points its owner used, or the two boundaries sample the reference
   * grid at different places and the seam opens a hairline crack.
   */
  rimSpacing?: number;
  /** the surface is this chunk's TOP layer, so the cap is its lid — and its own */
  top: boolean;
};

/** A neighbour's footprint, and how it was densified. */
export type SeamCut = {
  /** the owning chunk's registry key */
  key: string;
  /** bumped whenever that chunk publishes a different footprint */
  version: number;
  polygon: PlanarPolygonGeometry;
  rimSpacing?: number;
};

/** What one chunk does with a horizon it shares with another. */
export type SeamDecision = {
  /** draw the cap at all */
  draw: boolean;
  /**
   * Footprints of the chunks that draw the rest of it: this chunk draws its own
   * footprint MINUS these. Either a partial overlap, or a hole where an owner
   * sits wholly inside this footprint.
   */
  cuts: SeamCut[];
};

const EMPTY: SeamDecision = { draw: true, cuts: [] };

/**
 * Decide, for every chunk claiming a surface, whether it draws that surface's cap
 * and where a neighbour takes over.
 *
 * Two chunks that meet share their boundary horizon, and drawing it twice means
 * two independent tessellations fighting for the same pixels. Which of them draws
 * which part of it is answered here rather than declared by hand.
 *
 * ⭐ A horizon belongs to the chunk it is the **top layer** of: a cap is the lid
 * of the block underneath it, so drawing it with that block's own material and
 * opacity is what stops a translucent tier putting a see-through lid on an opaque
 * one. Claimants are therefore ordered lid owner first, then by area descending,
 * then by key, and each draws its footprint minus everything already taken:
 *
 * - **contained** in something already drawn — nothing is left, so it draws none
 *   of the horizon and needs no cuts either.
 * - **overlap** — the part an earlier claimant draws is cut away.
 * - **contains** something already drawn — the same cut, except it falls wholly
 *   inside, so this cap keeps a HOLE for the owner's own cap to fill.
 * - **disjoint** — both draw; there is nothing to share.
 *
 * A horizon that is nobody's top layer has no lid owner, which leaves the area
 * order: the widest draws it and the others cut around it. Two identical outlines
 * read as containment, so ties stay deterministic.
 *
 * @param claims every chunk claiming the surface
 * @returns one decision per claim, in the input order
 *
 * @group Components
 */
export function resolveSeam(claims: SeamClaim[]): SeamDecision[] {
  if (claims.length < 2) return claims.map(() => EMPTY);

  const ranked = claims
    .map((claim, index) => ({
      index,
      claim,
      area: claim.polygon ? polygonArea(claim.polygon) : 0,
    }))
    .sort(
      (a, b) =>
        Number(b.claim.top) - Number(a.claim.top) ||
        b.area - a.area ||
        (a.claim.key < b.claim.key ? -1 : 1),
    );

  const out: SeamDecision[] = claims.map(() => EMPTY);
  const drawn: typeof ranked = [];

  for (const entry of ranked) {
    if (!entry.claim.polygon) {
      out[entry.index] = { draw: false, cuts: [] };
      continue;
    }
    const cuts: SeamCut[] = [];
    let draw = true;
    for (const other of drawn) {
      const relation = polygonRelation(
        other.claim.polygon!,
        entry.claim.polygon,
      );
      if (relation === 'contains') {
        // Nothing of this one is left to draw, so it needs no cuts either.
        draw = false;
        break;
      }
      // 'contained' is the same subtraction as an overlap, only the neighbour
      // falls wholly inside — which is what the lid owner being the NARROWER
      // chunk makes possible.
      if (relation === 'overlap' || relation === 'contained') {
        cuts.push({
          key: other.claim.key,
          version: other.claim.version,
          polygon: other.claim.polygon!,
          rimSpacing: other.claim.rimSpacing,
        });
      }
    }
    out[entry.index] = { draw, cuts: draw ? cuts : [] };
    if (draw) drawn.push(entry);
  }

  return out;
}
