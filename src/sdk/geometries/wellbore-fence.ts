import { Vec2, Vec3 } from '../types/common';
import { getProjectedTrajectory } from '../utils/trajectory';
import {
  directionVec2,
  distanceVec2,
  dotVec2,
} from '../utils/vector-operations';
import { marchingSquares } from './marching-squares';

/**
 * A **fence** is a vertical surface swept along a wellbore's plan trace, used to
 * cut a chunk stack open along the well.
 *
 * ⭐ The defining property, and the reason this is cheap: a fence is VERTICAL, so
 * whether a point is cut away depends on its XZ only. The whole cut therefore
 * reduces to one scalar per XZ position — a signed distance to the fence curve —
 * which a shader can read as a varying and the CPU can contour to build the cut
 * face, with both reading the same numbers.
 *
 * The field is held on a raster rather than evaluated from the polyline directly.
 * ⚠️ That is not only for speed: a distance field is a SET, so a trajectory that
 * turns back on itself merges instead of producing the self-intersecting offset
 * curve an exact construction would have to repair. The price is that the SIGN is
 * discontinuous across such a crossing — see {@link createFenceField}.
 */

/**
 * How short a plan trace may be before it is treated as having no direction.
 *
 * ⚠️ A TOTAL, so it says nothing about the shape of either end.
 */
export const FENCE_MIN_DEVIATION = 100;

/** Above this, two extension directions count as the same one. */
const FENCE_COLLINEAR = 0.95;

/** Default radius around an extension's apex that does not count, in metres. */
export const FENCE_CLEARANCE_NEAR = 50;

/**
 * Default opening, in radians, a run-out must keep between itself and the trace.
 *
 * ⭐ 45° is the value measured to work on the Volve wells. It is a CONSTRAINT the
 * share objective is maximised under, not a competing objective — removing it (as
 * the share rewrite briefly did) leaves wells like F-15 D with a 2° head opening
 * and perfectly healthy shares.
 */
export const FENCE_CLEARANCE = Math.PI / 4;

/**
 * Default share of the block a fence tries to take away on the side being cut.
 * Above this the cut is judged good enough and stops being pushed wider.
 */
export const FENCE_REVEAL = 0.5;

/**
 * Share of the block below which a side is treated as unusable, and allowed its
 * own run-outs rather than the pair that suits both.
 *
 * ⭐ A FLOOR, not a preference. The two sides should be flip-sides of one cut
 * wherever that works at all — a viewer comparing them is comparing one section —
 * so a side gives up a good deal of removed share before it goes its own way.
 */
const FENCE_SHARE_FLOOR = 0.15;

const DEFAULT_CELL_SIZE = 50;
const DEFAULT_MAX_CELLS = 1 << 20;
const DEFAULT_MARGIN = 500;

/** A wellbore's plan trace, with the depth range it spans. */
export type FencePolyline = {
  /** scene XZ, resampled at `stepSize` */
  positions: Vec2[];
  /**
   * Scene Y at each position, so a taper can be expressed in DEPTH while the
   * field only ever knows arc length. ⚠️ Recovered by matching plan arc length
   * against the input path, because the projection resamples in plan and a
   * near-vertical section covers hundreds of metres of hole in one plan step.
   */
  depths: number[];
  /** shallowest scene Y on the path */
  top: number;
  /** deepest scene Y on the path */
  bottom: number;
  /** plan length, in metres */
  length: number;
};

/** Scene Y at each resampled plan position, matched by plan arc length. */
function traceDepths(path: Vec3[], positions: Vec2[]): number[] {
  const arc: number[] = [0];
  for (let i = 1; i < path.length; i++) {
    arc.push(
      arc[i - 1] +
        Math.hypot(path[i][0] - path[i - 1][0], path[i][2] - path[i - 1][2]),
    );
  }
  const out: number[] = [];
  let at = 0;
  let k = 0;
  for (let i = 0; i < positions.length; i++) {
    if (i > 0) at += distanceVec2(positions[i - 1], positions[i]);
    while (k + 1 < path.length && arc[k + 1] < at) k++;
    const next = Math.min(k + 1, path.length - 1);
    const span = arc[next] - arc[k];
    const t = span > 1e-9 ? (at - arc[k]) / span : 0;
    out.push(
      path[k][1] + (path[next][1] - path[k][1]) * Math.min(Math.max(t, 0), 1),
    );
  }
  return out;
}

/**
 * Project a trajectory onto the XZ plane, resampled at `stepSize`.
 *
 * ⚠️ Deliberately UNEXTENDED — {@link extendFencePolyline} is a separate step
 * because a fence has to escape the chunk's own outline, which a metre count
 * cannot express. (The seismic section extends by `extension`/`minSize` instead,
 * which is about making an image big enough to read.)
 *
 * @param path the trajectory in scene coordinates
 * @param stepSize resampling distance in metres
 *
 * @group Geometries
 */
export function createFencePolyline(
  path: Vec3[],
  stepSize: number = 50,
): FencePolyline | null {
  const projected = getProjectedTrajectory(path, stepSize, 0, 0);
  if (!projected || projected.positions.length === 0) return null;
  return { ...projected, depths: traceDepths(path, projected.positions) };
}

/**
 * A cutout that is WIDE where the well is shallow and closes to nothing where it
 * matters.
 *
 * ⭐⭐ The shallow section of a well is near-vertical, so its plan trace is a few
 * tens of metres of survey noise standing in for kilometres of hole — there is
 * nothing there worth following, and following it is what produces a cut that
 * pinches to a blade. Opening the corridor out instead gives the wiggle room to
 * live in, and costs nothing in the reservoir where the cut should hug the well.
 *
 * ⭐ Held in ARC LENGTH rather than depth, though it is authored in depth: the
 * conversion happens once on the CPU, which keeps this three numbers a shader can
 * hold in one uniform instead of a depth table it would have to look up.
 *
 * @group Geometries
 */
export type FenceTaper = {
  /** extra half width at the shallow end, in metres */
  headWidth: number;
  /** arc length up to which the full `headWidth` applies, in metres */
  from: number;
  /** arc length by which it has closed to nothing, in metres */
  to: number;
};

/**
 * The taper's extra half width at a point on the curve.
 *
 * ⚠️⚠️ Must match `fenceTaperWidth` in `depth-map.glsl` EXACTLY. The cut face is
 * placed with this one and the block is removed by the GPU evaluating that one,
 * so any difference between them is a sliver of block standing proud of the face,
 * or a gap behind it.
 *
 * @group Geometries
 */
export function fenceWidthAt(
  taper: FenceTaper | null | undefined,
  along: number,
): number {
  if (!taper || !(taper.headWidth > 0) || !(taper.to > taper.from)) return 0;
  if (along <= taper.from) return taper.headWidth;
  if (along >= taper.to) return 0;
  const t = (along - taper.from) / (taper.to - taper.from);
  return taper.headWidth * (1 - t * t * (3 - 2 * t));
}

