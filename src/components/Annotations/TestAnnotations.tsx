import { nanoid } from 'nanoid'
import { useEffect, useMemo } from 'react'
import { Vec3 } from '../../sdk'
import { useAnnotations } from './annotations-state'
import { AnnotationProps } from './types'


type Props = {
  layer: string,
  count?: number,
  position?: Vec3,
  radius?: number,
}

/**
 * @interal for testing purposes
 */
export const TestAnnotations = ({ layer, count = 10, radius = 1000, position = [0, 0, 0] }: Props) => {
  const scope = useMemo(() => nanoid(), [])

  const { addAnnotations } = useAnnotations(layer, scope)

  const annotations = useMemo(() => {
    const list: AnnotationProps[] = []
    
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2
      const b = (Math.random() - 0.5) * Math.PI
      const d = Math.random() * radius
      const point: Vec3 = [
        position[0] + d * Math.cos(a),
        position[1] + d * Math.sin(b),
        position[2] + d * Math.sin(a),
      ]

      const annotation: AnnotationProps = {
        id: i.toString(),
        name: 'Test Annotation ' + i,
        position: point,
      }
      list.push(annotation)
    }
    return list
  }, [count, position, radius])

  useEffect(() => {
    const dispose = addAnnotations(annotations)
    return () => {
      dispose()
    }
  }, [annotations, addAnnotations])

  return null
}