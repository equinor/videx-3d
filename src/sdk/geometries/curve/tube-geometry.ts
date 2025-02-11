import { BufferAttribute, BufferGeometry } from 'three'
import { lerp } from 'three/src/math/MathUtils.js'
import { Tuplet, Vec3 } from '../../types/common'
import { clamp } from '../../utils/numbers'
import { PI } from '../../utils/trigonometry'
import { copyVec3, crossVec3, dotVec3, normalizeVec3, rotateVec3 } from '../../utils/vector-operations'
import { calculateFrenetFrames, Curve3D, FrenetFrame } from './curve-3d'

export type RadiusModifier = {
  type: 'linear' | 'stepped',
  steps: Tuplet<number>[]
}

export type AttributeOptions = {
  computeNormals?: boolean,
  computeUvs?: boolean,
}

type Geometry = {
  vertexCount: number,
  indexCount: number,
  vertices: number[],
  indices: number[],
  normals: number[] | null,
  uvs: number[] | null,
}

export type TubeGeometryOptions = AttributeOptions & {
  radialSegments?: number,
  from?: number,
  to?: number,
  startCap?: boolean,
  endCap?: boolean,
  radius?: number, 
  segmentsPerMeter?: number,
  radiusModifier?: RadiusModifier, 
  simplificationThreshold?: number,
  computeLengths?: boolean,
  computeCurveNormals?: boolean,
  computeCurveTangents?: boolean,
  computeCurveBinormals?: boolean,
  innerRadius?: number,
  thickness?: number,
  addGroups?: boolean,
}

type TubeSegment = FrenetFrame & {
  radius: number,
  theta: number,
}

function getStepsAtPosition(position: number, steps: Tuplet<number>[]) {
  let toIndex = steps.findIndex(step => step[0] > position)
  if (toIndex === -1) {
    toIndex = steps.length - 1
  }

  let fromIndex = toIndex - 1
  if (fromIndex < 0) {
    fromIndex = 0
  }
  const fromStep = steps[fromIndex]
  const toStep = steps[toIndex]

  return [fromStep, toStep]
}

function interpolateRadius(position: number, fromStep: Tuplet<number>, toStep: Tuplet<number>) {
  if (fromStep[0] === toStep[0]) return toStep[1]
  const delta = toStep[0] - fromStep[0]
  const t = clamp((position - fromStep[0]) / delta, 0, 1)
  
  return lerp(fromStep[1], toStep[1], t)
}

