import {
  Camera,
  DataTexture,
  FloatType,
  GLSL3,
  Matrix4,
  NearestFilter,
  NoColorSpace,
  PerspectiveCamera,
  RedFormat,
  RGBAFormat,
  ShaderMaterial,
  Texture,
  Uniform,
  UnsignedByteType,
  Vector2,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import fragmentShader from '../components/Annotations/shaders/annotations-frag.glsl';
import vertexShader from '../components/Annotations/shaders/annotations-vert.glsl';
import { FullscreenRenderer } from './fullscreen-renderer';

/** An anchor's bits in {@link AnchorOcclusion.test}'s result: hidden behind the scene. */
export const ANCHOR_OCCLUDED = 0b01;
/** An anchor's bits in {@link AnchorOcclusion.test}'s result: inside the view. */
export const ANCHOR_IN_VIEW = 0b10;

/**
 * Whether points in the world (anchors) are hidden behind the scene, tested on the GPU
 * against a depth texture and read back asynchronously, one byte per anchor
 * ({@link ANCHOR_OCCLUDED}, {@link ANCHOR_IN_VIEW}). An anchor is moved its own radius
 * toward the camera first, so what it sits on does not hide it, and is taken as occluded
 * only where every depth texel about it occludes it, so a jittered depth does not make it
 * flicker. One test runs at a time: the result lags the view by a frame or two. Used by
 * the annotations' and the labels' passes.
 */
export class AnchorOcclusion {
  /** the anchors the last {@link setAnchors} gave */
  count = 0;
  /** a test is in flight */
  busy = false;
  private size = 100;
  private target: WebGLRenderTarget;
  private buffer: Uint8Array;
  private material: ShaderMaterial;
  private fullscreen = new FullscreenRenderer();

  constructor(camera: Camera) {
    this.target = new WebGLRenderTarget(this.size, 1, {
      depthBuffer: false,
      stencilBuffer: false,
      format: RedFormat,
      type: UnsignedByteType,
      magFilter: NearestFilter,
      minFilter: NearestFilter,
      samples: 0,
      colorSpace: NoColorSpace,
      generateMipmaps: false,
    });
    this.buffer = new Uint8Array(this.size);
    const perspective = camera as PerspectiveCamera;
    this.material = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        cameraPosition: new Uniform<Vector3>(new Vector3()),
        vMatrix: new Uniform<Matrix4>(new Matrix4()),
        pMatrix: new Uniform<Matrix4>(new Matrix4()),
        depthTexture: new Uniform<Texture | null>(null),
        dataTexture: new Uniform<Texture | null>(null),
        logDepthBufFC: new Uniform<number>(
          2.0 / (Math.log(perspective.far + 1.0) / Math.LN2),
        ),
        resolution: new Uniform<Vector2>(new Vector2()),
      },
      glslVersion: GLSL3,
    });
  }

  /**
   * The anchors to test: `count` of them in `data`, each its world position and its
   * radius (x, y, z, r). None leaves the last ones in place.
   */
  setAnchors(data: Float32Array, count: number) {
    if (!count) return;
    const uniform = this.material.uniforms.dataTexture;
    let texture: DataTexture | undefined = uniform.value ?? undefined;
    if (count !== this.size) {
      this.target.setSize(count, 1, 0);
      this.buffer = new Uint8Array(count * 2);
      this.size = count;
      texture?.dispose();
      texture = undefined;
    }
    if (uniform.value) uniform.value.dispose();
    if (!texture) {
      texture = new DataTexture(data, count, 1, RGBAFormat, FloatType);
    } else {
      texture.image.data = data;
    }
    texture.needsUpdate = true;
    uniform.value = texture;
    this.count = count;
  }

  /**
   * Test the anchors against `depthTexture` (`width` x `height`), seen by `camera`: the
   * bytes per anchor, in their order, once read back; null while a test is in flight or
   * there are none.
   */
  test(
    renderer: WebGLRenderer,
    camera: Camera,
    depthTexture: Texture,
    width: number,
    height: number,
  ): Promise<Uint8Array> | null {
    if (this.busy || !this.count) return null;
    this.busy = true;
    const { uniforms } = this.material;
    uniforms.cameraPosition.value.copy(camera.position);
    uniforms.depthTexture.value = depthTexture;
    uniforms.pMatrix.value = camera.projectionMatrix;
    uniforms.vMatrix.value = camera.matrixWorldInverse;
    uniforms.resolution.value.set(width, height);
    this.fullscreen.renderMaterial(renderer, this.target, this.material);
    return renderer
      .readRenderTargetPixelsAsync(this.target, 0, 0, this.size, 1, this.buffer)
      .then(read => read as Uint8Array)
      .finally(() => {
        this.busy = false;
      });
  }

  dispose() {
    this.material.uniforms.dataTexture.value?.dispose();
    this.material.dispose();
    this.target.dispose();
    this.fullscreen.dispose();
  }
}
