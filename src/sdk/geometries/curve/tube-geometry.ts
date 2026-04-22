import { lerp } from 'three/src/math/MathUtils.js';
import { Tuplet, Vec3 } from '../../types/common';
import { clamp } from '../../utils/numbers';
import { PI } from '../../utils/trigonometry';
import {
  copyVec3,
  crossVec3,
  normalizeVec3,
  rotateVec3,
} from '../../utils/vector-operations';
import { GeometryData, toBufferGeometry } from '../geometry';
import {
  calculateFrenetFrames,
  Curve3D,
  FrenetFrame,
  getCurvePositions,
} from './curve-3d';

export type RadiusModifier = {
  type: 'linear' | 'stepped';
  steps: Tuplet<number>[];
};

export type AttributeOptions = {
  computeNormals?: boolean;
  computeUvs?: boolean;
  computeLengths?: boolean;
  computeRelativeLengths?: boolean;
  computeCenterPoints?: boolean;
  computeCurveNormals?: boolean;
  computeCurveTangents?: boolean;
  computeCurveBinormals?: boolean;
};

export type TubeGeometryOptions = AttributeOptions & {
  radialSegments?: number;
  from?: number;
  to?: number;
  startCap?: boolean;
  endCap?: boolean;
  radius?: number;
  segmentsPerMeter?: number;
  radiusModifier?: RadiusModifier;
  simplificationThreshold?: number;
  innerRadius?: number;
  thickness?: number;
  addGroups?: boolean;
};

type TubeSegment = FrenetFrame & {
  radius: number;
  theta: number;
};

function createGeometry(options: AttributeOptions) {
  const geometry: GeometryData = {
    vertexCount: 0,
    indexCount: 0,
    positions: [],
    indices: [],
    attributes: {},
  };

  if (options.computeNormals) {
    geometry.attributes.normal = {
      array: [],
      itemSize: 3,
      type: 'Float32Array',
    };
  }
  if (options.computeLengths) {
    geometry.attributes.curveLength = {
      array: [],
      itemSize: 1,
      type: 'Float32Array',
    };
  }
  if (options.computeRelativeLengths) {
    geometry.attributes.curveRelativeLength = {
      array: [],
      itemSize: 1,
      type: 'Float32Array',
    };
  }
  if (options.computeCurveNormals) {
    geometry.attributes.curveNormal = {
      array: [],
      itemSize: 3,
      type: 'Float32Array',
    };
  }
  if (options.computeCurveTangents) {
    geometry.attributes.curveTangent = {
      array: [],
      itemSize: 3,
      type: 'Float32Array',
    };
  }
  if (options.computeCurveBinormals) {
    geometry.attributes.curveBinormal = {
      array: [],
      itemSize: 3,
      type: 'Float32Array',
    };
  }
  if (options.computeCenterPoints) {
    geometry.attributes.centerPoint = {
      array: [],
      itemSize: 3,
      type: 'Float32Array',
    };
  }
  if (options.computeUvs) {
    geometry.attributes.uv = {
      array: [],
      itemSize: 2,
      type: 'Float32Array',
    };
  }

  return geometry;
}

