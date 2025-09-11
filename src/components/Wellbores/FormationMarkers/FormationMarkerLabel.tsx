import { useMemo } from 'react'
import { AnnotationComponentProps } from '../../Annotations/types'

/**
 * Annotation label component used for `FormationMarkers`
 * 
 * @see {@link FormationMarkers}
 * @see {@link Annotations}
 * 
 * @group Components
 */
export const FormationMarkerLabel = ({ id, name, data }: AnnotationComponentProps) => {
  const color = useMemo(() => {
    return `#${data.color}`
  }, [data])

  return (
    <div
      key={id}
      style={{
        padding: '0.25em 0.5em',
        borderRadius: '6px',
        background: '#000000a0',
        fontFamily: 'sans-serif',
        borderStyle: 'solid',
        borderColor: `${color}c0`,
        borderWidth: '1px 1px 1px 1px'
      }}
    >
      <div style={{
        fontSize: '12pt',
        whiteSpace: 'nowrap',
        color: 'white',
        overflow: 'hidden',
        textShadow: '-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000'
      }}>
        {name}
        <div style={{ textAlign: 'center', fontSize: '9pt', color: '#ffffffc0', textShadow: 'none', fontFamily: 'monospace' }}>
          <span style={{ color: '#ffffff90' }}>TVD:</span> {data.tvd}&nbsp;
          <span style={{ color: '#ffffff90' }}>MD:</span> {data.depth}&nbsp;
          <span style={{ color: '#ffffff90' }}>Msl</span>
        </div>
      </div>
    </div>
  )
}