/**
 * Depth at every point of a curve, read off the trace it was derived from.
 *
 * ⚠️⚠️ NOT index alignment. The extension adds a point at each end and the
 * de-looping removes however many the loop spanned, so the curve the field is
 * built from does not match the trace vertex for vertex — and a silently shifted
 * depth series puts the taper somewhere else down the well.
 *
 * ⭐ The run-out tips resolve to the trace's own endpoints, which is what the
 * taper wants anyway: the run-out into the wellhead is as open as the wellhead,
 * the one out of the terminal depth as closed as the terminal depth.
 *
 * @param curve the curve to resolve depths for, in scene XZ
 * @param trace the plan trace the depths belong to
 * @param depths scene Y at each `trace` vertex
 *
 * @group Geometries
 */
export function fenceDepthsFor(
  curve: Vec2[],
  trace: Vec2[],
  depths: number[],
): number[] {
  if (trace.length === 0 || depths.length === 0) return curve.map(() => 0);
  const cum = new Float64Array(trace.length);
  for (let i = 1; i < trace.length; i++) {
    cum[i] = cum[i - 1] + distanceVec2(trace[i - 1], trace[i]);
  }
  const hit: PolylineHit = { point: [0, 0], distance: 0, along: 0 };
  const depthAt = (i: number) => depths[Math.min(i, depths.length - 1)];
  return curve.map(p => {
    const near = nearestOnPolyline(trace, p[0], p[1], hit);
    if (near === null) return depthAt(0);
    let lo = 0;
    let hi = trace.length - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] <= near.along) lo = mid;
      else hi = mid;
    }
    const span = cum[hi] - cum[lo];
    const t = span > 1e-9 ? (near.along - cum[lo]) / span : 0;
    const a = depthAt(lo);
    return a + (depthAt(hi) - a) * Math.min(Math.max(t, 0), 1);
  });
}

/**
 * Convert a taper authored in DEPTH into the arc lengths a {@link FenceTaper}
 * holds.
 * @param positions the curve, extended
 * @param depths scene Y at each position — see {@link fenceDepthsFor}
 * @param shallowY scene Y down to which the cutout stays fully open
 * @param deepY scene Y by which it has closed
 *
 * @group Geometries
 */
export function fenceTaperRange(
  positions: Vec2[],
  depths: number[],
  shallowY: number,
  deepY: number,
): [number, number] {
  let arc = 0;
  let from = -1;
  let to = -1;
  for (let i = 0; i < positions.length; i++) {
    if (i > 0) arc += distanceVec2(positions[i - 1], positions[i]);
    const y = depths[Math.min(i, depths.length - 1)];
    if (from < 0 && y <= shallowY) from = arc;
    if (y <= deepY) {
      to = arc;
      break;
    }
  }
  if (from < 0) from = 0;
  if (to < 0) to = arc;
  return [from, to > from ? to : from + 1];
}

/** {@link extendFencePolyline} options. */
export type FenceExtendOptions = {
  /**
   * Rings to escape, in scene XZ. Every ring of the chunk outline; holes do no
   * harm, since only the FURTHEST crossing is taken.
   */
  rings: Vec2[][];
  /** metres to clear the outline by once outside. Default 500. */
  margin?: number;
  /**
   * Azimuth in radians, used when the trace has no plan direction of its own — a
   * vertical well. ⚠️ There is no way to derive one: a vertical well's plan trace
   * is a point, and every direction through it is equally arbitrary. Make it a
   * control rather than a constant.
   */
  azimuth?: number;
  /**
   * How far from an extension's apex the trace starts to count, in metres.
   * Default {@link FENCE_CLEARANCE_NEAR}. Points nearer than this are the tangent
   * itself and have no stable direction of their own.
   */
  clearanceNear?: number;
  /**
   * How wide an opening, in RADIANS, a run-out must keep between itself and the
   * rest of the trace. Default {@link FENCE_CLEARANCE}. 0 accepts any direction.
   *
   * ⚠⚠ A CONSTRAINT on the candidates, not the objective — which stays
   * {@link FenceExtendOptions.reveal}. The two are independent: a run-out folded
   * back alongside the well can still split the block evenly, so share alone will
   * happily choose a cut that pinches to nothing at the wellhead.
   */
  clearance?: number;
  /**
   * Which side is being taken away. ⚠️ A BUILD input, not a display one: the
   * run-outs are chosen by how much block each side is left with, so the two sides
   * do not generally share a curve and flipping means rebuilding.
   */
  side?: 1 | -1;
  /**
   * Share of the block, 0..1, the cut aims to take away on the side being removed.
   * Default {@link FENCE_REVEAL}. Reaching it is enough — the search stops
   * preferring wider cuts above it rather than swinging away from the well.
   *
   * ⚠️ A TARGET, not a guarantee. A well near the edge of the block cannot leave
   * half of it on both sides, and forcing that would contort the cut.
   */
  reveal?: number;
};

/** Furthest positive ray/ring crossing, or 0 when the ray never meets one. */
function escapeDistance(origin: Vec2, dir: Vec2, rings: Vec2[][]): number {
  let furthest = 0;
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      const ex = b[0] - a[0];
      const ez = b[1] - a[1];
      const denom = dir[0] * ez - dir[1] * ex;
      if (denom === 0) continue;
      const dx = a[0] - origin[0];
      const dz = a[1] - origin[1];
      const t = (dx * ez - dz * ex) / denom;
      const u = (dir[0] * dz - dx * dir[1]) / -denom;
      if (t > furthest && u >= 0 && u <= 1) furthest = t;
    }
  }
  return furthest;
}

/** Direction of the last non-degenerate step at either end of the trace. */
function endDirection(positions: Vec2[], fromStart: boolean): Vec2 | null {
  const n = positions.length;
  if (n < 2) return null;
  if (fromStart) {
    for (let i = 1; i < n; i++) {
      if (distanceVec2(positions[i], positions[0]) > 1e-6)
        return directionVec2(positions[i], positions[0]);
    }
  } else {
    for (let i = n - 2; i >= 0; i--) {
      if (distanceVec2(positions[i], positions[n - 1]) > 1e-6)
        return directionVec2(positions[i], positions[n - 1]);
    }
  }
  return null;
}

/** Bearings from `apex` to every trace point further off than `near`, sorted. */
function traceBearings(positions: Vec2[], apex: Vec2, near: number): number[] {
  const bearings: number[] = [];
  for (const p of positions) {
    const vx = p[0] - apex[0];
    const vz = p[1] - apex[1];
    if (vx * vx + vz * vz < near * near) continue;
    bearings.push(Math.atan2(vz, vx));
  }
  return bearings.sort((a, b) => a - b);
}
/**
 * What fraction of a footprint each side of a curve holds.
 *
 * ⭐⭐ THE quantity a fence is actually judged by, and the one every earlier proxy
 * failed to capture. A fence exists to take away what stands between the viewer
 * and the well, so what matters is that the side being removed is a usable piece
 * of the block — not how far the run-out sits from the trace in angle. Measured on
 * the Volve data the healthy wells split 43-58% while the broken ones leave one
 * side 0-17%, and a 0% side is a fence that either removes nothing or everything.
 *
 * ⚠️ Rasterised and flood filled EXACTLY as {@link createFenceField} does, seed
 * corner included, or the shares would describe a different partition from the one
 * the shader ends up reading.
 *
 * @returns `[seedShare, otherShare]` — the seed corner's component first
 */
