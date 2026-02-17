import { ReactElement, useEffect, useMemo, useState } from 'react'
import { BufferGeometry, Material, MeshLambertNodeMaterial, MeshStandardMaterial, MeshStandardNodeMaterial, Object3D } from 'three/webgpu'
import { useGenerator } from '../../../hooks/useGenerator'
import { useWellboreContext } from '../../../hooks/useWellboreContext'
import { unpackBufferGeometry } from '../../../sdk/geometries/packing'
import { CommonComponentProps, CustomMaterialProps } from '../../common'
import { completionTools, CompletionToolsGeneratorResponse } from './completion-tools-defs'
import { ScreenMaterial } from './Screen/screen-material'

/**
 * CompletionTools props
 * @expand
 */
export type CompletionToolsProps = CommonComponentProps & CustomMaterialProps & {
  radialSegments?: number,
  sizeMultiplier?: number,
  overrideSegmentsPerMeter?: number,
  overrideSimplificationThreshold?: number,
  fallback?: (() => ReactElement<Object3D>),
  priority?: number,
}

/**
 * Generic render of completion tools based on depths, diameters and type. Must be a child of the `Wellbore` component.
 * 
 * @example
 * <Wellbore id={wellbore.id}>
 *  <CompletionTools sizeMultiplier={5} /> 
 * </Wellbore>
 * 
 * @remarks
 * The `fallback` prop may be used to render a different component if there is no completion tool data available for the wellbore.
 * 
 * @see {@link Wellbore}
 * 
 * @group Components
 */
export const CompletionTools = ({
  name,
  userData,
  renderOrder,
  layers,
  position,
  visible,
  castShadow,
  receiveShadow,
  customMaterial,
  customDepthMaterial,
  customDistanceMaterial,
  radialSegments = 16,
  sizeMultiplier = 1,
  overrideSegmentsPerMeter,
  overrideSimplificationThreshold,
  priority = 0,
  fallback,
}: CompletionToolsProps) => {
  const {
    id,
    fromMsl,
    segmentsPerMeter: defaultSegmentsPerMeter,
    simplificationThreshold: defaultSimplificationThreshold,
  } = useWellboreContext()

  const generator = useGenerator<CompletionToolsGeneratorResponse>(completionTools, priority)
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
      // blank pipe
      new MeshStandardNodeMaterial({
        color: '#999',
        metalness: 1,
        roughness: 0.25
      }),
      // tube
      new MeshStandardNodeMaterial({
        color: '#999',
        metalness: 0.8,
        roughness: 0.5,
      }),
      // packer
      new MeshStandardNodeMaterial({
        color: '#000',
        metalness: 0,
        roughness: 0.95,
      }),
      // gauge
      new MeshStandardNodeMaterial({
        color: '#097',
        metalness: 0,
        roughness: 1,
      }),
      // plug
      new MeshStandardNodeMaterial({
        color: '#444',
        metalness: 0.2,
        roughness: 1,
      }),
      // pbr
      new MeshStandardNodeMaterial({
        color: '#ccc',
        metalness: 0,
        roughness: 1,
        transparent: true,
        opacity: 0.9
      }),
      // safety valve
      new MeshStandardNodeMaterial({
        color: '#c00',
        metalness: 0.5,
        roughness: 0.75,
      }),
      // spm
      new MeshStandardMaterial({
        color: '#4e3e86',
        metalness: 0.5,
        roughness: 0.75,
      }),
      // screen
      new ScreenMaterial({
        color: '#777',
        altColor: '#fff',
      }),
      // tracer
      new ScreenMaterial({
        color: '#777',
        altColor: 'orange',
      }),
      // unknown
      new MeshLambertNodeMaterial({
        color: '#ccc',
      })
    ]

    return m
  }, [customMaterial])

  useEffect(() => {
    if (generator && id) {
      generator(id, fromMsl, radialSegments, sizeMultiplier, segmentsPerMeter, simplificationThreshold).then(response => {
        setGeometry(prev => {
          if (prev) {
            prev.dispose()
          }
          if (response) {
            const unpackedGeometry = unpackBufferGeometry(response)
            return unpackedGeometry
          } else {
            return null
          }
        })
        if (!response) setUseFallback(true)
      })
    }
  }, [generator, id, fromMsl, sizeMultiplier, segmentsPerMeter, simplificationThreshold, radialSegments])

  return (
    <group
      name={name}
      userData={userData}
      renderOrder={renderOrder}
      visible={visible}
      position={position}
    >
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
      {useFallback && fallback && fallback()}
    </group>
  )
}