import { useFrame, useThree } from '@react-three/fiber'
import { ReactNode, useEffect, useMemo, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import {
  CanvasTexture,
  createCanvasElement,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  Vector2,
  Vector3,
} from 'three'
import { getDepthBuffer, mixVec2, normalizeVec3, TAU } from '../../sdk'
import { AnnotationsHTML } from './AnnotationsHMTL'
import { useAnnotationsState } from './annotations-state'
import { occlustionTestIntstances, postProcessInstances, preprocessInstances, updateInstanceDOMElements } from './update-annotations'

/**
 * Annotations provider component props
 * @expand
 */
export type AnnotationsProviderProps = {
  maxVisible?: number,
  children?: ReactNode
}

type PostData = {
  postCamera: OrthographicCamera,
  postScene: Scene,
  postMaterial: MeshBasicMaterial,
  size: Vector2,
  texture: CanvasTexture | null,
  ctx: CanvasRenderingContext2D,
}

const depthBufferWidth = 512
const depthBufferHeight = 512

const position = new Vector3()
const size = new Vector2()

let x1: number, x2: number, y1: number, y2: number

const id = `annotations_root`;

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
export const Annotations = ({ maxVisible = 100, children }: AnnotationsProviderProps) => {
  const { gl: renderer } = useThree()

  const instances = useAnnotationsState(state => state.instances)
  const depthBufferPending = useRef<boolean>(false)
  const dispose = useAnnotationsState(state => state.clear)

  const post = useMemo<PostData | null>(() => {
    const ctx = createCanvasElement().getContext('2d')
    if (!ctx) return null

    const postCamera = new OrthographicCamera(- 1, 1, 1, - 1, 0, 1)
    const postMaterial = new MeshBasicMaterial({ transparent: true })

    const postScene = new Scene()
    const postPlane = new PlaneGeometry(2, 2)
    const postQuad = new Mesh(postPlane, postMaterial)
    postScene.add(postQuad)

    return {
      postCamera,
      postScene,
      postMaterial,
      size: new Vector2(),
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


  useFrame(({ gl, camera, scene, clock, pointer }) => {
    // take over the render loop so we can ensure we render on top of the last frame
    gl.getSize(size)
    gl.clear()
    gl.render(scene, camera)

    if (post) {
      const { postCamera, postScene, ctx, postMaterial } = post
      ctx.clearRect(0, 0, size.x, size.y)

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

      // occlusion test
      if (!depthBufferPending.current) {
        requestAnimationFrame(() => {
          depthBufferPending.current = true
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

          getDepthBuffer(
            gl,
            scene,
            camera,
            depthBufferWidth,
            depthBufferHeight,
          ).then(buffer => {
            if (buffer) {
              return occlustionTestIntstances(
                candidates,
                buffer,
                depthBufferWidth,
                depthBufferHeight,
              )
            }
          }).finally(() => {
            depthBufferPending.current = false
          })
        })

      }


      updateInstanceDOMElements(instances)

      if (post.texture === null || post.texture.image.width !== size.x || post.texture.image.height !== size.y) {
        ctx.canvas.width = size.x
        ctx.canvas.height = size.y
        post.texture?.dispose()
        post.texture = new CanvasTexture(ctx.canvas)
        postMaterial.map = post.texture
      }

      const cursor = [
        (pointer.x * 0.5 + 0.5) * size.x,
        (-pointer.y * 0.5 + 0.5) * size.y,
      ]

      // draw overlay to canvas
      inViewSpace
        .filter(d => !d.state.occluded && !d.state.capped)
        .sort((a, b) => b.state.distance - a.state.distance)
        .forEach(instance => {
          x1 = (instance.state.screenPosition[0] * 0.5 + 0.5) * size.x
          y1 = (-instance.state.screenPosition[1] * 0.5 + 0.5) * size.y


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
      // finally render the overlay
      gl.render(postScene, postCamera)
    }

  }, 1)

  return (
    <>
      {children}
    </>
  )
}