function splitShares(
  curve: Vec2[],
  bounds: [number, number, number, number],
  resolution: number = 96,
): [number, number] {
  const [minX, minZ, maxX, maxZ] = bounds;
  const cell = Math.max(
    (maxX - minX) / resolution,
    (maxZ - minZ) / resolution,
    1e-6,
  );
  const nx = Math.ceil((maxX - minX) / cell) + 5;
  const ny = Math.ceil((maxZ - minZ) / cell) + 5;
  const origin: Vec2 = [minX - 2 * cell, minZ - 2 * cell];
  const mask = new Uint8Array(nx * ny);
  const toC = (p: Vec2) => (p[0] - origin[0]) / cell;
  const toR = (p: Vec2) => (p[1] - origin[1]) / cell;
  for (let i = 1; i < curve.length; i++) {
    rasterizeSegment(
      mask,
      nx,
      ny,
      toC(curve[i - 1]),
      toR(curve[i - 1]),
      toC(curve[i]),
      toR(curve[i]),
    );
  }

  const seen = new Uint8Array(nx * ny);
  let seed = -1;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) {
      seed = i;
      break;
    }
  }
  if (seed < 0) return [0, 0];
  const stack = [seed];
  seen[seed] = 1;
  while (stack.length > 0) {
    const at = stack.pop()!;
    const c = at % nx;
    const r = (at - c) / nx;
    if (c > 0 && !mask[at - 1] && !seen[at - 1]) {
      seen[at - 1] = 1;
      stack.push(at - 1);
    }
    if (c < nx - 1 && !mask[at + 1] && !seen[at + 1]) {
      seen[at + 1] = 1;
      stack.push(at + 1);
    }
    if (r > 0 && !mask[at - nx] && !seen[at - nx]) {
      seen[at - nx] = 1;
      stack.push(at - nx);
    }
    if (r < ny - 1 && !mask[at + nx] && !seen[at + nx]) {
      seen[at + nx] = 1;
      stack.push(at + nx);
    }
  }

  let inSeed = 0;
  let other = 0;
  for (let r = 0; r < ny; r++) {
    const z = origin[1] + r * cell;
    if (z < minZ || z > maxZ) continue;
    for (let c = 0; c < nx; c++) {
      const x = origin[0] + c * cell;
      if (x < minX || x > maxX) continue;
      const at = r * nx + c;
      if (mask[at]) continue;
      if (seen[at]) inSeed++;
      else other++;
    }
  }
  const total = inSeed + other;
  if (total === 0) return [0, 0];
  return [inSeed / total, other / total];
}

/**
 * Directions worth trying for a run-out: the end tangent, plus the middle of each
 * roomy gap between the bearings the trace occupies.
 *
 * ⚠️ Capped, and widest gaps first. The pairing below is quadratic in this list,
 * and a narrow gap cannot hold a run-out that clears anything anyway.
 *
 * ⚠️⚠️ `clearance` is a CONSTRAINT, not an objective. Share alone cannot see this:
 * a run-out that leaves the wellhead almost parallel to the trace can still split
 * the block in half, so it scores well while the "cut" it opens is a razor wedge
 * closing to nothing at the head. Measured on Volve, dropping the test put F-15 D
 * back to a 2° head opening while its shares stayed a healthy 25/75.
 */
function runOutCandidates(
  positions: Vec2[],
  apex: Vec2,
  natural: Vec2,
  near: number,
  clearance: number = FENCE_CLEARANCE,
  limit: number = 5,
): Vec2[] {
  const bearings = traceBearings(positions, apex, near);
  if (bearings.length === 0) return [natural];

  const clearanceOf = (dir: Vec2) => {
    const at = Math.atan2(dir[1], dir[0]);
    let closest = Math.PI;
    for (const b of bearings) {
      let d = Math.abs(b - at);
      if (d > Math.PI) d = 2 * Math.PI - d;
      if (d < closest) closest = d;
    }
    return closest;
  };

  const out: Vec2[] = [];
  // ⚠️ The raw end tangent is exactly the direction that fails on a fold-back well,
  // so it earns its place like any other candidate rather than being seeded.
  if (clearanceOf(natural) >= clearance) out.push(natural);

  const gaps: { mid: number; span: number }[] = [];
  for (let i = 0; i < bearings.length; i++) {
    const from = bearings[i];
    const to = bearings[(i + 1) % bearings.length];
    const span = i + 1 < bearings.length ? to - from : to + 2 * Math.PI - from;
    // A gap only holds a clearing run-out if BOTH flanks clear, so it must be
    // twice the clearance wide — the midpoint of a 0.2 rad gap clears 5.7°.
    if (span < 2 * clearance) continue;
    gaps.push({ mid: from + span * 0.5, span });
  }
  gaps.sort((a, b) => b.span - a.span);
  for (const gap of gaps.slice(0, limit)) {
    out.push([Math.cos(gap.mid), Math.sin(gap.mid)]);
  }

  // A well enclosed by its own trace clears nothing; take the roomiest direction
  // there is rather than leaving the caller with no cut at all.
  if (out.length === 0) {
    let best = { mid: Math.atan2(natural[1], natural[0]), span: -1 };
    for (let i = 0; i < bearings.length; i++) {
      const from = bearings[i];
      const to = bearings[(i + 1) % bearings.length];
      const span =
        i + 1 < bearings.length ? to - from : to + 2 * Math.PI - from;
      if (span > best.span) best = { mid: from + span * 0.5, span };
    }
    out.push([Math.cos(best.mid), Math.sin(best.mid)]);
  }
  return out;
}

/**
 * Run the trace out of the chunk, at both ends.
 *
 * ⭐ This is what turns a curve lying INSIDE the footprint into one that SEPARATES
 * it — without it there is no "side" to remove, only a slit. It is also the "cut
 * leading into the well head" and the one "out of the termination": the block is
 * opened along the well and then along the direction the well arrived from and
 * the one it was heading in.
 *
 * ⭐ The reach is DERIVED (ray-cast against the outline plus `margin`) rather than
 * configured, so it is right for any footprint. The DIRECTION is chosen for
 * clearance rather than taken from the end tangent — see {@link clearDirection}.
 *
 * ⚠️ Rotating a run-out leaves a CORNER where it meets the trace — up to 161
 * degrees between consecutive vertices on the Volve data. Nothing here rounds it:
 * both a general curvature relaxation and a tangent-arc fillet were tried and
 * measured worse than leaving it. See `/memories/repo/chunk-fence.md`.
 *
 * @group Geometries
 */
