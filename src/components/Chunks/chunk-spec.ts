import {
  PlanarPolygonCoordinates,
  PlanarPolygonGeometry,
  SurfaceChunkBasement,
  SurfaceMeta,
  Vec2,
  Vec3,
} from '../../sdk';
import {
  ChunkLayer,
  ChunkResolveOptions,
  hasFill,
  SurfaceChunkSpec,
} from './chunk-defs';

/** UTM -> scene-frame mapping (matches `UtmArea`'s `utmToArea`). */
type UtmToArea = (easting: number, northing: number, altitude?: number) => Vec3;

/** Build parameters carried into a {@link SurfaceChunkSpec}. */
export type BuildSurfaceChunkSpecOptions = {
  rimSpacing?: number;
  maxError?: number;
  resolve?: ChunkResolveOptions;
  basement?: SurfaceChunkBasement;
  /**
   * The column this chunk is cut from (see `ChunkStack.surfaces`) plus the
   * envelope footprint it is resolved over. Both are needed for the shared build.
   */
  stack?: { surfaces: SurfaceMeta[]; envelope: PlanarPolygonGeometry };
  /**
   * Outline of the chunk drawn directly above this one (see
   * `SurfaceChunkSpec.coverAbove`).
   */
  coverAbove?: PlanarPolygonGeometry | null;
};

/** Map one surface's meta into the serializable layer spec. */
function toLayerSpec(meta: SurfaceMeta, utmToArea: UtmToArea) {
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
}

/**
 * Build the serializable {@link SurfaceChunkSpec} for the `surfaceChunk` generator
 * from the main-thread inputs: the ordered `layers` (each a surface plus whether
 * the interval below it is filled), the UTM->scene mapping (for each surface's
 * world placement), the resolved outline polygon, and the build options.
 *
 * Materials are NOT part of the spec — they are appearance, and including them
 * would make recolouring rebuild the geometry.
 */
export function buildSurfaceChunkSpec(
  layers: ChunkLayer[],
  utmToArea: UtmToArea,
  outlinePolygon: PlanarPolygonGeometry,
  options: BuildSurfaceChunkSpecOptions = {},
): SurfaceChunkSpec {
  const specLayers = layers.map(layer =>
    layer.surface
      ? {
          ...toLayerSpec(layer.surface, utmToArea),
          fill: hasFill(layer.fill),
          cap: layer.cap !== false,
          optional: layer.optional === true,
        }
      : {
          depth: layer.depth,
          offset: layer.offset,
          relief: layer.relief,
          fill: hasFill(layer.fill),
          cap: layer.cap !== false,
          optional: layer.optional === true,
        },
  );

  const stack = options.stack
    ? {
        layers: options.stack.surfaces.map(meta =>
          toLayerSpec(meta, utmToArea),
        ),
        polygon: {
          coordinates: options.stack.envelope
            .coordinates as PlanarPolygonCoordinates,
          offset: options.stack.envelope.offset,
        },
        // Identity of the column: the ordered surface ids are what decide both the
        // common grid and the resolve, so chunks of the same column share a key.
        key: options.stack.surfaces.map(m => m.id).join(','),
      }
    : undefined;

  return {
    layers: specLayers,
    polygon: {
      coordinates: outlinePolygon.coordinates as PlanarPolygonCoordinates,
      offset: outlinePolygon.offset,
    },
    stack,
    coverAbove: options.coverAbove
      ? {
          coordinates: options.coverAbove
            .coordinates as PlanarPolygonCoordinates,
          offset: options.coverAbove.offset,
        }
      : undefined,
    rimSpacing: options.rimSpacing,
    maxError: options.maxError,
    resolve: options.resolve,
    basement: options.basement,
  };
}
