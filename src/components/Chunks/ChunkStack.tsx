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
  StackCarrier,
  SurfaceMeta,
} from '../../sdk';
import { UtmAreaContext } from '../UtmArea';
import { ChunkBuildState, ChunkStackProgress } from './chunk-defs';
import {
  ChunkOutlineEntry,
  ChunkOutlineRegistry,
  ChunkSeamRegistry,
  ChunkStackContext,
  ChunkStackContextValue,
  ChunkSurfaceClaim,
} from './ChunkContext';
import { CutoutSource } from './cutout';
import { resolveWellboreOutline } from './resolveWellboreOutline';
import { resolveSeam, SeamDecision } from './seams';

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
  /**
   * A flat floor closing the whole column, at an absolute `depth` or a margin
   * `below` its deepest mapped sample. Nothing pierces it — a surface that would
   * is truncated at it — so the block is closed from beneath whatever the data
   * does. A chunk draws it by declaring a `{ carrier: true }` layer.
   *
   * ⭐ It belongs to the COLUMN, not to a chunk: two chunks may otherwise hang
   * different floors under one horizon, and the surface between them then has two
   * heights. It also gives the deepest surface a neighbour below, which is what
   * the seal needs to keep it in proportion rather than pinning it to the one
   * layer above.
   */
  carrier?: StackCarrier;
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
 *     <Chunk layers={column.slice(4).map(surface => ({ surface, fill: true }))} />
 *   </ChunkStack>
 * </UtmArea>
 *
 * @group Components
 */
export const ChunkStack = ({
  outline = null,
  cutSource,
  surfaces,
  carrier,
  rimSpacing,
  maxError,
  onProgress,
  children,
}: PropsWithChildren<ChunkStackProps>) => {
  const store = useData();
  const utm = useContext(UtmAreaContext);

  // `carrier={{ below: 800 }}` is the natural way to write this and makes a new
  // object every render, which would rebuild every chunk that draws it.
  const carrierKey = carrier
    ? `${carrier.depth ?? ''}/${carrier.below ?? ''}`
    : '';
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by content above
  const stableCarrier = useMemo(() => carrier, [carrierKey]);

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

  // --- Outline registry: which chunks claim which surface, and (once resolved)
  //     with what footprint. Two things read it: a chunk's top layer is truncated
  //     against a surface the chunk ABOVE draws, and a horizon two chunks share
  //     must be drawn by exactly one of them. See `registerChunk`. -------------
  const claims = useRef(new Map<string, ChunkSurfaceClaim[]>());
  // Settled outlines only: presence in this map IS the "resolved" flag.
  const polygons = useRef(
    new Map<
      string,
      {
        polygon: PlanarPolygonGeometry | null;
        rimSpacing?: number;
        version: number;
      }
    >(),
  );
  const [registry, setRegistry] = useState<ChunkOutlineRegistry>(
    () => new Map(),
  );
  const [seams, setSeams] = useState<ChunkSeamRegistry>(() => new Map());
  const [claimed, setClaimed] = useState<Set<string>>(() => new Set());

  const rebuildRegistry = useCallback(() => {
    const next: ChunkOutlineRegistry = new Map();
    claims.current.forEach((surfaces, key) => {
      const settled = polygons.current.get(key);
      surfaces.forEach(({ id, top }) => {
        const entry: ChunkOutlineEntry = {
          key,
          version: settled?.version ?? 0,
          resolved: polygons.current.has(key),
          polygon: settled?.polygon ?? null,
          rimSpacing: settled?.rimSpacing,
          top,
        };
        const list = next.get(id);
        if (list) list.push(entry);
        else next.set(id, [entry]);
      });
    });

    // ⭐ Who draws a shared horizon is decided here, from the footprints, rather
    // than declared per layer by the caller. A surface still resolving is left out
    // — the chunks claiming it wait rather than build against a guess.
    const decisions: ChunkSeamRegistry = new Map();
    next.forEach((entries, id) => {
      if (entries.length < 2 || entries.some(e => !e.resolved)) return;
      const resolved = resolveSeam(entries);
      const perChunk = new Map<string, SeamDecision>();
      entries.forEach((entry, i) => perChunk.set(entry.key, resolved[i]));
      decisions.set(id, perChunk);
    });

    setRegistry(next);
    setSeams(decisions);
    setClaimed(previous =>
      previous.size === next.size &&
      [...next.keys()].every(id => previous.has(id))
        ? previous
        : new Set(next.keys()),
    );
  }, []);

  const registerChunk = useCallback(
    (key: string, surfaces: ChunkSurfaceClaim[]) => {
      claims.current.set(key, surfaces);
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
    (
      key: string,
      polygon: PlanarPolygonGeometry | null | undefined,
      rimSpacing?: number,
    ) => {
      if (polygon === undefined) {
        if (!polygons.current.has(key)) return;
        polygons.current.delete(key);
      } else {
        const settled = polygons.current.get(key);
        if (
          settled &&
          settled.polygon === polygon &&
          settled.rimSpacing === rimSpacing
        ) {
          return;
        }
        polygons.current.set(key, {
          polygon,
          rimSpacing,
          // A version rather than the polygon's identity, so a chunk consuming this
          // as a CUT has a content key it can memoize on — the registry itself is
          // rebuilt whole on every publish.
          version: (settled?.version ?? 0) + 1,
        });
      }
      rebuildRegistry();
    },
    [rebuildRegistry],
  );

  // What the shared build LOADS: a surface no chunk claims would be fetched,
  // resampled onto the common grid and cascaded through the resolve for nothing.
  // Appearance needs no equivalent — a horizon is drawn by the chunk it is the lid
  // of, so nothing has to be borrowed across a seam.
  const column = useMemo(
    () => surfaces?.filter(m => claimed.has(m.id)),
    [surfaces, claimed],
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
      column,
      carrier: stableCarrier,
      envelope,
      rimSpacing,
      maxError,
      outlines: registry,
      seams,
      registerChunk,
      publishOutline,
      reportBuildState,
    };
  }, [
    outline,
    cutSource,
    surfaces,
    column,
    stableCarrier,
    wellboreEnvelope,
    rimSpacing,
    maxError,
    registry,
    seams,
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