export function extendFencePolyline(
  positions: Vec2[],
  options: FenceExtendOptions,
): Vec2[] {
  if (positions.length === 0) return [];
  const margin = options.margin ?? DEFAULT_MARGIN;
  const azimuth = options.azimuth ?? 0;
  const near = options.clearanceNear ?? FENCE_CLEARANCE_NEAR;
  const clearance = options.clearance ?? FENCE_CLEARANCE;
  const side = options.side ?? 1;
  const reveal = options.reveal ?? FENCE_REVEAL;
  const fallback: Vec2 = [Math.cos(azimuth), Math.sin(azimuth)];

  let end = endDirection(positions, false) ?? fallback;
  let start = endDirection(positions, true) ?? [-fallback[0], -fallback[1]];

  // A trace with too little deviation to carry two independent directions would
  // otherwise send both extensions the same way, leaving the block uncut on one
  // side and doubly cut on the other.
  const plan = positions.reduce(
    (sum, p, i) => (i === 0 ? 0 : sum + distanceVec2(positions[i - 1], p)),
    0,
  );
  const first = positions[0];
  const last = positions[positions.length - 1];

  if (plan < FENCE_MIN_DEVIATION) {
    start = [-end[0], -end[1]];
  } else {
    // ⭐⭐ Chosen by what the cut actually LEAVES, not by the angle it makes with
    // the trace. See {@link splitShares}.
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    for (const ring of options.rings) {
      for (const p of ring) {
        if (p[0] < minX) minX = p[0];
        if (p[0] > maxX) maxX = p[0];
        if (p[1] < minZ) minZ = p[1];
        if (p[1] > maxZ) maxZ = p[1];
      }
    }
    if (maxX > minX && maxZ > minZ) {
      const bounds: [number, number, number, number] = [minX, minZ, maxX, maxZ];
      const starts = runOutCandidates(positions, first, start, near, clearance);
      const ends = runOutCandidates(positions, last, end, near, clearance);
      // ⭐ Capped at `reveal`: once the removed side is a usable piece of block,
      // more of it is not better, and chasing it would swing the cut away from the
      // well. Above the cap the score goes flat and the tie-break below decides.
      const cap = (v: number) => Math.min(v, reveal);

      let bestShared = -1;
      let bestSharedOwn = -1;
      let bestSharedPair: [Vec2, Vec2] | null = null;
      let bestOwn = -1;
      let bestOwnPair: [Vec2, Vec2] | null = null;
      for (const s of starts) {
        const sReach = escapeDistance(first, s, options.rings) + margin;
        const sTip: Vec2 = [first[0] + s[0] * sReach, first[1] + s[1] * sReach];
        for (const e of ends) {
          if (dotVec2(s, e) > FENCE_COLLINEAR) continue;
          const eReach = escapeDistance(last, e, options.rings) + margin;
          const curve: Vec2[] = [
            sTip,
            ...positions,
            [last[0] + e[0] * eReach, last[1] + e[1] * eReach] as Vec2,
          ];
          const [seedShare, otherShare] = splitShares(curve, bounds);
          // The shader discards the NON-seed component for side +1.
          const removedPlus = otherShare;
          const removedMinus = seedShare;
          const own = cap(side > 0 ? removedPlus : removedMinus);
          const shared = Math.min(cap(removedPlus), cap(removedMinus));
          if (shared > bestShared) {
            bestShared = shared;
            bestSharedOwn = own;
            bestSharedPair = [s, e];
          }
          if (own > bestOwn) {
            bestOwn = own;
            bestOwnPair = [s, e];
          }
        }
      }

      // ⭐⭐ The pair that serves BOTH sides wins unless it would leave THIS side
      // unusable. Preferring whichever pair is marginally better for the current
      // side instead makes the two views disagree on most wells (13 of 24 measured)
      // for a few points of share, and then they are no longer two views of one
      // section — which is the whole reason to have two.
      const pick =
        bestSharedPair && bestSharedOwn >= FENCE_SHARE_FLOOR
          ? bestSharedPair
          : (bestOwnPair ?? bestSharedPair);
      if (pick) {
        start = pick[0];
        end = pick[1];
      }
    }

    if (dotVec2(end, start) > FENCE_COLLINEAR) {
      start = [-end[0], -end[1]];
    }
  }

  const startReach = escapeDistance(first, start, options.rings) + margin;
  const endReach = escapeDistance(last, end, options.rings) + margin;

  // ⚠️⚠️ De-looped HERE, before the field is built from it, not merely on the face
  // afterwards. A curve that crosses itself encloses a pocket, and the flood fill
  // that signs the field hands that pocket the far side's sign — so the block gets
  // a closed island removed (or kept) that no face describes. Repairing only the
  // contour leaves the face saying one thing and the discard another, and which
  // way that mismatch reads flips with `side`, which is what makes width 0 look
  // like a plain inversion rather than a fit.
  return removeChainLoops([
    [
      first[0] + start[0] * startReach,
      first[1] + start[1] * startReach,
    ] as Vec2,
    ...positions,
    [last[0] + end[0] * endReach, last[1] + end[1] * endReach] as Vec2,
  ]);
}

/** A rasterised signed distance to a fence curve. */
export type FenceField = {
  /**
   * Signed distance to the curve in METRES. Negative on the side to be removed;
   * ⚠️ zero on the curve itself, so it is continuous across the boundary and
   * bilinear sampling of a coarse grid still gives a smooth cut.
   */
  values: Float32Array;
  /**
   * Distance ALONG the curve, in metres, carried out from the nearest point on
   * it — the natural `u` for anything drawn on the cut face, and what a seismic
   * image would have to be sampled by. ⚠️ Discontinuous where the nearest point
   * jumps, i.e. across the middle of a hairpin.
   */
  along: Float32Array;
  /**
   * The curve itself, extended. ⭐ Kept so a contour can be placed ANALYTICALLY
   * rather than read off the raster: the grid supplies only which points connect
   * to which (which is what makes it self-intersection-proof), and this supplies
   * where each one actually goes.
   */
  positions: Vec2[];
  nx: number;
  ny: number;
  /** scene XZ of node (0, 0) */
  origin: Vec2;
  /** metres per cell */
  cell: number;
  /** field range, for mapping an aperture onto "fully closed" / "fully open" */
  min: number;
  max: number;
};

/** The nearest point on a polyline to (x, z). */
export type PolylineHit = {
  /** scene XZ of the closest point on the curve */
  point: Vec2;
  /** distance to it, in metres */
  distance: number;
  /** how far along the curve it lies, in metres */
  along: number;
};

/**
 * Exact nearest point on a polyline.
 *
 * ⭐ The one primitive both halves of a fence rest on: the field's magnitude is
 * this distance, and a contour vertex is placed by pushing it out to the wanted
 * distance from this point. Using one function for both is what stops the drawn
 * face and the region it opens from drifting apart.
 *
 * @group Geometries
 */
export function nearestOnPolyline(
  positions: Vec2[],
  x: number,
  z: number,
  out?: PolylineHit,
): PolylineHit | null {
  if (positions.length === 0) return null;
  const result = out ?? { point: [0, 0] as Vec2, distance: 0, along: 0 };
  if (positions.length === 1) {
    result.point[0] = positions[0][0];
    result.point[1] = positions[0][1];
    result.distance = Math.hypot(x - positions[0][0], z - positions[0][1]);
    result.along = 0;
    return result;
  }
  let best = Infinity;
  let arc = 0;
  for (let i = 1; i < positions.length; i++) {
    const a = positions[i - 1];
    const b = positions[i];
    const ex = b[0] - a[0];
    const ez = b[1] - a[1];
    const len2 = ex * ex + ez * ez;
    const len = Math.sqrt(len2);
    let t = 0;
    if (len2 > 0) {
      t = ((x - a[0]) * ex + (z - a[1]) * ez) / len2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
    }
    const qx = a[0] + ex * t;
    const qz = a[1] + ez * t;
    const d2 = (x - qx) * (x - qx) + (z - qz) * (z - qz);
    if (d2 < best) {
      best = d2;
      result.point[0] = qx;
      result.point[1] = qz;
      result.along = arc + t * len;
    }
    arc += len;
  }
  result.distance = Math.sqrt(best);
  return result;
}

