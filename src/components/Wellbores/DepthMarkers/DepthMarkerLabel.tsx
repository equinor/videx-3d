import { AnnotationComponentProps } from '../../Annotations/types';

/**
 * Annotation label component used for `DepthMarkers`
 *
 *
 * @see {@link DepthMarkers}
 * @see {@link Annotations}
 *
 * @group Components
 */
export const DepthMarkerLabel = ({ id, name }: AnnotationComponentProps) => {
  return (
    <div
      key={id}
      style={{
        color: '#ccc',
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
