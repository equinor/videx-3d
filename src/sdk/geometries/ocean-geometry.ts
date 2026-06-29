import {
  BufferAttribute,
  BufferGeometry,
  Path,
  Shape,
  ShapeGeometry,
  Vector2,
} from 'three';
import { Vec2 } from '../types/common';
import { asVec2 } from '../utils/vector-operations';
import { extractBoundaryLoops, smoothBoundaryLoops } from './boundary-loops';
import {
  computePlanarXZUv,
  computeUpwardNormals,
  createIndexedGeometry,
  rotateGeometryY,
} from './geometry-attributes';
import { buildMaskedGridPlane, floodFillExternalHoles } from './grid-sampling';
import {
  Coordinates2D,
  PlanarPolygonCoordinates,
  PlanarPolygonGeometry,
} from './planar-geometry';
import { refineInteriorEdges } from './tessellation';
import { triangulateGridDelaunay } from './triangulate-grid-delaunay';

/** Options shared by the ocean geometry builders. */
export type OceanGeometryOptions = {
  /**
   * Horizontal extent in world units (meters): a single number for a square, or
   * `[width (X), length (Z)]`. Default 100000 (100 km).
   */
  size?: number | Vec2;
  /**
   * Water-surface tessellation: a single number for both axes, or `[X, Z]`.
   * The default `0` uses the fewest triangles needed to fill the footprint
   * outline (a flat surface needs no interior grid — the waves are shaded
   * per-pixel). A positive value lays down a regular subdivision grid, which
   * only matters when vertex displacement is enabled. Default 0.
   */
  surfaceSegments?: number | Vec2;
  /** Center offset in world X/Z (meters). Default `[0, 0]`. */
  origin?: Vec2;
  /**
   * Orientation in degrees, rotating the geometry about the +Y axis around
   * {@link origin} (counter-clockwise viewed from above). Default 0.
   */
  rotation?: number;
};

/** Options for {@link createOceanPlane}. */
export type OceanPlaneOptions = OceanGeometryOptions;

/** Options for {@link createOceanBox}. */
export type OceanBoxOptions = OceanGeometryOptions & {
  /**
   * Mean water depth in meters: distance from the surface (y = 0) down to the
   * sea bed. Default 150.
   */
  waterDepth?: number;
  /**
   * Sea-bed depth variation in meters (±) around {@link waterDepth}. With the
   * defaults the bed varies between 100 m and 200 m. Default 50.
   */
  depthVariation?: number;
  /**
   * Sea-bed tessellation: a single number for both axes, or `[X, Z]`. Controls
   * how finely the depth variation is resolved. Default 32.
   */
  bedSegments?: number | Vec2;
  /** Seed for the procedural sea-bed variation. Default 0. */
  seed?: number;
};

/**
 * The three separate geometries produced by {@link createOceanBox}. Each is a
 * standalone {@link BufferGeometry} so they can be rendered as independent
 * meshes (and routed independently through transparency / OIT).
 */
export type OceanBox = {
  /** Top face (y = 0, normal +Y), tessellated for the waves. */
  surface: BufferGeometry;
  /** The four side walls (outward normals) forming the water body volume. */
  body: BufferGeometry;
  /** The displaced sea-bed bottom face (normals follow the bed slope). */
  bed: BufferGeometry;
};

/**
 * Create the procedural sea-bed depth function used by the ocean-box builders.
 * Returns a depth (meters below the surface, i.e. the bed sits at `y = -depth`)
 * for a world X/Z point, varying smoothly in
 * `[waterDepth - depthVariation, waterDepth + depthVariation]` via a small sum
 * of sines normalised over the `[minX, minX + w] x [minZ, minZ + l]` extent.
 */
function makeBedDepthFn(
  minX: number,
  minZ: number,
  w: number,
  l: number,
  waterDepth: number,
  depthVariation: number,
  seed: number,
): (x: number, z: number) => number {
  return (x: number, z: number): number => {
    const fx = (x - minX) / w;
    const fz = (z - minZ) / l;
    let n = 0.5;
    n +=
      0.25 *
      Math.sin((fx * 6.0 + seed) * Math.PI) *
      Math.cos(fz * 5.0 * Math.PI);
    n +=
      0.15 *
      Math.sin((fx * 13.0 - seed) * Math.PI + 1.7) *
      Math.cos(fz * 11.0 * Math.PI - 0.6);
    n +=
      0.1 *
      Math.sin(fx * 23.0 * Math.PI + 0.3) *
      Math.cos(fz * 19.0 * Math.PI + 2.1);
    const c = Math.min(Math.max(n, 0), 1);
    return waterDepth + (c * 2 - 1) * depthVariation;
  };
}

/**
 * Build a flat ocean surface plane lying in the world X/Z plane (normal +Y) at
 * y = 0, centered on `origin`. UVs span [0, 1] across the plane.
 *
 * The ocean animation is evaluated in world space, so this could equally be a
 * set of tiled patches; this helper just provides a convenient single plane.
 *
 * @group Geometries
 */
export function createOceanPlane(
  options: OceanPlaneOptions = {},
): BufferGeometry {
  const [w, l] = asVec2(options.size, 100000);
  const [sx, sz] = asVec2(options.surfaceSegments, 0);
  const [ox, oz] = options.origin ?? [0, 0];
  const rotation = options.rotation ?? 0;

  const segX = Math.max(1, Math.floor(sx));
  const segZ = Math.max(1, Math.floor(sz));

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let iz = 0; iz <= segZ; iz++) {
    for (let ix = 0; ix <= segX; ix++) {
      positions.push(
        ox - w / 2 + (ix / segX) * w,
        0,
        oz - l / 2 + (iz / segZ) * l,
      );
      normals.push(0, 1, 0);
      uvs.push(ix / segX, iz / segZ);
    }
  }
  for (let iz = 0; iz < segZ; iz++) {
    for (let ix = 0; ix < segX; ix++) {
      const a = iz * (segX + 1) + ix;
      const b = a + 1;
      const c = a + (segX + 1);
      const d = c + 1;
      indices.push(a, c, b, b, c, d); // CCW => normal +Y
    }
  }

  const geometry = createIndexedGeometry(positions, normals, uvs, indices);
  rotateGeometryY(geometry, rotation, [ox, oz]);
  return geometry;
}

