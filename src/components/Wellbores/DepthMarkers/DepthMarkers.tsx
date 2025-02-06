import { ForwardedRef, forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { Object3D, Vector3 } from 'three'
import { useWellboreContext } from '../../../hooks/useWellboreContext'
import { useGenerator } from '../../../hooks/useGenerator'
import { depthMarkers } from './depth-markers-defs'
import { queue } from '../../../sdk/utils/limiter'
import { useAnnotations } from '../../Annotations/annotations-state'
import { AnnotationProps } from '../../Annotations/types'
import { DepthReferencePoint } from '../../../sdk/data/types/DepthReferencePoint'

/**
 * DepthMarkers props
 * @expand
 */
export type DepthMarkersProps = {
  depthReferencePoint?: DepthReferencePoint
  interval?: number
  priority?: number
}

/**
 * Adds depth markers as annotations for a wellbore
 * 
 * @example
 * <Wellbore id={wellbore.id}>
 *  <DepthMarkers interval={250} /> 
 * </Wellbore>
 * 
 * @see [Storybook](/?path=/docs/components-wellbores-depthmarkers--docs)
 * @see {@link DepthMarkerLabel}
 * @see {@link Wellbore}
 * @see {@link Annotations}
 * 
 * @group Components
 */
export const DepthMarkers = forwardRef(({
  depthReferencePoint = 'MSL',
  interval = 100,
  priority = 0
}: DepthMarkersProps, fref: ForwardedRef<Object3D>) => {

  const positionRef = useRef<Object3D>(null!)

  const { id, fromMsl } = useWellboreContext()
  const generator = useGenerator<AnnotationProps[]>(depthMarkers)
  const { addAnnotations } = useAnnotations('depth-markers', id)

  useImperativeHandle(fref, () => positionRef.current!)

  useEffect(() => {
    let dispose: (() => void) | null = null
    if (generator && id) {
      const v = new Vector3()
      queue(() => generator(id, interval, depthReferencePoint, fromMsl).then(response => {
        if (response && positionRef.current) {
          response.forEach(d => {
            v.set(...d.position)
            positionRef.current.localToWorld(v)
            d.position = v.toArray()
          })
          dispose = addAnnotations(response || [])
          //console.log(response)
        }
      }), priority)
    }

    return () => {
      if (dispose) dispose()
    }
  }, [addAnnotations, id, generator, depthReferencePoint, fromMsl, interval, positionRef, priority])

  return (
    <object3D ref={positionRef} visible={false} />
  )

})