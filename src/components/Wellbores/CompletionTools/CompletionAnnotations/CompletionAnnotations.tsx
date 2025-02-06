import { useEffect, useRef } from 'react'
import { useGenerator } from '../../../../hooks/useGenerator'
import { useWellboreContext } from '../../../../hooks/useWellboreContext'
import { queue } from '../../../../sdk/utils/limiter'
import { Object3D, Vector3 } from 'three'
import { completionToolAnnotations } from './completion-annotations-defs'
import { AnnotationProps } from '../../../Annotations/types'
import { useAnnotations } from '../../../Annotations/annotations-state'


const v = new Vector3()

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

  const generator = useGenerator<AnnotationProps[]>(completionToolAnnotations)

  // const layerOptions = useMemo<AnnotationLayerProps>(() => ({
  //   name: 'Completion Tools' + id,
  //   priority: 1,
  //   visible: false,
  //   distanceFactor: 150,
  //   labelOffset: 100,
  //   anchorSize: 3,
  //   connector: false,
  //   anchorOcclusionRadius: 30,
  //   minDistance: 10,
  //   maxDistance: 8000,
  //   onClick: (annotation: AnnotationProps) => {
  //     dispatchEvent(
  //       new CameraFocusAtPointEvent({
  //         point: annotation.position,
  //         distance: 200,
  //       })
  //     )
  //   }
  // }), [id])

  const { addAnnotations } = useAnnotations('completion', id)

  useEffect(() => {
    let dispose: (() => void) | null = null
    if (generator && id) {
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
      }), 0)
    }

    return () => {
      if (dispose) dispose()
    }
  }, [id, generator, addAnnotations])

  return <object3D ref={positionRef} visible={false} />
}