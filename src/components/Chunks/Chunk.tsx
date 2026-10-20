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
import { Group } from 'three';
import { useGenerator } from '../../hooks/useGenerator';
import {
  createSurfaceChunkProgress,
  createSurfaceChunkReceiver,
  PlanarPolygonCoordinates,
  PlanarPolygonGeometry,
  polygonArea,
  SurfaceChunk,
  SurfaceChunkMetrics,
  SurfaceChunkPacket,
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
  ChunkBuildProgress,
  ChunkBuildState,
  CARRIER_SEAM_ID,
  chunkCutDepths,
  ChunkLayer,
  chunkLayerFill,
  ChunkPeel,
  ChunkResolveOptions,
  resolvePeel,
  surfaceChunk,
  SurfaceChunkResponse,
  wellboreOutline as wellboreOutlineKey,
  WellboreOutlineResponse,
} from './chunk-defs';
import { buildSurfaceChunkSpec } from './chunk-spec';
import { chunkDetailKey } from './chunk-detail';
import { trackChunk, untrackChunk, releaseGeometry } from './chunk-resources';
import { ChunkStackContext, ChunkSurfaceClaim } from './ChunkContext';
import { ChunkMeshes, ChunkMeshesProps } from './ChunkMeshes';
import { chunkLayerReveal, chunkLayers } from './chunk-reveal';
import { ChunkOutline, CutoutSource, resolveCutoutSource } from './cutout';
import { ChunkInferenceStyle } from './inference-material';
import { resolveWellboreOutline } from './resolveWellboreOutline';
import { SurfaceSamplerRegistryContext } from './surface-sampler';
import { useStaggeredReveal } from './useStaggeredReveal';

/** Stable identity for the default resolve options (a new object rebuilds). */
const DEFAULT_RESOLVE: ChunkResolveOptions = {};

// Ordinal of a build request, so the generator can tell a superseded one from the
// current one. ⚠️ MODULE scope, not a component ref: the worker's claim for a key
// survives HMR and remounts, and a per-instance counter restarting at 0 would make
// every request from the remounted chunk look superseded — nothing would build.
let buildTokens = 0;
const nextBuildToken = () => ++buildTokens;

/**
 * What is on screen. A streamed build hands out a new chunk object per packet over
 * the SAME geometries, so it is the build, through its latest object, that owns
 * them.
 */
type ShownChunk = {
  chunk: SurfaceChunk;
  build: { latest: SurfaceChunk };
  complete: boolean;
  /** the layers whose caps have arrived, in arrival order — all of them once complete */
  ready: number[];
};

/** A coarse stand-in for the chunk being built (see `SurfaceChunkPreviewPacket`). */
type PreviewChunk = {
  chunk: SurfaceChunk;
  build: { latest: SurfaceChunk };
};

/**
 * How long a chunk waits on the stack's sibling bookkeeping before calling it a
 * deadlock and failing. Generous, because it only has to outlast a few frames.
 */
const STALL_TIMEOUT_MS = 15000;

/** Identity of one appearance value, so a colour or fill-flag change shows. */
const appearanceId = (value: ChunkLayer['material'] | ChunkLayer['fill']) =>
  String(value);

type ChunkLayerKeyRole = {
  /** keys the GEOMETRY: a change here rebuilds the chunk */
  build?: (layer: ChunkLayer) => string;
  /** keys the MATERIALS: a change here only re-runs `ChunkMeshes` */
  appearance?: (layer: ChunkLayer) => string;
};

// ⭐ SINGLE SOURCE OF TRUTH for the two content keys built below. The `satisfies`
// makes TypeScript error the moment a `ChunkLayer` field is added without deciding
// what it affects — the "forgot to key it" bug this pair has shipped more than once
// (a field missing from the build key silently does nothing; from the appearance
// key it freezes at its last-built value).
const CHUNK_LAYER_KEY = {
  surface: { build: l => l.surface?.id ?? '' },
  depth: { build: l => `${l.depth ?? ''}` },
  offset: { build: l => `${l.offset ?? ''}` },
  // A relief is a union of shapes with fields of their own; serialise it whole.
  relief: { build: l => (l.relief ? JSON.stringify(l.relief) : '') },
  // Presence is geometry (the wall exists or not); the colour is appearance.
  fill: {
    build: l => (chunkLayerFill(l) ? '1' : '0'),
    appearance: l => appearanceId(l.fill),
  },
  material: { appearance: l => appearanceId(l.material) },
  detail: { appearance: l => chunkDetailKey(l.detail) },
  opacity: { appearance: l => `${l.opacity ?? ''}` },
  capOpacity: { appearance: l => `${l.capOpacity ?? ''}` },
  section: { appearance: l => (l.section === false ? '0' : '1') },
  keepCap: { appearance: l => (l.keepCap ? '1' : '0') },
  contacts: {
    appearance: l =>
      l.contacts === false ? 'none' : (l.contacts?.join('+') ?? ''),
  },
} satisfies Record<keyof ChunkLayer, ChunkLayerKeyRole>;

