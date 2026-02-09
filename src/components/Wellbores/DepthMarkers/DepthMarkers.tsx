import {
  ForwardedRef,
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { Object3D } from 'three';
import { useGenerator } from '../../../hooks/useGenerator';
import { useWellboreContext } from '../../../hooks/useWellboreContext';
import { DepthReferencePoint } from '../../../sdk/data/types/DepthReferencePoint';
import { useAnnotations } from '../../Annotations/annotations-state';
import { AnnotationProps } from '../../Annotations/types';
import { depthMarkers } from './depth-markers-defs';

/**
 * DepthMarkers props
 * @expand
 */
export type DepthMarkersProps = {
  depthReferencePoint?: DepthReferencePoint;
  interval?: number;
  priority?: number;
};

/**
 * Adds depth markers as annotations for a wellbore
 *
 * @example
 * <Wellbore id={wellbore.id}>
 *  <DepthMarkers interval={250} />
 * </Wellbore>
 *
 * @see [Storybook](/videx-3d/?path=/docs/components-wellbores-depthmarkers--docs)
 * @see {@link DepthMarkerLabel}
 * @see {@link Wellbore}
 * @see {@link Annotations}
 *
 * @group Components
 */
export const DepthMarkers = forwardRef(
  (
    {
      depthReferencePoint = 'MSL',
      interval = 100,
      priority = 0,
    }: DepthMarkersProps,
    fref: ForwardedRef<Object3D>,
  ) => {
    const positionRef = useRef<Object3D>(null!);

    const { id, fromMsl } = useWellboreContext();
    const generator = useGenerator<AnnotationProps[]>(depthMarkers, priority);
    const { addAnnotations } = useAnnotations('depth-markers', id);

    const [labelData, setLabelData] = useState<AnnotationProps[]>([]);

    useImperativeHandle(fref, () => positionRef.current!);

    useEffect(() => {
      if (generator && id) {
        generator(id, interval, depthReferencePoint, fromMsl).then(response => {
          if (response && positionRef.current) {
            response.forEach(d => {
              d.matrixWorld = positionRef.current.matrixWorld;
            });
            setLabelData(response || []);
          }
        });
      }
    }, [id, generator, depthReferencePoint, fromMsl, interval, positionRef]);

    useEffect(() => {
      const dispose = addAnnotations(labelData);
      return dispose;
    }, [labelData, addAnnotations]);

    return <object3D ref={positionRef} visible={false} />;
  },
);
