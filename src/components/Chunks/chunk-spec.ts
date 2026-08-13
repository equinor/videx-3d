import {
  PlanarPolygonCoordinates,
  PlanarPolygonGeometry,
  StackCarrier,
  SurfaceMeta,
  Vec2,
  Vec3,
} from '../../sdk';
import {
  ChunkCarrier,
  ChunkLayer,
  chunkLayerFill,
  ChunkResolveOptions,
  DEFAULT_WATER_RESOLUTION,
  StackWater,
  StackWaterSpec,
  SurfaceChunkCut,
  SurfaceChunkSpec,
  SurfaceChunkSpecLayer,
  SurfaceChunkStackSpec,
} from './chunk-defs';
import { SeamDecision } from './seams';

/** UTM -> scene-frame mapping (matches `UtmArea`'s `utmToArea`). */
type UtmToArea = (easting: number, northing: number, altitude?: number) => Vec3;

/** Build parameters carried into a {@link SurfaceChunkSpec}. */
export type BuildSurfaceChunkSpecOptions = {
  rimSpacing?: number;
  maxError?: number;
  resolve?: ChunkResolveOptions;
  /**
   * The column this chunk is cut from (see `ChunkStack.surfaces`) plus the
   * envelope footprint it is resolved over. Both are needed for the shared build.
   */
  stack?: { surfaces: SurfaceMeta[]; envelope: PlanarPolygonGeometry };
  /**
   * The flat floor the column terminates against (see `ChunkStackProps.carrier`).
   * Without it, a fill on the chunk's last layer has nothing to close it and is
   * ignored, exactly as it was before there was a carrier at all.
   */
  carrier?: ChunkCarrier;
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
  /**
   * The same, for the column's floor — separate because the carrier layer is
   * INFERRED here rather than declared, so it has no index in `seams`.
   */
  carrierSeam?: SeamDecision | null;
  /** ask the build for the section channels (see `SurfaceChunkSpec.section`) */
  section?: boolean;
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
 * The carrier as the WORKER sees it — where the plane is, and nothing else.
 *
 * ⚠️ The caller's `material` must not travel: a `Material` cannot be structured-
 * cloned across the worker boundary, and appearance in a build spec would make
 * recolouring rebuild the geometry.
 */
function carrierSpec(carrier?: ChunkCarrier): StackCarrier | undefined {
  return carrier ? { depth: carrier.depth, below: carrier.below } : undefined;
}

/**
 * The column, as the generator's shared-build spec.
 *
 * ⚠⚠ The `key` is the identity of the CACHED column, and the cache holds exactly
 * one. Everything built from the same column — every chunk, and the sea — must
 * derive it HERE, or two of them ask for the same column under different names and
 * evict each other, paying for the fetch, the resample and the resolve twice.
 *
 * The ordered surface ids decide both the common grid and the resolve; the carrier
 * joins them because it terminates the column.
 */
export function stackColumnSpec(
  surfaces: SurfaceMeta[],
  envelope: PlanarPolygonGeometry,
  utmToArea: UtmToArea,
  carrier?: ChunkCarrier,
): SurfaceChunkStackSpec {
  return {
    layers: surfaces.map(meta => toLayerSpec(meta, utmToArea)),
    polygon: {
      coordinates: envelope.coordinates as PlanarPolygonCoordinates,
      offset: envelope.offset,
    },
    carrier: carrierSpec(carrier),
    key: `${surfaces.map(m => m.id).join(',')}|${
      carrier ? `${carrier.depth ?? ''}/${carrier.below ?? ''}` : ''
    }`,
  };
}

/**
 * Build the serializable {@link StackWaterSpec} for the `stackWater` generator.
 *
 * The sea is the COLUMN's, so it is built from the same column spec the chunks
 * use: its bed is that column's shallowest surface, on the same channels.
 */
export function buildStackWaterSpec(
  water: StackWater,
  utmToArea: UtmToArea,
  outlinePolygon: PlanarPolygonGeometry,
  options: {
    surfaces: SurfaceMeta[];
    envelope: PlanarPolygonGeometry;
    carrier?: ChunkCarrier;
    rimSpacing?: number;
    maxError?: number;
    resolve?: ChunkResolveOptions;
  },
): StackWaterSpec {
  return {
    polygon: {
      coordinates: outlinePolygon.coordinates as PlanarPolygonCoordinates,
      offset: outlinePolygon.offset,
    },
    depth: water.depth ?? 0,
    // A flat lid is shaded per pixel and needs nothing but the outline; only
    // displaced vertices need something to displace.
    resolution:
      water.resolution ??
      (water.displacement ? DEFAULT_WATER_RESOLUTION : undefined),
    rimSpacing: options.rimSpacing,
    maxError: options.maxError,
    stack: stackColumnSpec(
      options.surfaces,
      options.envelope,
      utmToArea,
      options.carrier,
    ),
    resolve: options.resolve,
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
      fill: chunkLayerFill(layer),
      cap: seam ? seam.draw : true,
      capCuts: seam?.cuts.length
        ? seam.cuts.map(cut => indexOfCut(cut.polygon, cut.rimSpacing))
        : undefined,
      fluid: !!layer.fluid,
    };
    return layer.surface
      ? { ...toLayerSpec(layer.surface, utmToArea), ...shared }
      : {
          depth: layer.depth,
          offset: layer.offset,
          relief: layer.relief,
          ...shared,
        };
  });

  // ⭐ A fill on the LAST layer says the block is open at the bottom, and the only
  // thing that can close it is the column's floor — so the carrier is INFERRED
  // here rather than declared as a layer. Nothing else could mean anything: there
  // is no next boundary in this chunk for that volume to end on.
  const last = layers[layers.length - 1];
  if (options.carrier && last && chunkLayerFill(last)) {
    const seam = options.carrierSeam ?? null;
    specLayers.push({
      carrier: true,
      fill: false,
      cap: seam ? seam.draw : true,
      capCuts: seam?.cuts.length
        ? seam.cuts.map(cut => indexOfCut(cut.polygon, cut.rimSpacing))
        : undefined,
    });
  }

  const stack = options.stack
    ? stackColumnSpec(
        options.stack.surfaces,
        options.stack.envelope,
        utmToArea,
        options.carrier,
      )
    : undefined;

  return {
    layers: specLayers,
    polygon: {
      coordinates: outlinePolygon.coordinates as PlanarPolygonCoordinates,
      offset: outlinePolygon.offset,
    },
    stack,
    carrier: carrierSpec(options.carrier),
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
    section: options.section,
  };
}
