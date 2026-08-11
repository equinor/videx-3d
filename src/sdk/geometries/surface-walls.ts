import { BufferAttribute, BufferGeometry } from 'three';
import { Coordinates2D } from './planar-geometry';

/** A ring to build a wall on. */
export type WallRing = {
  /** the ring's points in scene XZ */
  points: Coordinates2D;
  /** depth of the wall's top edge at each point */
  topY: number[];
  /** depth of the wall's bottom edge at each point */
  bottomY: number[];
  /**
   * Per POINT: how far the geometry there was INFERRED rather than measured
   * (0..1) — the seal's taper weight, or simply 1 where a unit is drawn on hole
   * fill.
   */
  inferred?: number[];
};

/**
 * Turn beyond which a ring point counts as a CREASE rather than a curve, in
 * degrees.
 *
 * ⭐ Averaging a point's two segment normals is right for a rim that genuinely
 * curves and wrong for a corner, where it fabricates a rounded shoulder out of two
 * flat walls — a square crop then reads as a lozenge. Past this angle the point's
 * vertices are split so each wall keeps its own normal.
 */
export const WALL_SMOOTH_ANGLE = 40;

/** Options for {@link buildRingWalls}. */
export type RingWallOptions = {
  /**
   * Default {@link WALL_SMOOTH_ANGLE}. 180 smooths every point (the old
   * behaviour), 0 facets every one.
   */
  smoothAngle?: number;
};

/**
 * Build a side-wall mesh: a quad strip per ring, connecting the top depths to the
 * bottom depths at each of the ring's points.
 *
 * ⭐ Normals are assigned explicitly rather than via `computeVertexNormals()`,
 * which is area-weighted and gives a ring point's TOP and BOTTOM vertex different
 * normals (they belong to different triangle sets: `t_k` to
 * `{A_{k-1}, B_{k-1}, A_k}` but `b_k` to `{B_{k-1}, A_k, B_k}`). A normal that
 * varies vertically as well as horizontally interpolates differently in each of a
 * quad's two triangles, which shows up as a seam along every quad diagonal. Giving
 * both vertices of a point the same normal keeps the shading smooth around the
 * ring while making it constant along each vertical edge, so both triangles
 * interpolate the same linear function and the diagonals vanish.
 *
 * ⭐ Averaging a point's two segment normals is only right where the rim actually
 * CURVES. Past {@link WALL_SMOOTH_ANGLE} the point is treated as a crease and its
 * vertices are split, so each wall keeps its own flat normal — otherwise a square
 * crop's corners are shaded as if they were round. The seam argument above still
 * holds: each segment's two vertical edges keep a constant normal.
 *
 * Each wall quad is exactly planar (its top and bottom vertices share the same
 * XZ), so a segment's normal `normalize(dz, 0, -dx)` is its true face normal — and
 * which way it faces follows the ring's winding, so an outer ring and a hole
 * traced with a consistent orientation both end up facing away from the material.
 *
 * **UVs are in METRES**: `u` runs along the ring (cumulative arc length), `v` is the
 * vertex's own height. A pattern drawn on a wall is then anchored in world space and
 * keeps its scale however the ring is shaped — the same reasoning that anchors
 * procedural relief. ⚠️ `u` wraps back to 0 on the closing segment, so a repeating
 * pattern has one seam per ring.
 *
 * **`inferred`**: an optional per-vertex attribute, present only when a ring
 * supplied one. It is interpolated across the strip, so a marking drawn from it
 * FADES rather than steps — which is why this is one attribute on one mesh rather
 * than two geometry groups drawn with two materials. Splitting would duplicate the
 * vertices at every junction and bring the diagonal seam back.
 *
 * @param rings the rings to build on; a ring with fewer than 2 points is skipped
 * @param options see {@link RingWallOptions}
 * @returns the wall geometry, or `null` when nothing was built
 *
 * @group Geometries
 */
