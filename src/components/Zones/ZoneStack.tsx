import { useFrame, useThree } from '@react-three/fiber';
import {
  PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  BufferGeometry,
  Group,
  Matrix4,
  Mesh,
  Plane,
  Vector3,
  Vector4,
} from 'three';
import { useCameraProbe } from '../../hooks/useCameraSite';
import {
  CAMERA_PROBE_ORDER,
  type CameraProbe,
  reportCameraWater,
} from '../../sdk/utils/camera-site';
import { useData } from '../../hooks/useData';
import { precompile } from '../../rendering/precompile';
import { useGenerator } from '../../hooks/useGenerator';
import { useSharedTextures } from '../../hooks/useSharedTextures';
import {
  CutUniforms,
  createHeightFieldClipBinding,
  fenceSideAt,
  HeightFieldClip,
  PlanarPolygonGeometry,
  readCameraTarget,
  ReliefSource,
  StackSectionSource,
  SurfaceZoneMetrics,
  SurfaceMeta,
  unpackBufferGeometry,
  Vec3,
  WellboreFence,
} from '../../sdk';
import { OceanContactContext } from '../Ocean/ocean-contact';
import { OceanSamplerContext } from '../Ocean/ocean-sampler';
import { UtmAreaContext } from '../UtmArea';
import {
  ZoneMarginEntry,
  ZoneBoundaryRegistry,
  ZoneSeamRegistry,
  ZoneStackContext,
  ZoneStackContextValue,
  ZoneSurfaceClaim,
} from './ZoneContext';
import { ZoneSectionDebug } from './ZoneSectionDebug';
import { StackImmersionFog } from './StackImmersionFog';
import { ZoneContact } from './zone-contacts';
import { zoneDetailKey } from './zone-detail';
import {
  ZoneBuildProgress,
  ZoneBuildState,
  ZoneCarrier,
  ZoneCutDepths,
  ZoneFence,
  ZoneResolveOptions,
  ZoneSection,
  ZoneSectionState,
  ZoneStackProgress,
  DEFAULT_ZONE_MAX_ERROR,
  DEFAULT_SECTION_OFFSET,
  FenceSideInfo,
  StackBedGrid,
  StackImmersion,
  stackWater,
  StackWater,
  StackWaterResponse,
  wellboreOutline,
  WellboreOutlineResponse,
} from './zone-defs';
import {
  buildBoundaryRegistry,
  clearClaims,
  createZoneClaimStore,
  publishBoundary as publishToStore,
  releaseZone as releaseFromStore,
  setClaims,
} from './zone-boundary-registry';
import { aggregateZoneProgress, ZoneProgressInput } from './zone-progress';
import { buildStackWaterSpec } from './zone-spec';
import { CutoutSource } from './cutout';
import { resolveWellboreOutline } from './resolveWellboreOutline';
import {
  createReliefTopSampler,
  createSurfaceSampler,
  SurfaceSampler,
  SurfaceSamplerContext,
  SurfaceSamplerEntry,
  SurfaceSamplerRegistry,
  SurfaceSamplerRegistryContext,
} from './surface-sampler';
import { useZoneContacts } from './useZoneContacts';
import { useZoneFenceFace } from './useZoneFenceFace';
import { useZoneSection } from './useZoneSection';
import {
  buildChannelDepthMap,
  ZoneDepthMap,
  sameStackBedGrid,
} from './zone-depth-map';
import { useStackFence } from './useStackFence';
import { useStackFenceOverlay } from './useStackFenceOverlay';
import { useStackWater } from './useStackWater';

// Scratch for the camera-locked plane, which is rebuilt every frame.
const sectionForward = new Vector3();
const sectionEye = new Vector3();
const sectionUp = new Vector3();
const sectionNormal = new Vector3();
const sectionAnchor = new Vector3();
const sectionMatrix = new Matrix4();

/**
 * {@link ZoneStack} props.
 * @expand
 * @group Components
 */
