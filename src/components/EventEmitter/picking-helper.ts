import {
  FloatType,
  InstancedMesh,
  NearestFilter,
  NoColorSpace,
  Object3D,
  PerspectiveCamera,
  RGBAFormat,
  Scene,
  Vector2,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three'
import { LAYERS } from '../../layers/layers'
import { normalizedDeviceToScreen, Vec2, Vec3 } from '../../sdk'
import { Emitter, Listener } from './EventEmitterContext'
import { PickingMaterial } from './picking-material'

const defaults = {
  radius: 3,
}

export type PickedObject = {
  emitter: Emitter
  index: number
}

export type PickResult = {
  match: PickedObject | null
  position: Vec3
  point: Vec2
}

/**
 * Used internally by the `EventEmitter` component
 * @internal
 */
export class PickingHelper {
  private _size: number
  private _radius: number
  private _pbo: WebGLRenderTarget
  private _buffer: Float32Array

  private _material = new PickingMaterial()

  constructor(options = {}) {
    const { radius } = { ...defaults, ...options }
    this._radius = Math.max(Math.min(10, radius), 0)
    this._size = 2 * this._radius + 1

    this._pbo = new WebGLRenderTarget(this._size, this._size, {
      colorSpace: NoColorSpace,
      samples: 0,
      format: RGBAFormat,
      type: FloatType,
      magFilter: NearestFilter,
      minFilter: NearestFilter,
      depthBuffer: true,
      stencilBuffer: false,
      generateMipmaps: false,
    })

    this._buffer = new Float32Array(this._size * this._size * 4)
  }

  private traverseObject = (
    object: Object3D,
    rootId: number,
    depth: number,
    threshold?: number,
  ) => {
    if (object.visible && !object.layers.isEnabled(LAYERS.NOT_EMITTER)) {
      if (
        object.type === 'Mesh' ||
        object.type === 'Line' ||
        object.type === 'Points'
      ) {
        const instanced = !!(object as InstancedMesh).isInstancedMesh
        const instanceCount = instanced ? (object as InstancedMesh).count : 1
        const emitterThreshold: number = Number.isFinite(threshold)
          ? threshold!
          : object.type === 'Mesh'
            ? 0
            : 3

        if (instanceCount > 0) {
          let emitter = this._material.emitters.get(object.id)

          if (!emitter) {
            emitter = {
              source: object,
              depth,
              listener: rootId,
              threshold: emitterThreshold,
              instanced,
              instanceCount,
            }
            this._material.emitters.set(object.id, emitter)
          } else {
            // The emitter may already be added in a previous update, but we should still
            // update its references, in case an object id is re-used by three js for another object
            emitter.source = object
            emitter.threshold = emitterThreshold
            emitter.instanced = instanced
            emitter.instanceCount = instanceCount

            // if this object is reachable from more than one listener, we need to set the
            // listener to the one closest to the object, i.e. the one with the lesser depth value
            if (depth < emitter.depth) {
              emitter.depth = depth
              emitter.listener = rootId
            }
          }
          object.layers.enable(LAYERS.EMITTER)
        } else {
          object.layers.disable(LAYERS.EMITTER)
        }
      }

      for (let i = 0; i < object.children.length; i++) {
        this.traverseObject(object.children[i], rootId, depth + 1, threshold)
      }
    }
  }

  updateListeners = () => {
    this._material.listeners.forEach((listener) => {
      this.traverseObject(
        listener.object,
        listener.object.id,
        0,
        listener.threshold,
      )
    })
  }

  addListener = (listener: Listener) => {
    this._material.listeners.set(listener.object.id, listener)
  }

  getListener = (id: number) => {
    return this._material.listeners.get(id)
  }

  removeListener = (id: number) => {
    const listener = this._material.listeners.get(id)
    if (listener) {
      const { object } = listener
      // remove listener and associated emitters
      this._material.listeners.delete(id)
      object.traverse((obj) => {
        obj.layers.disable(LAYERS.EMITTER)
        this._material.emitters.delete(obj.id)
      })
    }
  }

  async render(
    pointer: Vector2,
    renderer: WebGLRenderer,
    scene: Scene,
    camera: PerspectiveCamera,
  ) {
    const width = renderer.domElement.clientWidth
    const height = renderer.domElement.clientHeight
    const point = pointer.toArray()
    const screen = normalizedDeviceToScreen(point, width, height)

    const x = screen[0] - this._radius
    const y = screen[1] - this._radius

    const prevLayers = camera.layers.mask
    const prevSceneBackground = scene.background
    const prevClearColor = renderer.clearColor
    const prevClearAlpha = renderer.getClearAlpha()
    scene.background = null
    scene.overrideMaterial = this._material

    // set the view offset to represent just the patch we need to render under the mouse
    camera.setViewOffset(width, height, x, y, this._size, this._size)

    camera.layers.disableAll()
    camera.layers.set(LAYERS.EMITTER)

    // create a mapping array of emitter instance id => emitter for this render pass
    const objectMap = new Array<number>()
    this._material.currentObjectMap = objectMap

    renderer.setRenderTarget(this._pbo)
    renderer.setClearColor(0x000000, 0)
    renderer.clear()
    renderer.render(scene, camera)

    // clear the view offset so rendering returns to normal
    camera.clearViewOffset()
    camera.layers.mask = prevLayers

    scene.background = prevSceneBackground

    this._material.currentObjectMap = null

    scene.overrideMaterial = null
    renderer.clearColor = prevClearColor
    renderer.setClearAlpha(prevClearAlpha)
    renderer.setRenderTarget(null)

    return renderer
      .readRenderTargetPixelsAsync(
        this._pbo,
        0, // x
        0, // y
        this._size, // width
        this._size, // height
        this._buffer,
      )
      .then((buffer) => this.pick(buffer as Float32Array, objectMap, point))
  }

  private pick(
    buffer: Float32Array,
    objectMap: Array<number>,
    point: Vec2,
  ): PickResult {
    const match: {
      object: PickedObject | null
      lsqr: number
      bufferIndex: number
    } = {
      object: null,
      lsqr: Infinity,
      bufferIndex: 0,
    }

    let i = 0
    let ox = 0
    let oy = 0
    let lsqr = 0
    let emitterId = 0
    let mapIndex = 0
    let objectId = 0
    let instanceIndex = 0
    let emitter: Emitter | undefined = undefined

    // Find closest match if any
    for (let r = this._size - 1; r >= 0; r--) {
      for (let c = 0; c < this._size; c++, i += 4) {
        emitterId = buffer[i] - 1
        if (emitterId >= 0 && emitterId < objectMap.length - 1) {
          mapIndex = emitterId * 2
          objectId = objectMap[mapIndex]
          instanceIndex = objectMap[mapIndex + 1]

          emitter = this._material.emitters.get(objectId)
          if (emitter) {
            ox = c - this._radius
            oy = r - this._radius
            lsqr = ox ** 2 + oy ** 2 - emitter.threshold ** 2

            if (!match.object || match.lsqr > lsqr) {
              match.object = {
                emitter,
                index: instanceIndex,
              }
              match.lsqr = lsqr
              match.bufferIndex = i
            }
          }
        }
      }
    }

    const result: PickResult = {
      match: match.object,
      point,
      position: [
        buffer[match.bufferIndex + 1],
        buffer[match.bufferIndex + 2],
        buffer[match.bufferIndex + 3],
      ],
    }

    return result
  }

  dispose() {
    this._pbo.dispose()
    const listeners = Array.from(this._material.listeners.values())
    this._material.dispose()
    listeners.forEach((listener) =>
      listener.object.traverse((obj) => obj.layers.disable(LAYERS.EMITTER)),
    )
  }
}
