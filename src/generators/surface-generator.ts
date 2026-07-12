import { transfer } from 'comlink';
import { BufferAttribute, BufferGeometry } from 'three';
import { SurfaceTexturesResponse } from '../main';
import {
  computeSurfaceNormalsRG,
  packBufferGeometry,
  PackedBufferGeometry,
  ReadonlyStore,
  SurfaceMeta,
  triangulateGridConstrained,
} from '../sdk';

const nullValue = -1;

export async function generateSurfaceTexturesData(
  this: ReadonlyStore,
  id: string,
  computeNormals: boolean = false,
) {
  const surface = await this.get<SurfaceMeta>('surface-meta', id);

  if (!surface) return null;

  const surfaceValues = await this.get<Float32Array>('surface-values', id);

  if (!surfaceValues) return null;

  const elevationImageBuffer = surfaceValues;

  const { header } = surface;

  const response: SurfaceTexturesResponse = {
    elevationImageBuffer,
  };

  const transferables: Transferable[] = [elevationImageBuffer.buffer];

  // Geometric normals (RG8) are only computed and transferred when the consumer
  // opts in (Surface `precomputeNormals`). They let the surface shader skip the
  // per-fragment normal recompute that the OITRenderPass would otherwise pay
  // multiple times per frame, at the cost of a little texture memory.
  if (computeNormals) {
    const normalImageBuffer = computeSurfaceNormalsRG(
      surfaceValues,
      header.nx,
      header.ny,
      header.xinc,
      header.yinc,
    );
    response.normalImageBuffer = normalImageBuffer;
    transferables.push(normalImageBuffer.buffer);
  }

  return transfer(response, transferables);
}

export async function generateSurfaceGeometry(
  this: ReadonlyStore,
  id: string,
  maxError: number = 5,
  cutHoles: boolean = true,
  edgeSmoothing: number = 0,
): Promise<PackedBufferGeometry | null> {
  const surface = await this.get<SurfaceMeta>('surface-meta', id);

  if (!surface) return null;

  const refDepth = surface.max;
  const surfaceValues = await this.get<Float32Array>('surface-values', id);

  if (!surfaceValues) return null;

  const { header } = surface;

  const geometry = new BufferGeometry();

  // Constrained Delaunay: no-data holes and the outer data extent are cut with a
  // clean traced rim (cutHoles) instead of the ragged drop-invalid-triangles
  // staircase; set cutHoles=false to fill holes from valid neighbours instead.
  // edgeSmoothing (>0) relaxes the traced rim into a continuous curve.
  const { positions, uvs, indices } = triangulateGridConstrained(
    surfaceValues,
    header.nx,
    header.xinc,
    header.yinc,
    nullValue,
    maxError,
    [],
    false,
    cutHoles,
    edgeSmoothing,
  );
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new BufferAttribute(uvs, 2));
  geometry.setIndex(new BufferAttribute(indices, 1));
  //geometry.computeVertexNormals()
  //geometry.computeTangents();

  // move the surface with its bottom-left to the center (center of rotation)
  geometry.translate(0, 0, -(header.ny - 1) * header.yinc);
  // rotate according to rotation angle from surface header
  geometry.rotateY(header.rot * (Math.PI / 180));
  // offset the surface according to where the xori and yori is in world coordinates
  geometry.translate(0, -refDepth, 0);

  const [packed, buffers] = packBufferGeometry(geometry);

  return transfer(packed, buffers);
}
