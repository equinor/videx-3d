import { Vec2, Vec3 } from '../types/common';
import { clamp } from './numbers';
import { PI2 } from './trigonometry';

// Vec3
export function negateVec3(vec: Vec3) {
  vec[0] = -vec[0];
  vec[1] = -vec[1];
  vec[2] = -vec[2];
  return vec;
}

export function getVec3(buffer: number[], id: number): Vec3 {
  return [buffer[id], buffer[id + 1], buffer[id + 2]];
}

export function setVec3(buffer: number[], id: number, value: Vec3): void {
  buffer[id] = value[0];
  buffer[id + 1] = value[1];
  buffer[id + 2] = value[2];
}

export function addVec3(v1: Vec3, v2: Vec3): Vec3 {
  return [v1[0] + v2[0], v1[1] + v2[1], v1[2] + v2[2]];
}

export function subVec3(v1: Vec3, v2: Vec3): Vec3 {
  return [v1[0] - v2[0], v1[1] - v2[1], v1[2] - v2[2]];
}

export function scaleVec3(vec: Vec3, factor: number): Vec3 {
  vec[0] = vec[0] * factor;
  vec[1] = vec[1] * factor;
  vec[2] = vec[2] * factor;
  return vec;
}

export function lengthVec3(vec: Vec3): number {
  const sqrDist = vec[0] ** 2 + vec[1] ** 2 + vec[2] ** 2;
  return sqrDist > 0 ? Math.sqrt(sqrDist) : 0;
}

export function crossVec3(v1: Vec3, v2: Vec3): Vec3 {
  return [
    v1[1] * v2[2] - v1[2] * v2[1],
    v1[2] * v2[0] - v1[0] * v2[2],
    v1[0] * v2[1] - v1[1] * v2[0],
  ];
}

export function dotVec3(v1: Vec3, v2: Vec3): number {
  return v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2];
}

export function normalizeVec3(v: Vec3): Vec3 {
  const l = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
  if (!l) return [0, 0, 0]; // throw instead?

  v[0] = v[0] / l;
  v[1] = v[1] / l;
  v[2] = v[2] / l;
  return v;
}

export function mixVec3(v1: Vec3, v2: Vec3, t = 0.5): Vec3 {
  const t2 = 1 - t;
  return [
    v1[0] * t2 + v2[0] * t,
    v1[1] * t2 + v2[1] * t,
    v1[2] * t2 + v2[2] * t,
  ];
}

export function copyVec3(vec: Vec3): Vec3 {
  return [vec[0], vec[1], vec[2]];
}

export function angleVec3(v1: Vec3, v2: Vec3): number {
  const denominator = Math.sqrt(
    (v1[0] ** 2 + v1[1] ** 2 + v1[2] ** 2) *
      (v2[0] ** 2 + v2[1] ** 2 + v2[2] ** 2),
  );
  if (denominator === 0) return PI2;

  const theta = dotVec3(v1, v2) / denominator;
  return Math.acos(clamp(theta, -1, 1));
}

export function rotateVec3(
  vector: Vec3,
  axis: Vec3 = [0, 1, 0],
  angle = 0,
): Vec3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);

  const t = 1 - c;

  const vx = vector[0];
  const vy = vector[1];
  const vz = vector[2];

  const ax = axis[0];
  const ay = axis[1];
  const az = axis[2];

  const tx = t * ax,
    ty = t * ay;

  return [
    (tx * ax + c) * vx + (tx * ay - s * az) * vy + (tx * az + s * ay) * vz,
    (tx * ay + s * az) * vx + (ty * ay + c) * vy + (ty * az - s * ax) * vz,
    (tx * az - s * ay) * vx + (ty * az + s * ax) * vy + (t * az * az + c) * vz,
  ];
}

export function directionVec3(v1: Vec3, v2: Vec3): Vec3 {
  return normalizeVec3(subVec3(v2, v1));
}

/**
 * A bounds shape for distance-based level of detail: a bounding `sphere`, an
 * axis-aligned bounding `box` (as `[min, max]`) or a single `position`. Consumed by the
 * `Bounds` component and {@link distanceToBounds}.
 */
