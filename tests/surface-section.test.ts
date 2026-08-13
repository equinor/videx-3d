import { describe, expect, it } from 'vitest';
import { Vec3 } from '../src/sdk/types/common';
import {
  createStackSectionTarget,
  growStackSectionTarget,
  sectionPlaneOutline,
  sectionStackInterval,
  StackSectionPlane,
  StackSectionSource,
} from '../src/sdk/geometries/surface-section';

/**
 * A quad of two triangles in XZ, with a flat top and bottom — two prism cells
 * sharing the diagonal edge (1, 2).
 *
 *   0 --- 1        (0,0) (100,0)
 *   |   / |
 *   2 --- 3        (0,100) (100,100)
 */
function twoCells(top: number[], bottom: number[]): StackSectionSource {
  return {
    positionsXZ: Float32Array.from([0, 0, 100, 0, 0, 100, 100, 100]),
    indices: Uint32Array.from([0, 1, 2, 1, 3, 2]),
    heights: [Float32Array.from(top), Float32Array.from(bottom)],
    intervals: [Uint8Array.from([1, 1])],
  };
}

/** one cell: a single triangle, flat top at `t`, flat bottom at `b` */
function oneCell(t: number, b: number): StackSectionSource {
  return {
    positionsXZ: Float32Array.from([0, 0, 100, 0, 0, 100]),
    indices: Uint32Array.from([0, 1, 2]),
    heights: [Float32Array.from([t, t, t]), Float32Array.from([b, b, b])],
    intervals: [Uint8Array.from([1])],
  };
}

const plane = (
  normal: [number, number, number],
  constant: number,
): StackSectionPlane => {
  const l = Math.hypot(...normal);
  return {
    normal: [normal[0] / l, normal[1] / l, normal[2] / l],
    constant,
  };
};

function run(
  source: StackSectionSource,
  p: StackSectionPlane,
  interval = 0,
  capacity = 256,
) {
  const target = createStackSectionTarget(capacity, !!source.inferred);
  const needed = sectionStackInterval(source, interval, p, target, {
    offset: 0,
  });
  return { target, needed };
}

/** the written vertices as [x, y, z] triples */
function vertices(target: ReturnType<typeof run>['target']) {
  const out: [number, number, number][] = [];
  for (let v = 0; v < target.count; v++) {
    out.push([
      target.positions[3 * v],
      target.positions[3 * v + 1],
      target.positions[3 * v + 2],
    ]);
  }
  return out;
}

function area(target: ReturnType<typeof run>['target']) {
  let total = 0;
  for (let t = 0; t + 2 < target.count; t += 3) {
    const ax = target.positions[3 * t];
    const ay = target.positions[3 * t + 1];
    const az = target.positions[3 * t + 2];
    const bx = target.positions[3 * (t + 1)] - ax;
    const by = target.positions[3 * (t + 1) + 1] - ay;
    const bz = target.positions[3 * (t + 1) + 2] - az;
    const cx = target.positions[3 * (t + 2)] - ax;
    const cy = target.positions[3 * (t + 2) + 1] - ay;
    const cz = target.positions[3 * (t + 2) + 2] - az;
    total +=
      0.5 * Math.hypot(by * cz - bz * cy, bz * cx - bx * cz, bx * cy - by * cx);
  }
  return total;
}

