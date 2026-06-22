import {
  CSSProperties,
  forwardRef,
  useCallback,
  useEffect,
  useRef,
} from 'react';
import { useStore } from 'zustand';
import { useAnnotationsState } from './annotations-state';
import {
  AnnotationInstanceState,
  AnnotationLayer,
  AnnotationProps,
} from './types';

const rootStyle: CSSProperties = {
  pointerEvents: 'none',
  width: '100%',
  height: '100%',
};

const annotationStyle: CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  visibility: 'hidden',
  userSelect: 'none',
  cursor: 'pointer',
  pointerEvents: 'visible',
};

type InstanceProps = {
  id: string;
  state: AnnotationInstanceState;
  layer: AnnotationLayer;
  annotation: AnnotationProps;
};

const InstanceHTML = forwardRef<HTMLDivElement, InstanceProps>(
  ({ id, state, layer, annotation }, ref) => {
    const elementRef = useRef<HTMLDivElement | null>(null);

    const onClick = useCallback(() => {
      if (layer.onClick) {
        layer.onClick({ instanceId: id, ...annotation });
      }
    }, [annotation, id, layer]);

    const onPointerEnter = useCallback(() => {
      state.labelHovered = true;
    }, [state]);

    const onPointerLeave = useCallback(() => {
      state.labelHovered = false;
    }, [state]);

    // Measure the label size via ResizeObserver instead of reading
    // clientWidth/clientHeight every frame in the render loop, which would
    // force a synchronous layout/reflow on each frame.
    const setRef = useCallback(
      (node: HTMLDivElement | null) => {
        elementRef.current = node;
        if (typeof ref === 'function') {
          ref(node);
        } else if (ref) {
          ref.current = node;
        }
      },
      [ref],
    );

    useEffect(() => {
      const node = elementRef.current;
      if (!node) return;

      const measure = () => {
        state.labelWidht = node.clientWidth;
        state.labelHeight = node.clientHeight;
      };

      measure();

      const observer = new ResizeObserver(measure);
      observer.observe(node);

      return () => {
        observer.disconnect();
      };
    }, [state]);

    return (
      <div
        ref={setRef}
        style={annotationStyle}
        onClick={onClick}
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
      >
        {layer.labelComponent && (
          <layer.labelComponent {...{ instanceId: id, ...annotation }} />
        )}
      </div>
    );
  },
);

export const AnnotationsHTML = () => {
  const instances = useStore(useAnnotationsState, state => state.instances);
  //const domInstances = useMemo(() => instances.filter(d => d.layer.labelComponent !== null), [instances])
  return (
    <div style={rootStyle}>
      {instances.map(instance => (
        <InstanceHTML
          key={instance.id}
          ref={instance.ref}
          id={instance.id}
          state={instance.state}
          layer={instance.layer}
          annotation={instance.annotation}
        />
      ))}
    </div>
  );
};
