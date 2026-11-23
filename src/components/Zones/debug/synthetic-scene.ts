import { Vec2 } from '../../../sdk';
import { convexHull2D } from '../../../sdk/utils/polyline-2d';

/** The synthetic obstacle shapes of the stiff-rod debug story and its sweep probes. */
export type HullShape = 'disc' | 'blob' | 'sliver' | 'wedge';

/** Obstacle shapes about the origin, roughly unit length along x, before stretching and turning. */
export const HULL_SHAPES: Record<HullShape, Vec2[]> = {
  disc: Array.from({ length: 16 }, (_, k) => {
    const a = (k / 16) * Math.PI * 2;
    return [Math.cos(a) / 2, Math.sin(a) / 2] as Vec2;
  }),
  // a lopsided head: one long straight flank, a blunt end and a sharper one
  blob: [
    [-0.5, -0.08],
    [-0.38, 0.22],
    [-0.1, 0.36],
    [0.3, 0.3],
    [0.5, 0.05],
    [0.42, -0.25],
    [0.1, -0.4],
    [-0.3, -0.34],
  ],
  // a thin fold, so the well runs along it or across it depending on the angle
  sliver: [
    [-0.5, 0],
    [-0.3, 0.12],
    [0.3, 0.12],
    [0.5, 0],
    [0.3, -0.12],
    [-0.3, -0.12],
  ],
  // a hook: a sharp apex opposite a wide base
  wedge: [
    [-0.5, -0.3],
    [0.5, -0.12],
    [0.5, 0.12],
    [-0.5, 0.3],
    [-0.55, 0],
  ],
};

/**
 * A synthetic obstacle: `shape` stretched to `length` metres along its own axis and `width`
 * metres across it (each axis independently, so the shape's proportions are a free choice),
 * turned by `angle` degrees about `c`. `pivot` puts the shape's centre, or the start / end of its
 * axis (the wedge's apex / base), at `c`.
 */
export function syntheticObstacle(
  shape: HullShape,
  c: Vec2,
  length: number,
  width: number,
  angle: number,
  pivot: 'centre' | 'start' | 'end' = 'centre',
): Vec2[] {
  const pts = HULL_SHAPES[shape];
  let xMin = Infinity;
  let xMax = -Infinity;
  let zMin = Infinity;
  let zMax = -Infinity;
  for (const [x, z] of pts) {
    xMin = Math.min(xMin, x);
    xMax = Math.max(xMax, x);
    zMin = Math.min(zMin, z);
    zMax = Math.max(zMax, z);
  }
  const sx = length / (xMax - xMin);
  const sz = width / (zMax - zMin);
  const x0 = pivot === 'start' ? xMin * sx : pivot === 'end' ? xMax * sx : 0;
  const a = (angle * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return convexHull2D(
    pts.map(([x, z]) => {
      const px = x * sx - x0;
      const pz = z * sz;
      return [c[0] + px * cos - pz * sin, c[1] + px * sin + pz * cos] as Vec2;
    }),
  );
}

/** A polyline from `a` to `b` at ~`step` spacing, both ends kept. */
export function segment(a: Vec2, b: Vec2, step: number): Vec2[] {
  const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
  const out: Vec2[] = [];
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  return out;
}

/**
 * A synthetic well: a leg arriving at the origin along +x, then a leg of the same `reach`
 * leaving it turned by `turn` degrees (0 = straight through, 90 = a right-angle corner).
 */
export function syntheticWell(turn: number, reach: number, step = 5): Vec2[] {
  const a = (turn * Math.PI) / 180;
  const out: Vec2 = [Math.cos(a) * reach, Math.sin(a) * reach];
  return [...segment([-reach, 0], [0, 0], step), ...segment([0, 0], out, step).slice(1)];
}
