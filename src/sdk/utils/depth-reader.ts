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
} from "three"
import { DepthReadMaterial } from '../materials/depth-material'
import { Vec4 } from '../types/common'

const unpackScale = 255 / 256
const unpackFactors = new Float32Array([
  unpackScale,
  unpackScale / 256,
  unpackScale / (256 ** 2),
  unpackScale / (256 ** 3),
])

function unpackRGBAToDepth(packedDepth: Vec4) {
  return (
    (packedDepth[0] / 255) * unpackFactors[0] +
    (packedDepth[1] / 255) * unpackFactors[1] +
    (packedDepth[2] / 255) * unpackFactors[2] +
    (packedDepth[3] / 255) * unpackFactors[3]
  );
}

const postCamera = new OrthographicCamera(- 1, 1, 1, - 1, 0, 1);
const postMaterial = new DepthReadMaterial()

const postScene = new Scene();
const postPlane = new PlaneGeometry(2, 2);
const postQuad = new Mesh(postPlane, postMaterial);

let renderTarget: WebGLRenderTarget | null = null
let pixelBuffer: Uint8Array | null = null

postScene.add(postQuad);

/**
 * Read-back the normalized device coordinates from a depth texture
 */
export async function readDepth(depthTexture: Texture, renderer: WebGLRenderer, camera: PerspectiveCamera, idx?: number) {
  if (!depthTexture) return null;
 
  try {
    const { width, height } = depthTexture.image;

    if (
      !renderTarget ||
      !pixelBuffer ||
      renderTarget.width !== width ||
      renderTarget.height !== height
    ) {
      renderTarget?.dispose()
      pixelBuffer = new Uint8Array(4 * width * height)
      renderTarget = new WebGLRenderTarget(width, height, {
        type: UnsignedByteType,
        format: RGBAFormat,
        depthBuffer: false,
        stencilBuffer: false,
      })
    }

    postMaterial.uniforms.depthTexture.value = depthTexture;
    postMaterial.uniforms.cameraNear.value = camera.near;
    postMaterial.uniforms.cameraFar.value = camera.far;
    postMaterial.uniforms.cameraWasPerspective.value = camera.isPerspectiveCamera;

    renderer.setRenderTarget(renderTarget);
    renderer.clear()
    renderer.render(postScene, postCamera);
    renderer.setRenderTarget(null);

    await renderer.readRenderTargetPixelsAsync(
      renderTarget,
      0,  // x
      0,  // y  
      width,
      height,
      pixelBuffer,
    );

    if (idx !== undefined && Number.isFinite(idx)) {
      const pixelDepth: Vec4 = [
        pixelBuffer[idx],
        pixelBuffer[idx + 1],
        pixelBuffer[idx + 2],
        pixelBuffer[idx + 3],
      ];
      //console.log(Array.from(pixelBuffer))
      const depth = unpackRGBAToDepth(pixelDepth)
      const ndcZ = depth * 2 - 1; // normalized device coordinates

      return ndcZ;
    } else {
      const ndcZs: number[] = new Array(pixelBuffer.length / 4);
      for (let i = 0; i < ndcZs.length; i++) {
        const j = i * 4;
        const pixelDepth: Vec4 = [
          pixelBuffer[j],
          pixelBuffer[j + 1],
          pixelBuffer[j + 2],
          pixelBuffer[j + 3],
        ];
        ndcZs[i] = unpackRGBAToDepth(pixelDepth) * 2 - 1; // normalized device coordinates
      }
      return ndcZs;
    }

  } catch (err) {
    console.error(err);
    return null;
  }
}
