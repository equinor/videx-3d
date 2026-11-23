import {
  Mesh,
  OrthographicCamera,
  PerspectiveCamera,
  PlaneGeometry,
  RGBAFormat,
  Scene,
  Texture,
  UnsignedByteType,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import { DepthReadMaterial } from '../materials/depth-material';
import { isReversedDepth } from './depth-buffer';
import { unpackRGBAToDepth } from './packing';

const postCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
const postMaterial = new DepthReadMaterial();

const postScene = new Scene();
const postPlane = new PlaneGeometry(2, 2);
const postQuad = new Mesh(postPlane, postMaterial);

let renderTarget: WebGLRenderTarget | null = null;
let pixelBuffer: Uint8Array | null = null;

postScene.add(postQuad);

/**
 * Read-back the normalized device coordinates from a depth texture: z as `camera`'s
 * projection has it, for `Vector3.unproject` (-1 to 1 from the near plane to the far one, or 1
 * to 0 with a reversed depth buffer).
 */
export async function readDepth(
  depthTexture: Texture,
  renderer: WebGLRenderer,
  camera: PerspectiveCamera,
  idx?: number,
) {
  if (!depthTexture) return null;

  try {
    const { width, height } = depthTexture;

    if (
      !renderTarget ||
      !pixelBuffer ||
      renderTarget.width !== width ||
      renderTarget.height !== height
    ) {
      renderTarget?.dispose();
      pixelBuffer = new Uint8Array(4 * width * height);
      renderTarget = new WebGLRenderTarget(width, height, {
        type: UnsignedByteType,
        format: RGBAFormat,
        depthBuffer: false,
        stencilBuffer: false,
      });
    }

    postMaterial.uniforms.depthTexture.value = depthTexture;
    postMaterial.uniforms.cameraNear.value = camera.near;
    postMaterial.uniforms.cameraFar.value = camera.far;
    postMaterial.uniforms.cameraWasPerspective.value =
      camera.isPerspectiveCamera;

    renderer.setRenderTarget(renderTarget);
    renderer.clear();
    renderer.render(postScene, postCamera);
    renderer.setRenderTarget(null);

    await renderer.readRenderTargetPixelsAsync(
      renderTarget,
      0, // x
      0, // y
      width,
      height,
      pixelBuffer,
    );

    // The material writes the linear (standard) depth, whatever the buffer.
    const reversed = isReversedDepth(camera);
    const toNdc = (depth: number) => (reversed ? 1 - depth : depth * 2 - 1);

    if (idx !== undefined && Number.isFinite(idx)) {
      //console.log(Array.from(pixelBuffer))
      const depth = unpackRGBAToDepth(
        pixelBuffer[idx],
        pixelBuffer[idx + 1],
        pixelBuffer[idx + 2],
        pixelBuffer[idx + 3],
      );
      return toNdc(depth);
    } else {
      const ndcZs: number[] = new Array(pixelBuffer.length / 4);
      for (let i = 0; i < ndcZs.length; i++) {
        const j = i * 4;
        ndcZs[i] = toNdc(
          unpackRGBAToDepth(
            pixelBuffer[j],
            pixelBuffer[j + 1],
            pixelBuffer[j + 2],
            pixelBuffer[j + 3],
          ),
        );
      }
      return ndcZs;
    }
  } catch (err) {
    console.error(err);
    return null;
  }
}
