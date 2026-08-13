import { Vec3 } from '../types/common';

/**
 * Everything a section needs from a built stack, kept as flat typed arrays so it
 * can cross a worker boundary by transfer and be cut on the main thread every
 * frame (see {@link sectionStackInterval}).
 *
 * ⭐ It carries the CHANNELS rather than the drawn meshes. An interval's bounding
 * heights exist for every layer over the whole footprint regardless of who draws
 * the cap, so seam ownership, a void's split copies and a cap dropped by the
 * collapse are all irrelevant here — which they would not be if the section were
 * derived from the emitted geometry.
 *
 * @group Geometries
 */
export type StackSectionSource = {
  /** scene XZ of every shared vertex, xz interleaved */
  positionsXZ: Float32Array;
  /** the shared triangle indices */
  indices: Uint32Array;
  /** per layer, vertex heights in scene Y (after the resolve) */
  heights: Float32Array[];
  /**
   * Per INTERVAL (`heights.length - 1` entries), one flag per triangle: 1 where
   * that interval holds a volume. `null` where the interval is unfilled — there is
   * no material to show, so the cut face has nothing to draw there.
   */
  intervals: (Uint8Array | null)[];
  /**
   * Per layer, the invention weight at each vertex (see `sampleStackWeights`).
   * A cut vertex takes the LARGER of its two bounding layers', as a wall does.
   */
  inferred?: Float32Array[];
  /**
   * Per layer, the index of the CALLER's layer it came from, when the build
   * expanded the list (a surface split around a void becomes two layers, and a
   * column's floor is appended past the caller's last one).
   *
   * ⚠️ Without it a cut face cannot find its own material: the intervals here are
   * numbered in BUILD indices, and everything the caller declared — colour,
   * opacity, detail — is numbered in theirs. Filled in by `assembleChunk`, which
   * is where the two index spaces meet.
   */
  layers?: number[];
};

/**
 * The cutting plane, in the same OBJECT space as the stack's geometry.
 *
 * ⚠️ Object space, not world: the stack may carry a vertical exaggeration, and a
 * world-space plane would then disagree with the shader's own test (which reads
 * the raw `position` attribute for exactly this reason).
 *
 * Points where `dot(normal, p) + constant > 0` are REMOVED, so `normal` points out
 * of the solid that is kept — which is also the cut face's outward normal.
 *
 * @group Geometries
 */
export type StackSectionPlane = {
  /** unit normal, pointing at the half-space that is cut away */
  normal: Vec3;
  constant: number;
};

/**
 * Preallocated output buffers for {@link sectionStackInterval}. A section is
 * rebuilt every frame, so allocating a `BufferGeometry` per frame would make a
 * moving plane a garbage generator; the buffers are reused and only the draw range
 * moves.
 *
 * @group Geometries
 */
export type StackSectionTarget = {
  /** 3 per vertex */
  positions: Float32Array;
  /** 3 per vertex */
  normals: Float32Array;
  /** 2 per vertex — metres in the plane's own basis */
  uvs: Float32Array;
  /** 1 per vertex — 0 at the interval's base, 1 at its top (see `buildRingWalls`) */
  wallV: Float32Array;
  /** 1 per vertex, or `null` when the source carries no weights */
  inferred: Float32Array | null;
  /** vertices written by the last call, or 0 when it did not fit */
  count: number;
  /** vertices the buffers can hold */
  capacity: number;
};

/** Options for {@link sectionStackInterval}. */
export type StackSectionOptions = {
  /**
   * Metres to move the cut face toward the KEPT side, along `-normal`. The face
   * lies exactly IN the plane, so without it the same test that cuts the block is
   * one rounding step away from cutting the face closing it. Default 0.05 — at
   * field scale, and with the logarithmic depth buffer, far below anything
   * visible.
   */
  offset?: number;
};

/**
 * Allocate section buffers for `capacity` vertices.
 *
 * @group Geometries
 */
