import {
  PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useData } from '../../hooks/useData';
import {
  ChunkSurfaceLayer,
  PlanarPolygonGeometry,
  SurfaceMeta,
} from '../../sdk';
import { UtmAreaContext } from '../UtmArea';
import { ChunkBuildState, ChunkStackProgress } from './chunk-defs';
import {
  ChunkOutlineRegistry,
  ChunkStackContext,
  ChunkStackContextValue,
} from './ChunkContext';
import { CutoutSource } from './cutout';
import { resolveWellboreOutline } from './resolveWellboreOutline';

/**
 * {@link ChunkStack} props.
 * @expand
 * @group Components
 */
export type ChunkStackProps = {
  /**
   * Default outline polygon (scene XZ) shared by child chunks that inherit it
   * (the common case). Individual chunks may override with their own outline.
   */
  outline?: PlanarPolygonGeometry | null;
  /**
   * Default cut source shared by child chunks that inherit it. Use this for a
   * wellbore-derived outline (`{ kind: 'wellbores', wellbores, options }`); takes
   * precedence over `outline` when both are set.
   */
  cutSource?: CutoutSource;
  /**
   * The whole column the child chunks are cut from, **shallowest first** — i.e.
   * the array each chunk's `groups` is sliced out of.
   *
   * ⚠️ The array order IS the stratigraphic order. Sort by stratigraphic age;
   * `SurfaceMeta.min`/`.max` describe a surface's whole extent, not its position
   * inside this stack, and sorting by either misorders a real column.
   *
   * Declaring it lets the generator fetch, resample and make the column monotone
   * **once** for every chunk cut from it — so several chunks agree with each other
   * about depth order instead of each resolving its own layers in isolation, and
   * the cost stays flat as chunks are added. Omit it and each chunk builds
   * independently (chunks can then cross each other where their footprints
   * overlap).
   */
  surfaces?: SurfaceMeta[];
  /** default rim densification spacing (world units) for child chunks */
  rimSpacing?: number;
  /** default interior simplification error (grid height units) for child chunks */
  maxError?: number;
  /**
   * Called whenever a child chunk starts or finishes building — for a busy
   * indicator or a progress bar. See {@link ChunkStackProgress} for why the count
   * is in chunks rather than in work.
   */
  onProgress?: (progress: ChunkStackProgress) => void;
};

/**
 * Groups a set of {@link Chunk} components and publishes shared build inputs (the
 * outline, the column and the tessellation defaults) via context, so chunks can
 * `inherit` them.
 *
 * This is the parent/provider of the chunk component family — analogous to how
 * `Wells` groups `Wellbore`s. Place it inside a `UtmArea` (chunks resolve their
 * world placement from the UTM context).
 *
 * @example
 * <UtmArea origin={origin} utmZone={utmZone}>
 *   <ChunkStack outline={polygon} surfaces={column}>
 *     <Chunk groups={[column.slice(0, 4)]} />
 *     <Chunk groups={[column.slice(4)]} basement={{ thickness: 800 }} />
 *   </ChunkStack>
 * </UtmArea>
 *
 * @group Components
 */
