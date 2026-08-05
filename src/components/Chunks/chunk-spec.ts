import {
  DepthOrderOptions,
  PlanarPolygonCoordinates,
  PlanarPolygonGeometry,
  SurfaceChunkBasement,
  SurfaceMeta,
  Vec2,
  Vec3,
} from '../../sdk';
import { SurfaceChunkSpec } from './chunk-defs';

/** UTM -> scene-frame mapping (matches `UtmArea`'s `utmToArea`). */
type UtmToArea = (easting: number, northing: number, altitude?: number) => Vec3;

/** Build parameters carried into a {@link SurfaceChunkSpec}. */
export type BuildSurfaceChunkSpecOptions = {
  rimSpacing?: number;
  maxError?: number;
  clamp?: boolean;
  depthOrder?: DepthOrderOptions;
  basement?: SurfaceChunkBasement;
};

/**
 * Build the serializable {@link SurfaceChunkSpec} for the `surfaceChunk` generator
 * from the main-thread inputs: the grouped surface `meta`, the UTM->scene mapping
 * (for each surface's world placement), the colour palette, the resolved outline
 * polygon, and the build options. The grid values are intentionally left out — the
 * worker fetches them by surface id.
 */
export function buildSurfaceChunkSpec(
  groups: SurfaceMeta[][],
  utmToArea: UtmToArea,
  colors: string[],
  outlinePolygon: PlanarPolygonGeometry,
  options: BuildSurfaceChunkSpecOptions = {},
): SurfaceChunkSpec {
  const specGroups = groups.map(group =>
    group.map(meta => {
      const p = utmToArea(meta.header.xori, meta.header.yori, 0);
      return {
        id: meta.id,
        header: {
          nx: meta.header.nx,
          ny: meta.header.ny,
          xinc: meta.header.xinc,
          yinc: meta.header.yinc,
          rot: meta.header.rot,
        },
        referenceDepth: meta.max,
        worldPosition: [p[0], p[2]] as Vec2,
      };
    }),
  );

  return {
    groups: specGroups,
    colors,
    polygon: {
      coordinates: outlinePolygon.coordinates as PlanarPolygonCoordinates,
      offset: outlinePolygon.offset,
    },
    rimSpacing: options.rimSpacing,
    maxError: options.maxError,
    clamp: options.clamp,
    depthOrder: options.depthOrder,
    basement: options.basement,
  };
}
