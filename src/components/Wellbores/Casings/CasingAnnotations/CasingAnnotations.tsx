import { useEffect, useRef, useState } from 'react'
import { Object3D, Vector3 } from 'three'
import { useGenerator } from '../../../../hooks/useGenerator'
import { useWellboreContext } from '../../../../hooks/useWellboreContext'
import { useAnnotations } from '../../../Annotations/annotations-state'
import { AnnotationProps } from '../../../Annotations/types'
import { casingAnnotations } from './casing-annotations-defs'

const v = new Vector3()

/**
 * Adds annotations for casing data. This component needs to be a child of the `Wellbore` component.
 * 
 * @see {@link Wellbore}
 * @see {@link Annotations}
 * 
 * @group Components
 */
export const CasingAnnotations = () => {
  const { id } = useWellboreContext()

  const positionRef = useRef<Object3D>(null!)
  const generator = useGenerator<AnnotationProps[]>(casingAnnotations, 1)

  const { addAnnotations } = useAnnotations('casings', id)

  const [labelData, setLabelData] = useState<AnnotationProps[]>([])

  useEffect(() => {
    if (generator && id) {
      generator(id).then(response => {
        if (response && positionRef.current) {
          response.forEach((d, i) => {
            v.set(...d.position)
            positionRef.current.localToWorld(v)
            d.position = v.toArray()
            d.id = i.toString()
          })
          setLabelData(response || [])
        }
      })
    }
  }, [id, generator, positionRef])

  useEffect(() => {
    const dispose = addAnnotations(labelData)
    return dispose
  }, [labelData, addAnnotations])

  return <object3D ref={positionRef} visible={false} />
}