function interpolateRadius(
  position: number,
  fromStep: Tuplet<number>,
  toStep: Tuplet<number>,
) {
  if (fromStep[0] === toStep[0]) return toStep[1];
  const delta = toStep[0] - fromStep[0];
  const t = clamp((position - fromStep[0]) / delta, 0, 1);

  return lerp(fromStep[1], toStep[1], t);
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
): TubeSegment[] {
  // determine radius steps
  const steps: Tuplet<number>[] = [];

  if (modifierType === 'none' || radiSteps.length === 0) {
    steps.push([from, radius], [to, radius]);
  } else {
    let left: Tuplet<number> = [0, radius],
      right: Tuplet<number> = [1, radius];

    // find first step within range
    const rightOfFromIndex = radiSteps.findIndex(s => s[0] > from);

    if (rightOfFromIndex === -1) {
      left = radiSteps[radiSteps.length - 1];
    } else {
      if (rightOfFromIndex > 0) {
        left = radiSteps[rightOfFromIndex - 1];
      }
      right = radiSteps[rightOfFromIndex];
    }

    const startRadius =
      modifierType === 'linear'
        ? interpolateRadius(from, left, right)
        : left[1];

    steps.push([from, startRadius]);

    for (let i = rightOfFromIndex; i >= 0 && i < radiSteps.length; i++) {
      const step = radiSteps[i];
      if (step[0] < to) {
        steps.push(step);
      } else {
        if (modifierType === 'linear') {
          steps.push([
            to,
            interpolateRadius(to, steps[steps.length - 1], step),
          ]);
        } else {
          steps.push([to, steps[steps.length - 1][1]]);
        }
        break;
      }
    }

    if (steps[steps.length - 1][0] < to) {
      if (modifierType === 'linear') {
        steps.push([
          to,
          interpolateRadius(to, steps[steps.length - 1], [1, radius]),
        ]);
      } else {
        steps.push([to, steps[steps.length - 1][1]]);
      }
    }
  }

  const positions: number[][] = [];
  const curvePositions = getCurvePositions(
    curve,
    from,
    to,
    segmentsPerMeter,
    simplificationThreshold,
  );
  let j = 0;
  let p = curvePositions[j];

  for (let i = 0; i < steps.length - 1; i++) {
    const n = i + 1;
    const [startPos, startRadius] = steps[i];
    const [endPos, endRadius] = steps[n];

    const deltaPos = endPos - startPos;
    const segmentLength = deltaPos * curve.length;
    const deltaRadius = endRadius - startRadius;

    const angle = Math.atan2(deltaRadius, segmentLength);

    // add first segment of step
    positions.push([
      startPos,
      startRadius,
      modifierType === 'linear' ? angle : 0,
    ]);

    // skip to the next position after to the start position of the segment
    while (p <= startPos && j < curvePositions.length - 1) {
      p = curvePositions[++j];
    }

    // fill in positions between the start and end of step
    while (p < endPos && j < curvePositions.length) {
      const calculatedRadius =
        modifierType === 'linear'
          ? interpolateRadius(p, steps[i], steps[n])
          : startRadius;
      positions.push([
        p,
        calculatedRadius,
        modifierType === 'linear' ? angle : 0,
      ]);
      p = curvePositions[j++];
    }

    // add end segments if radius is modulated, as we need extra vertices along the transitions for different normals
    if (n < steps.length) {
      if (modifierType === 'linear') {
        positions.push([
          endPos,
          endRadius,
          modifierType === 'linear' ? angle : 0,
        ]);
      } else if (modifierType === 'stepped') {
        const steppedAngle = angle < 0 ? -PI / 2 : PI / 2;
        positions.push(
          [endPos, startRadius, 0],
          [endPos, startRadius, steppedAngle],
          [endPos, endRadius, steppedAngle],
        );
      }
    }
    // if radius is not modulated, we need to add the final segment
    if (n === steps.length - 1 && modifierType === 'none') {
      positions.push([endPos, endRadius, angle]);
    }
  }

  const frenetFrames = calculateFrenetFrames(
    curve,
    positions.map(s => s[0]),
  );

  return positions.map((s, i) => ({
    radius: s[1],
    theta: s[2],
    ...frenetFrames[i],
  }));
}

