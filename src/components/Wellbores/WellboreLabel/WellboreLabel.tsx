import { useEffect, useRef, useState } from 'react'
import { Color, Object3D, Vector3 } from 'three'
import { useGenerator } from '../../../hooks/useGenerator'
import { useWellboreContext } from '../../../hooks/useWellboreContext'
import { useAnnotations } from '../../Annotations/annotations-state'
import { AnnotationProps } from '../../Annotations/types'
import { wellboreLabel } from './wellbore-label-defs'

/**
 * WellboreLabel props
 * @expand
 */
export type WellboreLabelProps = {
  color?: number | string | Color
  size?: number,
  position?: 'top' | 'center' | 'bottom',
  priority?: number,
}

const v = new Vector3()

/**
 * Displays a wellbore label as an annotation at the bottom, top or middle of a wellbore trajectory.
 *  
 * @example
 * <Wellbore id={wellbore.id}>
 *  <WellboreLabel position="bottom" /> 
 * </Wellbore>
 * 
 * @see [Storybook](/videx-3d/?path=/docs/components-wellbores-wellborelabel--docs)
 * @see {@link Wellbore}
 * @see {@link Annotations}
 * @group Components
 */
export const WellboreLabel = ({ size = 12, color = 'white', position = 'bottom', priority = 0 }: WellboreLabelProps) => {
  const { id, fromMsl } = useWellboreContext()

  const positionRef = useRef<Object3D>(null!)
  const generator = useGenerator<AnnotationProps[]>(wellboreLabel, priority)

  const { addAnnotations } = useAnnotations('wellbore-labels', id)

  const [labelData, setLabelData] = useState<AnnotationProps | null>(null)

  useEffect(() => {
    if (generator && id) {
      generator(id, position, fromMsl).then(response => {
        if (response && response.length === 1 && positionRef.current) {
          const [label] = response
          v.set(...label.position)
          positionRef.current.localToWorld(v)
          label.position = v.toArray()
          label.data = { color, size }
          setLabelData(label)
        }
      })
    }
  }, [id, generator, fromMsl, position, color, size])

  useEffect(() => {
    return addAnnotations(labelData ? [labelData] : [])
  }, [labelData, addAnnotations])

  return <object3D ref={positionRef} visible={false} />
}
