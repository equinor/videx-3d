import {
  ForwardedRef,
  forwardRef,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  Color,
  Group,
  MeshStandardMaterialParameters,
  Object3D
} from 'three';
import {
  CommonComponentProps,
} from '../../../common/types';
import { useGenerator } from '../../../hooks/useGenerator';
import { useWellboreContext } from '../../../hooks/useWellboreContext';
import { casings, CasingSectionType, CasingsGeneratorResponse } from './casings-defs';
import { CasingSection } from './CasingSection';

/**
 * CasingSectionMaterialOptions
 * @expand
 */
export type CasingSectionMaterialOptions = {
  primary: MeshStandardMaterialParameters,
  inner?: MeshStandardMaterialParameters,
  slice?: MeshStandardMaterialParameters,
}

/**
 * MaterialOptions
 * @expand
 */
export type MaterialOptions = ((section: CasingSectionType) => CasingSectionMaterialOptions)

/**
 * Casing props
 * @expand
 */
export type CasingProps = CommonComponentProps & {
  fallback?: () => ReactElement<Object3D>;
  radialSegments?: number;
  sliceAngle?: number;
  sliceOffset?: number;
  autoSlicePosition?: boolean;
  sizeMultiplier?: number;
  shoeFactor?: number;
  overrideSegmentsPerMeter?: number;
  overrideSimplificationThreshold?: number;
  materialOptions?: MaterialOptions;
  opacity?: number;
  priority?: number;
};

/**
 * A custom function may be passed to the component, but this is not well documented at this time
 * as this behavior is subject to change.
 */
const defaultMaterialOptions = (section: CasingSectionType) => {
  const defaultParams = { color: '#4c5160', roughness: 0.5, metalness: 0.7 };
  const shoeParams = { color: 'black', roughness: 1, metalness: 0 };

  const primary = section.type.toLowerCase().includes('shoe') ? shoeParams : defaultParams;

  const sliceColor = new Color(primary.color).multiplyScalar(0.25)
  const slice = { color: sliceColor, roughness: 0.9, metalness: 0.8 }

  return {
    primary,
    inner: { color: '#bed0e4', roughness: 0.3, metalness: 0.5 },
    slice,
  }
}


/**
 * Generic render of casings based on depths, diameters and type. Must be a child of the `Wellbore` component.
 * 
 * The casing may be "sliced" at an angle using the sliceAngle prop. The sliceOffset prop determines the offset
 * from the z axis to the center of the slice. Setting autoSlicePosition to true will always show the center of the
 * slice facing the camera. With this option set to true, the sliceOffset should be set to 0.
 * 
 * An alternative to using the slice feature is to set opacity < 1 if you want to see the internals.
 * 
 * @example
 * <Wellbore id={wellbore.id}>
 *  <Casings sizeMultiplier={5} />
 * </Wellbore>
 *
 * @remarks
 * The `fallback` prop may be used to render a different component if there is no completion tool data available for the wellbore.
 *
 * @see {@link Wellbore}
 *
 * @group Components
 */
export const Casings = forwardRef(
  (
    {
      name,
      userData,
      renderOrder,
      layers,
      position,
      visible,
      radialSegments = 16,
      sizeMultiplier = 1,
      shoeFactor = 1,
      sliceAngle = 0,
      sliceOffset = 0,
      autoSlicePosition = false,
      overrideSegmentsPerMeter,
      overrideSimplificationThreshold,
      materialOptions = defaultMaterialOptions,
      fallback,
      opacity = 1,
      priority = 0,
    }: CasingProps,
    ref: ForwardedRef<Group>,
  ) => {
    const {
      id,
      fromMsl,
      segmentsPerMeter: defaultSegmentsPerMeter,
      simplificationThreshold: defaultSimplificationThreshold,
    } = useWellboreContext();
    const generator = useGenerator<CasingsGeneratorResponse>(casings, priority);
    const [sections, setSections] = useState<CasingSectionType[] | null>(null);
    const [useFallback, setUseFallback] = useState(false);

    const { segmentsPerMeter, simplificationThreshold } = useMemo(() => {
      return {
        segmentsPerMeter:
          overrideSegmentsPerMeter !== undefined
            ? overrideSegmentsPerMeter
            : defaultSegmentsPerMeter || 0.1,
        simplificationThreshold:
          overrideSimplificationThreshold !== undefined
            ? overrideSimplificationThreshold
            : defaultSimplificationThreshold || 0,
      };
    }, [
      defaultSegmentsPerMeter,
      defaultSimplificationThreshold,
      overrideSegmentsPerMeter,
      overrideSimplificationThreshold,
    ]);

    useEffect(() => {
      if (generator && id) {
        generator(
          id,
          fromMsl,
          shoeFactor,
          segmentsPerMeter,
          simplificationThreshold,
        ).then(response => {
          setSections(response);
          if (!response) setUseFallback(true);
        });
      }
    }, [
      generator,
      id,
      fromMsl,
      radialSegments,
      shoeFactor,
      segmentsPerMeter,
      simplificationThreshold,
    ]);

    const sectionMaterialOptions = useMemo(() => {
      return sections?.map(materialOptions) || null
    }, [sections, materialOptions]);

    return (
      <group
        ref={ref}
        name={name}
        userData={userData}
        visible={visible}
        position={position}
        renderOrder={renderOrder}
        layers={layers}
      >
        {sections && sectionMaterialOptions && sections.map((section, i) =>
        (<CasingSection
          key={i}
          materialOptions={sectionMaterialOptions[i]}
          opacity={opacity}
          sliceAngle={sliceAngle}
          sliceOffset={sliceOffset}
          autoSlicePosition={autoSlicePosition}
          section={section}
          radialSegments={radialSegments}
          sizeMultiplier={sizeMultiplier}
          renderOrder={i}
        />)
        )}
        {useFallback && fallback && fallback()}
      </group>
    );
  },
);
