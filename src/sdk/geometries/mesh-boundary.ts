/**
 * Boundary extraction for an indexed triangle mesh.
 *
 * Given a mesh and a SUBSET of its triangles, this finds the closed rings that
 * bound that subset. It is the mechanism behind per-layer terminations on a shared
 * tessellation: every layer of a chunk draws a different subset of ONE
 * triangulation, and the edge of a subset is where that unit stops.
 *
 * Tracing the subset rather than the underlying mask matters — the ring vertices
 * are mesh vertices, so anything built on the ring (a wall, a cut face) meets the
 * drawn triangles exactly, instead of following a cell-quantised line that cuts
 * across them.
 *
 * Nothing here is three-specific or surface-specific: it is plain index topology.
 */

/**
 * Pair up the half-edges of an indexed mesh.
 *
 * Half-edge `3 * t + k` runs from `indices[3 * t + k]` to the triangle's next
 * vertex, so a triangle's three half-edges are its three sides. Two triangles
 * sharing a side get each other's half-edge index; a side with no neighbour keeps
 * `-1`.
 *
 * Built ONCE per mesh: with a subset per layer, hashing the edges again for every
 * layer would dominate — this way each layer only reads two flags per edge.
 *
 * ⚠️ Non-manifold input (three or more triangles on one edge) pairs them up two at
 * a time, in the order they appear. The result is still usable; it just is not a
 * unique answer, because there is not one.
 *
 * @param indices triangle indices, three per triangle
 * @param vertexCount number of vertices, used to key the edges
 * @returns `opposite[halfEdge]` — the matching half-edge, or `-1` at a boundary
 *
 * @group Geometries
 */
export function buildEdgeOpposites(
  indices: ArrayLike<number>,
  vertexCount: number,
): Int32Array {
  const opposite = new Int32Array(indices.length).fill(-1);
  // key = min * vertexCount + max stays exact well past any tessellation we build
  // (a million vertices is 1e12, and integers are exact to 2^53).
  const pending = new Map<number, number>();
  for (let t = 0; t < indices.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = indices[t + k];
      const b = indices[t + ((k + 1) % 3)];
      const key = a < b ? a * vertexCount + b : b * vertexCount + a;
      const other = pending.get(key);
      if (other === undefined) {
        pending.set(key, t + k);
      } else {
        opposite[t + k] = other;
        opposite[other] = t + k;
        // Dropping the entry keeps the map small AND lets a third triangle on the
        // same edge start a fresh pair rather than silently overwriting one.
        pending.delete(key);
      }
    }
  }
  return opposite;
}

/** The next half-edge around the same triangle. */
function nextHalfEdge(halfEdge: number): number {
  return halfEdge % 3 === 2 ? halfEdge - 2 : halfEdge + 1;
}

/** What {@link traceBoundaryRings} found. */
export type BoundaryRings = {
  /** the closed rings, as vertex indices */
  rings: number[][];
  /**
   * Walks discarded for having fewer than 3 vertices — a degenerate sliver of the
   * subset. Nothing is built on them, so a non-zero count means a (tiny) piece of
   * boundary went unwalled.
   */
  dropped: number;
  /**
   * Walks that ended without returning to their first vertex.
   *
   * ⚠️ Should be 0: every boundary vertex has as many incoming edges as outgoing,
   * so the walk is Eulerian and must close. A non-zero count means the subset is
   * non-manifold, and since consumers treat a ring as CLOSED, the chain would be
   * sealed with an edge that does not exist — a wall across open space.
   */
  open: number;
};

/**
 * Trace the closed rings bounding a subset of a mesh's triangles.
 *
 * A side is on the boundary when the triangle it belongs to is in the subset and
 * the one across it is not. Following those sides in their own direction keeps the
 * subset consistently on one side of the walk, so the rings come out with a
 * CONSISTENT ORIENTATION: an outer ring and a hole wind opposite ways, which is
 * exactly what a wall builder needs to point its faces away from the material.
 *
 * @param indices the mesh's triangle indices
 * @param opposite half-edge pairing from {@link buildEdgeOpposites}
 * @param member per triangle: non-zero when it belongs to the subset
 * @returns the rings, plus the counts that say whether the trace was clean
 *
 * @group Geometries
 */
export function traceBoundaryRings(
  indices: ArrayLike<number>,
  opposite: Int32Array,
  member: Uint8Array,
): BoundaryRings {
  // Outgoing boundary half-edges per vertex. A vertex normally has one, but where
  // two lobes of the subset meet at a single point it has two — see below.
  const outgoing = new Map<number, number[]>();
  for (let he = 0; he < indices.length; he++) {
    if (!member[(he / 3) | 0]) continue;
    const other = opposite[he];
    if (other >= 0 && member[(other / 3) | 0]) continue;
    const from = indices[he];
    const list = outgoing.get(from);
    if (list) list.push(he);
    else outgoing.set(from, [he]);
  }
  if (outgoing.size === 0) return { rings: [], dropped: 0, open: 0 };

  const used = new Uint8Array(indices.length);
  const rings: number[][] = [];
  let dropped = 0;
  let open = 0;
  for (const list of outgoing.values()) {
    for (const first of list) {
      if (used[first]) continue;
      const ring: number[] = [];
      let he = first;
      let closed = false;
      for (;;) {
        used[he] = 1;
        ring.push(indices[he]);
        const to = indices[nextHalfEdge(he)];
        const candidates = outgoing.get(to);
        let next = -1;
        if (candidates) {
          for (const c of candidates) {
            if (!used[c]) {
              next = c;
              break;
            }
          }
        }
        // Every boundary vertex has as many ways out as in, so the walk returns to
        // where it started. ⚠️ At a pinch point the choice of continuation is
        // arbitrary, which splits the boundary into several loops rather than one
        // — each still closed, so anything built on them still seals.
        if (next < 0) {
          closed = to === ring[0];
          break;
        }
        he = next;
      }
      if (!closed) open++;
      if (ring.length >= 3) rings.push(ring);
      else dropped++;
    }
  }
  return { rings, dropped, open };
}
