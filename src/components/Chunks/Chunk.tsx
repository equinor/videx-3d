import {
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Group, Material } from 'three';
import { useData } from '../../hooks/useData';
import { useGenerator } from '../../hooks/useGenerator';
import {
  ChunkSurfaceLayer,
  PlanarPolygonGeometry,
  polygonArea,
  SurfaceChunk,
  SurfaceChunkMetrics,
  SurfaceMeta,
  unpackSurfaceChunk,
} from '../../sdk';
import { UtmAreaContext } from '../UtmArea';
import {
  EventEmitterCallback,
  useEventEmitter,
} from '../EventEmitter/EventEmitterContext';
import { PointerEvents } from '../../events/interaction-events';
import {
  ChunkBuildState,
  CARRIER_SEAM_ID,
  chunkFluidKey,
  ChunkLayer,
  chunkLayerFill,
  ChunkResolveOptions,
  surfaceChunk,
  SurfaceChunkResponse,
} from './chunk-defs';
import { buildSurfaceChunkSpec } from './chunk-spec';
import { chunkDetailKey } from './chunk-detail';
import { ChunkStackContext, ChunkSurfaceClaim } from './ChunkContext';
import { ChunkMeshes } from './ChunkMeshes';
import { ChunkOutline, CutoutSource, resolveCutoutSource } from './cutout';
import { ChunkInferenceStyle } from './inference-material';
import { resolveWellboreOutline } from './resolveWellboreOutline';
import { SurfaceSamplerRegistryContext } from './surface-sampler';

/** Stable identity for the default resolve options (a new object rebuilds). */
const DEFAULT_RESOLVE: ChunkResolveOptions = {};

/** Identity of one appearance value, so swapping a colour for a Material shows. */
const appearanceId = (value: ChunkLayer['material'] | ChunkLayer['fill']) =>
  value instanceof Material ? value.uuid : String(value);

/**
 * {@link Chunk} props.
 * @expand
 * @group Components
 */
export type ChunkProps = {
  /**
   * The chunk's boundaries in stratigraphic order (shallowest first), each
   * saying whether the interval below it is filled. See {@link ChunkLayer}, and
   * {@link layersFromGroups} for the grouped-zones shorthand.
   *
   * ⚠️ The array order IS the stratigraphic order — nothing here infers it.
   */
  layers: ChunkLayer[];
  /**
   * Outline for the clip. `'inherit'` (default) uses the {@link ChunkStack}
   * outline / cut source; pass a polygon (scene XZ) to override, or a
   * {@link CutoutSource} (e.g. a wellbore-derived outline) for this chunk. A
   * partial wellbore override (`{ kind: 'wellbores', options: {...} }`) inherits
   * the stack's wellbore set and merges its `options` over the stack's.
   */
  outline?: ChunkOutline;
  /** surface (top) opacity. Reactive — does not rebuild geometry. Default 1. */
  surfaceOpacity?: number;
  /** wall opacity. Reactive — does not rebuild geometry. Default 1. */
  wallOpacity?: number;
  /** wireframe. Reactive — does not rebuild geometry. Default false. */
  wireframe?: boolean;
  /**
   * How the INVENTED part of the chunk is marked — the geometry a seal built where
   * no surface was mapped (see `ChunkResolveOptions.seal`), and the faces where a
   * unit ends because we stopped knowing rather than because the geology did.
   * Reactive. Default `'hatched'`.
   */
  inferredStyle?: ChunkInferenceStyle;
  /**
   * How the stack is made monotone before it is built, and what is dropped where
   * a unit is not present (build param). Inherits from the `ChunkStack` when
   * unset, which is where it usually belongs — most of it describes the COLUMN,
   * and two chunks of one column that disagree build that column twice. Memoize
   * the object: a new identity rebuilds the geometry.
   *
   * See {@link ChunkResolveOptions}. The default (`{}`) truncates crossings and
   * drops units that are absent or have no thickness.
   */
  resolve?: ChunkResolveOptions;
  /** rim densification spacing (world units). Inherits from the stack when unset. */
  rimSpacing?: number;
  /** interior simplification error (grid height units). Inherits when unset. */
  maxError?: number;
  /** render the surface tops. Default true. */
  showSurfaces?: boolean;
  /** render the side walls. Default true. */
  showWalls?: boolean;
  /**
   * Called with the build metrics each time the geometry is (re)built. Use it to
   * inspect `metrics.diagnostics` — in particular the crossing counts, which are
   * how a mis-ordered `layers` array makes itself visible (the resolve otherwise
   * dutifully makes ANY order consistent).
   */
  onBuild?: (metrics: SurfaceChunkMetrics) => void;
  /**
   * Called as the chunk moves through its build — for a busy indicator. See
   * {@link ChunkBuildState}; note `'empty'` is an outcome, not a failure.
   *
   * `ChunkStack.onProgress` aggregates the same signal across a whole stack, which
   * is usually the more useful one for a progress bar.
   */
  onBuildStateChange?: (state: ChunkBuildState) => void;
  children?: ReactNode;
} & PointerEvents;

