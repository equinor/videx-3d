import { ForwardedRef, forwardRef, ReactElement, useEffect, useMemo, useState } from 'react'
import { BufferGeometry, Group, Material, MeshStandardMaterial, Object3D } from 'three'
import { useGenerator } from '../../../hooks/useGenerator'
import { useWellboreContext } from '../../../hooks/useWellboreContext'
import { createLayers, LAYERS } from '../../../layers/layers'
import { unpackBufferGeometry } from '../../../sdk/geometries/packing'
import { CommonComponentProps, CustomMaterialProps } from '../../common'
import { casings, CasingsGeneratorResponse } from './casings-defs'

/**
 * Casing props
 * @expand
 */
export type CasingProps = CommonComponentProps & CustomMaterialProps & {
  fallback?: (() => ReactElement<Object3D>),
  radialSegments?: number,
  sizeMultiplier?: number,
  shoeFactor?: number,
  overrideSegmentsPerMeter?: number,
  overrideSimplificationThreshold?: number,
  opacity?: number,
  priority?: number,
}

/**
 * Generic render of casings based on depths, diameters and type. Must be a child of the `Wellbore` component.
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
export const Casings = forwardRef(({
  name,
  userData,
  renderOrder = 2,
  layers = createLayers(LAYERS.OCCLUDER),
  position,
  visible,
  castShadow,
  receiveShadow,
  customMaterial,
  customDepthMaterial,
  customDistanceMaterial,
  onMaterialPropertiesChange,
  radialSegments = 16,
  sizeMultiplier = 1,
  shoeFactor = 1,
  overrideSegmentsPerMeter,
  overrideSimplificationThreshold,
  opacity = 1,
  fallback,
  priority = 0
}: CasingProps, ref: ForwardedRef<Group>) => {

  const { 
    id,
    fromMsl,
    segmentsPerMeter: defaultSegmentsPerMeter,
    simplificationThreshold: defaultSimplificationThreshold,
  } = useWellboreContext()
  const generator = useGenerator<CasingsGeneratorResponse>(casings, priority)
  const [geometry, setGeometry] = useState<BufferGeometry | null>(null)
  const [useFallback, setUseFallback] = useState(false)

  const { segmentsPerMeter, simplificationThreshold } = useMemo(() => {
    return {
      segmentsPerMeter: overrideSegmentsPerMeter !== undefined ? overrideSegmentsPerMeter : defaultSegmentsPerMeter || 0.1,
      simplificationThreshold: overrideSimplificationThreshold !== undefined ? overrideSimplificationThreshold : defaultSimplificationThreshold || 0
    }
  }, [defaultSegmentsPerMeter, defaultSimplificationThreshold, overrideSegmentsPerMeter, overrideSimplificationThreshold])
  
  const material = useMemo<Material | Material[]>(() => {
    if (customMaterial) {
      return customMaterial
    }

    const m = [
      new MeshStandardMaterial({
        color: 'black',
        metalness: 0,
        roughness: 1,
      }),
      new MeshStandardMaterial({
        color: '#555',
        metalness: 1,
        roughness: 0.5,
        transparent: true,
        opacity: 1,
      }),
      new MeshStandardMaterial({
        color: '#9a9a98',
        metalness: 1,
        roughness: 0.5,
        transparent: true,
        opacity: 1,
      })
    ]

    return m
  }, [customMaterial])

  const onPropsChange = useMemo(() => {
    return onMaterialPropertiesChange ? onMaterialPropertiesChange : (props: Record<string, any>, material: Material | Material[]) => {
      const m = material as Material[]
      m[1].opacity = props.opacity
      m[2].opacity = props.opacity
    }
  }, [onMaterialPropertiesChange])

  useEffect(() => {
    onPropsChange({ opacity }, material)
  }, [opacity, material, onPropsChange])

  useEffect(() => {
    if (generator && id) {
      generator(
        id,
        fromMsl,
        radialSegments,
        sizeMultiplier,
        shoeFactor,
        segmentsPerMeter,
        simplificationThreshold,
      ).then(response => {
        setGeometry(prev => {
          if (prev) {
            prev.dispose()
          }
          if (response?.geometry) {
            const unpackedGeometry = unpackBufferGeometry(response.geometry)
            return unpackedGeometry
          } else {
            return null
          }
        })
        if (!response) setUseFallback(true)
      })
    }
  }, [generator, id, fromMsl, radialSegments, sizeMultiplier, shoeFactor, segmentsPerMeter, simplificationThreshold])

  return (
    <group
      ref={ref}
      name={name}
      userData={userData}
      renderOrder={renderOrder}
      visible={visible}
      position={position}
    >
      {geometry && (
        <>
          <group>
            {geometry && (
              <mesh
                key={geometry.uuid}
                geometry={geometry}
                material={material}
                layers={layers}
                castShadow={castShadow}
                receiveShadow={receiveShadow}
                customDepthMaterial={customDepthMaterial}
                customDistanceMaterial={customDistanceMaterial}
              />
            )}
          </group>
        </>
      )}
      {(useFallback && fallback) && fallback() }
    </group>
  )
})