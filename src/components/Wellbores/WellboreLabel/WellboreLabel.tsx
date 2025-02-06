import { useEffect, useRef } from 'react'
import { useGenerator } from '../../../hooks/useGenerator'
import { AnnotationProps } from '../../Annotations/types'
import { useWellboreContext } from '../../../hooks/useWellboreContext'
import { Color, Object3D, Vector3 } from 'three'
import { queue } from '../../../sdk/utils/limiter'
import { wellboreLabel } from './wellbore-label-defs'
import { useAnnotations } from '../../Annotations/annotations-state'

/**
 * WellboreLabel props
 * @expand
 */
export type WellboreLabelProps = {
  color?: number | string | Color
  size?: number,
  position?: 'top' | 'center' | 'bottom'
}

/**
 * Displays a wellbore label as an annotation at the bottom, top or middle of a wellbore trajectory.
 *  
 * @example
 * <Wellbore id={wellbore.id}>
 *  <WellboreLabel position="bottom" /> 
 * </Wellbore>
 * 
 * @see [Storybook](/?path=/docs/components-wellbores-wellborelabel--docs)
 * @see {@link Wellbore}
 * @see {@link Annotations}
 * @group Components
 */
export const WellboreLabel = ({ size = 12, color = 'white', position = 'bottom' }: WellboreLabelProps) => {
  const { id, fromMsl } = useWellboreContext()

  const positionRef = useRef<Object3D>(null!)
  const generator = useGenerator<AnnotationProps[]>(wellboreLabel)

  const { addAnnotations } = useAnnotations('wellbore-labels', id)

  useEffect(() => {
    let dispose: (() => void) | null = null
    if (generator && id) {
      const v = new Vector3()
      queue(() => generator(id, position, fromMsl).then(response => {
        if (response && positionRef.current) {
          response.forEach(d => {
            v.set(...d.position)
            positionRef.current.localToWorld(v)
            d.position = v.toArray()
            d.data = { color, size }
          })
          dispose = addAnnotations(response || [])
          //console.log(response)
        }
      }), 1)
    }

    return () => {
      if (dispose) dispose()
    }
  }, [addAnnotations, id, generator, fromMsl, position, positionRef, color, size])

  return <object3D ref={positionRef} visible={false} />
}