function calculateTubeSegments(
  curve: Curve3D,
  modifierType: string,
  from: number,
  to: number,
  radius: number,
  radiSteps: Tuplet<number>[],
  segmentsPerMeter: number,
  simplificationThreshold: number,
) : TubeSegment[] {
  
  // determine radius steps
  const steps: Tuplet<number>[] = [] 
  
  if (modifierType === 'none' || radiSteps.length === 0) {
    steps.push([from, radius], [to, radius])
  } else {
    let left: Tuplet<number> = [0, radius], right: Tuplet<number> = [1, radius]

    // find first step within range
    const rightOfFromIndex = radiSteps.findIndex(s => s[0] > from)

    if (rightOfFromIndex === -1) {
      left = radiSteps[radiSteps.length - 1]
    } else {
      if (rightOfFromIndex > 0) {
        left = radiSteps[rightOfFromIndex - 1]
      }
      right = radiSteps[rightOfFromIndex]
    }

    const startRadius = modifierType === 'linear' ? interpolateRadius(from, left, right) : left[1]
    
    steps.push([from, startRadius])

    for (let i = rightOfFromIndex; i >= 0 && i < radiSteps.length; i++) {
      const step = radiSteps[i]
      if (step[0] < to) {
        steps.push(step)
      } else {
        if (modifierType === 'linear') {
          steps.push([to, interpolateRadius(to, steps[steps.length - 1], step)])
        } else {
          steps.push([to, steps[steps.length - 1][1]])
        }
        break;
      }
    }

    if (steps[steps.length - 1][0] < to) {
      if (modifierType === 'linear') {
        steps.push([to, interpolateRadius(to, steps[steps.length - 1], [1, radius])])
      } else {
        steps.push([to, steps[steps.length - 1][1]])
      }
    }
  }
  
  //console.log(steps)

  const curveLength = curve.length

  const segments: number[][] = []

  for (let i = 0; i < steps.length - 1; i++) {
    const n = i + 1
    const [startPos, startRadius] = steps[i]
    const [endPos, endRadius] = steps[n]

    const deltaPos = endPos - startPos    
    const segmentLength = deltaPos * curveLength
    const deltaRadius = endRadius - startRadius

    const angle = Math.atan2(deltaRadius, segmentLength)
        
    const nSegments = Math.floor(segmentsPerMeter * segmentLength)
    const stepSize = deltaPos / nSegments

    // add first segment of step
    segments.push([startPos, startRadius, modifierType === 'linear' ? angle : 0])
    let guideTangent = simplificationThreshold ? curve.getTangentAt(startPos) : null

    // interpolate in-between segments
    for (let j = 1; j < nSegments; j++) {
      const curvePosition = startPos + j * stepSize;
      const candidateTangent = simplificationThreshold ? curve.getTangentAt(curvePosition) : null
      if (!simplificationThreshold || Math.abs(dotVec3(guideTangent!, candidateTangent!)) < (1 - simplificationThreshold)) {
        const [fromStep, toStep] = getStepsAtPosition(curvePosition, steps)
        const calculatedRadius = modifierType === 'linear' ? interpolateRadius(curvePosition, fromStep, toStep) : fromStep[1]
        segments.push([curvePosition, calculatedRadius, modifierType === 'linear' ? angle : 0])
        guideTangent = candidateTangent
      }
    }

    // add end segments if radius is modulated, as we need extra vertices along the transitions for different normals
    if (n < steps.length) {
      if (modifierType === 'linear') {
        segments.push([endPos, endRadius, modifierType === 'linear' ? angle : 0])  
      }
      else if (modifierType === 'stepped') {
        const steppedAngle = angle < 0 ? -PI / 2 : PI / 2
        segments.push([endPos, startRadius, 0], [endPos, startRadius, steppedAngle], [endPos, endRadius, steppedAngle])
      }
    }

    // if radius is not modulated, we need to add the final segment
    if (n === steps.length - 1 && modifierType === 'none') {
      segments.push([endPos, endRadius, angle])
    }
  }
  
  const frenetFrames = calculateFrenetFrames(curve, segments.map(s => s[0]))

  return segments.map((s, i) => ({
    radius: s[1],
    theta: s[2],
    ...frenetFrames[i]
  }))
}

function generateCap(segment: TubeSegment, radialSegments: number, clockwise = true, options: AttributeOptions, indexOffset = 0): Geometry {
  let vertexCount = 0, indexCount = 0
  //if (!segment) debugger
  const vertices: number[] = []
  const indices: number[] = []

  const normals: number[] | null = options.computeNormals ? [] : null
  const uvs: number[] | null = options.computeUvs ? [] : null
  
  const capNormal = clockwise ? [-segment.tangent[0], -segment.tangent[1], -segment.tangent[2]] : segment.tangent

  vertices.push(...segment.position)
  vertexCount ++

  if (normals) normals.push(...capNormal)
  if (uvs) uvs.push(0.5, 0.5)

  for (let j = 0; j <= radialSegments; j++) {
    const v = j / radialSegments * PI * 2

    const sin = Math.sin(v);
    const cos = - Math.cos(v);

    const vector = normalizeVec3([
      cos * segment.normal[0] + sin * segment.binormal[0],
      cos * segment.normal[1] + sin * segment.binormal[1],
      cos * segment.normal[2] + sin * segment.binormal[2],
    ]);


    // vertex
    vertices.push(
      segment.position[0] + segment.radius * vector[0],
      segment.position[1] + segment.radius * vector[1],
      segment.position[2] + segment.radius * vector[2],
    );
    vertexCount ++

    // normal
    if (normals) normals.push(...capNormal);

    // uvs
    if (uvs) {
      const uv = [(cos + 1) / 2, (sin + 1) / 2];

      if (clockwise) {
        uv[0] = 1 - uv[0];
      }

      uvs.push(...uv);
    }
  }

  // indices
  for (let i = 1; i <= radialSegments; i++) {
    const v3 = 0; // index of center vertex
    let v1, v2;

    if (clockwise) {
      v1 = i + v3;
      v2 = i + v3 + 1;
    } else {
      v1 = i + v3 + 1;
      v2 = i + v3;
    }
    indices.push(v1 + indexOffset, v2 + indexOffset, v3 + indexOffset);
    indexCount += 3;
  }

  return { vertices, indices, normals, uvs, vertexCount, indexCount }

}

