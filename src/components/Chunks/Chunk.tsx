import {
  ReactNode,
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
  SurfaceChunk,
  SurfaceChunkBasement,
  SurfaceChunkMetrics,
  SurfaceMeta,
  unpackSurfaceChunk,
} from '../../sdk';
import { UtmAreaContext } from '../UtmArea';
import {
  ChunkResolveOptions,
  surfaceChunk,
  SurfaceChunkResponse,
} from './chunk-defs';
import { buildSurfaceChunkSpec } from './chunk-spec';
import { ChunkStackContext } from './ChunkContext';
import { ChunkMeshes } from './ChunkMeshes';
import { ChunkOutline, CutoutSource, resolveCutoutSource } from './cutout';
import { resolveWellboreOutline } from './resolveWellboreOutline';

/** Stable identity for the default resolve options (a new object rebuilds). */
const DEFAULT_RESOLVE: ChunkResolveOptions = {};

/** Fallback per-layer palette (wall/surface colours are assigned by layer order). */
const DEFAULT_PALETTE = [
  '#4e79a7',
  '#f28e2c',
  '#59a14f',
  '#e15759',
  '#af7aa1',
  '#76b7b2',
  '#edc949',
  '#9c755f',
];

/**
 * {@link Chunk} props.
 * @expand
 * @group Components
 */
export type ChunkProps = {
  /**
   * Surfaces grouped into zones: each inner array is one group, ordered top
   * (shallowest) to base (deepest). Walls fill only the intervals within a group,
   * so adjacent groups are separated by a gap. Callers provide the `SurfaceMeta`
   * (as with `Surface`); the values are fetched from the data store.
   */
  groups: SurfaceMeta[][];
  /**
   * Outline for the clip. `'inherit'` (default) uses the {@link ChunkStack}
   * outline / cut source; pass a polygon (scene XZ) to override, or a
   * {@link CutoutSource} (e.g. a wellbore-derived outline) for this chunk. A
   * partial wellbore override (`{ kind: 'wellbores', options: {...} }`) inherits
   * the stack's wellbore set and merges its `options` over the stack's.
   */
  outline?: ChunkOutline;
  /** per-layer colours, cycled by layer order. Defaults to a built-in palette. */
  colors?: string[];
  /** surface (top) opacity. Reactive — does not rebuild geometry. Default 1. */
  surfaceOpacity?: number;
  /** wall opacity. Reactive — does not rebuild geometry. Default 1. */
  wallOpacity?: number;
  /** wireframe. Reactive — does not rebuild geometry. Default false. */
  wireframe?: boolean;
  /**
   * Material for the chunk's UPPERMOST surface — e.g. a `SurfaceMaterial`. Every
   * other surface, the side walls and the basement keep the standard chunk
   * material built from the layer colours. Reactive.
   *
   * The material is owned by the caller and is never disposed here. Note that
   * where the top layer is absent (not mapped, or truncated away) the layer below
   * shows through with the standard material.
   */
  topMaterial?: Material;
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
   * how a mis-ordered `groups` array makes itself visible (the resolve otherwise
   * dutifully makes ANY order consistent).
   */
  onBuild?: (metrics: SurfaceChunkMetrics) => void;
  children?: ReactNode;
};

/** Shallowest surface meta across all groups (the chunk's top). */
function firstMeta(groups: SurfaceMeta[][]): SurfaceMeta | null {
  for (const g of groups) if (g.length) return g[0];
  return null;
}

/** Deepest surface meta across all groups (the chunk's base). */
function lastMeta(groups: SurfaceMeta[][]): SurfaceMeta | null {
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i];
    if (g.length) return g[g.length - 1];
  }
  return null;
}

