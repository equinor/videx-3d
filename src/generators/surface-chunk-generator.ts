import { transfer } from 'comlink';
import {
  SurfaceChunkLayerSpec,
  SurfaceChunkResponse,
  SurfaceChunkSpec,
} from '../components/Chunks/chunk-defs';
import {
  assembleChunk,
  AssembleChunkLayer,
  buildStackReference,
  buildSurfaceStack,
  densifyChunkRim,
  packSurfaceChunk,
  PlanarPolygonGeometry,
  ReadonlyStore,
  StackLayer,
  StackPairStats,
  SurfaceChunkDiagnostics,
  SurfaceStackBuild,
} from '../sdk';
import { getStackCandidates, getStackContext } from './surface-stack-context';
import { refineStackChannels } from './workers/stack-worker-pool';

/** A fetched layer, kept with the group it belongs to. */
export type LoadedStackLayer = {
  layer: StackLayer;
  groupIndex: number;
  id: string;
};

/** What {@link buildSpecStack} returns on top of the stack itself. */
export type SpecStackResult = {
  build: SurfaceStackBuild;
  loaded: LoadedStackLayer[];
  /** total bytes of `surface-values` fetched */
  bytes: number;
  fetchMs: number;
  referenceMs: number;
  /** per-layer refinement (wall clock; parallel across the worker pool) */
  refineMs: number;
  /** refinement workers used (0 = serial fallback) */
  poolSize: number;
  /** nodes of the common reference grid */
  referenceNodes: number;
  /** source cells per reference cell (1 = full resolution) */
  referenceStep: number;
  /** whether the column was built once and shared by every chunk cut from it */
  sharedStack?: boolean;
  /** layers in the shared column */
  stackLayers?: number;
  /** time the column's grid-level resolve took (shared path only) */
  stackResolveMs?: number;
  /**
   * The pairs as the COLUMN measured them, before it was made monotone (shared
   * path only). The build's own pair statistics are all zero there — it samples
   * grids that arrive ordered — so these are the ones worth reporting.
   */
  stackPairs?: StackPairStats[];
  /** internal: refinement completion timestamp (shared path only) */
  tRefine?: number;
};

/**
 * Fetch a spec's layers and build them onto ONE shared tessellation: every layer
 * is resampled onto a common grid, refined in parallel across the worker pool,
 * triangulated once, then resolved and collapsed together.
 *
 * The shared topology is what makes the result safe: monotone vertex heights stay
 * monotone under linear interpolation, so no two surfaces of the stack can
 * interpenetrate — a guarantee independently simplified per-layer TINs cannot give
 * for any pair closer than twice the simplification error.
 *
 * Shared by the chunk generator and the debug harness.
 */
