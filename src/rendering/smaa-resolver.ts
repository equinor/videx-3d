import {
  ClampToEdgeWrapping,
  Color,
  HalfFloatType,
  LinearFilter,
  NoBlending,
  RawShaderMaterial,
  RGBAFormat,
  ShaderMaterial,
  Texture,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import { SMAAPass as StdlibSMAAPass } from 'three-stdlib';
import { FullscreenRenderer } from './fullscreen-renderer';
import type { PassBuffers } from './Pass';
import copyFrag from './shaders/copy-frag.glsl';
import copyVert from './shaders/copy-vert.glsl';

const BLACK = new Color(0, 0, 0);

/**
 * Quality preset for SMAA. Higher presets lower the edge-detection threshold (so
 * fainter edges are anti-aliased) and increase the orthogonal search distance (so
 * longer near-horizontal/vertical edges are reconstructed). The underlying
 * three-stdlib SMAA shaders do not implement the reference SMAA's diagonal search
 * and corner rounding, so those are unaffected by the preset.
 *
 * @group Rendering
 */
export type SMAAQuality = 'low' | 'medium' | 'high' | 'ultra';

/**
 * Edge-detection threshold and max orthogonal search steps per quality preset,
 * matching the reference SMAA presets (minus the unsupported diagonal/corner
 * parameters). `medium` equals the underlying three-stdlib shader defaults.
 */
const SMAA_PRESETS: Record<
  SMAAQuality,
  { threshold: number; searchSteps: number }
> = {
  low: { threshold: 0.15, searchSteps: 4 },
  medium: { threshold: 0.1, searchSteps: 8 },
  high: { threshold: 0.1, searchSteps: 16 },
  ultra: { threshold: 0.05, searchSteps: 32 },
};

/**
 * Each colour tap of three-stdlib's SMAA edge shader (`texture2D( colorTex, … ).rgb`), clamped
 * to 0–1, and how many it found (seven).
 *
 * Edges are found on the linear buffer clamped to 0–1, as on the 8-bit copy of it they were
 * found on until 2026-11-25: three drew that copy linear, into sRGB storage the GPU decoded
 * back on reading, so all it did was clamp, for a full-size draw (0.7 ms at 2440 × 2050).
 *
 * @internal
 */
export function smaaClampedEdgeTaps(shader: string) {
  let taps = 0;
  const clamped = shader.replace(
    /texture2D\( colorTex, ([^)]+?) \)\.rgb/g,
    (_, at: string) => {
      taps++;
      return `clamp( texture2D( colorTex, ${at} ).rgb, 0.0, 1.0 )`;
    },
  );
  return { shader: clamped, taps };
}

/**
 * Subpixel Morphological Anti-Aliasing (SMAA) resolver, used internally by
 * {@link OITRenderPass} when its `antialias` mode is `'smaa'` or `'temporal-smaa'`.
 * It detects edges by colour discontinuity and reconstructs anti-aliased
 * silhouettes using precomputed area/search lookup tables, giving clean long edges
 * with little detail blurring.
 *
 * It works in the buffer's linear space: edges on its colour clamped to 0–1
 * ({@link smaaClampedEdgeTaps}), the blend and output linear, so brightness is untouched.
 *
 * This wraps the well-tested SMAA shaders and lookup textures from `three-stdlib`
 * and drives the three sub-passes (edge detection, blend-weight calculation,
 * neighbourhood blending) through a {@link FullscreenRenderer}. The blend reads the
 * buffer, so it writes elsewhere: into a pipeline's spare target, swapped in
 * ({@link PassBuffers}), or without one into a scratch target of its own, copied back.
 *
 * Like all morphological techniques it cannot recover sub-pixel features (e.g. 1px
 * WebGL lines that fall between samples) — those are handled by the temporal
 * supersampling mode while the camera is still.
 */
export class SmaaResolver {
  private inner: StdlibSMAAPass;
  private scratch: WebGLRenderTarget | null = null;
  private blitMaterial: RawShaderMaterial;
  private fullscreenRenderer = new FullscreenRenderer();
  private width = 1;
  private height = 1;

  private materialEdges: ShaderMaterial;
  private materialWeights: ShaderMaterial;
  private materialBlend: ShaderMaterial;

  private _quality: SMAAQuality;

  /** Reused scratch for saving the renderer clear colour each frame (no per-frame alloc). */
  private prevClearColor = new Color();

  constructor(quality: SMAAQuality = 'high') {
    // three-stdlib's SMAAPass builds the edge/weight render targets, the three
    // sub-pass materials and (asynchronously, from embedded base64 PNGs) the
    // area + search lookup textures. We reuse those resources but drive the draws
    // ourselves so the resolver can composite into OIT's buffer.
    this.inner = new StdlibSMAAPass(1, 1);
    this.materialEdges = this.inner.materialEdges as ShaderMaterial;
    this.materialWeights = this.inner.materialWeights as ShaderMaterial;
    this.materialBlend = this.inner.materialBlend as ShaderMaterial;
    this.materialEdges.fragmentShader = smaaClampedEdgeTaps(
      this.materialEdges.fragmentShader,
    ).shader;
    // Into a target that may share the pipeline's depth texture (PassBuffers): no depth.
    this.materialBlend.depthTest = false;
    this.materialBlend.depthWrite = false;

    this.blitMaterial = new RawShaderMaterial({
      uniforms: {
        opacity: { value: 1 },
        source: { value: null as Texture | null },
      },
      vertexShader: copyVert,
      fragmentShader: copyFrag,
      depthTest: false,
      depthWrite: false,
      transparent: false,
      blending: NoBlending,
    });

    this._quality = quality;
    this.applyQuality();
  }