/** Dispose every geometry a built {@link SurfaceChunk} owns. */
function disposeChunk(chunk: SurfaceChunk | null) {
  if (!chunk) return;
  chunk.groups.forEach(g => {
    g.surfaces.forEach(s => s.geometry.dispose());
    g.walls.forEach(w => w.geometry.dispose());
  });
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
 *   <Chunk groups={[[topMeta, midMeta], [reservoirMeta]]} basement={{ thickness: 800 }} />
 * </ChunkStack>
 *
 * @group Components
 */
export const Chunk = ({
  groups,
  outline = 'inherit',
  colors = DEFAULT_PALETTE,
  surfaceOpacity = 1,
  wallOpacity = 1,
  wireframe = false,
  topMaterial,
  resolve = DEFAULT_RESOLVE,
  rimSpacing,
  maxError,
  basement,
  showSurfaces = true,
  showWalls = true,
  onBuild,
  children,
}: ChunkProps) => {
  const store = useData();
  const utm = useContext(UtmAreaContext);
  const stack = useContext(ChunkStackContext);

  // Held in a ref so a caller passing an inline callback does not re-trigger the
  // (expensive) build on every render.
  const onBuildRef = useRef(onBuild);
  useEffect(() => {
    onBuildRef.current = onBuild;
  }, [onBuild]);

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
    if (!store || !utm || groups.length === 0) return;
    const topMeta = firstMeta(groups);
    const baseMeta = lastMeta(groups);
    // No surfaces means no claim was registered either, so nothing waits on this.
    if (!topMeta || !baseMeta) return;
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
  }, [source, store, utm, groups]);

  const isWellboreSource = source?.kind === 'wellbores';
  const outlinePolygon = isWellboreSource
    ? (wellboreOutline?.polygon ?? null)
    : staticPolygon;
  const outlineSettled = isWellboreSource ? wellboreOutline !== null : true;

  // --- Cover (layer 1b): the chunk's own top layer is truncated against the
  //     surface above it in the COLUMN, which a neighbouring chunk draws with its
  //     own (different) outline. Announce what this chunk draws, publish its
  //     outline, and read back the neighbour's. -------------------------------
  const surfaceIds = useMemo(() => groups.flat().map(m => m.id), [groups]);
  const registryKey = useId();
  const { registerChunk, publishOutline } = stack;

  useEffect(() => {
    if (!registerChunk) return;
    return registerChunk(registryKey, surfaceIds);
  }, [registerChunk, registryKey, surfaceIds]);

  useEffect(() => {
    publishOutline?.(registryKey, outlineSettled ? outlinePolygon : undefined);
  }, [publishOutline, registryKey, outlineSettled, outlinePolygon]);

  // The surface directly above this chunk's top, in the column. Whoever draws it
  // is what stands in for the fragments this chunk truncates away.
  const coverAbove = useMemo(() => {
    const none = { polygon: null, pending: false };
    const topId = surfaceIds[0];
    const column = stack.surfaces;
    if (!topId || !column || !stack.outlines) return none;
    const at = column.findIndex(m => m.id === topId);
    if (at <= 0) return none;
    // Nobody draws the surface above, so there is nothing to hide behind.
    const entry = stack.outlines.get(column[at - 1].id);
    if (!entry) return none;
    // Registered but not resolved yet: waiting costs one render, whereas building
    // now would cost a second full build once it arrives.
    if (!entry.resolved) return { polygon: null, pending: true };
    return { polygon: entry.polygon, pending: false };
  }, [surfaceIds, stack.surfaces, stack.outlines]);

  // --- Geometry (layer 2): the heavy build (loading every surface's grid +
  //     clipping/triangulating) runs in a worker generator so it never blocks the
  //     main thread. The main thread only assembles a serializable spec and unpacks
  //     the returned geometry. Rebuilds ONLY on data / outline / build params. ----
  const generator = useGenerator<SurfaceChunkResponse>(surfaceChunk);

  const spec = useMemo(() => {
    if (!outlinePolygon || !utm || groups.length === 0) return null;
    if (coverAbove.pending) return null;
    return buildSurfaceChunkSpec(
      groups,
      utm.utmToArea,
      colors,
      outlinePolygon,
      {
        rimSpacing: resolvedRimSpacing,
        maxError: resolvedMaxError,
        resolve,
        basement,
        coverAbove: coverAbove.polygon,
        // Only a declared column with an envelope can be shared; otherwise this
        // chunk builds (and resolves) on its own.
        stack:
          stack.surfaces && stack.surfaces.length > 0 && stack.envelope
            ? { surfaces: stack.surfaces, envelope: stack.envelope }
            : undefined,
      },
    );
  }, [
    groups,
    utm,
    colors,
    outlinePolygon,
    resolvedRimSpacing,
    resolvedMaxError,
    resolve,
    basement,
    coverAbove,
    stack.surfaces,
    stack.envelope,
  ]);

  const [chunk, setChunk] = useState<SurfaceChunk | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const response = spec ? await generator(spec) : null;
      if (cancelled) return;
      const built = response ? unpackSurfaceChunk(response) : null;
      setChunk(built);
      if (built) onBuildRef.current?.(built.metrics);
    })();
    return () => {
      cancelled = true;
    };
  }, [generator, spec]);

  // Dispose the previous chunk's geometries when it is replaced or unmounted.
  useEffect(() => {
    return () => disposeChunk(chunk);
  }, [chunk]);

  // --- Appearance / rendering is delegated to ChunkMeshes (reactive layer). ---
  if (!chunk) return <>{children}</>;

  return (
    <>
      <ChunkMeshes
        chunk={chunk}
        surfaceOpacity={surfaceOpacity}
        wallOpacity={wallOpacity}
        wireframe={wireframe}
        topMaterial={topMaterial}
        showSurfaces={showSurfaces}
        showWalls={showWalls}
      />
      {children}
    </>
  );
};
