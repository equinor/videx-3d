import {
  AddEquation,
  Camera,
  Color,
  CustomBlending,
  FloatType,
  HalfFloatType,
  Material,
  Mesh,
  MeshBasicMaterial,
  NearestFilter,
  NoBlending,
  OneFactor,
  OneMinusSrcAlphaFactor,
  RawShaderMaterial,
  RedFormat,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  SrcAlphaFactor,
  Texture,
  Uniform,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import { LAYERS } from '../../layers/layers';
import { FullscreenRenderer } from '../fullscreen-renderer';
import { GpuTimer } from '../gpu-timer';
import { isOitCapable, OitCapableMaterial, OitPass } from '../oit-material';
import { Pass } from '../Pass';
import { getRenderingState } from '../rendering-state';
import copyVertexShader from '../shaders/copy-vert.glsl';
import compositeFragmentShader from '../shaders/oit-composite-frag.glsl';
import debugFragmentShader from '../shaders/oit-debug-frag.glsl';

/** A scene object that can be drawn (mesh, line or points). */
type Renderable = Mesh & {
  isMesh?: boolean;
  isLine?: boolean;
  isPoints?: boolean;
  material: Material | Material[];
};

const OIT_PASSES: OitPass[] = ['depthMin', 'accum', 'front', 'occlusion'];
const WHITE = new Color(1, 1, 1);
const BLACK = new Color(0, 0, 0);

/**
 * Shared no-op material: issues the draw but writes nothing. Used to skip an
 * individual material group of a multi-material mesh in a given pass. It must be a
 * compilable material type (a bare `Material` has no shaders and would crash Three's
 * program compilation), so a `MeshBasicMaterial` with all writes disabled is used.
 */
const NOOP_MATERIAL = new MeshBasicMaterial();
NOOP_MATERIAL.colorWrite = false;
NOOP_MATERIAL.depthWrite = false;
NOOP_MATERIAL.depthTest = false;
NOOP_MATERIAL.blending = NoBlending;

type RenderableKind = 'opaque' | 'oit';

/** Per-frame object counts for each classification, exposed for debugging. */
export type OITRenderPassStats = {
  /** Plain opaque renderables (not OIT-capable, not overlay). */
  opaque: number;
  /** OIT-capable renderables currently transparent (routed through OIT). */
  oit: number;
  /**
   * OIT-capable renderables that are currently fully opaque and therefore drawn in
   * the opaque pass as real occluders (depth-writing), bypassing the OIT passes.
   */
  oitOpaque: number;
  /** Additive/glow renderables (tagged `LAYERS.EMISSIVE`), drawn before the transparent layers. */
  emissive: number;
  /** Always-on-top renderables (tagged `LAYERS.OVERLAY`), drawn after the transparent layers. */
  overlay: number;
  /** Subset of `oit` whose whole material is OIT-capable (hidden in opaque pass). */
  oitHidden: number;
  /** Subset of `oit` that are mixed multi-material meshes (some opaque groups). */
  oitMixed: number;
};

/**
 * Per-segment GPU timings in milliseconds, populated when {@link OITRenderPass.profile}
 * is enabled and the platform supports timer queries. `-1` means "no result yet"
 * (or unsupported). `tail` is the single weighted-blended OIT pass cost.
 */
export type OITRenderPassTimings = {
  /** Opaque pass (step 1), including any forced-opaque OIT occluders. */
  opaque: number;
  /** Additive/glow emissive pass (step 1b). */
  emissive: number;
  /** Min-depth pre-pass (step 2). */
  minDepth: number;
  /** Weighted-blended OIT tail pass (step 3). */
  tail: number;
  /** Fullscreen tail composite (step 4). */
  composite: number;
  /** Exact front-layer pass (step 5). */
  front: number;
  /** Optional occlusion depth-stamp pass (step 5b). */
  occlusion: number;
  /** Optional emitter depth-stamp pass (step 1c). */
  emitterStamp: number;
  /** Always-on-top overlay pass (step 6). */
  overlay: number;
  /** Sum of the measured OIT segments above. */
  total: number;
};

/** Cached per-object classification and per-pass material swaps. */
type RenderableEntry = {
  object: Renderable;
  kind: RenderableKind;
  /** Identity signature of the object's material(s) to detect changes. */
  signature: Material | Material[];
  original: Material | Material[];
  /** Material(s) for the opaque pass (OIT groups replaced with no-op). */
  opaqueSwap: Material | Material[];
  /** Material(s) per OIT pass (opaque groups replaced with no-op). */
  passSwaps: Record<OitPass, Material | Material[]>;
};

/**
 * Hybrid order-independent-transparency (OIT) render pass for use with the
 * {@link RenderingPipeline} (or any custom composer). Renders the nearest transparent
 * layer exactly (depth-peeled, alpha-over) and the remaining layers using
 * weighted-blended OIT (WBOIT), partitioned per-pixel in view-space linear depth.
 *
 * Transparency is opt-in: this pass only affects materials that are OIT-capable
 * (library materials, or stock/user materials patched with `makeOitCompatible`).
 * Two per-object escape-hatch layers override the default routing: `LAYERS.FORCE_OPAQUE`
 * draws the object as a depth-writing opaque occluder (its material is temporarily
 * forced to `depthWrite=true, transparent=false`); `LAYERS.OIT_EXCLUDED` also draws it
 * in the opaque pass but leaves the material's own properties untouched.
 * Additive/glow objects tagged with the `LAYERS.EMISSIVE` layer are drawn between the
 * opaque and transparent layers (so transparent surfaces in front attenuate them);
 * always-on-top objects tagged with the `LAYERS.OVERLAY` layer are drawn last, on top
 * of the resolved transparency. While this pass is active it sets the per-canvas
 * rendering state to `'oit'` so components can disable conflicting self-transparency
 * workarounds.
 *
 * @example
 * ```tsx
 * const passes = useMemo(
 *   () => [new OITRenderPass(scene, camera), new OutputPass()],
 *   [scene, camera],
 * );
 * return <RenderingPipeline passes={passes} />;
 * ```
 *
 * @group Rendering
 * @see {@link RenderingPipeline}
 * @see {@link makeOitCompatible}
 */
export class OITRenderPass extends Pass {
  private scene: Scene;
  private camera: Camera;

  /**
   * Debug: when true, the exact depth-peeled front layer is disabled and every
   * transparent fragment is resolved through the weighted-blended (WBOIT) tail.
   * Useful for isolating tail behaviour and comparing against the hybrid result.
   */
  skipFront: boolean = false;

  /**
   * Optional feature (default off): after the transparent OIT passes, stamp depth
   * for transparent surfaces wherever their own alpha is at least
   * {@link occlusionDepthThreshold}. Transparent surfaces normally write no depth, so
   * annotation labels behind a high-but-not-full opacity surface are never occluded;
   * enabling this makes a surface occlude labels once its alpha clears the threshold.
   *
   * The test is per-fragment and per-surface (each surface judged on its own alpha,
   * not accumulated coverage), and the stamped depth uses the same encoding the
   * {@link AnnotationsPass} already samples. Costs one extra transparent-geometry
   * pass per frame when enabled; nothing (not even a shader compile) when off.
   */
  occlusionDepthStamp: boolean = false;

  /** Alpha threshold (0..1) for {@link occlusionDepthStamp}. Default 0.5. */
  occlusionDepthThreshold: number = 0.5;

  /**
   * Optional feature (default off): stamp depth for emissive/glow emitters (objects
   * on `LAYERS.EMISSIVE`) wherever their fragment strength is at least
   * {@link emitterDepthThreshold}, drawn before the transparent OIT passes. This lets
   * the dense core of an additive emitter (e.g. perforation jets) occlude transparent
   * surfaces behind it, preventing the wash-out where a far transparent surface would
   * otherwise dim the emitter. Surfaces in front still attenuate it.
   *
   * An emitter opts in by exposing a depth-only stamp material on its material's
   * `userData.occlusionDepthMaterial` (with a `uOcclusionThreshold` uniform the pass
   * drives). Emitters without one are simply skipped. Costs one extra emissive pass
   * per frame when enabled; nothing when off.
   */
  emitterDepthStamp: boolean = false;

  /** Strength threshold (0..1) for {@link emitterDepthStamp}. Default 0.5. */
  emitterDepthThreshold: number = 0.5;

  /**
   * When true, draws small thumbnails of the internal render targets (min-depth,
   * accumulation) into the bottom-left of the output, for debugging.
   * GPU-only; no pixel readback.
   */
  debugTargets: boolean = false;

  /**
   * When true, measures per-segment GPU time (opaque/emissive/min-depth/tail/
   * composite/front/overlay) via timer queries and exposes it on {@link timings}. Adds a
   * little CPU/driver overhead and lags a few frames, so it is off by default. No-op
   * on platforms without `EXT_disjoint_timer_query_webgl2`.
   *
   * The most relevant figure for the transparent-geometry cost is
   * {@link OITRenderPassTimings.tail}.
   */
  profile: boolean = false;

  /**
   * Per-segment GPU timings (ms) from the last completed measurement. Only updated
   * while {@link profile} is enabled. `-1` means "no result yet" or unsupported.
   */
  readonly timings: OITRenderPassTimings = {
    opaque: -1,
    emissive: -1,
    minDepth: -1,
    tail: -1,
    composite: -1,
    front: -1,
    occlusion: -1,
    emitterStamp: -1,
    overlay: -1,
    total: -1,
  };

  /**
   * Per-frame object counts for each pass, updated every {@link render}. Useful for
   * verifying which objects are routed through OIT vs. drawn opaque/overlay.
   */
  readonly stats: OITRenderPassStats = {
    opaque: 0,
    oit: 0,
    oitOpaque: 0,
    emissive: 0,
    overlay: 0,
    oitHidden: 0,
    oitMixed: 0,
  };

  private fullscreenRenderer = new FullscreenRenderer();

  private minDepthTarget: WebGLRenderTarget;
  private accumTarget: WebGLRenderTarget;
  private compositeMaterial: RawShaderMaterial;

  /** Lazily-created material for the debug-target thumbnails. */
  private debugMaterial: RawShaderMaterial | null = null;

  /** Lazily-created GPU timer, only when {@link profile} is first enabled. */
  private gpuTimer: GpuTimer | null = null;

  private releaseOit?: () => void;
  private entryCache = new WeakMap<Renderable, RenderableEntry>();

  /** Saved material state for OIT objects temporarily forced opaque this frame. */
  private forcedOpaque: {
    material: Material;
    depthWrite: boolean;
    transparent: boolean;
  }[] = [];

  private width = 1;
  private height = 1;
  private depthFar = 1;

  constructor(scene: Scene, camera: Camera) {
    super();
    this.scene = scene;
    this.camera = camera;

    this.minDepthTarget = new WebGLRenderTarget(1, 1, {
      format: RedFormat,
      type: FloatType,
      depthBuffer: true,
      magFilter: NearestFilter,
      minFilter: NearestFilter,
      generateMipmaps: false,
    });
    this.accumTarget = new WebGLRenderTarget(1, 1, {
      format: RGBAFormat,
      type: HalfFloatType,
      depthBuffer: true,
      generateMipmaps: false,
    });

    // Tail composite: alpha-over the weighted-blended tail onto the main target.
    this.compositeMaterial = new RawShaderMaterial({
      vertexShader: copyVertexShader,
      fragmentShader: compositeFragmentShader,
      uniforms: {
        accumTexture: new Uniform<Texture | null>(null),
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: CustomBlending,
      blendEquation: AddEquation,
      blendSrc: SrcAlphaFactor,
      blendDst: OneMinusSrcAlphaFactor,
      blendEquationAlpha: AddEquation,
      blendSrcAlpha: OneFactor,
      blendDstAlpha: OneMinusSrcAlphaFactor,
    });

    // Register as an active OIT pipeline for this canvas.
    this.releaseOit = getRenderingState(scene).getState().acquireOit();
  }

  setSize(width: number, height: number) {
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    this.minDepthTarget.setSize(this.width, this.height);
    this.accumTarget.setSize(this.width, this.height);
  }

  dispose() {
    this.minDepthTarget.dispose();
    this.accumTarget.dispose();
    this.compositeMaterial.dispose();
    this.debugMaterial?.dispose();
    this.fullscreenRenderer.dispose();
    this.gpuTimer?.dispose();
    this.gpuTimer = null;
    this.releaseOit?.();
    this.releaseOit = undefined;
  }

  // ---- classification -----------------------------------------------------

  private getEntry(object: Renderable): RenderableEntry {
    const cached = this.entryCache.get(object);
    if (cached && cached.signature === object.material) {
      return cached;
    }

    const material = object.material;
    let entry: RenderableEntry;

    if (Array.isArray(material)) {
      const hasOit = material.some(isOitCapable);
      const opaqueSwap = material.map(m =>
        isOitCapable(m) ? NOOP_MATERIAL : m,
      );
      const passSwaps = {} as Record<OitPass, Material | Material[]>;
      for (const pass of OIT_PASSES) {
        passSwaps[pass] = material.map(m =>
          isOitCapable(m)
            ? (m as Material & OitCapableMaterial).getOitVariants()[pass]
            : NOOP_MATERIAL,
        );
      }
      entry = {
        object,
        kind: hasOit ? 'oit' : 'opaque',
        signature: material,
        original: material,
        opaqueSwap,
        passSwaps,
      };
    } else {
      const oit = isOitCapable(material);
      const passSwaps = {} as Record<OitPass, Material | Material[]>;
      if (oit) {
        const variants = (
          material as Material & OitCapableMaterial
        ).getOitVariants();
        for (const pass of OIT_PASSES) passSwaps[pass] = variants[pass];
      } else {
        for (const pass of OIT_PASSES) passSwaps[pass] = NOOP_MATERIAL;
      }
      entry = {
        object,
        kind: oit ? 'oit' : 'opaque',
        signature: material,
        original: material,
        opaqueSwap: oit ? NOOP_MATERIAL : material,
        passSwaps,
      };
    }

    this.entryCache.set(object, entry);
    return entry;
  }

  /**
   * Traverse the scene once, classifying renderables into transparent-OIT,
   * plain-opaque, emissive (additive/glow) and always-on-top overlay sets.
   * OIT-capable objects that are currently fully opaque, or explicitly tagged with
   * the `LAYERS.FORCE_OPAQUE` layer, are added to both `opaqueList` (for the
   * visibility lifecycle) and `oitOpaqueList` (so their materials can be forced
   * depth-writing), making them real occluders. Objects tagged `LAYERS.OIT_EXCLUDED`
   * are added to `opaqueList` only, so they render with their material untouched.
   * Emissive objects are detected by the EMISSIVE layer, overlay objects by the
   * OVERLAY layer.
   */
  private collect(
    oitList: RenderableEntry[],
    opaqueList: Renderable[],
    emissiveList: Renderable[],
    overlayList: Renderable[],
    oitOpaqueList: RenderableEntry[],
  ) {
    this.scene.traverse(obj => {
      const r = obj as Renderable;
      if (!(r.isMesh || r.isLine || r.isPoints) || !r.material) return;

      if (r.layers.isEnabled(LAYERS.OVERLAY)) {
        overlayList.push(r);
        return;
      }

      if (r.layers.isEnabled(LAYERS.EMISSIVE)) {
        emissiveList.push(r);
        return;
      }

      const entry = this.getEntry(r);
      if (entry.kind !== 'oit') {
        opaqueList.push(r);
      } else if (r.layers.isEnabled(LAYERS.OIT_EXCLUDED)) {
        // Escape hatch: render via the standard pipeline in the opaque pass,
        // bypassing OIT entirely, but leave the material's own properties intact
        // (no forced depthWrite/transparent). Not added to oitOpaqueList so
        // applyForcedOpaque never touches it.
        opaqueList.push(r);
      } else if (
        r.layers.isEnabled(LAYERS.FORCE_OPAQUE) ||
        this.isEntryOpaque(entry)
      ) {
        // Forced opaque via the FORCE_OPAQUE layer (user escape hatch) or fully
        // opaque right now: draw it as a real depth-writing occluder in the opaque
        // pass (pushed to opaqueList for the visibility lifecycle) and skip OIT.
        oitOpaqueList.push(entry);
        opaqueList.push(r);
      } else {
        oitList.push(entry);
      }
    });
  }

  // ---- material swapping --------------------------------------------------

  /**
   * Prepare the OIT renderables for the opaque pass. Objects whose whole material
   * is OIT-capable are simply hidden (and collected into `hidden` for restore), so
   * their geometry isn't rasterised at all. Mixed multi-material meshes are swapped
   * to their opaque variant (opaque groups kept, OIT groups drawn as no-op).
   */
  private applyOpaqueSwap(oitList: RenderableEntry[], hidden: Renderable[]) {
    for (const e of oitList) {
      if (e.opaqueSwap === NOOP_MATERIAL) {
        e.object.visible = false;
        hidden.push(e.object);
      } else {
        e.object.material = e.opaqueSwap;
      }
    }
  }

  private applyPassSwap(oitList: RenderableEntry[], pass: OitPass) {
    for (const e of oitList) e.object.material = e.passSwaps[pass];
  }

  private restoreMaterials(oitList: RenderableEntry[]) {
    for (const e of oitList) e.object.material = e.original;
  }

  private setOitUniforms(oitList: RenderableEntry[]) {
    for (const e of oitList) {
      const mats = Array.isArray(e.original) ? e.original : [e.original];
      for (const m of mats) {
        if (!isOitCapable(m)) continue;
        const capable = m as Material & OitCapableMaterial;
        const u = capable.getOitUniforms();
        u.oitDepthFar.value = this.depthFar;
        u.oitScreenSize.value.set(this.width, this.height);
        u.oitMinDepthTexture.value = this.minDepthTarget.texture;
        u.oitSkipFront.value = this.skipFront ? 1 : 0;
        u.oitOcclusionThreshold.value = this.occlusionDepthThreshold;
        // Re-sync the cached per-pass variants with the base material's current
        // program state (defines/wireframe/etc.). The cached pass-swap materials are
        // the same objects, mutated in place, so this keeps them up to date when the
        // base appearance is toggled at runtime.
        capable.getOitVariants();
      }
    }
  }

  private setVisible(objects: Renderable[], visible: boolean) {
    for (const o of objects) o.visible = visible;
  }

  /**
   * Resolve the opt-in depth-stamp material for an emissive emitter, if any. The
   * emitter exposes it on `material.userData.occlusionDepthMaterial`; this also drives
   * its `uOcclusionThreshold` uniform from {@link emitterDepthThreshold}. Returns null
   * when the emitter provides no stamp material (it is then skipped).
   */
  private getEmitterStamp(r: Renderable): Material | null {
    const m = r.material;
    if (Array.isArray(m)) return null;
    const stamp = (m.userData as { occlusionDepthMaterial?: Material })
      ?.occlusionDepthMaterial;
    if (!stamp) return null;
    const u = (stamp as Partial<ShaderMaterial>).uniforms;
    if (u?.uOcclusionThreshold) {
      u.uOcclusionThreshold.value = this.emitterDepthThreshold;
    }
    return stamp;
  }

  // ---- opacity-aware routing ----------------------------------------------

  /**
   * Current effective opacity of a material. `ShaderMaterial`s drive opacity through
   * a `uniforms.opacity` value (the material's own `opacity` field is often left at
   * 1), so prefer that; otherwise use `Material.opacity`.
   */
  private static effectiveOpacity(material: Material): number {
    const u = (material as Partial<ShaderMaterial>).uniforms;
    const o = u?.opacity?.value;
    return typeof o === 'number' ? o : material.opacity;
  }

  /** Whether a material currently renders as fully opaque. */
  private static isMaterialOpaque(material: Material): boolean {
    if (!material.transparent) return true;
    return OITRenderPass.effectiveOpacity(material) >= 1;
  }

  /**
   * Whether an OIT entry is currently fully opaque (every OIT-capable material is
   * opaque). Such objects are drawn in the opaque pass as real occluders instead of
   * being routed through the (more expensive, depth-non-writing) OIT passes.
   */
  private isEntryOpaque(entry: RenderableEntry): boolean {
    const mats = Array.isArray(entry.original)
      ? entry.original
      : [entry.original];
    for (const m of mats) {
      if (isOitCapable(m) && !OITRenderPass.isMaterialOpaque(m)) return false;
    }
    return true;
  }

  /**
   * Temporarily force the OIT-capable materials of the given entries to write depth
   * and render opaque, so they act as genuine occluders during the opaque pass. The
   * previous state is saved and restored by {@link restoreForcedOpaque}. These
   * objects are hidden during the OIT sub-passes, so the forced state only takes
   * effect where intended.
   */
  private applyForcedOpaque(entries: RenderableEntry[]) {
    for (const e of entries) {
      const mats = Array.isArray(e.original) ? e.original : [e.original];
      for (const m of mats) {
        if (!isOitCapable(m)) continue;
        this.forcedOpaque.push({
          material: m,
          depthWrite: m.depthWrite,
          transparent: m.transparent,
        });
        m.depthWrite = true;
        m.transparent = false;
      }
    }
  }

  private restoreForcedOpaque() {
    for (const s of this.forcedOpaque) {
      s.material.depthWrite = s.depthWrite;
      s.material.transparent = s.transparent;
    }
    this.forcedOpaque.length = 0;
  }

  // ---- render -------------------------------------------------------------

  /**
   * Copy the latest smoothed GPU timings out of the timer into {@link timings} and
   * recompute the `total`. Segments without a result yet (or skipped this frame)
   * report `-1` and are excluded from the total.
   */
  private updateTimings(timer: GpuTimer) {
    const t = this.timings;
    t.opaque = timer.get('opaque');
    t.emissive = timer.get('emissive');
    t.minDepth = timer.get('minDepth');
    t.tail = timer.get('tail');
    t.composite = timer.get('composite');
    t.front = timer.get('front');
    t.occlusion = timer.get('occlusion');
    t.emitterStamp = timer.get('emitterStamp');
    t.overlay = timer.get('overlay');
    let total = 0;
    let any = false;
    for (const v of [
      t.opaque,
      t.emissive,
      t.minDepth,
      t.tail,
      t.composite,
      t.front,
      t.occlusion,
      t.emitterStamp,
      t.overlay,
    ]) {
      if (v >= 0) {
        total += v;
        any = true;
      }
    }
    t.total = any ? total : -1;
  }

  render(renderer: WebGLRenderer, buffer: WebGLRenderTarget) {
    const { scene, camera } = this;

    const oitList: RenderableEntry[] = [];
    const opaqueList: Renderable[] = [];
    const emissiveList: Renderable[] = [];
    const overlayList: Renderable[] = [];
    const oitOpaqueList: RenderableEntry[] = [];
    this.collect(oitList, opaqueList, emissiveList, overlayList, oitOpaqueList);

    // Update per-pass object counts for debugging/inspection.
    let oitHidden = 0;
    for (const e of oitList) {
      if (e.opaqueSwap === NOOP_MATERIAL) oitHidden++;
    }
    this.stats.opaque = opaqueList.length - oitOpaqueList.length;
    this.stats.oit = oitList.length;
    this.stats.oitOpaque = oitOpaqueList.length;
    this.stats.emissive = emissiveList.length;
    this.stats.overlay = overlayList.length;
    this.stats.oitHidden = oitHidden;
    this.stats.oitMixed = oitList.length - oitHidden;

    const hasOit = oitList.length > 0;
    const hasEmissive = emissiveList.length > 0;
    const hasOverlay = overlayList.length > 0;

    // Optional GPU profiling. Lazily create the timer, harvest any results that
    // completed since the last frame, then bracket each segment below.
    let timer: GpuTimer | null = null;
    if (this.profile) {
      if (!this.gpuTimer) this.gpuTimer = new GpuTimer(renderer);
      this.gpuTimer.poll();
      this.updateTimings(this.gpuTimer);
      timer = this.gpuTimer;
    }

    // Normalisation factor for view-space depth (use camera.far when available).
    const cam = camera as Camera & { far?: number };
    this.depthFar = cam.far && cam.far > 0 ? cam.far : 1;

    // Share the opaque depth with the auxiliary targets so opaque geometry occludes
    // transparent fragments in every OIT pass.
    const sharedDepth = buffer.depthTexture;
    if (sharedDepth) {
      this.minDepthTarget.depthTexture = sharedDepth;
      this.accumTarget.depthTexture = sharedDepth;
    }

    // Save state we mutate.
    const prevCameraMask = camera.layers.mask;
    const prevClearColor = new Color();
    renderer.getClearColor(prevClearColor);
    const prevClearAlpha = renderer.getClearAlpha();
    const prevBackground = scene.background;
    const prevSortObjects = renderer.sortObjects;

    // ---- step 1: opaque ----------------------------------------------------
    // Exclude emissive and overlay objects; pure-OIT objects are hidden, mixed
    // meshes render their opaque groups (OIT groups as no-op). Fully-opaque OIT
    // objects are forced to write depth so they occlude transparent geometry behind
    // them.
    this.setVisible(emissiveList, false);
    this.setVisible(overlayList, false);
    this.applyForcedOpaque(oitOpaqueList);
    const hiddenOit: Renderable[] = [];
    this.applyOpaqueSwap(oitList, hiddenOit);
    renderer.setRenderTarget(buffer);
    renderer.setClearColor(prevClearColor, prevClearAlpha);
    renderer.clear(true, true, true);
    timer?.begin('opaque');
    renderer.render(scene, camera);
    timer?.end();

    // Background is opaque; null it so it doesn't contaminate the auxiliary passes.
    scene.background = null;

    // Update OIT uniforms now that depthFar/size are known.
    this.setOitUniforms(oitList);

    // ---- step 1b: additive/glow emissive ----------------------------------
    // Drawn here (before the transparent layers) rather than last, so transparent
    // surfaces in front attenuate the glow (e.g. jet streams seen dimmed through
    // a surface). Depth-tested against the opaque depth already in the buffer, so
    // opaque geometry still occludes it. The emissive objects write no depth, so
    // transparent surfaces both in front of and behind them attenuate them
    // (accepted trade-off).
    if (hasEmissive) {
      this.setVisible(emissiveList, true);
      camera.layers.disableAll();
      camera.layers.enable(LAYERS.EMISSIVE);
      renderer.setRenderTarget(buffer);
      timer?.begin('emissive');
      renderer.render(scene, camera);
      timer?.end();

      // ---- step 1c: emitter depth stamp (optional, default off) -----------
      // Stamp depth for the dense core of opt-in emitters BEFORE the transparent
      // passes, so transparent surfaces behind the core are depth-rejected (no
      // wash-out) while surfaces in front still attenuate it. Emitters expose a
      // depth-only stamp material via material.userData.occlusionDepthMaterial;
      // emissive objects without one are drawn as a no-op (write nothing) so they
      // don't double their additive contribution.
      if (this.emitterDepthStamp) {
        const restore: { obj: Renderable; mat: Material | Material[] }[] = [];
        let anyStamp = false;
        for (const r of emissiveList) {
          const stamp = this.getEmitterStamp(r);
          restore.push({ obj: r, mat: r.material });
          if (stamp) {
            r.material = stamp;
            anyStamp = true;
          } else {
            r.material = NOOP_MATERIAL;
          }
        }
        if (anyStamp) {
          renderer.setRenderTarget(buffer);
          timer?.begin('emitterStamp');
          renderer.render(scene, camera);
          timer?.end();
        }
        for (const s of restore) s.obj.material = s.mat;
      }

      camera.layers.mask = prevCameraMask;
      this.setVisible(emissiveList, false);
    }

    // ---- steps 2-5: transparent OIT layers --------------------------------
    // Skipped entirely when no renderable is currently routed through OIT (every
    // transparent object fully opaque this frame), avoiding empty target clears,
    // empty scene renders and the fullscreen tail composite.
    if (hasOit) {
      // Restore the hidden OIT objects and hide the plain-opaque ones: from here
      // only OIT renderables should draw into the auxiliary targets.
      this.setVisible(hiddenOit, true);
      this.setVisible(opaqueList, false);

      // Every OIT sub-pass is order-independent: min-depth (MinEquation), the
      // weighted tail (additive) and the depth-peeled front layer (a single layer
      // per pixel) all produce the same result regardless of draw order. Disable
      // object sorting so the renderer skips both the back-to-front sort and the
      // per-object screen-space depth computation during scene traversal. The
      // opaque pass above keeps sorting (front-to-back early-z still helps).
      renderer.sortObjects = false;

      // ---- step 2: min-depth pre-pass -------------------------------------
      // Only needed for the exact front-layer partition; skipped when the front
      // peel is disabled (every fragment resolves through the WBOIT tail and
      // oitMinDepthTexture is never sampled).
      if (!this.skipFront) {
        this.applyPassSwap(oitList, 'depthMin');
        renderer.setRenderTarget(this.minDepthTarget);
        renderer.setClearColor(WHITE, 1); // 1.0 == far
        renderer.clear(true, false, false);
        timer?.begin('minDepth');
        renderer.render(scene, camera);
        timer?.end();
      }

      // ---- step 3: weighted-blended OIT tail ------------------------------
      // Single additive (ONE, ONE) pass into one RGBA16F target: accum.rgb = sum of
      // colour * b and accum.a = sum of b, where b = -ln(1 - alpha). The composite
      // recovers both the average colour and the coverage from this buffer, so no
      // separate reveal pass is needed.
      timer?.begin('tail');
      this.applyPassSwap(oitList, 'accum');
      renderer.setRenderTarget(this.accumTarget);
      renderer.setClearColor(BLACK, 0);
      renderer.clear(true, false, false);
      renderer.render(scene, camera);
      timer?.end();

      // ---- step 4: composite tail onto main -------------------------------
      this.compositeMaterial.uniforms.accumTexture.value =
        this.accumTarget.texture;
      timer?.begin('composite');
      this.fullscreenRenderer.renderMaterial(
        renderer,
        buffer,
        this.compositeMaterial,
      );
      timer?.end();

      // ---- step 5: exact front layer --------------------------------------
      // Skipped in WBOIT-only debug mode (the tail already includes every fragment).
      if (!this.skipFront) {
        this.applyPassSwap(oitList, 'front');
        renderer.setRenderTarget(buffer);
        timer?.begin('front');
        renderer.render(scene, camera);
        timer?.end();
      }

      // ---- step 5b: occlusion depth stamp (optional, default off) ---------
      // Stamp depth where a transparent surface's own alpha clears
      // occlusionDepthThreshold. Transparent surfaces write no depth in the passes
      // above, so without this annotation labels are never occluded by them. Runs
      // after the front/composite passes so the depth-peel partitioning is
      // undisturbed, writing into the shared buffer depth the AnnotationsPass reads.
      if (this.occlusionDepthStamp) {
        this.applyPassSwap(oitList, 'occlusion');
        renderer.setRenderTarget(buffer);
        timer?.begin('occlusion');
        renderer.render(scene, camera);
        timer?.end();
      }

      // Restore OIT materials and re-show the plain-opaque renderables.
      this.restoreMaterials(oitList);
      this.setVisible(opaqueList, true);
    }

    // Object sorting was disabled for the order-independent OIT sub-passes; restore
    // it so the overlay pass below (and the next frame) sorts normally.
    renderer.sortObjects = prevSortObjects;

    // ---- step 6: always-on-top overlay ------------------------------------
    // Drawn last, after the transparent layers, so it appears on top of everything
    // (e.g. the camera-target marker). Rendered with the objects' own materials and
    // blend; depth testing is left to the materials (the default marker disables it).
    if (hasOverlay) {
      this.setVisible(overlayList, true);
      camera.layers.disableAll();
      camera.layers.enable(LAYERS.OVERLAY);
      renderer.setRenderTarget(buffer);
      timer?.begin('overlay');
      renderer.render(scene, camera);
      timer?.end();
      camera.layers.mask = prevCameraMask;
    }

    // ---- restore -----------------------------------------------------------
    // Re-show the emissive/overlay objects (hidden during the passes above) for the
    // next frame and any other consumers traversing the scene.
    this.setVisible(emissiveList, true);
    this.setVisible(overlayList, true);

    camera.layers.mask = prevCameraMask;
    scene.background = prevBackground;
    renderer.setClearColor(prevClearColor, prevClearAlpha);
    this.restoreForcedOpaque();

    // ---- debug: render-target thumbnails ----------------------------------
    if (this.debugTargets) {
      this.renderDebugTargets(renderer, buffer);
    }
  }

  /**
   * Draw small thumbnails of the auxiliary render targets along the bottom-left of
   * the output buffer (min-depth, accumulation). Uses the buffer's viewport
   * to scope each draw; GPU-only.
   */
  private renderDebugTargets(
    renderer: WebGLRenderer,
    buffer: WebGLRenderTarget,
  ) {
    if (!this.debugMaterial) {
      this.debugMaterial = new RawShaderMaterial({
        vertexShader: copyVertexShader,
        fragmentShader: debugFragmentShader,
        uniforms: {
          source: new Uniform<Texture | null>(null),
          mode: new Uniform(0),
        },
        depthTest: false,
        depthWrite: false,
        blending: NoBlending,
      });
    }
    const mat = this.debugMaterial;

    // mode: 0 = rgb, 1 = red as grayscale, 2 = normalized depth (near = bright).
    const items: { texture: Texture; mode: number }[] = [
      { texture: this.minDepthTarget.texture, mode: 2 },
      { texture: this.accumTarget.texture, mode: 0 },
    ];

    const pad = Math.round(this.height * 0.015);
    const th = Math.round(this.height * 0.2);
    const tw = Math.round(th * (this.width / this.height));

    // Scope each draw to a sub-rect via the buffer's viewport, then restore it.
    const prevViewport = buffer.viewport.clone();
    let x = pad;
    for (const item of items) {
      mat.uniforms.source.value = item.texture;
      mat.uniforms.mode.value = item.mode;
      buffer.viewport.set(x, pad, tw, th);
      this.fullscreenRenderer.renderMaterial(renderer, buffer, mat);
      x += tw + pad;
    }
    buffer.viewport.copy(prevViewport);
    // Re-apply the full viewport for any subsequent passes.
    renderer.setRenderTarget(buffer);
  }
}