export const ChunkStack = ({
  outline = null,
  cutSource,
  surfaces,
  rimSpacing,
  maxError,
  onProgress,
  children,
}: PropsWithChildren<ChunkStackProps>) => {
  const store = useData();
  const utm = useContext(UtmAreaContext);

  // --- Envelope: the footprint the shared column grid is built over. It must
  //     contain every chunk's outline, so a wellbore cut source is resolved over
  //     the FULL depth window — more trajectory points can only grow the outline,
  //     so the full-window one contains every chunk's narrower window. ----------
  const [wellboreEnvelope, setWellboreEnvelope] =
    useState<PlanarPolygonGeometry | null>(null);

  useEffect(() => {
    if (!cutSource || cutSource.kind !== 'wellbores') return;
    if (!store || !utm || !surfaces || surfaces.length === 0) return;
    const topMeta = surfaces[0];
    const baseMeta = surfaces[surfaces.length - 1];
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
        cutSource.wellbores,
        cutSource.options,
        toLayer(topMeta, topValues),
        toLayer(baseMeta, baseValues),
        store,
        utm.utmToArea,
      ).then(poly => {
        if (!cancelled) setWellboreEnvelope(poly);
      });
    });
    return () => {
      cancelled = true;
    };
  }, [cutSource, store, utm, surfaces]);

  // --- Outline registry: which chunk draws which surface, and (once resolved)
  //     with what footprint. A chunk's top layer is truncated against a surface
  //     the chunk ABOVE draws, so it has to know that chunk's outline before it can
  //     tell a safe drop from a hole. See `registerChunk`. -----------------------
  const claims = useRef(new Map<string, string[]>());
  // Settled outlines only: presence in this map IS the "resolved" flag.
  const polygons = useRef(new Map<string, PlanarPolygonGeometry | null>());
  const [registry, setRegistry] = useState<ChunkOutlineRegistry>(
    () => new Map(),
  );

  const rebuildRegistry = useCallback(() => {
    const next: ChunkOutlineRegistry = new Map();
    claims.current.forEach((surfaceIds, key) => {
      const entry = {
        resolved: polygons.current.has(key),
        polygon: polygons.current.get(key) ?? null,
      };
      surfaceIds.forEach(id => next.set(id, entry));
    });
    setRegistry(next);
  }, []);

  const registerChunk = useCallback(
    (key: string, surfaceIds: string[]) => {
      claims.current.set(key, surfaceIds);
      rebuildRegistry();
      return () => {
        claims.current.delete(key);
        polygons.current.delete(key);
        buildStates.current.delete(key);
        rebuildRegistry();
      };
    },
    [rebuildRegistry],
  );

  // --- Build progress: chunks report their own state, the stack counts them. A
  //     registered chunk that has not reported yet is still building. ----------
  const buildStates = useRef(new Map<string, ChunkBuildState>());
  const onProgressRef = useRef(onProgress);
  useEffect(() => {
    onProgressRef.current = onProgress;
  }, [onProgress]);

  const reportBuildState = useCallback(
    (key: string, state: ChunkBuildState) => {
      if (buildStates.current.get(key) === state) return;
      buildStates.current.set(key, state);
      const total = claims.current.size;
      let completed = 0;
      claims.current.forEach((_, k) => {
        const s = buildStates.current.get(k);
        if (s && s !== 'building') completed++;
      });
      onProgressRef.current?.({
        total,
        building: total - completed,
        completed,
        fraction: total === 0 ? 1 : completed / total,
      });
    },
    [],
  );

  const publishOutline = useCallback(
    (key: string, polygon: PlanarPolygonGeometry | null | undefined) => {
      if (polygon === undefined) {
        if (!polygons.current.has(key)) return;
        polygons.current.delete(key);
      } else {
        if (
          polygons.current.has(key) &&
          polygons.current.get(key) === polygon
        ) {
          return;
        }
        polygons.current.set(key, polygon);
      }
      rebuildRegistry();
    },
    [rebuildRegistry],
  );

  const value = useMemo<ChunkStackContextValue>(() => {
    const envelope =
      cutSource?.kind === 'wellbores'
        ? wellboreEnvelope
        : cutSource?.kind === 'polygon'
          ? cutSource.polygon
          : outline;
    return {
      outline,
      cutSource,
      surfaces,
      envelope,
      rimSpacing,
      maxError,
      outlines: registry,
      registerChunk,
      publishOutline,
      reportBuildState,
    };
  }, [
    outline,
    cutSource,
    surfaces,
    wellboreEnvelope,
    rimSpacing,
    maxError,
    registry,
    registerChunk,
    publishOutline,
    reportBuildState,
  ]);

  return (
    <ChunkStackContext.Provider value={value}>
      {children}
    </ChunkStackContext.Provider>
  );
};
