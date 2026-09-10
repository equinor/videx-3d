import { useEffect, useMemo, useState } from 'react';
import {
  BufferGeometry,
  Color,
  Line,
  LineBasicMaterial,
  Material,
} from 'three';
import { useGenerator } from '../../../hooks/useGenerator';
import { unpackBufferGeometry } from '../../../sdk/geometries/packing';

import { extend } from '@react-three/fiber';
import {
  CommonComponentProps,
  CustomMaterialProps,
} from '../../../common/types';
import { useWellboreContext } from '../../../hooks/useWellboreContext';
import { makeOitCompatible } from '../../../rendering';
import {
  basicTrajectory,
  BasicTrajectoryGeneratorResponse,
} from './basic-trajectory-defs';

extend({ ThreeLine: Line });
/**
 * BasicTrajectory props
 * @expand
 */
export type BasicTrajectoryProps = CommonComponentProps &
  CustomMaterialProps & {
    color?: string;
    /** Line opacity (1 = fully opaque, the default). Values < 1 render semi-transparent. */
    opacity?: number;
    priority?: number;
  };

/**
 * The BasicTrajectory renders a wellbore trajectory as a crisp 1 pixel line.
 * This component must be a child of the `Wellbore` component.
 *
 * It is ideal when you always want a thin line regardless of camera distance — for
 * example as a lightweight fallback where a full tube would be overkill, or where
 * trajectory data may not cover the whole path (e.g. behind casings and completion
 * strings). For a tube that gains thickness as the camera approaches, use
 * {@link Trajectory} instead.
 *
 * @example
 * <Wellbore id="abc">
 *  <BasicTrajectory />
 * </Wellbore>
 *
 * @remarks
 * This component depends on the {@link basicTrajectory} generator.
 *
 * @see [Storybook](/videx-3d/?path=/docs/components-wellbores-basictrajectory--docs)
 * @see [Generators](/videx-3d/docs/documents/generators.html)
 *
 * @group Components
 */

export const BasicTrajectory = ({
  name,
  userData,
  position,
  castShadow,
  receiveShadow,
  layers,
  renderOrder,
  visible,
  customDepthMaterial,
  customDistanceMaterial,
  customMaterial,
  onMaterialPropertiesChange,
  color = 'red',
  opacity = 1,
  priority = 0,
}: BasicTrajectoryProps) => {
  const { id, fromMsl, segmentsPerMeter, simplificationThreshold } =
    useWellboreContext();

  const generator = useGenerator<BasicTrajectoryGeneratorResponse>(
    basicTrajectory,
    priority,
  );

  const [geometry, setGeometry] = useState<BufferGeometry | null>(null);

  const onPropsChange = useMemo(() => {
    return onMaterialPropertiesChange
      ? onMaterialPropertiesChange
      : (props: Record<string, any>, material: Material | Material[]) => {
          const m = material as LineBasicMaterial;
          m.color = new Color(props.color);
          m.opacity = props.opacity;
          const shouldBeTransparent = props.opacity < 1;
          if (m.transparent !== shouldBeTransparent) {
            m.transparent = shouldBeTransparent;
            m.needsUpdate = true;
          }
        };
  }, [onMaterialPropertiesChange]);

  const material = useMemo<Material | Material[]>(() => {
    const m = customMaterial
      ? customMaterial
      : makeOitCompatible(new LineBasicMaterial(), {
          syncProperties: ['color'],
        });
    return m;
  }, [customMaterial]);

  useEffect(() => {
    onPropsChange(
      {
        color,
        opacity,
      },
      material,
    );
  }, [color, opacity, material, onPropsChange]);

  useEffect(() => {
    if (generator) {
      generator(
        id,
        segmentsPerMeter,
        simplificationThreshold,
        fromMsl,
        !!customMaterial,
      ).then(response => {
        if (response) {
          const bufferGeometry = unpackBufferGeometry(response);
          setGeometry(bufferGeometry);
        } else {
          setGeometry(null);
        }
      });
    }
  }, [
    generator,
    id,
    fromMsl,
    segmentsPerMeter,
    simplificationThreshold,
    customMaterial,
  ]);

  // Dispose the library-created geometry when it is replaced or on unmount.
  useEffect(() => {
    return () => {
      geometry?.dispose();
    };
  }, [geometry]);

  // Dispose the library-created material on unmount (skip user-supplied material).
  useEffect(() => {
    return () => {
      if (!customMaterial) {
        const materials = Array.isArray(material) ? material : [material];
        materials.forEach(m => m.dispose());
      }
    };
  }, [material, customMaterial]);

  if (!geometry) return null;

  return (
    <threeLine
      name={name}
      position={position}
      userData={userData}
      renderOrder={renderOrder}
      layers={layers}
      castShadow={castShadow}
      receiveShadow={receiveShadow}
      visible={visible}
      geometry={geometry}
      material={material}
      customDepthMaterial={customDepthMaterial}
      customDistanceMaterial={customDistanceMaterial}
    />
  );
};
