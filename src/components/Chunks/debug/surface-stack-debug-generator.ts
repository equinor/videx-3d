import { transfer } from 'comlink';
import {
  buildSpecStack,
  toAssembleLayers,
} from '../../../generators/surface-chunk-generator';
import {
  assembleChunk,
  densifyChunkRim,
  PackedSurfaceChunk,
  packSurfaceChunk,
  PlanarPolygonGeometry,
  ReadonlyStore,
  stackDepthStats,
} from '../../../sdk';
import { SurfaceChunkSpec } from '../chunk-defs';

/**
 * TEMPORARY diagnostic wrapper around the PRODUCTION chunk build
 * (`buildSpecStack`), adding the phase timings, the geometry budget and the
 * stack's ordering / coverage statistics. It deliberately runs the exact same
 * code path as `generateSurfaceChunk` so the harness cannot drift from what
 * `Chunk` actually does. Remove together with `ChunkDepthOrder.stories.tsx`.
 */
export const surfaceStackDebug = 'surfaceStackDebug';

/** Spec for the diagnostic generator. */
export type SurfaceStackDebugSpec = SurfaceChunkSpec & {
  /**
   * Re-sort the layers by their MEASURED median depth inside the footprint before
   * resolving, instead of trusting the order they arrive in. A cross-check on the
   * caller's ordering (which should come from the stratigraphic column).
   */
  autoOrder?: boolean;
};

/** One layer's ordering / coverage diagnostics. */
export type StackOrderRow = {
  id: string;
  /** position in the stack as built */
  index: number;
  /** measured median scene Y inside the footprint */
  medianY: number;
  meanY: number;
  /** share of vertices sitting above the layer over it (0 for the shallowest) */
  invertedFraction: number;
  /** the same, counted only where BOTH layers have data of their own */
  invertedCoveredFraction: number;
  /** share of jointly-covered vertices coincident with the layer above (~1 = duplicate) */
  duplicateFraction: number;
  /** share of vertices the layer has no data for */
  missingFraction: number;
  /** triangles dropped in total */
  dropped: number;
  /** · because the unit is not present (no data / truncated) */
  droppedAbsent: number;
  /** · because it has no thickness there */
  droppedCollapsed: number;
};

export type SurfaceStackDebugTimings = {
  fetchMs: number;
  referenceMs: number;
  refineMs: number;
  tessellateMs: number;
  sampleMs: number;
  resolveMs: number;
  collapseMs: number;
  geometryMs: number;
  assembleMs: number;
  packMs: number;
  totalWorkerMs: number;
  bytes: number;
  layers: number;
  poolSize: number;
  referenceNodes: number;
  referenceStep: number;
  vertices: number;
  trianglesPerLayer: number;
  trianglesKept: number;
  trianglesDropped: number;
  trianglesAbsent: number;
  trianglesCollapsed: number;
  crossings: number;
  crossingsCovered: number;
  maxOverlap: number;
  moved: number;
  applied: boolean;
  reordered: boolean;
  order: StackOrderRow[];
};

export type SurfaceStackDebugResponse = PackedSurfaceChunk & {
  debug: SurfaceStackDebugTimings;
};