export async function buildSpecStack(
  store: ReadonlyStore,
  spec: SurfaceChunkSpec,
  densified: PlanarPolygonGeometry,
  maxError: number,
): Promise<SpecStackResult | null> {
  const flat: { layer: SurfaceChunkLayerSpec; groupIndex: number }[] = [];
  spec.groups.forEach((group, gi) =>
    group.forEach(layer => flat.push({ layer, groupIndex: gi })),
  );
  if (flat.length === 0) return null;

  // --- Column path: the fetch, the common grid and the depth-order resolve are
  //     shared by every chunk cut from the same column, so chunks agree with each
  //     other rather than each resolving its own layers in isolation. ----------
  if (spec.stack) {
    const context = await getStackContext(store, spec.stack, spec.resolve);
    if (!context) return null;

    const loaded: LoadedStackLayer[] = [];
    const picks: number[] = [];
    flat.forEach(f => {
      const at = context.index.get(f.layer.id);
      if (at === undefined) return;
      picks.push(at);
      loaded.push({
        id: f.layer.id,
        groupIndex: f.groupIndex,
        layer: context.layers[at],
      });
    });
    if (loaded.length === 0) return null;

    // A view of the column holding only this chunk's layers. The channels are
    // shared by reference, so this costs nothing.
    const reference = {
      ...context.reference,
      channels: picks.map(i => context.reference.channels[i]),
      masks: picks.map(i => context.reference.masks[i]),
    };
    const allCandidates = await getStackCandidates(context, maxError);
    const tRefine = performance.now();

    // Only the chunk's FIRST layer can be truncated against a surface it does not
    // draw itself, and only then is a cover polygon meaningful.
    const coverAbove =
      spec.coverAbove && picks[0] > 0
        ? new PlanarPolygonGeometry(
            spec.coverAbove.coordinates,
            spec.coverAbove.offset,
          )
        : undefined;

    const build = buildSurfaceStack(
      reference,
      loaded.map(l => l.layer),
      {
        polygon: densified,
        maxError,
        candidates: picks.map(i => allCandidates[i]),
        preResolved: spec.resolve
          ? picks.map(i => context.absent[i])
          : undefined,
        collapseThreshold: spec.resolve?.collapseThreshold,
        coverageAbsence: spec.resolve?.coverageAbsence,
        refineTerminations: spec.resolve?.refineTerminations,
        topCover: coverAbove,
      },
    );
    if (!build) return null;

    // Only the pairs whose BOTH layers this chunk draws: the pair spanning the cut
    // to the chunk above belongs to that boundary, not to either chunk.
    const picked = new Set(picks);
    const stackPairs = context.pairs.filter(
      p => picked.has(p.index) && picked.has(p.index - 1),
    );

    return {
      build,
      loaded,
      bytes: context.bytes,
      fetchMs: context.fetchMs,
      referenceMs: context.referenceMs,
      refineMs: 0,
      poolSize: 0,
      referenceNodes: context.reference.header.nx * context.reference.header.ny,
      referenceStep: context.reference.step,
      sharedStack: true,
      stackLayers: context.layers.length,
      stackResolveMs: context.resolveMs,
      stackPairs,
      tRefine,
    };
  }

  const t0 = performance.now();
  const grids = await Promise.all(
    flat.map(f => store.get<Float32Array>('surface-values', f.layer.id)),
  );
  const tFetch = performance.now();

  const loaded: LoadedStackLayer[] = [];
  let bytes = 0;
  flat.forEach((f, i) => {
    const values = grids[i];
    if (!values) return;
    bytes += values.byteLength;
    loaded.push({
      id: f.layer.id,
      groupIndex: f.groupIndex,
      layer: {
        values,
        header: f.layer.header,
        referenceDepth: f.layer.referenceDepth,
        worldPosition: f.layer.worldPosition,
      },
    });
  });
  if (loaded.length === 0) return null;

  const layers = loaded.map(l => l.layer);
  const reference = buildStackReference(layers, densified, {
    maxNodes: spec.resolve?.maxNodes,
  });
  if (!reference) return null;
  const tReference = performance.now();

  const { candidates, poolSize } = await refineStackChannels(
    reference.channels,
    reference.header.nx,
    maxError,
  );
  const tRefine = performance.now();

  const build = buildSurfaceStack(reference, layers, {
    polygon: densified,
    maxError,
    candidates,
    resolve: spec.resolve
      ? { mode: spec.resolve.mode, minGap: spec.resolve.minGap }
      : undefined,
    collapseThreshold: spec.resolve?.collapseThreshold,
    coverageAbsence: spec.resolve?.coverageAbsence,
    refineTerminations: spec.resolve?.refineTerminations,
  });
  if (!build) return null;

  return {
    build,
    loaded,
    bytes,
    fetchMs: tFetch - t0,
    referenceMs: tReference - tFetch,
    refineMs: tRefine - tReference,
    poolSize,
    referenceNodes: reference.header.nx * reference.header.ny,
    referenceStep: reference.step,
  };
}

/**
 * The diagnostics a built stack reports, in the shape the chunk metrics carry.
 */
