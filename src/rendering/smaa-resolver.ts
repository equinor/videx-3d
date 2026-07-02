import {
  ClampToEdgeWrapping,
  Color,
  HalfFloatType,
  LinearFilter,
  MeshBasicMaterial,
  NoBlending,
  RawShaderMaterial,
  RGBAFormat,
  ShaderMaterial,
  SRGBColorSpace,
  Texture,
  UnsignedByteType,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import { SMAAPass as StdlibSMAAPass } from 'three-stdlib';
import { FullscreenRenderer } from './fullscreen-renderer';
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
 * Subpixel Morphological Anti-Aliasing (SMAA) resolver, used internally by
 * {@link OITRenderPass} when its `antialias` mode is `'smaa'` or `'temporal-smaa'`.
 * It detects edges by colour discontinuity and reconstructs anti-aliased
 * silhouettes using precomputed area/search lookup tables, giving clean long edges
 * with little detail blurring.
 *
 * It operates in linear space (the OIT buffer is linear FP16) but detects edges on
 * an sRGB-encoded copy so the perceptual thresholds behave as intended; the blend
 * and output stay linear, so brightness is untouched.
 *
 * This wraps the well-tested SMAA shaders and lookup textures from `three-stdlib`
 * and drives the three sub-passes (edge detection, blend-weight calculation,
 * neighbourhood blending) through a {@link FullscreenRenderer}, compositing the
 * result back into the shared buffer in place.
 *
 * Like all morphological techniques it cannot recover sub-pixel features (e.g. 1px
 * WebGL lines that fall between samples) — those are handled by the temporal
 * supersampling mode while the camera is still.
 */
export class SmaaResolver {
  private inner: StdlibSMAAPass;
  private scratch: WebGLRenderTarget;
  private encoded: WebGLRenderTarget;
  private encodeMaterial: MeshBasicMaterial;
  private blitMaterial: RawShaderMaterial;
  private fullscreenRenderer = new FullscreenRenderer();

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
    // ourselves so the resolver can composite in place into OIT's single buffer.
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

    // sRGB-encoded copy of the buffer used ONLY as the edge-detection input. The
    // SMAA edge thresholds are tuned for perceptual (sRGB) contrast; detecting on
    // the raw linear FP16 buffer misses low-contrast edges. An 8-bit byte target is
    // required because three only applies the sRGB OETF when the destination is a
    // byte target. Blend/output stay in the linear buffer, so brightness is
    // untouched and the OutputPass still does the single final encode.
    this.encoded = new WebGLRenderTarget(1, 1, {
      format: RGBAFormat,
      type: UnsignedByteType,
      depthBuffer: false,
      generateMipmaps: false,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      wrapS: ClampToEdgeWrapping,
      wrapT: ClampToEdgeWrapping,
      samples: 0,
    });
    this.encoded.texture.colorSpace = SRGBColorSpace;
    this.encodeMaterial = new MeshBasicMaterial({
      depthTest: false,
      depthWrite: false,
      toneMapped: true,
      blending: NoBlending,
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
    const w = Math.max(1, Math.floor(width));
    const h = Math.max(1, Math.floor(height));
    this.inner.setSize(w, h);
    this.scratch.setSize(w, h);
    this.encoded.setSize(w, h);
  }

  dispose() {
    this.inner.dispose();
    this.scratch.dispose();
    this.encoded.dispose();
    this.encodeMaterial.dispose();
    this.blitMaterial.dispose();
    this.fullscreenRenderer.dispose();
  }

  render(renderer: WebGLRenderer, buffer: WebGLRenderTarget) {
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

    // 0) Encode an sRGB copy of the linear buffer for edge detection only. SMAA's
    // contrast thresholds are tuned for perceptual space; running them on the raw
    // linear FP16 buffer misses low-contrast edges (e.g. transparent-over-opaque
    // silhouettes). The byte target makes three apply the sRGB OETF. The buffer
    // itself is left linear, so brightness/output encoding are unaffected.
    this.encodeMaterial.map = buffer.texture;
    this.fullscreenRenderer.renderMaterial(
      renderer,
      this.encoded,
      this.encodeMaterial,
    );

    // 1) Edge detection: encoded (sRGB) colour -> edges RT.
    (this.materialEdges.uniforms.tDiffuse.value as Texture | null) =
      this.encoded.texture;
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
    // (tColor) -> scratch. Blending stays in linear space so the result is
    // unchanged in brightness; only the edge mask came from the sRGB copy. Can't
    // read and write the buffer at once, so resolve to scratch.
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
}
