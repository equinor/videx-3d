import {
  DepthTexture,
  InstancedMesh,
  Mesh,
  OrthographicCamera,
  PerspectiveCamera,
  PlaneGeometry,
  RGBAFormat,
  Scene,
  SRGBColorSpace,
  UnsignedByteType,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three'
import { LAYERS } from '../../../layers/layers'
import {
  DepthReadMaterial,
  normalizedDeviceToScreen,
  screenToNormalizedDevice,
  Vec2,
  Vec3,
} from '../../../sdk'
import { unpackRGBAToDepth } from '../../../sdk/utils/packing'
import { Emitter, ObjectMapEntry } from './EventEmitter'

const v = new Vector3()
const defaults = {
  radius: 3,
}

export type PickResult =
  | {
      match: ObjectMapEntry | null
      position: Vec3 | null
      point: Vec2
      offset: Vec2 | null
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
  private _depthTexture: DepthTexture
  private _renderTargetDepth: WebGLRenderTarget
  private _pixelBuffer: Uint8Array
  private _pixelDepthBuffer: Uint8Array
  private _postCamera: OrthographicCamera
  private _postMaterial: DepthReadMaterial
  private _postScene: Scene
  private _postPlane: PlaneGeometry
  private _postQuad: Mesh
  private _renderState = {
    screen: [0, 0] as Vec2,
    point: [0, 0] as Vec2,
    w: 0,
    h: 0,
  }

  constructor(options = {}) {
    const { radius } = { ...defaults, ...options }
    this._radius = Math.max(Math.min(10, radius), 0)
    this._size = 2 * this._radius + 1

    this._depthTexture = new DepthTexture(this._size, this._size)

    this._renderTarget = new WebGLRenderTarget(this._size, this._size, {
      colorSpace: SRGBColorSpace,
      format: RGBAFormat,
      type: UnsignedByteType,
      generateMipmaps: false,
      stencilBuffer: false,
      depthBuffer: true,
      depthTexture: this._depthTexture,
    })

    this._renderTargetDepth = new WebGLRenderTarget(this._size, this._size, {
      type: UnsignedByteType,
      format: RGBAFormat,
      depthBuffer: false,
      stencilBuffer: false,
    })
    const bufferSize = 4 * this._size * this._size
    this._pixelBuffer = new Uint8Array(bufferSize)
    this._pixelDepthBuffer = new Uint8Array(bufferSize)

    this._postCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1)
    this._postMaterial = new DepthReadMaterial()

    this._postScene = new Scene()
    this._postScene.matrixAutoUpdate = false
    this._postPlane = new PlaneGeometry(2, 2)
    this._postQuad = new Mesh(this._postPlane, this._postMaterial)

    this._postScene.add(this._postQuad)

    this._postMaterial.uniforms.depthTexture.value = this._depthTexture
  }

  render(
    point: Vec2,
    renderer: WebGLRenderer,
    scene: Scene,
    camera: PerspectiveCamera,
    emitters: Map<number, Emitter>
  ) {
    const w = renderer.domElement.clientWidth //getContext().drawingBufferWidth
    const h = renderer.domElement.clientHeight //getContext().drawingBufferHeight

    const screen = normalizedDeviceToScreen(point, w, h)

    const x = screen[0] - this._radius
    const y = screen[1] - this._radius

    this._renderState.w = w
    this._renderState.h = h
    this._renderState.point = point
    this._renderState.screen = screen

    emitters.forEach((emitter) => {
      if (emitter.source && emitter.source.visible) {
        const sourceMaterial = emitter.source.material
        emitter.source.material = emitter.material
        emitter.sourceMaterial = sourceMaterial
      }

      if (emitter.instanced) {
        const instanced = emitter.source as InstancedMesh
        const sourceAttribute = instanced.instanceColor
        instanced.instanceColor = emitter.instanceColor!
        emitter.sourceInstanceColor = sourceAttribute || undefined
      }
    })

    const prevSortObjects = renderer.sortObjects
    const prevmatrixAutoUpdate = scene.matrixAutoUpdate

    renderer.sortObjects = false
    scene.matrixAutoUpdate = false

    // set the view offset to represent just the patch we need to render under the mouse
    camera.setViewOffset(w, h, x, y, this._size, this._size)

    const prevLayers = camera.layers.mask
    camera.layers.disableAll()
    camera.layers.set(LAYERS.EMITTER)
    //console.timeEnd('pick setup')
    //console.time('render')
    renderer.setRenderTarget(this._renderTarget)
    renderer.clear()
    renderer.render(scene, camera)

    // clear the view offset so rendering returns to normal
    camera.clearViewOffset()
    camera.layers.mask = prevLayers

    this._postMaterial.uniforms.cameraNear.value = camera.near
    this._postMaterial.uniforms.cameraFar.value = camera.far

    renderer.setRenderTarget(this._renderTargetDepth)

    renderer.clear()
    renderer.render(this._postScene, this._postCamera)

    renderer.readRenderTargetPixelsAsync(
      this._renderTarget,
      0, // x
      0, // y
      this._size, // width
      this._size, // height
      this._pixelBuffer
    )

    renderer.setRenderTarget(null)

    renderer.readRenderTargetPixelsAsync(
      this._renderTargetDepth,
      0, // x
      0, // y
      this._size, // width
      this._size, // height
      this._pixelDepthBuffer
    )
    renderer.sortObjects = prevSortObjects
    scene.matrixAutoUpdate = prevmatrixAutoUpdate

    // set original material to emitter object
    emitters.forEach((emitter) => {
      if (emitter.source && emitter.sourceMaterial) {
        const sourceMaterial = emitter.sourceMaterial
        emitter.sourceMaterial = undefined
        emitter.source.material = sourceMaterial
      }

      if (emitter.instanced) {
        const instanced = emitter.source as InstancedMesh
        instanced.instanceColor = emitter.sourceInstanceColor || null
        emitter.sourceInstanceColor = undefined
      }
    })
  }

  pick(
    camera: PerspectiveCamera,
    objectMap: Map<number, ObjectMapEntry>
  ): PickResult {
    const { w, h, point, screen } = this._renderState

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

          const mapEntry = objectMap.get(objId)

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
      offset: null,
      match: null,
      position: null,
      point,
    }

    if (match) {
      result.match = match.mapEntry

      const ndc = screenToNormalizedDevice(
        [screen[0] + match.x, screen[1] + match.y],
        w,
        h
      )

      result.offset = [point[0] - ndc[0], point[1] - ndc[1]]

      const ndcZ =
        unpackRGBAToDepth(
          this._pixelDepthBuffer[match.i],
          this._pixelDepthBuffer[match.i + 1],
          this._pixelDepthBuffer[match.i + 2],
          this._pixelDepthBuffer[match.i + 3]
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
    this._renderTargetDepth.dispose()
    this._depthTexture.dispose()
  }
}
