/**
 * Sealing a stack where its surfaces are not mapped.
 *
 * A surface's grid stops where the survey stopped, not where the geology did. Left
 * alone, every interval bounded by that surface disappears there while the surfaces
 * above and below it — which may be mapped — are still drawn, so a chunk ends up as
 * a cap floating over a floor with open space between them.
 *
 * ⭐ Sealing that space is an ASSERTION, and there is no neutral one: we know the
 * room between the neighbours, we just do not know how it is divided. Two rules are
 * offered, and they differ in the KIND of claim they make rather than its size —
 * see {@link SealMode}. The default keeps the surface at the relative depth it
 * had where it was last mapped, which says "this horizon is here somewhere" rather
 * than "this unit does not exist".
 *
 * How far a taper reaches is DERIVED, not configured: it is drawn out over the
 * unmapped region's own inward extent, so every flank closing one gap lands at its
 * far side and they differ only in gradient. That same extent also bounds how far
 * it TRAVELS ({@link TAPER_MAX_SLOPE}), so a gap that is small relative to the
 * separation of its neighbours dimples rather than diving the whole way. The
 * single setting is {@link StackSealOptions.minThickness} — how much of each
 * neighbouring unit the taper must leave standing, so nothing is ever closed to
 * nothing and the collapse cannot drop a unit and re-open the hole.
 *
 * ⚠️ This invents geometry. Every node it touches is reported in
 * {@link StackSealResult.inferred} so it can be drawn as the inference it is.
 */

import { chamferDistance, chamferFill } from './chamfer';

/**
 * How the space a surface cannot account for is closed.
 *
 * - `proportional` (default) keeps the surface at the RELATIVE depth between its
 *   two neighbours that it had where it was last mapped, so both units continue at
 *   scaled thickness and the surface follows the shape of the pair. It says "this
 *   horizon exists here, we are unsure exactly where".
 * - `void` splits it in two — one copy closing the interval above, one the interval
 *   below — and draws nothing in between. It says "the units are not defined here",
 *   and is the only one that cannot be mistaken for data
 *   ({@link splitVoidChannels}).
 *
 * ⚠️ They differ in what KIND of claim they make, not how large it is: one guesses
 * a boundary, the other declines to and shows the hole in our knowledge instead.
 *
 * A layer at the TOP or BOTTOM of a stack has only one neighbour, so there is no
 * ratio to preserve and only one interval to close; both modes then simply taper it
 * onto that neighbour.
 */
export type SealMode = 'proportional' | 'void';

/**
 * How much of a neighbouring unit a taper must leave standing, in METRES.
 *
 * A unit the seal cannot account for is thinned, never removed, so the thickness
 * collapse cannot drop it and re-open the hole the seal just closed.
 *
 * ⭐ Absolute rather than a share of the room available, so it means the same thing
 * in a 20 m interval and in an 800 m one.
 *
 * ⚠️ Keep it ABOVE the collapse threshold, or the sliver it leaves is dropped and
 * the hole comes back.
 */
export const TAPER_MIN_THICKNESS = 1;

/**
 * The steepest an invented surface is allowed to descend, as a gradient (metres
 * of travel per metre of reach).
 *
 * Without it a gap travels the whole distance to its neighbour however narrow it
 * is, so a 200 m ditch between surfaces 800 m apart dives the full 800 m and back
 * — 8:1, which no horizon does. Bounding the GRADIENT rather than testing the
 * size makes a wide gap unaffected (there the room runs out first) and lets the
 * behaviour degrade continuously instead of switching at a threshold.
 *
 * ⭐ The gap's own INWARD reach is what it is measured against, not its area: a
 * long narrow ditch is shallow in reach however much ground it covers, and that
 * is exactly the case that should not be driven hard.
 */
export const TAPER_MAX_SLOPE = 0.5;

