import { SurfaceChunkMetrics } from '../../sdk';

/**
 * The build phases a chunk reports, rounded, for a story's `CHUNKREPORT` line.
 *
 * ⚠️ `fetch`/`reference`/`seal`/`stackResolve` are the COLUMN's: every chunk of a
 * shared stack reports the same numbers, but only the first one waited for them.
 * Everything from `refine` on is this chunk's own, and `ownMs` sums exactly those.
 *
 * `unaccountedMs` = `totalMs` minus this chunk's own phases and the rim densify.
 * For the FIRST chunk that still contains the shared column work; for the rest it
 * is genuinely untimed work (assembling the meshes, and anything with no timer of
 * its own). A large one on a later chunk means the breakdown is looking in the
 * wrong place.
 */
export function chunkTimings(metrics: SurfaceChunkMetrics) {
  const d = metrics.diagnostics;
  if (!d) return { totalMs: Math.round(metrics.totalMs) };
  const own =
    d.refineMs +
    d.prepMs +
    d.tessellateMs +
    d.sampleMs +
    d.vertexResolveMs +
    d.collapseMs +
    d.geometryMs +
    d.wallMs;
  return {
    totalMs: Math.round(metrics.totalMs),
    ownMs: Math.round(own),
    unaccountedMs: Math.round(metrics.totalMs - own - metrics.densifyMs),
    // What the shared column keeps resident in the worker between builds.
    columnMB: Math.round(d.columnBytes / 1e5) / 10,
    fetchMs: Math.round(d.fetchMs),
    referenceMs: Math.round(d.referenceMs),
    sealMs: Math.round(d.sealMs),
    stackResolveMs: Math.round(d.stackResolveMs),
    refineMs: Math.round(d.refineMs),
    refinePool: d.refinePool,
    prepMs: Math.round(d.prepMs),
    tessellateMs: Math.round(d.tessellateMs),
    tessPrepMs: Math.round(d.tessellation.prepMs),
    tessPlanMs: Math.round(d.tessellation.planMs),
    tilesMs: Math.round(d.tessellation.tilesMs),
    tileWorkMs: Math.round(d.tessellation.tileWorkMs),
    slowestTileMs: Math.round(d.tessellation.slowestTileMs),
    stitchMs: Math.round(d.tessellation.stitchMs),
    tiles: d.tessellation.tiles,
    ...(d.lod && {
      lodShared: d.lod.map(l => l.sharedTriangles),
      lodTriangles: d.lod.map(l => l.triangles),
      lodFailures: d.lod.map(l => l.constraintFailures),
      lodMB: Math.round(d.lod.reduce((a, l) => a + l.bytes, 0) / 1e5) / 10,
      lodVertices: d.lodVertices,
    }),
    sampleMs: Math.round(d.sampleMs),
    vertexResolveMs: Math.round(d.vertexResolveMs),
    collapseMs: Math.round(d.collapseMs),
    geometryMs: Math.round(d.geometryMs),
    wallMs: Math.round(d.wallMs),
  };
}