export type ZoneStackProps = {
  /**
   * Default boundary polygon (scene XZ) shared by child zones that inherit it
   * (the common case). Individual zones may override with their own boundary.
   */
  boundary?: PlanarPolygonGeometry | null;
  /**
   * Default cut source shared by child zones that inherit it. Use this for a
   * wellbore-derived boundary (`{ kind: 'wellbores', wellbores, options }`); takes
   * precedence over `boundary` when both are set.
   */
  cutSource?: CutoutSource;
  /**
   * The whole column the child zones are cut from, **shallowest first** — i.e.
   * the array each zone's `groups` is sliced out of.
   *
   * ⚠️ The array order IS the stratigraphic order. Sort by stratigraphic age;
   * `SurfaceMeta.min`/`.max` describe a surface's whole extent, not its position
   * inside this stack, and sorting by either misorders a real column.
   *
   * Declaring it lets the generator fetch, resample and make the column monotone
   * **once** for every zone cut from it — so several zones agree with each other
   * about depth order instead of each resolving its own layers in isolation, and
   * the cost stays flat as zones are added. Omit it and each zone builds
   * independently (zones can then cross each other where their footprints
   * overlap).
   */
  surfaces?: SurfaceMeta[];
  /**
   * A flat floor closing the whole column, at an absolute `depth` or a margin
   * `below` its deepest mapped sample. Nothing pierces it — a surface that would
   * is truncated at it — so the block is closed from beneath whatever the data
   * does. A zone draws it when its own LAST layer declares a `fill`: that says
   * the block is open at the bottom, and this is the only thing that can close it.
   *
   * ⭐ It belongs to the COLUMN, not to a zone: two zones may otherwise hang
   * different floors under one horizon, and the surface between them then has two
   * heights. It also gives the deepest surface a neighbour below, which is what
   * the seal needs to keep it in proportion rather than pinning it to the one
   * layer above.
   */
  carrier?: ZoneCarrier;
  /**
   * Open water over the whole column: the sea state, its appearance, and how it
   * tints the bed beneath it. See {@link StackWater}.
   *
   * ⭐ Declared HERE rather than on a zone, for the same reason as `carrier`, and
   * for one more: a sea covers its whole footprint by design, so two zones each
   * drawing part of it would leave two coplanar lids wherever their footprints
   * overlap. The stack draws it once.
   *
   * It also provides the wave sampler and the contact-foam registry to everything
   * inside it, so a floating child (a vessel, a buoy) heaves with the swell and
   * spreads foam exactly as it would inside an `<Ocean>`. Needs a `boundary` — a
   * `cutSource` alone gives nothing to draw the sea over — and a `seabed` the column
   * holds: without one there is no sea (and a warning).
   */
  water?: StackWater;
  /**
   * The id of the surface in `surfaces` that is the sea bed. Declared, never
   * inferred: the column holds a sea bed only while a zone draws this surface, and
   * only then is there a sea (`water`), a bed tint, a cap kept whole under a kept
   * sea, and a `relief` to build it on. A column cut from deeper down holds none.
   */
  seabed?: string | null;
  /**
   * The relief the column's sea bed (`seabed`) is built on, instead of on its surface's
   * own values: merged onto the column's grid as a `SceneryStage` merges its tiles, and
   * covering the whole column, so the column's top is the ground the stage draws. Derive
   * it from the stage's props with `reliefSource`. The sea bed's surface still plans the
   * grid. Needs the shared column (a `boundary` or a `cutSource`). The column is built
   * again when its `key` changes.
   *
   * ⚠️ The relief has no vertical exaggeration: under one, the column's top could not meet
   * the ground, so the column builds on its own sea bed (and warns).
   */
  relief?: ReliefSource;
  /**
   * With `relief`: the ground as the stage draws it over the stack, from its occupant's
   * `onGround`. Every zone material leaves out what lies above it, per fragment and in
   * the stack's own frame, so the walls and the section and fence faces end exactly where
   * the ground is drawn, at any depth of its tiles. The column's top is built `margin`
   * (`ReliefSource.margin`, default `maxError`) above the relief for that. The materials
   * are compiled for it while the column is on a relief, so a clip coming and going
   * rebuilds nothing.
   */
  clip?: HeightFieldClip | null;
  /**
   * With `relief`: the relief's own sampler, from the stage's `onSampler`. The stack's
   * `SurfaceSamplerContext` answers its sea bed from it wherever the column holds it, so
   * what is placed on the column's top lands on the ground as drawn rather than on the
   * cap hidden `margin` above it; and its pins hold the finest ground under them. Without
   * it the cap answers, less the margin: within `maxError` of the ground.
   */
  reliefSampler?: SurfaceSampler | null;
  /**
   * Draw the `water`. Default true. `false` keeps the sea built but hides it, the bed
   * tint and the immersion fog in it with it — while a `SceneryStage` owns the water over
   * the column, say (see its occupant's `onStage`). A hidden sea keeps no bed whole: a
   * cut takes the sea bed's cap like any other. Switching it rebuilds no geometry.
   */
  drawWater?: boolean;
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
   * ⭐ Declared HERE rather than on a zone, and deliberately NOT part of
   * `surfaces`: a contact takes no part in the depth order, so it can neither
   * truncate a horizon nor be truncated by one, and changing one rebuilds no
   * geometry at all. See {@link ZoneContact}.
   */
  contacts?: ZoneContact[];
  /**
   * Build every zone, and the sea, with what a section, fence or peel needs: the
   * cut channels and a patch index per layer. Default true, so any of them can be
   * added and removed without a rebuild. False saves that memory and build time
   * where nothing is ever cut or peeled; a declared cut or peel then asks for it
   * itself, and adding or removing one rebuilds.
   */
  prepareCuts?: boolean;
  /**
   * Cut the whole stack with a plane and FILL the cut face per interval, so the
   * block reads as a geological section. See {@link ZoneSection}.
   *
   * ⚠️⚠️ It cuts the zones and nothing else — not wellbores, vessels, facilities
   * or the sea this stack draws. That is deliberate (the cut lives in
   * `ZoneMaterial`'s shader, not in the renderer), but it means an object resting
   * on the sea bed keeps its geometry while the ground under it is cut away.
   *
   * ⚠️ With {@link ZoneStackProps.prepareCuts} off, its PRESENCE asks each
   * zone's build for the extra channels a cut face needs, so adding or removing
   * the prop rebuilds them. `enabled` is always the free toggle.
   */
  section?: ZoneSection;
  /**
   * Open the stack along a **fence** swept down a wellbore's path, instead of with
   * a plane. See {@link ZoneFence}.
   *
   * ⚠️ Mutually exclusive with {@link ZoneStackProps.section} — both cut, and two
   * cuts at once say less than one. The fence wins if both are enabled.
   *
   * ⭐ Unlike the section it needs no rebuild to CHANGE: the field it cuts by is
   * one number per vertex, so switching wellbores is a resample and an upload, not
   * a build. It does share the section's requirement that the zone carry the cut
   * channels, so with {@link ZoneStackProps.prepareCuts} off its PRESENCE is a
   * build input.
   */
  fence?: ZoneFence;
  /**
   * Called with each finished {@link ZoneStackProps.fence}, and with `null` when
   * there is none.
   *
   * ⭐ What a host needs to FRAME the cut — the curve, its extent and which half
   * each side removes are all here, so a camera move can be built from the fence
   * that was actually generated rather than from a re-derived guess. See
   * `fenceViewPose`.
   */
  onFence?: (fence: WellboreFence | null) => void;
  /**
   * Called with where the SHOWN side's cut face runs, whenever the fence is rebuilt or the side
   * changes, and with `null` when there is none — what a host needs to build a
   * `ZoneFence.overlay` texture for it. See `useFenceSeismicOverlay`.
   */
  onFenceSide?: (info: FenceSideInfo | null) => void;
  /**
   * Called with the stack's cut — its section's plane and its fence — as the uniform
   * objects its own materials read, so something drawn for the stack can be cut with it:
   * the relief over it, as a `SceneryStage` occupant's `cut`, say. Once; the objects follow
   * the cut every frame, and cut nothing while it is off. `null` on unmount.
   */
  onCut?: (cut: CutUniforms | null) => void;
  /**
   * How the column is made monotone before it is built, and what is dropped where
   * a unit is not present. Zones inherit this unless they declare their own.
   *
   * ⭐ Most of it describes the COLUMN rather than a zone — `seal`, `sealMode`,
   * `minThickness`, `maxFill`, `maxNodes`, `mode` and `minGap` all feed the shared
   * build — so declaring it here is what lets every zone (and the sea) share one
   * resolved column instead of building it once per set of options.
   *
   * ⚠️ Memoize it: a new identity rebuilds every zone.
   */
  resolve?: ZoneResolveOptions;
  /** default rim densification spacing (world units) for child zones */
  rimSpacing?: number;
  /** default interior simplification error (grid height units) for child zones */
  maxError?: number;
  /**
   * Default for child zones: measure and report `metrics.diagnostics` (see
   * `ZoneProps.diagnostics`). Default false.
   */
  diagnostics?: boolean;
  /**
   * Default for child zones: show a coarse preview while the real geometry
   * builds (see `ZoneProps.preview`). Default true.
   */
  preview?: boolean;
  /**
   * Default for child zones: the saturation a preview is drawn with (see
   * `ZoneProps.previewSaturation`). Default 0.5.
   */
  previewSaturation?: number;
  /**
   * Default for child zones: tint by tessellation tile and draw the seams (see
   * `ZoneProps.debugTiles`). Default false.
   */
  debugTiles?: boolean;
  /** Default for child zones: see `ZoneProps.lodLevel`. Default 0. */
  lodLevel?: number;
  /** Default for child zones: see `ZoneProps.lodPixelError`. Default 2. */
  lodPixelError?: number;
  /**
   * Called whenever a child zone starts building, reports a step, or finishes —
   * for a busy indicator or a progress bar. See {@link ZoneStackProgress} for the
   * zone count, the step a zone is on and the weighted estimate. Reports once
   * more, with no zones, when the stack unmounts. To show it in the host's DOM,
   * pass it to a `ProgressStore` source through {@link zoneProgressReport}.
   */
  onProgress?: (progress: ZoneStackProgress) => void;
};