/** The expansion {@link splitVoidChannels} produces. */
export type StackVoidResult = {
  /** channels for the EXPANDED layer list */
  channels: Float32Array[];
  /** masks, aligned with `channels` */
  masks: Uint8Array[];
  /** for each expanded layer, its index in the CALLER's list */
  source: number[];
  /** for each expanded layer, whether the interval BELOW it holds a volume */
  fill: boolean[];
  /**
   * For each expanded layer, whether it is the UPPER copy of a split — the
   * ceiling of a void, seen from below. It is the base of the interval above it
   * rather than the cap of its own layer, which is what it should be coloured as.
   */
  ceiling: boolean[];
  /** per expanded layer, per node: how far the height is inferred (see {@link taperWeights}) */
  inferred: Float32Array[];
  /** per SOURCE layer: nodes the split moved */
  moved: number[];
};

/**
 * Seal by REMOVING the space nobody can account for, rather than by giving it to
 * one unit or splitting it between them.
 *
 * Where a surface is unmapped it is split in two: one copy rises to meet the layer
 * above, closing the interval above it from below; the other sinks to meet the
 * layer below, closing the interval beneath it from above. Between the two copies
 * nothing is drawn — a void that is zero at the edge of the surface's data and
 * opens to the full separation of its neighbours once each copy has had the run it
 * needs to get there.
 *
 * ⭐ The result is SELF-DOCUMENTING: the gap in the block is the statement "the
 * units are not defined here", so it needs no legend and cannot be mistaken for
 * geology. The trade is that it removes material we know exists — the neighbours
 * bound it — asserting only that we cannot say which unit it belongs to.
 *
 * Implemented as two ordinary layers with an unfilled interval between them, which
 * is the "gap between zones" the stack already supports, so nothing downstream
 * needs to know a split happened. Where the surface HAS data the two copies are
 * identical, so the thickness collapse drops both the void and the duplicate cap.
 *
 * @param channels per-layer heights over the common grid (shallowest first)
 * @param masks per-layer coverage, 0 where the layer has no extent
 * @param nx the grid's row length
 * @param fills per layer: whether the interval below it holds a volume
 * @param options see {@link StackSealOptions}; `target` is ignored
 *
 * @group Geometries
 */
export function splitVoidChannels(
  channels: Float32Array[],
  masks: Uint8Array[],
  nx: number,
  fills: boolean[],
  options: StackSealOptions,
): StackVoidResult {
  const minThickness = options.minThickness ?? TAPER_MIN_THICKNESS;
  const slope = travelPerCell(options);
  const count = channels[0]?.length ?? 0;
  const ny = nx > 0 ? Math.floor(count / nx) : 0;

  const out: StackVoidResult = {
    channels: [],
    masks: [],
    source: [],
    fill: [],
    ceiling: [],
    inferred: [],
    moved: [],
  };

  for (let i = 0; i < channels.length; i++) {
    const mask = masks[i];
    const above = i > 0 ? channels[i - 1] : null;
    const below = i + 1 < channels.length ? channels[i + 1] : null;

    let missing = false;
    let anchored = false;
    for (let n = 0; n < count; n++) {
      if (mask[n]) anchored = true;
      else missing = true;
      if (missing && anchored) break;
    }
    // Fully mapped, nowhere to lean from, or nothing to close against: one layer,
    // untouched and shared.
    if (!missing || !anchored || (!above && !below)) {
      out.channels.push(channels[i]);
      out.masks.push(mask);
      out.source.push(i);
      out.fill.push(fills[i] ?? false);
      out.ceiling.push(false);
      out.inferred.push(new Float32Array(count));
      out.moved.push(0);
      continue;
    }

    const dist = chamferDistance(mask, nx, ny);
    const reach = regionReach(mask, dist, nx, ny, options.inside);
    const source = channels[i];
    const flags = taperWeights(mask, dist, reach);
    let moved = 0;
    for (let n = 0; n < count; n++) if (!mask[n]) moved++;

    const toward = (neighbour: Float32Array) =>
      taperToward(source, neighbour, mask, dist, reach, minThickness, slope);

    // Only one neighbour: there is one interval to close, so no void to open.
    if (!above || !below) {
      out.channels.push(toward(above ?? below!));
      out.masks.push(mask);
      out.source.push(i);
      out.fill.push(fills[i] ?? false);
      out.ceiling.push(false);
      out.inferred.push(flags);
      out.moved.push(moved);
      continue;
    }

    // The upper copy closes the interval ABOVE it, and keeps that interval's fill
    // state; the void below it is explicitly EMPTY; the lower copy carries the
    // interval this layer originally filled.
    out.channels.push(toward(above));
    out.masks.push(mask);
    out.source.push(i);
    out.fill.push(false);
    out.ceiling.push(true);
    out.inferred.push(flags);
    out.moved.push(moved);

    out.channels.push(toward(below));
    out.masks.push(mask);
    out.source.push(i);
    out.fill.push(fills[i] ?? false);
    out.ceiling.push(false);
    out.inferred.push(Float32Array.from(flags));
    out.moved.push(0);
  }

  return out;
}

