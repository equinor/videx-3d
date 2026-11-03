import { describe, expect, it } from 'vitest';
import {
  Boundary,
  boundaryBox,
  boundaryContains,
  boundaryDisc,
  boundaryKey,
  boundaryOutline,
  boundaryShape,
  enclosingCircle,
  orientedBounds,
} from '../src/sdk/geometries/boundary';
import { PlanarPolygonGeometry } from '../src/sdk/geometries/planar-geometry';
import type { Vec2 } from '../src/sdk/types/common';

// A 20 x 10 km field turned 30° counter-clockwise (seen from above) about its middle.
const TURN = Math.PI / 6;
const turned: Boundary = { box: [-10000, -5000, 10000, 5000], rotation: TURN };
// Its corners as three.js turns about +Y: x' = x cos + z sin, z' = −x sin + z cos.
const turn = ([x, z]: Vec2, r = TURN): Vec2 => [
  x * Math.cos(r) + z * Math.sin(r),
  -x * Math.sin(r) + z * Math.cos(r),
];

describe('boundaryShape', () => {
  it('reads every form', () => {
    expect(boundaryShape([0, 1, 2, 3])).toEqual({
      kind: 'box',
      box: [0, 1, 2, 3],
      rotation: 0,
    });
    expect(boundaryShape(turned)).toEqual({
      kind: 'box',
      box: [-10000, -5000, 10000, 5000],
      rotation: TURN,
    });
    expect(boundaryShape({ centre: [5, 6], radius: 7 })).toEqual({
      kind: 'circle',
      centre: [5, 6],
      radius: 7,
    });
    const ring: Vec2[] = [
      [0, 0],
      [10, 0],
      [0, 10],
    ];
    expect(boundaryShape(ring)).toEqual({ kind: 'polygon', rings: [ring] });
  });

  it('takes a polygon geometry with its offset, holes too', () => {
    const polygon = new PlanarPolygonGeometry([
      [
        [
          [0, 0],
          [100, 0],
          [100, 100],
          [0, 100],
        ],
        [
          [40, 40],
          [60, 40],
          [60, 60],
          [40, 60],
        ],
      ],
    ]);
    polygon.setOffset([1000, 2000]);
    const shape = boundaryShape(polygon);
    expect(shape.kind).toBe('polygon');
    if (shape.kind !== 'polygon') return;
    expect(shape.rings).toHaveLength(2);
    expect(shape.rings[0][0]).toEqual([0, 0]);
    expect(boundaryContains(polygon, 10, 10)).toBe(true);
    expect(boundaryContains(polygon, 50, 50)).toBe(false);
  });

  it('keys the shape, not the object it is given as', () => {
    expect(boundaryKey([0, 0, 1, 1])).toBe(boundaryKey([0, 0, 1, 1]));
    expect(boundaryKey({ box: [0, 0, 1, 1], rotation: 0 })).toBe(
      boundaryKey([0, 0, 1, 1]),
    );
    expect(boundaryKey(null)).toBe('');
  });
});

describe('boundaryDisc', () => {
  it('is a box’s circle, half its diagonal across, whatever its turn', () => {
    expect(boundaryDisc([-8000, -6000, 8000, 6000])).toEqual({
      centre: [0, 0],
      radius: 10000,
    });
    const disc = boundaryDisc(turned);
    expect(disc.centre).toEqual([0, 0]);
    expect(disc.radius).toBeCloseTo(Math.hypot(10000, 5000), 9);
  });

  it('is a polygon’s smallest circle', () => {
    // A triangle with an obtuse angle: the circle is its longest side's.
    const disc = boundaryDisc([
      [0, 0],
      [10, 0],
      [5, 1],
    ]);
    expect(disc.centre[0]).toBeCloseTo(5, 9);
    expect(disc.centre[1]).toBeCloseTo(0, 9);
    expect(disc.radius).toBeCloseTo(5, 9);
  });
});

describe('enclosingCircle', () => {
  it('holds every point, and is no larger than a brute force finds', () => {
    let a = 7;
    const random = () => {
      a = (a * 1664525 + 1013904223) >>> 0;
      return a / 4294967296;
    };
    for (let trial = 0; trial < 20; trial++) {
      const points: Vec2[] = Array.from({ length: 30 }, () => [
        random() * 1000,
        random() * 600,
      ]);
      const circle = enclosingCircle(points);
      for (const [x, z] of points)
        expect(
          Math.hypot(x - circle.centre[0], z - circle.centre[1]),
        ).toBeLessThanOrEqual(circle.radius + 1e-6);
      // The smallest circle is through two or three of the points: none of those smaller holds all.
      let best = Infinity;
      for (let i = 0; i < points.length; i++)
        for (let j = i + 1; j < points.length; j++) {
          const c: Vec2 = [
            (points[i][0] + points[j][0]) / 2,
            (points[i][1] + points[j][1]) / 2,
          ];
          const r =
            Math.hypot(
              points[i][0] - points[j][0],
              points[i][1] - points[j][1],
            ) / 2;
          if (
            points.every(([x, z]) => Math.hypot(x - c[0], z - c[1]) <= r + 1e-6)
          )
            best = Math.min(best, r);
        }
      expect(circle.radius).toBeLessThanOrEqual(best + 1e-6);
    }
  });
});

