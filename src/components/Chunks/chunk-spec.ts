import {
  PlanarPolygonCoordinates,
  PlanarPolygonGeometry,
  StackCarrier,
  SurfaceChunkBasement,
  SurfaceMeta,
  Vec2,
  Vec3,
} from '../../sdk';
import {
  ChunkLayer,
  ChunkResolveOptions,
  hasFill,
  SurfaceChunkCut,
  SurfaceChunkSpec,
  SurfaceChunkSpecLayer,
} from './chunk-defs';
import { SeamDecision } from './seams';

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
   * The flat floor the column terminates against (see `ChunkStackProps.carrier`).
   * Without it, a `{ carrier: true }` layer has nothing to draw and is dropped.
   */
  carrier?: StackCarrier;
  /**
   * Outline of the chunk drawn directly above this one (see
   * `SurfaceChunkSpec.coverAbove`).
   */
  coverAbove?: PlanarPolygonGeometry | null;
  /**
   * Per layer, what this chunk draws of a horizon it shares with a neighbour (see
   * `resolveSeam`). Omit for a chunk that shares nothing.
   */
  seams?: (SeamDecision | null)[];
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
  // A chunk that partly overlaps several neighbours references each of their
  // footprints once, by index.
  const cuts: SurfaceChunkCut[] = [];
  const cutIndex = new Map<PlanarPolygonGeometry, number>();
  const indexOfCut = (polygon: PlanarPolygonGeometry, rimSpacing?: number) => {
    const seen = cutIndex.get(polygon);
    if (seen !== undefined) return seen;
    const at = cuts.length;
    cuts.push({
      coordinates: polygon.coordinates as PlanarPolygonCoordinates,
      offset: polygon.offset,
      rimSpacing,
    });
    cutIndex.set(polygon, at);
    return at;
  };

  const specLayers: SurfaceChunkSpecLayer[] = layers.map((layer, i) => {
    const seam = options.seams?.[i] ?? null;
    const shared = {
      fill: hasFill(layer.fill),
      cap: seam ? seam.draw : true,
      capCuts: seam?.cuts.length
        ? seam.cuts.map(cut => indexOfCut(cut.polygon, cut.rimSpacing))
        : undefined,
    };
    if (layer.carrier) {
      // The plane itself comes from the column, so the layer carries no geometry
      // of its own — only that it is the one drawing the floor.
      return { carrier: true, ...shared, fill: false };
    }
    return layer.surface
      ? { ...toLayerSpec(layer.surface, utmToArea), ...shared }
      : {
          depth: layer.depth,
          offset: layer.offset,
          relief: layer.relief,
          ...shared,
        };
  });

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
        carrier: options.carrier,
        // Identity of the column: the ordered surface ids are what decide both the
        // common grid and the resolve, so chunks of the same column share a key.
        // The carrier joins them — it terminates the column, so moving it changes
        // every chunk cut from it.
        key: `${options.stack.surfaces.map(m => m.id).join(',')}|${
          options.carrier
            ? `${options.carrier.depth ?? ''}/${options.carrier.below ?? ''}`
            : ''
        }`,
      }
    : undefined;

  return {
    layers: specLayers.filter(layer => !layer.carrier || options.carrier),
    polygon: {
      coordinates: outlinePolygon.coordinates as PlanarPolygonCoordinates,
      offset: outlinePolygon.offset,
    },
    stack,
    carrier: options.carrier,
    cuts: cuts.length > 0 ? cuts : undefined,
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