export type BoundsShape = {
  /** Bounding sphere. Highest precedence. */
  sphere?: { center: Vec3; radius: number };
  /** Axis-aligned bounding box as `[min, max]`. Used when `sphere` is unset. */
  box?: [Vec3, Vec3];
  /** A single point. Lowest precedence. */
  position?: Vec3;
};

/**
 * Non-negative distance from `point` to a {@link BoundsShape} — `0` when the point is
 * inside or on the shape. Precedence when several are set: `sphere` > `box` >
 * `position`; returns `Infinity` when none is provided. Pure math (no rendering
 * dependencies), so it can drive level-of-detail decisions and be unit tested directly.
 *
 * Mirrors three.js' `Sphere`/`Box3.distanceToPoint` (clamped to `0` on the inside).
 */
export function distanceToBounds(point: Vec3, bounds: BoundsShape): number {
  if (bounds.sphere) {
    const d =
      lengthVec3(subVec3(point, bounds.sphere.center)) - bounds.sphere.radius;
    return d > 0 ? d : 0;
  }
  if (bounds.box) {
    const [min, max] = bounds.box;
    // Component-wise gap to the box (0 on the inside of each axis), then its length.
    const dx =
      point[0] < min[0] ? min[0] - point[0] : Math.max(0, point[0] - max[0]);
    const dy =
      point[1] < min[1] ? min[1] - point[1] : Math.max(0, point[1] - max[1]);
    const dz =
      point[2] < min[2] ? min[2] - point[2] : Math.max(0, point[2] - max[2]);
    return lengthVec3([dx, dy, dz]);
  }
  if (bounds.position) {
    return lengthVec3(subVec3(point, bounds.position));
  }
  return Infinity;
}

export function distanceVec3(v1: Vec3, v2: Vec3): number {
  return lengthVec3(subVec3(v2, v1));
}

// Vec2

/**
 * Resolve a `number | Vec2 | undefined` parameter into a concrete `Vec2`. A
 * single number is expanded to `[n, n]`; `undefined` falls back to
 * `[fallback, fallback]`. Useful for options that accept either a uniform value
 * or independent X/Z (or width/height) components.
 */
export function asVec2(
  value: number | Vec2 | undefined,
  fallback: number,
): Vec2 {
  if (value === undefined) return [fallback, fallback];
  return typeof value === 'number' ? [value, value] : value;
}

export function getVec2(buffer: number[], id: number): Vec2 {
  return [buffer[id], buffer[id + 1]];
}

export function setVec2(buffer: number[], id: number, value: Vec2): void {
  buffer[id] = value[0];
  buffer[id + 1] = value[1];
}

export function normalizeVec2(v: Vec2): Vec2 {
  const l = Math.sqrt(v[0] * v[0] + v[1] * v[1]);
  if (!l) return [0, 0]; // throw error instead?
  v[0] = v[0] / l;
  v[1] = v[1] / l;
  return v;
}

export function addVec2(v1: Vec2, v2: Vec2): Vec2 {
  return [v1[0] + v2[0], v1[1] + v2[1]];
}

export function subVec2(v1: Vec2, v2: Vec2): Vec2 {
  return [v1[0] - v2[0], v1[1] - v2[1]];
}

export function dotVec2(v1: Vec2, v2: Vec2): number {
  return v1[0] * v2[0] + v1[1] * v2[1];
}

export function negateVec2(vec: Vec2) {
  vec[0] = -vec[0];
  vec[1] = -vec[1];

  return vec;
}

export function scaleVec2(vec: Vec2, factor: number): Vec2 {
  vec[0] = vec[0] * factor;
  vec[1] = vec[1] * factor;
  return vec;
}

export function lengthVec2(vec: Vec2): number {
  const sqrDist = vec[0] ** 2 + vec[1] ** 2;
  return sqrDist > 0 ? Math.sqrt(sqrDist) : 0;
}

export function mixVec2(v1: Vec2, v2: Vec2, t = 0.5): Vec2 {
  const t2 = 1 - t;
  return [v1[0] * t2 + v2[0] * t, v1[1] * t2 + v2[1] * t];
}

export function directionVec2(v1: Vec2, v2: Vec2): Vec2 {
  return normalizeVec2(subVec2(v2, v1));
}

export function distanceVec2(v1: Vec2, v2: Vec2): number {
  return lengthVec2(subVec2(v2, v1));
}
