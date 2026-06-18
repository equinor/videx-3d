import {
  ClampToEdgeWrapping,
  Color,
  HalfFloatType,
  LinearFilter,
  RawShaderMaterial,
  RGBAFormat,
  ShaderMaterial,
  Texture,
  Vector2,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import { SMAAPass as StdlibSMAAPass } from 'three-stdlib';
import { FullscreenRenderer } from '../fullscreen-renderer';
import { Pass } from '../Pass';
import copyFrag from '../shaders/copy-frag.glsl';
import copyVert from '../shaders/copy-vert.glsl';

const BLACK = new Color(0, 0, 0);

/**
 * Subpixel Morphological Anti-Aliasing (SMAA) post-process pass for use with the
 * {@link RenderingPipeline}. A drop-in alternative to {@link FxaaPass}: it detects
 * edges by colour discontinuity and reconstructs anti-aliased silhouettes using
 * precomputed area/search lookup tables, giving noticeably cleaner long edges on
 * opaque geometry than FXAA, with less detail blurring.
 *
 * SMAA operates in linear space and must run before the {@link OutputPass} (i.e.
 * before tone-mapping / output-encoding), exactly like {@link FxaaPass}.
 *
 * Like all morphological techniques it cannot recover sub-pixel features (e.g.
 * 1px WebGL lines that fall between samples) — use {@link TAAPass} for those.
 *
 * This wraps the well-tested SMAA shaders and lookup textures from `three-stdlib`
 * and drives the three sub-passes (edge detection, blend-weight calculation,
 * neighbourhood blending) through the pipeline's {@link FullscreenRenderer},
 * compositing the result back into the shared buffer in place.
 *
 * @group Rendering
 * @see {@link RenderingPipeline}
 * @see {@link FxaaPass}
 * @see {@link TAAPass}
 */
export class SMAAPass extends Pass {
  private inner: StdlibSMAAPass;
  private scratch: WebGLRenderTarget;
  private blitMaterial: RawShaderMaterial;
  private fullscreenRenderer = new FullscreenRenderer();

  private materialEdges: ShaderMaterial;
  private materialWeights: ShaderMaterial;
  private materialBlend: ShaderMaterial;

  constructor() {
    super();
    // three-stdlib's SMAAPass builds the edge/weight render targets, the three
    // sub-pass materials and (asynchronously, from embedded base64 PNGs) the
    // area + search lookup textures. We reuse those resources but drive the draws
    // ourselves so the pass conforms to this pipeline's single-buffer contract.
    this.inner = new StdlibSMAAPass(1, 1);
    this.materialEdges = this.inner.materialEdges as ShaderMaterial;
    this.materialWeights = this.inner.materialWeights as ShaderMaterial;
    this.materialBlend = this.inner.materialBlend as ShaderMaterial;

    this.scratch = new WebGLRenderTarget(1, 1, {
      format: RGBAFormat,
      type: HalfFloatType,
      depthBuffer: false,
      generateMipmaps: false,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      wrapS: ClampToEdgeWrapping,
      wrapT: ClampToEdgeWrapping,
      samples: 0,
    });

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
    });
  }

  setSize(width: number, height: number) {
    const w = Math.max(1, Math.floor(width));
    const h = Math.max(1, Math.floor(height));
    this.inner.setSize(w, h);
    this.scratch.setSize(w, h);
  }

  dispose() {
    this.inner.dispose();
    this.scratch.dispose();
    this.blitMaterial.dispose();
    this.fullscreenRenderer.dispose();
  }

  render(renderer: WebGLRenderer, buffer: WebGLRenderTarget) {
    // The edge-detection and blend-weight sub-passes use `discard` for non-edge
    // pixels, so they only write where edges are found. The pipeline runs with
    // renderer.autoClear = false, and this wrapper drives the draws itself (it
    // does not use three-stdlib's internal clears), so edgesRT/weightsRT would
    // otherwise retain results from previous frames. While the camera is still
    // that stale data matches the current frame (SMAA appears to work), but once
    // the camera moves the leftover edges/weights no longer correspond to the
    // scene and the anti-aliasing breaks. Clear both targets every frame.
    const prevClearColor = new Color();
    renderer.getClearColor(prevClearColor);
    const prevClearAlpha = renderer.getClearAlpha();
    renderer.setClearColor(BLACK, 0);

    // 1) Edge detection: buffer colour -> edges RT.
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

    // 3) Neighbourhood blending: weights RT (tDiffuse) + buffer colour (tColor)
    // -> scratch. Can't read and write the buffer at once, so resolve to scratch.
    (this.materialBlend.uniforms.tColor.value as Texture | null) =
      buffer.texture;
    this.fullscreenRenderer.renderMaterial(
      renderer,
      this.scratch,
      this.materialBlend,
    );

    // 4) Copy the anti-aliased result back into the shared buffer in place.
    (this.blitMaterial.uniforms.source.value as Texture | null) =
      this.scratch.texture;
    this.fullscreenRenderer.renderMaterial(renderer, buffer, this.blitMaterial);

    renderer.setClearColor(prevClearColor, prevClearAlpha);
  }

  /** Resolution uniform helper kept for parity with other passes. */
  get resolution(): Vector2 {
    return this.materialEdges.uniforms.resolution.value as Vector2;
  }
}
