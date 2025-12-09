import {
  DoubleSide,
  InstancedMesh,
  MeshDepthMaterial,
  PerspectiveCamera,
  RGBADepthPacking,
  RGBAFormat,
  Scene,
  SRGBColorSpace,
  UnsignedByteType,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three'
import { LAYERS } from '../../../layers/layers'
import { Vec2, Vec3 } from '../../../sdk'
import { unpackRGBAToDepth } from '../../../sdk/utils/packing'
import { Emitter, ObjectMap, ObjectMapEntry } from './EventEmitter'

const v = new Vector3()

const depthMaterial = new MeshDepthMaterial({
  depthPacking: RGBADepthPacking,
  precision: 'highp',
  side: DoubleSide,
})

const defaults = {
  radius: 3,
}

const screenToNormalizedDevice = (pos: Vec2, width = 1, height = 1): Vec2 => [
  (pos[0] / width) * 2 - 1,
  -(pos[1] / height) * 2 + 1,
]

const normalizedDeviceToScreen = (pos: Vec2, width = 1, height = 1): Vec2 => [
  ((pos[0] + 1) / 2) * width,
  ((1 - pos[1]) / 2) * height,
]

export type PickResult =
  | {
      id: number
      offset: Vec2 | null
      match: ObjectMapEntry | null
      position: Vec3 | null
    }
  | false

/**
 * Used internally by the `EventEmitter` component
 * @internal
 */
export class PickingHelper {
  private _size: number
  private _radius: number
  private _renderTarget: WebGLRenderTarget
  private _renderTargetDepth: WebGLRenderTarget
  private _pixelBuffer: Uint8Array
  private _pixelDepthBuffer: Uint8Array
  private _currentId: number = 0

  constructor(options = {}) {
    const { radius } = { ...defaults, ...options }
    this._radius = Math.max(Math.min(10, radius), 0)
    this._size = 2 * this._radius + 1

    this._renderTarget = new WebGLRenderTarget(this._size, this._size, {
      colorSpace: SRGBColorSpace,
      format: RGBAFormat,
      type: UnsignedByteType,
      generateMipmaps: false,
      stencilBuffer: false,
    })

    this._renderTargetDepth = new WebGLRenderTarget(this._size, this._size, {
      type: UnsignedByteType,
    })

    this._pixelBuffer = new Uint8Array(4 * this._size ** 2)
    this._pixelDepthBuffer = new Uint8Array(4)
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

    const w = renderer.domElement.clientWidth //getContext().drawingBufferWidth
    const h = renderer.domElement.clientHeight //getContext().drawingBufferHeight

    const screen = normalizedDeviceToScreen(point, w, h)

    const x = screen[0] - this._radius
    const y = screen[1] - this._radius

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

    // set the view offset to represent just the patch we need to render under the mouse
    camera.setViewOffset(w, h, x, y, this._size, this._size)

    const prevLayers = camera.layers.mask
    camera.layers.disableAll()
    camera.layers.set(LAYERS.EMITTER)

    renderer.setRenderTarget(this._renderTarget)
    renderer.clear()
    renderer.render(scene, camera)

    // render depth
    scene.overrideMaterial = depthMaterial
    renderer.setRenderTarget(this._renderTargetDepth)
    renderer.clear()
    renderer.render(scene, camera)
    scene.overrideMaterial = null

    // clear the view offset so rendering returns to normal
    renderer.setRenderTarget(null)
    camera.clearViewOffset()
    camera.layers.mask = prevLayers

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

    // read the pixel
    await renderer.readRenderTargetPixelsAsync(
      this._renderTarget,
      0, // x
      0, // y
      this._size, // width
      this._size, // height
      this._pixelBuffer
    )

    // cancel if a new request has been issued while waiting for readback
    if (!force && id !== this._currentId) return false

    let match: {
      mapEntry: ObjectMapEntry
      lsqr: number
      x: number
      y: number
      i: number
    } | null = null
    let i = 0

    // Find closest match if any
    for (let r = this._size - 1; r >= 0; r--) {
      for (let c = 0; c < this._size; c++, i += 4) {
        if (this._pixelBuffer[i + 3] === 255) {
          // there is a pixel value if the alpha is 255
          const objId =
            (this._pixelBuffer[i] << 16) |
            (this._pixelBuffer[i + 1] << 8) |
            this._pixelBuffer[i + 2]

          const mapEntry = objectMap.map.get(objId)

          if (mapEntry) {
            const { threshold } = mapEntry.emitter
            const ox = c - this._radius
            const oy = r - this._radius
            const lsqr = ox ** 2 + oy ** 2 - threshold ** 2

            if (!match || match.lsqr > lsqr) {
              match = { mapEntry, lsqr, x: ox, y: oy, i }
            }
          }
        }
      }
    }

    const result: PickResult = {
      id,
      offset: null,
      match: null,
      position: null,
    }

    if (match) {
      result.match = match.mapEntry

      const ndc = screenToNormalizedDevice(
        [screen[0] + match.x, screen[1] + match.y],
        w,
        h
      )

      result.offset = [point[0] - ndc[0], point[1] - ndc[1]]

      // read the pixel
      await renderer.readRenderTargetPixelsAsync(
        this._renderTargetDepth,
        this._radius + match.x, // x
        this._radius - match.y, // y
        1, // width
        1, // height
        this._pixelDepthBuffer
      )

      // cancel if a new request has been issued while waiting for readback
      if (!force && id !== this._currentId) return false

      const ndcZ =
        unpackRGBAToDepth(
          this._pixelDepthBuffer[0],
          this._pixelDepthBuffer[1],
          this._pixelDepthBuffer[2],
          this._pixelDepthBuffer[3]
        ) *
          2 -
        1

      v.set(ndc[0], ndc[1], ndcZ)
      v.unproject(camera)

      result.position = v.toArray() as Vec3
    }
    return result
  }

  dispose() {
    this._renderTarget.dispose()
  }
}
