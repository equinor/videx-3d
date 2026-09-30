import { describe, expect, it } from 'vitest';
import { Vec2 } from '../src/sdk';
import { segmentConvexNearest } from '../src/sdk/utils/margin-zone';
import {
  createPolylineIndex,
  pointAtArcLength,
  polylineArcLengths,
  polylineWorstTurn,
} from '../src/sdk/utils/polyline-2d';
import { settleRodConstrained } from '../src/sdk/utils/stiff-rod-constrained';

const square: Vec2[] = [
  [-5, -5],
  [5, -5],
  [5, 5],
  [-5, 5],
];

/** clamps at (−32,0)→(−30,0) and (30,0)→(32,0), the interior along `via` at `spacing` */
function seedOver(via: Vec2[], spacing = 2): Vec2[] {
  const path: Vec2[] = [[-30, 0], ...via, [30, 0]];
  const arc = polylineArcLengths(path);
  const total = arc[arc.length - 1];
  const count = Math.round(total / spacing);
  const interior: Vec2[] = [];
  for (let k = 1; k < count; k++)
    interior.push(pointAtArcLength(path, arc, (total * k) / count));
  return [[-32, 0], [-30, 0], ...interior, [30, 0], [32, 0]];
}

const chordClearance = (rod: Vec2[], hull: Vec2[]) => {
  let d = Infinity;
  for (let i = 1; i < rod.length; i++)
    d = Math.min(d, segmentConvexNearest(rod[i - 1], rod[i], hull).distance);
  return d;
};

describe('settleRodConstrained', () => {
  it('rounds an obstacle on the seed flank, holding the margin on every chord', () => {
    const seed = seedOver([
      [-8, 7],
      [8, 7],
    ]);
    const rod = settleRodConstrained(seed, {
      obstacles: [square],
      keepOut: [],
      margin: 1,
      bending: 49,
    });
    expect(rod.converged).toBe(true);
    expect(chordClearance(rod.points, square)).toBeGreaterThanOrEqual(1 - 1e-6);
    // over the top, not through or under
    expect(Math.max(...rod.points.map(p => p[1]))).toBeGreaterThan(5);
    expect(rod.contacts.length).toBeGreaterThan(0);
    expect(rod.contacts.length).toBeLessThanOrEqual(6);
    expect(polylineWorstTurn(rod.points).turn).toBeLessThan(Math.PI / 4);
  });

  it('keeps the seed flank when started under the obstacle', () => {
    const seed = seedOver([
      [-8, -7],
      [8, -7],
    ]);
    const rod = settleRodConstrained(seed, {
      obstacles: [square],
      keepOut: [],
      margin: 1,
      bending: 49,
    });
    expect(Math.min(...rod.points.map(p => p[1]))).toBeLessThan(-5);
    expect(chordClearance(rod.points, square)).toBeGreaterThanOrEqual(1 - 1e-6);
  });

  it('touches nothing when nothing is in the way', () => {
    const far = square.map(([x, z]) => [x, z + 100] as Vec2);
    const seed = seedOver([
      [-8, 3],
      [8, 3],
    ]);
    const rod = settleRodConstrained(seed, {
      obstacles: [far],
      keepOut: [],
      margin: 1,
      bending: 49,
    });
    expect(rod.converged).toBe(true);
    expect(rod.contacts).toHaveLength(0);
    // the free rod between collinear clamps is the straight line
    expect(Math.max(...rod.points.map(p => Math.abs(p[1])))).toBeLessThan(1e-6);
  });

  it('holds the margin from a well segment', () => {
    const seed = seedOver([
      [-8, 0],
      [8, 0],
    ]);
    // the clamps sit on the line; a bump in the well toward it pushes the rod down
    const bumped: Vec2[] = [
      [-40, 3],
      [0, 0.5],
      [40, 3],
    ];
    const rod = settleRodConstrained(seed, {
      obstacles: [],
      keepOut: [createPolylineIndex(bumped)],
      margin: 1,
      bending: 49,
    });
    let d = Infinity;
    for (let i = 1; i < rod.points.length; i++) {
      for (let j = 1; j < bumped.length; j++) {
        d = Math.min(
          d,
          segmentConvexNearest(rod.points[i - 1], rod.points[i], [
            bumped[j - 1],
            bumped[j],
          ]).distance,
        );
      }
    }
    expect(d).toBeGreaterThanOrEqual(1 - 1e-6);
  });
});
