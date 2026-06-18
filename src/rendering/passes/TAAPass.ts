import {
  ClampToEdgeWrapping,
  HalfFloatType,
  LinearFilter,
  Matrix4,
  OrthographicCamera,
  PerspectiveCamera,
  RawShaderMaterial,
  RGBAFormat,
  Texture,
  Uniform,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import { FullscreenRenderer } from '../fullscreen-renderer';
import { Pass } from '../Pass';
import copyFrag from '../shaders/copy-frag.glsl';
import copyVert from '../shaders/copy-vert.glsl';
import taaResolveFrag from '../shaders/taa-resolve-frag.glsl';

/** Camera types this pass knows how to jitter. */
type JitterableCamera = PerspectiveCamera | OrthographicCamera;

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
 * Temporal Anti-Aliasing pass (jittered accumulation) for use with the
 * {@link RenderingPipeline}.
 *
 * Each frame the camera's projection is offset by a sub-pixel jitter from a
 * Halton(2,3) sequence and the freshly rendered buffer is accumulated into a
 * history target as a running average. Because the 1px-line problem with
 * supersampling is that the line stays one device-pixel wide as the buffer
 * grows, jittered accumulation is the technique that *does* anti-alias thin
 * features: the same 1px line lands on slightly different sub-pixel positions
 * each frame, so the average is coverage-weighted without thinning.
 *
 * The accumulation resets whenever the (un-jittered) camera view changes, so an
 * orbit-and-inspect workflow converges to near-supersampled quality within a
 * handful of static frames. Once the full jitter sequence has accumulated the
 * pass freezes (no further jitter or blending) and presents the converged image
 * until the next camera move, so a still camera settles to a stable result.
 * Place it where you would place {@link FxaaPass} — before the {@link OutputPass}.
 *
 * Limitations (no history reprojection / neighbourhood clamping): animated
 * content that moves while the camera is static (e.g. additive jet streams) does
 * not update once the image has converged and frozen, and ghosts before then.
 * Camera motion itself never ghosts because it triggers a reset.
 *
 * @group Rendering
 * @see {@link RenderingPipeline}
 * @see {@link FxaaPass}
 * @see {@link SMAAPass}
 */
export class TAAPass extends Pass {
  private camera: JitterableCamera;

  /**
   * Number of unique jitter samples to cycle through before the average is
   * considered fully converged. Higher = smoother but slower to settle.
   */
  sampleCount: number;

  private historyRead: WebGLRenderTarget;
  private historyWrite: WebGLRenderTarget;
  private resolveMaterial: RawShaderMaterial;
  private blitMaterial: RawShaderMaterial;
  private fullscreenRenderer = new FullscreenRenderer();

  private width = 1;
  private height = 1;

  /** Index into the jitter sequence for the current frame. */
  private sampleIndex = 0;
  /** How many frames have been accumulated since the last reset. */
  private accumulated = 0;
  /** Jitter (in clip-space units) currently baked into the camera projection. */
  private appliedJitterX = 0;
  private appliedJitterY = 0;

  /** Snapshot of the previous frame's camera state used to detect motion. The
   * view matrix and the projection are stored separately so the two projection
   * elements we jitter can be excluded from the comparison (see `detectMotion`). */
  private prevView = new Matrix4();
  private prevProjection = new Matrix4();
  private hasPrev = false;

  constructor(camera: JitterableCamera, sampleCount = 16) {
    super();
    this.camera = camera;
    this.sampleCount = Math.max(1, sampleCount);

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
      },
      vertexShader: copyVert,
      fragmentShader: taaResolveFrag,
      depthTest: false,
      depthWrite: false,
      transparent: false,
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
    });
  }

  setSize(width: number, height: number) {
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    this.historyRead.setSize(this.width, this.height);
    this.historyWrite.setSize(this.width, this.height);
    // Geometry changed under the camera: start a fresh accumulation.
    this.reset();
  }

  dispose() {
    // Remove our sub-pixel jitter so the camera is left in a clean state.
    this.clearJitter();
    this.historyRead.dispose();
    this.historyWrite.dispose();
    this.resolveMaterial.dispose();
    this.blitMaterial.dispose();
    this.fullscreenRenderer.dispose();
  }

  /** Force the accumulation to restart on the next frame. */
  reset() {
    this.accumulated = 0;
    this.sampleIndex = 0;
  }

  // ---- jitter -------------------------------------------------------------

  /** Indices into the projection matrix offset elements for the active camera. */
  private jitterElements(): { ex: number; ey: number } {
    // Perspective: offset m02/m12 (scaled by clip w == view depth).
    // Orthographic: offset the clip-space translation m03/m13 (w == 1).
    return (this.camera as PerspectiveCamera).isPerspectiveCamera
      ? { ex: 8, ey: 9 }
      : { ex: 12, ey: 13 };
  }

  private clearJitter() {
    if (this.appliedJitterX === 0 && this.appliedJitterY === 0) return;
    const { ex, ey } = this.jitterElements();
    const e = this.camera.projectionMatrix.elements;
    e[ex] -= this.appliedJitterX;
    e[ey] -= this.appliedJitterY;
    this.appliedJitterX = 0;
    this.appliedJitterY = 0;
  }

  private applyJitter() {
    // Halton(2,3) centred to [-0.5, 0.5] pixels, converted to clip-space (NDC
    // spans 2 units across the full resolution).
    const n = (this.sampleIndex % this.sampleCount) + 1;
    const jx = (halton(n, 2) - 0.5) * (2 / this.width);
    const jy = (halton(n, 3) - 0.5) * (2 / this.height);
    const { ex, ey } = this.jitterElements();
    const e = this.camera.projectionMatrix.elements;
    e[ex] += jx;
    e[ey] += jy;
    this.appliedJitterX = jx;
    this.appliedJitterY = jy;
  }

  // ---- motion detection ---------------------------------------------------

  /**
   * Compare the current camera against the previous frame and reset the
   * accumulation on any real view change (orbit, pan, zoom, fov).
   *
   * Motion is measured from the camera's view matrix (`matrixWorldInverse`,
   * which we never touch) and its projection matrix *excluding* the two elements
   * we jitter (`ex`/`ey`). This is critical: deriving motion from a quantity that
   * includes our own sub-pixel jitter — or trying to subtract the jitter back out
   * of the projection — couples the test to the jitter and makes every frame look
   * like motion (the jitter delta dwarfs the tolerance), so the accumulation
   * resets forever and the image never settles. By ignoring the jittered slots
   * outright, only genuine camera changes trigger a reset.
   */
  private detectMotion() {
    const { ex, ey } = this.jitterElements();
    const view = this.camera.matrixWorldInverse;
    const proj = this.camera.projectionMatrix;

    if (!this.hasPrev) {
      this.hasPrev = true;
      this.prevView.copy(view);
      this.prevProjection.copy(proj);
      this.reset();
      return;
    }

    const va = view.elements;
    const vb = this.prevView.elements;
    const pa = proj.elements;
    const pb = this.prevProjection.elements;
    let moved = false;
    for (let i = 0; i < 16; i++) {
      // Relative tolerance: view/projection magnitudes span from O(1) terms to
      // large (oilfield-scale) translation terms, so an absolute epsilon would
      // either never converge or never reset.
      const vScale = Math.max(1, Math.abs(va[i]), Math.abs(vb[i]));
      if (Math.abs(va[i] - vb[i]) > 1e-6 * vScale) {
        moved = true;
        break;
      }
      // Skip the two projection elements that carry our sub-pixel jitter.
      if (i === ex || i === ey) continue;
      const pScale = Math.max(1, Math.abs(pa[i]), Math.abs(pb[i]));
      if (Math.abs(pa[i] - pb[i]) > 1e-6 * pScale) {
        moved = true;
        break;
      }
    }

    this.prevView.copy(view);
    this.prevProjection.copy(proj);
    if (moved) this.reset();
  }

  // ---- render -------------------------------------------------------------

  render(renderer: WebGLRenderer, buffer: WebGLRenderTarget) {
    // The scene for THIS frame was already rendered into `buffer` using the
    // jitter applied at the end of the previous frame. Remove it now so motion
    // detection and the next jitter operate from the clean base projection.
    this.detectMotion();
    this.clearJitter();

    // Once the whole jitter sequence has been accumulated the running average is
    // converged. Continuing to jitter + blend every frame would keep nudging the
    // image by a fresh sub-pixel sample indefinitely — a permanent low-amplitude
    // shimmer that never settles. So freeze: leave the projection un-jittered and
    // keep presenting the converged history until camera motion triggers a reset.
    // Trade-off: animated content that moves while the camera is static also
    // freezes (same class of limitation as the missing history reprojection).
    if (this.accumulated >= this.sampleCount) {
      this.blitMaterial.uniforms.source.value = this.historyRead.texture;
      this.fullscreenRenderer.renderMaterial(
        renderer,
        buffer,
        this.blitMaterial,
      );
      return;
    }

    const reset = this.accumulated === 0;
    const blend = reset ? 1 : 1 / (this.accumulated + 1);

    // Resolve: history (read) + current buffer -> history (write).
    this.resolveMaterial.uniforms.current.value = buffer.texture;
    this.resolveMaterial.uniforms.history.value = reset
      ? buffer.texture
      : this.historyRead.texture;
    this.resolveMaterial.uniforms.blend.value = blend;
    this.fullscreenRenderer.renderMaterial(
      renderer,
      this.historyWrite,
      this.resolveMaterial,
    );

    // Swap ping-pong targets so the just-written history becomes the read source.
    const tmp = this.historyRead;
    this.historyRead = this.historyWrite;
    this.historyWrite = tmp;

    // Copy the accumulated result back into the shared buffer for downstream
    // passes (OutputPass).
    this.blitMaterial.uniforms.source.value = this.historyRead.texture;
    this.fullscreenRenderer.renderMaterial(renderer, buffer, this.blitMaterial);

    // Advance accumulation (capped so the running average stays bounded once
    // converged) and jitter the camera for the next frame.
    if (this.accumulated < this.sampleCount) this.accumulated++;
    this.sampleIndex++;
    this.applyJitter();
  }
}
