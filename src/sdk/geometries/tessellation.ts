import { BufferAttribute, BufferGeometry } from 'three';

/**
 * Midpoint-subdivide an indexed geometry `iterations` times, splitting every
 * triangle into four (each edge midpoint is shared between adjacent triangles).
 * Only the `position` attribute is interpolated; stale `normal`/`uv` attributes
 * are dropped (recompute them afterwards). A no-op when the geometry has no
 * index or `iterations <= 0`.
 *
 * @group Geometries
 */
export function subdivideGeometry(
  geometry: BufferGeometry,
  iterations: number,
): void {
  for (let it = 0; it < iterations; it++) {
    subdivideOnce(geometry);
  }
}

function subdivideOnce(geometry: BufferGeometry): void {
  const index = geometry.getIndex();
  const posAttr = geometry.getAttribute('position') as BufferAttribute;
  if (!index) return;
  const idx = index.array;
  const positions: number[] = [];
  for (let i = 0; i < posAttr.count; i++) {
    positions.push(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
  }
  const newIndices: number[] = [];
  const midCache = new Map<string, number>();
  const midpoint = (a: number, b: number): number => {
    const key = a < b ? `${a}_${b}` : `${b}_${a}`;
    const cached = midCache.get(key);
    if (cached !== undefined) return cached;
    const mi = positions.length / 3;
    positions.push(
      (positions[a * 3] + positions[b * 3]) / 2,
      (positions[a * 3 + 1] + positions[b * 3 + 1]) / 2,
      (positions[a * 3 + 2] + positions[b * 3 + 2]) / 2,
    );
    midCache.set(key, mi);
    return mi;
  };
  for (let i = 0; i + 2 < idx.length; i += 3) {
    const a = idx[i];
    const b = idx[i + 1];
    const c = idx[i + 2];
    const ab = midpoint(a, b);
    const bc = midpoint(b, c);
    const ca = midpoint(c, a);
    newIndices.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
  }
  const count = positions.length / 3;
  geometry.setAttribute(
    'position',
    new BufferAttribute(Float32Array.from(positions), 3),
  );
  const newIdx =
    count <= 65536 ? Uint16Array.from(newIndices) : Uint32Array.from(newIndices);
  geometry.setIndex(new BufferAttribute(newIdx, 1));
  geometry.deleteAttribute('normal');
  geometry.deleteAttribute('uv');
}

/**
 * Refine an indexed triangle mesh `iterations` times by splitting only its
 * INTERIOR edges, leaving boundary edges — and therefore the exact outline and
 * its vertex count — untouched. Each interior edge contributes one midpoint that
 * is shared by the two triangles adjacent to it, so the mesh stays conforming
 * (no T-junctions) while the boundary loop is preserved exactly. This is what
 * lets a surface or sea bed be densified for vertex displacement / detail while
 * its rim still matches, vertex-for-vertex, walls extruded from the same
 * outline. Only `position` is interpolated; stale `normal`/`uv` are dropped
 * (recompute afterwards). A no-op without an index or when `iterations <= 0`.
 *
 * @group Geometries
 */
export function refineInteriorEdges(
  geometry: BufferGeometry,
  iterations: number,
): void {
  for (let it = 0; it < iterations; it++) {
    refineInteriorOnce(geometry);
  }
}

function refineInteriorOnce(geometry: BufferGeometry): void {
  const index = geometry.getIndex();
  const posAttr = geometry.getAttribute('position') as BufferAttribute;
  if (!index) return;
  const idx = index.array;
  const positions: number[] = [];
  for (let i = 0; i < posAttr.count; i++) {
    positions.push(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
  }

  const edgeKey = (a: number, b: number) => (a < b ? `${a}_${b}` : `${b}_${a}`);

  // Classify edges: an interior edge is shared by two triangles, a boundary edge
  // by exactly one. Only interior edges are split.
  const edgeCount = new Map<string, number>();
  for (let i = 0; i + 2 < idx.length; i += 3) {
    const tri = [idx[i], idx[i + 1], idx[i + 2]];
    for (let e = 0; e < 3; e++) {
      const k = edgeKey(tri[e], tri[(e + 1) % 3]);
      edgeCount.set(k, (edgeCount.get(k) ?? 0) + 1);
    }
  }

  const midCache = new Map<string, number>();
  const midpoint = (a: number, b: number): number => {
    const key = edgeKey(a, b);
    const cached = midCache.get(key);
    if (cached !== undefined) return cached;
    const mi = positions.length / 3;
    positions.push(
      (positions[a * 3] + positions[b * 3]) / 2,
      (positions[a * 3 + 1] + positions[b * 3 + 1]) / 2,
      (positions[a * 3 + 2] + positions[b * 3 + 2]) / 2,
    );
    midCache.set(key, mi);
    return mi;
  };
  const isInterior = (a: number, b: number) =>
    (edgeCount.get(edgeKey(a, b)) ?? 0) > 1;

  const newIndices: number[] = [];
  for (let i = 0; i + 2 < idx.length; i += 3) {
    const a = idx[i];
    const b = idx[i + 1];
    const c = idx[i + 2];
    // Split only the interior edges (boundary edges are preserved, keeping the
    // outline and its vertex count exact). Midpoints are cached per edge so the
    // two triangles adjacent to an interior edge share the same one — conforming,
    // no T-junctions. Each case is triangulated so EVERY emitted triangle has
    // non-zero area: a naive fan from a corner would emit collinear triangles
    // such as (a, mid(a,b), b), which are degenerate when flat but pop into thin
    // overlapping slivers once the vertices are displaced to different heights.
    const iAB = isInterior(a, b);
    const iBC = isInterior(b, c);
    const iCA = isInterior(c, a);
    const n = (iAB ? 1 : 0) + (iBC ? 1 : 0) + (iCA ? 1 : 0);
    if (n === 0) {
      newIndices.push(a, b, c);
    } else if (n === 3) {
      const mAB = midpoint(a, b);
      const mBC = midpoint(b, c);
      const mCA = midpoint(c, a);
      newIndices.push(a, mAB, mCA, b, mBC, mAB, c, mCA, mBC, mAB, mBC, mCA);
    } else if (n === 1) {
      if (iAB) {
        const m = midpoint(a, b);
        newIndices.push(a, m, c, m, b, c);
      } else if (iBC) {
        const m = midpoint(b, c);
        newIndices.push(b, m, a, m, c, a);
      } else {
        const m = midpoint(c, a);
        newIndices.push(c, m, b, m, a, b);
      }
    } else if (!iCA) {
      // AB and BC split, CA whole
      const mAB = midpoint(a, b);
      const mBC = midpoint(b, c);
      newIndices.push(mAB, b, mBC, a, mAB, mBC, a, mBC, c);
    } else if (!iAB) {
      // BC and CA split, AB whole
      const mBC = midpoint(b, c);
      const mCA = midpoint(c, a);
      newIndices.push(mBC, c, mCA, b, mBC, mCA, b, mCA, a);
    } else {
      // CA and AB split, BC whole
      const mCA = midpoint(c, a);
      const mAB = midpoint(a, b);
      newIndices.push(mCA, a, mAB, c, mCA, mAB, c, mAB, b);
    }
  }

  const count = positions.length / 3;
  geometry.setAttribute(
    'position',
    new BufferAttribute(Float32Array.from(positions), 3),
  );
  const newIdx =
    count <= 65536 ? Uint16Array.from(newIndices) : Uint32Array.from(newIndices);
  geometry.setIndex(new BufferAttribute(newIdx, 1));
  geometry.deleteAttribute('normal');
  geometry.deleteAttribute('uv');
}
