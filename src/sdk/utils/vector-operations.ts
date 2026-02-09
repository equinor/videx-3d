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

// Vec2
export function getVec2(buffer: number[], id: number): Vec2 {
  return [buffer[id], buffer[id + 1]];
}

export function setVec2(buffer: number[], id: number, value: Vec2): void {
  buffer[id] = value[0];
  buffer[id + 1] = value[1];
}

export function normalizeVec2(v: Vec2): Vec2 {
  const l = Math.sqrt(v[0] * v[0] + v[1] * v[1]);
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