export function stackDiagnostics(
  result: SpecStackResult,
): SurfaceChunkDiagnostics {
  const build = result.build;
  const dropped = build.collapsed;
  // A shared column arrives already ordered, so the build's own resolve pass finds
  // nothing — the column's own numbers are the ones that say whether the input was
  // in order, and reporting the build's zeros would hide exactly what this is for.
  const pairs = result.stackPairs ?? build.resolved.pairs;
  return {
    crossings: pairs.reduce((a, p) => a + p.crossings, 0),
    crossingsCovered: pairs.reduce((a, p) => a + p.crossingsCovered, 0),
    maxOverlap: pairs.reduce((a, p) => Math.max(a, p.maxOverlap), 0),
    maxDuplicate: build.duplicates.reduce((a, d) => Math.max(a, d), 0),
    trianglesAbsent: dropped
      ? dropped.droppedAbsent.reduce((a, d) => a + d, 0)
      : 0,
    trianglesCollapsed: dropped
      ? dropped.droppedCollapsed.reduce((a, d) => a + d, 0)
      : 0,
    topKept: build.topKept,
    sharedStack: !!result.sharedStack,
    stackLayers: result.stackLayers ?? 0,
    referenceNodes: result.referenceNodes,
    referenceStep: result.referenceStep,
    fetchMs: result.fetchMs,
    referenceMs: result.referenceMs,
    stackResolveMs: result.stackResolveMs ?? 0,
    tessellateMs: build.timings.tessellateMs,
  };
}

/**
 * Turn a built stack into the grouped {@link AssembleChunkLayer} list
 * `assembleChunk` consumes: compact away fully-empty groups and assign the palette
 * by flat layer order.
 */
export function toAssembleLayers(
  result: SpecStackResult,
  colors: string[],
): { layers: AssembleChunkLayer[]; groupCount: number } {
  const palette = colors.length > 0 ? colors : ['#4e79a7'];
  const groupIndices = result.loaded.map(l => l.groupIndex);
  const usedGroups = [...new Set(groupIndices)].sort((a, b) => a - b);
  const remap = new Map(usedGroups.map((g, i) => [g, i]));
  const layers: AssembleChunkLayer[] = result.build.layers.map((layer, i) => ({
    geometry: layer.geometry,
    rimY: layer.rimY,
    color: palette[i % palette.length],
    groupIndex: remap.get(groupIndices[i])!,
  }));
  return { layers, groupCount: usedGroups.length };
}

/**
 * Build a surface chunk inside a worker: fetch each layer's `surface-values` (the
 * heavy grids stay in the worker), build them onto ONE shared tessellation with
 * the per-layer refinement spread across an internal worker pool, assemble the
 * walls and the optional basement, then pack + transfer the resulting geometry
 * back to the main thread. Only the (much smaller) triangulated geometry crosses
 * the boundary.
 *
 * @group Generators
 */
export async function generateSurfaceChunk(
  this: ReadonlyStore,
  spec: SurfaceChunkSpec,
): Promise<SurfaceChunkResponse | null> {
  const t0 = performance.now();
  const polygon = new PlanarPolygonGeometry(
    spec.polygon.coordinates,
    spec.polygon.offset,
  );
  const { densified } = densifyChunkRim(polygon, spec.rimSpacing ?? 250);
  const densifyMs = performance.now() - t0;
  const maxError = spec.maxError ?? 5;

  const result = await buildSpecStack(this, spec, densified, maxError);
  if (!result && !spec.basement) return null;
  if (!result) return null;

  const { layers, groupCount } = toAssembleLayers(result, spec.colors);
  const chunk = assembleChunk(
    groupCount,
    layers,
    result.build.rings,
    densified,
    {
      maxError,
      basement: spec.basement,
      diagnostics: stackDiagnostics(result),
    },
    {
      t0,
      densifyMs,
      clipMs: result.build.timings.tessellateMs,
      rimMs: result.build.timings.sampleMs,
    },
  );

  const [packed, transferables] = packSurfaceChunk(chunk);
  // Layers that kept the full triangle set share one index buffer, so the same
  // ArrayBuffer is referenced many times — structured clone keeps that identity,
  // but a transfer list must not repeat it.
  const seen = new Set<ArrayBufferLike>();
  const unique = transferables.filter(buffer => {
    if (seen.has(buffer)) return false;
    seen.add(buffer);
    return true;
  });
  return transfer(packed, unique);
}
