import { transfer } from 'comlink';
import {
  DEFAULT_CHUNK_MAX_FILL,
  isCarrierSpecLayer,
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
  clampStackToCarrier,
  collectStackCandidates,
  densifyChunkRim,
  measureStackCoverage,
  packSurfaceChunk,
  PlanarPolygonGeometry,
  rasterizeStackOutline,
  ReadonlyStore,
  sealStackChannels,
  splitVoidChannels,
  STACK_MASK_DATA,
  stackCarrierLevel,
  StackLayer,
  StackPairStats,
  StackSyntheticLayer,
  SurfaceChunkDiagnostics,
  SurfaceStackBuild,
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
  /** indices into the spec's cuts of the neighbours that draw part of this cap */
  capCuts?: number[];
  /** this layer is the column's carrier — the floor the block terminates against */
  carrier?: boolean;
  /** surface id, or `null` for a synthetic layer */
  id: string | null;
};

/** What {@link buildSpecStack} returns on top of the stack itself. */
export type SpecStackResult = {
  build: SurfaceStackBuild;
  loaded: LoadedStackLayer[];
  /**
   * For each layer of the BUILD, its index in `loaded`. Usually one-to-one, but a
   * surface sealed with a void becomes two build layers with one source.
   */
  source: number[];
  /** for each layer of the BUILD, whether the interval below it holds a volume */
  fills: boolean[];
  /**
   * For each layer of the BUILD, whether it is the ceiling of a void — the upper
   * copy of a split surface, which shows the base of the interval above it.
   */
  ceilings: boolean[];
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
   * The footprint the stack was built on — the requested outline, densified. The
   * walls and the basement use this one.
   */
  densified: PlanarPolygonGeometry;
  /** per-layer share of the footprint each layer has data for */
  layerCoverage: number[];
  /** per-layer share of the footprint covered only by bounded fill */
  layerFilled: number[];
  /**
   * Per layer: it has no data ANYWHERE the chunk is drawn, so it was voided — no
   * cap, and neither interval it bounds is filled. See `documents/chunks.md` §9.9.
   */
  layerVoided: boolean[];
  /**
   * Per layer, the NODE COUNT the seal moved. Counts rather than shares, because
   * the stack's grid is not the chunk's footprint. Empty when sealing is off.
   */
  layerTapered: number[];
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
 * Void every layer that has no data ANYWHERE the chunk is drawn.
 *
 * ⭐ Coverage already counts bounded fill, so a layer measuring 0 is not merely
 * partly mapped — it is not within `maxFill` of any data of its own. Sealing it
 * would extend a survey that exists only outside the crop across the whole chunk
 * and draw a smooth, plausible horizon with no local evidence behind it. The
 * caller instead leaves it uncapped with BOTH the intervals it bounds open: its
 * top and bottom are equally undefined, so open space is the only statement the
 * data supports, and (like `sealMode: 'void'`) the hole IS the message.
 *
 * Here the channel is laid onto its nearest surviving neighbour — as
 * `buildStackReference` already does for a layer empty over the whole grid — so a
 * surface nobody draws cannot clamp the one below it in the monotone resolve. Its
 * mask is marked complete so the seal passes it over; the honest figure is already
 * in `layerCoverage`.
 *
 * ⚠️ Replaces array ENTRIES, never their contents: on a shared column the channels
 * and masks belong to every chunk cut from it.
 */
function voidUnmappedLayers(
  channels: Float32Array[],
  masks: Uint8Array[],
  layerCoverage: number[],
): boolean[] {
  const voided = layerCoverage.map(c => c === 0);
  if (!voided.some(Boolean)) return voided;
  for (let i = 0; i < channels.length; i++) {
    if (!voided[i]) continue;
    let donor = -1;
    for (let j = i - 1; j >= 0 && donor < 0; j--) if (!voided[j]) donor = j;
    for (let j = i + 1; j < channels.length && donor < 0; j++) {
      if (!voided[j]) donor = j;
    }
    if (donor < 0) continue;
    channels[i] = Float32Array.from(channels[donor]);
    masks[i] = new Uint8Array(masks[i].length).fill(1);
  }
  return voided;
}

// A cut must be densified with the spacing its OWNER used: densification adds
// points ALONG a segment, and each one samples the reference grid on its own, so
// two boundaries built from the same polygon at different spacings do not agree.
function densifyChunkCuts(spec: SurfaceChunkSpec): PlanarPolygonGeometry[] {
  return (spec.cuts ?? []).map(
    cut =>
      densifyChunkRim(
        new PlanarPolygonGeometry(cut.coordinates, cut.offset),
        cut.rimSpacing ?? 250,
      ).densified,
  );
}

// `splitVoidChannels` counts per EXPANDED layer, so a split layer's two copies are
// folded back onto the one the caller declared.
function taperedBySource(
  count: number,
  source: number[],
  moved: number[],
): number[] {
  const out = new Array<number>(count).fill(0);
  source.forEach((s, k) => {
    out[s] += moved[k] ?? 0;
  });
  return out;
}

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
      if (isCarrierSpecLayer(f)) {
        // The floor belongs to the column, so this chunk borrows the very same
        // channel rather than building a plane of its own.
        if (context.carrier === null) return;
        picks.push(context.carrier);
        loaded.push({
          id: null,
          carrier: true,
          fill: false,
          cap: f.cap !== false,
          capCuts: f.capCuts,
          layer: context.layers[context.carrier],
        });
        return;
      }
      if (isSyntheticSpecLayer(f)) {
        picks.push(-1);
        loaded.push({
          id: null,
          fill: !!f.fill,
          cap: f.cap !== false,
          capCuts: f.capCuts,
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
        capCuts: f.capCuts,
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
    // Measured on the CALLER's masks, before anything is sealed or split, and over
    // the outline the caller asked for — the outline is a pure crop, so a layer's
    // extent never reshapes it (§10.1.8).
    const measured = measureStackCoverage(context.reference, densified, masks);
    const voided = voidUnmappedLayers(channels, masks, measured.layerCoverage);
    if (voided.every(Boolean)) return null;

    const sealing = spec.resolve?.seal !== false;
    const voiding = sealing && spec.resolve?.sealMode === 'void';
    // ⭐ Real surfaces are sealed on the COLUMN (`getStackContext`), so a horizon
    // two chunks share has ONE height and their walls and caps meet. Nothing is
    // left for this chunk to seal: a synthetic layer's mask is all ones, so it has
    // no unmapped region to close.
    // ⚠️ `void` is the exception — it turns one layer into two, which the column's
    // id -> index map cannot carry — so it still runs here, and two chunks sharing
    // a horizon can still split it differently.
    const split = voiding
      ? splitVoidChannels(
          channels,
          masks,
          context.reference.header.nx,
          loaded.map(l => l.fill),
          {
            minThickness: spec.resolve?.minThickness,
            // A void is measured over the gap you can SEE, so inside THIS chunk.
            inside: rasterizeStackOutline(context.reference, densified),
          },
        )
      : null;
    // Per BUILD layer: the column's, or a synthetic layer's (nothing is inferred
    // about a boundary that was never measured). One shared zero array — it is only
    // ever read.
    const columnInferred = context.inferred;
    const noneInferred = columnInferred ? new Float32Array(nodes) : null;
    const inferred =
      columnInferred && noneInferred
        ? picks.map(i => (i >= 0 ? columnInferred[i] : noneInferred))
        : undefined;
    const source = split ? split.source : loaded.map((_, i) => i);
    const reference = {
      ...context.reference,
      channels: split?.channels ?? channels,
      masks: split?.masks ?? masks,
    };
    const allCandidates = await getStackCandidates(context, maxError);
    const tRefine = performance.now();

    // A voided layer draws no cap, and neither interval it bounds is filled.
    const caps = source.map(i => loaded[i].cap && !voided[i]);
    const cuts = densifyChunkCuts(spec);
    const capCuts = source.map(i => loaded[i].capCuts ?? null);
    const carrierLayer = source.findIndex(i => loaded[i].carrier);
    // Seen only from below, so it shows the base of the unit above it rather than
    // a cap of its own — the same thing a void's ceiling is.
    const ceilings = source.map(
      (i, k) => (split ? split.ceiling[k] : false) || !!loaded[i].carrier,
    );
    const fills = (split ? split.fill : loaded.map(l => l.fill)).map((f, k) => {
      const below = source[k + 1];
      return f && !voided[source[k]] && !(below !== undefined && voided[below]);
    });

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
      source.map(i => loaded[i].layer),
      {
        polygon: densified,
        maxError,
        candidates: source.map((i, j) =>
          picks[i] >= 0
            ? allCandidates[picks[i]]
            : // A synthetic layer contributes refinement vertices only if it has
              // RELIEF of its own. A plane is exact everywhere, so it rides the
              // union the others produce; a dune field is not, and without this
              // its shape would only be sampled where other layers happened to
              // need detail.
              (loaded[i].layer as StackSyntheticLayer).relief
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
        // CHUNK, not column-wide. Same for `void`, which splits the layer list the
        // masks were built for. Sealing does NOT disqualify them: the column seals
        // BEFORE it resolves, so its masks already describe the tapered heights.
        preResolved:
          spec.resolve && !synthetic && !voiding
            ? picks.map(i => context.absent[i])
            : undefined,
        resolve:
          spec.resolve && (synthetic || voiding)
            ? { mode: spec.resolve.mode, minGap: spec.resolve.minGap }
            : undefined,
        collapseThreshold: spec.resolve?.collapseThreshold,
        // Sealing gives the unmapped region a shape, so dropping it for want of
        // data would delete the wedge the seal just built. The welded part still
        // goes, by thickness.
        coverageAbsence: sealing ? false : spec.resolve?.coverageAbsence,
        refineTerminations: spec.resolve?.refineTerminations,
        caps,
        cuts,
        capCuts,
        fills,
        carrier: carrierLayer >= 0 ? carrierLayer : undefined,
        ceiling: ceilings,
        inferred: split?.inferred ?? inferred,
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
      source,
      fills,
      ceilings,
      bytes: context.bytes,
      fetchMs: context.fetchMs,
      referenceMs: context.referenceMs,
      refineMs: 0,
      poolSize: 0,
      referenceNodes: context.reference.header.nx * context.reference.header.ny,
      referenceStep: context.reference.step,
      densified,
      layerCoverage: measured.layerCoverage,
      layerFilled: measured.layerFilled,
      layerVoided: voided,
      layerTapered:
        (split
          ? taperedBySource(loaded.length, split.source, split.moved)
          : undefined) ??
        picks.map(i => (i >= 0 ? (context.tapered[i] ?? 0) : 0)),
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
    if (isCarrierSpecLayer(f)) {
      if (!spec.carrier) return;
      loaded.push({
        id: null,
        carrier: true,
        fill: false,
        cap: f.cap !== false,
        capCuts: f.capCuts,
        // A placeholder until the reference exists: a `below` plane is measured
        // against the depths the other layers land at.
        layer: { depth: 0 },
      });
      return;
    }
    if (isSyntheticSpecLayer(f)) {
      loaded.push({
        id: null,
        fill: !!f.fill,
        cap: f.cap !== false,
        capCuts: f.capCuts,
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
      capCuts: f.capCuts,
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
  const carrierAt = loaded.findIndex(l => l.carrier);
  const built = buildStackReference(
    carrierAt >= 0 ? layers.filter((_, i) => i !== carrierAt) : layers,
    densified,
    {
      maxNodes: spec.resolve?.maxNodes,
      maxFill: spec.resolve?.maxFill ?? DEFAULT_CHUNK_MAX_FILL,
    },
  );
  if (!built) return null;
  // See the shared path: the carrier is appended after the resample, so a `below`
  // plane can be measured against the depths the column actually reaches.
  let carrierLevel = 0;
  if (carrierAt >= 0 && spec.carrier) {
    carrierLevel = stackCarrierLevel(built.channels, built.masks, spec.carrier);
    const nodes = built.header.nx * built.header.ny;
    built.channels.splice(
      carrierAt,
      0,
      new Float32Array(nodes).fill(carrierLevel),
    );
    built.masks.splice(
      carrierAt,
      0,
      new Uint8Array(nodes).fill(STACK_MASK_DATA),
    );
    layers[carrierAt] = { depth: -carrierLevel };
    loaded[carrierAt].layer = layers[carrierAt];
  }
  // See the shared path: a layer with no data anywhere the chunk is drawn is
  // voided rather than sealed across it.
  const measured = measureStackCoverage(built, densified, built.masks);
  const voided = voidUnmappedLayers(
    built.channels,
    built.masks,
    measured.layerCoverage,
  );
  if (voided.every(Boolean)) return null;
  // Close the block where a surface is not mapped. `buildSurfaceStack` runs the
  // monotone resolve after this, which is what makes two layers tapering toward
  // each other safe.
  const sealing = spec.resolve?.seal !== false;
  const voiding = sealing && spec.resolve?.sealMode === 'void';
  // See the shared path: the run of a taper is measured over the drawn footprint.
  const inside = sealing ? rasterizeStackOutline(built, densified) : null;
  const sealed =
    sealing && !voiding
      ? sealStackChannels(built.channels, built.masks, built.header.nx, {
          mode: spec.resolve?.sealMode,
          minThickness: spec.resolve?.minThickness,
          inside,
          cellSize: (built.header.xinc + built.header.yinc) / 2,
        })
      : null;
  // See the shared path: `void` expands the layer list, so everything below works
  // on `source` rather than assuming one build layer per caller layer.
  const split = voiding
    ? splitVoidChannels(
        built.channels,
        built.masks,
        built.header.nx,
        loaded.map(l => l.fill),
        {
          minThickness: spec.resolve?.minThickness,
          inside,
          cellSize: (built.header.xinc + built.header.yinc) / 2,
        },
      )
    : null;
  const source = split ? split.source : loaded.map((_, i) => i);
  const reference = {
    ...built,
    channels: split?.channels ?? sealed?.channels ?? built.channels,
    masks: split?.masks ?? built.masks,
  };
  // See the shared path: nothing pierces the carrier.
  const carrierLayer = source.findIndex(i => loaded[i].carrier);
  if (carrierLayer >= 0) {
    clampStackToCarrier(reference.channels, carrierLayer, carrierLevel);
  }
  const tReference = performance.now();

  const { candidates, poolSize } = await refineStackChannels(
    reference.channels,
    reference.header.nx,
    maxError,
  );
  const tRefine = performance.now();

  // A voided layer draws no cap, and neither interval it bounds is filled.
  const caps = source.map(i => loaded[i].cap && !voided[i]);
  const cuts = densifyChunkCuts(spec);
  const capCuts = source.map(i => loaded[i].capCuts ?? null);
  // See the shared path: the floor is only ever seen from below.
  const ceilings = source.map(
    (i, k) => (split ? split.ceiling[k] : false) || !!loaded[i].carrier,
  );
  const fills = (split ? split.fill : loaded.map(l => l.fill)).map((f, k) => {
    const below = source[k + 1];
    return f && !voided[source[k]] && !(below !== undefined && voided[below]);
  });

  const build = buildSurfaceStack(
    reference,
    source.map(i => layers[i]),
    {
      polygon: densified,
      maxError,
      candidates,
      resolve: spec.resolve
        ? { mode: spec.resolve.mode, minGap: spec.resolve.minGap }
        : undefined,
      collapseThreshold: spec.resolve?.collapseThreshold,
      coverageAbsence: sealing ? false : spec.resolve?.coverageAbsence,
      refineTerminations: spec.resolve?.refineTerminations,
      caps,
      cuts,
      capCuts,
      fills,
      carrier: carrierLayer >= 0 ? carrierLayer : undefined,
      ceiling: ceilings,
      inferred: split?.inferred ?? sealed?.inferred,
    },
  );
  if (!build) return null;

  return {
    build,
    loaded,
    source,
    fills,
    ceilings,
    bytes,
    fetchMs: tFetch - t0,
    referenceMs: tReference - tFetch,
    refineMs: tRefine - tReference,
    poolSize,
    referenceNodes: reference.header.nx * reference.header.ny,
    referenceStep: reference.step,
    densified,
    layerCoverage: measured.layerCoverage,
    layerFilled: measured.layerFilled,
    layerVoided: voided,
    layerTapered:
      sealed?.tapered ??
      (split ? taperedBySource(loaded.length, split.source, split.moved) : []),
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
    rimDropped: build.tessellation.rimDropped,
    constraintFailures: build.tessellation.constraintFailures,
    wallRingsDropped: build.ringsDropped,
    wallRingsOpen: build.ringsOpen,
    layers: result.loaded.map((entry, i) => {
      // A layer can have been expanded into several build layers (a void split),
      // so the build's per-layer numbers are gathered by SOURCE rather than read
      // off at the same index.
      const built = result.source
        .map((s, k) => (s === i ? k : -1))
        .filter(k => k >= 0);
      const absent = built.reduce(
        (a, k) => a + (dropped?.droppedAbsent[k] ?? 0),
        0,
      );
      const collapsed = built.reduce(
        (a, k) => a + (dropped?.droppedCollapsed[k] ?? 0),
        0,
      );
      const excluded = built.reduce(
        (a, k) => a + (dropped?.droppedExcluded[k] ?? 0),
        0,
      );
      // Triangles actually drawn, summed over the layer's build copies.
      const triangles = entry.cap
        ? built.reduce(
            (a, k) =>
              a +
              totalTriangles -
              (dropped?.droppedAbsent[k] ?? 0) -
              (dropped?.droppedCollapsed[k] ?? 0) -
              (dropped?.droppedExcluded[k] ?? 0),
            0,
          )
        : 0;
      return {
        index: i,
        id: entry.id,
        coverage: result.layerCoverage[i] ?? 0,
        filled: result.layerFilled[i] ?? 0,
        voided: result.layerVoided[i] ?? false,
        // Every node the layer has no data for is inferred once the block is
        // sealed; measured against the FOOTPRINT, which is the only denominator
        // this table uses. ⚠️ Per layer, not per stack: a layer the seal could not
        // reach is drawn on plain hole fill, and reporting it as inferred anyway
        // is what hid exactly that case.
        inferred:
          (result.layerTapered[i] ?? 0) > 0
            ? 1 - (result.layerCoverage[i] ?? 0)
            : 0,
        // An uncapped layer draws no surface at all, however many triangles
        // survived the drops.
        triangles,
        droppedAbsent: absent,
        droppedCollapsed: collapsed,
        droppedExcluded: excluded,
        capped: entry.cap,
        duplicate: build.duplicates[built[0] ?? i] ?? 0,
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
    fill: i + 1 < result.build.layers.length && result.fills[i],
    wall: result.build.walls[i],
    source: result.source[i] ?? i,
    ceiling: result.ceilings[i] ?? false,
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
