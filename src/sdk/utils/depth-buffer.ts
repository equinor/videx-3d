import { Camera } from '@react-three/fiber'
import {
  MeshDepthMaterial,
  RGBADepthPacking,
  Scene,
  UnsignedByteType,
  WebGLRenderTarget,
  WebGLRenderer,
} from 'three'
import { LAYERS } from '../../layers/layers'

const depthMaterial = new MeshDepthMaterial({ depthPacking: RGBADepthPacking })

const unpackScale = 255 / 256
const unpackFactors = new Float32Array([
  unpackScale,
  unpackScale / 256,
  unpackScale / 256 ** 2,
  unpackScale / 256 ** 3,
])

function unpackRGBAToDepth(r: number, g: number, b: number, a: number) {
  return (
    (r / 255) * unpackFactors[0] +
    (g / 255) * unpackFactors[1] +
    (b / 255) * unpackFactors[2] +
    (a / 255) * unpackFactors[3]
  )
}

let renderTarget: WebGLRenderTarget | null = null
let pixelBuffer: Uint8Array | null = null
let ndcZs: Float32Array | null = null

/**
 * Generate a depth buffer and read-back values as normalized device coordinates (ndc)
 * for objects assigned to the occluder layer
 */
export async function getDepthBuffer(
  renderer: WebGLRenderer,
  scene: Scene,
  camera: Camera,
  width: number,
  height: number
) {
  const prevLayers = camera.layers.mask
  camera.layers.disableAll()
  camera.layers.set(LAYERS.OCCLUDER)

  if (
    !renderTarget ||
    renderTarget.width !== width ||
    renderTarget.height !== height
  ) {
    renderTarget?.dispose()
    pixelBuffer = new Uint8Array(4 * width * height)
    ndcZs = new Float32Array(width * height)
    renderTarget = new WebGLRenderTarget(width, height, {
      type: UnsignedByteType,
    })
  }

  renderer.setRenderTarget(renderTarget)
  scene.overrideMaterial = depthMaterial

  renderer.clear()

  renderer.render(scene, camera)

  scene.overrideMaterial = null

  renderer.setRenderTarget(null)
  camera.layers.mask = prevLayers

  await renderer.readRenderTargetPixelsAsync(
    renderTarget,
    0,
    0,
    width,
    height,
    pixelBuffer!
  )

  if (pixelBuffer && ndcZs) {
    for (let i = 0; i < ndcZs.length; i++) {
      const j = i * 4
      const depth =
        unpackRGBAToDepth(
          pixelBuffer[j],
          pixelBuffer[j + 1],
          pixelBuffer[j + 2],
          pixelBuffer[j + 3]
        )

        ndcZs[i] = depth * 2 - 1
    }
  }

  return ndcZs
}
