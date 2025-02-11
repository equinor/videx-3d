import { transfer } from 'comlink'
import { BufferAttribute, BufferGeometry } from 'three'
import { SurfaceTexturesResponse } from '../main'
import {
  elevationMapNormalsToRGBA,
  elevationMapToRGBA,
  limit,
  packBufferGeometry,
  PackedBufferGeometry,
  ReadonlyStore,
  SurfaceMeta,
  triangulateGridDelaunay,
} from '../sdk'


const nullValue = -1



export async function generateSurfaceTexturesData(
  this: ReadonlyStore,
  id: string,
) {
  const surface = await limit(() => this.get<SurfaceMeta>('surface-meta', id))

  if (!surface) return null

  const surfaceValues = await limit(() =>
    this.get<Float32Array>('surface-values', id)
  )
  if (!surfaceValues) return null

  const elevationImageBuffer = elevationMapToRGBA(surfaceValues, nullValue)

  const normalsImageBuffer = elevationMapNormalsToRGBA(
    surfaceValues,
    surface.header.nx,
    surface.header.xinc,
    surface.header.yinc,
    surface.header.rot,
    nullValue,
  )

  const response: SurfaceTexturesResponse = {
    elevationImageBuffer,
    normalsImageBuffer,
  }

  return transfer(response, [elevationImageBuffer.buffer, normalsImageBuffer.buffer])
}

export async function generateSurfaceGeometry(
  this: ReadonlyStore,
  id: string,
  maxError: number = 5,
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
  //geometry.computeVertexNormals()
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
