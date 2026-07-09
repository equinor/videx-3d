import { Vec3 } from '../../../sdk';

export const trajectory = 'trajectory';

/**
 * Per-wellbore instanced-tube segment data produced by the {@link trajectory}
 * generator. Radius is intentionally NOT part of this payload — it is applied as a
 * shader uniform so thickness can change without regenerating the geometry.
 *
 * The `attributesBuffer` is an interleaved buffer with a stride of 11 floats per
 * curve position: `position(3), tangent(3), normal(3), curvePosition(2)` where
 * `normal` is the stable (rotation-minimizing) frame normal used as the ring base
 * direction, and the two curve-position components are
 * `[normalizedAlongDrawnRange, globalCurvePosition]`.
 *
 * `measuredLength` is the full measured length of the wellbore in metres, used to
 * scale world-unit map UVs (metres) from the normalized global curve position.
 * `measuredTop` is the measured depth (MSL) at the top of the trajectory in metres,
 * used as the datum for depth-marker bands.
 */
export type TrajectorySegmentsType = {
  attributesBuffer: Float32Array;
  segments: number;
  measuredLength: number;
  measuredTop: number;
  boundingSphere: {
    center: Vec3;
    radius: number;
  };
};

export type TrajectoryGeneratorResponse = TrajectorySegmentsType | null;

/**
 * A depth interval used to colour a {@link Trajectory} by data instead of a single
 * diffuse colour. `from`/`to` are MEASURED depth referenced to mean sea level (MSL) in
 * metres (the same datum as the depth-marker bands). Where a point on the tube falls
 * inside an interval, its colour is replaced by the interval `color`; points outside
 * every interval keep the trajectory's base `color`.
 *
 * Intervals are expected to be non-overlapping; if they overlap, the first match in
 * array order wins. Colours are de-duplicated into a small palette internally, so many
 * intervals may share a colour cheaply.
 */
export type TrajectoryColorInterval = {
  /** Start measured depth (MSL) in metres. */
  from: number;
  /** End measured depth (MSL) in metres. */
  to: number;
  /** Interval colour (any CSS colour string). */
  color: string;
};
