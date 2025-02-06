import { transfer } from 'comlink'
import { BufferAttribute, BufferGeometry } from 'three'
import {
  limit,
  packBufferGeometry,
  PackedBufferGeometry,
  ReadonlyStore,
  SurfaceMeta,
  triangulateGridDelaunay,
} from '../sdk'

const nullValue = -1

export async function generateSurfaceGeometry(
  this: ReadonlyStore,
  id: string,
  maxError: number = 5
): Promise<PackedBufferGeometry | null> {
  const surface = await limit(() => this.get<SurfaceMeta>('surface-meta', id))

  if (!surface) return null

  const refDepth = surface.max
  const surfaceValues = await limit(() =>
    this.get<Float32Array>('surface-values', id)
  )

  if (!surfaceValues) return null

  const { header } = surface

  const geometry = new BufferGeometry()

  // const triangulation = triangulateGrid(surfaceValues, header.nx, header.xinc, header.yinc, v => v === nullValue ? null : v);
  // const positions = new Float32Array(triangulation.vertices.length * 3);
  // for (let i = 0; i < triangulation.vertices.length; i++) {
  //   const pi = i * 3;
  //   positions[pi] = triangulation.vertices[i].x;
  //   positions[pi + 1] = triangulation.vertices[i].y;
  //   positions[pi + 2] = triangulation.vertices[i].z;
  // }

  // geometry.setAttribute('position', new BufferAttribute(positions, 3));
  // geometry.setAttribute('uv', new BufferAttribute(new Float32Array(triangulation.uvs), 2));
  // geometry.setIndex(new BufferAttribute(new Uint32Array(triangulation.indices), 1));

  const { positions, uvs, indices } = triangulateGridDelaunay(
    surfaceValues,
    header.nx,
    header.xinc,
    header.yinc,
    nullValue,
    maxError
  )
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new BufferAttribute(uvs, 2))
  geometry.setIndex(new BufferAttribute(indices, 1))

  // const normals = new Float32Array(positions.length)
  // for (let i = 0; i < normals.length; i+=3) {
  //   normals[i] = 0
  //   normals[i + 1] = 1
  //   normals[i + 2] = 0
  // }
  // geometry.setAttribute('normal', new BufferAttribute(normals, 3))
  geometry.computeVertexNormals()
  //geometry.computeTangents();

  // move the surface with its bottom-left to the center (center of rotation)

  geometry.translate(0, 0, -header.ny * header.yinc)
  // rotate according to rotation angle from surface header
  geometry.rotateY(header.rot * (Math.PI / 180))
  // offset the surface according to where the xori and yori is in world coordinates
  geometry.translate(0, -refDepth, 0)

  const [packed, buffers] = packBufferGeometry(geometry)

  return transfer(packed, buffers)
}
