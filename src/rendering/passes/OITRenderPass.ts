import {
  AddEquation,
  Camera,
  Color,
  CustomBlending,
  DepthTexture,
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
import { FxaaResolver } from '../fxaa-resolver';
import { GpuTimer } from '../gpu-timer';
import { isOitCapable, OitCapableMaterial, OitPass } from '../oit-material';
import { Pass } from '../Pass';
import { getRenderingState } from '../rendering-state';
import copyFragmentShader from '../shaders/copy-frag.glsl';
import copyVertexShader from '../shaders/copy-vert.glsl';
import compositeFragmentShader from '../shaders/oit-composite-frag.glsl';
import debugFragmentShader from '../shaders/oit-debug-frag.glsl';
import { SMAAQuality, SmaaResolver } from '../smaa-resolver';
import { TaaResolver } from '../taa-resolver';
import { TemporalResolver } from '../temporal-resolver';

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
 * Resource/accumulation counters for leak monitoring. Unlike {@link OITRenderPassStats}
 * (per-frame object classification, which naturally varies with the camera), these
 * track internal structures and global GPU resources that should stay *bounded* over
 * time. Watch them while toggling the pipeline on/off (which recreates the passes): a
 * steady climb indicates passes or GPU resources are not being disposed.
 */
export type OITRenderPassResources = {
  /**
   * Active OIT pipeline registrations on this canvas (the ref-counted
   * {@link RenderingState} `_oitCount`). Should read 1 while a single OIT pipeline is
   * mounted; a value that climbs each time the pipeline is recreated means a pass was
   * acquired but never released in {@link OITRenderPass.dispose} (a real leak).
   */
  oitPipelines: number;
  /**
   * Total classification entries created since this pass instance was constructed
   * (monotonic). Resets only when the pass itself is recreated, so it grows quickly
   * during warm-up and should then plateau.
   */
  entriesTotal: number;
  /**
   * Classification entries created this frame (cache misses). ~0 in steady state; a
   * persistently non-zero value means object material identities churn every frame,
   * which also churns the cached per-pass OIT variants.
   */
  entriesThisFrame: number;
  /** GPU textures currently tracked by the renderer (global; watch for unbounded growth). */
  textures: number;
  /** GPU geometries currently tracked by the renderer (global). */
  geometries: number;
  /** Compiled shader programs currently held by the renderer (global). `-1` if unavailable. */
  programs: number;
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
 * Built-in anti-aliasing mode for {@link OITRenderPass.antialias}. See that field for
 * the per-mode description. Exported as the single source of truth so consumers
 * (and Storybook arg types) can reference it instead of re-declaring the union.
 *
 * @group Rendering
 */
export type OITAntialiasMode =
  | 'none'
  | 'temporal'
  | 'smaa'
  | 'temporal-smaa'
  | 'taa'
  | 'fxaa';

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
   * Number of MSAA samples (0 = off) for the hybrid multisample path. When > 0 the
   * opaque geometry (including fully-opaque OIT occluders such as casings/completion
   * tools), the emissive layer, the weighted-blended (WBOIT) tail composite, the exact
   * front layer and the overlay are all rendered into ONE dedicated multisample target
   * sharing the pipeline depth. The single-sample min-depth/accum aux targets read the
   * opaque depth resolved on the first switch away from the multisample target; the
   * final colour is resolved ONCE more and blitted into the single-sample pipeline
   * buffer (~2 resolves total). This costs more than multisampling the opaque pass
   * alone but far less than multisampling the whole half-float pipeline buffer
   * (~4 resolves). Clamped to `renderer.capabilities.maxSamples`.
   *
   * **MSAA is not recommended with OIT.** The min-depth/accum aux buffers must be
   * single-sample (WebGL2 cannot sample a multisample texture), so the transparent
   * tail is composited single-sample over the multisample opaque edges. Opaque edges
   * are matted against the cleared background before the transparent surfaces exist,
   * and the single-sample composite cannot reconstruct per-sample coverage — so a
   * background-coloured fringe survives along opaque and thin-line edges *over
   * transparent surfaces*. This is structural and cannot be made clean here; only
   * supersampling the whole composite (an {@link antialias} temporal mode, or the
   * {@link RenderingPipeline} `supersample` prop) removes it.
   *
   * `opaqueSamples` is therefore intended only for the narrow **opaque-only** close-up
   * (no transparent surfaces composited in front — e.g. a casing detail view), where
   * the fringe cannot occur. For anything with transparent surfaces leave this at `0`
   * and use {@link antialias} (temporal / SMAA / TAA / FXAA) or the
   * {@link RenderingPipeline} `supersample` prop instead. (Pipeline-level `samples`
   * does not anti-alias the OIT result either, and is only for a plain opaque
   * `RenderPass` pipeline with no OIT.)
   *
   * Do not combine `opaqueSamples > 0` with an {@link antialias} temporal mode
   * (`'temporal'`/`'temporal-smaa'`/`'taa'`): it is wasteful — the multisample colour
   * is resolved first and the temporal resolver then runs on the already-resolved
   * buffer, so you pay for MSAA rasterisation on top of temporal supersampling that
   * already anti-aliases the same edges.
   */
  opaqueSamples: number = 0;

  /**
   * Built-in anti-aliasing mode for the composited result.
   *
   * - `'none'`: no built-in AA. Pair with {@link opaqueSamples} (MSAA) for
   *   opaque-edge AA in an opaque-only close-up; transparent/additive edges stay
   *   un-anti-aliased, and MSAA leaves a background-coloured fringe over transparent
   *   surfaces (see {@link opaqueSamples}).
   * - `'temporal'`: temporal supersampling (see {@link TemporalResolver}). The camera
   *   is sub-pixel jittered each frame and the composited frame is accumulated into a
   *   running average **while the camera is still**, converging to a genuinely
   *   supersampled image (thin trajectory lines, transparent-surface edges, contour
   *   lines and the additive highlight all anti-alias). There is no reprojection, so
   *   nothing ghosts; while the camera moves the current frame is shown un-jittered
   *   (the moving frame is not anti-aliased unless combined with SMAA or MSAA).
   * - `'smaa'`: subpixel morphological AA (see {@link smaaQuality}) applied as a
   *   spatial post pass every frame. Anti-aliases moving frames too, but (like all
   *   morphological techniques) cannot recover sub-pixel features such as 1px lines
   *   that fall between samples.
   * - `'temporal-smaa'`: both, mutually exclusive per frame — temporal accumulation
   *   while the camera is still (crisp, recovers sub-pixel detail) and SMAA while it
   *   moves. SMAA never softens the converged still image and only costs GPU time
   *   during motion.
   * - `'taa'` (default): reprojected temporal anti-aliasing (see {@link TaaResolver}).
   *   Like `'temporal'` the camera is sub-pixel jittered, but the history is
   *   reprojected every frame using the nearest visible surface's depth (opaque
   *   hardware depth refined by the OIT front-layer depth), so anti-aliasing is
   *   retained *during* camera motion. Ghosting from additive/animated/disoccluded
   *   content is bounded by neighbourhood colour clamping. This is the recommended
   *   default for the OIT pipeline — it anti-aliases both still and moving frames.
   *   Use `'temporal'` instead if you need guaranteed ghost-free stills and don't
   *   mind losing motion AA.
   * - `'fxaa'`: fast approximate AA (see {@link FxaaResolver}) applied as a single
   *   cheap spatial post pass every frame. Cheaper and softer than `'smaa'`, with no
   *   OIT or temporal coupling. Like all spatial techniques it cannot recover
   *   sub-pixel features. Also available as the standalone {@link FXAAPass} for
   *   non-OIT (plain `RenderPass`) setups.
   *
   * The jitter is applied to the shared camera only between this pass's own scene
   * render and resolve, so it never leaks to later passes (annotations, picking).
   * This is the OIT pipeline's high-quality AA. Non-OIT setups (plain `RenderPass`)
   * should use MSAA instead.
   */
  antialias: OITAntialiasMode = 'taa';

  /**
   * SMAA quality preset used by the `'smaa'` and `'temporal-smaa'` {@link antialias}
   * modes (default `'high'`). Ignored by the other modes.
   */
  smaaQuality: SMAAQuality = 'high';

  /**
   * The temporal-supersampling resolver, exposed for debug/tuning (e.g. its
   * `clampStrength` anti-ghost knob). Non-null only while {@link antialias} is
   * `'temporal'` / `'temporal-smaa'` and after at least one frame has rendered (it is
   * created lazily and recreated on a mode switch, resetting to defaults).
   */
  get temporalResolver(): TemporalResolver | null {
    return this.temporal;
  }

  /**
   * The reprojected-TAA resolver, exposed for debug/tuning (e.g. its
   * `restClampStrength` / `restBoxGamma` / `restNeighbourhoodRadius` anti-ghost knobs).
   * Non-null only while {@link antialias} is `'taa'` and after at least one frame has
   * rendered (it is created lazily and recreated on a mode switch, resetting to
   * defaults).
   */
  get taaResolver(): TaaResolver | null {
    return this.taa;
  }

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

  /**
   * Resource/accumulation counters for leak monitoring, updated every {@link render}.
   * See {@link OITRenderPassResources}.
   */
  readonly resources: OITRenderPassResources = {
    oitPipelines: -1,
    entriesTotal: 0,
    entriesThisFrame: 0,
    textures: -1,
    geometries: -1,
    programs: -1,
  };

  private fullscreenRenderer = new FullscreenRenderer();

  /** Lazily-created temporal-supersampling resolver, used when {@link antialias} is `'temporal'`. */
  private temporal: TemporalResolver | null = null;

  /**
   * Lazily-created reprojected-TAA resolver, used when {@link antialias} is `'taa'`.
   */
  private taa: TaaResolver | null = null;

  /**
   * Lazily-created SMAA spatial resolver, used when {@link antialias} is `'smaa'` or
   * `'temporal-smaa'`.
   */
  private smaa: SmaaResolver | null = null;

  /** Lazily-created FXAA spatial resolver, used when {@link antialias} is `'fxaa'`. */
  private fxaa: FxaaResolver | null = null;

  private minDepthTarget: WebGLRenderTarget;
  private accumTarget: WebGLRenderTarget;
  private compositeMaterial: RawShaderMaterial;
  /** Shared multisample target for the hybrid MSAA path (see {@link opaqueSamples}). */
  private opaqueTarget: WebGLRenderTarget | null = null;
  /** Sample count the current opaqueTarget was built with (-1 = none yet). */
  private opaqueTargetSamples = -1;
  /** Blit material: copy the resolved multisample colour into the buffer (no blending). */
  private opaqueBlitMaterial: RawShaderMaterial;

  /** Lazily-created material for the debug-target thumbnails. */
  private debugMaterial: RawShaderMaterial | null = null;

  /** Lazily-created GPU timer, only when {@link profile} is first enabled. */
  private gpuTimer: GpuTimer | null = null;

  /**
   * OIT pipeline registration release handle. Acquired lazily on the first
   * {@link render} rather than in the constructor: the host (e.g. a `useMemo`) may
   * construct passes that React then discards without ever committing/rendering them,
   * and a constructor-time acquire on such an orphan would never be released. Only
   * committed passes are rendered, so acquiring here keeps the registration count
   * symmetric with {@link dispose}.
   */
  private releaseOit?: () => void;
  private entryCache = new WeakMap<Renderable, RenderableEntry>();

  /** Monotonic count of classification entries created (cache misses). */
  private entriesCreated = 0;

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

    // MSAA resolve blit: overwrite the buffer colour with the resolved multisample
    // colour (depth is shared and already resolved), no blending.
    this.opaqueBlitMaterial = new RawShaderMaterial({
      vertexShader: copyVertexShader,
      fragmentShader: copyFragmentShader,
      uniforms: {
        opacity: new Uniform(1),
        source: new Uniform<Texture | null>(null),
      },
      depthTest: false,
      depthWrite: false,
      blending: NoBlending,
    });
  }

  /**
   * Create or resize the shared multisample target, sharing the pipeline's depth
   * texture so resolving writes the AA colour AND the resolved opaque depth the
   * auxiliary OIT passes read. Recreated when sample count, size or shared depth
   * texture changes.
   */
  private ensureOpaqueTarget(renderer: WebGLRenderer, depth: DepthTexture) {
    const samples = Math.min(
      this.opaqueSamples,
      renderer.capabilities.maxSamples,
    );
    const t = this.opaqueTarget;
    if (
      t &&
      this.opaqueTargetSamples === samples &&
      t.width === this.width &&
      t.height === this.height &&
      t.depthTexture === depth
    ) {
      return t;
    }
    this.disposeOpaqueTarget();
    const target = new WebGLRenderTarget(this.width, this.height, {
      format: RGBAFormat,
      type: HalfFloatType,
      depthBuffer: true,
      generateMipmaps: false,
    });
    target.samples = samples;
    target.depthTexture = depth;
    this.opaqueTarget = target;
    this.opaqueTargetSamples = samples;
    return target;
  }

  private disposeOpaqueTarget() {
    if (!this.opaqueTarget) return;
    // Detach the shared depth texture before dispose so three doesn't free the
    // pipeline buffer's live depth texture.
    this.opaqueTarget.depthTexture = null as unknown as DepthTexture;
    this.opaqueTarget.dispose();
    this.opaqueTarget = null;
    this.opaqueTargetSamples = -1;
  }

  setSize(width: number, height: number) {
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    // The aux targets borrow the pipeline's shared depth texture every frame in
    // render(). Release that borrowed reference before resizing so setSize does
    // not mutate the dimensions of a texture this pass does not own.
    this.minDepthTarget.depthTexture = null;
    this.accumTarget.depthTexture = null;
    this.minDepthTarget.setSize(this.width, this.height);
    this.accumTarget.setSize(this.width, this.height);
    this.temporal?.setSize(this.width, this.height);
    this.taa?.setSize(this.width, this.height);
    this.smaa?.setSize(this.width, this.height);
    this.fxaa?.setSize(this.width, this.height);
  }

  dispose() {
    // Release the borrowed shared depth texture first. Three's
    // deallocateRenderTarget disposes a target's depthTexture, so disposing the
    // aux targets while they still reference the pipeline's depth texture would
    // delete the live, still-in-use depth buffer (and dispose it twice).
    this.minDepthTarget.depthTexture = null;
    this.accumTarget.depthTexture = null;
    this.minDepthTarget.dispose();
    this.accumTarget.dispose();
    this.disposeOpaqueTarget();
    this.compositeMaterial.dispose();
    this.opaqueBlitMaterial.dispose();
    this.debugMaterial?.dispose();
    this.fullscreenRenderer.dispose();
    this.temporal?.dispose();
    this.temporal = null;
    this.taa?.dispose();
    this.taa = null;
    this.smaa?.dispose();
    this.smaa = null;
    this.fxaa?.dispose();
    this.fxaa = null;
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
    this.entriesCreated++;
    return entry;
  }

  /**
   * Whether an OIT entry is currently fully invisible (every OIT-capable material
   * has opacity ≤ 0). Such objects are hidden from all passes — they contribute
   * nothing to any render target, so rasterising them (even through the cheap aux
   * passes) is pure waste.
   */
  private isEntryInvisible(entry: RenderableEntry): boolean {
    const mats = Array.isArray(entry.original)
      ? entry.original
      : [entry.original];
    for (const m of mats) {
      if (isOitCapable(m) && !OITRenderPass.isMaterialInvisible(m))
        return false;
    }
    return true;
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
    invisibleOitList: Renderable[],
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
      } else if (this.isEntryInvisible(entry)) {
        // Fully invisible (opacity ≤ 0): skip all passes — the object writes nothing
        // to any target. Hidden from the opaque pass and excluded from OIT passes.
        invisibleOitList.push(r);
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

  /** Whether a material currently renders as fully invisible (opacity ≤ 0). */
  private static isMaterialInvisible(material: Material): boolean {
    if (!material.transparent) return false;
    return OITRenderPass.effectiveOpacity(material) <= 0;
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

    // Register as an active OIT pipeline on first render (see releaseOit). Doing this
    // here rather than in the constructor avoids leaking a registration for passes
    // that were constructed but discarded by React before ever being rendered.
    if (!this.releaseOit) {
      this.releaseOit = getRenderingState(scene).getState().acquireOit();
    }

    const oitList: RenderableEntry[] = [];
    const opaqueList: Renderable[] = [];
    const emissiveList: Renderable[] = [];
    const overlayList: Renderable[] = [];
    const oitOpaqueList: RenderableEntry[] = [];
    const invisibleOitList: Renderable[] = [];
    const entriesBefore = this.entriesCreated;
    this.collect(
      oitList,
      opaqueList,
      emissiveList,
      overlayList,
      oitOpaqueList,
      invisibleOitList,
    );

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

    // Resource/leak telemetry: internal entry-cache churn plus the renderer's global
    // GPU resource counts and the canvas OIT registration count. These should stay
    // bounded over time; a steady climb (e.g. while toggling the pipeline on/off)
    // points at undisposed passes or resources rather than per-frame variation.
    const info = renderer.info;
    this.resources.entriesThisFrame = this.entriesCreated - entriesBefore;
    this.resources.entriesTotal = this.entriesCreated;
    this.resources.oitPipelines = getRenderingState(scene).getState()._oitCount;
    this.resources.textures = info.memory.textures;
    this.resources.geometries = info.memory.geometries;
    this.resources.programs = info.programs?.length ?? -1;

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

    // Temporal supersampling: jitter the camera projection before the scene render
    // (every sub-pass below uses the same jittered camera, so the frame is
    // internally consistent). It is restored before the resolve at the end of this
    // method, so the jitter never escapes to later passes (annotations, picking).
    const wantTemporal =
      this.antialias === 'temporal' || this.antialias === 'temporal-smaa';
    const wantSmaa =
      this.antialias === 'smaa' || this.antialias === 'temporal-smaa';
    const wantTaa = this.antialias === 'taa';
    const wantFxaa = this.antialias === 'fxaa';

    if (wantTemporal) {
      if (!this.temporal) {
        this.temporal = new TemporalResolver();
        this.temporal.setSize(this.width, this.height);
      }
      this.temporal.applyJitter(camera);
    } else if (this.temporal) {
      // Mode switched off: drop the accumulation so it restarts cleanly if re-enabled.
      this.temporal.restoreJitter();
      this.temporal.dispose();
      this.temporal = null;
    }

    if (wantTaa) {
      if (!this.taa) {
        this.taa = new TaaResolver();
        this.taa.setSize(this.width, this.height);
      }
      this.taa.applyJitter(camera);
    } else if (this.taa) {
      this.taa.restoreJitter();
      this.taa.dispose();
      this.taa = null;
    }

    if (wantSmaa) {
      if (!this.smaa) {
        this.smaa = new SmaaResolver(this.smaaQuality);
        this.smaa.setSize(this.width, this.height);
      }
      // Cheap when unchanged (the setter recompiles only on an actual change).
      this.smaa.quality = this.smaaQuality;
    } else if (this.smaa) {
      this.smaa.dispose();
      this.smaa = null;
    }

    if (wantFxaa) {
      if (!this.fxaa) {
        this.fxaa = new FxaaResolver();
        this.fxaa.setSize(this.width, this.height);
      }
    } else if (this.fxaa) {
      this.fxaa.dispose();
      this.fxaa = null;
    }

    // ---- step 1: opaque ----------------------------------------------------
    // Exclude emissive and overlay objects; pure-OIT objects are hidden, mixed
    // meshes render their opaque groups (OIT groups as no-op). Fully-opaque OIT
    // objects are forced to write depth so they occlude transparent geometry behind
    // them.
    this.setVisible(emissiveList, false);
    this.setVisible(overlayList, false);
    this.setVisible(invisibleOitList, false);
    this.applyForcedOpaque(oitOpaqueList);
    const hiddenOit: Renderable[] = [];
    this.applyOpaqueSwap(oitList, hiddenOit);
    // Hybrid MSAA: opaque, emissive, tail composite, front and overlay all draw into
    // one multisample target (sharing the pipeline depth) and resolve once at the end.
    // The min-depth/accum aux targets stay single-sample (they're sampled in shaders;
    // WebGL2 can't sample MS textures) and read the opaque depth resolved on the first
    // switch to an aux target. Drawing front into the SAME target as opaque anti-aliases
    // the surviving front-layer edges against the geometry behind them; the tail
    // composite is still single-sample, so opaque edges seen THROUGH transparent
    // surfaces keep a background-coloured fringe (MSAA is only clean for opaque-only
    // close-ups — see opaqueSamples). dst is the single-sample buffer when MSAA is off.
    const msaaOpaque = this.opaqueSamples > 0 && sharedDepth != null;
    const dst = msaaOpaque
      ? this.ensureOpaqueTarget(renderer, sharedDepth!)
      : buffer;
    renderer.setRenderTarget(dst);
    // Explicit background when set (single source of truth shared with RenderPass),
    // otherwise the renderer's current clear state. Restored at the end of this pass.
    renderer.setClearColor(
      this.clearColor ?? prevClearColor,
      this.clearColor ? this.clearAlpha : prevClearAlpha,
    );
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
      renderer.setRenderTarget(dst);
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
          renderer.setRenderTarget(dst);
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
        dst,
        this.compositeMaterial,
      );
      timer?.end();

      // ---- step 5: exact front layer --------------------------------------
      // Skipped in WBOIT-only debug mode (the tail already includes every fragment).
      // Drawn back into the shared (MSAA) target so the surviving front fragments are
      // anti-aliased against the opaque geometry already there.
      if (!this.skipFront) {
        this.applyPassSwap(oitList, 'front');
        renderer.setRenderTarget(dst);
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
        renderer.setRenderTarget(dst);
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
      renderer.setRenderTarget(dst);
      timer?.begin('overlay');
      renderer.render(scene, camera);
      timer?.end();
      camera.layers.mask = prevCameraMask;
    }

    // ---- resolve: MSAA target -> single-sample buffer ----------------------
    // One overwrite blit copies the resolved (anti-aliased) colour into the buffer.
    // The opaque depth was already resolved into the shared depth texture on the
    // first switch to an auxiliary target, so downstream passes see correct depth.
    if (msaaOpaque) {
      this.opaqueBlitMaterial.uniforms.source.value = dst.texture;
      this.fullscreenRenderer.renderMaterial(
        renderer,
        buffer,
        this.opaqueBlitMaterial,
      );
    }

    // ---- temporal supersampling resolve ------------------------------------
    // Restore the un-jittered camera first (so motion detection reads the clean
    // transform and later passes are not offset), then blend the freshly composited
    // frame now in `buffer` into the running history average, writing the result
    // back into `buffer`.
    if (wantTemporal && this.temporal) {
      this.temporal.restoreJitter();
      this.temporal.resolve(renderer, buffer, camera);
    }

    // ---- reprojected TAA resolve -------------------------------------------
    // Restore the un-jittered camera, then reproject the history to the current view
    // and blend it into `buffer`. The OIT front-layer depth (min-depth pre-pass) is
    // passed in so transparent front surfaces reproject at their true depth; it is
    // only valid when the front peel actually ran this frame.
    if (wantTaa && this.taa) {
      this.taa.restoreJitter();
      const frontDepth =
        hasOit && !this.skipFront ? this.minDepthTarget.texture : null;
      this.taa.resolve(renderer, buffer, camera, frontDepth);
    }

    // ---- spatial SMAA resolve ----------------------------------------------
    // In `'smaa'` mode SMAA runs every frame. In the combined `'temporal-smaa'`
    // mode it runs only while the camera is moving: temporal accumulation already
    // anti-aliases (and recovers sub-pixel detail on) the still frames, and running
    // SMAA on top would only soften the converged image. The two are therefore
    // mutually exclusive per frame.
    if (wantSmaa && this.smaa) {
      const runSmaa =
        this.antialias === 'smaa' || (this.temporal?.isMoving ?? true);
      if (runSmaa) {
        this.smaa.render(renderer, buffer);
      }
    }

    // ---- spatial FXAA resolve ----------------------------------------------
    // Purely spatial, runs every frame. Cheaper and softer than SMAA, with no OIT
    // or temporal coupling (also exposed as the standalone FXAAPass for non-OIT
    // setups). Composites in place into the shared buffer.
    if (wantFxaa && this.fxaa) {
      this.fxaa.render(renderer, buffer);
    }

    // ---- restore -----------------------------------------------------------
    // Re-show the emissive/overlay/invisible objects (hidden during the passes above)
    // for the next frame and any other consumers traversing the scene.
    this.setVisible(emissiveList, true);
    this.setVisible(overlayList, true);
    this.setVisible(invisibleOitList, true);

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