/**
 * Build an ocean box volume for a more complete water emulation. Returns three
 * separate geometries so each can be rendered as its own mesh and routed
 * independently through transparency / OIT:
 *
 * - **surface** — the top face (y = 0, normal +Y), tessellated for the waves.
 * - **body** — the four side walls (outward normals); render with a
 *   double-sided volume material so the interior reads as a tinted water body.
 * - **bed** — the bottom face, displaced to a procedurally varying depth
 *   between `waterDepth - depthVariation` and `waterDepth + depthVariation`
 *   (default 100–200 m), with normals following the bed slope.
 *
 * Pair with `<Ocean>` by passing `geometry={box.surface}` plus
 * `bodyGeometry={box.body}` and `bedGeometry={box.bed}`.
 *
 * @group Geometries
 */
export function createOceanBox(options: OceanBoxOptions = {}): OceanBox {
  const [w, l] = asVec2(options.size, 100000);
  const [bx, bz] = asVec2(options.bedSegments, 32);
  const [ox, oz] = options.origin ?? [0, 0];
  const rotation = options.rotation ?? 0;
  const waterDepth = options.waterDepth ?? 150;
  const depthVariation = options.depthVariation ?? 50;
  const seed = options.seed ?? 0;

  const bedX = Math.max(1, Math.floor(bx));
  const bedZ = Math.max(1, Math.floor(bz));

  const halfW = w / 2;
  const halfL = l / 2;
  const minX = ox - halfW;
  const minZ = oz - halfL;
  const maxX = minX + w;
  const maxZ = minZ + l;

  // Procedural sea-bed depth (meters below the surface) at a world X/Z point.
  // A small sum of sines gives smooth, seamless variation in [0, 1] that is
  // remapped to [waterDepth - depthVariation, waterDepth + depthVariation].
  const bedDepth = makeBedDepthFn(
    minX,
    minZ,
    w,
    l,
    waterDepth,
    depthVariation,
    seed,
  );

  const eps = Math.min(w, l) / 1000;
  const bedNormal = (x: number, z: number): [number, number, number] => {
    const dx = (bedDepth(x + eps, z) - bedDepth(x - eps, z)) / (2 * eps);
    const dz = (bedDepth(x, z + eps) - bedDepth(x, z - eps)) / (2 * eps);
    // surface y = -bedDepth, so slope = -d(bedDepth); normal = (slopeX, 1, slopeZ)
    const inv = 1 / Math.hypot(dx, 1, dz);
    return [dx * inv, inv, dz * inv];
  };

  // --- Surface (top, y = 0, normal +Y) --------------------------------------
  const surface = createOceanPlane({
    size: options.size,
    surfaceSegments: options.surfaceSegments,
    origin: options.origin,
  });

  // --- Water body: the four side walls (outward normals) --------------------
  const wp: number[] = [];
  const wn: number[] = [];
  const wuv: number[] = [];
  const wi: number[] = [];

  // Add one wall strip along an edge sampled by `points`, with `outward` normal.
  const addWall = (points: Vec2[], outward: Vec2) => {
    const start = wp.length / 3;
    for (let i = 0; i < points.length; i++) {
      const [x, z] = points[i];
      const t = i / (points.length - 1);
      wp.push(x, 0, z);
      wn.push(outward[0], 0, outward[1]);
      wuv.push(t, 1);
      wp.push(x, -bedDepth(x, z), z);
      wn.push(outward[0], 0, outward[1]);
      wuv.push(t, 0);
    }
    for (let i = 0; i < points.length - 1; i++) {
      const t0 = start + i * 2;
      const b0 = t0 + 1;
      const t1 = start + (i + 1) * 2;
      const b1 = t1 + 1;
      // Winding so the front face points along `outward`.
      const ax = wp[t0 * 3];
      const ay = wp[t0 * 3 + 1];
      const az = wp[t0 * 3 + 2];
      const e1x = wp[b0 * 3] - ax;
      const e1y = wp[b0 * 3 + 1] - ay;
      const e1z = wp[b0 * 3 + 2] - az;
      const e2x = wp[t1 * 3] - ax;
      const e2y = wp[t1 * 3 + 1] - ay;
      const e2z = wp[t1 * 3 + 2] - az;
      const cx = e1y * e2z - e1z * e2y;
      const cz = e1x * e2y - e1y * e2x;
      const facesOut = cx * outward[0] + cz * outward[1] >= 0;
      if (facesOut) {
        wi.push(t0, b0, t1, t1, b0, b1);
      } else {
        wi.push(t0, t1, b0, t1, b1, b0);
      }
    }
  };

  const edgePoints = (
    fromX: number,
    fromZ: number,
    toX: number,
    toZ: number,
    seg: number,
  ): Vec2[] => {
    const pts: Vec2[] = [];
    for (let i = 0; i <= seg; i++) {
      const t = i / seg;
      pts.push([fromX + (toX - fromX) * t, fromZ + (toZ - fromZ) * t]);
    }
    return pts;
  };

  addWall(edgePoints(minX, minZ, maxX, minZ, bedX), [0, -1]); // north (-Z)
  addWall(edgePoints(maxX, maxZ, minX, maxZ, bedX), [0, 1]); // south (+Z)
  addWall(edgePoints(minX, maxZ, minX, minZ, bedZ), [-1, 0]); // west (-X)
  addWall(edgePoints(maxX, minZ, maxX, maxZ, bedZ), [1, 0]); // east (+X)
  const body = createIndexedGeometry(wp, wn, wuv, wi);

  // --- Sea bed (bottom, normal +Y following the bed slope) ------------------
  const bp: number[] = [];
  const bn: number[] = [];
  const buv: number[] = [];
  const bi: number[] = [];
  for (let iz = 0; iz <= bedZ; iz++) {
    for (let ix = 0; ix <= bedX; ix++) {
      const x = minX + (ix / bedX) * w;
      const z = minZ + (iz / bedZ) * l;
      bp.push(x, -bedDepth(x, z), z);
      const [nx, ny, nz] = bedNormal(x, z);
      bn.push(nx, ny, nz);
      buv.push(ix / bedX, iz / bedZ);
    }
  }
  for (let iz = 0; iz < bedZ; iz++) {
    for (let ix = 0; ix < bedX; ix++) {
      const a = iz * (bedX + 1) + ix;
      const b = a + 1;
      const c = a + (bedX + 1);
      const d = c + 1;
      bi.push(a, c, b, b, c, d);
    }
  }
  const bed = createIndexedGeometry(bp, bn, buv, bi);

  rotateGeometryY(surface, rotation, [ox, oz]);
  rotateGeometryY(body, rotation, [ox, oz]);
  rotateGeometryY(bed, rotation, [ox, oz]);

  return { surface, body, bed };
}