describe('sectionStackInterval', () => {
  it('cuts nothing when the cell is wholly on one side', () => {
    const source = oneCell(0, -100);
    // Everything is at x <= 100, so a plane at x = 200 removes nothing.
    expect(run(source, plane([1, 0, 0], -200)).needed).toBe(0);
    // ...and at x = -50 it removes all of it, which also leaves no face.
    expect(run(source, plane([1, 0, 0], 50)).needed).toBe(0);
  });

  it('cuts a vertical plane in a rectangle of the right area', () => {
    const source = oneCell(0, -50);
    // x = 50 crosses the triangle's hypotenuse: the cell's footprint there is a
    // 50 m segment, and the cell is 50 m thick.
    const { target } = run(source, plane([1, 0, 0], -50));
    expect(target.count).toBe(6);
    expect(area(target)).toBeCloseTo(50 * 50, 4);
    for (const [x] of vertices(target)) expect(x).toBeCloseTo(50, 6);
  });

  it('takes the plane normal, facing the removed side', () => {
    const source = oneCell(0, -50);
    const { target } = run(source, plane([1, 0, 0], -50));
    for (let v = 0; v < target.count; v++) {
      expect(target.normals[3 * v]).toBeCloseTo(1, 6);
      expect(target.normals[3 * v + 1]).toBeCloseTo(0, 6);
      expect(target.normals[3 * v + 2]).toBeCloseTo(0, 6);
    }
  });

  it('follows a tilted plane, giving the same face area either way round', () => {
    const source = oneCell(0, -50);
    const p = plane([1, 0.4, 0.3], -50);
    const front = run(source, p);
    const back = run(
      source,
      plane([-p.normal[0], -p.normal[1], -p.normal[2]], -p.constant),
    );
    expect(front.target.count).toBeGreaterThan(0);
    expect(area(front.target)).toBeCloseTo(area(back.target), 4);
  });

  it('is watertight across the edge two cells share', () => {
    // A sloping top, so the shared diagonal is not level and the crossing on it
    // is a genuine interpolation rather than an exact vertex.
    const source = twoCells([0, -13, -27, -41], [-90, -97, -111, -132]);
    // A plane through the diagonal's midpoint, cutting both cells.
    const { target } = run(source, plane([1, 0.2, -1], 3));
    expect(target.count).toBeGreaterThan(0);

    // Every point on the shared edge (x + z = 100) must be produced identically
    // by both cells — bit-identical, not merely close, which is what the
    // canonical edge ordering buys.
    const shared = vertices(target).filter(
      ([x, , z]) => Math.abs(x + z - 100) < 1e-9,
    );
    expect(shared.length).toBeGreaterThan(0);
    const unique = new Set(shared.map(p => p.join(',')));
    // Both cells emit the same two crossings on the diagonal, so the distinct
    // positions there are far fewer than the occurrences.
    expect(unique.size).toBeLessThan(shared.length);
    for (const key of unique) {
      const matches = shared.filter(p => p.join(',') === key);
      expect(matches.length).toBeGreaterThan(1);
    }
  });

  it('is watertight between two intervals sharing a boundary', () => {
    const mid = [-40, -46, -52, -58];
    const source: StackSectionSource = {
      positionsXZ: Float32Array.from([0, 0, 100, 0, 0, 100, 100, 100]),
      indices: Uint32Array.from([0, 1, 2, 1, 3, 2]),
      heights: [
        Float32Array.from([0, -3, -6, -9]),
        Float32Array.from(mid),
        Float32Array.from([-90, -97, -111, -132]),
      ],
      intervals: [Uint8Array.from([1, 1]), Uint8Array.from([1, 1])],
    };
    const p = plane([1, 0.2, -1], 3);
    const upper = run(source, p, 0);
    const lower = run(source, p, 1);

    const onMid = (t: ReturnType<typeof run>['target']) =>
      new Set(
        vertices(t)
          // the shared surface, sampled where each interval met it
          .filter(([x, y, z]) => {
            const u = x / 100;
            const w = z / 100;
            const h =
              mid[0] * (1 - u) * (1 - w) +
              mid[1] * u * (1 - w) +
              mid[2] * (1 - u) * w +
              mid[3] * u * w;
            return Math.abs(y - h) < 1e-6;
          })
          .map(pt => pt.join(',')),
      );
    const above = onMid(upper.target);
    const below = onMid(lower.target);
    expect(above.size).toBeGreaterThan(0);
    // The upper interval's base and the lower one's top are the same points.
    for (const key of above) expect(below.has(key)).toBe(true);
  });

  it('reads wallV as 1 on the top and 0 on the base', () => {
    const source = oneCell(0, -50);
    const { target } = run(source, plane([1, 0, 0], -50));
    for (let v = 0; v < target.count; v++) {
      const y = target.positions[3 * v + 1];
      expect(target.wallV[v]).toBeCloseTo(y === 0 ? 1 : 0, 6);
    }
  });

  it('interpolates the invention weight from both bounding layers', () => {
    const source: StackSectionSource = {
      ...oneCell(0, -50),
      // The BASE is invented at one corner; the cut face must say so even though
      // the top is measured everywhere.
      inferred: [Float32Array.from([0, 0, 0]), Float32Array.from([0, 1, 0])],
    };
    const target = createStackSectionTarget(256, true);
    sectionStackInterval(source, 0, plane([1, 0, 0], -50), target, {
      offset: 0,
    });
    expect(target.count).toBeGreaterThan(0);
    const marks = target.inferred!;
    let max = 0;
    for (let v = 0; v < target.count; v++) max = Math.max(max, marks[v]);
    expect(max).toBeGreaterThan(0);
    expect(max).toBeLessThanOrEqual(1);
  });

  it('skips an interval with no volume', () => {
    const source = oneCell(0, -50);
    source.intervals = [null];
    expect(run(source, plane([1, 0, 0], -50)).needed).toBe(0);
  });

  it('skips the cells the interval does not occupy', () => {
    const source = twoCells([0, 0, 0, 0], [-50, -50, -50, -50]);
    const both = run(source, plane([0, 0, 1], -50));
    source.intervals = [Uint8Array.from([1, 0])];
    const one = run(source, plane([0, 0, 1], -50));
    expect(one.needed).toBeGreaterThan(0);
    expect(one.needed).toBeLessThan(both.needed);
  });

  it('reports what it needs instead of overrunning the target', () => {
    const source = twoCells([0, 0, 0, 0], [-50, -50, -50, -50]);
    const p = plane([0, 0, 1], -50);
    const target = createStackSectionTarget(3, false);
    const needed = sectionStackInterval(source, 0, p, target, { offset: 0 });
    expect(needed).toBeGreaterThan(target.capacity);
    // Nothing usable was written, so the caller must not draw it.
    expect(target.count).toBe(0);

    growStackSectionTarget(target, needed);
    expect(sectionStackInterval(source, 0, p, target, { offset: 0 })).toBe(
      needed,
    );
    expect(target.count).toBe(needed);
  });

  it('lifts the face off the plane by the offset', () => {
    const source = oneCell(0, -50);
    const target = createStackSectionTarget(256, false);
    sectionStackInterval(source, 0, plane([1, 0, 0], -50), target, {
      offset: 0.25,
    });
    // Toward the KEPT side (x < 50), or the block's own clip would eat the face.
    for (const [x] of vertices(target)) expect(x).toBeCloseTo(50 - 0.25, 6);
  });

  it('draws nothing where the plane only grazes a cell', () => {
    const source = oneCell(0, -50);
    // x = 0 touches vertices 0 and 2 and removes nothing else.
    expect(run(source, plane([-1, 0, 0], 0)).needed).toBe(0);
  });
});

