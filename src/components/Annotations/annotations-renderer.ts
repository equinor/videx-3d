import {
  Camera,
  CanvasTexture,
  createCanvasElement,
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
  Vector2,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three'
import { FullscreenRenderer } from '../../rendering/fullscreen-renderer'
import { mixVec2 } from '../../sdk'
import { useAnnotationsState } from './annotations-state'
import { AnnotationInstance } from './types'

import { UnsignedByteType } from 'three'
import fragmentShader from './shaders/annotations-frag.glsl'
import vertexShader from './shaders/annotations-vert.glsl'
import {
  postProcessInstances,
  preprocessInstances,
  updateInstanceDOMElements,
} from './update-annotations'

const size = new Vector2()
const TAU = Math.PI * 2
let x1: number, y1: number, x2: number, y2: number

export class AnnotationsRenderer {
  maxVisible: number
  camera: PerspectiveCamera
  pointer: Vector2
  ctx: CanvasRenderingContext2D
  overlayTexture: CanvasTexture | null = null
  annotationsTexSize: number = 100
  annotationsRenderTarget: WebGLRenderTarget
  annotationsBuffer: Uint8Array
  annotationsMaterial: ShaderMaterial
  fullscreenRenderer: FullscreenRenderer = new FullscreenRenderer()
  annotationsData: AnnotationInstance[] = []
  isBusy: boolean = false
  dataTextureNeedsUpdate = false
  unsubscribeListeners: () => void

  constructor(camera: Camera, pointer: Vector2, maxVisible: number = 100) {
    this.camera = camera as PerspectiveCamera
    this.pointer = pointer
    this.maxVisible = maxVisible

    const ctx = createCanvasElement().getContext('2d')
    if (!ctx) throw Error('Unable to create canvas drawing context!')
    this.ctx = ctx

    this.annotationsRenderTarget = new WebGLRenderTarget(
      this.annotationsTexSize,
      1,
      {
        depthBuffer: false,
        stencilBuffer: false,
        format: RedFormat,
        type: UnsignedByteType,
        magFilter: NearestFilter,
        minFilter: NearestFilter,
        samples: 0,
        colorSpace: NoColorSpace,
        generateMipmaps: false,
      },
    )

    this.annotationsBuffer = new Uint8Array(this.annotationsTexSize)

    const perspectiveCamera = camera as PerspectiveCamera
    const depthConstant =
      2.0 / (Math.log(perspectiveCamera.far + 1.0) / Math.LN2)
    const material = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        cameraPosition: new Uniform<Vector3>(new Vector3()),
        vMatrix: new Uniform<Matrix4>(new Matrix4()),
        pMatrix: new Uniform<Matrix4>(new Matrix4()),
        depthTexture: new Uniform<Texture | null>(null),
        dataTexture: new Uniform<Texture | null>(null),
        logDepthBufFC: new Uniform<number>(depthConstant),
      },
      glslVersion: GLSL3,
    })

    this.annotationsMaterial = material

    const unsubInstanceState = useAnnotationsState.subscribe(
      (state) => state.instances,
      (instances) => {
        this.annotationsData = instances
        this.dataTextureNeedsUpdate = true
      },
    )

    const onPositionChanged = () => {
      this.dataTextureNeedsUpdate = true
    }

    addEventListener('annotations-position-changed', onPositionChanged)

    this.unsubscribeListeners = () => {
      unsubInstanceState()
      removeEventListener('annotations-position-changed', onPositionChanged)
    }
  }

  updateAnnotationsData(buffer: Uint8Array) {
    const { annotationsData } = this

    annotationsData.forEach((instance, i) => {
      if (i < buffer.length) {
        const isOccluded = (buffer[i] & 0b01) == 1
        const isInViewSpace = (buffer[i] & 0b10) == 2

        instance.state.inViewSpace = isInViewSpace

        if (!instance.state.occluded && isOccluded) {
          instance.state.kill = true
        }
        instance.state.occluded = isOccluded
      }
    })
  }

  updateOverlayTexture(inViewSpace: AnnotationInstance[]) {
    const { ctx, pointer } = this

    if (
      this.overlayTexture === null ||
      this.overlayTexture.image.width !== size.x ||
      this.overlayTexture.image.height !== size.y
    ) {
      ctx.canvas.width = size.x
      ctx.canvas.height = size.y
      this.overlayTexture?.dispose()
      this.overlayTexture = new CanvasTexture(ctx.canvas)
    }

    const cursor = [
      (pointer.x * 0.5 + 0.5) * size.x,
      (-pointer.y * 0.5 + 0.5) * size.y,
    ]

    ctx.clearRect(0, 0, size.x, size.y)

    // draw overlay to canvas
    inViewSpace
      .filter((d) => !d.state.occluded && !d.state.capped)
      .sort((a, b) => b.state.distance - a.state.distance)
      .forEach((instance) => {
        x1 = (instance.state.screenPosition[0] * 0.5 + 0.5) * size.x
        y1 = (-instance.state.screenPosition[1] * 0.5 + 0.5) * size.y

        let radius = instance.layer.anchorSize * instance.state.scaleFactor!
        let anchorHovered = false
        // boost instance if not visible and cursor is over anchor point
        if (
          Math.abs(cursor[0] - x1) <= radius &&
          Math.abs(cursor[1] - y1) <= radius
        ) {
          if (instance.state.visible) {
            anchorHovered = true
          } else {
            instance.state.boost = true
          }
        }

        if (instance.state.labelHovered || anchorHovered) {
          radius *= 1.5
        }

        if (instance.layer.labelOffset > 0 && instance.state.visible) {
          // connector
          if (
            instance.state.inTransition &&
            instance.state.prevAnchorPosition
          ) {
            ;[x2, y2] = mixVec2(
              instance.state.prevAnchorPosition,
              instance.state.anchorPosition!,
              instance.state.transitionTime,
            )
          } else {
            ;[x2, y2] = instance.state.anchorPosition!
          }

          let strokeWidth = Math.max(
            0.1,
            instance.layer.connectorWidth * instance.state.scaleFactor!,
          )
          if (instance.state.labelHovered || anchorHovered) {
            strokeWidth *= 2
          }

          ctx.globalAlpha = instance.state.opacity || 0
          ctx.beginPath()
          ctx.moveTo(x1, y1)
          ctx.lineTo(x2, y2)

          ctx.strokeStyle = instance.layer.connectorColor
          ctx.lineWidth = strokeWidth
          ctx.stroke()
        }

        // anchorpoint
        ctx.beginPath()
        ctx.arc(x1, y1, radius, 0, TAU)

        ctx.globalAlpha = instance.state.visible ? 1 : 0.5
        ctx.fillStyle = instance.layer.anchorColor

        ctx.fill()

        ctx.globalAlpha = instance.state.opacity || 0
        ctx.strokeStyle = 'black'
        ctx.lineWidth = 0.75
        ctx.stroke()
      })

    this.overlayTexture.needsUpdate = true
  }

  updateDataTexture() {
    const instances = this.annotationsData
    let dataTexture: DataTexture | undefined =
      this.annotationsMaterial.uniforms.dataTexture.value

    if (instances.length) {
      const size = instances.length

      if (size !== this.annotationsTexSize) {
        this.annotationsRenderTarget.setSize(size, 1, 0)
        this.annotationsBuffer = new Uint8Array(size * 2)
        this.annotationsTexSize = size
        dataTexture?.dispose()
        dataTexture = undefined
      }

      const data = new Float32Array(size * 4)
      for (let i = 0, j = 0; i < instances.length; i++, j += 4) {
        const instance = instances[i]

        data[j] = instance.state.position[0]
        data[j + 1] = instance.state.position[1]
        data[j + 2] = instance.state.position[2]
        data[j + 3] = instance.layer.anchorOcclusionRadius
      }

      if (this.annotationsMaterial.uniforms.dataTexture.value) {
        this.annotationsMaterial.uniforms.dataTexture.value.dispose()
      }

      if (!dataTexture) {
        dataTexture = new DataTexture(data, size, 1, RGBAFormat, FloatType)
      } else {
        dataTexture.image.data = data
      }

      dataTexture.needsUpdate = true
      this.annotationsMaterial.uniforms.dataTexture.value = dataTexture
    }

    this.dataTextureNeedsUpdate = false
  }

  dispose() {
    this.unsubscribeListeners()
    this.annotationsMaterial.dispose()
    if (this.annotationsMaterial.uniforms.dataTexture.value) {
      this.annotationsMaterial.uniforms.dataTexture.value.dispose()
    }
    this.annotationsMaterial.dispose()
    this.annotationsRenderTarget.dispose()
  }

  render(
    renderer: WebGLRenderer,
    buffer: WebGLRenderTarget | null,
    elapsedTime: number,
  ) {
    renderer.getSize(size)

    const {
      camera,
      maxVisible,
      fullscreenRenderer,
      annotationsMaterial: occlusionMaterial,
      annotationsData: instances,
      isBusy,
    } = this

    if (buffer?.depthTexture && this.annotationsData.length && !isBusy) {
      if (this.dataTextureNeedsUpdate) {
        this.updateDataTexture()
      }
      this.isBusy = true
      occlusionMaterial.uniforms.cameraPosition.value.copy(camera.position)
      occlusionMaterial.uniforms.depthTexture.value = buffer.depthTexture
      occlusionMaterial.uniforms.pMatrix.value = camera.projectionMatrix
      occlusionMaterial.uniforms.vMatrix.value = camera.matrixWorldInverse
      this.fullscreenRenderer.renderMaterial(
        renderer,
        this.annotationsRenderTarget,
        this.annotationsMaterial,
      )
      renderer
        .readRenderTargetPixelsAsync(
          this.annotationsRenderTarget,
          0,
          0,
          this.annotationsTexSize,
          1,
          this.annotationsBuffer,
        )
        .then((buffer) => this.updateAnnotationsData(buffer as Uint8Array))
        .finally(() => {
          this.isBusy = false
        })
    }
    const visibleInstances = preprocessInstances(
      instances,
      camera,
      elapsedTime,
      maxVisible,
    )
    postProcessInstances(visibleInstances, [size.x, size.y])
    updateInstanceDOMElements(instances)

    this.updateOverlayTexture(visibleInstances)

    if (this.overlayTexture !== null) {
      fullscreenRenderer.renderTexture(renderer, buffer, this.overlayTexture)
    }
  }
}