function generateTubeGeometry(
  segments: TubeSegment[],
  radialSegments: number,
  closed: boolean,
  curveLength: number,
  from: number,
  options: AttributeOptions,
  clockwise: boolean = true,
) {
  const geometry = createGeometry(options);

  const generateTubeSegment = (segment: TubeSegment) => {
    for (let j = 0; j <= radialSegments; j++) {
      const v = (j / radialSegments) * PI * 2;

      const sin = Math.sin(v);
      const cos = -Math.cos(v);

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

      geometry.positions.push(...position);
      geometry.vertexCount++;

      // other attributes
      if (geometry.attributes.normal) {
        let surfaceNormal = copyVec3(vector);
        // adjust normal if radius is modulated
        if (Number.isFinite(segment.theta)) {
          const rotationAxis = normalizeVec3(
            crossVec3(segment.tangent, vector),
          );
          surfaceNormal = rotateVec3(vector, rotationAxis, segment.theta);
        }
        geometry.attributes.normal.array.push(...surfaceNormal);
      }

      if (geometry.attributes.curveLength)
        geometry.attributes.curveLength.array.push(
          segment.curvePosition * curveLength,
        );
      if (geometry.attributes.curveRelativeLength)
        geometry.attributes.curveRelativeLength.array.push(
          (segment.curvePosition - from) * curveLength,
        );
      if (geometry.attributes.curveNormal)
        geometry.attributes.curveNormal.array.push(...segment.normal);
      if (geometry.attributes.curveTangent)
        geometry.attributes.curveTangent.array.push(...segment.tangent);
      if (geometry.attributes.curveBinormal)
        geometry.attributes.curveBinormal.array.push(...segment.binormal);
      if (geometry.attributes.centerPoint)
        geometry.attributes.centerPoint.array.push(...segment.position);
    }
  };

  // 1. Generate tube segments vertex and normals data
  for (let i = 0; i < segments.length; i++) {
    generateTubeSegment(segments[i]);
  }

  if (closed) generateTubeSegment(segments[0]);

  // 2. Generate uvs
  if (geometry.attributes.uv) {
    for (let i = 0; i < segments.length; i++) {
      for (let j = 0; j <= radialSegments; j++) {
        geometry.attributes.uv.array.push(
          j / radialSegments,
          i / (segments.length - 1),
        );
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
      geometry.indices.push(a, b, d);
      geometry.indices.push(b, c, d);
      geometry.indexCount += 6;
    }
  }

  if (!clockwise) {
    geometry.indices.reverse();
  }

  return geometry;
}

function generateCapGeometry(
  segment: TubeSegment,
  radialSegments: number,
  clockwise = true,
  curveLength: number,
  from: number,
  options: AttributeOptions,
) {
  const geometry = createGeometry(options);

  const capNormal = clockwise
    ? [-segment.tangent[0], -segment.tangent[1], -segment.tangent[2]]
    : segment.tangent;

  geometry.positions.push(...segment.position);
  geometry.vertexCount++;

  if (geometry.attributes.normal)
    geometry.attributes.normal.array.push(...capNormal);

  if (geometry.attributes.uv) geometry.attributes.uv.array.push(0.5, 0.5);

  for (let j = 0; j <= radialSegments; j++) {
    const v = (j / radialSegments) * PI * 2;

    const sin = Math.sin(v);
    const cos = -Math.cos(v);

    const vector = normalizeVec3([
      cos * segment.normal[0] + sin * segment.binormal[0],
      cos * segment.normal[1] + sin * segment.binormal[1],
      cos * segment.normal[2] + sin * segment.binormal[2],
    ]);

    // vertex
    geometry.positions.push(
      segment.position[0] + segment.radius * vector[0],
      segment.position[1] + segment.radius * vector[1],
      segment.position[2] + segment.radius * vector[2],
    );
    geometry.vertexCount++;

    // normal
    if (geometry.attributes.normal)
      geometry.attributes.normal.array.push(...capNormal);

    // uvs
    if (geometry.attributes.uv) {
      const uv = [(cos + 1) / 2, (sin + 1) / 2];

      if (clockwise) {
        uv[0] = 1 - uv[0];
      }

      geometry.attributes.uv.array.push(...uv);
    }
  }

  const length = segment.curvePosition * curveLength;
  const relativeLength = (segment.curvePosition - from) * curveLength;

  for (let i = 0; i < geometry.vertexCount; i++) {
    if (geometry.attributes.curveLength)
      geometry.attributes.curveLength.array.push(length);
    if (geometry.attributes.curveRelativeLength)
      geometry.attributes.curveRelativeLength.array.push(relativeLength);
    if (geometry.attributes.curveNormal)
      geometry.attributes.curveNormal.array.push(...segment.normal);
    if (geometry.attributes.curveTangent)
      geometry.attributes.curveTangent.array.push(...segment.tangent);
    if (geometry.attributes.curveBinormal)
      geometry.attributes.curveBinormal.array.push(...segment.binormal);
    if (geometry.attributes.centerPoint)
      geometry.attributes.centerPoint.array.push(...segment.position);
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
    geometry.indices.push(v1, v2, v3);
    geometry.indexCount += 3;
  }

  return geometry;
}

function generateRingCapGeometry(
  outerSegment: TubeSegment,
  innerSegment: TubeSegment,
  radialSegments: number,
  clockwise = true,
  curveLength: number,
  from: number,
  options: AttributeOptions,
) {
  const geometry = createGeometry(options);

  const capNormal = clockwise
    ? [
        -outerSegment.tangent[0],
        -outerSegment.tangent[1],
        -outerSegment.tangent[2],
      ]
    : [...outerSegment.tangent];

  const innerRadiusRatio = innerSegment.radius / outerSegment.radius;

  for (let j = 0; j <= radialSegments; j++) {
    const v = (j / radialSegments) * PI * 2;

    const sin = Math.sin(v);
    const cos = -Math.cos(v);

    const vector = normalizeVec3([
      cos * outerSegment.normal[0] + sin * outerSegment.binormal[0],
      cos * outerSegment.normal[1] + sin * outerSegment.binormal[1],
      cos * outerSegment.normal[2] + sin * outerSegment.binormal[2],
    ]);

    // outer ring vertex
    geometry.positions.push(
      outerSegment.position[0] + outerSegment.radius * vector[0],
      outerSegment.position[1] + outerSegment.radius * vector[1],
      outerSegment.position[2] + outerSegment.radius * vector[2],
    );

    // inner ring vertex
    geometry.positions.push(
      innerSegment.position[0] + innerSegment.radius * vector[0],
      innerSegment.position[1] + innerSegment.radius * vector[1],
      innerSegment.position[2] + innerSegment.radius * vector[2],
    );
    geometry.vertexCount += 2;

    // normal
    if (geometry.attributes.normal) {
      geometry.attributes.normal.array.push(...capNormal);
      geometry.attributes.normal.array.push(...capNormal);
    }
    // uvs
    if (geometry.attributes.uv) {
      const uv1 = [(cos + 1) / 2, (sin + 1) / 2];
      const uv2 = [
        (cos * innerRadiusRatio + 1) / 2,
        (sin * innerRadiusRatio + 1) / 2,
      ];

      if (clockwise) {
        uv1[0] = 1 - uv1[0];
        uv2[0] = 1 - uv2[0];
      }
      geometry.attributes.uv.array.push(...uv1, ...uv2);
    }
  }

  const length = outerSegment.curvePosition * curveLength;
  const relativeLength = (outerSegment.curvePosition - from) * curveLength;

  for (let i = 0; i < geometry.vertexCount; i++) {
    if (geometry.attributes.curveLength)
      geometry.attributes.curveLength.array.push(length);
    if (geometry.attributes.curveRelativeLength)
      geometry.attributes.curveRelativeLength.array.push(relativeLength);
    if (geometry.attributes.curveNormal)
      geometry.attributes.curveNormal.array.push(...outerSegment.normal);
    if (geometry.attributes.curveTangent)
      geometry.attributes.curveTangent.array.push(...outerSegment.tangent);
    if (geometry.attributes.curveBinormal)
      geometry.attributes.curveBinormal.array.push(...outerSegment.binormal);
    if (geometry.attributes.centerPoint)
      geometry.attributes.centerPoint.array.push(...outerSegment.position);
  }

  // indices
  for (let i = 0; i < radialSegments; i++) {
    const a = i * 2;
    const b = a + 1;
    const c = a + 2;
    const d = a + 3;

    if (!clockwise) {
      geometry.indices.push(c, a, b, b, d, c);
    } else {
      geometry.indices.push(a, c, b, b, c, d);
    }
    geometry.indexCount += 6;
  }

  return geometry;
}

/**
 * Generates a fully customized tube geometry extruded from a curve.
 */
export function createTubeGeometries(
  curve: Curve3D,
  options: TubeGeometryOptions = {},
) {
  const from = clamp(options.from || 0, 0, 1);
  const to = clamp(options.to || 1);

  if (to < from)
    throw Error('Value of "from" must be less than the value of "to"!');

  const geometries: GeometryData[] = [];

  const radius = options.radius || 1;
  const radiSteps = options.radiusModifier?.steps || [];
  const radialSegments = options.radialSegments || 8;
  const includeStartCap = options.startCap || false;
  const includeEndCap = options.endCap || false;
  const closed = curve.closed;
  const curveLength = curve.length;

  // sort radius modifier steps according to ascending curve positions
  radiSteps.sort((a, b) => a[0] - b[0]);

  const segmentsPerMeter = options.segmentsPerMeter || 0.1;
  const modifierType = options.radiusModifier?.type || 'none';
  const simplificationThreshold = clamp(
    options.simplificationThreshold || 0,
    0,
    1,
  );

  const segments = calculateTubeSegments(
    curve,
    modifierType,
    from,
    to,
    radius,
    radiSteps,
    segmentsPerMeter,
    simplificationThreshold,
  );

  geometries.push(
    generateTubeGeometry(
      segments,
      radialSegments,
      closed,
      curveLength,
      from,
      options,
      true,
    ),
  );

  let innerSegments: TubeSegment[] | null = null;

  const innerRadius = options.innerRadius || 0;
  const thickness = options.thickness || 0;
  if (innerRadius > 0 || thickness > 0) {
    if (thickness) {
      innerSegments = segments.map(s => ({
        ...s,
        radius: s.radius - thickness,
        theta: s.theta - PI,
      }));
    } else {
      innerSegments = calculateTubeSegments(
        curve,
        'none',
        from,
        to,
        innerRadius,
        [],
        segmentsPerMeter,
        simplificationThreshold,
      ).map(s => ({
        ...s,
        theta: s.theta - PI,
      }));
    }

    geometries.push(
      generateTubeGeometry(
        innerSegments,
        radialSegments,
        closed,
        curveLength,
        from,
        options,
        false,
      ),
    );
  }

  if (includeStartCap && (!closed || from > 0 || to < 1)) {
    if (innerSegments) {
      geometries.push(
        generateRingCapGeometry(
          segments[0],
          innerSegments[0],
          radialSegments,
          true,
          curveLength,
          from,
          options,
        ),
      );
    } else {
      geometries.push(
        generateCapGeometry(
          segments[0],
          radialSegments,
          true,
          curveLength,
          from,
          options,
        ),
      );
    }
  }

  if (includeEndCap && (!closed || from > 0 || to < 1)) {
    if (innerSegments) {
      geometries.push(
        generateRingCapGeometry(
          segments[segments.length - 1],
          innerSegments[innerSegments.length - 1],
          radialSegments,
          false,
          curveLength,
          from,
          options,
        ),
      );
    } else {
      geometries.push(
        generateCapGeometry(
          segments[segments.length - 1],
          radialSegments,
          false,
          curveLength,
          from,
          options,
        ),
      );
    }
  }

  return geometries;
}

export function createTubeGeometry(
  curve: Curve3D,
  options: TubeGeometryOptions = {},
) {
  const geometries = createTubeGeometries(curve, options);
  const merged = toBufferGeometry(geometries, options.addGroups);
  //console.log(merged, geometries);
  return merged;
}
