import {
  PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { BufferGeometry } from 'three';
import { useData } from '../../hooks/useData';
import { useGenerator } from '../../hooks/useGenerator';
import {
  ChunkSurfaceLayer,
  PlanarPolygonGeometry,
  SurfaceMeta,
  unpackBufferGeometry,
} from '../../sdk';
import { UtmAreaContext } from '../UtmArea';
import { OceanContactContext } from '../Ocean/ocean-contact';
import { OceanSamplerContext } from '../Ocean/ocean-sampler';
import {
  ChunkBuildState,
  ChunkCarrier,
  ChunkResolveOptions,
  ChunkStackProgress,
  stackWater,
  StackWater,
  StackWaterResponse,
} from './chunk-defs';
import {
  ChunkOutlineEntry,
  ChunkOutlineRegistry,
  ChunkSeamRegistry,
  ChunkStackContext,
  ChunkStackContextValue,
  ChunkSurfaceClaim,
} from './ChunkContext';
import { CutoutSource } from './cutout';
import { buildStackWaterSpec } from './chunk-spec';
import { resolveWellboreOutline } from './resolveWellboreOutline';
import { resolveSeam, SeamDecision } from './seams';
import { useStackWater } from './useStackWater';

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
   * does. A chunk draws it when its own LAST layer declares a `fill`: that says
   * the block is open at the bottom, and this is the only thing that can close it.
   *
   * ⭐ It belongs to the COLUMN, not to a chunk: two chunks may otherwise hang
   * different floors under one horizon, and the surface between them then has two
   * heights. It also gives the deepest surface a neighbour below, which is what
   * the seal needs to keep it in proportion rather than pinning it to the one
   * layer above.
   */
  carrier?: ChunkCarrier;
  /**
   * Open water over the whole column: the sea state, its appearance, and how it
   * tints the bed beneath it. See {@link StackWater}.
   *
   * ⭐ Declared HERE rather than on a chunk, for the same reason as `carrier`, and
   * for one more: a sea covers its whole footprint by design, so two chunks each
   * drawing part of it would leave two coplanar lids wherever their footprints
   * overlap. The stack draws it once.
   *
   * It also provides the wave sampler and the contact-foam registry to everything
   * inside it, so a floating child (a vessel, a buoy) heaves with the swell and
   * spreads foam exactly as it would inside an `<Ocean>`. Needs an `outline` — a
   * `cutSource` alone gives nothing to draw the sea over.
   */
  water?: StackWater;
  /**
   * How the column is made monotone before it is built, and what is dropped where
   * a unit is not present. Chunks inherit this unless they declare their own.
   *
   * ⭐ Most of it describes the COLUMN rather than a chunk — `seal`, `sealMode`,
   * `minThickness`, `maxFill`, `maxNodes`, `mode` and `minGap` all feed the shared
   * build — so declaring it here is what lets every chunk (and the sea) share one
   * resolved column instead of building it once per set of options.
   *
   * ⚠️ Memoize it: a new identity rebuilds every chunk.
   */
  resolve?: ChunkResolveOptions;
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
  water,
  resolve,
  rimSpacing,
  maxError,
  onProgress,
  children,
}: PropsWithChildren<ChunkStackProps>) => {
  const store = useData();
  const utm = useContext(UtmAreaContext);

  // `carrier={{ below: 800 }}` is the natural way to write this and makes a new
  // object every render, which would rebuild every chunk that draws it.
  // ⚠️ Keyed on WHERE the plane is and not on how it looks: the material is
  // published separately, so recolouring the floor cannot rebuild geometry.
  const carrierKey = carrier
    ? `${carrier.depth ?? ''}/${carrier.below ?? ''}`
    : '';
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by content above
  const stableCarrier = useMemo(() => carrier, [carrierKey]);

  // Same again for the sea, which every chunk's MATERIALS depend on (the bed
  // tint) — a fresh object each render would rebuild all of them.
  const waterKey = water ? JSON.stringify(water) : '';
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by content above
  const stableWater = useMemo(() => water, [waterKey]);

  // And again for the build options, which decide the identity of the CACHED
  // column: everything cut from it has to ask for it with the same ones.
  const resolveKey = resolve ? JSON.stringify(resolve) : '';
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by content above
  const stableResolve = useMemo(() => resolve, [resolveKey]);

  const sea = useStackWater(stableWater);
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
    claims.current.forEach((claimedSurfaces, key) => {
      const settled = polygons.current.get(key);
      claimedSurfaces.forEach(({ id, top }) => {
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
    (key: string, claimedSurfaces: ChunkSurfaceClaim[]) => {
      claims.current.set(key, claimedSurfaces);
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
      spacing?: number,
    ) => {
      if (polygon === undefined) {
        if (!polygons.current.has(key)) return;
        polygons.current.delete(key);
      } else {
        const settled = polygons.current.get(key);
        if (
          settled &&
          settled.polygon === polygon &&
          settled.rimSpacing === spacing
        ) {
          return;
        }
        polygons.current.set(key, {
          polygon,
          rimSpacing: spacing,
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
      // Read off the LIVE prop, not the geometry-keyed copy, which is deliberately
      // stale whenever only the appearance changed.
      carrierMaterial: carrier?.material,
      water: stableWater ?? null,
      resolve: stableResolve,
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
    carrier?.material,
    stableWater,
    stableResolve,
    wellboreEnvelope,
    rimSpacing,
    maxError,
    registry,
    seams,
    registerChunk,
    publishOutline,
    reportBuildState,
  ]);

  // --- The sea (rendered here, not by a chunk): a lid covers its whole footprint
  //     by design, so two chunks each drawing part of it would leave two coplanar
  //     lids wherever their footprints overlap. -------------------------------
  const waterGenerator = useGenerator<StackWaterResponse>(stackWater);

  const waterSpec = useMemo(() => {
    // Needs a footprint to be drawn over, and a column to end against.
    if (!stableWater || !outline || !utm) return null;
    if (!column || column.length === 0) return null;
    const envelope = value.envelope;
    if (!envelope) return null;
    return buildStackWaterSpec(stableWater, utm.utmToArea, outline, {
      surfaces: column,
      envelope,
      carrier: stableCarrier,
      rimSpacing,
      maxError,
      resolve: stableResolve,
    });
  }, [
    stableWater,
    outline,
    utm,
    column,
    value.envelope,
    stableCarrier,
    rimSpacing,
    maxError,
    stableResolve,
  ]);

  const [seaGeometry, setSeaGeometry] = useState<{
    lid: BufferGeometry | null;
    body: BufferGeometry | null;
  } | null>(null);

  useEffect(() => {
    if (!waterSpec) return;
    let cancelled = false;
    (async () => {
      const response = await waterGenerator(waterSpec);
      if (cancelled) return;
      setSeaGeometry(
        response
          ? {
              lid: response.lid ? unpackBufferGeometry(response.lid) : null,
              body: response.body ? unpackBufferGeometry(response.body) : null,
            }
          : null,
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [waterGenerator, waterSpec]);

  useEffect(() => {
    return () => {
      seaGeometry?.lid?.dispose();
      seaGeometry?.body?.dispose();
    };
  }, [seaGeometry]);

  return (
    <ChunkStackContext.Provider value={value}>
      <OceanSamplerContext.Provider value={sea?.sampler ?? null}>
        <OceanContactContext.Provider value={sea?.contacts ?? null}>
          {sea && seaGeometry?.lid && (
            <mesh geometry={seaGeometry.lid} material={sea.surface} />
          )}
          {sea && seaGeometry?.body && (
            <mesh geometry={seaGeometry.body} material={sea.volume} />
          )}
          {children}
        </OceanContactContext.Provider>
      </OceanSamplerContext.Provider>
    </ChunkStackContext.Provider>
  );
};
