import {
  Camera,
  ClampToEdgeWrapping,
  HalfFloatType,
  LinearFilter,
  Matrix4,
  NoBlending,
  PerspectiveCamera,
  RawShaderMaterial,
  RGBAFormat,
  Texture,
  Uniform,
  Vector2,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import { FullscreenRenderer } from './fullscreen-renderer';
import copyFrag from './shaders/copy-frag.glsl';
import copyVert from './shaders/copy-vert.glsl';
import taaResolveFrag from './shaders/taa-resolve-frag.glsl';

/**
 * Low-discrepancy Halton sample (base `b`, index `i`, 1-based) in `[0, 1)`.
 */
function halton(i: number, b: number): number {
  let f = 1;
  let r = 0;
  let index = i;
  while (index > 0) {
    f /= b;
    r += f * (index % b);
    index = Math.floor(index / b);
  }
  return r;
}

/**
 * The 8 corners of the NDC cube ([-1, 1]^3). Reprojecting these through
 * `current * inverse(previous)` recovers the per-frame screen-space motion of the
 * previous frustum independent of world scale or zoom level, used to gate the
 * neighbourhood clip strength (relaxed when still, full during motion).
 */
const NDC_MOTION_CORNERS: ReadonlyArray<readonly [number, number, number]> = [
  [-1, -1, -1],
  [1, -1, -1],
  [-1, 1, -1],
  [1, 1, -1],
  [-1, -1, 1],
  [1, -1, 1],
  [-1, 1, 1],
  [1, 1, 1],
];

/**
 * Reprojected temporal anti-aliasing (TAA) resolver for the {@link OITRenderPass}.
 *
 * Unlike {@link TemporalResolver} (which only accumulates while the camera is
 * still), this reprojects the history every frame using the depth of the nearest
 * visible surface, so anti-aliasing is retained *during* camera motion. The app's
 * world is effectively static — only the camera moves — so no per-object velocity
 * buffer is required; a depth-only camera reprojection recovers the motion.
 *
 * The reprojection depth is the nearer of the opaque hardware depth and the OIT
 * front-layer's view-space linear depth (passed in from the pass). Transparent
 * surfaces write no hardware depth, so reprojecting them by the opaque depth behind
 * them is precisely what makes a naive TAA ghost transparent content; using the OIT
 * front depth reprojects the visible transparent surface at its true position.
 *
 * Ghosting from content the reprojection cannot follow (additive highlights,
 * animated objects, disocclusions) is bounded in the shader by clamping the
 * reprojected history into the current frame's local 3x3 colour range and by
 * falling back to the current frame where the reprojection lands off-screen. It is
 * offered as an *optional* AA mode alongside `temporal`/`smaa`, not a replacement.
 *
 * Like {@link TemporalResolver}, the owning pass drives it: {@link applyJitter}
 * before the scene render, {@link restoreJitter} + {@link resolve} after. The jitter
 * is applied to the shared camera only between those calls, so it never leaks to
 * later passes.
 *
 * @group Rendering
 * @see {@link OITRenderPass}
 */
export class TaaResolver {
  /**
   * Number of unique sub-pixel jitter samples to cycle through (the length of the
   * Halton sequence used).
   */
  sampleCount: number;

  /**
   * History weight when the reprojection is valid (the current frame contributes
   * `1 - feedback`). Higher = smoother/more stable but slower to react and more
   * prone to ghosting; lower = crisper but noisier. Typical range 0.85–0.95.
   */
  feedback: number;

  /**
   * Per-frame camera motion, in screen pixels (largest reprojected frustum-corner
   * displacement), at/below which the neighbourhood clip is fully relaxed. Below this
   * the camera is treated as still and the reprojected history is trusted verbatim
   * (pure exponential average), so heavily aliased static geometry converges instead
   * of wobbling against a single jittered frame's colour box.
   */
  stillPixelThreshold = 0.1;

  /**
   * Camera motion, in screen pixels, at/above which the neighbourhood clip is fully
   * applied (history clipped into the current frame's local colour range, bounding
   * ghosting from disocclusions and untrackable content). Between this and
   * {@link stillPixelThreshold} the clip strength ramps smoothly, so there is no pop
   * as the camera starts or stops moving.
   */
  motionPixelThreshold = 2.0;

  /**
   * Neighbourhood-clip strength retained while the camera is *still* (the floor the
   * motion ramp starts from). **Default 0.2** — a low floor that stays firmly on the
   * static-favoured side of the scale: heavily aliased near-Nyquist detail still
   * converges to a near-supersampled result, while a touch of clip already bounds the
   * worst ghost trails. Raise it (typically 0.6-0.9) to more aggressively suppress the
   * trail an object animating under a still camera leaves — its history lands far
   * outside the current frame's local colour box and is pulled in, while correctly
   * converged static geometry (whose history sits *inside* the box, widened by
   * {@link restBoxGamma}/{@link restNeighbourhoodRadius} for exactly this reason) is
   * left untouched. 0 trusts history verbatim at rest; 1 clips fully even when still.
   * Camera-motion protection is unaffected by this floor — the clip still ramps up on
   * motion regardless.
   */
  restClampStrength = 0.2;

  /**
   * Neighbourhood colour-box half-width (in sigmas) used while the camera is still.
   * Wider than {@link motionBoxGamma} so a converged near-Nyquist feature stays inside
   * the box (the rest clip is then a no-op on it) while a moving object's history is
   * still caught.
   */
  restBoxGamma = 1.6;

  /** Neighbourhood colour-box half-width (in sigmas) used while the camera moves. */
  motionBoxGamma = 1.25;

  /**
   * Neighbourhood sampling stride (in texels) used while the camera is still. Wider
   * than {@link motionNeighbourhoodRadius} so a field of thin bars is always
   * represented in the box and its converged value is not falsely rejected.
   */
  restNeighbourhoodRadius = 1.5;

  /** Neighbourhood sampling stride (in texels) used while the camera moves. */
  motionNeighbourhoodRadius = 1.0;

  private historyRead: WebGLRenderTarget;
  private historyWrite: WebGLRenderTarget;
  private resolveMaterial: RawShaderMaterial;
  private blitMaterial: RawShaderMaterial;
  private fullscreenRenderer = new FullscreenRenderer();

  private width = 1;
  private height = 1;

  /** Index into the jitter sequence for the current frame. */
  private sampleIndex = 0;
  /** False until the first frame has been accumulated (and after a resize). */
  private hasHistory = false;

  /** True while a sub-pixel jitter is applied to the shared camera projection. */
  private jittered = false;
  /** The camera the jitter was applied to (restored in {@link restoreJitter}). */
  private camera: Camera | null = null;
  /** Snapshot of the clean projection matrix, restored exactly after the render. */
  private savedProjection = new Matrix4();
  /** Snapshot of the clean projection inverse, restored alongside the projection. */
  private savedProjectionInverse = new Matrix4();

  /** Scratch: current (un-jittered) world-space view-projection. */
  private curViewProj = new Matrix4();
  /** Previous frame's (un-jittered) world-space view-projection (world -> clip). */
  private prevViewProj = new Matrix4();
  /** Inverse of the previous frame's view-projection (clip -> world), for motion. */
  private prevViewProjInverse = new Matrix4();
  /** Scratch: `curViewProj * prevViewProjInverse` (prev NDC -> cur NDC). */
  private motionMatrix = new Matrix4();
  /** Scratch vector reused while reprojecting the frustum corners. */
  private motionScratch = new Vector3();

  constructor(sampleCount = 8, feedback = 0.9) {
    this.sampleCount = Math.max(1, sampleCount);
    this.feedback = feedback;

    const targetOptions = {
      format: RGBAFormat,
      type: HalfFloatType,
      depthBuffer: false,
      generateMipmaps: false,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      wrapS: ClampToEdgeWrapping,
      wrapT: ClampToEdgeWrapping,
      samples: 0,
    } as const;
    this.historyRead = new WebGLRenderTarget(1, 1, targetOptions);
    this.historyWrite = new WebGLRenderTarget(1, 1, targetOptions);

    this.resolveMaterial = new RawShaderMaterial({
      uniforms: {
        current: new Uniform<Texture | null>(null),
        history: new Uniform<Texture | null>(null),
        opaqueDepth: new Uniform<Texture | null>(null),
        frontDepth: new Uniform<Texture | null>(null),
        hasFrontDepth: new Uniform(0),
        hasHistory: new Uniform(0),
        prevViewProj: new Uniform(new Matrix4()),
        cameraMatrixWorld: new Uniform(new Matrix4()),
        projP00: new Uniform(1),
        projP11: new Uniform(1),
        cameraNear: new Uniform(0.1),
        cameraFar: new Uniform(1),
        logDepth: new Uniform(0),
        feedback: new Uniform(feedback),
        clampStrength: new Uniform(1),
        boxGamma: new Uniform(1.25),
        neighbourhoodRadius: new Uniform(1),
        texelSize: new Uniform(new Vector2(1, 1)),
      },
      vertexShader: copyVert,
      fragmentShader: taaResolveFrag,
      depthTest: false,
      depthWrite: false,
      transparent: false,
      blending: NoBlending,
    });

    this.blitMaterial = new RawShaderMaterial({
      uniforms: {
        source: new Uniform<Texture | null>(null),
        opacity: new Uniform(1),
      },
      vertexShader: copyVert,
      fragmentShader: copyFrag,
      depthTest: false,
      depthWrite: false,
      transparent: false,
      blending: NoBlending,
    });
  }

  setSize(width: number, height: number) {
    const w = Math.max(1, Math.floor(width));
    const h = Math.max(1, Math.floor(height));
    // A redundant resize to the current dimensions must NOT wipe the accumulation:
    // the owning effect can re-run with an unchanged size (React dependency-identity
    // churn), and resetting history on every such call prevents the still-camera
    // image from ever converging (it restarts before it can freeze).
    if (w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;
    this.historyRead.setSize(this.width, this.height);
    this.historyWrite.setSize(this.width, this.height);
    this.resolveMaterial.uniforms.texelSize.value.set(
      1 / this.width,
      1 / this.height,
    );
    // The view changed under the camera: start a fresh accumulation.
    this.reset();
  }

  /** Force the accumulation to restart on the next frame. */
  reset() {
    this.hasHistory = false;
    this.sampleIndex = 0;
  }

  /**
   * Apply this frame's sub-pixel jitter to the camera projection. Called by the
   * owning pass immediately before it renders the scene; paired with
   * {@link restoreJitter} after the render. Reprojection TAA jitters *every* frame
   * (the history is reprojected, so a still and a moving frame are treated the
   * same), unlike the still-only temporal accumulation.
   */
  applyJitter(camera: Camera) {
    // Undo any jitter still applied so the snapshot below captures the clean matrix.
    this.restoreJitter();

    this.camera = camera;
    this.savedProjection.copy(camera.projectionMatrix);
    this.savedProjectionInverse.copy(camera.projectionMatrixInverse);

    // Halton(2,3) centred to [-0.5, 0.5] pixels, converted to clip space (NDC spans
    // 2 units across the full resolution).
    const n = (this.sampleIndex % this.sampleCount) + 1;
    this.sampleIndex++;
    const jx = (halton(n, 2) - 0.5) * (2 / this.width);
    const jy = (halton(n, 3) - 0.5) * (2 / this.height);

    // Perspective: offset m02/m12 (a depth-independent screen-space shift).
    // Orthographic: offset the clip-space translation m03/m13 (w == 1).
    const persp = (camera as PerspectiveCamera).isPerspectiveCamera === true;
    const ex = persp ? 8 : 12;
    const ey = persp ? 9 : 13;
    const e = camera.projectionMatrix.elements;
    e[ex] += jx;
    e[ey] += jy;
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    this.jittered = true;
  }

  /**
   * Restore the camera projection (matrix + cached inverse) to the snapshot taken
   * in {@link applyJitter}. Idempotent and safe to call when no jitter is applied.
   */
  restoreJitter() {
    if (!this.jittered || !this.camera) return;
    this.camera.projectionMatrix.copy(this.savedProjection);
    this.camera.projectionMatrixInverse.copy(this.savedProjectionInverse);
    this.jittered = false;
  }

  /**
   * Reproject the running history to the current view and blend it with the freshly
   * composited frame in `buffer`, writing the result back into `buffer`. Must be
   * called after {@link restoreJitter} so the camera matrices are the clean
   * (un-jittered) transform.
   *
   * `frontDepth` is the OIT front-layer's view-space linear depth (normalised by
   * `camera.far`); pass `null` when it was not written this frame (front peel
   * disabled or no transparent content), in which case only the opaque hardware
   * depth is used for reprojection.
   */
  resolve(
    renderer: WebGLRenderer,
    buffer: WebGLRenderTarget,
    camera: Camera,
    frontDepth: Texture | null,
  ) {
    this.curViewProj.multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse,
    );

    const persp = camera as PerspectiveCamera;
    const near = persp.near ?? 0.1;
    const far = persp.far && persp.far > 0 ? persp.far : 1;

    const u = this.resolveMaterial.uniforms;
    u.current.value = buffer.texture;
    u.history.value = this.historyRead.texture;
    u.opaqueDepth.value = buffer.depthTexture;
    u.frontDepth.value = frontDepth;
    u.hasFrontDepth.value = frontDepth ? 1 : 0;
    u.hasHistory.value = this.hasHistory ? 1 : 0;
    (u.prevViewProj.value as Matrix4).copy(this.prevViewProj);
    (u.cameraMatrixWorld.value as Matrix4).copy(camera.matrixWorld);
    u.projP00.value = camera.projectionMatrix.elements[0];
    u.projP11.value = camera.projectionMatrix.elements[5];
    u.cameraNear.value = near;
    u.cameraFar.value = far;
    u.logDepth.value = renderer.capabilities.logarithmicDepthBuffer ? 1 : 0;
    u.feedback.value = this.feedback;
    // Motion amount in [0, 1]: 0 while still, 1 in full motion. Drives the clip so it
    // is relaxed (but never fully off) at rest and ramps to a tight, full-strength clip
    // during motion. Widening the box + sampling stride at rest lets aliased static
    // geometry converge (its history stays inside the box, so the clip is a no-op)
    // while still catching the far-outside-box history of an object animating under a
    // still camera - the ghost trail the previous "trust history verbatim" rest did not.
    const motion = this.computeMotionAmount();
    u.clampStrength.value =
      this.restClampStrength + (1 - this.restClampStrength) * motion;
    u.boxGamma.value =
      this.restBoxGamma + (this.motionBoxGamma - this.restBoxGamma) * motion;
    u.neighbourhoodRadius.value =
      this.restNeighbourhoodRadius +
      (this.motionNeighbourhoodRadius - this.restNeighbourhoodRadius) * motion;

    this.fullscreenRenderer.renderMaterial(
      renderer,
      this.historyWrite,
      this.resolveMaterial,
    );

    // Copy the resolved result back into the pipeline buffer for later passes.
    this.blitMaterial.uniforms.source.value = this.historyWrite.texture;
    this.fullscreenRenderer.renderMaterial(renderer, buffer, this.blitMaterial);

    const tmp = this.historyRead;
    this.historyRead = this.historyWrite;
    this.historyWrite = tmp;
    this.prevViewProj.copy(this.curViewProj);
    this.prevViewProjInverse.copy(this.curViewProj).invert();
    this.hasHistory = true;
  }

  /**
   * Per-frame camera-motion amount in `[0, 1]`, used to ramp the neighbourhood clip
   * (strength, box width and sampling stride) between its still and full-motion
   * settings. Builds `M = curViewProj * prevViewProjInverse` (prev NDC -> cur NDC; the
   * identity when the camera is still), reprojects the 8 frustum corners through it and
   * takes the largest corner displacement in pixels, then maps it through a smoothstep
   * from {@link stillPixelThreshold} (0 = still) to {@link motionPixelThreshold}
   * (1 = full motion). Working in NDC/pixels makes it independent of world scale and
   * zoom. Returns 1 on the first frame (before any history exists).
   */
  private computeMotionAmount(): number {
    if (!this.hasHistory) return 1;
    this.motionMatrix.multiplyMatrices(
      this.curViewProj,
      this.prevViewProjInverse,
    );
    const halfW = 0.5 * this.width;
    const halfH = 0.5 * this.height;
    let maxPixels = 0;
    for (const c of NDC_MOTION_CORNERS) {
      this.motionScratch.set(c[0], c[1], c[2]).applyMatrix4(this.motionMatrix);
      const dx = (this.motionScratch.x - c[0]) * halfW;
      const dy = (this.motionScratch.y - c[1]) * halfH;
      const d = Math.hypot(dx, dy);
      if (d > maxPixels) maxPixels = d;
    }
    const span = Math.max(
      1e-4,
      this.motionPixelThreshold - this.stillPixelThreshold,
    );
    const t = Math.min(
      1,
      Math.max(0, (maxPixels - this.stillPixelThreshold) / span),
    );
    return t * t * (3 - 2 * t);
  }

  dispose() {
    // Remove our sub-pixel jitter so the camera is left in a clean state.
    this.restoreJitter();
    this.historyRead.dispose();
    this.historyWrite.dispose();
    this.resolveMaterial.dispose();
    this.blitMaterial.dispose();
    this.fullscreenRenderer.dispose();
  }
}
