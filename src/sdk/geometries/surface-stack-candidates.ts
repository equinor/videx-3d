import { Delatin } from './delatin';

/**
 * Sentinel for a stack node with no data — outside the range of any real depth,
 * so it can never collide with a sample.
 *
 * @group Geometries
 */
export const STACK_NO_DATA = -1e30;

/**
 * Refine one layer of a stack's common grid on its own and return the grid nodes
 * its TIN would use, as node indices (`row * nx + col`).
 *
 * Split out of `tessellateStack` (and kept free of any three.js import, so it can
 * run in an inlined worker) because the per-layer refinement is the expensive part
 * of the shared tessellation and is fully independent between layers.
 *
 * @param channel the layer's heights over the common grid
 * @param nx the common grid's column count
 * @param maxError greedy simplification error, in world units of height
 *
 * @group Geometries
 */
export function collectStackCandidates(
  channel: Float32Array,
  nx: number,
  maxError: number,
): Uint32Array {
  const delatin = new Delatin(channel, nx, STACK_NO_DATA);
  delatin.run(maxError);
  const out = new Uint32Array(delatin.coords.length >> 1);
  for (let i = 0, j = 0; i < delatin.coords.length; i += 2, j++) {
    out[j] = delatin.coords[i + 1] * nx + delatin.coords[i];
  }
  return out;
}

/**
 * Find the grid nodes where a pair's thickness crosses `threshold` — the line a
 * unit wedges out along.
 *
 * A unit's triangles are dropped where it is thinner than the collapse threshold
 * at all three corners, so without these nodes the pinch-out can only terminate on
 * edges the *height* refinement happened to put there. In the flat parts of a
 * surface those triangles are hundreds of metres wide, and the termination comes
 * out as a coarse sawtooth. Feeding the crossing nodes back in as refinement
 * candidates makes the mesh fine exactly along the line where it matters, and
 * nowhere else.
 *
 * Both nodes of a crossing edge are returned, so the contour ends up bracketed by
 * vertices on either side of it.
 *
 * @param above the shallower layer's heights over the common grid
 * @param below the deeper layer's heights over the same grid
 * @param nx the common grid's column count
 * @param threshold thickness below which the unit counts as absent, in world units
 * @returns node indices (`row * nx + col`), ascending
 *
 * @group Geometries
 */
export function collectThicknessCrossings(
  above: Float32Array,
  below: Float32Array,
  nx: number,
  threshold: number,
): Uint32Array {
  const count = above.length;
  const ny = count / nx;

  // -1 = no data, 0 = thick, 1 = thin
  const state = new Int8Array(count);
  for (let n = 0; n < count; n++) {
    state[n] =
      above[n] === STACK_NO_DATA || below[n] === STACK_NO_DATA
        ? -1
        : above[n] - below[n] <= threshold
          ? 1
          : 0;
  }

  // Wherever the two surfaces run nearly parallel a hair apart, the raw test
  // speckles: single nodes flipping across the threshold, each one a boundary the
  // triangulation would then have to resolve. A patch a node or two across cannot
  // control a triangle anyway, so vote it away first — this is the difference
  // between refining the terminations and refining the noise.
  const smooth = new Int8Array(count);
  for (let row = 0; row < ny; row++) {
    for (let col = 0; col < nx; col++) {
      const n = row * nx + col;
      if (state[n] < 0) {
        smooth[n] = -1;
        continue;
      }
      let valid = 1;
      let thin: number = state[n];
      if (col > 0 && state[n - 1] >= 0) {
        valid++;
        thin += state[n - 1];
      }
      if (col + 1 < nx && state[n + 1] >= 0) {
        valid++;
        thin += state[n + 1];
      }
      if (row > 0 && state[n - nx] >= 0) {
        valid++;
        thin += state[n - nx];
      }
      if (row + 1 < ny && state[n + nx] >= 0) {
        valid++;
        thin += state[n + nx];
      }
      smooth[n] = 2 * thin > valid ? 1 : 0;
    }
  }

  const hit = new Uint8Array(count);
  let total = 0;
  const mark = (a: number, b: number) => {
    if (smooth[a] < 0 || smooth[b] < 0 || smooth[a] === smooth[b]) return;
    if (!hit[a]) {
      hit[a] = 1;
      total++;
    }
    if (!hit[b]) {
      hit[b] = 1;
      total++;
    }
  };
  for (let row = 0; row < ny; row++) {
    const base = row * nx;
    for (let col = 0; col < nx; col++) {
      const n = base + col;
      if (col + 1 < nx) mark(n, n + 1);
      if (row + 1 < ny) mark(n, n + nx);
    }
  }

  const out = new Uint32Array(total);
  for (let n = 0, j = 0; n < count; n++) if (hit[n]) out[j++] = n;
  return out;
}

/**
 * Find the grid nodes bracketing the edge of a layer's DATA — the line its
 * coverage mask flips along.
 *
 * ⭐ Needed for the same reason as {@link collectThicknessCrossings} and for a
 * different line. Where a stack is sealed, a surface keeps full thickness on both
 * sides of the edge of its data, so the taper's start is not a thickness crossing
 * and nothing else refines it: the descent then begins at whatever vertex the
 * height refinement happened to leave nearby, which in a flat area is hundreds of
 * metres inside the data. Pinning vertices to the mask boundary puts the taper's
 * onset where the knowledge actually ends.
 *
 * ⚠️ Deliberately WITHOUT the small-patch vote the thickness pass uses. A node or
 * two flipping across a thickness threshold is noise; a node or two of missing
 * coverage is data, and smoothing it away would move the very edge this is for.
 *
 * @param mask the layer's coverage over the common grid; 0 = no data (any
 *   non-zero counts as covered, so bounded fill counts as data)
 * @param nx the common grid's column count
 * @returns node indices (`row * nx + col`), ascending
 *
 * @group Geometries
 */
export function collectCoverageCrossings(
  mask: Uint8Array,
  nx: number,
): Uint32Array {
  const count = mask.length;
  const ny = count / nx;
  const hit = new Uint8Array(count);
  let total = 0;

  const mark = (a: number, b: number) => {
    if (!mask[a] === !mask[b]) return;
    if (!hit[a]) {
      hit[a] = 1;
      total++;
    }
    if (!hit[b]) {
      hit[b] = 1;
      total++;
    }
  };
  for (let row = 0; row < ny; row++) {
    const base = row * nx;
    for (let col = 0; col < nx; col++) {
      const n = base + col;
      if (col + 1 < nx) mark(n, n + 1);
      if (row + 1 < ny) mark(n, n + nx);
    }
  }

  const out = new Uint32Array(total);
  for (let n = 0, j = 0; n < count; n++) if (hit[n]) out[j++] = n;
  return out;
}
