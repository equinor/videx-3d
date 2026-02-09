import { AnnotationComponentProps } from './types';

/**
 * The default component for rendering annotation labels. You can override this by
 * supplying a custom component in the `AnnotationsLayer` component.
 *
 * @see [Storybook](/path=/docs/components-misc-annotations--docs)
 * @see {@link AnnotationsLayer}
 *
 * @group Components
 */
export const DefaultLabelComponent = ({
  id,
  name,
}: AnnotationComponentProps) => {
  return (
    <div
      key={id}
      id={`annotation_${id}`}
      style={{
        minWidth: '150px',
        background: '#33333390',
        color: 'white',
        textAlign: 'center',
        overflow: 'hidden',
        borderRadius: '4px',
        padding: '1px 6px',
        fontFamily: 'sans-serif',
        fontSize: '12pt',
      }}
    >
      <div style={{ whiteSpace: 'nowrap' }}>{name}</div>
    </div>
  );
};