/** Options for {@link createOceanEllipseBox}. */
export type OceanEllipseOptions = Omit<
  OceanGeometryOptions,
  'surfaceSegments'
> & {
  /**
   * Mean water depth in meters: distance from the surface (y = 0) down to the
   * sea bed. Default 150.
   */
  waterDepth?: number;
  /**
   * Sea-bed depth variation in meters (±) around {@link waterDepth}. With the
   * defaults the bed varies between 100 m and 200 m. Default 50.
   */
  depthVariation?: number;
  /** Seed for the procedural sea-bed variation. Default 0. */
  seed?: number;
  /**
   * Number of segments around the perimeter. Higher values give a rounder,
   * smoother outline. Default 96.
   */
  perimeterSegments?: number;
  /**
   * Number of segments from the center out to the edge (concentric rings).
   * Higher values resolve the sea-bed depth variation more finely and give
   * smoother wave displacement. The default `0` is auto: just enough rings to
   * keep the radial spacing close to the perimeter spacing (so triangles stay
   * well-shaped without an excessive count). Default 0.
   */
  radialSegments?: number;
};

/**
 * Build a round ocean box: a circular footprint when `size` is a single number
 * (or an equal `[width, height]` pair), or an oval/ellipse when width and height
 * differ. Returns the same three independent geometries as {@link createOceanBox}
 * (surface, body walls, sea bed).
 *
 * A rounded outline avoids the hard corners of a rectangular box, so a very
 * large body of water reads as endless / gently curving (like the curvature of
 * the earth) rather than a visibly cut rectangle.
 *
 * `size` is the diameter on each axis: `[width (X), height (Z)]` (a single
 * number means both). The footprint is `width/2` × `height/2` radii, centered on
 * `origin` and optionally spun by `rotation` degrees about +Y.
 *
 * Pair with `<Ocean>` by passing `geometry={box.surface}` plus
 * `bodyGeometry={box.body}` and `bedGeometry={box.bed}`.
 *
 * @group Geometries
 */
export function createOceanEllipseBox(
  options: OceanEllipseOptions = {},
): OceanBox {
  const [w, l] = asVec2(options.size, 100000);
  const [ox, oz] = options.origin ?? [0, 0];
  const rotation = options.rotation ?? 0;
  const waterDepth = options.waterDepth ?? 150;
  const depthVariation = options.depthVariation ?? 50;
  const seed = options.seed ?? 0;
  const perimeterSegments = Math.max(
    3,
    Math.floor(options.perimeterSegments ?? 96),
  );
  // Auto (default 0): pick the fewest rings that keep the radial step close to
  // the perimeter step, so triangles stay well-shaped without excess geometry.
  const radialSegments =
    options.radialSegments && options.radialSegments > 0
      ? Math.floor(options.radialSegments)
      : Math.max(1, Math.ceil(perimeterSegments / (2 * Math.PI)));

  const rx = Math.max(w / 2, 1e-6);
  const rz = Math.max(l / 2, 1e-6);
  const diamX = rx * 2;
  const diamZ = rz * 2;
  const minX = ox - rx;
  const minZ = oz - rz;

  // Reuse the rectangular box's procedural sea-bed model over the ellipse's
  // bounding box so the depth-variation look matches the other builders.
  const bedDepth = makeBedDepthFn(
    minX,
    minZ,
    diamX,
    diamZ,
    waterDepth,
    depthVariation,
    seed,
  );

  const eps = Math.min(rx, rz) / 1000;
  const bedNormal = (x: number, z: number): [number, number, number] => {
    const dx = (bedDepth(x + eps, z) - bedDepth(x - eps, z)) / (2 * eps);
    const dz = (bedDepth(x, z + eps) - bedDepth(x, z - eps)) / (2 * eps);
    // surface y = -bedDepth, so slope = -d(bedDepth); normal = (slopeX, 1, slopeZ)
    const inv = 1 / Math.hypot(dx, 1, dz);
    return [dx * inv, inv, dz * inv];
  };

  // Concentric-ring (polar) tessellation of the disc: a center vertex plus
  // `radialSegments` rings of `perimeterSegments` points each. UVs span the
  // bounding box so the world-space wave/tonal fields tile the same way as the
  // other builders.
  const buildRingMesh = (
    height: (x: number, z: number) => number,
    sloped: boolean,
  ): BufferGeometry => {
    const p: number[] = [];
    const n: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    const pushVert = (x: number, z: number) => {
      p.push(x, height(x, z), z);
      if (sloped) {
        const [nx, ny, nz] = bedNormal(x, z);
        n.push(nx, ny, nz);
      } else {
        n.push(0, 1, 0);
      }
      uv.push((x - minX) / diamX, (z - minZ) / diamZ);
    };
    pushVert(ox, oz); // center (vertex 0)
    for (let k = 1; k <= radialSegments; k++) {
      const f = k / radialSegments;
      for (let j = 0; j < perimeterSegments; j++) {
        const a = (j / perimeterSegments) * Math.PI * 2;
        pushVert(ox + rx * f * Math.cos(a), oz + rz * f * Math.sin(a));
      }
    }
    const ringStart = (k: number) => 1 + (k - 1) * perimeterSegments;
    // Inner fan: center -> ring 1. Winding chosen so the normal points +Y.
    for (let j = 0; j < perimeterSegments; j++) {
      const a = ringStart(1) + j;
      const b = ringStart(1) + ((j + 1) % perimeterSegments);
      idx.push(0, b, a);
    }
    // Ring-to-ring quads (winding => +Y).
    for (let k = 1; k < radialSegments; k++) {
      const cur = ringStart(k);
      const nxt = ringStart(k + 1);
      for (let j = 0; j < perimeterSegments; j++) {
        const jn = (j + 1) % perimeterSegments;
        const a = cur + j;
        const b = cur + jn;
        const c = nxt + j;
        const d = nxt + jn;
        idx.push(a, b, c, b, d, c);
      }
    }
    return createIndexedGeometry(p, n, uv, idx);
  };

  const surface = buildRingMesh(() => 0, false);
  // Bed sits at y = -depth; bedNormal already accounts for the negated height.
  const bed = buildRingMesh((x, z) => -bedDepth(x, z), true);

  // Body: a single smooth wall loop tracing the ellipse perimeter (outer ring),
  // from y = 0 down to the bed. The closed polyline yields outward-facing wall
  // normals via the shared edge-wall builder.
  const perimeter: Vec2[] = [];
  for (let j = 0; j <= perimeterSegments; j++) {
    const a = ((j % perimeterSegments) / perimeterSegments) * Math.PI * 2;
    perimeter.push([ox + rx * Math.cos(a), oz + rz * Math.sin(a)]);
  }
  const body = buildEdgeWalls([perimeter], bedDepth);

  rotateGeometryY(surface, rotation, [ox, oz]);
  rotateGeometryY(body, rotation, [ox, oz]);
  rotateGeometryY(bed, rotation, [ox, oz]);

  return { surface, body, bed };
}