const CHUNK_LAYER_KEY_ROLES: ChunkLayerKeyRole[] =
  Object.values(CHUNK_LAYER_KEY);

const chunkLayersBuildKey = (layers: ChunkLayer[]) =>
  layers
    .map(l => CHUNK_LAYER_KEY_ROLES.map(r => r.build?.(l) ?? '').join('/'))
    .join(',');

const chunkLayersAppearanceKey = (layers: ChunkLayer[]) =>
  layers
    .map(l => CHUNK_LAYER_KEY_ROLES.map(r => r.appearance?.(l) ?? '').join('/'))
    .join(',');

/**
 * {@link Chunk} props.
 * @expand
 * @group Components
 */
export type ChunkProps = {
  /**
   * Display name, shown per chunk by the progress displays (see
   * {@link ChunkStackProgress.chunks}) and used for its Object3D group.
   */
  name?: string;
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
  /**
   * Measure and report `metrics.diagnostics` (see `onBuild`). Off by default: on a
   * field column the measuring alone costs about a second of the build. Inherits
   * from the stack when unset.
   */
  diagnostics?: boolean;
  /**
   * Show a coarse version of the chunk while the real geometry builds. It is
   * replaced layer by layer, each as soon as the real one arrives. Only a chunk of
   * a `ChunkStack` column gets one. Inherits from the stack when unset; default true.
   */
  preview?: boolean;
  /**
   * Saturation the preview is drawn with, so it reads as provisional: 0 grey, 1 as
   * the real chunk. Inherits from the stack when unset; default 0.5.
   */
  previewSaturation?: number;
  /**
   * Tint by tessellation tile and draw the seams, when the chunk was built in
   * tiles (`ChunkResolveOptions.tileCells`): by level of detail while one is
   * chosen per tile, otherwise a checker. Appearance only. Inherits from the
   * stack when unset; default false.
   */
  debugTiles?: boolean;
  /**
   * Draw every cap at this coarser level of detail (1 = the first), when the
   * chunk was built with `resolve.lod`. A debug view, appearance only: culling and
   * peel patches are off while it is set. Inherits from the stack; default 0.
   */
  lodLevel?: number;
  /**
   * With levels of detail built (`resolve.lod`), pick one per tile so its height
   * error stays under this many pixels on screen; 0 = full detail. Appearance only.
   * Inherits from the stack; default 2.
   */
  lodPixelError?: number;
  /** render the surface tops. Default true. */
  showSurfaces?: boolean;
  /** render the side walls. Default true. */
  showWalls?: boolean;
  /**
   * Skip the parts of each cap that lie between two opaque, closed units, where
   * nothing can see them. Reactive — appearance only, no rebuild. Default true.
   *
   * ⭐ On a deep column most cap area is buried like this, and drawing it costs
   * fill rate for nothing. A unit counts as open — and the caps facing it are
   * drawn — while it is peeled, cut away, see-through, or the camera is inside
   * it. A transparent cap, wireframe or hidden walls switch culling off.
   */
  cullHiddenCaps?: boolean;
  /**
   * While levels of detail are drawn (`resolve.lod`), skip each cap's tiles that lie
   * wholly outside the camera's view. Saves vertex work, which grows with the
   * triangle count — most in close-ups and inside the column. Reactive, no rebuild.
   * Default true.
   *
   * ⚠️ Tested against the camera the chunk renders with; turn it off when the same
   * scene is drawn from a second camera as well.
   */
  cullOffscreen?: boolean;
  /**
   * Peel units away to expose what is under them. A number peels that many off the
   * TOP (a prefix — the first survivor's own cap keeps the block closed); the
   * object form `{ from, count }` opens a WINDOW, peeling the top down to `from`
   * AND the bottom up, so `{ from, count: 1 }` isolates a single unit. A falsy
   * `count` means "to the bottom" (not windowed). See {@link ChunkPeel}. Default 0.
   *
   * ⭐ Exact and free, unlike a transparency slider: alpha compounds, so a deep
   * stack at 0.5 is effectively opaque and cannot answer "what is underneath". Not
   * drawing part of the depth-ordered `layers` is exact; the window's exposed base
   * is sealed by the next surface's cap, which already exists.
   *
   * ⚠️ Pure appearance: no rebuild, so it is free to sweep or animate. With the
   * stack's `prepareCuts` off, its PRESENCE (even `peel={0}`) asks the build for
   * the extra indices a peel needs, so adding or removing the prop does rebuild.
   *
   * ⚠️ If the window's base boundary is a void split (a ceiling/floor pair) the
   * floor falls back to the horizon copy; where a void cavity is open there is no
   * surface to seal against — outside the normal focus-on-a-unit case.
   */
  peel?: ChunkPeel;
  /**
   * Called with the build metrics each time the geometry is (re)built. Use it to
   * inspect `metrics.diagnostics` (present only with `diagnostics`) — in particular the crossing counts, which are
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

/**
 * Release everything a built {@link SurfaceChunk} owns, and empty it.
 *
 * ⭐ Deferred to a microtask: this runs from an effect cleanup, and the meshes
 * that were drawing these geometries unmount in the same commit. Stripping them
 * a task later means nothing can read an emptied attribute.
 */
function disposeChunk(chunk: SurfaceChunk | null) {
  if (!chunk) return;
  queueMicrotask(() => {
    chunk.surfaces.forEach(mesh => releaseGeometry(mesh.geometry));
    chunk.walls.forEach(wall => releaseGeometry(wall.geometry));
    // The channels the section cuts from are the other half of a chunk's weight.
    chunk.surfaces.length = 0;
    chunk.walls.length = 0;
    chunk.section = undefined;
  });
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
 * Place inside a `UtmArea` (world placement is resolved from the UTM context).
 * Semi-transparent layers need a rendering pipeline whose base pass is an
 * `OITRenderPass` to be ordered correctly — the materials shipped here support
 * one; an opaque stack needs no such pipeline. Values are fetched from the
 * `DataProvider` store.
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
  name,
  layers,
  outline = 'inherit',

  surfaceOpacity = 1,
  wallOpacity = 1,
  wireframe = false,
  inferredStyle = 'hatched',

  resolve,
  rimSpacing,
  maxError,
  diagnostics,
  preview,
  previewSaturation,
  debugTiles,
  lodLevel,
  lodPixelError,
  showSurfaces = true,
  showWalls = true,
  cullHiddenCaps = true,
  cullOffscreen = true,
  peel,
  onBuild,
  onBuildStateChange,
  onPointerClick,
  onPointerEnter,
  onPointerLeave,
  onPointerMove,
  children,
}: ChunkProps) => {
  const utm = useContext(UtmAreaContext);
  const stack = useContext(ChunkStackContext);

  // --- Stable inputs: `layers={[...]}` is the natural way to write this in JSX,
  //     and it makes a NEW array on every render of the parent. Keying the BUILD on
  //     the content that actually affects geometry — the surfaces and which
  //     intervals are filled — is what stops an opacity or material change from
  //     rebuilding it. Materials are appearance and never reach the spec. ---------
  const layersKey = chunkLayersBuildKey(layers);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by content above
  const stableLayers = useMemo(() => layers, [layersKey]);

  // The same array for the APPEARANCE layer. `layersKey` cannot see the materials
  // by design, so reusing it there froze them at whatever they were when the
  // geometry last changed.
  const appearanceKey = chunkLayersAppearanceKey(layers);
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
  const {
    registerChunk,
    releaseChunk,
    publishOutline,
    reportBuildState,
    reportBuildProgress,
    nameChunk,
  } = stack;

  // Released on UNMOUNT only, through a ref so the effect never re-runs: the
  // registration cleanup fires on every claims change too, and clearing the
  // outline there would leave it unresolved for good.
  const releaseRef = useRef(releaseChunk);
  releaseRef.current = releaseChunk;
  useEffect(() => () => releaseRef.current?.(registryKey), [registryKey]);

  useEffect(() => {
    nameChunk?.(registryKey, name);
  }, [nameChunk, registryKey, name]);

  // Both the caller's callback and the stack's progress counter hear the same
  // thing, so a host can use either without wiring both.
  const reportState = useCallback(
    (state: ChunkBuildState, metrics?: SurfaceChunkMetrics) => {
      onStateRef.current?.(state);
      reportBuildState?.(registryKey, state, metrics);
    },
    [reportBuildState, registryKey],
  );

  const reportStep = useCallback(
    (step: ChunkBuildProgress) => reportBuildProgress?.(registryKey, step),
    [reportBuildProgress, registryKey],
  );

  const resolvedRimSpacing = rimSpacing ?? stack.rimSpacing;
  const resolvedMaxError = maxError ?? stack.maxError;
  const resolvedDiagnostics = diagnostics ?? stack.diagnostics ?? false;
  const resolvedPreview = preview ?? stack.preview ?? true;
  const resolvedPreviewSaturation =
    previewSaturation ?? stack.previewSaturation ?? 0.5;
  const resolvedDebugTiles = debugTiles ?? stack.debugTiles ?? false;
  const resolvedLodLevel = lodLevel ?? stack.lodLevel ?? 0;
  const resolvedLodPixelError = lodPixelError ?? stack.lodPixelError ?? 2;
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
  //     depth window. Built by the `wellboreOutline` generator, so the surface
  //     grids never reach the main thread. setState only inside the resolved
  //     promise. ---------------------------------------------------------------
  // Wrapped so that "still resolving" (null) is distinguishable from "resolved to
  // no footprint" ({ polygon: null }) — the chunks below wait for the first and
  // must not wait for the second. Note it is only ever settled ASYNCHRONOUSLY, so
  // after an input change the previous outline stands until the new one lands; a
  // chunk below may then build once against the old cover and rebuild. That only
  // happens on a parameter change, which rebuilds every chunk regardless.
  const [wellboreOutline, setWellboreOutline] = useState<{
    polygon: PlanarPolygonGeometry | null;
  } | null>(null);
  const outlineGenerator =
    useGenerator<WellboreOutlineResponse>(wellboreOutlineKey);
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
    if (!utm || stableLayers.length === 0) return;
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
    const metaOf = (id?: string) => (id ? (byId.get(id) ?? null) : null);
    // A bound whose surface is unknown would be silently unbounded, which grows
    // the outline rather than shrinking it — drop the interval instead.
    const intervals = wanted
      .filter(
        w =>
          (!w.topId || byId.has(w.topId)) && (!w.baseId || byId.has(w.baseId)),
      )
      .map(w => ({
        top: metaOf(w.topId),
        base: metaOf(w.baseId),
        radius: w.radius,
      }));

    let cancelled = false;
    const settle = (polygon: PlanarPolygonGeometry | null) => {
      if (!cancelled) setWellboreOutline({ polygon });
    };
    resolveWellboreOutline(
      outlineGenerator,
      source.wellbores,
      source.options,
      intervals,
      utm.utmToArea,
    )
      .then(settle)
      .catch(() => settle(null));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ramp keyed by content
  }, [
    source,
    outlineGenerator,
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

  // ⚠️ From the APPEARANCE layers: `section` is appearance, so the build-keyed array never sees it.
  const cutDepths = useMemo(
    () => chunkCutDepths(appearanceLayers, drawsCarrier),
    [appearanceLayers, drawsCarrier],
  );
  const { publishCutDepths } = stack;
  useEffect(() => {
    if (!publishCutDepths) return;
    publishCutDepths(registryKey, cutDepths);
    return () => publishCutDepths(registryKey, null);
  }, [publishCutDepths, registryKey, cutDepths]);

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

  // ⚠️ A layer the stack's own `surfaces` never contained can never enter the
  // column, so `columnPending` above would wait for it forever. That is a caller
  // error, not a slow load, and it is knowable straight away.
  const unlisted = useMemo(
    () =>
      stack.surfaces
        ? surfaceIds.filter(id => !stack.surfaces!.some(m => m.id === id))
        : [],
    [surfaceIds, stack.surfaces],
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

  // Both a peel and a cut can hide the layer a cap's collapse relied on covering
  // it, so the build has to keep what it dropped on that strength. Keyed on the
  // PRESENCE of a peel, so changing its value never rebuilds.
  // ⚠️ A primitive: the section and fence state objects come and go with the cut.
  const cutsPrepared = stack.prepareCuts === true;
  const peelable = peel !== undefined || cutsPrepared;

  const spec = useMemo(() => {
    if (!outlinePolygon || !utm || stableLayers.length === 0) return null;
    if (coverAbove.pending || seamsPending || columnPending) return null;
    return buildSurfaceChunkSpec(stableLayers, utm.utmToArea, outlinePolygon, {
      rimSpacing: resolvedRimSpacing,
      maxError: resolvedMaxError,
      diagnostics: resolvedDiagnostics,
      preview: resolvedPreview,
      resolve: resolvedResolve,
      coverAbove: coverAbove.polygon,
      seams: layerSeams,
      carrierSeam,
      carrier: stack.carrier,
      // Asked for up front (`ChunkStackProps.prepareCuts`), not by whether a cut is
      // currently drawing: it is part of the build, so following the toggle would
      // rebuild the geometry every time a section or fence is switched on or off.
      section: cutsPrepared,
      peelable,
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
    resolvedDiagnostics,
    resolvedPreview,
    resolvedResolve,
    coverAbove,
    layerSeams,
    carrierSeam,
    seamsPending,
    columnPending,
    stack.carrier,
    stack.column,
    stack.envelope,
    cutsPrepared,
    peelable,
  ]);

  const [shown, setShown] = useState<ShownChunk | null>(null);
  const [previewed, setPreviewed] = useState<PreviewChunk | null>(null);
  const chunk = shown?.chunk ?? null;
  useEffect(() => {
    // ⭐⭐ A run of this effect means every input the geometry was built from has
    // moved on, so what is on screen is stale. Let it go NOW rather than carrying
    // a whole second chunk through the build: at field scale that doubles the
    // peak, and it is what makes "is the old one actually freed?" answerable —
    // `live` goes to 0 and back to 1 instead of 1 → 2 → 1. Holding the old block
    // up while its replacement is prepared is a nicety to add back deliberately,
    // not something to get by accident.
    // ⚠️ No-op re-render when it is already null (React bails on an equal value).
    // oxlint-disable-next-line react-hooks/set-state-in-effect -- releasing the stale build IS the effect
    setShown(null);
    setPreviewed(null);
    if (unlisted.length > 0) {
      console.error(
        `[Chunk] layers name ${unlisted.length} surface(s) the ChunkStack's own \`surfaces\` does not contain, so this chunk can never be built. Add them to the stack's column, or drop the layers:`,
        unlisted,
      );
      reportState('failed');
      return;
    }
    if (!spec) {
      // No spec yet: either an input is still resolving (busy), or there is
      // genuinely nothing to draw here.
      const gated = coverAbove.pending || seamsPending || columnPending;
      reportState(
        outlineSettled && !outlinePolygon && !gated ? 'empty' : 'building',
      );

      // ⚠️ Those three gates are pure BOOKKEEPING between siblings and settle
      // within a few frames — none of the slow work (fetching grids, resolving a
      // wellbore outline, the worker build) happens behind them. So a gate still
      // closed after this long is a deadlock, not a slow load, and a deadlock has
      // to be reported rather than waited on.
      if (!gated) return;
      const timer = setTimeout(() => {
        console.error(
          '[Chunk] gave up waiting on the ChunkStack after ' +
            `${STALL_TIMEOUT_MS} ms. Still pending:`,
          {
            coverAbove: coverAbove.pending,
            seams: seamsPending,
            column: columnPending,
            surfaces: surfaceIds,
          },
        );
        reportState('failed');
      }, STALL_TIMEOUT_MS);
      return () => clearTimeout(timer);
    }
    let cancelled = false;
    reportState('building');
    const receiver = createSurfaceChunkReceiver();
    const track = createSurfaceChunkProgress();
    let build: ShownChunk['build'] | null = null;
    let finished = false;
    const ready: number[] = [];
    const show = (next: SurfaceChunk, complete: boolean) => {
      build ??= { latest: next };
      build.latest = next;
      // Complete: a layer with no cap of its own (a neighbour draws it, or it
      // collapsed away) is ready too.
      if (complete) {
        for (const layer of chunkLayers(next)) {
          if (!ready.includes(layer)) ready.push(layer);
        }
      }
      setShown({ chunk: next, build, complete, ready: ready.slice() });
    };
    const land = (built: SurfaceChunk | null) => {
      // Counted from HERE rather than from the effect below, so the window where
      // the new chunk exists and the old one has not been released yet — the
      // rebuild's peak — is visible.
      if (built) {
        trackChunk(built);
        show(built, true);
        onBuildRef.current?.(built.metrics);
      } else {
        setShown(null);
        setPreviewed(null);
      }
      reportState(built ? 'ready' : 'empty', built?.metrics);
    };
    const onPacket = (packet: SurfaceChunkPacket) => {
      if (cancelled) return;
      if (packet.kind === 'progress') {
        const { phase, done, total } = packet;
        reportStep({ phase, done, total, estimate: track(phase, done, total) });
        return;
      }
      if (packet.kind === 'preview') {
        // Its own build, so it is disposed when the real chunk has replaced it.
        const coarse = unpackSurfaceChunk(packet.chunk);
        setPreviewed({ chunk: coarse, build: { latest: coarse } });
        return;
      }
      if (packet.kind === 'cap' && !ready.includes(packet.mesh.layer)) {
        ready.push(packet.mesh.layer);
      }
      const next = receiver.receive(packet);
      if (!next) return;
      // ⚠️ The final result travels on another port, so it can be here already.
      if (finished && receiver.complete) return land(next);
      show(next, false);
      const done = receiver.received;
      const total = receiver.expected;
      reportStep({
        phase: 'caps',
        done,
        total,
        estimate: track('caps', done, total),
      });
    };
    (async () => {
      try {
        // ⚠️ The token rides OUTSIDE the memoized spec on purpose: it changes on
        // every request, and putting it in the spec would make the memo churn and
        // trigger the very rebuilds it exists to bound. It tells the generator to
        // abandon a build this chunk has already superseded — `cancelled` alone
        // only discards the result, after the worker has paid for it.
        const response = await generator(
          { ...spec, build: { key: registryKey, token: nextBuildToken() } },
          onPacket,
        );
        if (cancelled) return;
        if (response?.streamed) {
          finished = true;
          const built = receiver.finish(response);
          if (receiver.complete) land(built);
          return;
        }
        land(response ? unpackSurfaceChunk(response) : null);
      } catch (e) {
        if (cancelled) return;
        setPreviewed(null);
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
    registryKey,
    reportState,
    reportStep,
    outlineSettled,
    outlinePolygon,
    coverAbove.pending,
    seamsPending,
    columnPending,
    unlisted,
    surfaceIds,
  ]);

  // Dispose the previous build's geometries when it is replaced or unmounted.
  const build = shown?.build ?? null;
  useEffect(() => {
    return () => {
      if (!build) return;
      untrackChunk(build.latest);
      disposeChunk(build.latest);
    };
  }, [build]);

  const previewBuild = previewed?.build ?? null;
  useEffect(() => {
    return () => {
      if (previewBuild) disposeChunk(previewBuild.latest);
    };
  }, [previewBuild]);

  // ⭐ Revealed a LAYER at a time — its caps, wall and cut face together — in the
  // order the caps arrive, within an upload budget per frame. The preview draws
  // every layer the real chunk does not, so each one swaps in a single frame.
  const reveal = useMemo(
    () => (shown ? chunkLayerReveal(shown.chunk, shown.ready) : []),
    [shown],
  );
  const layersShown = useStaggeredReveal(reveal, shown?.build);
  const replaced =
    !!shown?.complete && reveal.every(item => layersShown.has(item.key));
  useEffect(() => {
    if (replaced) setPreviewed(null);
  }, [replaced]);

  const finished = shown?.complete ? shown.chunk : null;

  // ⚠️⚠️ React double-buffers its fibers: the `alternate` retains the PREVIOUS
  // render's props and hook state, which here is an entire replaced chunk —
  // hundreds of MB, disposed, unreachable from the scene, and pinned for as long
  // as the component lives. One extra render after a build lands makes that
  // alternate hold the CURRENT chunk instead. Cheap: geometry and materials are
  // memoized, so nothing is rebuilt.
  const [, releaseAlternateFiber] = useState(0);
  useEffect(() => {
    if (finished) releaseAlternateFiber(n => n + 1);
  }, [finished]);

  // --- Offer what was drawn for sampling. Ceiling copies are left out: one faces
  //     UP but is the underside of the unit above, and something placed on it
  //     would sit inside the block. ------------------------------------------
  const samplerRegistry = useContext(SurfaceSamplerRegistryContext);
  useEffect(() => {
    if (!samplerRegistry || !finished) return;
    return samplerRegistry.register(
      registryKey,
      finished.surfaces
        .filter(mesh => !mesh.ceiling)
        .map(mesh => ({
          id: stableLayers[mesh.layer]?.surface?.id ?? null,
          layer: mesh.layer,
          geometry: mesh.geometry,
        })),
    );
  }, [samplerRegistry, finished, stableLayers, registryKey]);

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
    previewed,
  ]);

  // ⚠️ Peeling exposes the cap of the first surviving unit, which normally closes
  // the block — but a horizon this chunk shares with a sibling is drawn by only one
  // of them (see `resolveSeam`). Peel down to one this chunk does not draw and the
  // block is open, which presents as a rendering artefact rather than as a
  // consequence of the peel. Say so instead.
  useEffect(() => {
    const { top, base } = resolvePeel(peel, stableLayers.length);
    if (
      top > 0 &&
      top < stableLayers.length &&
      layerSeams[top]?.draw === false
    ) {
      console.warn(
        `Chunk: peel exposes '${stableLayers[top]?.surface?.id ?? top}', ` +
          'a horizon a neighbouring chunk draws — this block will be open at the top.',
      );
    }
    if (base < stableLayers.length && layerSeams[base]?.draw === false) {
      console.warn(
        `Chunk: the peel window's base '${stableLayers[base]?.surface?.id ?? base}' ` +
          'is a horizon a neighbouring chunk draws — this block will be open at the bottom.',
      );
    }
  }, [peel, stableLayers, layerSeams]);

  // --- Appearance / rendering is delegated to ChunkMeshes (reactive layer). ---
  // ⭐ Nothing is borrowed across a seam: a horizon is drawn by the chunk it is the
  // lid of (see `resolveSeam`), so every chunk draws with its OWN appearance.
  if (!chunk && !previewed) return <>{children}</>;

  const meshProps: Omit<ChunkMeshesProps, 'chunk'> = {
    layers: appearanceLayers,
    surfaceOpacity,
    wallOpacity,
    wireframe,
    inferredStyle,
    showSurfaces,
    showWalls,
    cullHiddenCaps,
    outline: outlinePolygon?.coordinates as
      | PlanarPolygonCoordinates
      | undefined,
    cullOffscreen,
    peel,
    water: stack.water,
    bathymetry: stack.bathymetry,
    seaBed:
      !!stack.water &&
      !!stableLayers[0]?.surface &&
      stableLayers[0].surface.id === stack.column?.[0]?.id,
    sectionWater: stack.sectionWater,
    fenceWater: stack.fenceWater,
    carrierMaterial: stack.carrierMaterial,
    carrierDetail: stack.carrierDetail,
    contacts: stack.contacts,
    section: stack.section,
    sectionUniform: stack.sectionUniform,
    sectionUniformInverse: stack.sectionUniformInverse,
    sectionCarrier: stack.sectionCarrier,
    sectionEnabled: stack.sectionEnabled,
    fence: stack.fence,
    fenceUniforms: stack.fenceUniforms,
    fenceUniformsInverse: stack.fenceUniformsInverse,
    fenceOverlayUniforms: stack.fenceOverlayUniforms,
    fenceCarrier: stack.fenceCarrier,
    debugTiles: resolvedDebugTiles,
    lodLevel: resolvedLodLevel,
    lodPixelError: resolvedLodPixelError,
  };

  return (
    <>
      <group ref={meshes} name={`Chunk ${name ?? registryKey}`}>
        {/* ⚠️ One instance per chunk, never one handed the other's chunk: React DEV
            builds describe changed props two levels deep, which for a new
            `section` walks every element of its typed arrays (measured 1.2 s). */}
        {previewed && (
          <ChunkMeshes
            key="preview"
            chunk={previewed.chunk}
            {...meshProps}
            saturation={resolvedPreviewSaturation}
            layersHidden={chunk ? layersShown : undefined}
          />
        )}
        {chunk && (
          <ChunkMeshes
            key="chunk"
            chunk={chunk}
            {...meshProps}
            layersShown={layersShown}
          />
        )}
      </group>
      {children}
    </>
  );
};
