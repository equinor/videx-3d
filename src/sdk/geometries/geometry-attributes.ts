import { BufferAttribute, BufferGeometry } from 'three';
import { Vec2 } from '../types/common';

/**
 * Assemble an indexed {@link BufferGeometry} from flat `position`, `normal` and
 * `uv` arrays plus a triangle index list. The index buffer is automatically
 * `Uint16Array` or `Uint32Array` depending on the vertex count, and bounding
 * volumes are computed. Optional draw `groups` (`[start, count, materialIndex]`)
 * may be supplied for multi-material meshes.
 *
 * @group Geometries
 */
export function createIndexedGeometry(
  positions: ArrayLike<number>,
  normals: ArrayLike<number>,
  uvs: ArrayLike<number>,
  indices: ArrayLike<number>,
  groups?: number[][] | null,
): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    'position',
    new BufferAttribute(Float32Array.from(positions), 3),
  );
  geometry.setAttribute(
    'normal',
    new BufferAttribute(Float32Array.from(normals), 3),
  );
  geometry.setAttribute('uv', new BufferAttribute(Float32Array.from(uvs), 2));
  const index =
    positions.length / 3 < 65535
      ? Uint16Array.from(indices)
      : Uint32Array.from(indices);
  geometry.setIndex(new BufferAttribute(index, 1));
  if (groups) {
    for (const g of groups) geometry.addGroup(g[0], g[1], g[2]);
  }
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * Rotate a geometry about the +Y axis by `degrees`, pivoting around `origin`
 * (world X/Z, default `[0, 0]`). Both the position and normal attributes are
 * rotated. A no-op when `degrees` is 0. Bounding volumes are refreshed.
 *
 * @group Geometries
 */
export function rotateGeometryY(
  geometry: BufferGeometry,
  degrees: number,
  origin: Vec2 = [0, 0],
): void {
  if (!degrees) return;
  const rad = (degrees * Math.PI) / 180;
  const [ox, oz] = origin;
  const offset = ox !== 0 || oz !== 0;
  if (offset) geometry.translate(-ox, 0, -oz);
  geometry.rotateY(rad);
  if (offset) geometry.translate(ox, 0, oz);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
}

/**
 * Set per-vertex UVs in `[0, 1]` from the X/Z bounding box of the geometry,
 * giving a planar projection onto the world X/Z plane (suitable for flat or
 * near-flat meshes such as terrain, water and ground planes).
 *
 * @group Geometries
 */
export function computePlanarXZUv(geometry: BufferGeometry): void {
  const pos = geometry.getAttribute('position') as BufferAttribute;
  let minx = Infinity;
  let minz = Infinity;
  let maxx = -Infinity;
  let maxz = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    if (x < minx) minx = x;
    if (x > maxx) maxx = x;
    if (z < minz) minz = z;
    if (z > maxz) maxz = z;
  }
  const dx = maxx - minx || 1;
  const dz = maxz - minz || 1;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = (pos.getX(i) - minx) / dx;
    uv[i * 2 + 1] = (pos.getZ(i) - minz) / dz;
  }
  geometry.setAttribute('uv', new BufferAttribute(uv, 2));
}

/**
 * Compute smooth vertex normals and ensure they point up (+Y). After a height
 * field is mirrored through `y = 0` or comes from an arbitrary triangulation the
 * winding may yield downward normals; if so the index winding is reversed and
 * the normals recomputed. Bounding volumes are refreshed.
 *
 * @group Geometries
 */
export function computeUpwardNormals(geometry: BufferGeometry): void {
  geometry.computeVertexNormals();
  const n = geometry.getAttribute('normal') as BufferAttribute;
  let sy = 0;
  for (let i = 0; i < n.count; i++) sy += n.getY(i);
  if (sy < 0) {
    const index = geometry.getIndex();
    if (index) {
      const arr = index.array as Uint16Array | Uint32Array;
      for (let i = 0; i + 2 < arr.length; i += 3) {
        const t = arr[i + 1];
        arr[i + 1] = arr[i + 2];
        arr[i + 2] = t;
      }
      index.needsUpdate = true;
    }
    geometry.computeVertexNormals();
  }
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
}