/** {@link createFenceField} options. */
export type FenceFieldOptions = {
  /** minX, minZ, maxX, maxZ in scene XZ — the area the field must cover */
  bounds: [number, number, number, number];
  /** target metres per cell. Default 50. */
  cellSize?: number;
  /** node budget; the cell is coarsened to stay inside it. Default 2^20. */
  maxCells?: number;
  /** swap which side of the curve is negative */
  flip?: boolean;
};

/** Mark every cell a segment passes through (8-connected, so a 4-connected flood
 * fill cannot leak across it diagonally). */
function rasterizeSegment(
  mask: Uint8Array,
  nx: number,
  ny: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
) {
  let cx = Math.round(x0);
  let cy = Math.round(y0);
  const tx = Math.round(x1);
  const ty = Math.round(y1);
  const dx = Math.abs(tx - cx);
  const dy = -Math.abs(ty - cy);
  const sx = cx < tx ? 1 : -1;
  const sy = cy < ty ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    if (cx >= 0 && cx < nx && cy >= 0 && cy < ny) mask[cy * nx + cx] = 1;
    if (cx === tx && cy === ty) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      cx += sx;
    }
    if (e2 <= dx) {
      err += dx;
      cy += sy;
    }
  }
}

/**
 * Rasterise the signed distance to a fence curve.
 *
 * The magnitude is the EXACT distance from each node to the polyline; the sign is
 * a 4-connected flood fill from the grid's min corner, so the component that
 * corner belongs to is one side and everything else is the other.
 *
 * ⚠️⚠️ The curve must LEAVE the grid at both ends, or the fill walks around it
 * and calls the whole field one side. {@link extendFencePolyline} against the
 * bounds is what guarantees that — escaping the outline is not enough when the
 * outline is concave.
 *
 * ⚠️ **Self-intersection.** The magnitude is unaffected — a distance field is a
 * set, so a trajectory that doubles back merges rather than needing repair. The
 * SIGN, however, is not defined across a self-crossing: the far branch flips it,
 * and bilinear sampling smears that step over about one cell. This is the same
 * case the seismic fence accepts, and it is why the sign comes from a fill rather
 * than from the side of the nearest segment (which would speckle).
 *
 * ⚠️ Pockets a self-crossing closes off do not contain the min corner, so they
 * take the far side's sign. That is a choice, not a derivation.
 *
 * @group Geometries
 */
export function createFenceField(
  positions: Vec2[],
  options: FenceFieldOptions,
): FenceField | null {
  if (positions.length === 0) return null;
  const [minX, minZ, maxX, maxZ] = options.bounds;
  const width = maxX - minX;
  const depth = maxZ - minZ;
  if (!(width > 0) || !(depth > 0)) return null;

  let cell = options.cellSize ?? DEFAULT_CELL_SIZE;
  const budget = options.maxCells ?? DEFAULT_MAX_CELLS;
  // A margin of two cells keeps the chamfer's diagonal steps off the border.
  let nx = Math.ceil(width / cell) + 5;
  let ny = Math.ceil(depth / cell) + 5;
  if (nx * ny > budget) {
    const scale = Math.sqrt((nx * ny) / budget);
    cell *= scale;
    nx = Math.ceil(width / cell) + 5;
    ny = Math.ceil(depth / cell) + 5;
  }
  const origin: Vec2 = [minX - 2 * cell, minZ - 2 * cell];

  const mask = new Uint8Array(nx * ny);
  const toC = (p: Vec2) => (p[0] - origin[0]) / cell;
  const toR = (p: Vec2) => (p[1] - origin[1]) / cell;
  if (positions.length === 1) {
    rasterizeSegment(
      mask,
      nx,
      ny,
      toC(positions[0]),
      toR(positions[0]),
      toC(positions[0]),
      toR(positions[0]),
    );
  }
  for (let i = 1; i < positions.length; i++) {
    rasterizeSegment(
      mask,
      nx,
      ny,
      toC(positions[i - 1]),
      toR(positions[i - 1]),
      toC(positions[i]),
      toR(positions[i]),
    );
  }

  // ⭐⭐ EXACT distance to the polyline, node by node — NOT a chamfer transform.
  // A chamfer is off by a few percent and, worse, ANISOTROPICALLY so: the error
  // depends on direction, which at a kilometre-wide corridor makes it visibly
  // wider on the diagonals than on the axes. The corridor's whole shape is an
  // isocontour of this field, so that error is the feature's precision.
  // Cost is nodes x segments with a bounding-box reject, which at the grid sizes
  // a fence needs (tens of thousands of nodes, a couple of hundred segments) is a
  // few milliseconds — paid once per fence, never per frame.
  const count = Math.max(positions.length - 1, 1);
  const cum = new Float64Array(count + 1);
  for (let i = 1; i < positions.length; i++) {
    cum[i] = cum[i - 1] + distanceVec2(positions[i - 1], positions[i]);
  }
  const segMinX = new Float64Array(count);
  const segMaxX = new Float64Array(count);
  const segMinZ = new Float64Array(count);
  const segMaxZ = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    const a = positions[i];
    const b = positions[Math.min(i + 1, positions.length - 1)];
    segMinX[i] = Math.min(a[0], b[0]);
    segMaxX[i] = Math.max(a[0], b[0]);
    segMinZ[i] = Math.min(a[1], b[1]);
    segMaxZ[i] = Math.max(a[1], b[1]);
  }

  const dist = new Float32Array(nx * ny);
  const along = new Float32Array(nx * ny);
  // Which side of the nearest segment the node falls on. ⚠️ Speckles across a
  // self-crossing, which is why it does NOT decide the sign on its own — but it is
  // the only thing that can sign the band the flood fill cannot enter.
  const geo = new Int8Array(nx * ny);
  for (let r = 0; r < ny; r++) {
    const pz = origin[1] + r * cell;
    for (let c = 0; c < nx; c++) {
      const px = origin[0] + c * cell;
      let best = Infinity;
      let bestAlong = 0;
      let bestCross = 0;
      for (let i = 0; i < count; i++) {
        const bx =
          px < segMinX[i]
            ? segMinX[i] - px
            : px > segMaxX[i]
              ? px - segMaxX[i]
              : 0;
        const bz =
          pz < segMinZ[i]
            ? segMinZ[i] - pz
            : pz > segMaxZ[i]
              ? pz - segMaxZ[i]
              : 0;
        if (bx * bx + bz * bz >= best) continue;
        const a = positions[i];
        const b = positions[Math.min(i + 1, positions.length - 1)];
        const ex = b[0] - a[0];
        const ez = b[1] - a[1];
        const len2 = ex * ex + ez * ez;
        let t = 0;
        if (len2 > 0) {
          t = ((px - a[0]) * ex + (pz - a[1]) * ez) / len2;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
        }
        const qx = a[0] + ex * t;
        const qz = a[1] + ez * t;
        const d2 = (px - qx) * (px - qx) + (pz - qz) * (pz - qz);
        if (d2 < best) {
          best = d2;
          bestAlong = cum[i] + t * (cum[Math.min(i + 1, count)] - cum[i]);
          bestCross = ex * (pz - a[1]) - ez * (px - a[0]);
        }
      }
      const at = r * nx + c;
      dist[at] = Math.sqrt(best);
      along[at] = bestAlong;
      geo[at] = bestCross >= 0 ? 1 : -1;
    }
  }

  // 4-connected flood from the first free node, which the 8-connected barrier
  // above cannot be crossed diagonally by.
  const side = new Uint8Array(nx * ny);
  let seed = -1;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) {
      seed = i;
      break;
    }
  }
  if (seed >= 0) {
    const stack = [seed];
    side[seed] = 1;
    while (stack.length > 0) {
      const at = stack.pop()!;
      const c = at % nx;
      const r = (at - c) / nx;
      if (c > 0 && !mask[at - 1] && !side[at - 1]) {
        side[at - 1] = 1;
        stack.push(at - 1);
      }
      if (c < nx - 1 && !mask[at + 1] && !side[at + 1]) {
        side[at + 1] = 1;
        stack.push(at + 1);
      }
      if (r > 0 && !mask[at - nx] && !side[at - nx]) {
        side[at - nx] = 1;
        stack.push(at - nx);
      }
      if (r < ny - 1 && !mask[at + nx] && !side[at + nx]) {
        side[at + nx] = 1;
        stack.push(at + nx);
      }
    }
  }

  // ⚠️⚠️ The fill CANNOT enter the barrier, so every cell the curve passes through
  // would keep `side = 0` and be forced onto the negative side whichever side of
  // the curve it actually lies on. That is a one-cell band of wrong-signed values
  // straddling the curve, each wrong by its own distance — so the ZERO contour
  // wiggles at cell period even though the curve is straight. It is invisible at a
  // large width (the iso is well clear of the band) and ruins width 0.
  // ⇒ Sign the band geometrically, oriented to agree with the fill.
  let agree = 0;
  let disagree = 0;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i]) continue;
    if (geo[i] > 0 === (side[i] === 1)) agree++;
    else disagree++;
  }
  const geoPositive = agree >= disagree;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    side[i] = geo[i] > 0 === geoPositive ? 1 : 0;
  }

  const sign = options.flip ? -1 : 1;
  const values = new Float32Array(nx * ny);
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < values.length; i++) {
    // The kept side is the one the seed corner is in, unless flipped.
    const v = (side[i] ? sign : -sign) * dist[i];
    values[i] = v;
    if (v < min) min = v;
    if (v > max) max = v;
  }

  return { values, along, positions, nx, ny, origin, cell, min, max };
}

