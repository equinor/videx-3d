import { BufferAttribute, BufferGeometry } from 'three';
import { Vec2 } from '../types/common';
import { Delatin } from './delatin';
import { computePlanarXZUv, computeUpwardNormals } from './geometry-attributes';
import { buildCrossingIndex } from './grid-inside';

/**
 * Options for {@link createDelaunayCap}.
 *
 * @group Geometries
 */
export type DelaunayCapOptions = {
  /** height of the plane (scene Y). Default 0. */
  y?: number;
  /**
   * Interior points the triangulation runs through, in scene X/Z. Points outside
   * the region, or on or right next to a ring, are left out, so the boundary stays
   * the rings' own.
   */
  points?: Vec2[];
};

// The region is triangulated in a normalised frame this many units across, so
// the row-bucketed inside test and Delatin's tolerances are independent of scale.
const FRAME = 2048;
// A point closer to a ring edge than this fraction of the edge's length would be
// taken onto it as a split (see Delatin `_onSegment`), so it is left out.
const RING_CLEARANCE = 0.02;
const EMPTY = new Float32Array(0);

/**
 * A flat, horizontal cap filling the region its `rings` enclose, by even-odd: a
 * ring inside another is a hole, one inside that an island again. Triangulated
 * constrained-Delaunay, through the optional interior `points`.
 *
 * Like {@link createPolygonCap}, its boundary is the rings' own vertices, vertex
 * for vertex, so walls built from the same rings stay sealed to it. Unlike it,
 * its triangles keep a good shape at any density, so `points` can grade it: fine
 * where something varies, coarse where nothing does.
 *
 * @param rings in scene X/Z, closed or open
 * @param options see {@link DelaunayCapOptions}
 *
 * @group Geometries
 */
export function createDelaunayCap(
  rings: Vec2[][],
  options: DelaunayCapOptions = {},
): BufferGeometry {
  const open = rings.map(openRing).filter(ring => ring.length >= 3);
  let x0 = Infinity;
  let z0 = Infinity;
  let x1 = -Infinity;
  let z1 = -Infinity;
  for (const ring of open) {
    for (const [x, z] of ring) {
      x0 = Math.min(x0, x);
      z0 = Math.min(z0, z);
      x1 = Math.max(x1, x);
      z1 = Math.max(z1, z);
    }
  }
  const scale = FRAME / Math.max(x1 - x0, z1 - z0);
  if (!Number.isFinite(scale)) return emptyGeometry();

  const toFrame = ([x, z]: Vec2): Vec2 => [(x - x0) * scale, (z - z0) * scale];
  const frameRings = open.map(ring => ring.map(toFrame));
  const inside = buildCrossingIndex(frameRings);
  const clear = createRingClearance(frameRings);

  // Padded, so every ring edge is an interior edge of the starting rectangle.
  const mesh = new Delatin(EMPTY, 1, -1, [
    -1,
    -1,
    (x1 - x0) * scale + 1,
    (z1 - z0) * scale + 1,
  ]);
  // Inserted vertices keep the coordinates they were given, not a round trip.
  const world: Vec2[] = [];
  const insert = (point: Vec2, at: Vec2) => {
    const v = mesh.insertPoint(at[0], at[1], 0);
    if (v >= 0 && !world[v]) world[v] = point;
    return v;
  };

  for (const point of options.points ?? []) {
    const at = toFrame(point);
    if (inside(at[0], at[1]) && clear(at[0], at[1])) insert(point, at);
  }
  open.forEach((ring, r) => {
    const verts: number[] = [];
    ring.forEach((point, i) => {
      const v = insert(point, frameRings[r][i]);
      if (v >= 0 && v !== verts[verts.length - 1]) verts.push(v);
    });
    if (verts.length > 1 && verts[0] === verts[verts.length - 1]) verts.pop();
    for (let i = 0; i < verts.length; i++) {
      mesh.constrainEdge(verts[i], verts[(i + 1) % verts.length]);
    }
  });
  mesh.removeExteriorTriangles(inside);

  const triangles = mesh.triangles;
  const remap = new Int32Array(mesh.coords.length >> 1).fill(-1);
  const positions: number[] = [];
  const index: number[] = [];
  const y = options.y ?? 0;
  for (let i = 0; i < triangles.length; i += 3) {
    const corners = [triangles[i], triangles[i + 1], triangles[i + 2]];
    // Only a ring that crosses itself leaves the padding's corners in the region.
    if (corners.some(v => !world[v])) continue;
    for (const v of corners) {
      if (remap[v] < 0) {
        remap[v] = positions.length / 3;
        positions.push(world[v][0], y, world[v][1]);
      }
      index.push(remap[v]);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute(
    'position',
    new BufferAttribute(new Float32Array(positions), 3),
  );
  geometry.setIndex(
    new BufferAttribute(
      positions.length / 3 <= 65536
        ? Uint16Array.from(index)
        : Uint32Array.from(index),
      1,
    ),
  );
  computePlanarXZUv(geometry);
  computeUpwardNormals(geometry);
  return geometry;
}

function openRing(ring: Vec2[]): Vec2[] {
  const n = ring.length;
  if (n > 1 && ring[0][0] === ring[n - 1][0] && ring[0][1] === ring[n - 1][1]) {
    return ring.slice(0, n - 1);
  }
  return ring;
}

function emptyGeometry() {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    'position',
    new BufferAttribute(new Float32Array(0), 3),
  );
  geometry.setIndex([]);
  return geometry;
}

// Whether a point in the frame keeps clear of every ring edge (see RING_CLEARANCE).
function createRingClearance(rings: Vec2[][]) {
  const cell = FRAME / 64;
  // A margin of cells on every side holds the clearance of the longest edges.
  const margin = 3;
  const columns = 64 + 2 * margin;
  const buckets = new Map<number, number[]>();
  const segments: number[] = [];
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const [ax, az] = ring[i];
      const [bx, bz] = ring[(i + 1) % ring.length];
      const s = segments.length / 4;
      segments.push(ax, az, bx, bz);
      const reach = RING_CLEARANCE * Math.hypot(bx - ax, bz - az);
      const c0 = Math.floor((Math.min(ax, bx) - reach) / cell) + margin;
      const c1 = Math.floor((Math.max(ax, bx) + reach) / cell) + margin;
      const r0 = Math.floor((Math.min(az, bz) - reach) / cell) + margin;
      const r1 = Math.floor((Math.max(az, bz) + reach) / cell) + margin;
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const key = r * columns + c;
          const bucket = buckets.get(key);
          if (bucket) bucket.push(s);
          else buckets.set(key, [s]);
        }
      }
    }
  }
  return (x: number, z: number) => {
    const key =
      (Math.floor(z / cell) + margin) * columns + Math.floor(x / cell) + margin;
    for (const s of buckets.get(key) ?? []) {
      const ax = segments[4 * s];
      const az = segments[4 * s + 1];
      const dx = segments[4 * s + 2] - ax;
      const dz = segments[4 * s + 3] - az;
      const length2 = dx * dx + dz * dz;
      const t =
        length2 > 0
          ? Math.min(Math.max(((x - ax) * dx + (z - az) * dz) / length2, 0), 1)
          : 0;
      const ex = ax + t * dx - x;
      const ez = az + t * dz - z;
      if (ex * ex + ez * ez < RING_CLEARANCE * RING_CLEARANCE * length2) {
        return false;
      }
    }
    return true;
  };
}
