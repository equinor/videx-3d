import {
  PackedSurfaceChunk,
  PlanarPolygonCoordinates,
  SurfaceChunkBasement,
  SurfaceClipHeader,
  Vec2,
} from '../../sdk';

/** Generator key for the {@link Chunk} geometry generator. */
export const surfaceChunk = 'surfaceChunk';

/**
 * One layer of a {@link SurfaceChunkSpec}: a reference to a surface plus how to
 * place it. The (heavy) grid values are NOT included — the generator fetches
 * `surface-values` for `id` inside the worker so the raw grids never cross to the
 * main thread.
 */
export type SurfaceChunkLayerSpec = {
  /** surface id (the worker fetches `surface-values` for this id) */
  id: string;
  /** grid geometry needed to place/clip the surface (from `SurfaceMeta.header`) */
  header: SurfaceClipHeader;
  /** depth-normalization reference (`SurfaceMeta.max`) */
  referenceDepth: number;
  /** scene XZ of the surface origin (`utmToArea(xori, yori, 0)` -> `[x, z]`) */
  worldPosition: Vec2;
};

/**
 * Serializable input to the {@link surfaceChunk} generator — everything needed to
 * build a `SurfaceChunk` in a worker except the grid values (fetched by the worker
 * from the surface ids). `PlanarPolygonGeometry` is passed as plain coordinates +
 * offset and reconstructed in the worker.
 */
export type SurfaceChunkSpec = {
  /** surfaces grouped into zones, top (shallowest) to base (deepest) */
  groups: SurfaceChunkLayerSpec[][];
  /** per-layer palette, cycled by flat layer order (assigned after load-filter) */
  colors: string[];
  /** shared mask polygon (scene XZ) as plain coordinates + offset */
  polygon: { coordinates: PlanarPolygonCoordinates; offset: Vec2 };
  /** rim densification spacing (world units) */
  rimSpacing?: number;
  /** interior simplification error (grid height units) */
  maxError?: number;
  /** pinch-out clamp for crossing surfaces */
  clamp?: boolean;
  /** optional basement block */
  basement?: SurfaceChunkBasement;
};

/** Response from the {@link surfaceChunk} generator (packed for transfer). */
export type SurfaceChunkResponse = PackedSurfaceChunk;