/**
 * Header describing the regular grid of a depth surface (a subset of a
 * `SurfaceMeta` header). Distances are in world units (meters); `rot` is in
 * degrees, matching the surface data convention.
 */
export type SurfaceGridHeader = {
  /** Number of columns (samples along X). */
  nx: number;
  /** Number of rows (samples along Z). */
  ny: number;
  /** Column spacing in meters. */
  xinc: number;
  /** Row spacing in meters. */
  yinc: number;
  /** Grid rotation in degrees (about +Y), as stored in the surface header. */
  rot: number;
};

/** Options for {@link createOceanBoxFromSurface}. */
export type OceanBoxFromSurfaceOptions = {
  /** Value marking missing/hole samples in `values`. Default -1. */
  nullValue?: number;
  /**
   * Depth used to fill *internal* holes (invalid samples fully enclosed by
   * valid data) so the box stays watertight. Invalid samples connected to the
   * grid border are treated as outside the surface footprint (the outer rim)
   * and are left as holes, so the sea bed follows the true surface outline.
   * Defaults to the deepest (maximum) valid sample in `values`.
   */
  fillDepth?: number;
  /**
   * Reference depth (datum) of the input values, in meters. Surface grids are
   * often stored *depth-normalized* — e.g. as `referenceDepth - trueDepth` (the
   * convention used by this repo's IRAP parser, where `referenceDepth` is the
   * surface's maximum/deepest sample) — so the shallowest sample sits at 0
   * instead of its true depth below sea level. When set, the true positive-down
   * depth of each sample is recovered as `referenceDepth - value` before the bed
   * and walls are built, so the sea bed sits at its real depth (matching the
   * `Surface` component). Leave undefined when `values` already hold true,
   * positive-down depths (the bed is then built directly from them).
   */
  referenceDepth?: number;
  /**
   * Target water-surface tessellation (a single number for both axes, or
   * `[X, Z]`). The default `0` builds the surface from the same simplified
   * triangulation as the sea bed, flattened to `y = 0` — the fewest triangles
   * that still trace the surface outline (the waves are shaded per-pixel, so no
   * interior grid is needed). A positive value instead lays down a regular grid
   * at that density, clipped to and stitched to the exact data outline (which is
   * kept intact), so the interior is uniform — useful only when the surface is
   * vertex-displaced. The rim is shared with the walls and bed either way.
   * Default 0.
   */
  surfaceSegments?: number | Vec2;
  /** Sea-bed TIN simplification error (meters) passed to the triangulator. Default 5. */
  maxError?: number;
  /**
   * Optional rim smoothing strength. `0` (default) keeps the grid-aligned rim,
   * which can look pixelated since the surface follows a regular grid; `1`–`3`
   * progressively smooth it. The outline (rim) vertices of the water surface
   * and sea bed are filtered with a windowed moving average whose window grows
   * with this value, so long staircase runs collapse onto their straight centre
   * line and the rim reads as one continuous curve (rather than a chain of small
   * arcs). Only the X/Z position of the existing boundary vertices is moved —
   * their depth (Y), the sea-bed TIN and every interior vertex are left
   * untouched, so bathymetry detail (and the triangulator's efficiency) is
   * preserved.
   */
  rimSmoothing?: number;
};

/**
 * Build an ocean box whose sea bed is the bathymetry of a depth surface,
 * extracted (e.g. from an IRAP binary grid) as a row-major `Float32Array` plus
 * the grid `header`. The function is data-agnostic — it takes the raw values
 * and header, so it can be called from a generator or anywhere else.
 *
 * The result is positioned in the same local space as the `Surface` component
 * (the far row is centered on the rotation pivot and the grid is rotated by
 * `header.rot`; the world `xori`/`yori` origin is **not** baked in, so position
 * the resulting `<Ocean>` exactly as you would a `Surface`). Sea level is the
 * reference: the water surface lies at `y = 0` and the bed at `y = -depth`
 * (depths are positive-down).
 *
 * Invalid samples connected to the grid border are treated as the outer rim
 * (outside the surface footprint) and kept as holes, so the bed and walls
 * follow the true surface outline; invalid samples fully enclosed by valid data
 * are internal holes and get filled so the box stays watertight.
 *
 * - **surface** — flat water plane at `y = 0` tracing the same valid-region
 *   outline as the walls and bed (not a plain rectangle).
 * - **body** — walls tracing the outline of the valid region, from `y = 0`
 *   down to the bathymetry.
 * - **bed** — a simplified TIN of the (internal-hole-filled) bathymetry.
 *
 * Set `rimSmoothing` to relax the grid-aligned outline into a smooth, curved
 * rim by moving only the existing boundary vertices in place (the sea-bed TIN
 * and all interior detail are preserved).
 *
 * Set `referenceDepth` when the input grid is depth-normalized (e.g. stored as
 * `referenceDepth - trueDepth`, as produced by this repo's IRAP parser) so the
 * bed is placed at its true depth below sea level instead of being anchored to
 * the shallowest sample; leave it undefined when `values` already hold true,
 * positive-down depths.
 *
 * @group Geometries
 */