/** Dispose every geometry a built {@link SurfaceChunk} owns. */
function disposeChunk(chunk: SurfaceChunk | null) {
  if (!chunk) return;
  chunk.surfaces.forEach(s => s.geometry.dispose());
  chunk.walls.forEach(w => w.geometry.dispose());
}

/**
 * Builds a solid, layered subsurface **chunk** from a stack of depth surfaces
 * clipped to a shared outline, with coloured side walls.
 *
 * The component keeps three concerns separate so cheap changes stay cheap:
 * - **outline** (which footprint to clip to),
 * - **geometry** (the clipped surfaces + walls) — rebuilt only when the
 *   data, outline, or build parameters change,
 * - **appearance** (opacity / wireframe) — reactive, never rebuilds geometry.
 *
 * Place inside a `UtmArea` (world placement is resolved from the UTM context) and,
 * for correct transparency, inside a rendering pipeline whose base pass is an
 * `OITRenderPass`. Values are fetched from the `DataProvider` store.
 *
 * @example
 * <ChunkStack outline={polygon} carrier={{ below: 800 }}>
 *   <Chunk
 *     layers={[
 *       { surface: topMeta, fill: true },
 *       { surface: midMeta },
 *       // A fill on the LAST layer leaves the block open at the bottom, so the
 *       // stack's carrier closes it.
 *       { surface: reservoirMeta, fill: true },
 *     ]}
 *   />
 * </ChunkStack>
 *
 * @group Components
 */