/**
 * Move a surface toward a neighbour across its unmapped region.
 *
 * ⭐ A taper is drawn out over the GAP it is closing, not over the distance it has
 * to fall:
 *
 * ```
 * run  = reach          // the region's own inward extent, inside the footprint
 * w(d) = shape(d / run)
 * ```
 *
 * ⭐⭐ That the run is the gap is the whole point. Making it proportional to
 * `travel` instead cancels the travel out of the mean gradient — every taper then
 * descends identically however far it has to go, so a thin unit and a thick one
 * leave their shared edge in parallel, which is not what either of them does. With
 * a shared reach the gradient is `travel / run`, so the copy with further to fall
 * is steeper and the one with less to cover arcs more gently, and both land at the
 * same distance from the edge.
 *
 * ⭐ How far it travels is bounded by that same reach ({@link TAPER_MAX_SLOPE}), so
 * a gap that is small RELATIVE to the separation of its neighbours dimples rather
 * than diving the whole way. A gap wide enough to earn the full travel is
 * unaffected. ⚠️ Capping only ever moves a surface LESS, so it cannot open a hole
 * — it leaves the units on either side thicker than they would otherwise be.
 *
 * The taper stops `minThickness` short of the neighbour, and does not move at all
 * where there is less room than that.
 */
function taperToward(
  source: Float32Array,
  neighbour: Float32Array,
  mask: Uint8Array,
  dist: Float32Array,
  reach: Float32Array,
  minThickness: number,
  slope: number,
): Float32Array {
  const copy = Float32Array.from(source);
  for (let n = 0; n < source.length; n++) {
    if (mask[n]) continue;
    const run = reach[n];
    const usable = run > 0 && Number.isFinite(run) ? run : 0;
    const t = usable > 0 ? dist[n] / usable : 1;
    const room = neighbour[n] - source[n];
    const travel =
      Math.sign(room) *
      Math.min(
        Math.max(0, Math.abs(room) - minThickness),
        usable > 0 ? slope * usable : Infinity,
      );
    copy[n] = source[n] + travel * shape(t);
  }
  return copy;
}

// The slope bound in metres of travel per CELL of reach, which is what the chamfer
// distance counts in. Without a cell size there is no way to compare the two, so
// the bound is simply not applied.
function travelPerCell(options: StackSealOptions): number {
  return options.cellSize !== undefined && options.cellSize > 0
    ? TAPER_MAX_SLOPE * options.cellSize
    : Infinity;
}

/** Options for {@link sealStackChannels}. */
export type StackSealOptions = {
  /** default `'proportional'` */
  mode?: SealMode;
  /**
   * How much of a neighbouring unit the taper must leave standing, in metres.
   * Default {@link TAPER_MIN_THICKNESS}. The only setting the shape of a seal has.
   */
  minThickness?: number;
  /**
   * The chunk's footprint rasterised on the reference grid, 1 where a node is
   * drawn ({@link rasterizeStackOutline}).
   *
   * ⭐ A taper is measured over the gap you can SEE. The reference grid is the
   * grid-space bounding box of a rotated outline, and everything beyond a survey
   * edge is one region running to that box, so without this the run is set by
   * corners the chunk never draws — and resizing the outline silently changes the
   * shape of every seal in it.
   */
  inside?: Uint8Array | null;
  /**
   * Size of one grid cell, in metres. Only used to bound how far a taper travels
   * ({@link TAPER_MAX_SLOPE}) — the reach it is compared against is counted in
   * cells. Omit it and the travel is unbounded.
   */
  cellSize?: number;
};

