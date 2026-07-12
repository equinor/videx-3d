import { ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import { useData } from '../../hooks/useData';
import { useGenerator } from '../../hooks/useGenerator';
import {
  ChunkSurfaceLayer,
  PlanarPolygonGeometry,
  SurfaceChunk,
  SurfaceChunkBasement,
  SurfaceMeta,
  unpackSurfaceChunk,
} from '../../sdk';
import { UtmAreaContext } from '../UtmArea';
import { surfaceChunk, SurfaceChunkResponse } from './chunk-defs';
import { buildSurfaceChunkSpec } from './chunk-spec';
import { ChunkStackContext } from './ChunkContext';
import { ChunkMeshes } from './ChunkMeshes';
import { ChunkOutline, CutoutSource, resolveCutoutSource } from './cutout';
import { resolveWellboreOutline } from './resolveWellboreOutline';

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
  /** pinch-out clamp for crossing surfaces (build param). Default false. */
  clamp?: boolean;
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
  clamp = false,
  rimSpacing,
  maxError,
  basement,
  showSurfaces = true,
  showWalls = true,
  children,
}: ChunkProps) => {
  const store = useData();
  const utm = useContext(UtmAreaContext);
  const stack = useContext(ChunkStackContext);

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
  const [wellborePolygon, setWellborePolygon] =
    useState<PlanarPolygonGeometry | null>(null);
  useEffect(() => {
    if (!source || source.kind !== 'wellbores') return;
    if (!store || !utm || groups.length === 0) return;
    const topMeta = firstMeta(groups);
    const baseMeta = lastMeta(groups);
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
    Promise.all([
      store.get<Float32Array>('surface-values', topMeta.id),
      store.get<Float32Array>('surface-values', baseMeta.id),
    ]).then(([topValues, baseValues]) => {
      if (cancelled || !topValues || !baseValues) return;
      return resolveWellboreOutline(
        source.wellbores,
        source.options,
        toLayer(topMeta, topValues),
        toLayer(baseMeta, baseValues),
        store,
        utm.utmToArea,
      ).then(poly => {
        if (!cancelled) setWellborePolygon(poly);
      });
    });
    return () => {
      cancelled = true;
    };
  }, [source, store, utm, groups]);

  const outlinePolygon =
    source?.kind === 'wellbores' ? wellborePolygon : staticPolygon;

  // --- Geometry (layer 2): the heavy build (loading every surface's grid +
  //     clipping/triangulating) runs in a worker generator so it never blocks the
  //     main thread. The main thread only assembles a serializable spec and unpacks
  //     the returned geometry. Rebuilds ONLY on data / outline / build params. ----
  const generator = useGenerator<SurfaceChunkResponse>(surfaceChunk);

  const spec = useMemo(() => {
    if (!outlinePolygon || !utm || groups.length === 0) return null;
    return buildSurfaceChunkSpec(
      groups,
      utm.utmToArea,
      colors,
      outlinePolygon,
      {
        rimSpacing: resolvedRimSpacing,
        maxError: resolvedMaxError,
        clamp,
        basement,
      },
    );
  }, [
    groups,
    utm,
    colors,
    outlinePolygon,
    resolvedRimSpacing,
    resolvedMaxError,
    clamp,
    basement,
  ]);

  const [chunk, setChunk] = useState<SurfaceChunk | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const response = spec ? await generator(spec) : null;
      if (cancelled) return;
      setChunk(response ? unpackSurfaceChunk(response) : null);
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
        showSurfaces={showSurfaces}
        showWalls={showWalls}
      />
      {children}
    </>
  );
};
