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
import temporalResolveFrag from './shaders/temporal-resolve-frag.glsl';

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
 * previous frustum (near-plane corners are translation-sensitive, far-plane corners
 * rotation-sensitive), independent of world scale or zoom level.
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
 * Temporal supersampling resolver for the {@link OITRenderPass}.
 *
 * This is *not* reprojected TAA. Each frame the camera projection is offset by a
 * sub-pixel Halton jitter (so a thin feature lands on different sub-pixel positions
 * over time) and the freshly composited frame is blended into a running history
 * average — but **only while the camera is still**. There is no depth/velocity
 * reprojection: as soon as the camera moves the history is dropped (the current
 * frame is shown), so nothing can ghost. When the camera comes to rest the average
 * accumulates again and the static view converges to a genuinely supersampled
 * image. This is the right trade for an inspection-heavy app (zoom in, hold still)
 * and, crucially, it works identically for opaque, transparent (OIT) and additive
 * content because it never tries to track any of it through motion.
 *
 * The {@link OITRenderPass} owns one of these and drives it: it calls
 * {@link applyJitter} before rendering the scene and {@link restoreJitter} +
 * {@link resolve} afterwards. The jitter is applied to the shared camera only
 * between those two calls (inside the pass's own `render`), so it never leaks to
 * later passes (annotations, picking) or other `useFrame` consumers.
 *
 * @group Rendering
 * @see {@link OITRenderPass}
 */
export class TemporalResolver {
  /**
   * Number of unique sub-pixel jitter samples to cycle through (the length of the
   * Halton sequence used). Higher spreads coverage over more sub-pixel positions.
   */
  sampleCount: number;

  /**
   * History weight while the camera is still (the current frame contributes
   * `1 - feedback`). A fixed-feedback exponential average converges to a stable
   * supersampled image without the endless `1 / n` wobble that previously needed a
   * freeze, and - paired with the resolve shader's motion-adaptive rejection - lets
   * content that animates under a still camera blend in immediately instead of
   * freezing. Higher = smoother/slower to react; typical range 0.85-0.95.
   */
  feedback: number;

  /**
   * Threshold, in screen pixels, on the per-frame motion of the reprojected
   * frustum corners (see {@link NDC_MOTION_CORNERS}) above which the camera is
   * treated as moving (history dropped). Measured directly in pixels, so it behaves
   * identically at any zoom level or scene/world scale. Kept slightly above the
   * sub-pixel residual left by damped camera controls (which otherwise resets the
   * accumulation every few frames as the view settles, pulsing the still image
   * between an aliased and a converged frame). Motion this small is far below any
   * visible blur, so treating it as still is safe. Lower = accumulates sooner after
   * motion stops; higher = tolerates more residual drift before dropping history.
   */
  motionPixelThreshold = 0.3;

  /**
   * Strength of the anti-ghost neighbourhood clip applied while the camera is still
   * (the mode only accumulates while still). **Default 0.2** — a low floor that stays
   * firmly on the static-favoured side of the scale: the still image still converges
   * to a near-supersampled result, while a touch of clip already bounds the worst fade
   * trails. Raise it (typically 0.6-0.9) to more aggressively suppress the trail an
   * object animating under a still camera leaves — the clip pulls history that lands
   * *far outside* the current frame's local colour box back in. It is a no-op for
   * correctly converged static geometry: the box is deliberately widened (see the
   * resolve shader's `BOX_GAMMA`/`NEIGHBOURHOOD_RADIUS`) so a heavily aliased
   * near-Nyquist feature's converged value stays *inside* it and is never rejected.
   * 0 restores the pure exponential average; 1 clips fully.
   */
  clampStrength = 0.2;

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
  /**
   * Whether the camera was moving as of the last {@link resolve}. Read by
   * {@link applyJitter} (which runs before motion can be detected for the current
   * frame) to decide whether to jitter: moving frames are shown raw, so jittering
   * them would read as the whole scene shaking. Starts `true` so the very first
   * frame renders at its true position.
   */
  private moving = true;

  /**
   * Whether the camera was moving as of the last {@link resolve}. Lets the owning
   * pass restrict a spatial AA pass (SMAA) to moving frames only, leaving the still
   * frames to the temporal accumulation.
   */
  get isMoving(): boolean {
    return this.moving;
  }

  /** True while a sub-pixel jitter is applied to the shared camera projection. */
  private jittered = false;
  /** The camera the jitter was applied to (restored in {@link restoreJitter}). */
  private camera: Camera | null = null;
  /** Snapshot of the clean projection matrix, restored exactly after the render. */
  private savedProjection = new Matrix4();
  /** Snapshot of the clean projection inverse, restored alongside the projection. */
  private savedProjectionInverse = new Matrix4();

  /** Scratch: current (un-jittered) view-projection, for motion detection. */
  private curViewProj = new Matrix4();
  /** Inverse of the previous frame's (un-jittered) view-projection. */
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
        blend: new Uniform(1),
        clampStrength: new Uniform(0),
        texelSize: new Uniform(new Vector2(1, 1)),
      },
      vertexShader: copyVert,
      fragmentShader: temporalResolveFrag,
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
    // A redundant resize to the current dimensions must NOT restart the
    // accumulation: the owning effect can re-run with an unchanged size (React
    // dependency-identity churn), and resetting on every such call would keep the
    // still-camera average from ever converging (it would flash back to blend = 1).
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
    this.moving = true;
  }

  /**
   * Apply this frame's sub-pixel jitter to the camera projection. Called by the
   * owning pass immediately before it renders the scene; paired with
   * {@link restoreJitter} after the render. The clean projection (matrix + cached
   * inverse) is snapshotted so it can be restored exactly, leaving no drift.
   *
   * The jitter is only applied while the camera is still ({@link moving} is false).
   * While the camera moves, frames are displayed raw (blend = 1), so a per-frame
   * sub-pixel offset would show up as the entire scene shaking; rendering moving
   * frames at their true (un-jittered) position keeps them rock-steady. Sub-pixel
   * coverage is only needed once the view holds still and the average accumulates.
   */
  applyJitter(camera: Camera) {
    // Undo any jitter still applied (e.g. a previous restore was skipped) so the
    // snapshot below captures the clean projection.
    this.restoreJitter();

    this.camera = camera;

    if (this.moving) {
      // Camera moving: render at the true position (no jitter). The history is reseeded
      // from this frame in resolve (blend 1), so a per-frame sub-pixel offset would just
      // read as the whole scene shaking. Sub-pixel coverage is accumulated once the view
      // holds still; object motion under a still camera is handled by the resolve
      // shader's rejection, not by skipping the jitter.
      this.jittered = false;
      return;
    }

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
    // Keep the cached inverse consistent with the jittered projection.
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
   * Blend the freshly composited frame in `buffer` with the running history and
   * write the result back into `buffer`. Must be called after {@link restoreJitter}
   * so the camera matrices sampled for motion detection are the clean transform.
   *
   * Reads `buffer.texture` as the current frame and writes the average into the
   * history target, then copies that back into `buffer` (an overwrite blit, so the
   * buffer's alpha is replaced rather than blended). The history targets are
   * ping-ponged for the next frame.
   */
  resolve(renderer: WebGLRenderer, buffer: WebGLRenderTarget, camera: Camera) {
    this.curViewProj.multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse,
    );

    const moved = !this.hasHistory || this.detectMotion();
    // Remember the motion state for the next frame's applyJitter (which runs before
    // motion can be measured): while moving we render un-jittered, steady frames.
    this.moving = moved;
    // On camera motion (or the first frame) reseed the history from the current frame;
    // otherwise accumulate a fixed-feedback exponential average. There is deliberately
    // no freeze branch: the EMA converges to a stable supersampled image on its own (so
    // it does not wobble), and jittering every still frame means content that starts or
    // stops animating under a still camera re-converges instead of staying frozen.
    // Object motion is rejected per-pixel in the resolve shader (see its header).
    const blend = moved ? 1 : 1 - this.feedback;

    const u = this.resolveMaterial.uniforms;
    u.current.value = buffer.texture;
    u.history.value = this.historyRead.texture;
    u.blend.value = blend;
    // Anti-ghost clip strength: applied only while still (the shader ignores it when
    // blend == 1, i.e. on a reset or while the camera moves and the history is reseeded).
    u.clampStrength.value = this.clampStrength;
    this.fullscreenRenderer.renderMaterial(
      renderer,
      this.historyWrite,
      this.resolveMaterial,
    );

    // Copy the accumulated result back into the pipeline buffer for later passes.
    this.blitMaterial.uniforms.source.value = this.historyWrite.texture;
    this.fullscreenRenderer.renderMaterial(renderer, buffer, this.blitMaterial);

    const tmp = this.historyRead;
    this.historyRead = this.historyWrite;
    this.historyWrite = tmp;
    this.prevViewProjInverse.copy(this.curViewProj).invert();
    this.hasHistory = true;
  }

  /**
   * True when the rendered image moved more than {@link motionPixelThreshold}
   * pixels since the last frame. Builds `M = curViewProj * prevViewProjInverse`,
   * which maps the previous frame's NDC back to the current frame's NDC (the
   * identity when the camera is still), reprojects the 8 frustum corners through it
   * and takes the largest corner displacement converted to pixels. Operating in
   * NDC/pixels makes this independent of world scale and zoom, unlike a raw
   * view-projection matrix delta (whose magnitude grows with camera distance and so
   * goes undetected when zoomed out).
   */
  private detectMotion(): boolean {
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
    return maxPixels > this.motionPixelThreshold;
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