export function createStackSectionTarget(
  capacity: number,
  inferred: boolean,
): StackSectionTarget {
  return {
    positions: new Float32Array(capacity * 3),
    normals: new Float32Array(capacity * 3),
    uvs: new Float32Array(capacity * 2),
    wallV: new Float32Array(capacity),
    inferred: inferred ? new Float32Array(capacity) : null,
    count: 0,
    capacity,
  };
}

/**
 * Grow a target to at least `capacity` vertices, in place. Contents are discarded
 * — the caller re-runs the cut rather than copying buffers it is about to
 * overwrite.
 *
 * @group Geometries
 */
export function growStackSectionTarget(
  target: StackSectionTarget,
  capacity: number,
) {
  const next = Math.max(capacity, target.capacity * 2);
  target.positions = new Float32Array(next * 3);
  target.normals = new Float32Array(next * 3);
  target.uvs = new Float32Array(next * 2);
  target.wallV = new Float32Array(next);
  if (target.inferred) target.inferred = new Float32Array(next);
  target.capacity = next;
  target.count = 0;
}

/** the six cell corners: 0-2 the top triangle, 3-5 the bottom one */
const EDGES: [number, number][] = [
  [0, 1],
  [1, 2],
  [0, 2],
  [3, 4],
  [4, 5],
  [3, 5],
  [0, 3],
  [1, 4],
  [2, 5],
];

// A plane cuts a triangular prism (five faces) in at most a pentagon.
const MAX_POLY = 6;

const px = new Float64Array(6);
const py = new Float64Array(6);
const pz = new Float64Array(6);
const pd = new Float64Array(6);
const pw = new Float64Array(6);
const pm = new Float64Array(6);
const pv = new Int32Array(6);
const cutX = new Float64Array(MAX_POLY);
const cutY = new Float64Array(MAX_POLY);
const cutZ = new Float64Array(MAX_POLY);
const cutV = new Float64Array(MAX_POLY);
const cutM = new Float64Array(MAX_POLY);
const cutA = new Float64Array(MAX_POLY);
const order = new Int32Array(MAX_POLY);

/**
 * Cut one filled interval of a stack with a plane, writing the resulting face into
 * preallocated buffers.
 *
 * ⭐ The unit of work is a CELL — one interval over one triangle of the shared
 * tessellation — and a cell is CONVEX: its top and bottom are planar triangles
 * (each layer is linear over the triangle) and each of its three sides lies in the
 * vertical plane through an XZ edge. So it is the intersection of five half-spaces,
 * a plane cuts it in a convex polygon of at most five vertices, and the face falls
 * out of intersecting the plane with the cell's nine edges. No ring chaining, no
 * polygon boolean, and therefore no robustness cliff: an interval that is open
 * contributes the cells it has and nothing more.
 *
 * ⭐⭐ It is watertight by CONSTRUCTION, not by tolerance — but only because every
 * edge is evaluated in a canonical direction (deeper layer last, lower vertex index
 * first). Two cells sharing a face take that face's crossing from the same two
 * endpoints in the same order, so the interpolation is bit-identical; evaluate one
 * of them the other way round and the two faces part by an ulp. The same holds
 * between intervals, whose shared boundary is one layer's heights read twice.
 *
 * @param source the stack's channels ({@link StackSectionSource})
 * @param interval which interval to cut (0 = between layers 0 and 1)
 * @param plane the cutting plane, in object space
 * @param target preallocated output ({@link createStackSectionTarget})
 * @param options see {@link StackSectionOptions}
 * @returns the number of vertices the face NEEDS. When that exceeds the target's
 *   capacity nothing usable was written (`target.count` is 0): grow the target
 *   ({@link growStackSectionTarget}) and call again.
 *
 * @group Geometries
 */