/** The result of {@link sealStackChannels}. */
export type StackSealResult = {
  /**
   * The channels, with unmapped regions tapered. Layers that needed nothing are
   * shared BY REFERENCE — on a shared column they belong to every chunk cut from
   * it, so they must not be mutated.
   */
  channels: Float32Array[];
  /**
   * Per layer, per node: how far the height is inferred rather than measured —
   * 0 where the data stops, rising to 1 at the far side of the gap. See
   * {@link taperWeights}.
   */
  inferred: Float32Array[];
  /** per layer: nodes the taper moved */
  tapered: number[];
};

/**
 * Blend weight at `t`, the share of the gap's own reach already travelled.
 *
 * A quarter arc: it leaves the data edge along a VERTICAL tangent and lands on the
 * neighbour along a HORIZONTAL one. The seal opens at once where knowledge stops,
 * then flattens into what it closes against — which is what a gap in knowledge
 * looks like, as opposed to a geological wedge.
 */
function shape(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const u = 1 - t;
  return Math.sqrt(1 - u * u);
}

/**
 * Per node, how deep into an unmapped region it lies, as the taper's own blend
 * weight: 0 where the data stops, 1 at the far side of the gap.
 *
 * ⭐ It doubles as a CONFIDENCE, which is why the proportional rule reports it too
 * even though it does not blend with it: every rule here leans on the nearest real
 * data, so all of them are least trustworthy furthest from it. That is what makes
 * this the right thing to shade an inferred region by.
 */
function taperWeights(
  mask: Uint8Array,
  dist: Float32Array,
  reach: Float32Array,
): Float32Array {
  const out = new Float32Array(mask.length);
  for (let n = 0; n < mask.length; n++) {
    if (mask[n]) continue;
    const run = reach[n];
    out[n] = shape(run > 0 && Number.isFinite(run) ? dist[n] / run : 1);
  }
  return out;
}

/** Below this the two neighbours are effectively coincident and a ratio is meaningless. */
const MIN_ROOM = 1e-3;

/**
 * Per unmapped node, how deep its own region goes — the greatest distance to real
 * data anywhere in the connected gap it belongs to.
 *
 * ⭐ This is what gives a taper a length of its own rather than one borrowed from
 * how far it happens to fall. Every copy closing the same gap then shares a run,
 * so they land together at its far side and differ only in gradient — which is
 * the difference between two units of different thickness meeting one edge, and
 * two parallel ramps.
 *
 * ⭐⭐ Measured over the nodes the chunk actually DRAWS when a footprint is given.
 * A region reaching outside the outline is deeper than anything visible, and its
 * depth would then be set by geometry nobody sees.
 *
 * @param inside 1 where a node is inside the chunk's footprint; a region with no
 *   node inside falls back to its own extent, having nothing visible to measure
 */
function regionReach(
  mask: Uint8Array,
  dist: Float32Array,
  w: number,
  h: number,
  inside?: Uint8Array | null,
): Float32Array {
  const count = w * h;
  const reach = new Float32Array(count);
  const label = new Int32Array(count).fill(-1);
  const stack: number[] = [];

  for (let seed = 0; seed < count; seed++) {
    if (mask[seed] || label[seed] >= 0) continue;
    // flood the component, then write its depth back over every node in it
    const members: number[] = [];
    let deepest = 0;
    let deepestAny = 0;
    label[seed] = seed;
    stack.push(seed);
    while (stack.length > 0) {
      const n = stack.pop()!;
      members.push(n);
      if (dist[n] > deepestAny) deepestAny = dist[n];
      if ((!inside || inside[n]) && dist[n] > deepest) deepest = dist[n];
      const x = n % w;
      const y = (n / w) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx2 = x + dx;
          const ny2 = y + dy;
          if (nx2 < 0 || ny2 < 0 || nx2 >= w || ny2 >= h) continue;
          const m = ny2 * w + nx2;
          if (mask[m] || label[m] >= 0) continue;
          label[m] = seed;
          stack.push(m);
        }
      }
    }
    const value = deepest > 0 ? deepest : deepestAny;
    for (const n of members) reach[n] = value;
  }
  return reach;
}