export async function generateSurfaceStackDebug(
  this: ReadonlyStore,
  spec: SurfaceStackDebugSpec,
): Promise<SurfaceStackDebugResponse | null> {
  const t0 = performance.now();
  const polygon = new PlanarPolygonGeometry(
    spec.polygon.coordinates,
    spec.polygon.offset,
  );
  const { densified } = densifyChunkRim(polygon, spec.rimSpacing ?? 250);
  const maxError = spec.maxError ?? 5;

  // `autoOrder` re-sorts the SPEC, so the production path still sees a plain
  // ordered stack — the harness never gets a code path of its own.
  let effective = spec;
  let reordered = false;
  if (spec.autoOrder) {
    const probe = await buildSpecStack(this, spec, densified, maxError);
    if (!probe) return null;
    const depths = stackDepthStats(probe.build.heights);
    const order = depths
      .map(d => d.index)
      // shallowest first (scene Y grows upwards)
      .sort((a, b) => depths[b].medianY - depths[a].medianY);
    reordered = order.some((from, to) => from !== to);
    if (reordered) {
      const flat = probe.loaded.map((l, i) => ({
        spec: spec.groups.flat()[i],
        groupIndex: l.groupIndex,
      }));
      const groups: (typeof spec.groups)[number][] = [];
      order.forEach(i => {
        const { spec: layerSpec, groupIndex } = flat[i];
        (groups[groupIndex] ??= []).push(layerSpec);
      });
      effective = { ...spec, groups: groups.filter(Boolean) };
    }
  }

  const result = await buildSpecStack(this, effective, densified, maxError);
  if (!result) return null;
  const { build } = result;

  const { layers, groupCount } = toAssembleLayers(result, spec.colors);
  const tAssembleStart = performance.now();
  const chunk = assembleChunk(
    groupCount,
    layers,
    build.rings,
    densified,
    { maxError, basement: spec.basement },
    {
      t0,
      densifyMs: 0,
      clipMs: build.timings.tessellateMs,
      rimMs: build.timings.sampleMs,
    },
  );
  const tAssemble = performance.now();

  const [packed, transferables] = packSurfaceChunk(chunk);
  const seen = new Set<ArrayBufferLike>();
  const unique = transferables.filter(buffer => {
    if (seen.has(buffer)) return false;
    seen.add(buffer);
    return true;
  });
  const tPack = performance.now();

  const trianglesPerLayer = build.tessellation.indices.length / 3;
  const zeros = build.heights.map(() => 0);
  const dropped = build.collapsed?.dropped ?? zeros;
  const droppedAbsent = build.collapsed?.droppedAbsent ?? zeros;
  const droppedCollapsed = build.collapsed?.droppedCollapsed ?? zeros;
  const totalDropped = dropped.reduce((a, d) => a + d, 0);

  const order: StackOrderRow[] = build.heights.map((y, i) => {
    const pair = build.resolved.pairs.find(p => p.index === i);
    let missing = 0;
    for (let v = 0; v < y.length; v++) if (!build.coverage[i][v]) missing++;
    return {
      id: result.loaded[i].id,
      index: i,
      medianY: build.depths[i].medianY,
      meanY: build.depths[i].meanY,
      invertedFraction: pair ? pair.crossings / Math.max(1, y.length) : 0,
      invertedCoveredFraction: pair
        ? pair.crossingsCovered / Math.max(1, pair.compared)
        : 0,
      duplicateFraction: build.duplicates[i],
      missingFraction: y.length > 0 ? missing / y.length : 0,
      dropped: dropped[i],
      droppedAbsent: droppedAbsent[i],
      droppedCollapsed: droppedCollapsed[i],
    };
  });

  const response: SurfaceStackDebugResponse = {
    ...packed,
    debug: {
      fetchMs: result.fetchMs,
      referenceMs: result.referenceMs,
      refineMs: result.refineMs,
      tessellateMs: build.timings.tessellateMs,
      sampleMs: build.timings.sampleMs,
      resolveMs: build.timings.resolveMs,
      collapseMs: build.timings.collapseMs,
      geometryMs: build.timings.geometryMs,
      assembleMs: tAssemble - tAssembleStart,
      packMs: tPack - tAssemble,
      totalWorkerMs: tPack - t0,
      bytes: result.bytes,
      layers: result.loaded.length,
      poolSize: result.poolSize,
      referenceNodes: result.referenceNodes,
      referenceStep: result.referenceStep,
      vertices: build.tessellation.coords.length / 2,
      trianglesPerLayer,
      trianglesKept: trianglesPerLayer * result.loaded.length - totalDropped,
      trianglesDropped: totalDropped,
      trianglesAbsent: droppedAbsent.reduce((a, d) => a + d, 0),
      trianglesCollapsed: droppedCollapsed.reduce((a, d) => a + d, 0),
      crossings: build.resolved.pairs.reduce((a, p) => a + p.crossings, 0),
      crossingsCovered: build.resolved.pairs.reduce(
        (a, p) => a + p.crossingsCovered,
        0,
      ),
      maxOverlap: build.resolved.pairs.reduce(
        (a, p) => Math.max(a, p.maxOverlap),
        0,
      ),
      moved: build.resolved.moved,
      applied: build.resolved.applied,
      reordered,
      order,
    },
  };

  return transfer(response, unique);
}
