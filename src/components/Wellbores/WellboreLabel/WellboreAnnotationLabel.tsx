import { AnnotationComponentProps } from '../../Annotations/types';

/**
 * Annotation label component used for `WellboreLabel`
 *
 * @see {@link WellboreLabel}
 * @see {@link Annotations}
 *
 * @group Components
 */
export const WellboreAnnotationLabel = ({
  id,
  name,
  data,
}: AnnotationComponentProps) => {
  return (
    <div
      key={id}
      style={{
        color: data.color || '#ccc',
        fontSize: `${data.size || 12}pt`,
        fontFamily: 'monospace',
        background: '#00000040',
        padding: '0 2px',
        borderRadius: '4px',
        textShadow:
          '-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000',
      }}
    >
      {name}
    </div>
  );
};
