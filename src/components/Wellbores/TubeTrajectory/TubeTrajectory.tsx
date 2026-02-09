import { useEffect, useMemo, useState } from 'react';
import { BufferGeometry, Color, Material } from 'three';
import { useGenerator } from '../../../hooks/useGenerator';
import { useWellboreContext } from '../../../hooks/useWellboreContext';
import { unpackBufferGeometry } from '../../../sdk/geometries/packing';
import { TubeMaterial } from '../../../sdk/materials/tube-material';
import { CommonComponentProps, CustomMaterialProps } from '../../common';
import {
  tubeTrajectory,
  tubeTrajectoryGeneratorResponse,
} from './tube-geometry-defs';

/**
 * TubeTrajectory props
 * @expand
 */
export type TubeTrajectoryProps = CommonComponentProps &
  CustomMaterialProps & {
    radius?: number;
    color?: string;
    radialSegments?: number;
    priority?: number;
  };

/**
 * Renders a trajectory as a tube geometry.
 *
 * @example
 * <Wellbore id={wellboreId}>
 *  <TubeTrajectory radius={2} color="cyan" radialSegments={36} />
 * </Wellbore>
 *
 * @see [Storybook](/videx-3d/?path=/docs/components-wellbores-tubetrajectory--docs)
 * @see {@link Wellbore}
 *
 * @group Components
 */
export const TubeTrajectory = ({
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
  radius = 0.5,
  radialSegments = 16,
  priority = 0,
}: TubeTrajectoryProps) => {
  const { id, fromMsl, segmentsPerMeter, simplificationThreshold } =
    useWellboreContext();

  const generator = useGenerator<tubeTrajectoryGeneratorResponse>(
    tubeTrajectory,
    priority,
  );

  const [geometry, setGeometry] = useState<BufferGeometry | null>(null);

  const onPropsChange = useMemo(() => {
    return onMaterialPropertiesChange
      ? onMaterialPropertiesChange
      : (props: Record<string, any>, material: Material | Material[]) => {
          const m = material as TubeMaterial;
          m.color = new Color(props.color);
        };
  }, [onMaterialPropertiesChange]);

  const material = useMemo(() => {
    if (customMaterial) {
      return customMaterial;
    }
    return new TubeMaterial();
  }, [customMaterial]);

  useEffect(() => {
    onPropsChange(
      {
        color,
        radius,
      },
      material,
    );
  }, [color, radius, material, onPropsChange]);

  useEffect(() => {
    if (generator) {
      generator(
        id,
        segmentsPerMeter,
        simplificationThreshold,
        fromMsl,
        radius,
        radialSegments,
      ).then((response: any) => {
        let bufferGeometry: BufferGeometry | null = null;
        if (response) {
          bufferGeometry = unpackBufferGeometry(response);
        }
        setGeometry(prev => {
          if (prev) prev.dispose();
          return bufferGeometry;
        });
      });
    }
  }, [
    generator,
    id,
    fromMsl,
    segmentsPerMeter,
    simplificationThreshold,
    radius,
    radialSegments,
  ]);

  if (!geometry) return null;

  return (
    <mesh
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