export function buildRingWalls(
  rings: WallRing[],
  options: RingWallOptions = {},
): BufferGeometry | null {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const marks: number[] = [];
  const indices: number[] = [];
  let tagged = false;
  const minDot = Math.cos(
    ((options.smoothAngle ?? WALL_SMOOTH_ANGLE) * Math.PI) / 180,
  );

  for (const { points, topY, bottomY, inferred } of rings) {
    const m = points.length;
    if (m < 2) continue;
    if (inferred) tagged = true;

    // Outward normal and length of segment k (point k -> k + 1).
    const segX = new Float64Array(m);
    const segZ = new Float64Array(m);
    const segLen = new Float64Array(m);
    for (let k = 0; k < m; k++) {
      const k1 = (k + 1) % m;
      const dx = points[k1][0] - points[k][0];
      const dz = points[k1][1] - points[k][1];
      const len = Math.hypot(dx, dz);
      segLen[k] = len;
      if (len > 0) {
        segX[k] = dz / len;
        segZ[k] = -dx / len;
      }
    }

    // Per point: the vertex segment k STARTS from, and the one segment k-1 ENDS
    // at. The same vertex where the point is smooth; two where it creases, which
    // is the only way each wall can keep its own flat normal.
    const outOf = new Int32Array(m);
    const inTo = new Int32Array(m);

    const emit = (k: number, nx: number, nz: number, arc: number) => {
      const index = positions.length / 3;
      const mark = inferred ? inferred[k] : 0;
      positions.push(points[k][0], topY[k], points[k][1]); // top vertex
      normals.push(nx, 0, nz);
      uvs.push(arc, topY[k]);
      marks.push(mark);
      positions.push(points[k][0], bottomY[k], points[k][1]); // bottom vertex
      normals.push(nx, 0, nz);
      uvs.push(arc, bottomY[k]);
      marks.push(mark);
      return index;
    };

    let arc = 0;
    for (let k = 0; k < m; k++) {
      const prev = (k - 1 + m) % m;
      // A zero-length segment has no normal of its own, so borrow its
      // neighbour's rather than let the point inherit a null one.
      const px = segLen[prev] > 0 ? segX[prev] : segX[k];
      const pz = segLen[prev] > 0 ? segZ[prev] : segZ[k];
      const nx = segLen[k] > 0 ? segX[k] : px;
      const nz = segLen[k] > 0 ? segZ[k] : pz;

      if (px * nx + pz * nz >= minDot) {
        // Smooth: one shared vertex pair, normal averaged across the point.
        let ax = px + nx;
        let az = pz + nz;
        const len = Math.hypot(ax, az);
        if (len > 0) {
          ax /= len;
          az /= len;
        } else {
          // a 180° turn back on itself — fall back to this segment's own normal
          ax = nx;
          az = nz;
        }
        inTo[k] = outOf[k] = emit(k, ax, az, arc);
      } else {
        // Creased: each wall keeps its own flat normal.
        inTo[k] = emit(k, px, pz, arc);
        outOf[k] = emit(k, nx, nz, arc);
      }
      arc += segLen[k];
    }

    for (let k = 0; k < m; k++) {
      const k1 = (k + 1) % m;
      const t0 = outOf[k];
      const b0 = outOf[k] + 1;
      const t1 = inTo[k1];
      const b1 = inTo[k1] + 1;
      indices.push(t0, t1, b0, t1, b1, b0);
    }
  }

  if (indices.length === 0) return null;
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    'position',
    new BufferAttribute(new Float32Array(positions), 3),
  );
  geometry.setAttribute(
    'normal',
    new BufferAttribute(new Float32Array(normals), 3),
  );
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  // Only when something is actually marked — its presence is what tells the
  // appearance layer there is anything to draw an overlay for.
  if (tagged && marks.some(v => v > 0)) {
    geometry.setAttribute(
      'inferred',
      new BufferAttribute(new Float32Array(marks), 1),
    );
  }
  geometry.setIndex(new BufferAttribute(new Uint32Array(indices), 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * The common case of {@link buildRingWalls}: one wall per ring of a shared rim,
 * top depths from one layer and bottom depths from the next.
 *
 * @param rings the rim rings in scene XZ
 * @param topY `topY[ring][point]`
 * @param bottomY `bottomY[ring][point]`
 *
 * @group Geometries
 */
export function buildIntervalWalls(
  rings: Coordinates2D[],
  topY: number[][],
  bottomY: number[][],
): BufferGeometry | null {
  return buildRingWalls(
    rings.map((points, r) => ({ points, topY: topY[r], bottomY: bottomY[r] })),
  );
}