/**
 * Read one channel the way the SHADER reads it.
 *
 * ⚠️⚠️ Must match `sampleFieldMap` in `depth-map.glsl` EXACTLY — plain bilinear,
 * same clamping, same half-texel convention. The cut face is placed by root-finding
 * on this function while the block is removed by the GPU evaluating that one, so
 * any difference between them is a sliver of block standing proud of the face, or
 * a gap behind it.
 */
function makeSampler(field: FenceField, values: Float32Array) {
  const { nx, ny, origin, cell } = field;
  return (x: number, z: number) => {
    const cf = (x - origin[0]) / cell;
    const rf = (z - origin[1]) / cell;
    const c0 = Math.floor(cf);
    const r0 = Math.floor(rf);
    const fc = cf - c0;
    const fr = rf - r0;
    const clampC = (c: number) => (c < 0 ? 0 : c > nx - 1 ? nx - 1 : c);
    const clampR = (r: number) => (r < 0 ? 0 : r > ny - 1 ? ny - 1 : r);
    const a = values[clampR(r0) * nx + clampC(c0)];
    const b = values[clampR(r0) * nx + clampC(c0 + 1)];
    const d = values[clampR(r0 + 1) * nx + clampC(c0)];
    const e = values[clampR(r0 + 1) * nx + clampC(c0 + 1)];
    return (a + (b - a) * fc) * (1 - fr) + (d + (e - d) * fc) * fr;
  };
}

/**
 * Bilinear sampler over a {@link FenceField}'s signed distance.
 *
 * @group Geometries
 */
export function sampleFenceField(
  field: FenceField,
): (x: number, z: number) => number {
  return makeSampler(field, field.values);
}

/**
 * Bilinear sampler over a {@link FenceField}'s arc length.
 *
 * @group Geometries
 */
export function sampleFenceAlong(
  field: FenceField,
): (x: number, z: number) => number {
  return makeSampler(field, field.along);
}

/** Where a field sits, in the form the shader reads it. */
export type FencePlacement = {
  /** row-major 3x3, object XZ -> uv */
  toUv: number[];
  /** grid size in texels */
  size: Vec2;
};

/**
 * Place a field for the shader.
 *
 * ⚠️⚠️ The `+0.5 / size` is load-bearing: `sampleFieldMap` recovers the node index
 * as `uv * size - 0.5`, so without it the GPU reads HALF A CELL away from the CPU.
 * At a 25 m field that is a 12.5 m disagreement between where the cut face is
 * drawn and where the block is actually removed, which shows as slivers of one
 * unit's cap standing along the cut. Kept here, as one definition, because it was
 * written out by hand at the call site and got this wrong.
 *
 * @group Geometries
 */
export function fenceFieldPlacement(field: FenceField): FencePlacement {
  const { nx, ny, origin, cell } = field;
  return {
    toUv: [
      1 / (nx * cell),
      0,
      -origin[0] / (nx * cell) + 0.5 / nx,
      0,
      1 / (ny * cell),
      -origin[1] / (ny * cell) + 0.5 / ny,
      0,
      0,
      1,
    ],
    size: [nx, ny],
  };
}

/**
 * Read a field the way the GPU does — through the placement matrix and the same
 * weights as `sampleFieldMap`.
 *
 * ⭐ Exists to be COMPARED with {@link sampleFenceField}. The cut face is placed
 * with one and the block is removed with the other, so any difference between
 * them is an artefact along the cut; a test that pins them together is the only
 * cheap way to keep that true.
 *
 * @group Geometries
 */
export function sampleFenceFieldAsShader(
  field: FenceField,
): (x: number, z: number) => number {
  const { toUv, size } = fenceFieldPlacement(field);
  const { values } = field;
  const [nx, ny] = size;
  return (x: number, z: number) => {
    const u = toUv[0] * x + toUv[1] * z + toUv[2];
    const v = toUv[3] * x + toUv[4] * z + toUv[5];
    const tx = u * nx - 0.5;
    const tz = v * ny - 0.5;
    const bx = Math.floor(tx);
    const bz = Math.floor(tz);
    const fx = tx - bx;
    const fz = tz - bz;
    const clampC = (c: number) => (c < 0 ? 0 : c > nx - 1 ? nx - 1 : c);
    const clampR = (r: number) => (r < 0 ? 0 : r > ny - 1 ? ny - 1 : r);
    let sum = 0;
    for (let j = 0; j < 2; j++) {
      for (let i = 0; i < 2; i++) {
        const w = (i === 0 ? 1 - fx : fx) * (j === 0 ? 1 - fz : fz);
        sum += values[clampR(bz + j) * nx + clampC(bx + i)] * w;
      }
    }
    return sum;
  };
}

