import { useEffect, useRef } from 'react'
import { useGenerator } from '../../../../hooks/useGenerator'
import { AnnotationProps } from '../../../Annotations/types'
import { useWellboreContext } from '../../../../hooks/useWellboreContext'
import { Object3D, Vector3 } from 'three'
import { queue } from '../../../../sdk/utils/limiter'
import { casingAnnotations } from './casing-annotations-defs'
import { useAnnotations } from '../../../Annotations/annotations-state'

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
  const generator = useGenerator<AnnotationProps[]>(casingAnnotations)

  const { addAnnotations } = useAnnotations('casings', id)

  useEffect(() => {
    let dispose: (() => void) | null = null
    if (generator && id) {
      const v = new Vector3()
      queue(() => generator(id).then(response => {
        if (response && positionRef.current) {
          response.forEach((d, i) => {
            v.set(...d.position)
            positionRef.current.localToWorld(v)
            d.position = v.toArray()
            d.id = i.toString()
          })
          dispose = addAnnotations(response || [])
          //console.log(response)
        }
      }), 1)
    }

    return () => {
      if (dispose) dispose()
    }
  }, [addAnnotations, id, generator, positionRef])

  return <object3D ref={positionRef} visible={false} />
}