function generateRingCap(outerSegment: TubeSegment, innerSegment: TubeSegment, radialSegments: number, clockwise = true, options: AttributeOptions, indexOffset = 0): Geometry {
  let vertexCount = 0, indexCount = 0

  const vertices: number[] = []
  const indices: number[] = []

  const normals: number[] | null = options.computeNormals ? [] : null
  const uvs: number[] | null = options.computeUvs ? [] : null
  
  const capNormal = clockwise ? [-outerSegment.tangent[0], -outerSegment.tangent[1], -outerSegment.tangent[2]] : outerSegment.tangent

  const innerRadiusRatio = innerSegment.radius / outerSegment.radius

  for (let j = 0; j <= radialSegments; j++) {
    const v = j / radialSegments * PI * 2

    const sin = Math.sin(v)
    const cos = - Math.cos(v)

    const vector = normalizeVec3([
      cos * outerSegment.normal[0] + sin * outerSegment.binormal[0],
      cos * outerSegment.normal[1] + sin * outerSegment.binormal[1],
      cos * outerSegment.normal[2] + sin * outerSegment.binormal[2],
    ]);


    // outer ring vertex
    vertices.push(
      outerSegment.position[0] + outerSegment.radius * vector[0],
      outerSegment.position[1] + outerSegment.radius * vector[1],
      outerSegment.position[2] + outerSegment.radius * vector[2],
    );
    vertexCount ++

    // inner ring vertex
    vertices.push(
      innerSegment.position[0] + innerSegment.radius * vector[0],
      innerSegment.position[1] + innerSegment.radius * vector[1],
      innerSegment.position[2] + innerSegment.radius * vector[2],
    );
    vertexCount ++

    // normal
    if (normals) normals.push(...capNormal, ...capNormal)

    // uvs
    if (uvs) {
      const uv1 = [(cos + 1) / 2, (sin + 1) / 2]
      const uv2 = [(cos * innerRadiusRatio + 1) / 2, (sin * innerRadiusRatio + 1) / 2]
      
      if (clockwise) {
        uv1[0] = 1 - uv1[0]
        uv2[0] = 1 - uv2[0]
      }
      uvs.push(...uv1, ...uv2); 
      
    }
  }

  // indices
  for (let i = 0; i < radialSegments; i++) {
    const a = i * 2
    const b = a + 1
    const c = a + 2
    const d = a + 3

    if (!clockwise) {
      indices.push(
        c + indexOffset,
        a + indexOffset,
        b + indexOffset,
        b + indexOffset,
        d + indexOffset,
        c + indexOffset,
      )
    } else {
      indices.push(
        a + indexOffset,
        c + indexOffset,
        b + indexOffset,
        b + indexOffset,
        c + indexOffset,
        d + indexOffset,
      )
    }
    indexCount += 6
  }

  return { vertices, indices, normals, uvs, vertexCount, indexCount }

}

function generateTube(segments: TubeSegment[], radialSegments: number, closed: boolean, options: AttributeOptions, indexOffset = 0) : Geometry {
  let vertexCount = 0, indexCount = 0

  const vertices: number[] = []
  const indices: number[] = []

  const normals: number[] | null = options.computeNormals ? [] : null
  const uvs: number[] | null = options.computeUvs ? [] : null
  
  const generateTubeSegment = (segment: TubeSegment) => {
    for (let j = 0; j <= radialSegments; j++) {
      const v = j / radialSegments * PI * 2
  
      const sin = Math.sin(v);
      const cos = - Math.cos(v);

      // normal
      const vector = normalizeVec3([
        cos * segment.normal[0] + sin * segment.binormal[0],
        cos * segment.normal[1] + sin * segment.binormal[1],
        cos * segment.normal[2] + sin * segment.binormal[2],
      ]);

      // vertex     
      const position: Vec3 = [
        segment.position[0] + segment.radius * vector[0],
        segment.position[1] + segment.radius * vector[1],
        segment.position[2] + segment.radius * vector[2]!,
      ];
      
      if (normals) {
        let surfaceNormal = copyVec3(vector)
        // adjust normal if radius is modulated
        if (segment.theta) {
          const rotationAxis = normalizeVec3(crossVec3(segment.tangent, vector))
          surfaceNormal = rotateVec3(vector, rotationAxis, segment.theta) 
        }       
        normals.push(...surfaceNormal)
      }
      // vertex     
      vertices.push(...position);
      vertexCount ++
    }
  }

  // 1. Generate tube segments vertex and normals data
  for (let i = 0; i < segments.length; i++) {
    generateTubeSegment(segments[i])
  }

  if (closed)
  generateTubeSegment(segments[0])

  // 2. Generate uvs
  if (uvs) {
    for (let i = 0; i < segments.length; i++) {
      for (let j = 0; j <= radialSegments; j++) {
        uvs.push(
          segments[i].curvePosition,
          j / radialSegments,
        )
      }
    }
  }

  // 3. Generate indices
  for (let j = 1; j < segments.length; j++) {
    for (let i = 1; i <= radialSegments; i++) {
      const a = (radialSegments + 1) * (j - 1) + (i - 1);
      const b = (radialSegments + 1) * j + (i - 1);
      const c = (radialSegments + 1) * j + i;
      const d = (radialSegments + 1) * (j - 1) + i;

      // faces
      indices.push(a + indexOffset, b + indexOffset, d + indexOffset);
      indices.push(b + indexOffset, c + indexOffset, d + indexOffset);
      indexCount += 6
    }
  }

  return { vertices, indices, normals, uvs, vertexCount, indexCount }
}