export function createOceanBoxFromSurface(
  values: Float32Array,
  header: SurfaceGridHeader,
  options: OceanBoxFromSurfaceOptions = {},
): OceanBox {
  const { nx, ny, xinc, yinc } = header;
  const nullValue = options.nullValue ?? -1;
  const referenceDepth = options.referenceDepth;
  const [segXf, segZf] = asVec2(options.surfaceSegments, 0);
  const maxError = options.maxError ?? 5;
  const smoothing = Math.max(0, Math.floor(options.rimSmoothing ?? 0));
  const isInvalid = (v: number) => v === nullValue || v < 0;

  // Recover the true positive-down depth of a sample. Depth-normalized grids are
  // stored as `referenceDepth - trueDepth`; when no reference is given the values
  // are assumed to already be true depths.
  const toTrueDepth = (v: number) =>
    referenceDepth !== undefined ? referenceDepth - v : v;

  // Fill internal holes with the deepest TRUE depth so the box stays watertight.
  // In the stored domain that is the largest value for true-depth input, or the
  // smallest value when the grid is reference-normalized (a larger stored value
  // then means a shallower true depth).
  let minV = Infinity;
  let maxV = -Infinity;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (isInvalid(v)) continue;
    if (v < minV) minV = v;
    if (v > maxV) maxV = v;
  }
  if (!Number.isFinite(maxV)) maxV = 0;
  if (!Number.isFinite(minV)) minV = 0;
  const fill =
    options.fillDepth ?? (referenceDepth !== undefined ? minV : maxV);

  // Classify invalid samples: those connected to the grid border are the outer
  // rim (outside the surface footprint) and stay holes; invalid samples fully
  // enclosed by valid data are internal holes and get filled.
  const external = floodFillExternalHoles(values, nx, ny, isInvalid);
  const filled = Float32Array.from(values, (v, i) =>
    external[i] ? nullValue : isInvalid(v) ? fill : v,
  );

  const W = (nx - 1) * xinc;
  const L = (ny - 1) * yinc;
  const rot = header.rot * (Math.PI / 180);

  // --- Sea bed: TIN of the (filled) bathymetry, y = -depth ------------------
  const tin = triangulateGridDelaunay(
    filled,
    nx,
    xinc,
    yinc,
    nullValue,
    maxError,
  );
  const bedPositions = tin.positions;
  for (let i = 1; i < bedPositions.length; i += 3) {
    // stored value -> true positive-down depth -> y-up
    bedPositions[i] = -toTrueDepth(bedPositions[i]);
  }
  const target = Math.max(segXf, segZf);

  // --- Sea bed (canonical mesh) --------------------------------------------
  // The TIN built above IS the canonical footprint: its boundary loops are the
  // single outline shared by the surface rim and the walls. Build it first,
  // relax its rim if requested, then derive the surface and walls from that
  // exact rim so all three meet vertex-for-vertex (watertight, no snapping).
  const bed = new BufferGeometry();
  bed.setAttribute('position', new BufferAttribute(bedPositions, 3));
  bed.setAttribute('uv', new BufferAttribute(tin.uvs, 2));
  bed.setIndex(new BufferAttribute(tin.indices, 1));
  const bedLoops = extractBoundaryLoops(bed);
  if (smoothing > 0) {
    smoothBoundaryLoops(bed, bedLoops, smoothing); // moves rim X/Z only
  }
  computeUpwardNormals(bed);

  // Canonical rim: bed boundary vertices (world X/Z plus their bed depth Y).
  const bpos = bed.getAttribute('position') as BufferAttribute;
  const rimLoops: [number, number, number][][] = bedLoops.map(loop => {
    const pts = loop.map(
      vi =>
        [bpos.getX(vi), bpos.getY(vi), bpos.getZ(vi)] as [
          number,
          number,
          number,
        ],
    );
    if (pts.length > 0) pts.push(pts[0]); // close the ring
    return pts;
  });

  // --- Water surface --------------------------------------------------------
  // Default (target 0): reuse the bed triangulation flattened to y = 0, so the
  // surface shares the bed's exact rim. A positive value instead lays a regular
  // grid clipped to (and stitched to) that same rim — a uniform interior for
  // vertex displacement that still keeps the original outline intact.
  let surface: BufferGeometry | null = null;
  if (target > 0) {
    const segX = Math.max(1, Math.floor(segXf || segZf));
    const segZ = Math.max(1, Math.floor(segZf || segXf));
    const rimCoords = groupRings(
      bedLoops.map(loop =>
        loop.map(vi => [bpos.getX(vi), -bpos.getZ(vi)] as Vec2),
      ),
    );
    surface = buildGriddedSurface(rimCoords, segX, segZ, 0, 0, W, L);
  }
  if (!surface) surface = flattenToSurface(bed);

  // --- Walls: extrude the shared rim from y = 0 down to the bed rim depth ----
  const body = buildWallsFromRim(rimLoops);

  // Match the Surface component's local space: center the far row on the
  // rotation pivot, then rotate by the header angle. Sea level stays at y = 0.
  for (const g of [surface, body, bed]) {
    g.translate(0, 0, -(ny - 1) * yinc);
    g.rotateY(rot);
    g.computeBoundingBox();
    g.computeBoundingSphere();
  }

  return { surface, body, bed };
}

/** Options for {@link createOceanBoxFromPolygon}. */
export type OceanBoxFromPolygonOptions = {
  /** Mean water depth in meters (bed sits at `y = -waterDepth` on average). Default 150. */
  waterDepth?: number;
  /** Sea-bed depth variation in meters (±) around {@link waterDepth}. Default 50. */
  depthVariation?: number;
  /** Seed for the procedural sea-bed variation. Default 0. */
  seed?: number;
  /**
   * Target water-surface tessellation (a single number for both axes, or
   * `[X, Z]`). The default `0` triangulates the footprint straight from its
   * outline (the fewest triangles that fill the shape — the waves are shaded
   * per-pixel). A positive value instead lays down a regular grid at that
   * density clipped to the outline, with a thin triangle band stitching the
   * grid to the exact outline — so the interior stays a uniform grid (only
   * deviating at the rim) for clean vertex displacement. Default 0.
   */
  surfaceSegments?: number | Vec2;
  /**
   * Target sea-bed tessellation (a single number for both axes, or `[X, Z]`).
   * The default lays a regular grid at this density clipped to and stitched to
   * the exact polygon outline, displaced to the procedural depth. It shares the
   * exact outline rim with the surface and walls (so the box stays watertight)
   * while resolving the bathymetry more finely than the flat surface. A value of
   * `0` triangulates the footprint straight from its outline instead. Default
   * 48.
   */
  bedSegments?: number | Vec2;
};

/**
 * Build an ocean box whose footprint matches a 2D polygon outline (e.g. a field
 * boundary parsed from GeoJSON). Supports multiple polygon rings, each with
 * zero or more holes. The polygon's `[x, y]` coordinates map to world
 * `(x, 0, -y)` — the same `rotateX(-PI/2)` convention used elsewhere — so the
 * northing axis becomes -Z.
 *
 * - **surface** — flat water plane at `y = 0`, tessellated to the outline.
 * - **body** — a vertical wall around every ring (outer boundaries and holes),
 *   from `y = 0` down to the bed.
 * - **bed** — the same outline tessellation displaced to a procedurally varying
 *   depth (reusing the {@link createOceanBox} sea-bed model).
 *
 * @group Geometries
 */
