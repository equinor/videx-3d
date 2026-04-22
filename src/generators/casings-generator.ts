import { transfer } from 'comlink';
import { CasingSectionType } from '../components/Wellbores/Casings';
import {
  calculateFrenetFrames,
  Curve3D,
  getCurvePositions,
  lerp,
  PositionLog,
  ReadonlyStore,
  Tuplet,
} from '../sdk';

import { Box3, Sphere, Vector3 } from 'three';
import { CasingItem, clamp, getTrajectory } from '../sdk';

const sphere = new Sphere();

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

function calculateSegments(
  curve: Curve3D,
  from: number,
  to: number,
  radiSteps: Tuplet<number>[],
  segmentsPerMeter: number,
  simplificationThreshold: number,
): Float32Array {
  const attributesArray: number[] = [];
  radiSteps.sort((a, b) => a[0] - b[0]);

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

  for (let i = 0; i < radiSteps.length - 1; i++) {
    const n = i + 1;
    const [startPos, startRadius] = radiSteps[i];
    const [endPos, endRadius] = radiSteps[n];

    // add first segment of step
    positions.push([
      startPos, // curve position 0-1
      startRadius, // outer radius,
    ]);

    // skip to the next position after to the start position of the segment
    while (p <= startPos && j < curvePositions.length - 1) {
      p = curvePositions[++j];
    }

    // fill in positions between the start and end of step
    while (p < endPos && j < curvePositions.length) {
      const calculatedRadius = interpolateRadius(p, radiSteps[i], radiSteps[n]);
      positions.push([p, calculatedRadius]);
      p = curvePositions[j++];
    }

    if (n === radiSteps.length - 1) {
      positions.push([endPos, endRadius]);
    }
  }

  const frenetFrames = calculateFrenetFrames(
    curve,
    positions.map(p => p[0]),
  );

  const l = to - from;

  frenetFrames.forEach((frame, i) => {
    attributesArray.push(
      ...frame.position,
      ...frame.normal,
      ...frame.tangent,
      clamp((frame.curvePosition - from) / l, 0, 1), // segment length 0-1
      frame.curvePosition, // position on curve 0-1
      positions[i][1], // outer radius
    );
  });

  return Float32Array.from(attributesArray);
}

export async function generateCasings(
  this: ReadonlyStore,
  id: string,
  fromMsl?: number,
  shoeFactor: number = 2,
  segmentsPerMeter: number = 0.1,
  simplificationThreshold: number = 0,
) {
  const data = await this.get<CasingItem[]>('casings', id);

  if (!data) return null;

  const poslogMsl = await this.get<PositionLog>('position-logs', id);

  const trajectory = getTrajectory(id, poslogMsl);

  if (!trajectory) return null;

  const minFrom =
    fromMsl !== undefined
      ? clamp(
          (fromMsl - trajectory.measuredTop) / trajectory.measuredLength,
          0,
          1,
        )
      : 0;

  const casingItems = data
    .filter(
      d =>
        d.mdBottomMsl > trajectory.measuredTop &&
        (fromMsl === undefined || d.mdBottomMsl > fromMsl),
    )
    .map(d => ({
      ...d,
      mdTopMsl: Math.max(d.mdTopMsl, trajectory.measuredTop),
    }))
    .sort(
      (a, b) => a.outerDiameter - b.outerDiameter || a.mdTopMsl - b.mdTopMsl,
    );

  if (casingItems.length === 0) return null;

  const curveLengthFactor = 1 / trajectory.measuredLength;

  const transferrables: ArrayBufferLike[] = [];
  const sections: CasingSectionType[] = [];

  casingItems.forEach(item => {
    const itemLength = clamp(
      item.mdBottomMsl - item.mdTopMsl,
      0.0001,
      trajectory.measuredLength,
    );

    const top = Math.max(
      minFrom,
      clamp(
        (item.mdTopMsl - trajectory.measuredTop) / trajectory.measuredLength,
        0,
        1,
      ),
    );
    const bottom = clamp(
      (item.mdBottomMsl - trajectory.measuredTop) / trajectory.measuredLength,
      0,
      1,
    );
    const radius = item.outerDiameter / 2;

    const innerRadius = item.innerDiameter
      ? item.innerDiameter / 2
      : radius * 0.95;

    const steps: Tuplet<number>[] = [];

    if (item.isShoe) {
      const shoeOuterRadiusBottom = radius * shoeFactor;
      steps.push(
        [top, radius],
        [top + (bottom - top) / 4, radius],
        [bottom, shoeOuterRadiusBottom],
      );
    } else {
      const radiusMin = radius - (radius - innerRadius) / 4;

      steps.push([top, radiusMin]);

      const shiftDistance =
        Math.min((radius - radiusMin) * 2, itemLength / 3) * curveLengthFactor;

      steps.push([top + shiftDistance, radius]);
      steps.push([bottom - shiftDistance, radius]);

      steps.push([bottom, radiusMin]);
      //steps.push([top, radius], [bottom, radius]);
    }
    const attributesBuffer = calculateSegments(
      trajectory.curve,
      top,
      bottom,
      steps,
      segmentsPerMeter,
      simplificationThreshold,
    );

    const bbox = trajectory.curve.getBoundingBox(top, bottom);
    const box3 = new Box3(new Vector3(...bbox.min), new Vector3(...bbox.max));

    box3.getBoundingSphere(sphere);

    sections.push({
      type: item.type,
      radius,
      innerRadius,
      length: itemLength,
      top,
      bottom,
      attributesBuffer,
      segments: attributesBuffer.length / 12,
      boundingSphere: {
        center: sphere.center.toArray(),
        radius: sphere.radius,
      },
    });

    transferrables.push(attributesBuffer.buffer);
  });

  return transfer(sections, transferrables);
}
