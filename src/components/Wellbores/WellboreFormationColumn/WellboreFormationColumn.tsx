import { useEffect, useMemo, useState } from 'react'
import { BackSide, BufferGeometry, FrontSide, ShaderLib, Uniform, UniformsUtils } from 'three'
import { CommonComponentProps, createLayers, LAYERS, useGenerator, useWellboreContext } from '../../../main'
import { queue, unpackBufferGeometry } from '../../../sdk'
import fragmentShader from './shaders/fragment.glsl'
import vertexShader from './shaders/vertex.glsl'
import { wellboreFormationColumn, WellboreFormationColumnResponse } from './wellbore-formation-column-defs'

/**
 * WellboreFormationColumn props
 * @expand
 */
export type WellboreFormationColumnProps = CommonComponentProps & {
  stratColumnId: string
  units?: string[]
  unitTypes?: string[]
  inverted?: boolean
  opacity?: number
  radialSegments?: number
  startRadius?: number
  formationWidth?: number
  priority?: number
}

/**
 * Renders colored tube geometeries for visualizing formations. Using picks data and strat column
 * units to generate formation intervals.
 * 
 * @example
 * <Wellbore id={wellboreId}>
 *  <WellboreFormationColumn stratColumnId="abcde" />
 * </Wellbore>
 * 
 * @see [Storybook](/videx-3d/?path=/docs/components-wellbores-wellboreformationcolumn--docs)
 * @see {@link Picks}
 * @see {@link Wellbore}
 * 
 * @group Components
 */
export const WellboreFormationColumn = ({
  name,
  userData,
  position,
  opacity = 1,
  castShadow,
  receiveShadow,
  renderOrder,
  layers = createLayers(LAYERS.NOT_EMITTER, LAYERS.OCCLUDER),
  visible,
  stratColumnId,
  units,
  unitTypes,
  inverted = true,
  radialSegments = 16,
  startRadius = 0.5,
  formationWidth = 1,
  priority = 0,
}: WellboreFormationColumnProps) => {
  const { id, fromMsl, segmentsPerMeter, simplificationThreshold } = useWellboreContext()
  const generator = useGenerator<WellboreFormationColumnResponse>(wellboreFormationColumn)

  const [geometry, setGeometry] = useState<BufferGeometry | null>(null)

  const uniforms = useMemo(() => UniformsUtils.merge([
    UniformsUtils.clone(ShaderLib['basic'].uniforms),
    {
      opacity: new Uniform(1),
    }
  ]), [])

  useEffect(() => {
    uniforms.opacity.value = opacity
  }, [opacity, uniforms])

  useEffect(() => {
    if (generator) {

      queue(() => generator(
        id,
        stratColumnId,
        segmentsPerMeter,
        fromMsl,
        units,
        unitTypes,
        startRadius,
        formationWidth,
        !inverted,
        radialSegments,
        simplificationThreshold,
      ).then((response: any) => {
        let bufferGeometry: BufferGeometry | null = null
        if (response) {
          bufferGeometry = unpackBufferGeometry(response)
        }
        setGeometry(prev => {
          if (prev) prev.dispose()
          return bufferGeometry
        })
      }), priority)

    }
  }, [
    generator,
    id,
    stratColumnId,
    fromMsl,
    units,
    unitTypes,
    segmentsPerMeter,
    simplificationThreshold,
    startRadius,
    formationWidth,
    radialSegments,
    priority,
    inverted
  ])

  if (!geometry) return null

  return (
    <mesh
      name={name}
      position={position}
      userData={userData}
      renderOrder={renderOrder}
      castShadow={castShadow}
      receiveShadow={receiveShadow}
      visible={visible}
      layers={layers}
      geometry={geometry}
    >
      {/* <meshBasicMaterial vertexColors side={BackSide} /> */}
      <shaderMaterial
        vertexColors
        side={inverted ? BackSide : FrontSide}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
        transparent={opacity === undefined || opacity < 1}
        opacity={opacity}
      />
    </mesh>
  )
}