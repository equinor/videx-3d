import {
  DepthTexture,
  InstancedMesh,
  PerspectiveCamera,
  RGBAFormat,
  Scene,
  SRGBColorSpace,
  UnsignedByteType,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three'
import { LAYERS } from '../../../layers/layers'
import { readDepth, Vec2, Vec3 } from '../../../sdk'
import { Emitter, ObjectMap, ObjectMapEntry } from './EventEmitter'

const screenToNormalizedDevice = (pos: Vec2, width = 1, height = 1): Vec2 => [
  (pos[0] / width) * 2 - 1,
  -(pos[1] / height) * 2 + 1,
]

const normalizedDeviceToScreen = (pos: Vec2, width = 1, height = 1): Vec2 => [
  ((pos[0] + 1) / 2) * width,
  ((1 - pos[1]) / 2) * height,
]

const v = new Vector3()

// contains indices in prioritized order for searching the pixel buffer for hits, depending on threshold _size
const searchPatterns = [
  [0],
  [4, 3, 1, 5, 7, 0, 2, 6, 8],
  [
    12, 11, 7, 13, 17, 6, 8, 16, 18, 10, 2, 14, 22, 5, 1, 3, 9, 15, 21, 19, 23,
    0, 4, 20, 24,
  ],
  [
    24, 23, 17, 25, 31, 16, 18, 30, 32, 22, 10, 26, 38, 15, 9, 11, 19, 33, 39,
    37, 28, 8, 12, 40, 36, 21, 3, 27, 45, 28, 14, 2, 4, 20, 34, 46, 44, 7, 1, 5,
    13, 41, 47, 43, 35, 0, 6, 48, 42,
  ],
]

const defaults = {
  threshold: 2,
}

export type PickResult =
  | {
      match: ObjectMapEntry | null
      position: Promise<Vec3> | null
    }
  | false

/**
 * Used internally by the `EventEmitter` component
 * @internal
 */
export class PickingHelper {
  private _size: number
  private _threshold: number
  private _renderTarget: WebGLRenderTarget
  private _pixelBuffer: Uint8Array
  private _currentId: number = 0

  constructor(options = {}) {
    const { threshold } = { ...defaults, ...options }
    this._threshold = Math.max(Math.min(3, threshold), 0)
    this._size = 2 * this._threshold + 1

    const depthTexture = new DepthTexture(this._size, this._size)

    this._renderTarget = new WebGLRenderTarget(this._size, this._size, {
      colorSpace: SRGBColorSpace,
      format: RGBAFormat,
      type: UnsignedByteType,
      generateMipmaps: false,
      stencilBuffer: false,
      depthBuffer: true,
      depthTexture,
    })

    this._pixelBuffer = new Uint8Array(4 * this._size ** 2)
  }

  async pick(
    point: Vec2,
    renderer: WebGLRenderer,
    scene: Scene,
    camera: PerspectiveCamera,
    emitters: Map<number, Emitter>,
    objectMap: ObjectMap,
    force: boolean = true
  ): Promise<PickResult> {
    const id = (this._currentId + 1) % 10000
    this._currentId = id

    const { _renderTarget, _pixelBuffer, _threshold, _size } = this

    const w = renderer.getContext().drawingBufferWidth
    const h = renderer.getContext().drawingBufferHeight

    const screen = normalizedDeviceToScreen(point, w, h)

    const x = screen[0] - _threshold
    const y = screen[1] - _threshold

    //console.time('prepare emitters')
    emitters.forEach((emitter) => {
      const material = emitter.source.material
      emitter.source.material = emitter.material
      emitter.material = material
      if (emitter.instanced) {
        const instanced = emitter.source as InstancedMesh
        const colors = new Float32Array(instanced.instanceColor!.array)
        instanced.instanceColor!.set(emitter.instanceColor!)
        instanced.instanceColor!.needsUpdate = true
        emitter.instanceColor = colors
      }
    })
    //console.timeEnd('prepare emitters')
    // render picking scene to texture and depth texture
    //console.time('RENDER')
    // set the view offset to represent just the patch we need to render under the mouse
    camera.setViewOffset(w, h, x, y, _size, _size)

    const prevLayers = camera.layers.mask
    camera.layers.disableAll()
    camera.layers.set(LAYERS.EMITTER)

    renderer.setRenderTarget(_renderTarget)

    renderer.clear()
    renderer.render(scene, camera)
    renderer.setRenderTarget(null)

    // clear the view offset so rendering returns to normal
    camera.clearViewOffset()
    camera.layers.mask = prevLayers

    //console.timeEnd('RENDER')

    //console.time('restore emitters')
    // set original material to emitter object
    emitters.forEach((emitter) => {
      emitter.source.material = emitter.material
      if (emitter.instanced) {
        const instanced = emitter.source as InstancedMesh
        instanced.instanceColor!.set(emitter.instanceColor!)
        instanced.instanceColor!.needsUpdate = true
        emitter.instanceColor = undefined
      }
    })
    //console.timeEnd('restore emitters')

    //console.time('readRenderTargetPixels')
    // read the pixel

    await renderer.readRenderTargetPixelsAsync(
      _renderTarget,
      0, // x
      0, // y
      _size, // width
      _size, // height
      _pixelBuffer
    )

    // cancel if a new request has been issued while waiting for readback
    if (!force && id !== this._currentId) return false

    //console.timeEnd('readRenderTargetPixels')

    const pattern = searchPatterns[_threshold]

    const result: PickResult = {
      match: null,
      position: null,
    }

    //console.time('patternsearch')
    for (let i = 0; i < pattern.length; i++) {
      const searchPos = pattern[i]
      const idx = searchPos * 4
      const id =
        (_pixelBuffer[idx] << 16) |
        (_pixelBuffer[idx + 1] << 8) |
        _pixelBuffer[idx + 2]

      const mapEntry = objectMap.map.get(id)

      if (mapEntry) {
        result.match = mapEntry
        const offsetX = (searchPos % _size) - _threshold
        const offsetY = _threshold - ~~(searchPos / _size)
        //console.log(Array.from(_pixelBuffer))
        const ndc = screenToNormalizedDevice(
          [screen[0] + offsetX, screen[1] + offsetY],
          w,
          h
        )

        const positionPromise = readDepth(
          this._renderTarget.depthTexture!,
          renderer,
          camera,
          idx
        ).then((depth) => {
          const ndcZ = depth as number
          v.set(ndc[0], ndc[1], ndcZ)
          v.unproject(camera)
          return v.toArray() as Vec3
        })

        result.position = positionPromise

        break
      }
    }
    //console.timeEnd('patternsearch')

    return result
  }

  dispose() {
    this._renderTarget.dispose()
  }
}
