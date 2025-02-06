import { transfer } from 'comlink'
import { group } from 'd3-array'
import { BufferGeometry } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

import {
  createTubeGeometry,
  packBufferGeometry,
  PositionLog,
  ReadonlyStore,
  TubeGeometryOptions,
} from '../sdk'

import { CasingItem, Tuplet } from '../sdk'

import { casingsMaterialIndices } from '../components/Wellbores/Casings/casings-defs'
import { clamp, getTrajectory, limit, Trajectory } from '../sdk'

function createGenericShape(
  trajectory: Trajectory,
  item: CasingItem,
  sizeMultiplier: number,
  tubeOptions: TubeGeometryOptions,
  min: number = 0
) {
  const itemLength = clamp(
    item.mdBottomMsl - item.mdTopMsl,
    0.0001,
    trajectory.measuredLength
  )

  const curveLengthFactor = 1 / trajectory.measuredLength
  const steps: Tuplet<number>[] = []

  const top = clamp(
    (item.mdTopMsl - trajectory.measuredTop) / trajectory.measuredLength,
    0,
    1
  )
  const bottom = clamp(
    (item.mdBottomMsl - trajectory.measuredTop) / trajectory.measuredLength,
    0,
    1
  )

  const radius = sizeMultiplier * (item.outerDiameter / 2)
  const radiusMin = Math.max(
    ((item.innerDiameter + (item.outerDiameter - item.innerDiameter) / 4) / 2) *
      sizeMultiplier,
    radius * 0.95
  )

  steps.push([top, radiusMin])

  const shiftDistance =
    Math.min((radius - radiusMin) * 2, itemLength / 3) * curveLengthFactor
  steps.push([top + shiftDistance, radius])
  steps.push([bottom - shiftDistance, radius])

  steps.push([bottom, radiusMin])

  const geometry = createTubeGeometry(trajectory.curve, {
    ...tubeOptions,
    from: Math.max(top, min),
    to: bottom,
    innerRadius: (item.innerDiameter / 2) * sizeMultiplier,
    radiusModifier: {
      type: 'linear',
      steps,
    },
  })

  return geometry
}

function createShoe(
  trajectory: Trajectory,
  shoe: CasingItem,
  sizeMultiplier: number,
  tubeOptions: TubeGeometryOptions,
  shoeFactor: number,
  min: number = 0
) {
  const shoeTop = clamp(
    (shoe.mdTopMsl - trajectory.measuredTop) / trajectory.measuredLength,
    0,
    1
  )
  const shoeBottom = clamp(
    (shoe.mdBottomMsl - trajectory.measuredTop) / trajectory.measuredLength,
    0,
    1
  )
  const shoeOuterRadiusTop = (shoe.outerDiameter / 2) * sizeMultiplier
  const shoeOuterRadiusBottom = shoeOuterRadiusTop * shoeFactor
  const shoeInnerRadius = (shoe.innerDiameter / 2) * sizeMultiplier

  const shoeGeometry = createTubeGeometry(trajectory.curve, {
    ...tubeOptions,
    from: Math.max(shoeTop, min),
    to: shoeBottom,
    radiusModifier: {
      type: 'linear',
      steps: [
        [shoeTop, shoeOuterRadiusTop],
        [shoeTop + (shoeBottom - shoeTop) / 4, shoeOuterRadiusTop],
        [shoeBottom, shoeOuterRadiusBottom],
      ],
    },
    innerRadius: shoeInnerRadius,
  })

  return shoeGeometry
}

export async function generateCasings(
  this: ReadonlyStore,
  id: string,
  fromMsl?: number,
  radialSegments: number = 16,
  sizeMultiplier: number = 1,
  shoeFactor: number = 2,
  segmentsPerMeter: number = 0.1,
  simplificationThreshold: number = 0
) {
  const data = await limit(() => this.get<CasingItem[]>('casings', id))

  if (!data) return null

  const poslogMsl = await limit(() =>
    this.get<PositionLog>('position-logs', id)
  )

  const trajectory = getTrajectory(id, poslogMsl)

  if (!trajectory) return null

  const minFrom =
    fromMsl !== undefined
      ? clamp(
          (fromMsl - trajectory.measuredTop) / trajectory.measuredLength,
          0,
          1
        )
      : 0

  const tubeOptions: TubeGeometryOptions = {
    startCap: true,
    endCap: true,
    radialSegments,
    addGroups: true,
    computeNormals: true,
    computeUvs: true,
    simplificationThreshold,
    segmentsPerMeter,
  }

  const assemblyList: BufferGeometry[] = []
  const assemblyMap: number[] = []

  const casingItems = data
    .filter(
      (d) =>
        d.mdBottomMsl > trajectory.measuredTop &&
        (fromMsl === undefined || d.mdBottomMsl > fromMsl)
    )
    .sort((a, b) => a.outerDiameter - b.outerDiameter)

  if (casingItems.length === 0) return null

  const grouped = group(casingItems, (d) => ({
    category: ['Shoe', 'Casing'].includes(d.type) ? d.type : 'Generic',
    dimmension: d.outerDiameter,
  }))

  grouped.forEach((items, key) => {
    const categoryGeometries = items.map((item) => {
      let geometry: BufferGeometry

      if (key.category === 'Shoe') {
        geometry = createShoe(
          trajectory,
          item,
          sizeMultiplier,
          tubeOptions,
          shoeFactor,
          minFrom
        )
      } else {
        geometry = createGenericShape(
          trajectory,
          item,
          sizeMultiplier,
          tubeOptions,
          minFrom
        )
      }
      return geometry
    })

    assemblyMap.push(casingsMaterialIndices[key.category])
    assemblyList.push(mergeGeometries(categoryGeometries, false))
  })

  const merged = mergeGeometries(assemblyList, true)

  merged.groups.forEach((g, i) => {
    g.materialIndex = assemblyMap[i]
  })

  const [packed, buffers] = packBufferGeometry(merged)

  const casingData = {
    geometry: packed,
  }

  //console.log(casingData)
  return transfer(casingData, buffers)
}