export function createOceanBoxFromPolygon(
  polygon: PlanarPolygonGeometry,
  options: OceanBoxFromPolygonOptions = {},
): OceanBox {
  const waterDepth = options.waterDepth ?? 150;
  const depthVariation = options.depthVariation ?? 50;
  const seed = options.seed ?? 0;
  const [ssx, ssz] = asVec2(options.surfaceSegments, 0);
  const [bsx, bsz] = asVec2(options.bedSegments, 48);

  // World XZ extent (coordinate (x, y) -> world (x, -y)).
  const [minPX, minPY] = polygon.min;
  const [maxPX, maxPY] = polygon.max;
  const minX = minPX;
  const w = Math.max(maxPX - minPX, 1e-6);
  const minZ = -maxPY;
  const l = Math.max(maxPY - minPY, 1e-6);
  const bedDepth = makeBedDepthFn(
    minX,
    minZ,
    w,
    l,
    waterDepth,
    depthVariation,
    seed,
  );

  const shapes = polygon.toShapes();
  const coordinates = polygon.coordinates as PlanarPolygonCoordinates;

  // --- Water surface --------------------------------------------------------
  // Triangulate the footprint straight from its outline (Earcut, exact outline
  // and holes, no dropped triangles for any topology), then refine the INTERIOR
  // for vertex-displacement detail while leaving the outline untouched. At
  // segments 0 this is just the outline triangulation — the fewest triangles
  // that fill the shape.
  const segX = Math.max(0, Math.floor(ssx));
  const segZ = Math.max(0, Math.floor(ssz));
  const surface = flatShapeSurface(
    shapes,
    refinementPasses(Math.max(segX, segZ)),
  );

  // --- Sea bed: the SAME outline triangulation, refined independently at
  //     `bedSegments` so the bathymetry can be resolved more finely than the
  //     flat surface. Interior-only refinement keeps the exact polygon outline
  //     on the boundary, so the surface, bed and wall rims stay identical
  //     vertex-for-vertex regardless of the refinement levels. ----------------
  const bedSegX = Math.max(0, Math.floor(bsx));
  const bedSegZ = Math.max(0, Math.floor(bsz));
  const bed = flatShapeSurface(
    shapes,
    refinementPasses(Math.max(bedSegX, bedSegZ)),
  );
  displaceBed(bed, bedDepth);
  computeUpwardNormals(bed);

  // --- Walls: extrude the exact polygon outline (every ring), which is shared
  //     vertex-for-vertex by both the surface and bed rims, from y = 0 down to
  //     the bed depth. No snapping is needed because all three boundaries are
  //     the same outline. ------------------------------------------------------
  const wallPolylines: Vec2[][] = [];
  for (const component of coordinates) {
    for (const ring of component) {
      const pl = ring.map(([x, y]) => [x, -y] as Vec2);
      if (pl.length > 0) pl.push(pl[0]); // close the ring
      wallPolylines.push(pl);
    }
  }
  const body = buildEdgeWalls(wallPolylines, bedDepth);

  return { surface, body, bed };
}

/**
 * Map a requested segment count to interior-refinement passes. Each pass roughly
 * halves the interior edge length (one outline triangle splits into up to four),
 * densifying the Earcut triangulation toward the requested resolution. The
 * footprint has no grid, so the mapping is approximate; 0 means no refinement.
 */
function refinementPasses(segments: number): number {
  if (segments <= 0) return 0;
  return Math.min(Math.max(Math.round(Math.log2(segments / 12)), 0), 5);
}

/**
 * Triangulate a polygon footprint straight from its outline (flat, y = 0).
 * Earcut reproduces the exact outline and holes for any topology without
 * dropping triangles; `passes` then refines the INTERIOR only (see
 * {@link refineInteriorEdges}), so the boundary — and its shared rim with the
 * walls and sea bed — is preserved exactly.
 */
function flatShapeSurface(shapes: Shape[], passes = 0): BufferGeometry {
  const surface = new ShapeGeometry(shapes);
  surface.rotateX(-Math.PI / 2); // XY -> XZ, normals -> +Y, (x, y) -> (x, -y)
  if (passes > 0) refineInteriorEdges(surface, passes);
  computePlanarXZUv(surface);
  computeUpwardNormals(surface);
  return surface;
}

/** Even-odd ray cast: is point (x, y) inside the 2D ring? */
function pointInRing(x: number, y: number, ring: Coordinates2D): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** Is point (x, y) inside the polygon (in any component, outside its holes)? */
function polygonContains(
  x: number,
  y: number,
  coordinates: PlanarPolygonCoordinates,
): boolean {
  for (const component of coordinates) {
    if (!pointInRing(x, y, component[0])) continue;
    let inHole = false;
    for (let r = 1; r < component.length; r++) {
      if (pointInRing(x, y, component[r])) {
        inHole = true;
        break;
      }
    }
    if (!inHole) return true;
  }
  return false;
}

/** Signed area of a 2D ring (positive for CCW). */
function ringSignedArea(ring: Coordinates2D): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return a / 2;
}

/** Centroid (average vertex) of a 2D ring. */
function ringCentroid(ring: Coordinates2D): Vec2 {
  let sx = 0;
  let sy = 0;
  for (const [x, y] of ring) {
    sx += x;
    sy += y;
  }
  return [sx / ring.length, sy / ring.length];
}

/** Merge flat (y = 0) geometries, welding vertices that share an X/Z cell. */
function mergeWeldFlat(geometries: BufferGeometry[]): BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  const map = new Map<string, number>();
  const key = (x: number, z: number) =>
    `${Math.round(x * 1e3)}_${Math.round(z * 1e3)}`;
  for (const g of geometries) {
    const pos = g.getAttribute('position') as BufferAttribute;
    const idx = g.getIndex();
    const local: number[] = [];
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const k = key(x, z);
      let vi = map.get(k);
      if (vi === undefined) {
        vi = positions.length / 3;
        map.set(k, vi);
        positions.push(x, y, z);
      }
      local.push(vi);
    }
    if (idx) {
      for (let i = 0; i < idx.count; i++) indices.push(local[idx.getX(i)]);
    } else {
      for (let i = 0; i < pos.count; i++) indices.push(local[i]);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    'position',
    new BufferAttribute(Float32Array.from(positions), 3),
  );
  const count = positions.length / 3;
  geometry.setIndex(
    new BufferAttribute(
      count <= 65536 ? Uint16Array.from(indices) : Uint32Array.from(indices),
      1,
    ),
  );
  return geometry;
}