export const Chunk = ({
  layers,
  outline = 'inherit',

  surfaceOpacity = 1,
  wallOpacity = 1,
  wireframe = false,
  inferredStyle = 'hatched',

  resolve,
  rimSpacing,
  maxError,
  showSurfaces = true,
  showWalls = true,
  onBuild,
  onBuildStateChange,
  onPointerClick,
  onPointerEnter,
  onPointerLeave,
  onPointerMove,
  children,
}: ChunkProps) => {
  const store = useData();
  const utm = useContext(UtmAreaContext);
  const stack = useContext(ChunkStackContext);

  // --- Stable inputs: `layers={[...]}` is the natural way to write this in JSX,
  //     and it makes a NEW array on every render of the parent. Keying the BUILD on
  //     the content that actually affects geometry — the surfaces and which
  //     intervals are filled — is what stops an opacity or material change from
  //     rebuilding it. Materials are appearance and never reach the spec. ---------
  const layersKey = layers
    .map(l => {
      const base = l.surface
        ? l.surface.id
        : // Serialised whole: a relief is a union of shapes with fields of their
          // own, and a hand-written list of them goes stale silently.
          `@${l.depth ?? ''}/${l.offset ?? ''}/${l.relief ? JSON.stringify(l.relief) : ''}`;
      return `${base}:${chunkLayerFill(l) ? 1 : 0}${chunkFluidKey(l)}`;
    })
    .join(',');
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by content above
  const stableLayers = useMemo(() => layers, [layersKey]);

  // The same array for the APPEARANCE layer, keyed on the materials as well.
  // `layersKey` cannot see them by design, so reusing it there froze the materials
  // at whatever they were when the geometry last changed — a caller swapping a
  // colour for a `SurfaceMaterial` (or a hook returning one a render later) never
  // reached `ChunkMeshes`.
  const appearanceKey = layers
    .map(
      l =>
        `${appearanceId(l.material)}|${appearanceId(l.fill)}|${l.opacity ?? ''}|${chunkDetailKey(l.detail)}`,
    )
    .join(',');
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by content above
  const appearanceLayers = useMemo(() => layers, [layersKey, appearanceKey]);

  // Held in a ref so a caller passing an inline callback does not re-trigger the
  // (expensive) build on every render.
  const onBuildRef = useRef(onBuild);
  useEffect(() => {
    onBuildRef.current = onBuild;
  }, [onBuild]);

  const onStateRef = useRef(onBuildStateChange);
  useEffect(() => {
    onStateRef.current = onBuildStateChange;
  }, [onBuildStateChange]);

  const registryKey = useId();
  const { registerChunk, publishOutline, reportBuildState } = stack;

  // Both the caller's callback and the stack's progress counter hear the same
  // thing, so a host can use either without wiring both.
  const reportState = useCallback(
    (state: ChunkBuildState) => {
      onStateRef.current?.(state);
      reportBuildState?.(registryKey, state);
    },
    [reportBuildState, registryKey],
  );

  const resolvedRimSpacing = rimSpacing ?? stack.rimSpacing;
  const resolvedMaxError = maxError ?? stack.maxError;
  const resolvedResolve = resolve ?? stack.resolve ?? DEFAULT_RESOLVE;

  // --- Outline (layer 1): resolve the cut source (explicit prop, else the stack
  //     default). A polygon source resolves synchronously; a wellbore source is
  //     built asynchronously from the chunk's own surfaces + the wellbore data. --
  const source = useMemo<CutoutSource | null>(() => {
    const stackSource: CutoutSource | null =
      stack.cutSource ??
      (stack.outline ? { kind: 'polygon', polygon: stack.outline } : null);
    return resolveCutoutSource(outline, stackSource);
  }, [outline, stack.cutSource, stack.outline]);

  const staticPolygon = useMemo(
    () => (source && source.kind === 'polygon' ? source.polygon : null),
    [source],
  );

  // --- Margin ramp: this chunk's own depth window and margin, published so the
  //     chunks BELOW can buffer this interval with this chunk's margin rather than
  //     their own (see `ChunkStackContextValue.margins`). ---------------------
  const realSurfaces = useMemo(
    () => stableLayers.map(l => l.surface).filter((m): m is SurfaceMeta => !!m),
    [stableLayers],
  );
  const wellboreRadius =
    source?.kind === 'wellbores' ? (source.options?.radius ?? 500) : null;
  const { publishMargin } = stack;
  useEffect(() => {
    if (!publishMargin || wellboreRadius === null) return;
    publishMargin(registryKey, {
      key: registryKey,
      topSurfaceId: realSurfaces[0]?.id,
      baseSurfaceId: realSurfaces[realSurfaces.length - 1]?.id,
      radius: wellboreRadius,
    });
    return () => publishMargin(registryKey, null);
  }, [publishMargin, registryKey, realSurfaces, wellboreRadius]);

  // --- Wellbore-derived outline (layer 1, async): built from the chunk's own top
  //     & base surfaces, so the footprint follows the wells through this chunk's
  //     depth window. Only the bounding surfaces' values are loaded on the main
  //     thread here (the full stack is loaded in the worker). setState only inside
  //     the resolved promise. --------------------------------------------------
  // Wrapped so that "still resolving" (null) is distinguishable from "resolved to
  // no footprint" ({ polygon: null }) — the chunks below wait for the first and
  // must not wait for the second. Note it is only ever settled ASYNCHRONOUSLY, so
  // after an input change the previous outline stands until the new one lands; a
  // chunk below may then build once against the old cover and rebuild. That only
  // happens on a parameter change, which rebuilds every chunk regardless.
  const [wellboreOutline, setWellboreOutline] = useState<{
    polygon: PlanarPolygonGeometry | null;
  } | null>(null);
  const marginRamp = stack.margins;
  // Content key: the ramp is rebuilt whole on every publish, so the array identity
  // churns whenever any sibling settles.
  const marginKey = (marginRamp ?? [])
    .map(
      m =>
        `${m.key}:${m.topSurfaceId ?? ''}:${m.baseSurfaceId ?? ''}:${m.radius}`,
    )
    .join('|');
  useEffect(() => {
    if (!source || source.kind !== 'wellbores') return;
    if (!store || !utm || stableLayers.length === 0) return;
    // The depth window comes from the chunk's REAL surfaces — a synthetic plane
    // has no grid to sample trajectories against, and a chunk may well start with
    // one (water above a seabed).
    const topMeta = realSurfaces[0];
    const baseMeta = realSurfaces[realSurfaces.length - 1];
    // Nothing to resolve against. Settle explicitly rather than returning: an
    // unsettled outline blocks this chunk (and any waiting on it) forever.
    if (!topMeta || !baseMeta) {
      setWellboreOutline({ polygon: null });
      return;
    }
    const mode = source.options?.mode ?? 'window';
    const radius = source.options?.radius ?? 500;

    // Which depth intervals this chunk accumulates, and with whose margin. Under
    // `'window'` it is just this chunk. Under `'above'`/`'below'` every interval
    // on that side counts, each buffered by the margin of the chunk that owns it
    // — which is what keeps the accumulated outlines nested (see
    // `createWellboreOutline`). Waiting for our OWN entry to appear is what stops
    // a chunk building against a half-registered ramp.
    const ramp = marginRamp ?? [];
    const self = ramp.findIndex(m => m.key === registryKey);
    if (mode !== 'window' && self < 0) return;
    const slice =
      mode === 'above'
        ? ramp.slice(0, self + 1)
        : mode === 'below'
          ? ramp.slice(self)
          : [];

    type Bound = { topId?: string; baseId?: string; radius: number };
    const wanted: Bound[] =
      mode === 'window'
        ? [{ topId: topMeta.id, baseId: baseMeta.id, radius }]
        : slice.map((entry, i) => ({
            // Unbounded on the accumulating side at the far end of the ramp.
            topId:
              mode === 'above'
                ? i === 0
                  ? undefined
                  : slice[i - 1].baseSurfaceId
                : entry.topSurfaceId,
            baseId:
              mode === 'above' ? entry.baseSurfaceId : entry.baseSurfaceId,
            radius: entry.radius,
          }));
    if (mode === 'below' && wanted.length > 0)
      wanted[wanted.length - 1].baseId = undefined;

    const byId = new Map<string, SurfaceMeta>();
    for (const m of stack.surfaces ?? []) byId.set(m.id, m);
    for (const m of realSurfaces) byId.set(m.id, m);
    const needed = [
      ...new Set(
        wanted
          .flatMap(w => [w.topId, w.baseId])
          .filter((id): id is string => !!id),
      ),
    ];

    const toLayer = (
      meta: SurfaceMeta,
      values: Float32Array,
    ): ChunkSurfaceLayer => {
      const p = utm.utmToArea(meta.header.xori, meta.header.yori, 0);
      return {
        values,
        header: meta.header,
        worldPosition: [p[0], p[2]],
        referenceDepth: meta.max,
      };
    };
    let cancelled = false;
    const settle = (polygon: PlanarPolygonGeometry | null) => {
      if (!cancelled) setWellboreOutline({ polygon });
    };
    Promise.all(needed.map(id => store.get<Float32Array>('surface-values', id)))
      .then(loaded => {
        if (cancelled) return;
        const bounds = new Map<string, ChunkSurfaceLayer>();
        needed.forEach((id, i) => {
          const meta = byId.get(id);
          const values = loaded[i];
          if (meta && values) bounds.set(id, toLayer(meta, values));
        });
        const intervals = wanted
          .map(w => ({
            top: w.topId ? (bounds.get(w.topId) ?? null) : null,
            base: w.baseId ? (bounds.get(w.baseId) ?? null) : null,
            radius: w.radius,
          }))
          // An interval whose bound failed to load would be silently unbounded,
          // which grows the outline rather than shrinking it — drop it instead.
          .filter(
            (interval, i) =>
              (!wanted[i].topId || interval.top) &&
              (!wanted[i].baseId || interval.base),
          );
        if (intervals.length === 0) return settle(null);
        return resolveWellboreOutline(
          source.wellbores,
          source.options,
          intervals,
          store,
          utm.utmToArea,
        ).then(settle);
      })
      .catch(() => settle(null));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ramp keyed by content
  }, [
    source,
    store,
    utm,
    stableLayers,
    realSurfaces,
    registryKey,
    stack.surfaces,
    marginKey,
  ]);

  const isWellboreSource = source?.kind === 'wellbores';
  const outlinePolygon = isWellboreSource
    ? (wellboreOutline?.polygon ?? null)
    : staticPolygon;
  const outlineSettled = isWellboreSource ? wellboreOutline !== null : true;

  // --- Cover (layer 1b): the chunk's own top layer is truncated against the
  //     surface above it in the COLUMN, which a neighbouring chunk draws with its
  //     own (different) outline. Announce what this chunk draws, publish its
  //     outline, and read back the neighbour's. -------------------------------
  // Only real surfaces take part in the column / seam bookkeeping — a synthetic
  // plane belongs to no column, nothing can be truncated against it there, and no
  // neighbouring chunk can be drawing the same one.
  const surfaceIds = useMemo(
    () =>
      stableLayers
        .map(l => l.surface?.id)
        .filter((id): id is string => id !== undefined),
    [stableLayers],
  );

  const surfaceClaims = useMemo<ChunkSurfaceClaim[]>(
    () =>
      stableLayers.flatMap((l, i) =>
        l.surface
          ? [{ id: l.surface.id, top: i === 0 && chunkLayerFill(l) }]
          : [],
      ),
    [stableLayers],
  );

  // A fill on the last layer leaves the block open at the bottom, so the column's
  // floor closes it (see `buildSurfaceChunkSpec`). It is one plane shared with
  // every other chunk that does the same, so it is claimed like a horizon.
  const drawsCarrier =
    !!stack.carrier &&
    stableLayers.length > 0 &&
    chunkLayerFill(stableLayers[stableLayers.length - 1]);

  const claims = useMemo<ChunkSurfaceClaim[]>(
    () =>
      drawsCarrier
        ? [...surfaceClaims, { id: CARRIER_SEAM_ID, top: false }]
        : surfaceClaims,
    [surfaceClaims, drawsCarrier],
  );

  useEffect(() => {
    if (!registerChunk) return;
    return registerChunk(registryKey, claims);
  }, [registerChunk, registryKey, claims]);

  useEffect(() => {
    publishOutline?.(
      registryKey,
      outlineSettled ? outlinePolygon : undefined,
      resolvedRimSpacing,
    );
  }, [
    publishOutline,
    registryKey,
    outlineSettled,
    outlinePolygon,
    resolvedRimSpacing,
  ]);

  // --- Seams (layer 1c): a horizon two chunks share is drawn by exactly one of
  //     them, decided by the stack from their footprints. -------------------
  // ⚠️ The registry is rebuilt whole on every publish, so keying on its identity
  // would give every chunk a new spec whenever any sibling settled an outline.
  // The floor is in here too, under its own id: it is shared just as a horizon is.
  const seamIds = drawsCarrier ? [...surfaceIds, CARRIER_SEAM_ID] : surfaceIds;
  const seamsKey = seamIds
    .map(id => {
      const decision = stack.seams?.get(id)?.get(registryKey);
      if (!decision) return '';
      const cuts = decision.cuts.map(c => `${c.key}@${c.version}`).join('+');
      return `${decision.draw ? 1 : 0}/${cuts}`;
    })
    .join(',');
  const layerSeams = useMemo(
    () =>
      stableLayers.map(l =>
        l.surface
          ? (stack.seams?.get(l.surface.id)?.get(registryKey) ?? null)
          : null,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by content above
    [stableLayers, registryKey, seamsKey],
  );

  const carrierSeam = useMemo(
    () =>
      drawsCarrier
        ? (stack.seams?.get(CARRIER_SEAM_ID)?.get(registryKey) ?? null)
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by content above
    [drawsCarrier, registryKey, seamsKey],
  );

  // A chunk claiming a surface another one has not placed yet cannot know whether
  // it draws that horizon. Waiting costs one render; building now costs a second
  // full build once the answer arrives.
  const seamsPending = useMemo(
    () =>
      seamIds.some(id => {
        const entries = stack.outlines?.get(id);
        return (
          entries !== undefined &&
          entries.length > 1 &&
          entries.some(e => !e.resolved)
        );
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `seamIds` is derived per render
    [surfaceIds, drawsCarrier, stack.outlines],
  );

  // The stack builds its column from the surfaces its chunks CLAIM, and claims are
  // registered in an effect — so on the first render the column is empty for
  // everyone. Without this wait every chunk would build once against a column
  // missing its own layers, then rebuild.
  const columnPending = useMemo(
    () =>
      surfaceIds.length > 0 &&
      !!stack.surfaces &&
      !surfaceIds.every(id => stack.column?.some(m => m.id === id)),
    [surfaceIds, stack.surfaces, stack.column],
  );

  // The surface directly above this chunk's top, in the column. Whoever draws it
  // is what stands in for the fragments this chunk truncates away.
  const coverAbove = useMemo(() => {
    const none = { polygon: null, pending: false };
    const topId = surfaceIds[0];
    const column = stack.surfaces;
    if (!topId || !column || !stack.outlines) return none;
    const at = column.findIndex(m => m.id === topId);
    if (at <= 0) return none;
    // Nobody claims the surface above, so there is nothing to hide behind.
    const entries = stack.outlines.get(column[at - 1].id);
    if (!entries || entries.length === 0) return none;
    // Registered but not resolved yet: waiting costs one render, whereas building
    // now would cost a second full build once it arrives.
    if (entries.some(e => !e.resolved)) return { polygon: null, pending: true };
    // ⚠️ Several chunks can draw parts of that horizon, and only ONE polygon fits
    // in the spec, so the widest is used. Only the fragments outside it are kept
    // that should have been dropped, and `topKept` measures ~0 on real data — this
    // is insurance, not a visible fix.
    const drawn = entries.filter(
      e =>
        e.polygon &&
        (stack.seams?.get(column[at - 1].id)?.get(e.key)?.draw ?? true),
    );
    let widest: PlanarPolygonGeometry | null = null;
    let best = -Infinity;
    for (const entry of drawn) {
      const area = polygonArea(entry.polygon!);
      if (area > best) {
        best = area;
        widest = entry.polygon;
      }
    }
    return { polygon: widest, pending: false };
  }, [surfaceIds, stack.surfaces, stack.outlines, stack.seams]);

  // --- Geometry (layer 2): the heavy build (loading every surface's grid +
  //     clipping/triangulating) runs in a worker generator so it never blocks the
  //     main thread. The main thread only assembles a serializable spec and unpacks
  //     the returned geometry. Rebuilds ONLY on data / outline / build params. ----
  const generator = useGenerator<SurfaceChunkResponse>(surfaceChunk);

  const spec = useMemo(() => {
    if (!outlinePolygon || !utm || stableLayers.length === 0) return null;
    if (coverAbove.pending || seamsPending || columnPending) return null;
    return buildSurfaceChunkSpec(stableLayers, utm.utmToArea, outlinePolygon, {
      rimSpacing: resolvedRimSpacing,
      maxError: resolvedMaxError,
      resolve: resolvedResolve,
      coverAbove: coverAbove.polygon,
      seams: layerSeams,
      carrierSeam,
      carrier: stack.carrier,
      // Only a declared column with an envelope can be shared; otherwise this
      // chunk builds (and resolves) on its own.
      stack:
        stack.column && stack.column.length > 0 && stack.envelope
          ? { surfaces: stack.column, envelope: stack.envelope }
          : undefined,
    });
  }, [
    stableLayers,
    utm,
    outlinePolygon,
    resolvedRimSpacing,
    resolvedMaxError,
    resolvedResolve,
    coverAbove,
    layerSeams,
    carrierSeam,
    seamsPending,
    columnPending,
    stack.carrier,
    stack.column,
    stack.envelope,
  ]);

  const [chunk, setChunk] = useState<SurfaceChunk | null>(null);
  useEffect(() => {
    if (!spec) {
      // No spec yet: either an input is still resolving (busy), or there is
      // genuinely nothing to draw here.
      reportState(
        outlineSettled &&
          !outlinePolygon &&
          !coverAbove.pending &&
          !seamsPending &&
          !columnPending
          ? 'empty'
          : 'building',
      );
      return;
    }
    let cancelled = false;
    reportState('building');
    (async () => {
      try {
        const response = await generator(spec);
        if (cancelled) return;
        const built = response ? unpackSurfaceChunk(response) : null;
        setChunk(built);
        if (built) onBuildRef.current?.(built.metrics);
        reportState(built ? 'ready' : 'empty');
      } catch (e) {
        if (cancelled) return;
        reportState('failed');
        throw e;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    generator,
    spec,
    reportState,
    outlineSettled,
    outlinePolygon,
    coverAbove.pending,
    seamsPending,
    columnPending,
  ]);

  // Dispose the previous chunk's geometries when it is replaced or unmounted.
  useEffect(() => {
    return () => disposeChunk(chunk);
  }, [chunk]);

  // --- Offer what was drawn for sampling. Ceiling copies are left out: one faces
  //     UP but is the underside of the unit above, and something placed on it
  //     would sit inside the block. ------------------------------------------
  const samplerRegistry = useContext(SurfaceSamplerRegistryContext);
  useEffect(() => {
    if (!samplerRegistry || !chunk) return;
    return samplerRegistry.register(
      registryKey,
      chunk.surfaces
        .filter(mesh => !mesh.ceiling)
        .map(mesh => ({
          id: stableLayers[mesh.layer]?.surface?.id ?? null,
          layer: mesh.layer,
          geometry: mesh.geometry,
        })),
    );
  }, [samplerRegistry, chunk, stableLayers, registryKey]);

  // --- Pointer events: the chunk's OWN meshes are the hit surface, so `children`
  //     stay outside the group. Each mesh carries its layer index in `userData`,
  //     which is what turns "the chunk was hit" into "this unit was hit". -------
  const meshes = useRef<Group>(null);
  const eventHandler = useEventEmitter();
  useEffect(() => {
    if (!eventHandler || !meshes.current) return;
    const handlers: Record<string, EventEmitterCallback> = {};
    if (onPointerClick) handlers.click = onPointerClick;
    if (onPointerEnter) handlers.enter = onPointerEnter;
    if (onPointerLeave) handlers.leave = onPointerLeave;
    if (onPointerMove) handlers.move = onPointerMove;
    if (Object.keys(handlers).length === 0) return;

    return eventHandler.register({ object: meshes.current, handlers });
  }, [
    eventHandler,
    onPointerClick,
    onPointerEnter,
    onPointerLeave,
    onPointerMove,
    chunk,
  ]);

  // --- Appearance / rendering is delegated to ChunkMeshes (reactive layer). ---
  // ⭐ Nothing is borrowed across a seam: a horizon is drawn by the chunk it is the
  // lid of (see `resolveSeam`), so every chunk draws with its OWN appearance.
  if (!chunk) return <>{children}</>;

  return (
    <>
      <group ref={meshes}>
        <ChunkMeshes
          chunk={chunk}
          layers={appearanceLayers}
          surfaceOpacity={surfaceOpacity}
          wallOpacity={wallOpacity}
          wireframe={wireframe}
          inferredStyle={inferredStyle}
          showSurfaces={showSurfaces}
          showWalls={showWalls}
          water={stack.water}
          carrierMaterial={stack.carrierMaterial}
        />
      </group>
      {children}
    </>
  );
};
