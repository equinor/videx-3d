import { describe, expect, it } from 'vitest';
import { Vec2 } from '../src/sdk';
import {
  convexPolygonDistance,
  convexSignedDistance,
  hullsWithin,
  marginCrossings,
  segmentConvexNearest,
} from '../src/sdk/utils/margin-zone';

const square: Vec2[] = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
];

describe('convexSignedDistance', () => {
  it('is the distance to the boundary, negative inside', () => {
    expect(convexSignedDistance([3, 0], square).distance).toBeCloseTo(2);
    expect(convexSignedDistance([2, 2], square).distance).toBeCloseTo(
      Math.SQRT2,
    );
    expect(convexSignedDistance([0.5, 0], square).distance).toBeCloseTo(-0.5);
    expect(
      convexSignedDistance([3, 0], [...square].reverse()).distance,
    ).toBeCloseTo(2);
  });

  it('treats a 1- or 2-point hull as a point or a segment', () => {
    expect(convexSignedDistance([3, 4], [[0, 0]]).distance).toBeCloseTo(5);
    expect(
      convexSignedDistance(
        [0, 2],
        [
          [-1, 0],
          [1, 0],
        ],
      ).distance,
    ).toBeCloseTo(2);
  });
});

describe('segmentConvexNearest', () => {
  it('finds the closest points and the separating normal', () => {
    const near = segmentConvexNearest([-5, 3], [5, 3], square);
    expect(near.distance).toBeCloseTo(2);
    expect(near.normal![0]).toBeCloseTo(0);
    expect(near.normal![1]).toBeCloseTo(1);
  });

  it('reads a hull corner against the segment interior', () => {
    // the diagonal x + z = 4 passes the corner (1,1) at √2
    const near = segmentConvexNearest([4, 0], [0, 4], square);
    expect(near.distance).toBeCloseTo(Math.SQRT2);
    expect(near.onHull).toEqual([1, 1]);
    expect(near.t).toBeCloseTo(0.5);
  });

  it('is 0 when the segment crosses or starts inside', () => {
    expect(segmentConvexNearest([-5, 0], [5, 0], square).distance).toBe(0);
    expect(segmentConvexNearest([0, 0], [5, 0], square).distance).toBe(0);
  });
});

describe('convexPolygonDistance', () => {
  it('is the gap between two polygons, 0 when they overlap', () => {
    const shifted = square.map(([x, z]) => [x + 5, z + 0.5] as Vec2);
    expect(convexPolygonDistance(square, shifted)).toBeCloseTo(3);
    const touching = square.map(([x, z]) => [x + 1.5, z] as Vec2);
    expect(convexPolygonDistance(square, touching)).toBe(0);
  });
});

describe('hullsWithin', () => {
  it('finds the hull a point or segment comes within the distance of, rounded at the corners', () => {
    const far = square.map(([x, z]) => [x + 50, z] as Vec2);
    const within = hullsWithin([far, square], 1);
    expect(within([2.5, 0])).toBe(-1);
    expect(within([1.5, 0])).toBe(1);
    // √(0.6² + 0.6²) = 0.85 off the corner, √(0.8² + 0.8²) = 1.13
    expect(within([1.6, 1.6])).toBe(1);
    expect(within([1.8, 1.8])).toBe(-1);
    expect(within([-5, 1.5], [5, 1.5])).toBe(1);
    expect(within([-5, 2.5], [5, 2.5])).toBe(-1);
    expect(within([51.5, 0])).toBe(0);
  });
});

describe('marginCrossings', () => {
  it('locates where a line enters and leaves the rounded margin', () => {
    // z = 1.5 is 0.5 off the top edge; the margin 1 circle about (±1, 1) meets it at |x| = 1 + √0.75
    const { startsInside, crossings } = marginCrossings(
      [
        [-5, 1.5],
        [5, 1.5],
      ],
      square,
      1,
    );
    expect(startsInside).toBe(false);
    expect(crossings.map(c => c.entering)).toEqual([true, false]);
    const x = 1 + Math.sqrt(0.75);
    expect(crossings[0].arc).toBeCloseTo(5 - x, 9);
    expect(crossings[1].arc).toBeCloseTo(5 + x, 9);
  });

  it('reports a polyline that starts inside', () => {
    const { startsInside, crossings } = marginCrossings(
      [
        [0, 0],
        [0, 5],
      ],
      square,
      1,
    );
    expect(startsInside).toBe(true);
    expect(crossings).toHaveLength(1);
    expect(crossings[0].arc).toBeCloseTo(2, 9);
  });

  it('moves continuously with the margin past a sharp corner', () => {
    // a 30° wedge: a miter-2 zone switches its apex from one vertex to two at a 120° turn,
    // and the rounded margin has no such switch
    const wedge: Vec2[] = [
      [0, 0],
      [10, -Math.tan(Math.PI / 12) * 10],
      [10, Math.tan(Math.PI / 12) * 10],
    ];
    const line: Vec2[] = [
      [-10, -2],
      [20, -2],
    ];
    const arcs: number[] = [];
    for (let m = 1; m <= 3 + 1e-9; m += 0.05) {
      arcs.push(marginCrossings(line, wedge, m).crossings[0].arc);
    }
    const jumps = arcs.slice(1).map((a, i) => Math.abs(a - arcs[i]));
    expect(Math.max(...jumps)).toBeLessThan(0.5);
  });
});