/**
 * Build a flat water surface as a regular grid (segX x segZ over the footprint
 * bounding box) clipped to the outline, stitched to the exact outline rings by a
 * thin triangle band. The interior is therefore a uniform grid (good for vertex
 * displacement) that only deviates from the grid at the rim, and the boundary is
 * exactly the supplied outline (`coordinates`) so it can be shared with a sea bed
 * and walls. Returns `null` when the grid is empty at this resolution (caller
 * falls back to a plain outline triangulation).
 *
 * `coordinates` are in polygon space `(x, y)` mapping to world `(x, 0, -y)`,
 * `[component][ring][pt]` with ring 0 the outer contour and ring 1+ holes.
 */
function buildGriddedSurface(
  coordinates: PlanarPolygonCoordinates,
  segX: number,
  segZ: number,
  minX: number,
  minZ: number,
  w: number,
  l: number,
): BufferGeometry | null {
  const cellW = w / segX;
  const cellH = l / segZ;
  const nx = segX + 1;
  const ny = segZ + 1;

  // Regular grid, keeping cells whose four corners all lie inside the polygon.
  // The corner test is conservative: a vertex counts as inside only when it and
  // its four half-cell neighbours are all inside the footprint. This insets the
  // kept grid by ~half a cell from the outline, so no staircase edge can cut
  // across a concave part of the boundary. Otherwise such an edge — used as a
  // hole when stitching the band — would poke outside the outer contour and make
  // Earcut emit stray triangles across the rim (visible at some resolutions).
  const hx = cellW / 2;
  const hz = cellH / 2;
  const present = (c: number, r: number) => {
    const worldX = minX + c * cellW;
    const worldZ = minZ + r * cellH;
    return (
      polygonContains(worldX, -worldZ, coordinates) &&
      polygonContains(worldX - hx, -(worldZ - hz), coordinates) &&
      polygonContains(worldX + hx, -(worldZ - hz), coordinates) &&
      polygonContains(worldX - hx, -(worldZ + hz), coordinates) &&
      polygonContains(worldX + hx, -(worldZ + hz), coordinates)
    );
  };
  const grid = buildMaskedGridPlane(nx, ny, cellW, cellH, present, minX, minZ);
  const gridIndex = grid.getIndex();
  if (!gridIndex || gridIndex.count === 0) return null;

  // Grid boundary loops in polygon coordinate space (x, y) = (x, -z).
  const gp = grid.getAttribute('position') as BufferAttribute;
  const gridLoops: Coordinates2D[] = extractBoundaryLoops(grid).map(loop =>
    loop.map(vi => [gp.getX(vi), -gp.getZ(vi)] as Vec2),
  );
  if (gridLoops.length === 0) return null;

  // Classify every band boundary into contours (the band fills inside them) and
  // holes (the band is cut away inside them), then attach each hole to the
  // smallest contour that geometrically contains it. This single nesting pass is
  // robust to ANY grid topology — in particular it does not assume each polygon
  // hole is wrapped by its own grid "inner staircase". When two holes sit close
  // together (or a hole sits close to the rim) the masked grid between them is
  // removed and the grid-absent region merges or opens out to the grid's outer
  // boundary, so a hole may have NO surrounding grid ring at all. In that case
  // the polygon hole simply attaches to the polygon outer ring (alongside the
  // grid outer staircase) and Earcut still triangulates the region between the
  // grid edge and the hole correctly.
  //
  // The grid's outermost boundary has the largest |area|; loops sharing its
  // winding are grid OUTER staircases (the band lies outside them -> holes).
  // Loops of the opposite winding are grid INNER staircases around a hole (the
  // band lies inside them -> contours).
  const areas = gridLoops.map(ringSignedArea);
  let maxIdx = 0;
  for (let i = 1; i < areas.length; i++) {
    if (Math.abs(areas[i]) > Math.abs(areas[maxIdx])) maxIdx = i;
  }
  const outerSign = Math.sign(areas[maxIdx]) || 1;

  const toVecs = (ring: Coordinates2D) =>
    ring.map(([x, y]) => new Vector2(x, y));

  const contours: { ring: Coordinates2D; area: number }[] = [];
  const holeRings: Coordinates2D[] = [];

  // Polygon outline: outer rings are contours, holes are cut away.
  for (const component of coordinates) {
    contours.push({
      ring: component[0],
      area: Math.abs(ringSignedArea(component[0])),
    });
    for (let r = 1; r < component.length; r++) holeRings.push(component[r]);
  }
  // Grid staircases: outer-type are cut away (grid is drawn separately),
  // inner-type bound a grid hole that is part of the band.
  for (let i = 0; i < gridLoops.length; i++) {
    if (Math.sign(areas[i]) === outerSign) {
      holeRings.push(gridLoops[i]);
    } else {
      contours.push({ ring: gridLoops[i], area: Math.abs(areas[i]) });
    }
  }

  // Attach each hole to the smallest-area contour that contains it. All band
  // boundaries are strictly separated (the grid is conservatively inset from the
  // outline and holes never touch), so testing a single hole vertex is reliable.
  const bandShapes: Shape[] = contours.map(c => new Shape(toVecs(c.ring)));
  for (const hole of holeRings) {
    const [px, py] = hole[0];
    let best = -1;
    let bestArea = Infinity;
    for (let c = 0; c < contours.length; c++) {
      if (
        contours[c].area < bestArea &&
        pointInRing(px, py, contours[c].ring)
      ) {
        best = c;
        bestArea = contours[c].area;
      }
    }
    if (best >= 0) bandShapes[best].holes.push(new Path(toVecs(hole)));
  }

  const band = new ShapeGeometry(bandShapes);
  band.rotateX(-Math.PI / 2); // XY -> XZ, (x, y) -> (x, -y)

  const surface = mergeWeldFlat([grid, band]);
  computePlanarXZUv(surface);
  computeUpwardNormals(surface);
  return surface;
}

/**
 * Group a flat list of boundary rings (in polygon space `(x, y)`) into polygon
 * components — outer contours each followed by the holes directly nested inside
 * them — suitable for {@link buildGriddedSurface}. A ring is an outer contour
 * when it is not contained in any larger ring; otherwise it is attached as a
 * hole to the smallest outer ring that contains it (single-level nesting, which
 * covers the footprints produced by the sea-bed TIN).
 */
