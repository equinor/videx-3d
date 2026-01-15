import { useThree } from '@react-three/fiber'
import { ReactNode, useEffect, useMemo } from 'react'
import { createRoot } from 'react-dom/client'
import { useAnnotationsState } from './annotations-state'
import { AnnotationsHTML } from './AnnotationsHMTL'
import { AutoUpdate } from './AutoUpdate'

/**
 * Annotations provider component props
 * @expand
 */
export type AnnotationsProviderProps = {
  autoUpdate?: boolean,
  maxVisible?: number,
  children?: ReactNode
}

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

export const Annotations = ({ maxVisible = 100, autoUpdate = true, children }: AnnotationsProviderProps) => {
  const gl = useThree(state => state.gl)

  const dispose = useAnnotationsState(state => state.clear)

  const root = useMemo(() => {
    const parent = gl.domElement.parentElement

    if (!parent) throw Error('Unable to create root!')

    parent.querySelector(`#${id}`)?.remove() // remove any existing annotations container

    const container = document.createElement('div')
    container.setAttribute('id', id)
    container.setAttribute('style', 'position:absolute;top:0;left:0;z-index: 1;pointer-events:none;padding:0;width:100%;height:100%;user-select:none')
    parent.appendChild(container)

    return createRoot(container)
  }, [gl])

  useEffect(() => {
    root.render(<AnnotationsHTML />)
    return () => {
      root.unmount()
      dispose()
    }
  }, [root, dispose])

  return (
    <>
      {autoUpdate && <AutoUpdate maxVisible={maxVisible} />}
      {children}
    </>
  )
}

