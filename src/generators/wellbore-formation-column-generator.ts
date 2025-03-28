import { transfer } from 'comlink'
import { BufferAttribute, BufferGeometry, Color } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import {
  createTubeGeometry,
  getTrajectory,
  limit,
  packBufferGeometry,
  PackedBufferGeometry,
  PositionLog,
  ReadonlyStore,
  TubeGeometryOptions,
} from '../sdk'
import {
  createFormationIntervals,
  getUnitPicks,
  mergeFormationIntervals,
} from '../sdk/data/helpers/picks-helpers'

export async function generateWellboreFormationColumnGeometries(
  this: ReadonlyStore,
  wellboreId: string,
  stratColumnId: string,
  segmentsPerMeter: number,
  fromMsl?: number,
  units?: string[],
  unitTypes?: string[],
  startRadius: number = 0.5,
  formationWidth: number = 2,
  caps: boolean = true,
  radialSegments: number = 16,
  simplificationThreshold: number = 0
): Promise<PackedBufferGeometry | null> {
  const picksData = await getUnitPicks(wellboreId, stratColumnId, this, true)

  if (!picksData) return null

  const surfaceIntervals = createFormationIntervals(picksData.matched, picksData.wellbore.depthMdMsl)
    .filter(d => 
      (unitTypes === undefined || unitTypes.includes(d.unit.unitType)) &&
      (units === undefined || units.includes(d.unit.name))
  )

  if (!surfaceIntervals.length) return null

  const mergedIntervals = mergeFormationIntervals(surfaceIntervals)
  
  const poslogMsl = await limit(() =>
    this.get<PositionLog>('position-logs', wellboreId)
  )

  const trajectory = getTrajectory(wellboreId, poslogMsl)

  if (!trajectory) return null

  const options: TubeGeometryOptions = {
    startCap: caps,
    endCap: caps,
    segmentsPerMeter,
    simplificationThreshold,
    radialSegments,
    computeRelativeLengths: true,
  }

  //const maxLevel = max(mergedIntervals, (d) => d.unit.level)!

  const geometries: BufferGeometry[] = []

  mergedIntervals.forEach((interval) => {
    if (fromMsl === undefined || interval.mdMslBottom > fromMsl) {
      let top = interval.mdMslTop
      if (fromMsl !== undefined && fromMsl > top) {
        top = fromMsl
      }
      const from = trajectory.getPositionAtDepth(top, true)
      const to = trajectory.getPositionAtDepth(interval.mdMslBottom, true)
      if (from !== null && to !== null) {
        const radius = formationWidth + startRadius
        const color = new Color(interval.unit.color)
        
        const geometery = createTubeGeometry(trajectory.curve, {
          ...options,
          radius,
          from,
          to,
        })

        if (geometery.attributes.position.count) {
          const colors = new Float32Array(
            geometery.attributes.position.count * 3
          )

          for (let i = 0; i < geometery.attributes.position.count; i++) {
            color.toArray(colors, i * 3)
          }

          geometery.attributes.color = new BufferAttribute(colors, 3)
          geometries.push(geometery)
        }
      }
    }
  })

  if (!geometries.length) return null

  const geometry = mergeGeometries(geometries, false)
  const [packed, buffers] = packBufferGeometry(geometry)

  return transfer(packed, buffers)
}
