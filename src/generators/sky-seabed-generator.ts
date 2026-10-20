import { transfer } from 'comlink';
import type { SkySeabedResponse } from '../components/Sky/sky-defs';
import { ReadonlyStore, SurfaceMeta, Vec2 } from '../sdk';
import {
  PlanarPolygonCoordinates,
  PlanarPolygonGeometry,
} from '../sdk/geometries/planar-geometry';
import { createSeabedMesh } from '../sdk/geometries/surface-clip';

/**
 * A surface clipped to an occupant's outline, as a `SkyBoxStage` takes the occupant's
 * seabed (see `createSeabedMesh`). The grid is read from the store where the generator
 * runs, so only the mesh reaches the caller.
 *
 * @param id the surface
 * @param outline the occupant's outline, in scene XZ
 * @param worldPosition scene XZ of the surface's grid origin (`xori`, `yori`)
 * @param maxError the occupant's own, so the two tessellations agree within it
 */
export async function generateSkySeabed(
  this: ReadonlyStore,
  id: string,
  outline: PlanarPolygonCoordinates,
  worldPosition: Vec2,
  maxError?: number,
): Promise<SkySeabedResponse> {
  const meta = await this.get<SurfaceMeta>('surface-meta', id);
  if (!meta) return null;
  const values = await this.get<Float32Array>('surface-values', id);
  if (!values) return null;
  const mesh = createSeabedMesh(values, meta.header, {
    polygon: new PlanarPolygonGeometry(outline),
    referenceDepth: meta.max,
    worldPosition,
    maxError,
  });
  if (!mesh) return null;
  return transfer(mesh, [mesh.positions.buffer, mesh.indices.buffer]);
}
