import { transfer } from 'comlink'
import { group } from 'd3-array'

import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { BufferGeometry } from 'three/webgpu'
import { completionToolsMaterialIndices } from '../components/Wellbores/CompletionTools/completion-tools-defs'
import {
  clamp,
  CompletionTool,
  createTubeGeometry,
  getTrajectory,
  packBufferGeometry,
  PositionLog,
  ReadonlyStore,
  Trajectory,
  TubeGeometryOptions,
  Tuplet,
} from '../sdk'

function createGenericShape(
  trajectory: Trajectory,
  tool: CompletionTool,
  sizeMultiplier: number,
  min: number,
  tubeOptions: TubeGeometryOptions,
) {
  const toolLength = clamp(tool.length, 0.0001, trajectory.measuredLength)

  const curveLengthFactor = 1 / trajectory.measuredLength
  const steps: Tuplet<number>[] = []

  const top = clamp(
    (tool.mdTopMsl - trajectory.measuredTop) / trajectory.measuredLength,
    0,
    1,
  )
  const bottom = clamp(
    (tool.mdBottomMsl - trajectory.measuredTop) / trajectory.measuredLength,
    0,
    1,
  )

  const radiusTop =
    sizeMultiplier * ((tool.diameterTop || tool.diameterBottom) / 2)
  const radiusBottom =
    sizeMultiplier * ((tool.diameterBottom || tool.diameterTop) / 2)
  const radiusMax =
    sizeMultiplier * ((tool.diameterMax || tool.diameterTop) / 2)
  const radiusMin = Math.min(radiusTop, radiusBottom, radiusMax)

  steps.push([top, radiusTop])
  const shiftDistance =
    Math.min((radiusMax - radiusMin) * 2, toolLength / 3) * curveLengthFactor

  if (radiusMax > radiusMin) {
    steps.push([top + shiftDistance, radiusMax])
    steps.push([bottom - shiftDistance, radiusMax])
  }
  steps.push([bottom, radiusBottom])

  const geometry = createTubeGeometry(trajectory.curve, {
    ...tubeOptions,
    from: Math.max(top, min),
    to: bottom,
    computeLengths: true,
    radiusModifier: {
      type: 'linear',
      steps,
    },
  })

  return geometry
}

export async function generateCompletionTools(
  this: ReadonlyStore,
  id: string,
  fromMsl?: number,
  radialSegments: number = 16,
  sizeMultiplier: number = 1,
  segmentsPerMeter: number = 0.1,
  simplificationThreshold: number = 0,
) {
  //console.time('build completion tools')
  const data = await this.get<any[]>('completion-tools', id)

  if (!data) return null

  const poslogMsl = await this.get<PositionLog>('position-logs', id)

  const trajectory = getTrajectory(id, poslogMsl)

  if (!trajectory) return null

  const minFrom =
    fromMsl !== undefined
      ? clamp(
          (fromMsl - trajectory.measuredTop) / trajectory.measuredLength,
          0,
          1,
        )
      : 0

  const completionTools = data
    .filter(
      (d) =>
        d.mdBottomMsl > trajectory.measuredTop &&
        (fromMsl === undefined || d.mdBottomMsl > fromMsl),
    )
    .sort((a, b) => a.mdTopMsl - b.mdTopMsl)

  const grouped = group(completionTools, (d) => d.category)

  const tubeOptions: TubeGeometryOptions = {
    startCap: true,
    endCap: true,
    radialSegments,
    computeNormals: true,
    computeUvs: true,
    segmentsPerMeter,
    simplificationThreshold,
    radius: 0.0,
  }

  const assemblyList: BufferGeometry[] = []
  const assemblyMap: number[] = []

  grouped.forEach((tools, category) => {
    const categoryGeometries = tools.map((tool) => {
      const geometry = createGenericShape(
        trajectory,
        tool,
        sizeMultiplier,
        minFrom,
        tubeOptions,
      )
      return geometry
    })

    assemblyMap.push(completionToolsMaterialIndices[category])
    assemblyList.push(mergeGeometries(categoryGeometries, false))
  })

  if (!assemblyList.length) return null

  const merged = mergeGeometries(assemblyList, true)

  merged.groups.forEach((g, i) => {
    g.materialIndex = assemblyMap[i]
  })

  const [packed, buffers] = packBufferGeometry(merged)

  //console.timeEnd('build completion tools')
  return transfer(packed, buffers)
}
