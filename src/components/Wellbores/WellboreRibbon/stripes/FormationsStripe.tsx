import { useContext, useEffect, useMemo, useState } from 'react'
import { Color, DataTexture, DoubleSide, Texture, Uniform, Vector2, Vector3 } from 'three'
import { GlyphsContext } from '../../../../contexts/GlyphsContext'
import { Formation } from '../../../../sdk'
import { mergeFormationIntervals } from '../../../../sdk/data/helpers/formations-helpers'
import { EncodedTextTexture } from '../../../../sdk/utils/glyphs'
import { WellboreRibbonContext } from '../WellboreRibbonContext'
import fragmentShader from '../shaders/formations.glsl'
import vertexShader from '../shaders/vertex.glsl'

/**
 * FormationsStripe props
 * @expand
 */
export type FormationsStripeProps = {
  width: number
  offset: number
  formationData: Formation[] | null
  level?: number
}

type Unit = {
  index: number
  color: Color
}

type FormationStripeData = {
  text: EncodedTextTexture
  intervals: Vector3[]
  units: Unit[]
}

/**
 * This is a stripe component used with the WellboreRibbon component for visualizing 
 * formations along a wellbore trajectory.
 * 
 * @example
 * <WellboreRibbon>
 *  <FormationsStripe ... /> 
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
export const FormationsStripe = ({ width, offset, formationData, level }: FormationsStripeProps) => {

  const ribbonContext = useContext(WellboreRibbonContext)
  const glyphContext = useContext(GlyphsContext)

  const [formationStripeData, setFormationStripeData] = useState<FormationStripeData | null>(null)

  const uniforms = useMemo(() => {
    return {
      size: new Uniform(new Vector2()),
      direction: new Uniform(new Vector3(0, -1, 0)),
      startDepth: new Uniform(0),
      width: new Uniform(20),
      offset: new Uniform(0),
      glyphAtlas: new Uniform<Texture | null>(null),
      textTexture: new Uniform<DataTexture | null>(null),
      textPointersCount: new Uniform(0),
      textPointersOffset: new Uniform(0),
      intervals: new Uniform<Vector3[]>([new Vector3()]),
      units: new Uniform<Unit[]>([{ index: 0, color: new Color() }])
    }
  }, [])


  useEffect(() => {
    if (formationData && glyphContext) {

      if (formationData) {
        let filteredIntervals = formationData
        if (level !== undefined) {
          filteredIntervals = formationData.filter(d => d.level === level)
        }

        const mergedIntervals = mergeFormationIntervals(filteredIntervals)
        const unitsMap = new Map<string, number>()
        const units: Unit[] = []
        const labels: string[] = []

        const intervals: Vector3[] = []
        mergedIntervals.forEach(s => {
          const label = s.name
          let index = unitsMap.get(label)
          if (index === undefined) {

            index = units.length
            const unit = {
              index,
              color: new Color(s.color)
            }
            unitsMap.set(label, index)
            units.push(unit)
            labels.push(label)
          }
          intervals.push(new Vector3(s.mdMslFrom, s.mdMslTo, index))
        })

        const textTexture = glyphContext.encodeTextTexture(labels)
        setFormationStripeData(prev => {
          if (prev) {
            prev.text.texture.dispose()
          }
          return {
            intervals,
            text: textTexture,
            units
          }
        })

      }
    }
  }, [formationData, glyphContext, level])

  useEffect(() => {
    uniforms.offset.value = offset
    uniforms.width.value = width
    if (ribbonContext) {
      uniforms.size.value.set(width, ribbonContext.trajectory.measuredLength)
      uniforms.direction.value.set(...ribbonContext.direction)
      uniforms.startDepth.value = ribbonContext.trajectory.measuredTop
    }
    if (formationStripeData) {
      uniforms.intervals.value = formationStripeData.intervals
      uniforms.units.value = formationStripeData.units
      uniforms.textTexture.value = formationStripeData.text.texture
      uniforms.textPointersCount.value = formationStripeData.text.textPointersCount
      uniforms.textPointersOffset.value = formationStripeData.text.textPointersOffset
    }
  }, [uniforms, width, offset, formationStripeData, ribbonContext])



  useEffect(() => {
    if (glyphContext) {
      uniforms.glyphAtlas.value = glyphContext.glyphAtlas
    }
  }, [uniforms, glyphContext])

  useEffect(() => {

  }, [ribbonContext, uniforms, width])

  if (!ribbonContext || !glyphContext || !formationStripeData) return null

  return (
    <mesh frustumCulled={false} geometry={ribbonContext.geometry}>
      <shaderMaterial
        defines={{
          GLYPHS_LENGTH: glyphContext.glyphsCount,
          INTERVALS_LENGTH: formationStripeData.intervals.length,
          UNITS_LENGTH: formationStripeData.units.length,
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