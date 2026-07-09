import { transfer } from 'comlink';
import { Box3, Sphere, Vector3 } from 'three';
import {
  calculateFrenetFrames,
  clamp,
  getCurvePositions,
  getTrajectory,
  PositionLog,
  ReadonlyStore,
} from '../sdk';

const sphere = new Sphere();

/**
 * Generates a single-wall instanced-tube description for a wellbore trajectory.
 *
 * Unlike {@link generateTubeTrajectory}, radius is NOT baked into the geometry —
 * this returns per-segment centerline data (position, tangent, stable frame normal,
 * curve position) that the trajectory shader displaces into a tube using a radius
 * uniform. It mirrors the casing generator, minus the inner wall / radius steps.
 */
export async function generateTrajectory(
  this: ReadonlyStore,
  id: string,
  segmentsPerMeter: number = 0.1,
  simplificationThreshold: number = 0,
  fromMsl?: number,
) {
  const poslogMsl = await this.get<PositionLog>('position-logs', id);

  const trajectory = getTrajectory(id, poslogMsl);

  if (!trajectory) return null;

  const from =
    fromMsl !== undefined
      ? clamp(
          (fromMsl - trajectory.measuredTop) / trajectory.measuredLength,
          0,
          1,
        )
      : 0;

  const curvePositions = getCurvePositions(
    trajectory.curve,
    from,
    1,
    segmentsPerMeter,
    simplificationThreshold,
  );

  if (curvePositions.length < 2) return null;

  const frenetFrames = calculateFrenetFrames(trajectory.curve, curvePositions);

  const drawnLength = 1 - from || 1;
  const attributesArray: number[] = [];

  frenetFrames.forEach(frame => {
    attributesArray.push(
      ...frame.position,
      ...frame.tangent,
      ...frame.normal, // stable (rotation-minimizing) frame normal = ring base dir
      clamp((frame.curvePosition - from) / drawnLength, 0, 1), // along drawn range
      frame.curvePosition, // global curve position 0-1
    );
  });

  const attributesBuffer = Float32Array.from(attributesArray);

  const bbox = trajectory.curve.getBoundingBox(from, 1);
  const box3 = new Box3(new Vector3(...bbox.min), new Vector3(...bbox.max));
  box3.getBoundingSphere(sphere);

  const response = {
    attributesBuffer,
    segments: attributesBuffer.length / 11,
    // Full measured length of the wellbore in metres (used for world-unit map UVs).
    measuredLength: trajectory.measuredLength,
    // Measured depth (MSL) at the top of the trajectory in metres (depth-marker datum).
    measuredTop: trajectory.measuredTop,
    boundingSphere: {
      center: sphere.center.toArray() as [number, number, number],
      radius: sphere.radius,
    },
  };

  return transfer(response, [attributesBuffer.buffer]);
}