export function sectionStackInterval(
  source: StackSectionSource,
  interval: number,
  plane: StackSectionPlane,
  target: StackSectionTarget,
  options: StackSectionOptions = {},
): number {
  target.count = 0;
  const members = source.intervals[interval];
  const top = source.heights[interval];
  const bottom = source.heights[interval + 1];
  if (!members || !top || !bottom) return 0;

  const { positionsXZ, indices } = source;
  const [nx, ny, nz] = plane.normal;
  const constant = plane.constant;
  const offset = options.offset ?? 0.05;
  const ox = -nx * offset;
  const oy = -ny * offset;
  const oz = -nz * offset;

  // A right-handed basis on the plane, so a polygon wound CCW in (u, v) has the
  // plane normal as its geometric normal and needs no separate winding fix.
  const ax = Math.abs(nx);
  const ay = Math.abs(ny);
  const az = Math.abs(nz);
  let ux = 0;
  let uy = 0;
  let uz = 0;
  if (ax <= ay && ax <= az) {
    uy = -nz;
    uz = ny;
  } else if (ay <= az) {
    ux = nz;
    uz = -nx;
  } else {
    ux = -ny;
    uy = nx;
  }
  const ul = Math.hypot(ux, uy, uz) || 1;
  ux /= ul;
  uy /= ul;
  uz /= ul;
  const vx = ny * uz - nz * uy;
  const vy = nz * ux - nx * uz;
  const vz = nx * uy - ny * ux;

  const markTop = source.inferred?.[interval];
  const markBottom = source.inferred?.[interval + 1];
  const marks =
    target.inferred && (markTop || markBottom) ? target.inferred : null;

  const capacity = target.capacity;
  let needed = 0;
  const triangles = members.length;

  for (let t = 0; t < triangles; t++) {
    if (!members[t]) continue;
    const a = indices[3 * t];
    const b = indices[3 * t + 1];
    const c = indices[3 * t + 2];

    // Slots 0-2 are the top triangle and 3-5 the bottom one, in the SAME vertex
    // order, so slot k and slot k+3 are the ends of one vertical edge.
    pv[0] = a;
    pv[1] = b;
    pv[2] = c;
    pv[3] = a;
    pv[4] = b;
    pv[5] = c;
    px[0] = positionsXZ[2 * a];
    pz[0] = positionsXZ[2 * a + 1];
    px[1] = positionsXZ[2 * b];
    pz[1] = positionsXZ[2 * b + 1];
    px[2] = positionsXZ[2 * c];
    pz[2] = positionsXZ[2 * c + 1];
    px[3] = px[0];
    pz[3] = pz[0];
    px[4] = px[1];
    pz[4] = pz[1];
    px[5] = px[2];
    pz[5] = pz[2];
    py[0] = top[a];
    py[1] = top[b];
    py[2] = top[c];
    py[3] = bottom[a];
    py[4] = bottom[b];
    py[5] = bottom[c];
    pw[0] = 1;
    pw[1] = 1;
    pw[2] = 1;
    pw[3] = 0;
    pw[4] = 0;
    pw[5] = 0;
    if (marks) {
      // A volume is invented as soon as either surface that closes it was, which
      // is the rule the walls already use.
      pm[0] = Math.max(markTop?.[a] ?? 0, markBottom?.[a] ?? 0);
      pm[1] = Math.max(markTop?.[b] ?? 0, markBottom?.[b] ?? 0);
      pm[2] = Math.max(markTop?.[c] ?? 0, markBottom?.[c] ?? 0);
      pm[3] = pm[0];
      pm[4] = pm[1];
      pm[5] = pm[2];
    }

    let above = 0;
    let strict = 0;
    for (let k = 0; k < 6; k++) {
      pd[k] = nx * px[k] + ny * py[k] + nz * pz[k] + constant;
      if (!(pd[k] < 0)) above++;
      if (pd[k] > 0) strict++;
    }
    // Wholly on one side: no face, and the common case by a wide margin. `strict`
    // is what separates a cut from a GRAZE — a plane touching a corner or an edge
    // removes nothing, and closing it would emit a zero-area polygon whose
    // vertices are all coincident.
    if (strict === 0 || above === 6) continue;

    let m = 0;
    for (let e = 0; e < 9; e++) {
      let i0 = EDGES[e][0];
      let i1 = EDGES[e][1];
      // ⭐⭐ THE watertightness step. Two triangles sharing an XZ edge list its
      // endpoints in opposite slot order, and `p0 + s*(p1 - p0)` is not the same
      // float read the other way round. Ordering by (layer, vertex index) — which
      // both cells agree on — is what makes the two faces meet exactly.
      const swap = i0 < 3 === i1 < 3 ? pv[i0] > pv[i1] : i0 >= 3;
      if (swap) {
        const t0 = i0;
        i0 = i1;
        i1 = t0;
      }
      const d0 = pd[i0];
      const d1 = pd[i1];
      // `d === 0` counts as ABOVE on both sides of the comparison, so a plane
      // through a corner yields that corner exactly once instead of twice.
      if (d0 < 0 === d1 < 0) continue;
      if (m === MAX_POLY) break;
      const s = d0 / (d0 - d1);
      cutX[m] = px[i0] + (px[i1] - px[i0]) * s;
      cutY[m] = py[i0] + (py[i1] - py[i0]) * s;
      cutZ[m] = pz[i0] + (pz[i1] - pz[i0]) * s;
      cutV[m] = pw[i0] + (pw[i1] - pw[i0]) * s;
      if (marks) cutM[m] = pm[i0] + (pm[i1] - pm[i0]) * s;
      m++;
    }
    if (m < 3) continue;

    // Sort the crossings CCW about their centroid in the plane's own basis. The
    // polygon is convex, so an angular sort is its boundary order exactly.
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (let k = 0; k < m; k++) {
      cx += cutX[k];
      cy += cutY[k];
      cz += cutZ[k];
    }
    cx /= m;
    cy /= m;
    cz /= m;
    for (let k = 0; k < m; k++) {
      const dx = cutX[k] - cx;
      const dy = cutY[k] - cy;
      const dz = cutZ[k] - cz;
      cutA[k] = Math.atan2(
        dx * vx + dy * vy + dz * vz,
        dx * ux + dy * uy + dz * uz,
      );
      order[k] = k;
    }
    for (let k = 1; k < m; k++) {
      const key = order[k];
      const angle = cutA[key];
      let j = k - 1;
      while (j >= 0 && cutA[order[j]] > angle) {
        order[j + 1] = order[j];
        j--;
      }
      order[j + 1] = key;
    }

    const fan = (m - 2) * 3;
    if (needed + fan > capacity) {
      needed += fan;
      continue;
    }
    for (let k = 1; k + 1 < m; k++) {
      const tri = [order[0], order[k], order[k + 1]];
      for (let s = 0; s < 3; s++) {
        const p = tri[s];
        const at = needed + s;
        target.positions[3 * at] = cutX[p] + ox;
        target.positions[3 * at + 1] = cutY[p] + oy;
        target.positions[3 * at + 2] = cutZ[p] + oz;
        target.normals[3 * at] = nx;
        target.normals[3 * at + 1] = ny;
        target.normals[3 * at + 2] = nz;
        target.uvs[2 * at] = cutX[p] * ux + cutY[p] * uy + cutZ[p] * uz;
        target.uvs[2 * at + 1] = cutX[p] * vx + cutY[p] * vy + cutZ[p] * vz;
        target.wallV[at] = cutV[p];
        if (marks) marks[at] = cutM[p];
      }
      needed += 3;
    }
  }

  target.count = needed <= capacity ? needed : 0;
  return needed;
}

