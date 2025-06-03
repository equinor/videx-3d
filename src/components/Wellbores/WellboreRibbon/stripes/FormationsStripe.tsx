import { useContext, useEffect, useMemo, useState } from 'react'
import { Color, DataTexture, DoubleSide, Texture, Uniform, Vector2, Vector3 } from 'three'
import { GlyphsContext } from '../../../../contexts/GlyphsContext'
import { useData } from '../../../../hooks/useData'
import { createFormationIntervals, getUnitPicks, mergeFormationIntervals } from '../../../../sdk'
import { EncodedTextTexture } from '../../../../sdk/utils/glyphs'
import { WellboreContext } from '../../Wellbore/WellboreContext'
import { WellboreRibbonContext } from '../WellboreRibbonContext'
import fragmentShader from '../shaders/formations.glsl'
import vertexShader from '../shaders/vertex.glsl'

export type FormationsStripeProps = {
  width: number
  offset: number
  stratColumnId: string
  level?: number
}

type Unit = {
  index: number
  color: Color
}

type FormationData = {
  text: EncodedTextTexture
  intervals: Vector3[]
  units: Unit[]
}

export const FormationsStripe = ({ width, offset, stratColumnId, level }: FormationsStripeProps) => {
  const store = useData()
  const ribbonContext = useContext(WellboreRibbonContext)
  const glyphContext = useContext(GlyphsContext)

  const { id } = useContext(WellboreContext)

  const [formationData, setFormationData] = useState<FormationData | null>(null)

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
    if (store && glyphContext) {
      getUnitPicks(id, stratColumnId, store, true).then(picksData => {
        if (picksData) {
          const surfaceIntervals = createFormationIntervals(picksData.matched, picksData.wellbore.depthMdMsl)
          let filteredIntervals = surfaceIntervals
          if (level !== undefined) {
            filteredIntervals = surfaceIntervals.filter(d => d.unit.level === level)
          }
          const mergedIntervals = mergeFormationIntervals(filteredIntervals) 
          const unitsMap = new Map<string, number>()
          const units: Unit[] = []
          const labels: string[] = []

          const intervals: Vector3[] = []
          mergedIntervals.forEach(s => {
            const label = s.unit.name
            let index = unitsMap.get(label)
            if (index === undefined) {

              index = units.length
              const unit = {
                index,
                color: new Color(s.unit.color)
              }
              unitsMap.set(label, index)
              units.push(unit)
              labels.push(label)
            }
            intervals.push(new Vector3(s.mdMslTop, s.mdMslBottom, index))
          })

          const textTexture = glyphContext.encodeTextTexture(labels)
          setFormationData(prev => {
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
      }).catch(console.error)
    }
  }, [store, stratColumnId, id, glyphContext, level])

  useEffect(() => {
    uniforms.offset.value = offset
    uniforms.width.value = width
    if (ribbonContext) {
      uniforms.size.value.set(width, ribbonContext.trajectory.measuredLength)
      uniforms.direction.value.set(...ribbonContext.direction)
      uniforms.startDepth.value = ribbonContext.trajectory.measuredTop
    }
    if (formationData) {
      uniforms.intervals.value = formationData.intervals
      uniforms.units.value = formationData.units
      uniforms.textTexture.value = formationData.text.texture
      uniforms.textPointersCount.value = formationData.text.textPointersCount
      uniforms.textPointersOffset.value = formationData.text.textPointersOffset
    }
  }, [uniforms, width, offset, formationData, ribbonContext])



   useEffect(() => {
    if (glyphContext) {
      uniforms.glyphAtlas.value = glyphContext.glyphAtlas
    }
  }, [uniforms, glyphContext])

  useEffect(() => {
    
  }, [ribbonContext, uniforms, width])

  if (!ribbonContext || !glyphContext || !formationData) return null

  return (
    <mesh frustumCulled={false} geometry={ribbonContext.geometry}>
      <shaderMaterial
        defines={{
          GLYPHS_LENGTH: glyphContext.glyphsCount,
          INTERVALS_LENGTH: formationData.intervals.length,
          UNITS_LENGTH: formationData.units.length,
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