function groupRings(rings: Coordinates2D[]): PlanarPolygonCoordinates {
  const valid = rings.filter(r => r.length >= 3);
  const areas = valid.map(ringSignedArea);
  const centroids = valid.map(ringCentroid);
  const parentOf = (i: number) => {
    let best = -1;
    let bestArea = Infinity;
    for (let j = 0; j < valid.length; j++) {
      if (j === i || Math.abs(areas[j]) <= Math.abs(areas[i])) continue;
      if (!pointInRing(centroids[i][0], centroids[i][1], valid[j])) continue;
      if (Math.abs(areas[j]) < bestArea) {
        bestArea = Math.abs(areas[j]);
        best = j;
      }
    }
    return best;
  };
  const parent = valid.map((_, i) => parentOf(i));
  const components: PlanarPolygonCoordinates = [];
  const componentOf = new Map<number, number>();
  valid.forEach((ring, i) => {
    if (parent[i] === -1) {
      componentOf.set(i, components.length);
      components.push([ring]);
    }
  });
  valid.forEach((ring, i) => {
    if (parent[i] !== -1 && parent[parent[i]] === -1) {
      const ci = componentOf.get(parent[i]);
      if (ci !== undefined) components[ci].push(ring);
    }
  });
  return components;
}

/**
 * Build a flat water-surface geometry (y = 0, normal +Y) that shares the exact
 * X/Z topology of a sea-bed geometry, so the two meet along an identical rim.
 * Used for the zero-`surfaceSegments` case where the surface reuses the bed's
 * simplified triangulation flattened to sea level.
 */
function flattenToSurface(bed: BufferGeometry): BufferGeometry {
  const bpos = bed.getAttribute('position') as BufferAttribute;
  const sp = new Float32Array(bpos.count * 3);
  const sn = new Float32Array(bpos.count * 3);
  for (let i = 0; i < bpos.count; i++) {
    sp[i * 3] = bpos.getX(i);
    sp[i * 3 + 2] = bpos.getZ(i);
    sn[i * 3 + 1] = 1; // y stays 0, normal +Y
  }
  const surface = new BufferGeometry();
  surface.setAttribute('position', new BufferAttribute(sp, 3));
  surface.setAttribute('normal', new BufferAttribute(sn, 3));
  const buv = bed.getAttribute('uv') as BufferAttribute | undefined;
  if (buv) {
    surface.setAttribute(
      'uv',
      new BufferAttribute(Float32Array.from(buv.array as ArrayLike<number>), 2),
    );
  }
  const bidx = bed.getIndex();
  if (bidx) {
    surface.setIndex(
      new BufferAttribute(Uint32Array.from(bidx.array as ArrayLike<number>), 1),
    );
  }
  surface.computeBoundingBox();
  surface.computeBoundingSphere();
  return surface;
}

/**
 * Build vertical wall strips from rim loops given as explicit 3D vertices
 * `[x, yBottom, z]`. Each strip runs from the water surface (`y = 0`) down to the
 * supplied `yBottom`, so the wall top shares the surface rim and the wall bottom
 * shares the sea-bed rim vertex-for-vertex (watertight, no T-junctions). The
 * walls are paired with a double-sided volume material, so the per-segment normal
 * is a plain horizontal perpendicular (its sign is irrelevant for the fog tint).
 */
function buildWallsFromRim(
  loops: [number, number, number][][],
): BufferGeometry {
  const wp: number[] = [];
  const wn: number[] = [];
  const wuv: number[] = [];
  const wi: number[] = [];
  for (const pts of loops) {
    if (pts.length < 2) continue;
    const start = wp.length / 3;
    for (let i = 0; i < pts.length; i++) {
      const [x, yb, z] = pts[i];
      const t = i / (pts.length - 1);
      const p0 = pts[Math.max(0, i - 1)];
      const p1 = pts[Math.min(pts.length - 1, i + 1)];
      let tx = p1[0] - p0[0];
      let tz = p1[2] - p0[2];
      const tl = Math.hypot(tx, tz) || 1;
      tx /= tl;
      tz /= tl;
      const nx = tz; // horizontal perpendicular
      const nz = -tx;
      wp.push(x, 0, z);
      wn.push(nx, 0, nz);
      wuv.push(t, 1);
      wp.push(x, yb, z);
      wn.push(nx, 0, nz);
      wuv.push(t, 0);
    }
    for (let i = 0; i < pts.length - 1; i++) {
      const t0 = start + i * 2;
      const b0 = t0 + 1;
      const t1 = start + (i + 1) * 2;
      const b1 = t1 + 1;
      wi.push(t0, b0, t1, t1, b0, b1);
    }
  }
  return createIndexedGeometry(wp, wn, wuv, wi);
}

/**
 * Build vertical wall strips for a set of polylines (in world X/Z). Each strip
 * runs from the water surface (y = 0) down to `y = -depthAt(x, z)`. The walls
 * are paired with a double-sided volume material, so the per-segment normal is
 * a plain horizontal perpendicular (its sign is irrelevant for the fog tint).
 */
function buildEdgeWalls(
  edges: Vec2[][],
  depthAt: (x: number, z: number) => number,
): BufferGeometry {
  const wp: number[] = [];
  const wn: number[] = [];
  const wuv: number[] = [];
  const wi: number[] = [];
  for (const pts of edges) {
    if (pts.length < 2) continue;
    const start = wp.length / 3;
    for (let i = 0; i < pts.length; i++) {
      const [x, z] = pts[i];
      const t = i / (pts.length - 1);
      const p0 = pts[Math.max(0, i - 1)];
      const p1 = pts[Math.min(pts.length - 1, i + 1)];
      let tx = p1[0] - p0[0];
      let tz = p1[1] - p0[1];
      const tl = Math.hypot(tx, tz) || 1;
      tx /= tl;
      tz /= tl;
      const nx = tz; // horizontal perpendicular
      const nz = -tx;
      wp.push(x, 0, z);
      wn.push(nx, 0, nz);
      wuv.push(t, 1);
      wp.push(x, -depthAt(x, z), z);
      wn.push(nx, 0, nz);
      wuv.push(t, 0);
    }
    for (let i = 0; i < pts.length - 1; i++) {
      const t0 = start + i * 2;
      const b0 = t0 + 1;
      const t1 = start + (i + 1) * 2;
      const b1 = t1 + 1;
      wi.push(t0, b0, t1, t1, b0, b1);
    }
  }
  return createIndexedGeometry(wp, wn, wuv, wi);
}

/** Displace every vertex of a flat X/Z geometry to `y = -depthFn(x, z)`. */
function displaceBed(
  geometry: BufferGeometry,
  depthFn: (x: number, z: number) => number,
): void {
  const pos = geometry.getAttribute('position') as BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    pos.setY(i, -depthFn(pos.getX(i), pos.getZ(i)));
  }
  pos.needsUpdate = true;
}