describe('boundaryBox and boundaryContains', () => {
  it('turn a box about its middle, counter-clockwise seen from above', () => {
    const [minX, minZ, maxX, maxZ] = boundaryBox(turned);
    const corners = (
      [
        [-10000, -5000],
        [10000, -5000],
        [10000, 5000],
        [-10000, 5000],
      ] as Vec2[]
    ).map(c => turn(c));
    expect(minX).toBeCloseTo(Math.min(...corners.map(c => c[0])), 6);
    expect(maxZ).toBeCloseTo(Math.max(...corners.map(c => c[1])), 6);
    expect(minZ).toBeCloseTo(-maxZ, 6);
    expect(maxX).toBeCloseTo(-minX, 6);
    // +X turned 30° toward −Z: a point along it stays inside, one across it does not.
    const along = turn([9900, 0]);
    expect(along[1]).toBeLessThan(0);
    expect(boundaryContains(turned, along[0], along[1])).toBe(true);
    const across = turn([0, 5100]);
    expect(boundaryContains(turned, across[0], across[1])).toBe(false);
    // Inside the box unturned, outside it turned.
    expect(boundaryContains([-10000, -5000, 10000, 5000], 9900, 3000)).toBe(
      true,
    );
    expect(boundaryContains(turned, 9900, 3000)).toBe(false);
  });

  it('a circle, and the outline of each', () => {
    const circle: Boundary = { centre: [100, -50], radius: 10 };
    expect(boundaryBox(circle)).toEqual([90, -60, 110, -40]);
    expect(boundaryContains(circle, 109, -50)).toBe(true);
    expect(boundaryContains(circle, 108, -42)).toBe(false);
    const [ring] = boundaryOutline(circle, 16);
    expect(ring).toHaveLength(16);
    for (const [x, z] of ring)
      expect(Math.hypot(x - 100, z + 50)).toBeCloseTo(10, 9);
    const [corners] = boundaryOutline(turned);
    expect(corners).toHaveLength(4);
    expect(corners[1][0]).toBeCloseTo(turn([10000, -5000])[0], 6);
  });
});

describe('orientedBounds', () => {
  it('finds a turned field’s box from its outline', () => {
    // A field 20 x 10 km about (3000, -2000), turned 30°, its outline a little uneven.
    const outline: Vec2[] = [];
    for (let i = 0; i < 40; i++) {
      const t = i / 40;
      const [u, v]: Vec2 =
        t < 0.25
          ? [-10000 + 80000 * t, -5000]
          : t < 0.5
            ? [10000, -5000 + 40000 * (t - 0.25)]
            : t < 0.75
              ? [10000 - 80000 * (t - 0.5), 5000]
              : [-10000, 5000 - 40000 * (t - 0.75)];
      const [x, z] = turn([u, v]);
      outline.push([x + 3000, z - 2000]);
    }
    const { box, rotation } = orientedBounds(outline);
    expect(rotation).toBeCloseTo(TURN, 9);
    expect((box[0] + box[2]) / 2).toBeCloseTo(3000, 6);
    expect((box[1] + box[3]) / 2).toBeCloseTo(-2000, 6);
    expect(box[2] - box[0]).toBeCloseTo(20000, 6);
    expect(box[3] - box[1]).toBeCloseTo(10000, 6);
    // The outline lies on the box's edge: a metre in from it, every point is inside.
    for (const [x, z] of outline) {
      const d = Math.hypot(x - 3000, z + 2000);
      const inX = x - ((x - 3000) / d) * 1;
      const inZ = z - ((z + 2000) / d) * 1;
      expect(boundaryContains({ box, rotation }, inX, inZ)).toBe(true);
    }
  });

  it('keeps an axis-aligned box unturned', () => {
    const { box, rotation } = orientedBounds([
      [0, 0],
      [4, 0],
      [4, 2],
      [0, 2],
    ]);
    expect(rotation).toBeCloseTo(0, 12);
    expect(box).toEqual([0, 0, 4, 2]);
  });
});
