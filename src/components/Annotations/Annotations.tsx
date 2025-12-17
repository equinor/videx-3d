import { useFrame, useThree } from '@react-three/fiber'
import { ReactNode, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import {
  CanvasTexture,
  createCanvasElement,
  DepthTexture,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  PerspectiveCamera,
  PlaneGeometry,
  RGBAFormat,
  Scene,
  SRGBColorSpace,
  UnsignedByteType,
  Vector3,
  WebGLRenderTarget
} from 'three'
import { DepthReadMaterial, mixVec2, normalizeVec3, TAU, Vec2 } from '../../sdk'
import { AnnotationsHTML } from './AnnotationsHMTL'
import { useAnnotationsState } from './annotations-state'
import { occlustionTestIntstances, postProcessInstances, preprocessInstances, updateInstanceDOMElements } from './update-annotations'

const msaa = 4

/**
 * Annotations provider component props
 * @expand
 */
export type AnnotationsProviderProps = {
  maxVisible?: number,
  depthBufferSize?: number | [number, number],
  children?: ReactNode
}

type PostData = {
  postCamera: OrthographicCamera,
  postScene: Scene,
  postQuad: Mesh,
  postMaterial: MeshBasicMaterial,
  texture: CanvasTexture | null,
  ctx: CanvasRenderingContext2D,
}

const position = new Vector3()

let x1: number, x2: number, y1: number, y2: number

const id = `annotations_root`

/**
 * The Annotations component is special provider component responsible for managing 
 * and updating annotation layers and instances.
 * 
 * It allow you to register layers, using the AnnotationLayer component, and set a 
 * global max visible annotations.
 * 
 * Annotations adds point-feature labeling support, where labels are rendered as 
 * regular React HTML components. Anchors and connector lines are drawn to the frame buffer
 * after the 3D scene frame is completed.
 * 
 * Annotations are processed globally to support label collision, occlusion and 
 * ordering tests. Priority and visibillity distances can be set in the AnnotationLayer 
 * component and/or int the individual annotation elements.
 * 
 * @example
 * <Annotations>
 *  <AnnotationLayer id="casings_annotations" name="Casing Annotations" />
 * </Annotations>
 * 
 * @remarks
 * This component sets up a global state and takes control over the render loop! 
 * It's therefore important that only a single instance of this component is mounted 
 * at any time in your project. Using this compoent with an EffectsComposer may cause issues, 
 * and we will likely convert it from being a component into being a post-processing pass at some point. 
 * 
 * @see [Storybook](/videx-3d/?path=/docs/components-misc-annotations--docs)
 * @see {@link AnnotationsLayer}
 * 
 * @group Components
 */


const depthReadMaterial = new DepthReadMaterial()
const renderMaterial = new MeshBasicMaterial()

export const Annotations = ({ maxVisible = 100, depthBufferSize = 512, children }: AnnotationsProviderProps) => {
  const renderer = useThree(state => state.gl)
  const viewport = useThree(state => state.viewport)
  const renderSize = useThree(state => state.size)
  const instances = useAnnotationsState(state => state.instances)

  const dispose = useAnnotationsState(state => state.clear)

  const depthBufferRead = useRef(false)

  const size = useMemo(() => {
    const size: Vec2 = [
      renderSize.width,
      renderSize.height,
    ]
    return size
  }, [renderSize])

  const renderTarget = useMemo(() => {
    const w = 0
    const h = 0
    const depthTexture = new DepthTexture(w, h)

    const pbo = new WebGLRenderTarget(w, h, {
      colorSpace: SRGBColorSpace,
      format: RGBAFormat,
      type: UnsignedByteType,
      depthBuffer: true,
      depthTexture,
      generateMipmaps: false,
      stencilBuffer: false,
      samples: msaa || 0
    })
    return pbo
  }, [])

  const [depthBufferWidth, depthBufferHeight] = useMemo(() =>
    Array.isArray(depthBufferSize) ? depthBufferSize : [depthBufferSize, depthBufferSize]
    , [depthBufferSize])

  const { renderTargetDepth, depthBuffer } = useMemo(() => {
    const pbo = new WebGLRenderTarget(depthBufferWidth, depthBufferHeight, {
      type: UnsignedByteType,
      format: RGBAFormat,
      generateMipmaps: false,
      stencilBuffer: false,
      depthBuffer: false
    })
    const buffer = new Uint8Array(depthBufferWidth * depthBufferHeight * 4)
    return { renderTargetDepth: pbo, depthBuffer: buffer }
  }, [depthBufferWidth, depthBufferHeight])

  useLayoutEffect(() => {
    renderTarget.setSize(size[0] * viewport.dpr, size[1] * viewport.dpr)
  }, [size, renderTarget, renderer, viewport])

  const post = useMemo<PostData | null>(() => {
    const ctx = createCanvasElement().getContext('2d')
    if (!ctx) return null

    const postCamera = new OrthographicCamera(- 1, 1, 1, - 1, 0, 1)
    const postMaterial = new MeshBasicMaterial({ transparent: true, toneMapped: false })

    const postScene = new Scene()
    const postPlane = new PlaneGeometry(2, 2)
    const postQuad = new Mesh(postPlane, postMaterial)

    postScene.add(postQuad)

    return {
      postCamera,
      postScene,
      postQuad,
      postMaterial,
      texture: null,
      ctx,
    }
  }, [])

  const root = useMemo(() => {
    const parent = renderer.domElement.parentElement

    if (!parent) throw Error('Unable to create root!')

    parent.querySelector(`#${id}`)?.remove() // remove any existing annotations container

    const container = document.createElement('div')
    container.setAttribute('id', id)
    container.setAttribute('style', 'position:absolute;top:0;left:0;z-index: 1;pointer-events:none;padding:0;width:100%;height:100%;user-select:none')
    parent.appendChild(container)

    return createRoot(container)
  }, [renderer])

  useEffect(() => {
    root.render(<AnnotationsHTML />)
    return () => {
      root.unmount()
      dispose()
    }
  }, [root, dispose])

  useFrame(({ camera, scene, clock, pointer }) => {
    // take over the render loop so we can ensure we render on top of the last frame
    if (post) {
      // render the scene to color and depth textures
      renderer.setRenderTarget(renderTarget)
      renderer.clear()
      renderer.render(scene, camera)

      const { postCamera, postScene, ctx, postMaterial, postQuad } = post

      // render the depth texture to a readable rendertarget
      depthReadMaterial.uniforms.depthTexture.value = renderTarget.depthTexture
      depthReadMaterial.uniforms.cameraNear.value = camera.near
      depthReadMaterial.uniforms.cameraFar.value = camera.far
      postQuad.material = depthReadMaterial
      renderer.setRenderTarget(renderTargetDepth)
      renderer.clear()
      renderer.render(postScene, postCamera)

      // render the color texture to the framebuffer
      postQuad.material = renderMaterial
      renderMaterial.map = renderTarget.texture
      renderer.setRenderTarget(null)
      renderer.clear()
      renderer.render(postScene, postCamera)

      if (!instances.length) return

      // update annotation instances
      const perspectiveCamera = camera as PerspectiveCamera

      const inViewSpace = preprocessInstances(
        instances,
        perspectiveCamera,
        clock,
        maxVisible,
      )

      if (!inViewSpace.length) {
        updateInstanceDOMElements(instances)
        return
      }

      postProcessInstances(
        inViewSpace,
        size,
      )

      if (!depthBufferRead.current) {
        depthBufferRead.current = true

        // occlusion test
        const candidates = inViewSpace.map(instance => {
          const thresholdRadius = instance.layer.anchorOcclusionRadius!
          const direction = normalizeVec3([
            camera.position.x - instance.annotation.position[0],
            camera.position.y - instance.annotation.position[1],
            camera.position.z - instance.annotation.position[2],
          ])
          position.set(
            instance.annotation.position[0] + direction[0] * thresholdRadius,
            instance.annotation.position[1] + direction[1] * thresholdRadius,
            instance.annotation.position[2] + direction[2] * thresholdRadius
          )

          position.project(camera)

          return { instance, position: position.toArray() }
        })

        if (candidates.length) {
          renderer.readRenderTargetPixelsAsync(
            renderTargetDepth,
            0,
            0,
            depthBufferWidth,
            depthBufferHeight,
            depthBuffer
          ).then(buffer => {
            occlustionTestIntstances(
              candidates,
              buffer as Uint8Array,
              depthBufferWidth,
              depthBufferHeight,
            )
          }).finally(() => {
            depthBufferRead.current = false
          })
        }
      }


      updateInstanceDOMElements(instances)

      if (post.texture === null || post.texture.image.width !== size[0] || post.texture.image.height !== size[1]) {
        ctx.canvas.width = size[0]
        ctx.canvas.height = size[1]
        post.texture?.dispose()
        post.texture = new CanvasTexture(ctx.canvas)
      }

      const cursor = [
        (pointer.x * 0.5 + 0.5) * size[0],
        (-pointer.y * 0.5 + 0.5) * size[1],
      ]

      // prepare the canvas context
      ctx.clearRect(0, 0, size[0], size[1])

      // draw overlay to canvas
      inViewSpace
        .filter(d => !d.state.occluded && !d.state.capped)
        .sort((a, b) => b.state.distance - a.state.distance)
        .forEach(instance => {
          x1 = (instance.state.screenPosition[0] * 0.5 + 0.5) * size[0]
          y1 = (-instance.state.screenPosition[1] * 0.5 + 0.5) * size[1]


          let radius = instance.layer.anchorSize * instance.state.scaleFactor!
          let anchorHovered = false
          // boost instance if not visible and cursor is over anchor point
          if (Math.abs(cursor[0] - x1) <= radius && Math.abs(cursor[1] - y1) <= radius) {
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
              [x2, y2] = mixVec2(
                instance.state.prevAnchorPosition,
                instance.state.anchorPosition!,
                instance.state.transitionTime
              )
            } else {
              [x2, y2] = instance.state.anchorPosition!
            }

            let strokeWidth = Math.max(0.1,
              instance.layer.connectorWidth * instance.state.scaleFactor!
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

          ctx.globalAlpha = (instance.state.visible ? 1 : 0.5)
          ctx.fillStyle = instance.layer.anchorColor

          ctx.fill()

          ctx.globalAlpha = instance.state.opacity || 0
          ctx.strokeStyle = 'black'
          ctx.lineWidth = 0.75
          ctx.stroke()

        })

      post.texture.needsUpdate = true
      postMaterial.map = post.texture
      postQuad.material = postMaterial

      // finally render the overlay to the framebuffer     
      renderer.render(postScene, postCamera)
    }

  }, 1)

  return (
    <>
      {children}
    </>
  )
}