/** the twelve edges of an AABB, as pairs of corner indices (bit 0 = x, 1 = y, 2 = z) */
const BOX_EDGES: [number, number][] = [
  [0, 1],
  [2, 3],
  [4, 5],
  [6, 7],
  [0, 2],
  [1, 3],
  [4, 6],
  [5, 7],
  [0, 4],
  [1, 5],
  [2, 6],
  [3, 7],
];

const boxD = new Float64Array(8);
const boxAngle = new Float64Array(6);
const boxOrder = new Int32Array(6);
const boxX = new Float64Array(6);
const boxY = new Float64Array(6);
const boxZ = new Float64Array(6);

/**
 * The convex polygon where a plane crosses an axis-aligned box — what a section
 * plane looks like WITHIN the thing it is cutting, which is more use than an
 * arbitrary square floating in the scene.
 *
 * Same reasoning as {@link sectionStackInterval}: a box is convex, so intersecting
 * the plane with its twelve edges and sorting the crossings by angle in the plane
 * is the boundary exactly, and never more than a hexagon.
 *
 * @param min box minimum `[x, y, z]`
 * @param max box maximum
 * @param plane the plane, in the same frame as the box
 * @param out xyz-interleaved output, at least 18 long
 * @returns the number of POINTS written (0 when the plane misses the box)
 *
 * @group Geometries
 */
