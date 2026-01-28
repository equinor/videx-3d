import { useEffect, useRef, useState } from 'react'
import { Object3D } from 'three'
import { useGenerator } from '../../../../hooks/useGenerator'
import { useWellboreContext } from '../../../../hooks/useWellboreContext'
import { useAnnotations } from '../../../Annotations/annotations-state'
import { AnnotationProps } from '../../../Annotations/types'
import { completionToolAnnotations } from './completion-annotations-defs'


/**
 * Adds annotations for completion data. This component needs to be a child of the `Wellbore` component.
 * 
 * @see {@link Wellbore}
 * @see {@link Annotations}
 * 
 * @group Components
 */
export const CompletionAnnotations = () => {
  const { id } = useWellboreContext()

  const positionRef = useRef<Object3D>(null!)

  const generator = useGenerator<AnnotationProps[]>(completionToolAnnotations, 0)

  const { addAnnotations } = useAnnotations('completion', id)

  const [labelData, setLabelData] = useState<AnnotationProps[]>([])

  useEffect(() => {

    if (generator && id) {
      generator(id).then(response => {
        if (response && positionRef.current) {
          response.forEach((d, i) => {
            d.matrixWorld = positionRef.current.matrixWorld
            d.id = i.toString()
          })
          setLabelData(response || [])
        }
      })
    }
  }, [id, generator])

  useEffect(() => {
    const dispose = addAnnotations(labelData)
    return dispose
  }, [labelData, addAnnotations])

  return <object3D ref={positionRef} visible={false} />
}
