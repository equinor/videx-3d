import { transfer } from 'comlink';
import { Box3, Sphere, Vector3 } from 'three';
import type { TrajectoryLevel } from '../components/Wellbores/Trajectory/trajectory-defs';
import {
  calculateFrenetFrames,
  clamp,
  getCurvePositions,
  getTrajectory,
  PositionLog,
  ReadonlyStore,
  simplifyPolyline3D,
} from '../sdk';

const sphere = new Sphere();

/** Floats per curve position in the attributes buffer. */
const STRIDE = 10;

/** How far each coarser level may stray from the full trajectory, in metres. */
const LEVEL_TOLERANCES = [0.25, 1, 4, 16, 64];

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

  const attributesArray: number[] = [];

  frenetFrames.forEach(frame => {
    attributesArray.push(
      ...frame.position,
      ...frame.tangent,
      ...frame.normal, // stable (rotation-minimizing) frame normal = ring base dir
      frame.curvePosition, // global curve position 0-1
    );
  });

  const attributesBuffer = Float32Array.from(attributesArray);

  // Subsets of the full positions with their rows copied, so a kept ring is identical
  // at every level and switching levels cannot twist the tube.
  const positions = frenetFrames.map(frame => frame.position);
  const indexOf = new Map(positions.map((p, i) => [p, i]));
  const levels: TrajectoryLevel[] = [];
  let previous = positions.length;
  for (const tolerance of LEVEL_TOLERANCES) {
    const kept = simplifyPolyline3D(positions, tolerance);
    if (kept.length >= previous) continue;
    const level = new Float32Array(kept.length * STRIDE);
    kept.forEach((p, j) => {
      const i = indexOf.get(p)!;
      level.set(
        attributesBuffer.subarray(i * STRIDE, (i + 1) * STRIDE),
        j * STRIDE,
      );
    });
    levels.push({
      tolerance,
      attributesBuffer: level,
      segments: kept.length,
    });
    previous = kept.length;
  }

  const bbox = trajectory.curve.getBoundingBox(from, 1);
  const box3 = new Box3(new Vector3(...bbox.min), new Vector3(...bbox.max));
  box3.getBoundingSphere(sphere);

  const response = {
    attributesBuffer,
    // stride is 10 floats per curve position (position 3, tangent 3, normal 3,
    // curvePosition 1)
    segments: attributesBuffer.length / 10,
    // Full measured length of the wellbore in metres (used for world-unit map UVs).
    measuredLength: trajectory.measuredLength,
    // Measured depth (MSL) at the top of the trajectory in metres (depth-marker datum).
    measuredTop: trajectory.measuredTop,
    boundingSphere: {
      center: sphere.center.toArray() as [number, number, number],
      radius: sphere.radius,
    },
    levels,
  };

  return transfer(response, [
    attributesBuffer.buffer,
    ...levels.map(level => level.attributesBuffer.buffer),
  ]);
}