export function sectionPlaneOutline(
  min: Vec3,
  max: Vec3,
  plane: StackSectionPlane,
  out: Float32Array,
): number {
  const [nx, ny, nz] = plane.normal;
  const at = (corner: number, axis: number) =>
    (corner >> axis) & 1 ? max[axis] : min[axis];

  let above = 0;
  for (let c = 0; c < 8; c++) {
    boxD[c] = nx * at(c, 0) + ny * at(c, 1) + nz * at(c, 2) + plane.constant;
    if (boxD[c] > 0) above++;
  }
  if (above === 0 || above === 8) return 0;

  let m = 0;
  for (const [a, b] of BOX_EDGES) {
    const d0 = boxD[a];
    const d1 = boxD[b];
    if (d0 < 0 === d1 < 0) continue;
    if (m === 6) break;
    const s = d0 / (d0 - d1);
    boxX[m] = at(a, 0) + (at(b, 0) - at(a, 0)) * s;
    boxY[m] = at(a, 1) + (at(b, 1) - at(a, 1)) * s;
    boxZ[m] = at(a, 2) + (at(b, 2) - at(a, 2)) * s;
    m++;
  }
  if (m < 3) return 0;

  let ux = 0;
  let uy = 0;
  let uz = 0;
  const ax = Math.abs(nx);
  const ay = Math.abs(ny);
  const az = Math.abs(nz);
  if (ax <= ay && ax <= az) {
    uy = -nz;
    uz = ny;
  } else if (ay <= az) {
    ux = nz;
    uz = -nx;
  } else {
    ux = -ny;
    uy = nx;
  }
  const ul = Math.hypot(ux, uy, uz) || 1;
  ux /= ul;
  uy /= ul;
  uz /= ul;
  const vx = ny * uz - nz * uy;
  const vy = nz * ux - nx * uz;
  const vz = nx * uy - ny * ux;

  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (let k = 0; k < m; k++) {
    cx += boxX[k];
    cy += boxY[k];
    cz += boxZ[k];
  }
  cx /= m;
  cy /= m;
  cz /= m;
  for (let k = 0; k < m; k++) {
    const dx = boxX[k] - cx;
    const dy = boxY[k] - cy;
    const dz = boxZ[k] - cz;
    boxAngle[k] = Math.atan2(
      dx * vx + dy * vy + dz * vz,
      dx * ux + dy * uy + dz * uz,
    );
    boxOrder[k] = k;
  }
  for (let k = 1; k < m; k++) {
    const key = boxOrder[k];
    const angle = boxAngle[key];
    let j = k - 1;
    while (j >= 0 && boxAngle[boxOrder[j]] > angle) {
      boxOrder[j + 1] = boxOrder[j];
      j--;
    }
    boxOrder[j + 1] = key;
  }

  for (let k = 0; k < m; k++) {
    const p = boxOrder[k];
    out[3 * k] = boxX[p];
    out[3 * k + 1] = boxY[p];
    out[3 * k + 2] = boxZ[p];
  }
  return m;
}