/** Where a chain crosses itself, and the point it crosses at. */
type ChainLoop = { i: number; j: number; at: Vec2 };

/**
 * First self-crossing on a chain, taking the LARGEST loop at the earliest vertex.
 *
 * ⚠️ Bucketed by a uniform grid rather than compared pairwise. Pairwise is
 * quadratic in the vertex count and is paid in full on a CLEAN chain, which is
 * almost all of them — at a 2 m contour resolution that is a 4500 vertex chain and
 * tens of milliseconds per rebuild, on a path that runs while a width slider is
 * being dragged.
 */
function findChainLoop(points: Vec2[]): ChainLoop | null {
  const n = points.length;
  if (n < 4) return null;
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const p of points) {
    if (p[0] < minX) minX = p[0];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] < minZ) minZ = p[1];
    if (p[1] > maxZ) maxZ = p[1];
  }
  const cell = Math.max((maxX - minX) / 128, (maxZ - minZ) / 128, 1e-3);
  const columns = Math.floor((maxX - minX) / cell) + 1;
  const buckets = new Map<number, number[]>();
  const put = (cx: number, cz: number, i: number) => {
    const k = cz * columns + cx;
    const list = buckets.get(k);
    if (list) list.push(i);
    else buckets.set(k, [i]);
  };
  for (let i = 0; i + 1 < n; i++) {
    const a = points[i];
    const b = points[i + 1];
    const c0 = Math.floor((Math.min(a[0], b[0]) - minX) / cell);
    const c1 = Math.floor((Math.max(a[0], b[0]) - minX) / cell);
    const r0 = Math.floor((Math.min(a[1], b[1]) - minZ) / cell);
    const r1 = Math.floor((Math.max(a[1], b[1]) - minZ) / cell);
    for (let cx = c0; cx <= c1; cx++)
      for (let cz = r0; cz <= r1; cz++) put(cx, cz, i);
  }

  for (let i = 0; i + 1 < n; i++) {
    const a = points[i];
    const b = points[i + 1];
    const rx = b[0] - a[0];
    const rz = b[1] - a[1];
    const c0 = Math.floor((Math.min(a[0], b[0]) - minX) / cell);
    const c1 = Math.floor((Math.max(a[0], b[0]) - minX) / cell);
    const r0 = Math.floor((Math.min(a[1], b[1]) - minZ) / cell);
    const r1 = Math.floor((Math.max(a[1], b[1]) - minZ) / cell);
    let best: ChainLoop | null = null;
    for (let cx = c0; cx <= c1; cx++) {
      for (let cz = r0; cz <= r1; cz++) {
        const list = buckets.get(cz * columns + cx);
        if (!list) continue;
        for (const j of list) {
          // ⚠️ The largest loop at this vertex first — excising an inner one would
          // leave the outer one still wrapped around it.
          if (j <= i + 1 || (best && j <= best.j)) continue;
          const c = points[j];
          const d = points[j + 1];
          const sx = d[0] - c[0];
          const sz = d[1] - c[1];
          const den = rx * sz - rz * sx;
          if (den === 0) continue;
          const t = ((c[0] - a[0]) * sz - (c[1] - a[1]) * sx) / den;
          const u = ((c[0] - a[0]) * rz - (c[1] - a[1]) * rx) / den;
          if (t <= 1e-9 || t >= 1 - 1e-9 || u <= 1e-9 || u >= 1 - 1e-9)
            continue;
          best = { i, j, at: [a[0] + rx * t, a[1] + rz * t] };
        }
      }
    }
    if (best) return best;
  }
  return null;
}

/**
 * Cut the loops out of an open chain.
 *
 * ⭐⭐ The last line of defence, and the only one placed where it can see the
 * actual defect. A fence's cut face is a vertical ribbon swept along this chain,
 * so a chain that crosses itself sweeps a sheet that passes through itself — which
 * renders as a fan of triangles splayed from the crossing and a face that is
 * inside-out beyond it.
 *
 * ⚠️⚠️ Every earlier attempt at this worked on the POLYLINE the field is built
 * from, where the crossing DOES NOT YET EXIST: measured on the Volve data the
 * extended polylines self-cross zero times while their contours cross up to 965.
 * Measuring the wrong object is why two reasonable-looking fixes were rejected.
 *
 * ⭐ Acting on the finished chain also makes it indifferent to what produced the
 * loop — a rotated run-out, a trace that doubles back, or an offset taken round
 * the inside of a bend tighter than the offset — and to which side is being cut,
 * so both sides of a fence get the same treatment from one code path.
 *
 * The loop between a crossing pair is replaced by the crossing point itself, which
 * is exactly the curve with the excursion taken out.
 *
 * @param chain an open chain in scene XZ
 * @returns the chain with every self-crossing removed
 *
 * @group Geometries
 */
export function removeChainLoops(chain: Vec2[]): Vec2[] {
  if (chain.length < 4) return chain;
  const points = chain.slice();
  // ⚠️ Re-found rather than swept once: excising a loop joins two pieces that were
  // apart, which can put a NEW crossing behind the point a single forward pass has
  // already gone by. The bound is a guard against a pathological chain, not a
  // budget — a clean chain costs one search.
  for (let guard = 0; guard < 4096; guard++) {
    const loop = findChainLoop(points);
    if (!loop) break;
    points.splice(loop.i + 1, loop.j - loop.i, loop.at);
  }
  return points;
}

/** {@link fenceContour} options. */
export type FenceContourOptions = {
  /** distance from the curve to place the contour at, in metres */
  width?: number;
  /** which side the contour lies on: 1 or -1 */
  side?: 1 | -1;
  /** spacing to resample the result at, in metres. Default 10. */
  resolution?: number;
  /** extra width near the shallow end, on top of `width`. See {@link FenceTaper}. */
  taper?: FenceTaper | null;
};

/** Resample an open chain at a fixed spacing, keeping both ends. */
function resampleChain(chain: Vec2[], spacing: number): Vec2[] {
  if (chain.length < 2 || !(spacing > 0)) return chain;
  const out: Vec2[] = [chain[0]];
  let carry = 0;
  for (let i = 1; i < chain.length; i++) {
    const a = chain[i - 1];
    const b = chain[i];
    const len = distanceVec2(a, b);
    if (len === 0) continue;
    let at = spacing - carry;
    while (at < len) {
      const t = at / len;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      at += spacing;
    }
    carry = (carry + len) % spacing;
  }
  out.push(chain[chain.length - 1]);
  return out;
}

