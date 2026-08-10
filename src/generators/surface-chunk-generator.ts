import { transfer } from 'comlink';
import {
  isSyntheticSpecLayer,
  SurfaceChunkResponse,
  SurfaceChunkSpec,
} from '../components/Chunks/chunk-defs';
import {
  assembleChunk,
  AssembleChunkLayer,
  buildStackReference,
  buildSurfaceStack,
  buildSyntheticChannel,
  collapseOptionalChannels,
  collectStackCandidates,
  densifyChunkRim,
  packSurfaceChunk,
  PlanarPolygonGeometry,
  ReadonlyStore,
  StackLayer,
  StackPairStats,
  StackSyntheticLayer,
  SurfaceChunkDiagnostics,
  SurfaceStackBuild,
  trimPolygonToCoverage,
} from '../sdk';
import { getStackCandidates, getStackContext } from './surface-stack-context';
import { refineStackChannels } from './workers/stack-worker-pool';

/** A fetched layer, kept with whether the interval below it is filled. */
export type LoadedStackLayer = {
  layer: StackLayer;
  /** draw the interval between this layer and the next one down */
  fill: boolean;
  /** draw this layer's cap (false = a neighbouring chunk draws this horizon) */
  cap: boolean;
  /** this layer's data extent must not cut the chunk's outline back */
  optional: boolean;
  /** surface id, or `null` for a synthetic layer */
  id: string | null;
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
  /**
   * The footprint the stack was actually built on — the requested outline, or a
   * copy of it cut back to where the layers have data. Walls and the basement MUST
   * use this one, or they would stand around geometry that is no longer there.
   */
  densified: PlanarPolygonGeometry;
  /** whether the outline had to be cut back */
  outlineTrimmed: boolean;
  /** share of the requested footprint that survived (1 = untouched) */
  outlineCoverage: number;
  /** per-layer share of the REQUESTED footprint each layer has data for */
  layerCoverage: number[];
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
  const flat = spec.layers;
  if (flat.length === 0) return null;

  // --- Column path: the fetch, the common grid and the depth-order resolve are
  //     shared by every chunk cut from the same column, so chunks agree with each
  //     other rather than each resolving its own layers in isolation. ----------
  if (spec.stack) {
    const context = await getStackContext(store, spec.stack, spec.resolve);
    if (!context) return null;

    const loaded: LoadedStackLayer[] = [];
    // Column index per layer, or -1 for a synthetic one (not part of the column).
    const picks: number[] = [];
    flat.forEach(f => {
      if (isSyntheticSpecLayer(f)) {
        picks.push(-1);
        loaded.push({
          id: null,
          fill: !!f.fill,
          cap: f.cap !== false,
          optional: !!f.optional,
          layer: { depth: f.depth, offset: f.offset, relief: f.relief },
        });
        return;
      }
      const at = context.index.get(f.id);
      if (at === undefined) return;
      picks.push(at);
      loaded.push({
        id: f.id,
        fill: !!f.fill,
        cap: f.cap !== false,
        optional: !!f.optional,
        layer: context.layers[at],
      });
    });
    if (loaded.length === 0) return null;
    const synthetic = picks.some(i => i < 0);

    // A view of the column holding only this chunk's layers. The column's channels
    // are shared by reference (free); a synthetic layer's channel is generated here
    // on the SAME grid, and IN ORDER, because `offset` hangs from the layer above.
    const nodes = context.reference.header.nx * context.reference.header.ny;
    const channels: Float32Array[] = [];
    const masks: Uint8Array[] = [];
    picks.forEach((at, j) => {
      if (at >= 0) {
        channels.push(context.reference.channels[at]);
        masks.push(context.reference.masks[at]);
        return;
      }
      const channel = buildSyntheticChannel(
        context.reference.header,
        context.reference.worldPosition,
        loaded[j].layer as StackSyntheticLayer,
        channels.length > 0 ? channels[channels.length - 1] : null,
      );
      // Same fallback as `buildStackReference`: sea level, and never a missing
      // channel — everything downstream pairs layers with channels BY INDEX.
      channels.push(channel ?? new Float32Array(nodes));
      masks.push(new Uint8Array(nodes).fill(1));
    });
    // A borrowed boundary must not drag this chunk's footprint down to the extent
    // of someone else's survey, so it is excluded from the trim — and its interval
    // is pinched out where it has no data, rather than built on the hole fill.
    const optional = loaded.map(l => l.optional);
    const reference = {
      ...context.reference,
      channels: collapseOptionalChannels(channels, masks, optional),
      masks,
    };
    const allCandidates = await getStackCandidates(context, maxError);
    const tRefine = performance.now();

    // A surface's data extent is where the survey stopped, not the geology — see
    // `trimPolygonToCoverage`. Done here, before the rim is densified, so the walls
    // and the basement follow the same (possibly cut back) footprint.
    const trim = trimPolygonToCoverage(reference, densified, reference.masks, {
      rule: spec.resolve?.coverageRule,
      optional,
    });
    if (!trim.polygon) return null;
    const footprint = trim.trimmed
      ? densifyChunkRim(trim.polygon, spec.rimSpacing ?? 250).densified
      : densified;

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
        polygon: footprint,
        maxError,
        candidates: picks.map((i, j) =>
          i >= 0
            ? allCandidates[i]
            : // A synthetic layer contributes refinement vertices only if it has
              // RELIEF of its own. A plane is exact everywhere, so it rides the
              // union the others produce; a dune field is not, and without this
              // its shape would only be sampled where other layers happened to
              // need detail.
              (loaded[j].layer as StackSyntheticLayer).relief
              ? collectStackCandidates(
                  reference.channels[j],
                  reference.header.nx,
                  maxError,
                )
              : new Uint32Array(0),
        ),
        // The column never saw a synthetic layer, so its `absent` masks do not
        // cover this stack — fall back to the per-vertex resolve, which is cheap
        // here because the column layers already arrive ordered (it only measures
        // them). ⚠️ Ordering against a synthetic layer is therefore enforced PER
        // CHUNK, not column-wide.
        preResolved:
          spec.resolve && !synthetic
            ? picks.map(i => context.absent[i])
            : undefined,
        resolve:
          spec.resolve && synthetic
            ? { mode: spec.resolve.mode, minGap: spec.resolve.minGap }
            : undefined,
        collapseThreshold: spec.resolve?.collapseThreshold,
        coverageAbsence: spec.resolve?.coverageAbsence,
        refineTerminations: spec.resolve?.refineTerminations,
        caps: loaded.map(l => l.cap),
        topCover: coverAbove,
      },
    );
    if (!build) return null;

    // Only the pairs whose BOTH layers this chunk draws: the pair spanning the cut
    // to the chunk above belongs to that boundary, not to either chunk.
    const picked = new Set(picks.filter(i => i >= 0));
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
      densified: footprint,
      outlineTrimmed: trim.trimmed,
      outlineCoverage: trim.coverage,
      layerCoverage: trim.layerCoverage,
      sharedStack: true,
      stackLayers: context.layers.length,
      stackResolveMs: context.resolveMs,
      stackPairs,
      tRefine,
    };
  }

  const t0 = performance.now();
  const grids = await Promise.all(
    flat.map(f =>
      isSyntheticSpecLayer(f)
        ? Promise.resolve(null)
        : store.get<Float32Array>('surface-values', f.id),
    ),
  );
  const tFetch = performance.now();

  const loaded: LoadedStackLayer[] = [];
  let bytes = 0;
  flat.forEach((f, i) => {
    if (isSyntheticSpecLayer(f)) {
      loaded.push({
        id: null,
        fill: !!f.fill,
        cap: f.cap !== false,
        optional: !!f.optional,
        layer: { depth: f.depth, offset: f.offset, relief: f.relief },
      });
      return;
    }
    const values = grids[i];
    if (!values) return;
    bytes += values.byteLength;
    loaded.push({
      id: f.id,
      fill: !!f.fill,
      cap: f.cap !== false,
      optional: !!f.optional,
      layer: {
        values,
        header: f.header,
        referenceDepth: f.referenceDepth,
        worldPosition: f.worldPosition,
      },
    });
  });
  if (loaded.length === 0) return null;

  const layers = loaded.map(l => l.layer);
  const optional = loaded.map(l => l.optional);
  const built = buildStackReference(layers, densified, {
    maxNodes: spec.resolve?.maxNodes,
  });
  if (!built) return null;
  // See the shared path: a borrowed boundary neither trims this chunk nor gets
  // built on where it has no data of its own.
  const reference = {
    ...built,
    channels: collapseOptionalChannels(built.channels, built.masks, optional),
  };
  const tReference = performance.now();

  const { candidates, poolSize } = await refineStackChannels(
    reference.channels,
    reference.header.nx,
    maxError,
  );
  const tRefine = performance.now();

  // See the shared path: the outline is cut back to where the layers have data
  // before the rim is densified, so the walls follow the same footprint.
  const trim = trimPolygonToCoverage(reference, densified, reference.masks, {
    rule: spec.resolve?.coverageRule,
    optional,
  });
  if (!trim.polygon) return null;
  const footprint = trim.trimmed
    ? densifyChunkRim(trim.polygon, spec.rimSpacing ?? 250).densified
    : densified;

  const build = buildSurfaceStack(reference, layers, {
    polygon: footprint,
    maxError,
    candidates,
    resolve: spec.resolve
      ? { mode: spec.resolve.mode, minGap: spec.resolve.minGap }
      : undefined,
    collapseThreshold: spec.resolve?.collapseThreshold,
    coverageAbsence: spec.resolve?.coverageAbsence,
    refineTerminations: spec.resolve?.refineTerminations,
    caps: loaded.map(l => l.cap),
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
    densified: footprint,
    outlineTrimmed: trim.trimmed,
    outlineCoverage: trim.coverage,
    layerCoverage: trim.layerCoverage,
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
  const totalTriangles = build.tessellation.indices.length / 3;
  return {
    crossings: pairs.reduce((a, p) => a + p.crossings, 0),
    crossingsCovered: pairs.reduce((a, p) => a + p.crossingsCovered, 0),
    outlineTrimmed: result.outlineTrimmed,
    outlineCoverage: result.outlineCoverage,
    rimDropped: build.tessellation.rimDropped,
    layers: result.loaded.map((entry, i) => {
      const absent = dropped?.droppedAbsent[i] ?? 0;
      const collapsed = dropped?.droppedCollapsed[i] ?? 0;
      return {
        index: i,
        id: entry.id,
        coverage: result.layerCoverage[i] ?? 0,
        // An uncapped layer draws no surface at all, however many triangles
        // survived the drops.
        triangles: entry.cap ? totalTriangles - absent - collapsed : 0,
        droppedAbsent: absent,
        droppedCollapsed: collapsed,
        duplicate: build.duplicates[i] ?? 0,
      };
    }),
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
 * Turn a built stack into the {@link AssembleChunkLayer} list `assembleChunk`
 * consumes: each layer carries whether the interval below it is filled.
 *
 * ⚠️ A layer that failed to load is dropped, so `fill` is taken from the layer that
 * SURVIVED at that position — an interval is between the layers actually drawn.
 */
export function toAssembleLayers(
  result: SpecStackResult,
): AssembleChunkLayer[] {
  return result.build.layers.map((layer, i) => ({
    geometry: layer.geometry,
    rimY: layer.rimY,
    // The last layer has nothing below it inside this chunk.
    fill: i + 1 < result.build.layers.length && result.loaded[i].fill,
  }));
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

  const layers = toAssembleLayers(result);
  const chunk = assembleChunk(
    layers,
    result.build.rings,
    result.densified,
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
