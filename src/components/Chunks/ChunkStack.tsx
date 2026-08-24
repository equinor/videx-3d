import { useFrame } from '@react-three/fiber';
import {
  PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { BufferGeometry, Group, Matrix4, Plane, Vector3, Vector4 } from 'three';
import { useData } from '../../hooks/useData';
import { useGenerator } from '../../hooks/useGenerator';
import {
  ChunkSurfaceLayer,
  PlanarPolygonGeometry,
  readCameraTarget,
  StackSectionSource,
  SurfaceMeta,
  unpackBufferGeometry,
  Vec3,
  WellboreFence,
} from '../../sdk';
import { OceanContactContext } from '../Ocean/ocean-contact';
import { OceanSamplerContext } from '../Ocean/ocean-sampler';
import { UtmAreaContext } from '../UtmArea';
import {
  ChunkMarginEntry,
  ChunkOutlineRegistry,
  ChunkSeamRegistry,
  ChunkStackContext,
  ChunkStackContextValue,
  ChunkSurfaceClaim,
} from './ChunkContext';
import { ChunkSectionDebug } from './ChunkSectionDebug';
import { StackImmersionFog } from './StackImmersionFog';
import { ChunkContact } from './chunk-contacts';
import {
  ChunkBuildState,
  ChunkCarrier,
  ChunkFence,
  ChunkResolveOptions,
  ChunkSection,
  ChunkSectionState,
  ChunkStackProgress,
  DEFAULT_SECTION_OFFSET,
  StackImmersion,
  stackWater,
  StackWater,
  StackWaterResponse,
} from './chunk-defs';
import {
  buildOutlineRegistry,
  clearClaims,
  createChunkClaimStore,
  publishOutline as publishToStore,
  releaseChunk as releaseFromStore,
  setClaims,
} from './chunk-outline-registry';
import { buildStackWaterSpec } from './chunk-spec';
import { CutoutSource } from './cutout';
import { resolveWellboreOutline } from './resolveWellboreOutline';
import {
  createSurfaceSampler,
  SurfaceSamplerContext,
  SurfaceSamplerEntry,
  SurfaceSamplerRegistry,
  SurfaceSamplerRegistryContext,
} from './surface-sampler';
import { useChunkContacts } from './useChunkContacts';
import { useChunkFenceFace } from './useChunkFenceFace';
import { useChunkSection } from './useChunkSection';
import { useStackBathymetry } from './useStackBathymetry';
import { useStackFence } from './useStackFence';
import { useStackWater } from './useStackWater';

// Scratch for the camera-locked plane, which is rebuilt every frame.
const sectionForward = new Vector3();
const sectionEye = new Vector3();
const sectionUp = new Vector3();
const sectionNormal = new Vector3();
const sectionAnchor = new Vector3();
const sectionMatrix = new Matrix4();

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
   * Fog the view while the camera is INSIDE the sea or the block. See
   * {@link StackImmersion}.
   *
   * ⚠️ Absent by default, and the absence is what makes it free: installing
   * `scene.fog` at all changes every material's program cache key, so there is no
   * zero-cost "disabled" state. Declared, it also fogs HOST geometry — vessels,
   * facilities, pipelines — which no material of this library could reach.
   */
  immersion?: StackImmersion;
  /**
   * Fluid contacts to draw as LINES through the whole column — an oil/water
   * contact, a gas cap, or any other border-like level given as a depth grid.
   *
   * ⭐ Declared HERE rather than on a chunk, and deliberately NOT part of
   * `surfaces`: a contact takes no part in the depth order, so it can neither
   * truncate a horizon nor be truncated by one, and changing one rebuilds no
   * geometry at all. See {@link ChunkContact}.
   */
  contacts?: ChunkContact[];
  /**
   * Cut the whole stack with a plane and FILL the cut face per interval, so the
   * block reads as a geological section. See {@link ChunkSection}.
   *
   * ⚠️⚠️ It cuts the chunks and nothing else — not wellbores, vessels, facilities
   * or the sea this stack draws. That is deliberate (the cut lives in
   * `ChunkMaterial`'s shader, not in the renderer), but it means an object resting
   * on the sea bed keeps its geometry while the ground under it is cut away.
   *
   * ⚠️ Its PRESENCE asks each chunk's build for the extra channels a cut face
   * needs, so adding or removing the prop rebuilds them. `enabled` is the free
   * toggle.
   */
  section?: ChunkSection;
  /**
   * Open the stack along a **fence** swept down a wellbore's path, instead of with
   * a plane. See {@link ChunkFence}.
   *
   * ⚠️ Mutually exclusive with {@link ChunkStackProps.section} — both cut, and two
   * cuts at once say less than one. The fence wins if both are enabled.
   *
   * ⭐ Unlike the section it needs no rebuild to CHANGE: the field it cuts by is
   * one number per vertex, so switching wellbores is a resample and an upload, not
   * a build. It does share the section's requirement that the chunk carry the cut
   * channels, so its PRESENCE is still a build input.
   */
  fence?: ChunkFence;
  /**
   * Called with each finished {@link ChunkStackProps.fence}, and with `null` when
   * there is none.
   *
   * ⭐ What a host needs to FRAME the cut — the curve, its extent and which half
   * each side removes are all here, so a camera move can be built from the fence
   * that was actually generated rather than from a re-derived guess. See
   * `fenceViewPose`.
   */
  onFence?: (fence: WellboreFence | null) => void;
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
  immersion,
  contacts,
  section,
  fence,
  onFence,
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

  // Same again: every chunk's MATERIALS depend on these, so a fresh array each
  // render would rebuild all of them. ⚠️ The surface META is keyed by id only —
  // its grid is what matters and that cannot change under a stable id.
  const contactsKey = contacts
    ? JSON.stringify(contacts.map(c => ({ ...c, surface: c.surface.id })))
    : '';
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by content above
  const stableContacts = useMemo(() => contacts, [contactsKey]);
  const contactTextures = useChunkContacts(stableContacts, utm?.utmToArea);

  // ⭐ ONE uniform object for the whole stack, handed to every material it draws
  // with — the chunks', the sea's, and the inference overlay's. A `ShaderMaterial`'s
  // OIT variants share their `uniforms` by reference, so this single write per
  // frame reaches all of them in all four passes, which is what lets the plane move
  // without a React render or a material rebuild.
  // A zero normal removes nothing, which is the disabled state.
  const sectionUniform = useMemo(
    () => ({ value: new Vector4(0, 0, 0, -1) }),
    [],
  );
  // ⭐ The exact COMPLEMENT of the above, for geometry that must appear only where
  // the section took something away — the fragments a cap's collapse dropped
  // because a layer above covered them. Negating the plane makes the patch and the
  // covering layer mutually exclusive by construction, with no tolerance to tune;
  // and negating the DISABLED value (0,0,0,-1) yields (0,0,0,1), which draws
  // nothing, which is exactly right when nothing has been cut away.
  const sectionUniformInverse = useMemo(
    () => ({ value: new Vector4(0, 0, 0, 1) }),
    [],
  );
  // The stack's own frame. Everything driven from the CAMERA — the locked section
  // plane, the immersion test, the fence's auto side — has to be brought out of
  // world space into this, and it is the one case where the two differ.
  const stackFrame = useRef<Group>(null);

  const {
    state: fenceState,
    uniforms: fenceUniforms,
    uniformsInverse: fenceUniformsInverse,
  } = useStackFence(fence, outline, store, utm?.utmToArea, stackFrame, onFence);

  if (
    fence &&
    section &&
    fence.enabled !== false &&
    section.enabled !== false
  ) {
    console.warn(
      'ChunkStack: `section` and `fence` are both enabled. They both cut the block, so only the fence is applied.',
    );
  }

  const hasSection = !!section;
  // ⚠️ Deliberately NOT keyed on the prop: `section={{ plane, enabled }}` is a new
  // object every render, and this context's identity is what every chunk's build
  // spec derives from. Only its presence may change identity.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- see above
  const sectionState = useMemo<ChunkSectionState | null>(
    () =>
      hasSection
        ? { plane: new Plane(), enabled: true, offset: DEFAULT_SECTION_OFFSET }
        : null,
    [hasSection],
  );
  // ⚠️ Registered here, so it runs AFTER any child's own `useFrame` (child effects
  // subscribe first) — a caller animating the plane from inside the stack is
  // therefore read in the same frame it wrote, not the next one.
  useFrame(({ camera, controls }) => {
    if (!section || !sectionState) {
      sectionUniform.value.set(0, 0, 0, -1);
      sectionUniformInverse.value.set(0, 0, 0, 1);
      return;
    }
    sectionState.enabled = section.enabled !== false;
    sectionState.offset = section.offset ?? DEFAULT_SECTION_OFFSET;

    if (section.cameraDistance !== undefined || section.lockToTarget) {
      // The plane sits `distance` in front of the camera FACING it, so everything
      // nearer is cut away and dollying in drives the cut through the block —
      // unless it is locked to the target, where it passes through the pivot and
      // only orbiting moves it.
      camera.getWorldDirection(sectionForward);
      camera.getWorldPosition(sectionEye);
      if (section.vertical !== false) {
        sectionForward.y = 0;
        // Looking straight down leaves no heading in the view direction. What is
        // "up" on screen is horizontal there, so the plane holds its bearing
        // instead of snapping as the view passes through vertical.
        if (sectionForward.lengthSq() < 1e-8) {
          sectionUp.set(0, 1, 0).applyQuaternion(camera.quaternion);
          sectionForward.set(sectionUp.x, 0, sectionUp.z);
          if (sectionForward.lengthSq() < 1e-8) sectionForward.set(0, 0, 1);
        }
        sectionForward.normalize();
      }
      // Anchor on the pivot when asked and there is one to read; otherwise stay in
      // front of the eye, which is also the fallback when no controls expose a
      // target. The vertical flattening above is what makes a target-locked plane
      // stand vertically ON the pivot rather than tilt through it.
      const onTarget =
        !!section.lockToTarget && readCameraTarget(controls, sectionAnchor);
      if (!onTarget) sectionAnchor.copy(sectionEye);
      sectionState.plane.set(
        sectionNormal.copy(sectionForward).negate(),
        sectionForward.dot(sectionAnchor) +
        (onTarget ? 0 : (section.cameraDistance ?? 0)),
      );
      // Built in world space; the stack's own frame is where it has to be tested,
      // and the two differ as soon as the stack carries a vertical exaggeration.
      const root = stackFrame.current;
      if (root) {
        root.updateWorldMatrix(true, false);
        sectionState.plane.applyMatrix4(
          sectionMatrix.copy(root.matrixWorld).invert(),
        );
      }
    } else if (section.plane) {
      sectionState.plane.copy(section.plane);
    }

    const { normal, constant } = sectionState.plane;
    if (sectionState.enabled)
      sectionUniform.value.set(normal.x, normal.y, normal.z, constant);
    else sectionUniform.value.set(0, 0, 0, -1);
    sectionUniformInverse.value.copy(sectionUniform.value).negate();
  });

  // --- Envelope: the footprint the shared column grid is built over. It must
  //     contain every chunk's outline, so a wellbore cut source is resolved over
  //     the FULL depth window — more trajectory points can only grow the outline,
  //     so the full-window one contains every chunk's narrower window. ----------
  const [wellboreEnvelope, setWellboreEnvelope] =
    useState<PlanarPolygonGeometry | null>(null);

  // Every chunk's depth window and buffer margin, so a chunk accumulating
  // trajectory from outside its own window can buffer each interval with the
  // margin of the chunk that owns it. Read by the envelope effect below too.
  const marginEntries = useRef(new Map<string, ChunkMarginEntry>());

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
      const mode = cutSource.options?.mode ?? 'window';
      // The envelope must CONTAIN every chunk's outline, so it takes the widest
      // margin any chunk may use and the full depth range: a chunk's own window
      // is always a sub-range of the column's, and its margin is one of these.
      const widest = Math.max(
        cutSource.options?.radius ?? 500,
        ...[...marginEntries.current.values()].map(m => m.radius),
      );
      return resolveWellboreOutline(
        cutSource.wellbores,
        cutSource.options,
        [
          {
            top: mode === 'above' ? null : toLayer(topMeta, topValues),
            base: mode === 'below' ? null : toLayer(baseMeta, baseValues),
            radius: widest,
          },
        ],
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
  const claims = useRef(createChunkClaimStore());
  const [registry, setRegistry] = useState<ChunkOutlineRegistry>(
    () => new Map(),
  );
  const [seams, setSeams] = useState<ChunkSeamRegistry>(() => new Map());
  const [claimed, setClaimed] = useState<Set<string>>(() => new Set());

  const rebuildRegistry = useCallback(() => {
    const next = buildOutlineRegistry(claims.current);
    setRegistry(next.registry);
    setSeams(next.seams);
    setClaimed(previous =>
      previous.size === next.registry.size &&
        [...next.registry.keys()].every(id => previous.has(id))
        ? previous
        : new Set(next.registry.keys()),
    );
  }, []);

  // ⚠️ Claims change whenever a chunk's layers do, so this cleanup runs on a
  // RE-registration as often as on an unmount, and it must not take the chunk's
  // published outline with it: publishing is a separate effect keyed on the
  // outline, so it would not re-run and the outline would stay unresolved
  // forever — leaving every chunk sharing that horizon waiting on it. Releasing
  // those is the chunk's own job, on unmount (see `releaseChunk`).
  const registerChunk = useCallback(
    (key: string, claimedSurfaces: ChunkSurfaceClaim[]) => {
      setClaims(claims.current, key, claimedSurfaces);
      rebuildRegistry();
      return () => {
        clearClaims(claims.current, key);
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
      const total = claims.current.claims.size;
      let completed = 0;
      claims.current.claims.forEach((_, k) => {
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

  /** Drop everything held for a chunk that is going away for good. */
  const releaseChunk = useCallback(
    (key: string) => {
      releaseFromStore(claims.current, key);
      buildStates.current.delete(key);
      rebuildRegistry();
    },
    [rebuildRegistry],
  );

  const publishOutline = useCallback(
    (
      key: string,
      polygon: PlanarPolygonGeometry | null | undefined,
      spacing?: number,
    ) => {
      if (publishToStore(claims.current, key, polygon, spacing))
        rebuildRegistry();
    },
    [rebuildRegistry],
  );

  // --- Sampling: what the chunks have DRAWN, offered to anything placed on it.
  //     Kept out of the context value above, which is what every chunk's build
  //     spec is derived from — a sibling finishing its geometry must not disturb
  //     it. The version is the signal to sample again. -------------------------
  const drawn = useRef(new Map<string, SurfaceSamplerEntry[]>());
  const [drawnVersion, setDrawnVersion] = useState(0);
  const samplerRegistry = useMemo<SurfaceSamplerRegistry>(
    () => ({
      register(key, entries) {
        // Tagged here rather than by the chunk: the key is what makes a set of caps
        // ONE volume, and only the registry knows it.
        drawn.current.set(
          key,
          entries.map(entry => ({ ...entry, group: key })),
        );
        setDrawnVersion(v => v + 1);
        return () => {
          drawn.current.delete(key);
          setDrawnVersion(v => v + 1);
        };
      },
    }),
    [],
  );
  const sampler = useMemo(
    () => createSurfaceSampler([...drawn.current.values()].flat()),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a new identity per change is the point
    [drawnVersion],
  );

  // What the shared build LOADS: a surface no chunk claims would be fetched,
  // resampled onto the common grid and cascaded through the resolve for nothing.
  // Appearance needs no equivalent — a horizon is drawn by the chunk it is the lid
  // of, so nothing has to be borrowed across a seam.
  const column = useMemo(
    () => surfaces?.filter(m => claimed.has(m.id)),
    [surfaces, claimed],
  );

  // The bed the sea stands on is the column's shallowest surface — the same one
  // `stackWater` ends against. Its grid drives the bed tint per fragment, and it
  // is the sea surface's only depth input: without it the water shader uses the
  // view angle as a stand-in and cannot tell a shoal from open sea.
  const bathymetry = useStackBathymetry(
    stableWater && column?.length ? column[0] : undefined,
    utm?.utmToArea,
  );

  // ⚠️ PRESENCE, not `enabled`: the sea's cut channels are a build output, so
  // keying them on the toggle would rebuild the sea every time a cut is switched
  // on or off.
  const hasCut = !!section || !!fence;

  const sea = useStackWater(
    stableWater,
    false,
    section && section.water === true ? sectionUniform : undefined,
    bathymetry,
    fence && fence.water === true ? fenceUniforms : undefined,
    hasCut,
  );

  // ⭐ The sea and the block are made of SURFACES, so from inside either one
  // nothing stands between the camera and what it sees and the view is impossibly
  // clear. See `StackImmersionFog` — rendered only when asked for, because
  // installing `scene.fog` at all changes every material's program cache key.
  // ⚠️ The block's base is derived rather than sampled: a carrier floor is
  // deliberately not sampleable (§5.3).
  const blockBase = useMemo(() => {
    if (!immersion) return null;
    let bottom = 0;
    for (const meta of column ?? []) bottom = Math.min(bottom, -meta.max);
    if (stableCarrier?.depth !== undefined)
      bottom = Math.min(bottom, -stableCarrier.depth);
    else if (stableCarrier?.below !== undefined) bottom -= stableCarrier.below;
    return bottom;
  }, [immersion, column, stableCarrier]);

  // --- Margin ramp: ordered shallow→deep by the COLUMN, not by child order — a
  //     caller may declare chunks in any order and the ramp is a property of
  //     depth. -------------------------------------------------------------
  const [margins, setMargins] = useState<ChunkMarginEntry[]>([]);

  const rebuildMargins = useCallback(() => {
    const list = [...marginEntries.current.values()];
    const at = (id?: string) => {
      const i = id ? (surfaces?.findIndex(m => m.id === id) ?? -1) : -1;
      return i < 0 ? Number.MAX_SAFE_INTEGER : i;
    };
    list.sort((a, b) => at(a.topSurfaceId) - at(b.topSurfaceId));
    setMargins(previous =>
      previous.length === list.length &&
        previous.every(
          (p, i) =>
            p.key === list[i].key &&
            p.radius === list[i].radius &&
            p.topSurfaceId === list[i].topSurfaceId &&
            p.baseSurfaceId === list[i].baseSurfaceId,
        )
        ? previous
        : list,
    );
  }, [surfaces]);

  const publishMargin = useCallback(
    (key: string, entry: ChunkMarginEntry | null) => {
      if (entry) marginEntries.current.set(key, entry);
      else marginEntries.current.delete(key);
      rebuildMargins();
    },
    [rebuildMargins],
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
      contacts: contactTextures,
      water: stableWater ?? null,
      bathymetry,
      section: sectionState,
      sectionUniform,
      sectionUniformInverse,
      sectionCarrier: section?.carrier === true,
      fence: fenceState,
      fenceUniforms,
      fenceUniformsInverse,
      fenceCarrier: fence?.carrier === true,
      resolve: stableResolve,
      envelope,
      rimSpacing,
      maxError,
      outlines: registry,
      seams,
      margins,
      registerChunk,
      releaseChunk,
      publishOutline,
      publishMargin,
      reportBuildState,
    };
  }, [
    outline,
    cutSource,
    surfaces,
    column,
    stableCarrier,
    carrier?.material,
    contactTextures,
    stableWater,
    bathymetry,
    sectionState,
    sectionUniform,
    sectionUniformInverse,
    section?.carrier,
    fenceState,
    fenceUniforms,
    fenceUniformsInverse,
    fence?.carrier,
    stableResolve,
    wellboreEnvelope,
    rimSpacing,
    maxError,
    registry,
    seams,
    margins,
    registerChunk,
    releaseChunk,
    publishOutline,
    publishMargin,
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
      section: hasCut,
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
    hasCut,
  ]);

  const [seaGeometry, setSeaGeometry] = useState<{
    lid: BufferGeometry | null;
    body: BufferGeometry | null;
    section?: StackSectionSource;
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
            section: response.section,
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

  // ⭐ The face that CLOSES the water body at a cut, off the sea's own channels —
  // so it meets the block's face on the same curve, over the same bed, rather than
  // leaving an open body to look into. Same two builders the chunks use; the sea is
  // a stack of two boundaries, so each yields at most one face.
  const waterPlaneFace = useChunkSection(seaGeometry?.section, sectionState);
  const waterFenceFace = useChunkFenceFace(seaGeometry?.section, fenceState);
  const waterFace = fenceState?.enabled ? waterFenceFace : waterPlaneFace;

  // The stack's extent in its OWN frame, for the section debug view: XZ from the
  // footprint everything is cut from, Y from the column's depth range and the
  // floor under it.
  const sectionBounds = useMemo(() => {
    if (!section?.debug) return null;
    const polygon = value.envelope ?? outline;
    if (!polygon) return null;
    const { min, max } = polygon.getBounds();
    if (!Number.isFinite(min[0])) return null;
    // Scene Y is up and a surface's meta is a positive DEPTH, so they invert.
    let top = 0;
    let bottom = 0;
    for (const meta of column ?? []) {
      top = Math.max(top, -meta.min);
      bottom = Math.min(bottom, -meta.max);
    }
    if (stableCarrier?.depth !== undefined)
      bottom = Math.min(bottom, -stableCarrier.depth);
    else if (stableCarrier?.below !== undefined) bottom -= stableCarrier.below;
    if (stableWater) top = Math.max(top, -(stableWater.depth ?? 0));
    if (bottom >= top) bottom = top - 1;
    return {
      min: [min[0], bottom, min[1]] as Vec3,
      max: [max[0], top, max[1]] as Vec3,
    };
  }, [
    section?.debug,
    value.envelope,
    outline,
    column,
    stableCarrier,
    stableWater,
  ]);

  return (
    <ChunkStackContext.Provider value={value}>
      <SurfaceSamplerRegistryContext.Provider value={samplerRegistry}>
        <SurfaceSamplerContext.Provider value={sampler}>
          <OceanSamplerContext.Provider value={sea?.sampler ?? null}>
            <OceanContactContext.Provider value={sea?.contacts ?? null}>
              {/* Identity transform, present so a camera-locked section has a
                  frame to be brought into (see the `useFrame` above). */}
              <group ref={stackFrame}>
                {immersion && (
                  <StackImmersionFog
                    immersion={immersion}
                    water={stableWater ?? null}
                    sampler={sampler}
                    base={blockBase}
                    section={sectionState}
                    sectionWater={section?.water === true}
                    fence={fenceState}
                    fenceWater={fence?.water === true}
                    frame={stackFrame}
                  />
                )}
                {sea && seaGeometry?.lid && (
                  <mesh geometry={seaGeometry.lid} material={sea.surface} />
                )}
                {sea && seaGeometry?.body && (
                  <mesh geometry={seaGeometry.body} material={sea.volume} />
                )}
                {sea?.face &&
                  waterFace?.map(face => (
                    <mesh
                      key={`${face.interval}-${face.wall}`}
                      geometry={face.geometry}
                      material={sea.face!}
                    />
                  ))}
                {sectionBounds && (
                  <ChunkSectionDebug
                    section={sectionState}
                    min={sectionBounds.min}
                    max={sectionBounds.max}
                  />
                )}
                {children}
              </group>
            </OceanContactContext.Provider>
          </OceanSamplerContext.Provider>
        </SurfaceSamplerContext.Provider>
      </SurfaceSamplerRegistryContext.Provider>
    </ChunkStackContext.Provider>
  );
};
