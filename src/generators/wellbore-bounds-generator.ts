import { transfer } from 'comlink';
import {
  clamp,
  getTrajectory,
  lengthVec3,
  PositionLog,
  ReadonlyStore,
  simplifyPolyline3D,
  Vec3,
} from '../sdk';

/** Spacing of the stations along the curve the chain is simplified from, in metres. */
const STATION_SPACING = 10;

/**
 * Generates the bounds `WellboreBounds` measures the camera distance to, as one
 * `Float32Array`: a sphere `[cx, cy, cz, r]` around the trajectory, then the trajectory
 * as a chain of points `[x, y, z, ...]` that stays within `tolerance` metres of it.
 *
 * The chain is simplified from stations every few metres along the spline, so it does
 * not depend on how densely the position log was surveyed.
 */
export async function calculateWellboreBounds(
  this: ReadonlyStore,
  id: string,
  fromMsl?: number,
  tolerance: number = 100,
) {
  const poslogMsl = await this.get<PositionLog>('position-logs', id);
  const trajectory = poslogMsl ? getTrajectory(id, poslogMsl) : null;

  if (!trajectory) {
    const data = Float32Array.from([0, 0, 0, 10]);
    return transfer(data, [data.buffer]);
  }

  const from =
    fromMsl !== undefined
      ? clamp(
          (fromMsl - trajectory.measuredTop) / trajectory.measuredLength,
          0,
          1,
        )
      : 0;

  const box = trajectory.curve.getBoundingBox(from);
  const half: Vec3 = [
    (box.max[0] - box.min[0]) / 2,
    (box.max[1] - box.min[1]) / 2,
    (box.max[2] - box.min[2]) / 2,
  ];

  const n = Math.max(
    1,
    Math.ceil(((1 - from) * trajectory.curve.length) / STATION_SPACING),
  );
  const stations: Vec3[] = new Array(n + 1);
  for (let i = 0; i <= n; i++) {
    // `from + (1 - from) * n / n` can round past 1, where the spline throws
    const u = Math.min(1, from + ((1 - from) * i) / n);
    stations[i] = trajectory.curve.getPointAt(u);
  }
  const chain = simplifyPolyline3D(stations, tolerance);

  const data = new Float32Array(4 + chain.length * 3);
  data[0] = box.min[0] + half[0];
  data[1] = box.min[1] + half[1];
  data[2] = box.min[2] + half[2];
  data[3] = lengthVec3(half);
  chain.forEach((p, i) => data.set(p, 4 + i * 3));

  return transfer(data, [data.buffer]);
}
