import { useEffect, useMemo, useRef, useState } from 'react'
import { unpackBufferGeometry } from '../../../sdk/geometries/packing'
import { BufferGeometry, Color, DoubleSide, Group, Material, ShaderMaterial, Uniform } from 'three'
import vertexShader from './shaders/vertex.glsl'
import fragmentShader from './shaders/fragment.glsl'
import { useFrame } from '@react-three/fiber'
import { useWellboreContext } from '../../../hooks/useWellboreContext'
import { limit } from '../../../sdk/utils/limiter'
import { useGenerator } from '../../../hooks/useGenerator'
import { PerimeterGeneratorResponse, perimeterGeometry } from './perimeter-defs'
import { CommonComponentProps, CustomMaterialProps } from '../../common'
import { createLayers, LAYERS } from '../../../layers/layers'


/**
 * Perimeter props
 * @expand
 */
export type PerimeterProps = CommonComponentProps & CustomMaterialProps & {
  color?: string | Color | number,
  radius: number,
  from: number,
  to: number,
  opacity?: number,
}

/**
 * A simple cylindrical perimeter that can be rendered on top of a wellbore trajectory, with a given
 * start and end depth as well as a radius.
 * 
 * @example
 * <Wellbore id={wellbore.id}>
 *  <Perimeter from={1000} to={5000} radius={10} /> 
 * </Wellbore>
 * 
 * @see [Storybook](/?path=/docs/components-wellbores-perimeter--docs)
 * @see {@link Wellbore}
 * 
 * @group Components
 */
export const Perimeter = ({
  color = '#56af3b',
  radius,
  from,
  to,
  opacity = 0.5,
  name,
  userData,
  visible,
  layers = createLayers(LAYERS.NOT_EMITTER),
  position,
  renderOrder = 3,
  castShadow,
  receiveShadow,
  customDepthMaterial,
  customDistanceMaterial,
  customMaterial,
  onMaterialPropertiesChange,
}: PerimeterProps) => {
  const { id, segmentsPerMeter, simplificationThreshold } = useWellboreContext()

  const groupRef = useRef<Group>(null!)
  const matProps = useRef({
    color,
    opacity,
    from,
    to,
    time: 0,
  })

  const generator = useGenerator<PerimeterGeneratorResponse>(perimeterGeometry)

  const [geometry, setGeometry] = useState<BufferGeometry | null>(null)

  useEffect(() => {
    if (generator) {

      limit(() => generator(id, radius, segmentsPerMeter, simplificationThreshold)).then((response) => {
        if (response) {
          const bufferGeometry = unpackBufferGeometry(response)
          bufferGeometry.computeBoundingBox()
          setGeometry(prev => {
            if (prev) prev.dispose()
            return bufferGeometry
          })
        }
      })
    }
  }, [generator, id, radius, segmentsPerMeter, simplificationThreshold])

  const onPropsChange = useMemo(() => {
    return onMaterialPropertiesChange ? onMaterialPropertiesChange : (props: Record<string, any>, material: Material | Material[]) => {
      const m = material as ShaderMaterial
      m.uniforms.uColor.value = new Color(props.color)
      m.uniforms.uFrom.value = props.from
      m.uniforms.uTo.value = props.to
      m.uniforms.uOpacity.value = props.opacity
      m.uniforms.uTime.value = props.time
    }
  }, [onMaterialPropertiesChange])

  const material = useMemo<Material | Material[]>(() => {
    const m = customMaterial ? customMaterial : new ShaderMaterial({
      transparent: true,
      side: DoubleSide,
      vertexShader,
      fragmentShader,
      uniforms: {
        uTime: new Uniform(0),
        uFrom: new Uniform(0),
        uTo: new Uniform(0),
        uOpacity: new Uniform(0),
        uColor: new Uniform(new Color('#56af3b')),
      }
    })
    return m
  }, [customMaterial])

  useEffect(() => {
    matProps.current.color = color
    matProps.current.opacity = opacity
    matProps.current.from = from
    matProps.current.to = to
    onPropsChange(matProps.current, material)
  }, [from, to, opacity, color, material, onPropsChange])

  useFrame(({ clock }) => {
    matProps.current.time = clock.getElapsedTime()
    onPropsChange(matProps.current, material)
  })
  if (!geometry) return null

  return (
    <group
      ref={groupRef}
      name={name}
      userData={userData}
      visible={visible}
      position={position}
      renderOrder={renderOrder}
    >
      <mesh
        geometry={geometry}
        material={material}
        customDepthMaterial={customDepthMaterial}
        customDistanceMaterial={customDistanceMaterial}
        layers={layers}
        castShadow={castShadow}
        receiveShadow={receiveShadow}
      />
    </group>
  )
}