  /**
   * Quality preset (default `'high'`). Assigning it rewrites the edge-detection
   * threshold and orthogonal search-distance shader defines and recompiles the two
   * affected sub-pass programs. The recompile only happens when the value actually
   * changes, so reading/writing the same value every frame is free.
   */
  get quality(): SMAAQuality {
    return this._quality;
  }

  set quality(value: SMAAQuality) {
    if (value === this._quality) return;
    this._quality = value;
    this.applyQuality();
  }

  private applyQuality() {
    const { threshold, searchSteps } = SMAA_PRESETS[this._quality];
    this.materialEdges.defines.SMAA_THRESHOLD = threshold.toFixed(3);
    this.materialEdges.needsUpdate = true;
    this.materialWeights.defines.SMAA_MAX_SEARCH_STEPS = String(searchSteps);
    this.materialWeights.needsUpdate = true;
  }

  setSize(width: number, height: number) {
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    this.inner.setSize(this.width, this.height);
    this.scratch?.setSize(this.width, this.height);
  }

  dispose() {
    this.inner.dispose();
    this.scratch?.dispose();
    this.blitMaterial.dispose();
    this.fullscreenRenderer.dispose();
  }

  /** Where the blend goes without a pipeline's spare: made on first use. */
  private ensureScratch() {
    return (this.scratch ??= new WebGLRenderTarget(this.width, this.height, {
      format: RGBAFormat,
      type: HalfFloatType,
      depthBuffer: false,
      generateMipmaps: false,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      wrapS: ClampToEdgeWrapping,
      wrapT: ClampToEdgeWrapping,
      samples: 0,
    }));
  }

  /**
   * Anti-alias `buffer`. With `buffers` the result goes into the pipeline's spare, swapped
   * in; without, it is copied back into `buffer`. Returns the target that holds it.
   */
  render(
    renderer: WebGLRenderer,
    buffer: WebGLRenderTarget,
    buffers?: PassBuffers,
  ): WebGLRenderTarget {
    // The edge-detection and blend-weight sub-passes use `discard` for non-edge
    // pixels, so they only write where edges are found. The pipeline runs with
    // renderer.autoClear = false, and this resolver drives the draws itself (it
    // does not use three-stdlib's internal clears), so edgesRT/weightsRT would
    // otherwise retain results from previous frames. While the camera is still
    // that stale data matches the current frame (SMAA appears to work), but once
    // the camera moves the leftover edges/weights no longer correspond to the
    // scene and the anti-aliasing breaks. Clear both targets every frame.
    const prevClearColor = this.prevClearColor;
    renderer.getClearColor(prevClearColor);
    const prevClearAlpha = renderer.getClearAlpha();
    renderer.setClearColor(BLACK, 0);

    // 1) Edge detection: the buffer's colour, clamped to 0–1 -> edges RT.
    (this.materialEdges.uniforms.tDiffuse.value as Texture | null) =
      buffer.texture;
    renderer.setRenderTarget(this.inner.edgesRT);
    renderer.clear(true, false, false);
    this.fullscreenRenderer.renderMaterial(
      renderer,
      this.inner.edgesRT,
      this.materialEdges,
    );

    // 2) Blend-weight calculation: edges RT (+ area/search LUTs) -> weights RT.
    // (tDiffuse/tArea/tSearch were wired to the edges RT and LUTs in the ctor.)
    renderer.setRenderTarget(this.inner.weightsRT);
    renderer.clear(true, false, false);
    this.fullscreenRenderer.renderMaterial(
      renderer,
      this.inner.weightsRT,
      this.materialWeights,
    );

    // 3) Neighbourhood blending: weights RT (tDiffuse) + linear buffer colour
    // (tColor), in linear space. It can't write the buffer it reads: into the
    // pipeline's spare, which becomes the buffer, or else into scratch, copied back.
    (this.materialBlend.uniforms.tColor.value as Texture | null) =
      buffer.texture;
    const out = buffers ? buffers.spare : this.ensureScratch();
    this.fullscreenRenderer.renderMaterial(renderer, out, this.materialBlend);
    let result = buffer;
    if (buffers) result = buffers.swap();
    else {
      (this.blitMaterial.uniforms.source.value as Texture | null) = out.texture;
      this.fullscreenRenderer.renderMaterial(
        renderer,
        buffer,
        this.blitMaterial,
      );
    }

    renderer.setClearColor(prevClearColor, prevClearAlpha);
    return result;
  }
}