export function createTubeGeometry(curve: Curve3D, options: TubeGeometryOptions = {}) {
  const from = clamp(options.from || 0, 0, 1)
  const to = clamp(options.to || 1)

  if (to < from) throw Error('Value of "from" must be less than the value of "to"!')

  const geometry = new BufferGeometry()
  
  const radius = options.radius || 1
  const radiSteps = options.radiusModifier?.steps || []
  const radialSegments = options.radialSegments || 8
  const includeStartCap = options.startCap || false
  const includeEndCap = options.endCap || false
  const closed = curve.closed

  // sort radius modifier steps according to ascending curve positions
  radiSteps.sort((a, b) => a[0] - b[0])

  const segmentsPerMeter = options.segmentsPerMeter || 0.1
  const modifierType = options.radiusModifier?.type || 'none'
  const simplificationThreshold = clamp(options.simplificationThreshold || 0, 0, 1)

  const segments = calculateTubeSegments(curve, modifierType, from, to, radius, radiSteps, segmentsPerMeter, simplificationThreshold)

  //console.log(segments)
  const outerTube: Geometry = generateTube(segments, radialSegments, closed, options)

  let innerTube: Geometry | null = null
  let startCap: Geometry | null = null
  let endCap: Geometry | null = null
  
  let indexOffset = outerTube.vertexCount
  let indexStart = 0

  if (options.addGroups) {
    geometry.addGroup(indexStart, outerTube.indexCount, geometry.groups.length)
    indexStart += outerTube.indexCount
  }
  let innerSegments: TubeSegment[] | null = null

  if (options.innerRadius || options.thickness) {
    innerSegments = segments.map(s => ({
      ...s,
      radius: options.innerRadius || (s.radius - options.thickness!),
      theta: s.theta - PI,
    }))
    innerTube = generateTube(innerSegments, radialSegments, closed, options, indexOffset)

    indexOffset += innerTube.vertexCount

    if (options.addGroups) {
      geometry.addGroup(indexStart, innerTube.indexCount, geometry.groups.length)
      indexStart += innerTube.indexCount
    }
  }

  if (includeStartCap && (!closed || from > 0 || to < 1)) {
    if (innerSegments) {
      startCap = generateRingCap(segments[0], innerSegments[0], radialSegments, true, options, indexOffset)
    } else {
      startCap = generateCap(segments[0], radialSegments, true, options, indexOffset)
    }
    indexOffset += startCap.vertexCount
    if (options.addGroups) {
      geometry.addGroup(indexStart, startCap.indexCount, geometry.groups.length)
      indexStart += startCap.indexCount
    }
  }

  if (includeEndCap && (!closed || from > 0 || to < 1)) {
    if (innerSegments) {
      endCap = generateRingCap(segments[segments.length - 1], innerSegments[innerSegments.length - 1], radialSegments, false, options, indexOffset)
    } else {
      endCap = generateCap(segments[segments.length - 1], radialSegments, false, options, indexOffset)
    }
    indexOffset += endCap.vertexCount
    if (options.addGroups) {
      geometry.addGroup(indexStart, endCap.indexCount, geometry.groups.length)
      indexStart += endCap.indexCount
    }
  }

  let vertices = outerTube.vertices
  let indices = outerTube.indices
  
  if (innerTube) {
    vertices = vertices.concat(innerTube.vertices)
    indices = indices.concat(innerTube.indices.reverse())
  }

  if (startCap) {
    vertices = vertices.concat(startCap.vertices)
    indices = indices.concat(startCap.indices)
  }

  if (endCap) {
    vertices = vertices.concat(endCap.vertices)
    indices = indices.concat(endCap.indices)
  }
  
  geometry.setAttribute('position', new BufferAttribute(Float32Array.from(vertices), 3))

  if (options.computeNormals) {
    let normals = outerTube.normals!
    if (innerTube) {
      normals = normals.concat(innerTube.normals!)
    }
    if (startCap) {
      normals = normals.concat(startCap.normals!)
    }
    if (endCap) {
      normals = normals.concat(endCap.normals!)
    }
    geometry.setAttribute('normal', new BufferAttribute(Float32Array.from(normals), 3))
  }

  // add optional attributes
  if (options.computeLengths || options.computeCurveNormals || options.computeCurveTangents || options.computeCurveBinormals) {
    const lengths: number[] | null = options.computeLengths ? [] : null
    const curveNormals: number[] | null = options.computeCurveNormals ? [] : null
    const curveTangents: number[] | null = options.computeCurveTangents ? [] : null
    const curveBinormals: number[] | null = options.computeCurveBinormals ? [] : null

    const curveLength = curve.length;
    for (let i = 0; i < segments.length; i++) {
      for (let j = 0; j <= radialSegments; j++) {
        if (lengths) lengths.push(segments[i].curvePosition * curveLength)
        if (curveNormals) curveNormals.push(...segments[i].normal)
        if (curveTangents) curveTangents.push(...segments[i].tangent)
        if (curveBinormals) curveBinormals.push(...segments[i].binormal)
      }
    }
    if (innerTube && innerSegments) {
      for (let i = 0; i < innerSegments.length; i++) {
        for (let j = 0; j <= radialSegments; j++) {
          if (lengths) lengths.push(innerSegments[i].curvePosition * curveLength)
          if (curveNormals) curveNormals.push(...innerSegments[i].normal)
          if (curveTangents) curveTangents.push(...innerSegments[i].tangent)
          if (curveBinormals) curveBinormals.push(...innerSegments[i].binormal)
        }
      }
    }
    if (startCap) {
      for (let i = 0; i < startCap.vertexCount; i++) {
        if (lengths) lengths.push(0)
        if (curveNormals) curveNormals.push(...segments[0].normal)
        if (curveTangents) curveTangents.push(...segments[0].tangent)
        if (curveBinormals) curveBinormals.push(...segments[0].binormal)
      }
    }
    if (endCap) {
      for (let i = 0; i < endCap.vertexCount; i++) {
        if (lengths) lengths.push(curveLength)
        if (curveNormals) curveNormals.push(...segments[segments.length - 1].normal)
        if (curveTangents) curveTangents.push(...segments[segments.length - 1].tangent)
        if (curveBinormals) curveBinormals.push(...segments[segments.length - 1].binormal)
      }
    }
    
    if (lengths) geometry.setAttribute('curveLength', new BufferAttribute(Float32Array.from(lengths), 1))
    if (curveNormals) geometry.setAttribute('curveNormal', new BufferAttribute(Float32Array.from(curveNormals), 3))
    if (curveTangents) geometry.setAttribute('curveTangent', new BufferAttribute(Float32Array.from(curveTangents), 3))
    if (curveBinormals) geometry.setAttribute('curveBinormal', new BufferAttribute(Float32Array.from(curveBinormals), 3))
  }

  if (options.computeUvs) {
    let uvs = outerTube.uvs!
    if (innerTube) {
      uvs = uvs.concat(innerTube.uvs!)
    }
    if (startCap) {
      uvs = uvs.concat(startCap.uvs!)
    }
    if (endCap) {
      uvs = uvs.concat(endCap.uvs!)
    }
    geometry.setAttribute('uv', new BufferAttribute(Float32Array.from(uvs), 2))
  }

  geometry.setIndex(new BufferAttribute(Uint32Array.from(indices), 1))
  //console.log(geometry)
  return geometry
}