/**
 * Groups a set of {@link Zone} components and publishes shared build inputs (the
 * boundary, the column and the tessellation defaults) via context, so zones can
 * `inherit` them.
 *
 * This is the parent/provider of the zone component family — analogous to how
 * `Wells` groups `Wellbore`s. Place it inside a `UtmArea` (zones resolve their
 * world placement from the UTM context).
 *
 * @example
 * <UtmArea origin={origin} utmZone={utmZone}>
 *   <ZoneStack boundary={polygon} surfaces={column}>
 *     <Zone groups={[column.slice(0, 4)]} />
 *     <Zone layers={column.slice(4).map(surface => ({ surface, fill: true }))} />
 *   </ZoneStack>
 * </UtmArea>
 *
 * @group Components
 */
export const ZoneStack = ({
  boundary = null,
  cutSource,
  surfaces,
  carrier,
  water,
  seabed,
  relief,
  clip,
  reliefSampler,
  drawWater = true,
  immersion,
  contacts,
  prepareCuts = true,
  section,
  fence,
  onFence,
  onFenceSide,
  onCut,
  resolve,
  rimSpacing,
  maxError,
  diagnostics,
  preview,
  previewSaturation,
  debugTiles,
  lodLevel,
  lodPixelError,
  onProgress,
  children,
}: PropsWithChildren<ZoneStackProps>) => {
  const store = useData();
  const utm = useContext(UtmAreaContext);

  // `carrier={{ below: 800 }}` is the natural way to write this and makes a new
  // object every render, which would rebuild every zone that draws it.
  // ⚠️ Keyed on WHERE the plane is and not on how it looks: the material is
  // published separately, so recolouring the floor cannot rebuild geometry.
  const carrierKey = carrier
    ? `${carrier.depth ?? ''}/${carrier.below ?? ''}`
    : '';
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by content above
  const stableCarrier = useMemo(() => carrier, [carrierKey]);
  // The floor's detail is appearance too, and as often written inline.
  const carrierDetailKey = zoneDetailKey(carrier?.detail);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by content above
  const carrierDetail = useMemo(() => carrier?.detail, [carrierDetailKey]);

  // Same again for the sea, which every zone's MATERIALS depend on (the bed
  // tint) — a fresh object each render would rebuild all of them.
  const waterKey = water ? JSON.stringify(water) : '';
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by content above
  const stableWater = useMemo(() => water, [waterKey]);

  // And again for the build options, which decide the identity of the CACHED
  // column: everything cut from it has to ask for it with the same ones.
  const resolveKey = resolve ? JSON.stringify(resolve) : '';
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by content above
  const stableResolve = useMemo(() => resolve, [resolveKey]);

  // The relief joins the column's identity too; it carries its own content key.
  const reliefKey = relief?.key ?? '';
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by content above
  const stableRelief = useMemo(() => relief, [reliefKey]);

  // Same again: every zone's MATERIALS depend on these, so a fresh array each
  // render would rebuild all of them. ⚠️ The surface META is keyed by id only —
  // its grid is what matters and that cannot change under a stable id.
  const contactsKey = contacts
    ? JSON.stringify(contacts.map(c => ({ ...c, surface: c.surface.id })))
    : '';
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by content above
  const stableContacts = useMemo(() => contacts, [contactsKey]);
  const contactTextures = useZoneContacts(stableContacts, utm?.utmToArea);

  // ⭐ ONE uniform object for the whole stack, handed to every material it draws
  // with — the zones', the sea's, and the inference overlay's. A `ShaderMaterial`'s
  // OIT variants share their `uniforms` by reference, so this single write per
  // frame reaches all of them in all four passes, which is what lets the plane move
  // without a React render or a material rebuild.
  // A zero normal removes nothing, which is the disabled state.
  const sectionUniform = useMemo(
    () => ({ value: new Vector4(0, 0, 0, -1) }),
    [],
  );
  // Shared like the plane: hiding the sea hides its bed tint with one write.
  const [waterTintShown] = useState(() => ({ value: 1 }));
  useEffect(() => {
    waterTintShown.value = drawWater ? 1 : 0;
  }, [waterTintShown, drawWater]);
  // ⭐ The exact COMPLEMENT of the above, for geometry that must appear only where
  // the section took something away — the fragments a cap's collapse dropped
  // because a layer above covered them. Negating the plane makes the patch and the
  // covering layer mutually exclusive by construction, with no tolerance to tune;
  // and negating the DISABLED value (0,0,0,-1) yields (0,0,0,1), which draws
  // nothing, which is exactly right when nothing has been cut away.
  // ⚠️ The patch ANDs this with the fence's inverse, so while the FENCE is live it
  // must pass everything instead — hence written after `useStackFence`, below.
  const sectionUniformInverse = useMemo(
    () => ({ value: new Vector4(0, 0, 0, 1) }),
    [],
  );
  // The stack's own frame. Everything driven from the CAMERA — the locked section
  // plane, the immersion test, the fence's auto side — has to be brought out of
  // world space into this, and it is the one case where the two differ.
  const stackFrame = useRef<Group>(null);

  if (
    fence &&
    section &&
    fence.enabled !== false &&
    section.enabled !== false
  ) {
    console.warn(
      'ZoneStack: `section` and `fence` are both enabled. They both cut the block, so only the fence is applied.',
    );
  }

  const hasSection = !!section;
  // ⚠️ Deliberately NOT keyed on the prop: `section={{ plane, enabled }}` is a new
  // object every render, and every zone and material reads this one through the
  // context. Only its presence may change identity.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- see above
  const sectionState = useMemo<ZoneSectionState | null>(
    () =>
      hasSection
        ? {
            plane: new Plane(),
            enabled: true,
            offset: DEFAULT_SECTION_OFFSET,
            listeners: new Set(),
          }
        : null,
    [hasSection],
  );
  // ⚠️ Registered here, so it runs AFTER the `useFrame` of any child mounted WITH the
  // stack (child effects subscribe first) — a caller animating the plane from such a
  // child is therefore read in the same frame it wrote, not the next one.
  useFrame(({ camera, controls }) => {
    if (!section || !sectionState) {
      sectionUniform.value.set(0, 0, 0, -1);
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
    sectionState.listeners?.forEach(listener => listener());
  });

  // --- Envelope: the footprint the shared column grid is built over. It must
  //     contain every zone's boundary, so a wellbore cut source is resolved over
  //     the FULL depth window — more trajectory points can only grow the boundary,
  //     so the full-window one contains every zone's narrower window. ----------
  const [wellboreEnvelope, setWellboreEnvelope] =
    useState<PlanarPolygonGeometry | null>(null);

  // Every zone's depth window and buffer margin, so a zone accumulating
  // trajectory from outside its own window can buffer each interval with the
  // margin of the zone that owns it. Read by the envelope effect below too.
  const marginEntries = useRef(new Map<string, ZoneMarginEntry>());

  const outlineGenerator =
    useGenerator<WellboreOutlineResponse>(wellboreOutline);
  useEffect(() => {
    if (!cutSource || cutSource.kind !== 'wellbores') return;
    if (!utm || !surfaces || surfaces.length === 0) return;
    const mode = cutSource.options?.mode ?? 'window';
    // The envelope must CONTAIN every zone's boundary, so it takes the widest
    // margin any zone may use and the full depth range: a zone's own window
    // is always a sub-range of the column's, and its margin is one of these.
    const widest = Math.max(
      cutSource.options?.radius ?? 500,
      ...[...marginEntries.current.values()].map(m => m.radius),
    );
    let cancelled = false;
    resolveWellboreOutline(
      outlineGenerator,
      cutSource.wellbores,
      cutSource.options,
      [
        {
          top: mode === 'above' ? null : surfaces[0],
          base: mode === 'below' ? null : surfaces[surfaces.length - 1],
          radius: widest,
        },
      ],
      utm.utmToArea,
    )
      .then(poly => {
        if (!cancelled) setWellboreEnvelope(poly);
      })
      .catch(() => {
        if (!cancelled) setWellboreEnvelope(null);
      });
    return () => {
      cancelled = true;
    };
  }, [cutSource, outlineGenerator, utm, surfaces]);

  // --- Boundary registry: which zones claim which surface, and (once resolved)
  //     with what footprint. Two things read it: a zone's top layer is truncated
  //     against a surface the zone ABOVE draws, and a horizon two zones share
  //     must be drawn by exactly one of them. See `registerZone`. -------------
  const claims = useRef(createZoneClaimStore());
  const [registry, setRegistry] = useState<ZoneBoundaryRegistry>(
    () => new Map(),
  );
  const [seams, setSeams] = useState<ZoneSeamRegistry>(() => new Map());
  const [claimed, setClaimed] = useState<Set<string>>(() => new Set());
  const mountOrder = useRef(new Map<string, number>());
  const mountCount = useRef(0);

  const rebuildRegistry = useCallback(() => {
    const next = buildBoundaryRegistry(claims.current);
    setRegistry(next.registry);
    setSeams(next.seams);
    setClaimed(previous =>
      previous.size === next.registry.size &&
      [...next.registry.keys()].every(id => previous.has(id))
        ? previous
        : new Set(next.registry.keys()),
    );
  }, []);

  // ⚠️ Claims change whenever a zone's layers do, so this cleanup runs on a
  // RE-registration as often as on an unmount, and it must not take the zone's
  // published boundary with it: publishing is a separate effect keyed on the
  // boundary, so it would not re-run and the boundary would stay unresolved
  // forever — leaving every zone sharing that horizon waiting on it. Releasing
  // those is the zone's own job, on unmount (see `releaseZone`).
  const registerZone = useCallback(
    (key: string, claimedSurfaces: ZoneSurfaceClaim[]) => {
      // Re-registering re-inserts the claims, so their map order is not mount order.
      if (!mountOrder.current.has(key)) {
        mountOrder.current.set(key, mountCount.current++);
      }
      setClaims(claims.current, key, claimedSurfaces);
      rebuildRegistry();
      return () => {
        clearClaims(claims.current, key);
        rebuildRegistry();
      };
    },
    [rebuildRegistry],
  );

  // --- Build progress: zones report their own state, the stack counts them. A
  //     registered zone that has not reported yet is still building. ----------
  const zoneNames = useRef(new Map<string, string>());
  const buildStates = useRef(new Map<string, ZoneBuildState>());
  // Kept in report order, so the last entry is the latest step.
  const buildSteps = useRef(new Map<string, ZoneBuildProgress>());
  // What the latest build of each zone counted, measured and took.
  const buildRecords = useRef(
    new Map<
      string,
      Pick<ZoneProgressInput, 'counts' | 'metrics' | 'startedAt' | 'finishedAt'>
    >(),
  );
  const onProgressRef = useRef(onProgress);
  useEffect(() => {
    onProgressRef.current = onProgress;
  }, [onProgress]);
  // Set once the stack unmounts: its zones release afterwards and must not
  // report a half-empty stack as building again.
  const progressClosed = useRef(false);

  const emitProgress = useCallback(() => {
    if (progressClosed.current) return;
    const order = mountOrder.current;
    const reported = [...buildSteps.current.keys()];
    const keys = [...claims.current.claims.keys()].sort(
      (a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0),
    );
    onProgressRef.current?.(
      aggregateZoneProgress(
        keys.map(key =>
          Object.assign(
            {
              key,
              name: zoneNames.current.get(key),
              state: buildStates.current.get(key),
              step: buildSteps.current.get(key),
              reported: reported.indexOf(key),
            },
            buildRecords.current.get(key),
          ),
        ),
      ),
    );
  }, []);

  useEffect(() => {
    progressClosed.current = false;
    if (claims.current.claims.size > 0) emitProgress();
    return () => {
      progressClosed.current = true;
      onProgressRef.current?.(aggregateZoneProgress([]));
    };
  }, [emitProgress]);

  const reportBuildState = useCallback(
    (key: string, state: ZoneBuildState, metrics?: SurfaceZoneMetrics) => {
      if (buildStates.current.get(key) === state) return;
      buildStates.current.set(key, state);
      buildSteps.current.delete(key);
      const now = performance.now();
      buildRecords.current.set(
        key,
        state === 'building'
          ? { counts: {}, startedAt: now }
          : { ...buildRecords.current.get(key), metrics, finishedAt: now },
      );
      emitProgress();
    },
    [emitProgress],
  );

  const reportBuildProgress = useCallback(
    (key: string, step: ZoneBuildProgress) => {
      buildSteps.current.delete(key);
      buildSteps.current.set(key, step);
      const record = buildRecords.current.get(key) ?? {};
      buildRecords.current.set(key, {
        ...record,
        counts: { ...record.counts, [step.phase]: step.total },
      });
      emitProgress();
    },
    [emitProgress],
  );

  const nameZone = useCallback(
    (key: string, name: string | undefined) => {
      if (zoneNames.current.get(key) === name) return;
      if (name === undefined) zoneNames.current.delete(key);
      else zoneNames.current.set(key, name);
      emitProgress();
    },
    [emitProgress],
  );

  /** Drop everything held for a zone that is going away for good. */
  const releaseZone = useCallback(
    (key: string) => {
      releaseFromStore(claims.current, key);
      mountOrder.current.delete(key);
      zoneNames.current.delete(key);
      buildStates.current.delete(key);
      buildSteps.current.delete(key);
      buildRecords.current.delete(key);
      rebuildRegistry();
      emitProgress();
    },
    [rebuildRegistry, emitProgress],
  );

  const publishBoundary = useCallback(
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

  // --- Sampling: what the zones have DRAWN, offered to anything placed on it.
  //     Kept out of the context value above, which is what every zone's build
  //     spec is derived from — a sibling finishing its geometry must not disturb
  //     it. The version is the signal to sample again. -------------------------
  const drawn = useRef(new Map<string, SurfaceSamplerEntry[]>());
  const [drawnVersion, setDrawnVersion] = useState(0);
  const samplerRegistry = useMemo<SurfaceSamplerRegistry>(
    () => ({
      register(key, entries) {
        // Tagged here rather than by the zone: the key is what makes a set of caps
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

  // What the shared build LOADS: a surface no zone claims would be fetched,
  // resampled onto the common grid and cascaded through the resolve for nothing.
  // Appearance needs no equivalent — a horizon is drawn by the zone it is the lid
  // of, so nothing has to be borrowed across a seam.
  const column = useMemo(
    () => surfaces?.filter(m => claimed.has(m.id)),
    [surfaces, claimed],
  );

  // The sea bed is declared, never inferred: the column holds it only while a zone
  // draws it, and there is no sea without it to end on.
  const seabedMeta = useMemo(
    () => (seabed != null ? column?.find(m => m.id === seabed) : undefined),
    [column, seabed],
  );
  const seaWater = seabedMeta ? stableWater : undefined;
  const missingBedWarned = useRef<string | null>(null);
  useEffect(() => {
    if (!stableWater || !column?.length || seabedMeta) return;
    const key = seabed ?? '';
    if (missingBedWarned.current === key) return;
    missingBedWarned.current = key;
    console.warn(
      seabed == null
        ? 'ZoneStack: `water` needs a `seabed` — no sea is drawn.'
        : `ZoneStack: no zone draws the sea bed '${seabed}' — no sea is drawn.`,
    );
  }, [stableWater, column, seabedMeta, seabed]);
  const seabedId = seabedMeta?.id;

  // The bed the sea stands on, exactly as the sea and every zone are built on it: the
  // column's bed channel (the relief, on one), handed back with the sea's geometry. Its
  // grid drives the bed tint per fragment, and it is the sea surface's only depth input:
  // without it the water shader uses the view angle as a stand-in and cannot tell a
  // shoal from open sea.
  const [bedTint, setBedTint] = useState<{
    bed: StackBedGrid;
    map: ZoneDepthMap;
  } | null>(null);
  useEffect(() => () => bedTint?.map.texture.dispose(), [bedTint]);
  const bathymetry = bedTint?.map ?? null;

  // --- Fence depths: the trajectory above and below every unit a cut may take is
  //     left out of the fence (see `ZoneCutDepths`). Held as two primitives, so a
  //     zone re-publishing the same range does not rebuild the fence. ---------
  const cutDepths = useRef(new Map<string, ZoneCutDepths>());
  const [cutRange, setCutRange] = useState<ZoneCutDepths | null>(null);
  const publishCutDepths = useCallback(
    (key: string, depths: ZoneCutDepths | null) => {
      if (depths) cutDepths.current.set(key, depths);
      else cutDepths.current.delete(key);
      let next: ZoneCutDepths | null = null;
      for (const d of cutDepths.current.values()) {
        next = next
          ? {
              top: Math.min(next.top, d.top),
              bottom: Math.max(next.bottom, d.bottom),
              floor: next.floor || d.floor,
            }
          : { ...d };
      }
      setCutRange(previous =>
        previous?.top === next?.top &&
        previous?.bottom === next?.bottom &&
        previous?.floor === next?.floor
          ? previous
          : next,
      );
    },
    [],
  );
  const fenceWater = fence?.water === true;
  const fenceRange = useMemo(() => {
    if (!cutRange) return null;
    let { top, bottom } = cutRange;
    if (cutRange.floor && stableCarrier) {
      let deepest = bottom;
      for (const meta of column ?? []) deepest = Math.max(deepest, meta.max);
      bottom = Math.max(
        bottom,
        stableCarrier.depth ?? deepest + (stableCarrier.below ?? 0),
      );
    }
    // A fence that cuts the sea follows the well up through it.
    if (fenceWater && seaWater) top = Math.min(top, seaWater.depth ?? 0);
    return { low: -bottom, high: -top };
  }, [cutRange, stableCarrier, column, fenceWater, seaWater]);

  const {
    state: fenceState,
    uniforms: fenceUniforms,
    uniformsInverse: fenceUniformsInverse,
    built: fenceBuilt,
    side: fenceSide,
  } = useStackFence(
    fence,
    boundary,
    store,
    utm?.utmToArea,
    stackFrame,
    onFence,
    fenceRange?.low,
    fenceRange?.high,
  );

  const fenceOverlayUniforms = useStackFenceOverlay(
    fence?.overlay,
    fence?.enabled !== false,
    fenceSide,
  );
  // Its palette is a shared one (`colorRampPalette`).
  useSharedTextures();

  // ⚠️ Held in a ref, like `onFence`, so an inline callback does not re-announce the same side.
  const announceSide = useRef(onFenceSide);
  announceSide.current = onFenceSide;
  const areaToUtm = utm?.areaToUtm;
  useEffect(() => {
    if (!fenceBuilt || !areaToUtm) {
      announceSide.current?.(null);
      return;
    }
    announceSide.current?.({
      fence: fenceBuilt.fence,
      side: fenceSide,
      curve: fenceBuilt.curves[fenceSide],
      rings: fenceBuilt.rings,
      verticalRange: fenceBuilt.fence.report.verticalRange,
      toUtm: (x, z) => {
        const p = areaToUtm(x, 0, z);
        return [p.easting, p.northing];
      },
    });
  }, [fenceBuilt, fenceSide, areaToUtm]);

  const announceCut = useRef(onCut);
  announceCut.current = onCut;
  useEffect(() => {
    announceCut.current?.({ plane: sectionUniform, fence: fenceUniforms });
    return () => announceCut.current?.(null);
  }, [sectionUniform, fenceUniforms]);

  // Registered after both cuts' frames, so it reads this frame's state.
  useFrame(() => {
    if (fenceState?.enabled) sectionUniformInverse.value.set(0, 0, 0, -1);
    else sectionUniformInverse.value.copy(sectionUniform.value).negate();
  });

  // Under a vertical exaggeration the column's top could not meet the relief, which has
  // none: the stack's frame is an identity, so its world matrix shows any above it.
  const [exaggerated, setExaggerated] = useState(false);
  useFrame(() => {
    const root = stackFrame.current;
    if (!stableRelief || !root) return;
    const e = root.matrixWorld.elements;
    const now =
      Math.abs(
        Math.hypot(e[4], e[5], e[6]) / Math.hypot(e[0], e[1], e[2]) - 1,
      ) > 1e-4;
    if (now !== exaggerated) setExaggerated(now);
  });
  const columnRelief = useMemo(() => {
    if (!stableRelief || !seabedId || exaggerated) return null;
    if (stableRelief.margin !== undefined)
      return { source: stableRelief, seabed: seabedId };
    // Above the relief by what the column's own tessellation may stray, so its faces
    // reach the ground as drawn, and the clip ends them there.
    const margin = maxError ?? DEFAULT_ZONE_MAX_ERROR;
    return {
      source: {
        ...stableRelief,
        margin,
        key: `${stableRelief.key}|margin=${margin}`,
      },
      seabed: seabedId,
    };
  }, [stableRelief, seabedId, exaggerated, maxError]);
  // On a relief, the column's top is the ground, not its cap.
  const stackSampler = useMemo(
    () =>
      columnRelief
        ? createReliefTopSampler(sampler, {
            seabed: columnRelief.seabed,
            margin: columnRelief.source.margin ?? 0,
            relief: reliefSampler,
          })
        : sampler,
    [sampler, columnRelief, reliefSampler],
  );
  // Compiled into every material while the column is on the relief, clip or not.
  const onRelief = !!columnRelief;
  const clipBinding = useMemo(
    () => (onRelief ? createHeightFieldClipBinding() : null),
    [onRelief],
  );
  useLayoutEffect(() => {
    clipBinding?.set(clip ?? null);
  }, [clipBinding, clip]);
  useEffect(() => {
    if (stableRelief && exaggerated)
      console.warn(
        'ZoneStack: the stack is exaggerated vertically and the relief is not — the column builds on its own sea bed.',
      );
  }, [stableRelief, exaggerated]);

  // ⚠️ Not `enabled`: the cut channels are a build output, so keying them on the
  // toggle would rebuild the sea and every zone each time a cut is switched.
  const hasCut = prepareCuts || !!section || !!fence;

  const sea = useStackWater(
    seaWater,
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
  //     caller may declare zones in any order and the ramp is a property of
  //     depth. -------------------------------------------------------------
  const [margins, setMargins] = useState<ZoneMarginEntry[]>([]);

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
    (key: string, entry: ZoneMarginEntry | null) => {
      if (entry) marginEntries.current.set(key, entry);
      else marginEntries.current.delete(key);
      rebuildMargins();
    },
    [rebuildMargins],
  );

  const value = useMemo<ZoneStackContextValue>(() => {
    const envelope =
      cutSource?.kind === 'wellbores'
        ? wellboreEnvelope
        : cutSource?.kind === 'polygon'
          ? cutSource.polygon
          : boundary;
    return {
      boundary,
      cutSource,
      surfaces,
      column,
      carrier: stableCarrier,
      // Read off the LIVE prop, not the geometry-keyed copy, which is deliberately
      // stale whenever only the appearance changed.
      carrierMaterial: carrier?.material,
      carrierDetail,
      contacts: contactTextures,
      water: seaWater ?? null,
      seabed: seabedId ?? null,
      columnRelief,
      heightClip: clipBinding?.uniforms,
      drawWater,
      waterTintShown,
      waterBody: sea?.surface.water ?? null,
      bathymetry,
      prepareCuts: hasCut,
      section: sectionState,
      sectionUniform,
      sectionUniformInverse,
      sectionCarrier: section?.carrier === true,
      sectionWater: section?.water === true,
      fence: fenceState,
      fenceUniforms,
      fenceUniformsInverse,
      fenceOverlayUniforms,
      fenceCarrier: fence?.carrier === true,
      fenceWater: fence?.water === true,
      resolve: stableResolve,
      envelope,
      rimSpacing,
      maxError,
      diagnostics,
      preview,
      previewSaturation,
      debugTiles,
      lodLevel,
      lodPixelError,
      boundaries: registry,
      seams,
      margins,
      registerZone,
      releaseZone,
      publishBoundary,
      publishMargin,
      publishCutDepths,
      reportBuildState,
      reportBuildProgress,
      nameZone,
    };
  }, [
    boundary,
    cutSource,
    surfaces,
    column,
    stableCarrier,
    carrier?.material,
    carrierDetail,
    contactTextures,
    seaWater,
    seabedId,
    columnRelief,
    clipBinding,
    drawWater,
    waterTintShown,
    sea,
    bathymetry,
    hasCut,
    sectionState,
    sectionUniform,
    sectionUniformInverse,
    section?.carrier,
    section?.water,
    fenceState,
    fenceUniforms,
    fenceUniformsInverse,
    fenceOverlayUniforms,
    fence?.carrier,
    fence?.water,
    stableResolve,
    wellboreEnvelope,
    rimSpacing,
    maxError,
    diagnostics,
    preview,
    previewSaturation,
    debugTiles,
    lodLevel,
    lodPixelError,
    registry,
    seams,
    margins,
    registerZone,
    releaseZone,
    publishBoundary,
    publishMargin,
    publishCutDepths,
    reportBuildState,
    reportBuildProgress,
    nameZone,
  ]);

  // --- The sea (rendered here, not by a zone): a lid covers its whole footprint
  //     by design, so two zones each drawing part of it would leave two coplanar
  //     lids wherever their footprints overlap. -------------------------------
  const waterGenerator = useGenerator<StackWaterResponse>(stackWater);

  const waterSpec = useMemo(() => {
    // Needs a footprint to be drawn over, and a bed in the column to end against.
    if (!seaWater || !seabedId || !boundary || !utm) return null;
    if (!column || column.length === 0) return null;
    const envelope = value.envelope;
    if (!envelope) return null;
    return buildStackWaterSpec(seaWater, utm.utmToArea, boundary, {
      surfaces: column,
      bed: seabedId,
      envelope,
      carrier: stableCarrier,
      relief: columnRelief,
      rimSpacing,
      maxError,
      resolve: stableResolve,
      section: hasCut,
    });
  }, [
    seaWater,
    seabedId,
    boundary,
    utm,
    column,
    value.envelope,
    stableCarrier,
    columnRelief,
    rimSpacing,
    maxError,
    stableResolve,
    hasCut,
  ]);

  const hasEnvelope = !!value.envelope;
  useEffect(() => {
    if (columnRelief && !hasEnvelope)
      console.warn(
        'ZoneStack: a `relief` needs the shared column (a `boundary` or a `cutSource`) — the sea bed is built on its surface.',
      );
  }, [columnRelief, hasEnvelope]);

  const [seaGeometry, setSeaGeometry] = useState<{
    lid: BufferGeometry | null;
    body: BufferGeometry | null;
    section?: StackSectionSource;
  } | null>(null);

  useEffect(() => {
    if (!waterSpec) {
      setBedTint(null);
      return;
    }
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
      const bed = response?.bed ?? null;
      // The same bed when only the sea changed: kept, so its materials are too.
      setBedTint(held =>
        held && bed && sameStackBedGrid(held.bed, bed)
          ? held
          : bed && { bed, map: buildChannelDepthMap(bed) },
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

  // Compiled even while hidden (`drawWater={false}`, a sky drawing it), so showing it
  // again does not stall a frame on its programs.
  const gl = useThree(state => state.gl);
  const camera = useThree(state => state.camera);
  const scene = useThree(state => state.scene);
  const seaRoot = useRef<Group>(null);
  const seaSurface = sea?.surface;
  const seaVolume = sea?.volume;
  useLayoutEffect(() => {
    if (seaRoot.current && seaSurface)
      void precompile(gl, seaRoot.current, camera, scene);
  }, [gl, camera, scene, seaSurface, seaVolume, seaGeometry]);

  // The stack's water ends at its seabed: how far down, its deepest under its level (the
  // body's bottom under the lid's), where the bed's map does not say (its edges). As `Ocean`.
  useLayoutEffect(() => {
    if (!seaSurface) return;
    const lid = seaGeometry?.lid;
    const body = seaGeometry?.body;
    if (!lid || !body) {
      seaSurface.water.depth = Infinity;
      return;
    }
    if (!lid.boundingBox) lid.computeBoundingBox();
    if (!body.boundingBox) body.computeBoundingBox();
    const level = (lid.boundingBox!.min.y + lid.boundingBox!.max.y) / 2;
    seaSurface.water.depth = Math.max(level - body.boundingBox!.min.y, 0);
  }, [seaSurface, seaGeometry]);

  // Where the camera is at the stack's water (the camera site's), and the water synced to it
  // before the frame, so its walls and what lies in it have this frame's (as `Ocean`). Where a
  // cut takes the water, none stands: the camera there is in air (`OceanMaterial.cameraCut`).
  const seaLid = useRef<Mesh>(null);
  const sectionTakesWater = section?.water === true;
  const fenceTakesWater = fence?.water === true;
  const [seaScratch] = useState(() => ({
    eye: new Vector3(),
    toStack: new Matrix4(),
  }));
  useLayoutEffect(() => {
    if (!seaSurface) return;
    seaSurface.cameraCut = (position: Vector3) => {
      // The camera in the stack's own frame, where the cuts are.
      const root = stackFrame.current;
      const eye = seaScratch.eye.copy(position);
      if (root) {
        root.updateWorldMatrix(true, false);
        eye.applyMatrix4(seaScratch.toStack.copy(root.matrixWorld).invert());
      }
      if (sectionTakesWater && sectionState?.enabled) {
        const plane = sectionState.plane;
        if (plane.normal.dot(eye) > -plane.constant) return true;
      }
      return (
        fenceTakesWater &&
        !!fenceState?.enabled &&
        !!fenceState.index &&
        !!fenceState.field &&
        fenceSideAt(fenceState.index, fenceState.field, eye.x, eye.z) < 0
      );
    };
    return () => {
      seaSurface.cameraCut = null;
    };
  }, [
    seaSurface,
    seaScratch,
    sectionTakesWater,
    fenceTakesWater,
    sectionState,
    fenceState,
  ]);
  const seaProbe = useCallback<CameraProbe>(
    (site, probeCamera) => {
      const mesh = seaLid.current;
      if (!seaSurface || !mesh || !mesh.visible) return;
      mesh.updateWorldMatrix(true, false);
      reportCameraWater(
        site,
        seaSurface.syncWater(scene, probeCamera, mesh.geometry, mesh),
      );
    },
    [seaSurface, scene],
  );
  const cameraSite = useCameraProbe(seaProbe, CAMERA_PROBE_ORDER.water);
  useFrame(({ camera: frameCamera }) => {
    if (seaSurface) cameraSite.get(frameCamera);
  });

  // ⭐ The face that CLOSES the water body at a cut, off the sea's own channels —
  // so it meets the block's face on the same curve, over the same bed, rather than
  // leaving an open body to look into. Same two builders the zones use; the sea is
  // a stack of two horizons, so each yields at most one face.
  const waterPlaneFace = useZoneSection(seaGeometry?.section, sectionState);
  const waterFenceFace = useZoneFenceFace(seaGeometry?.section, fenceState);
  const waterFace = fenceState?.enabled ? waterFenceFace : waterPlaneFace;
  // A sea the live cut leaves whole is closed by its bed cap instead (see `ZoneMeshes`).
  const seaCut = fenceState?.enabled
    ? fence?.water === true
    : section?.water === true;

  // The stack's extent in its OWN frame, for the section debug view: XZ from the
  // footprint everything is cut from, Y from the column's depth range and the
  // floor under it.
  const sectionBounds = useMemo(() => {
    if (!section?.debug) return null;
    const polygon = value.envelope ?? boundary;
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
    if (seaWater) top = Math.max(top, -(seaWater.depth ?? 0));
    if (bottom >= top) bottom = top - 1;
    return {
      min: [min[0], bottom, min[1]] as Vec3,
      max: [max[0], top, max[1]] as Vec3,
    };
  }, [
    section?.debug,
    value.envelope,
    boundary,
    column,
    stableCarrier,
    seaWater,
  ]);

  return (
    <ZoneStackContext.Provider value={value}>
      <SurfaceSamplerRegistryContext.Provider value={samplerRegistry}>
        <SurfaceSamplerContext.Provider value={stackSampler}>
          <OceanSamplerContext.Provider value={sea?.sampler ?? null}>
            <OceanContactContext.Provider value={sea?.contacts ?? null}>
              {/* Identity transform, present so a camera-locked section has a
                  frame to be brought into (see the `useFrame` above). */}
              <group ref={stackFrame}>
                {immersion && (
                  <StackImmersionFog
                    immersion={immersion}
                    water={drawWater ? (seaWater ?? null) : null}
                    sampler={stackSampler}
                    base={blockBase}
                    section={sectionState}
                    sectionWater={section?.water === true}
                    fence={fenceState}
                    fenceWater={fence?.water === true}
                    frame={stackFrame}
                  />
                )}
                <group ref={seaRoot}>
                  {sea && seaGeometry?.lid && (
                    <mesh
                      ref={seaLid}
                      geometry={seaGeometry.lid}
                      material={sea.surface}
                      visible={drawWater}
                    />
                  )}
                  {sea && seaGeometry?.body && (
                    <mesh
                      geometry={seaGeometry.body}
                      material={sea.volume}
                      visible={drawWater}
                    />
                  )}
                </group>
                {sea?.face &&
                  seaCut &&
                  waterFace?.map(face => (
                    <mesh
                      key={`${face.interval}-${face.wall}`}
                      geometry={face.geometry}
                      material={sea.face!}
                      visible={drawWater}
                    />
                  ))}
                {sectionBounds && (
                  <ZoneSectionDebug
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
    </ZoneStackContext.Provider>
  );
};
