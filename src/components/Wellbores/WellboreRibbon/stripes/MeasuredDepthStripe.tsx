import { useContext, useEffect, useMemo } from 'react'
import { DoubleSide, Texture, Uniform, Vector2, Vector3 } from 'three'
import { GlyphsContext } from '../../../../contexts/GlyphsContext'
import { WellboreRibbonContext } from '../WellboreRibbonContext'
import fragmentShader from '../shaders/measured-depth.glsl'
import vertexShader from '../shaders/vertex.glsl'

/**
 * MeasuredDepthStripe props
 * @expand
 */
export type MeasuredDepthStripeProps = {
  width: number
  offset: number
  stepSize?: number
}

/**
 * This is a stripe component used with the WellboreRibbon component for adding a measured
 * depth scale along a wellbore trajectory.
 * 
 * @example
 * <WellboreRibbon>
 *  <MeasuredDepthStripe ... /> 
 * </WellboreRibbon>
 * 
 * @remarks
 * This is an experimental component and may be changed/removed
 * 
 * @see [Storybook](/videx-3d/?path=/docs/components-wellbores-wellboreformationcolumn--docs)
 * @see {@link WellboreRibbon}
 * @see {@link WellboreRibbonContext}
 * 
 * @group Components
 */
export const MeasuredDepthStripe = ({ width, offset, stepSize = 50 }: MeasuredDepthStripeProps) => {

  const ribbonContext = useContext(WellboreRibbonContext)
  const glyphContext = useContext(GlyphsContext)

  const uniforms = useMemo(() => {
    return {
      direction: new Uniform(new Vector3(0, -1, 0)),
      width: new Uniform(20),
      offset: new Uniform(0),
      fontSize: new Uniform(3),
      size: new Uniform(new Vector2()),
      startDepth: new Uniform(0),
      stepSize: new Uniform(50),
      glyphAtlas: new Uniform<Texture | null>(null),
      digits: new Uniform([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    }
  }, [])

  useEffect(() => {
    if (glyphContext) {
      uniforms.glyphAtlas.value = glyphContext.glyphAtlas
      uniforms.digits.value = [...glyphContext.encodeText('0123456789.-').indices]
    }
  }, [uniforms, glyphContext])

  useEffect(() => {
    uniforms.width.value = width
    uniforms.offset.value = offset
    uniforms.stepSize.value = stepSize
  }, [uniforms, width, offset, stepSize])


  useEffect(() => {
    if (ribbonContext) {
      uniforms.size.value.set(width, ribbonContext.trajectory.measuredLength)
      uniforms.startDepth.value = ribbonContext.trajectory.measuredTop
    }
  }, [uniforms, ribbonContext, width])

  useEffect(() => {
    if (ribbonContext) {
      uniforms.direction.value.set(...ribbonContext.direction)
    }
  }, [ribbonContext, uniforms])

  if (!ribbonContext || !glyphContext) return null

  return (
    <mesh frustumCulled={false} geometry={ribbonContext.geometry}>
      <shaderMaterial
        defines={{
          GLYPHS_LENGTH: glyphContext.glyphsCount
        }}
        uniforms={uniforms}
        uniformsGroups={[glyphContext.glyphData]}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        side={DoubleSide}
        transparent
      />
    </mesh>
  )
  
}