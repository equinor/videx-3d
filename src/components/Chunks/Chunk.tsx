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
import { Material } from 'three';
import { useData } from '../../hooks/useData';
import { useGenerator } from '../../hooks/useGenerator';
import {
  ChunkSurfaceLayer,
  PlanarPolygonGeometry,
  polygonArea,
  SurfaceChunk,
  SurfaceChunkBasement,
  SurfaceChunkMetrics,
  SurfaceMeta,
  unpackSurfaceChunk,
} from '../../sdk';
import { UtmAreaContext } from '../UtmArea';
import {
  ChunkBuildState,
  ChunkLayer,
  ChunkResolveOptions,
  hasFill,
  surfaceChunk,
  SurfaceChunkResponse,
} from './chunk-defs';
import { buildSurfaceChunkSpec } from './chunk-spec';
import { ChunkStackContext, ChunkSurfaceClaim } from './ChunkContext';
import { ChunkMeshes } from './ChunkMeshes';
import { ChunkOutline, CutoutSource, resolveCutoutSource } from './cutout';
import { ChunkInferenceStyle } from './inference-material';
import { resolveWellboreOutline } from './resolveWellboreOutline';

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
   * a unit is not present (build param). Omit to skip the pass entirely — the
   * surfaces are then drawn exactly as the data has them, crossings included.
   * Memoize the object: a new identity rebuilds the geometry.
   *
   * See {@link ChunkResolveOptions}. The default (`{}`) truncates crossings and
   * drops units that are absent or have no thickness.
   */
  resolve?: ChunkResolveOptions;
  /** rim densification spacing (world units). Inherits from the stack when unset. */
  rimSpacing?: number;
  /** interior simplification error (grid height units). Inherits when unset. */
  maxError?: number;
  /** optional basement block (see {@link SurfaceChunkBasement}). */
  basement?: SurfaceChunkBasement;
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
};

/** Dispose every geometry a built {@link SurfaceChunk} owns. */
function disposeChunk(chunk: SurfaceChunk | null) {
  if (!chunk) return;
  chunk.surfaces.forEach(s => s.geometry.dispose());
  chunk.walls.forEach(w => w.geometry.dispose());
  chunk.basement?.surfaces.forEach(s => s.geometry.dispose());
  chunk.basement?.walls.forEach(w => w.geometry.dispose());
  chunk.oceanTop?.surface.dispose();
  chunk.oceanTop?.body.dispose();
  chunk.oceanTop?.bed?.dispose();
}

/**
 * Builds a solid, layered subsurface **chunk** from a stack of depth surfaces
 * clipped to a shared outline, with coloured side walls and an optional basement.
 *
 * The component keeps three concerns separate so cheap changes stay cheap:
 * - **outline** (which footprint to clip to),
 * - **geometry** (the clipped surfaces + walls + basement) — rebuilt only when the
 *   data, outline, or build parameters change,
 * - **appearance** (opacity / wireframe) — reactive, never rebuilds geometry.
 *
 * Place inside a `UtmArea` (world placement is resolved from the UTM context) and,
 * for correct transparency, inside a rendering pipeline whose base pass is an
 * `OITRenderPass`. Values are fetched from the `DataProvider` store.
 *
 * @example
 * <ChunkStack outline={polygon}>
 *   <Chunk
 *     layers={[
 *       { surface: topMeta, fill: true },
 *       { surface: midMeta },
 *       { surface: reservoirMeta },
 *     ]}
 *     basement={{ thickness: 800 }}
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

  resolve = DEFAULT_RESOLVE,
  rimSpacing,
  maxError,
  basement,
  showSurfaces = true,
  showWalls = true,
  onBuild,
  onBuildStateChange,
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
        : `@${l.depth ?? ''}/${l.offset ?? ''}/${
            l.relief
              ? `${l.relief.kind ?? 'dunes'}:${l.relief.amplitude}:${l.relief.seed ?? 0}:${l.relief.featureSize ?? ''}:${l.relief.mode ?? ''}`
              : ''
          }`;
      return `${base}:${hasFill(l.fill) ? 1 : 0}`;
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
        `${appearanceId(l.material)}|${appearanceId(l.fill)}|${l.opacity ?? ''}`,
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

  // --- Wellbore-derived outline (layer 1, async): built from the chunk's own top
  //     & base surfaces, so the footprint follows the wells through this chunk's
  //     depth window. Only the two bounding surfaces' values are loaded on the main
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
  useEffect(() => {
    if (!source || source.kind !== 'wellbores') return;
    if (!store || !utm || stableLayers.length === 0) return;
    // The depth window comes from the chunk's REAL surfaces — a synthetic plane
    // has no grid to sample trajectories against, and a chunk may well start with
    // one (water above a seabed).
    const real = stableLayers
      .map(l => l.surface)
      .filter((m): m is SurfaceMeta => !!m);
    const topMeta = real[0];
    const baseMeta = real[real.length - 1];
    // Nothing to resolve against. Settle explicitly rather than returning: an
    // unsettled outline blocks this chunk (and any waiting on it) forever.
    if (!topMeta || !baseMeta) {
      setWellboreOutline({ polygon: null });
      return;
    }
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
    Promise.all([
      store.get<Float32Array>('surface-values', topMeta.id),
      store.get<Float32Array>('surface-values', baseMeta.id),
    ])
      .then(([topValues, baseValues]) => {
        if (cancelled) return;
        if (!topValues || !baseValues) return settle(null);
        return resolveWellboreOutline(
          source.wellbores,
          source.options,
          toLayer(topMeta, topValues),
          toLayer(baseMeta, baseValues),
          store,
          utm.utmToArea,
        ).then(settle);
      })
      .catch(() => settle(null));
    return () => {
      cancelled = true;
    };
  }, [source, store, utm, stableLayers]);

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
        l.surface ? [{ id: l.surface.id, top: i === 0 }] : [],
      ),
    [stableLayers],
  );

  useEffect(() => {
    if (!registerChunk) return;
    return registerChunk(registryKey, surfaceClaims);
  }, [registerChunk, registryKey, surfaceClaims]);

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
  const seamsKey = surfaceIds
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

  // A chunk claiming a surface another one has not placed yet cannot know whether
  // it draws that horizon. Waiting costs one render; building now costs a second
  // full build once the answer arrives.
  const seamsPending = useMemo(
    () =>
      surfaceIds.some(id => {
        const entries = stack.outlines?.get(id);
        return (
          entries !== undefined &&
          entries.length > 1 &&
          entries.some(e => !e.resolved)
        );
      }),
    [surfaceIds, stack.outlines],
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
      resolve,
      basement,
      coverAbove: coverAbove.polygon,
      seams: layerSeams,
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
    resolve,
    basement,
    coverAbove,
    layerSeams,
    seamsPending,
    columnPending,
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

  // --- Appearance / rendering is delegated to ChunkMeshes (reactive layer). ---
  // ⭐ Nothing is borrowed across a seam: a horizon is drawn by the chunk it is the
  // lid of (see `resolveSeam`), so every chunk draws with its OWN appearance.
  if (!chunk) return <>{children}</>;

  return (
    <>
      <ChunkMeshes
        chunk={chunk}
        layers={appearanceLayers}
        surfaceOpacity={surfaceOpacity}
        wallOpacity={wallOpacity}
        wireframe={wireframe}
        inferredStyle={inferredStyle}
        showSurfaces={showSurfaces}
        showWalls={showWalls}
      />
      {children}
    </>
  );
};
