import { BufferAttribute, BufferGeometry } from 'three'
import { clamp } from '../../utils/numbers'
import { calculateFrenetFrames, Curve3D, FrenetFrame } from './curve-3d'

export type RibbonGeometryOptions = {
  from?: number
  to?: number
  segmentsPerMeter?: number
}

function calculateSegments(curve: Curve3D, from: number, to: number, segmentsPerMeter: number) {
  const segments: number[] = [] 

  const curveLength = curve.length
  const deltaPos = to - from
  const segmentLength = deltaPos * curveLength
  const nSegments = Math.floor(segmentsPerMeter * segmentLength)
  const stepSize = deltaPos / nSegments

  for (let i = 0; i <= nSegments; i++) {
    const curvePosition = from + i * stepSize
    segments.push(curvePosition)
  }

  const frenetFrames = calculateFrenetFrames(curve, segments)

  return frenetFrames
}


function generateRibbon(
  segments: FrenetFrame[]
) {

  let vertexCount = 0
  let indexCount = 0
  
  const vertices = new Float32Array(segments.length * 2 * 3)
  const tangents = new Float32Array(vertices.length)
  const normals = new Float32Array(vertices.length)
  const binormals = new Float32Array(vertices.length)
  const uvs = new Float32Array(segments.length * 2 * 2)
  const indices = new Uint32Array((segments.length - 1) * 6)
  
  let idx = 0
  
  const dist = 0.0
  
  const generateRibbonSegment = (segment: FrenetFrame) => {
    
    const vi = idx * 3 * 2
    const ii = (idx - 1) * 6
    const ui = idx * 2 * 2

    // side 1
    vertices[vi] = segment.position[0] + dist * segment.normal[0]
    vertices[vi + 1] = segment.position[1] + dist * segment.normal[1]
    vertices[vi + 2] = segment.position[2] + dist * segment.normal[2]

    tangents[vi] = segment.tangent[0]
    tangents[vi + 1] = segment.tangent[1]
    tangents[vi + 2] = segment.tangent[2]

    normals[vi] = segment.normal[0]
    normals[vi + 1] = segment.normal[1]
    normals[vi + 2] = segment.normal[2]
    
    binormals[vi] = segment.binormal[0]
    binormals[vi + 1] = segment.binormal[1]
    binormals[vi + 2] = segment.binormal[2]

    uvs[ui] = 1
    uvs[ui + 1] = 1 - segment.curvePosition


    // side 2
    vertices[vi + 3] = segment.position[0] - dist * segment.normal[0]
    vertices[vi + 4] = segment.position[1] - dist * segment.normal[1]
    vertices[vi + 5] = segment.position[2] - dist * segment.normal[2]

    tangents[vi + 3] = segment.tangent[0]
    tangents[vi + 4] = segment.tangent[1]
    tangents[vi + 5] = segment.tangent[2]

    normals[vi + 3] = segment.normal[0]
    normals[vi + 4] = segment.normal[1]
    normals[vi + 5] = segment.normal[2]

    binormals[vi + 3] = -segment.binormal[0]
    binormals[vi + 4] = -segment.binormal[1]
    binormals[vi + 5] = -segment.binormal[2]

    uvs[ui + 2] = 0
    uvs[ui + 3] = 1 - segment.curvePosition

    if (idx > 0) {
      indices[ii] = vertexCount - 2
      indices[ii + 1] = vertexCount
      indices[ii + 2] = vertexCount - 1

      indices[ii + 3] = vertexCount - 1
      indices[ii + 4] = vertexCount
      indices[ii + 5] = vertexCount + 1
      indexCount += 6
    }

    vertexCount += 2
    idx++
  }

  for (let i = 0; i < segments.length; i++) {
    generateRibbonSegment(segments[i])
  }

  return {
    indexCount,
    vertexCount,
    vertices,
    tangents,
    normals,
    binormals,
    uvs,
    indices,
  }
}

/**
 *  experimental - may be removed or replaced 
 */
export function createRibbonGeometry(
  curve: Curve3D,
  options: RibbonGeometryOptions = {}
) {
  const from = clamp(options.from || 0, 0, 1)
  const to = clamp(options.to || 1)
  const segmentsPerMeter = options.segmentsPerMeter || 0.1

  if (to < from)
    throw Error('Value of "from" must be less than the value of "to"!')

  const geometry = new BufferGeometry()

  const segments = calculateSegments(curve, from, to, segmentsPerMeter)

  const attributes = generateRibbon(segments)

  geometry.setAttribute('position', new BufferAttribute(attributes.vertices, 3))
  geometry.setAttribute('tangent', new BufferAttribute(attributes.tangents, 3))
  geometry.setAttribute('normal', new BufferAttribute(attributes.normals, 3))
  geometry.setAttribute('binormal', new BufferAttribute(attributes.binormals, 3))
  geometry.setAttribute('uv', new BufferAttribute(attributes.uvs, 2))
  geometry.setIndex(new BufferAttribute(attributes.indices, 1))
  
  return geometry
}
