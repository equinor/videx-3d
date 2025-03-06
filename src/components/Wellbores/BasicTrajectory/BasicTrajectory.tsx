
import { useEffect, useMemo, useState } from 'react'
import { BufferGeometry, Color, LineBasicMaterial, Material } from 'three'
import { useGenerator } from '../../../hooks/useGenerator'
import { unpackBufferGeometry } from '../../../sdk/geometries/packing'

import { useWellboreContext } from '../../../hooks/useWellboreContext'
import { queue } from '../../../sdk/utils/limiter'
import { CommonComponentProps, CustomMaterialProps } from '../../common'
import { basicTrajectory, BasicTrajectoryGeneratorResponse } from './basic-trajectory-defs'

/**
 * BasicTrajectory props
 * @expand
 */
export type BasicTrajectoryProps = CommonComponentProps & CustomMaterialProps & {
  color?: string
  priority?: number,
}

/**
 * The BasicTrajectory renders a wellbore trajectory as a 1 pixel line. 
 * This component must be a child of the `Wellbore` component.
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
  priority = 0
}: BasicTrajectoryProps) => {

  const { id, fromMsl, segmentsPerMeter, simplificationThreshold } = useWellboreContext()

  const generator = useGenerator<BasicTrajectoryGeneratorResponse>(basicTrajectory)

  const [geometry, setGeometry] = useState<BufferGeometry | null>(null)

  const onPropsChange = useMemo(() => {
    return onMaterialPropertiesChange ? onMaterialPropertiesChange : (props: Record<string, any>, material: Material | Material[]) => {
      const m = material as LineBasicMaterial
      m.color = new Color(props.color)
    }
  }, [onMaterialPropertiesChange])

  const material = useMemo<Material | Material[]>(() => {
    const m = customMaterial ? customMaterial : new LineBasicMaterial({ transparent: true, opacity: 0.8 })
    return m
  }, [customMaterial])

  useEffect(() => {
    onPropsChange({
      color,
    }, material)
  }, [color, material, onPropsChange])

  useEffect(() => {
    if (generator) {
      queue(() => generator(id, segmentsPerMeter, simplificationThreshold, fromMsl, !!customMaterial).then(response => {
        if (response) {
          const bufferGeometry = unpackBufferGeometry(response)
          setGeometry(prev => {
            if (prev) prev.dispose()
            return bufferGeometry
          })
        } else {
          setGeometry(null)
        }
      }), priority)

    }
  }, [generator, id, fromMsl, segmentsPerMeter, simplificationThreshold, customMaterial, priority])

  if (!geometry) return null

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
  )
}