describe('sectionPlaneOutline', () => {
  const min: Vec3 = [-100, -50, -200];
  const max: Vec3 = [100, 50, 200];
  const out = new Float32Array(18);

  /** the written points */
  const points = (count: number) =>
    Array.from({ length: count }, (_, k) => [
      out[3 * k],
      out[3 * k + 1],
      out[3 * k + 2],
    ]);

  it('cuts a box square-on in its own rectangle', () => {
    const count = sectionPlaneOutline(min, max, plane([1, 0, 0], 0), out);
    expect(count).toBe(4);
    for (const [x] of points(count)) expect(x).toBeCloseTo(0, 6);
    // The rectangle is the box's YZ face: 100 x 400.
    const ys = points(count).map(p => p[1]);
    const zs = points(count).map(p => p[2]);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(100, 6);
    expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(400, 6);
  });

  it('returns nothing when the plane misses the box', () => {
    expect(sectionPlaneOutline(min, max, plane([1, 0, 0], -500), out)).toBe(0);
    expect(sectionPlaneOutline(min, max, plane([1, 0, 0], 500), out)).toBe(0);
  });

  it('gives a triangle across a corner and a hexagon across a cube diagonal', () => {
    // Just inside the (max, max, max) corner — the normal is normalized, so the
    // constant is measured in the same units.
    const corner = plane([1, 1, 1], -((100 + 50 + 200) / Math.sqrt(3)) * 0.95);
    expect(sectionPlaneOutline(min, max, corner, out)).toBe(3);

    // ⚠️ A cube, deliberately: the diagonal cross-section is a hexagon only when
    // the box is cubic. The 200x100x400 box above gives a quad, which is right.
    const cubeMin: Vec3 = [-100, -100, -100];
    const cubeMax: Vec3 = [100, 100, 100];
    expect(
      sectionPlaneOutline(cubeMin, cubeMax, plane([1, 1, 1], 0), out),
    ).toBe(6);
    expect(sectionPlaneOutline(min, max, plane([1, 1, 1], 0), out)).toBe(4);
  });

  it('walks the outline in boundary order', () => {
    const count = sectionPlaneOutline(min, max, plane([1, 1, 1], 0), out);
    const pts = points(count);
    // In boundary order every step is short; in an arbitrary order some step
    // would jump across the polygon.
    const steps = pts.map((p, k) => {
      const q = pts[(k + 1) % count];
      return Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
    });
    const perimeter = steps.reduce((a, b) => a + b, 0);
    expect(Math.max(...steps)).toBeLessThan(perimeter / 2);
  });

  it('is empty for a plane lying on a face', () => {
    // The whole box is on one side, touching only — nothing is removed.
    expect(sectionPlaneOutline(min, max, plane([-1, 0, 0], -100), out)).toBe(0);
  });
});