/**
 * The curve the cut face follows: everything at `width` from the fence, on the
 * kept side.
 *
 * ⭐⭐ The raster decides only the TOPOLOGY — which points join to which, and
 * therefore where the curve doubles back on itself — while every vertex's
 * POSITION comes from {@link nearestOnPolyline}, exactly. That split is what makes
 * one code path right at any width: offsetting a polyline directly self-intersects
 * on the inside of any bend tighter than the offset, and reading the contour off
 * the raster alone would quantise it to the cell size. At `width` 0 the projection
 * lands every vertex exactly on the trajectory.
 *
 * @returns open chains in scene XZ, resampled; normally one
 *
 * @group Geometries
 */
export function fenceContour(
  field: FenceField,
  options: FenceContourOptions = {},
): Vec2[][] {
  const width = options.width ?? 0;
  const side = options.side ?? 1;
  const resolution = options.resolution ?? 10;
  const taper = options.taper ?? null;
  const tapered = fenceWidthAt(taper, 0) > 0;
  const { nx, ny, origin, cell, values, positions } = field;

  // ⭐⭐ The face has to lie where the BLOCK ACTUALLY ENDS, and that is decided by
  // the shader sampling this field — not by the analytic curve the field was built
  // from. The two differ by a fraction of a cell, which is metres, and shows as a
  // sliver of cap standing proud of the face or a gap behind it. So every vertex
  // is finally pulled onto the SAMPLED iso by Newton steps on the same smoothed
  // read the shader performs.
  const sample = sampleFenceField(field);
  const alongAt = tapered ? sampleFenceAlong(field) : null;
  // ⚠️ The target is a FUNCTION of position once a taper is on, so it is read at
  // the point being snapped rather than fixed up front.
  const targetAt = (x: number, z: number) =>
    side * (width + (alongAt ? fenceWidthAt(taper, alongAt(x, z)) : 0));
  const snap = (p: Vec2): Vec2 => {
    const h = cell * 0.5;
    // ⚠️⚠️ Every step is CLAMPED, and a vertex that has not converged is left
    // where it was. A Newton step on a scalar field is `error * grad/|grad|²`,
    // which is unbounded as the gradient vanishes — and it does vanish, at the
    // ends of the curve and wherever the plan trace doubles back on itself. One
    // vertex then gets thrown across the field while its neighbours stay put, and
    // the quad between them spans the whole sheet.
    const limit = cell;
    const start: Vec2 = [p[0], p[1]];
    for (let step = 0; step < 4; step++) {
      const error = targetAt(p[0], p[1]) - sample(p[0], p[1]);
      if (Math.abs(error) < 1e-3) break;
      const gx = (sample(p[0] + h, p[1]) - sample(p[0] - h, p[1])) / (2 * h);
      const gz = (sample(p[0], p[1] + h) - sample(p[0], p[1] - h)) / (2 * h);
      const g2 = gx * gx + gz * gz;
      if (g2 < 1e-6) break;
      let dx = (gx * error) / g2;
      let dz = (gz * error) / g2;
      const len = Math.hypot(dx, dz);
      if (len > limit) {
        dx = (dx / len) * limit;
        dz = (dz / len) * limit;
      }
      p = [p[0] + dx, p[1] + dz];
    }
    // Total travel is bounded too: the snap is a correction of a fraction of a
    // cell, so anything larger means it was chasing a gradient it should not have.
    return Math.hypot(p[0] - start[0], p[1] - start[1]) > limit ? start : p;
  };

  // ⭐ At zero width the contour IS the curve, in the order the curve already
  // has. Going through the raster would be strictly worse: it quantises the path,
  // and — since every vertex is then projected back onto the curve — any vertex
  // the marching picked up that is NOT on the fence would land at an arbitrary
  // point on it and fold the ribbon back on itself.
  // ⚠️ A taper makes the width non-zero over part of the curve, so the shortcut is
  // only available when there is no taper either.
  if (width === 0 && !tapered)
    return [removeChainLoops(resampleChain(positions, resolution).map(snap))];

  // ⚠️ Padded with a value far on one side, because `marchingSquares` closes its
  // rings and a fence necessarily runs off the edge of the grid. The padding is
  // stripped again below, leaving the open chain the fence actually is.
  const pw = nx + 2;
  const ph = ny + 2;
  const padded = new Float32Array(pw * ph);
  const far = Math.max(Math.abs(field.min), Math.abs(field.max)) * 4 + 1;
  padded.fill(far);
  for (let r = 0; r < ny; r++) {
    if (tapered) {
      // ⭐ The taper is folded into a DERIVED raster rather than into the field
      // itself. The field has to stay a plain signed distance: the shader reads
      // it with `side` as a live uniform, so a side-dependent bake would freeze
      // which half goes, and every vertex below is placed analytically from a
      // distance the field would no longer hold.
      for (let c = 0; c < nx; c++) {
        const at = r * nx + c;
        padded[(r + 1) * pw + 1 + c] =
          values[at] - side * fenceWidthAt(taper, field.along[at]);
      }
    } else {
      padded.set(values.subarray(r * nx, r * nx + nx), (r + 1) * pw + 1);
    }
  }

  const rings = marchingSquares(padded, pw, ph, side * width);
  const hit: PolylineHit = { point: [0, 0], distance: 0, along: 0 };
  const tolerance = cell * 1.5;
  const chains: Vec2[][] = [];

  for (const ring of rings) {
    // A vertex in the padding, or one the raster placed nowhere near the wanted
    // distance, closes the ring rather than tracing the fence. Both must go
    // BEFORE the projection below, or they land at an arbitrary point on the
    // curve and scramble the order.
    const world: (Vec2 | null)[] = ring.map(p => {
      const c = p[0] - 1;
      const r = p[1] - 1;
      if (c < 0 || r < 0 || c > nx - 1 || r > ny - 1) return null;
      const x = origin[0] + c * cell;
      const z = origin[1] + r * cell;
      const near = nearestOnPolyline(positions, x, z, hit);
      if (
        near === null ||
        Math.abs(near.distance - (width + fenceWidthAt(taper, near.along))) >
          tolerance
      )
        return null;
      return [x, z] as Vec2;
    });
    const n = world.length;
    let start = world.findIndex(p => p === null);
    if (start < 0) start = 0;
    let run: Vec2[] = [];
    for (let k = 0; k <= n; k++) {
      const p = world[(start + k) % n];
      if (p) run.push(p);
      else {
        if (run.length > 1) chains.push(run);
        run = [];
      }
    }
    if (run.length > 1) chains.push(run);
  }

  return chains
    .map(chain => {
      const exact: Vec2[] = [];
      for (const p of resampleChain(chain, resolution)) {
        const near = nearestOnPolyline(positions, p[0], p[1], hit);
        if (near === null) continue;
        const dx = p[0] - near.point[0];
        const dz = p[1] - near.point[1];
        const len = Math.hypot(dx, dz);
        if (len < 1e-9) continue;
        const at = width + fenceWidthAt(taper, near.along);
        exact.push(
          snap([
            near.point[0] + (dx / len) * at,
            near.point[1] + (dz / len) * at,
          ]),
        );
      }
      return exact;
    })
    .map(removeChainLoops)
    .filter(chain => chain.length > 1);
}