/**
 * Taper every layer's unmapped region onto its nearest mapped neighbour, so the
 * stack encloses a solid volume everywhere inside the chunk.
 *
 * ⭐ All layers are evaluated against the ORIGINAL channels, so the result does not
 * depend on the order they are processed in.
 *
 * ⚠️ Two adjacent layers tapering toward each other can, at full weight, pass each
 * other. This does not need handling HERE — the caller runs the stack's monotone
 * resolve afterwards, which clamps any residual inversion. The ordering (seal, then
 * resolve) is what makes that safe.
 *
 * @param channels per-layer heights over the common grid (shallowest first)
 * @param masks per-layer coverage, 0 where the layer has no extent
 * @param nx the grid's row length
 * @param options see {@link StackSealOptions}
 *
 * @group Geometries
 */
export function sealStackChannels(
  channels: Float32Array[],
  masks: Uint8Array[],
  nx: number,
  options: StackSealOptions,
): StackSealResult {
  const mode = options.mode ?? 'proportional';
  const minThickness = options.minThickness ?? TAPER_MIN_THICKNESS;
  const slope = travelPerCell(options);
  const count = channels[0]?.length ?? 0;
  const ny = nx > 0 ? Math.floor(count / nx) : 0;
  void mode;

  const out = channels.slice();
  const inferred: Float32Array[] = [];
  const tapered: number[] = [];

  for (let i = 0; i < channels.length; i++) {
    const mask = masks[i];
    let taperedCount = 0;

    // Nothing unmapped, no data to lean from, or nothing to lean on: leave the
    // channel alone (and shared).
    let missing = false;
    let anchored = false;
    for (let n = 0; n < count; n++) {
      if (mask[n]) anchored = true;
      else missing = true;
      if (missing && anchored) break;
    }
    const above = i > 0 ? channels[i - 1] : null;
    const below = i + 1 < channels.length ? channels[i + 1] : null;
    if (!missing || !anchored || (!above && !below)) {
      inferred.push(new Float32Array(count));
      tapered.push(0);
      continue;
    }

    const source = channels[i];
    const dist = chamferDistance(mask, nx, ny);
    const reach = regionReach(mask, dist, nx, ny, options.inside);
    const flags = taperWeights(mask, dist, reach);
    for (let n = 0; n < count; n++) if (!mask[n]) taperedCount++;

    // ⭐ The ratio needs a neighbour on BOTH sides. At the top or bottom of a
    // stack there is only one, so the layer is simply tapered onto it.
    if (above && below) {
      // Where the layer IS mapped, how far down it sits between its neighbours.
      // Extending that ratio (rather than the depth) is what makes the result
      // follow the SHAPE of the pair instead of flattening onto one of them.
      const copy = Float32Array.from(source);
      const ratio = new Float32Array(count);
      for (let n = 0; n < count; n++) {
        if (!mask[n]) continue;
        const room = above[n] - below[n];
        ratio[n] =
          room > MIN_ROOM
            ? Math.min(1, Math.max(0, (above[n] - source[n]) / room))
            : 0.5;
      }
      chamferFill(ratio, mask, nx, ny);
      for (let n = 0; n < count; n++) {
        if (mask[n]) continue;
        const room = above[n] - below[n];
        // Reconstructed strictly between the neighbours, so the stack cannot be
        // made non-monotone by this pass — and no closer to either of them than
        // the carried ratio is allowed to put it.
        const hi = above[n] - minThickness;
        const lo = below[n] + minThickness;
        copy[n] =
          hi >= lo
            ? Math.min(hi, Math.max(lo, above[n] - ratio[n] * room))
            : (above[n] + below[n]) / 2;
      }
      out[i] = copy;
      inferred.push(flags);
      tapered.push(taperedCount);
      continue;
    }

    out[i] = taperToward(
      source,
      (above ?? below)!,
      mask,
      dist,
      reach,
      minThickness,
      slope,
    );
    inferred.push(flags);
    tapered.push(taperedCount);
  }

  return { channels: out, inferred, tapered };
}
