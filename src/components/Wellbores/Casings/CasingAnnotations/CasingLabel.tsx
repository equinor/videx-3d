import { useMemo } from 'react'
import { AnnotationComponentProps } from '../../../Annotations/types'

/**
 * Annotation label for `CasingAnnotations`
 * 
 * @see {@link CasingAnnotations}
 * 
 * @group Components
 */
export const CasingLabel = ({ id, name, data }: AnnotationComponentProps) => {
  const color = useMemo(() => {
    if (data.type === 'Shoe') {
      return '#00ffa2'
    }
    return '#00d0ff'
  }, [data])

  return (
    <div
      key={id}
      style={{
        padding: '0.25em 1em',
        minWidth: '200px',
        borderRadius: '6px',
        background: '#181e249f',
        fontFamily: 'tahoma',
      }}
    >
      <div style={{
        fontSize: '18pt',
        whiteSpace: 'nowrap',
        color: color,
        fontWeight: 'bold',
        overflow: 'hidden'
      }}>
        {name}
      </div>
    </div>
  )
}