import { describe, expect, it } from 'vitest';
import {
  createFenceField,
  sampleFenceField,
} from '../src/sdk/geometries/wellbore-fence';
import {
  buildFenceRibbons,
  createStackLocator,
} from '../src/sdk/geometries/fence-ribbon';
import {
  packTriangleMask,
  StackSectionSource,
} from '../src/sdk/geometries/surface-section';
import { Vec2 } from '../src/sdk/types/common';
import {
  nearestOnPolyline,
  resamplePolyline2D,
} from '../src/sdk/utils/polyline-2d';

const bounds: [number, number, number, number] = [-1000, -1000, 1000, 1000];

/** A grid of `n` x `n` quads over [0, n] in XZ, with two flat layers. */
function flatStack(n: number, topY: number, thickness: number) {
  const side = n + 1;
  const positionsXZ = new Float32Array(side * side * 2);
  for (let r = 0; r < side; r++) {
    for (let c = 0; c < side; c++) {
      positionsXZ[2 * (r * side + c)] = c;
      positionsXZ[2 * (r * side + c) + 1] = r;
    }
  }
  const tris: number[] = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const a = r * side + c;
      tris.push(a, a + 1, a + side + 1, a, a + side + 1, a + side);
    }
  }
  const indices = new Uint32Array(tris);
  const count = side * side;
  const source: StackSectionSource = {
    positionsXZ,
    indices,
    heights: [
      new Float32Array(count).fill(topY),
      new Float32Array(count).fill(topY - thickness),
    ],
    intervals: [packTriangleMask(new Uint8Array(indices.length / 3).fill(1))],
  };
  return source;
}

describe('nearestOnPolyline', () => {
  it('projects onto the nearest segment and reports the arc length', () => {
    const line: Vec2[] = [
      [0, 0],
      [100, 0],
      [100, 100],
    ];
    const a = nearestOnPolyline(line, 50, 30)!;
    expect(a.point).toEqual([50, 0]);
    expect(a.distance).toBeCloseTo(30, 6);
    expect(a.along).toBeCloseTo(50, 6);

    const b = nearestOnPolyline(line, 130, 60)!;
    expect(b.point[0]).toBeCloseTo(100, 6);
    expect(b.distance).toBeCloseTo(30, 6);
    expect(b.along).toBeCloseTo(160, 6);
  });
});

describe('the cut face and the cut agree', () => {
  it('puts every face vertex on the field zero set', () => {
    // ⭐⭐ THE invariant of the whole feature, and what replaces the old
    // "these two functions must match" contract: the face is swept from the very
    // curve the field was built from, so the shader's `< 0` test and the drawn
    // face describe one surface. Anything but ~0 here is a sliver of block
    // standing proud of the face, or a gap behind it.
    // ⚠️ Diagonal on purpose: an axis-aligned curve is the one case a bowed
    // interpolation also gets right, so it would not catch a regression.
    const curve: Vec2[] = [
      [-1500, -1500],
      [1500, 1500],
    ];
    const field = createFenceField(curve, {
      bounds,
      cellSize: 50,
      seed: [-500, 500],
    })!;
    const sample = sampleFenceField(field);
    for (const p of resamplePolyline2D(curve, 7)) {
      if (Math.abs(p[0]) > 900 || Math.abs(p[1]) > 900) continue;
      expect(Math.abs(sample(p[0], p[1]))).toBeLessThan(1e-3);
    }
  });

  it('signs the half the seed is in as removed', () => {
    const curve: Vec2[] = [
      [-1500, 0],
      [1500, 0],
    ];
    const seed: Vec2 = [0, 500];
    const field = createFenceField(curve, { bounds, cellSize: 50, seed })!;
    const sample = sampleFenceField(field);
    expect(field.separated).toBe(true);
    expect(sample(seed[0], seed[1])).toBeLessThan(0);
    expect(sample(0, -500)).toBeGreaterThan(0);
  });

  it('keeps the sign band straight at cell period', () => {
    // ⚠️ The barrier cells the flood fill cannot enter used to keep no sign at
    // all and were forced onto one side, which wobbles the zero contour at CELL
    // PERIOD even where the curve is dead straight. Off-lattice on purpose: a 45°
    // line lands on the grid so its barrier cells have distance 0 and the sign
    // never shows.
    const curve: Vec2[] = [
      [-1500, -700],
      [1500, 800],
    ];
    const field = createFenceField(curve, {
      bounds,
      cellSize: 50,
      seed: [-900, 900],
    })!;
    const sample = sampleFenceField(field);
    // Only where the grid actually is: the sampler clamps at its border, and the
    // curve deliberately runs past it.
    for (const p of resamplePolyline2D(curve, 11)) {
      if (Math.abs(p[0]) > 900 || Math.abs(p[1]) > 900) continue;
      expect(Math.abs(sample(p[0], p[1]))).toBeLessThan(0.5);
    }
  });
});

describe('buildFenceRibbons', () => {
  it('reaches the edge of the tessellation', () => {
    // ⚠️ The quad straddling the boundary used to be dropped whole, so the face
    // stopped up to one resample step short of the wall while the cut ran all the
    // way to it — a full-height slit whose width was whatever fraction of a step
    // was left over, so it came and went with the data.
    const source = flatStack(4, 0, 10);
    const path: Vec2[] = [];
    for (let x = -1; x <= 5; x += 0.7) path.push([x, 2]);
    const ribbons = buildFenceRibbons(source, path);
    expect(ribbons).toHaveLength(1);
    const position = ribbons[0].geometry.getAttribute('position');
    let minX = Infinity;
    let maxX = -Infinity;
    for (let i = 0; i < position.count; i++) {
      minX = Math.min(minX, position.getX(i));
      maxX = Math.max(maxX, position.getX(i));
    }
    expect(minX).toBeCloseTo(0, 4);
    expect(maxX).toBeCloseTo(4, 4);
  });

  it('gives the face metres along the curve as u', () => {
    // ⭐ `u` comes from the path itself. Reading it back out of a rasterised
    // "distance along" field made it discontinuous across the medial axis of
    // every bend, which is where a wellbore fence spends its time.
    const source = flatStack(4, 0, 10);
    const path: Vec2[] = [
      [0.5, 2],
      [3.5, 2],
    ];
    const ribbons = buildFenceRibbons(source, path, { alongOffset: 100 });
    const uv = ribbons[0].geometry.getAttribute('uv');
    let minU = Infinity;
    let maxU = -Infinity;
    for (let i = 0; i < uv.count; i++) {
      minU = Math.min(minU, uv.getX(i));
      maxU = Math.max(maxU, uv.getX(i));
    }
    expect(minU).toBeCloseTo(100, 4);
    expect(maxU).toBeCloseTo(103, 4);
  });

  it('keeps the top edge on the surface when the face is offset', () => {
    // ⚠️ Heights used to be read where the PATH ran while the face was drawn
    // `offset` metres away, so an offset face's top edge no longer met the cap.
    const source = flatStack(4, 0, 10);
    // A sloping top, so reading the height at the wrong place shows up.
    const side = 5;
    for (let r = 0; r < side; r++) {
      for (let c = 0; c < side; c++) {
        source.heights[0][r * side + c] = r * 2;
        source.heights[1][r * side + c] = r * 2 - 10;
      }
    }
    const locator = createStackLocator(source.positionsXZ, source.indices);
    const path: Vec2[] = [
      [1, 2],
      [3, 2],
    ];
    const ribbons = buildFenceRibbons(source, path, { offset: 0.5 });
    const position = ribbons[0].geometry.getAttribute('position');
    for (let i = 0; i < position.count; i++) {
      const at = locator.locate(position.getX(i), position.getZ(i));
      if (!at) continue;
      const top = locator.valueAt(at, source.heights[0]);
      const bottom = locator.valueAt(at, source.heights[1]);
      const y = position.getY(i);
      expect(Math.min(Math.abs(y - top), Math.abs(y - bottom))).toBeLessThan(
        1e-4,
      );
    }
  });

  it('shades the same where it is cut at a unit boundary', () => {
    // ⚠️ The boundary adds two points on the chord beside a sample. Normals by
    // central difference then took that sample's from one segment instead of the
    // curve, a step in the shading at every pinch-out the face stops at.
    const n = 40;
    const plain = flatStack(n, 0, 10);
    const cut = flatStack(n, 0, 10);
    const triangles = plain.indices.length / 3;
    const members = new Uint8Array(triangles);
    for (let t = 0; t < triangles; t++) {
      let x = 0;
      for (let c = 0; c < 3; c++)
        x += plain.positionsXZ[2 * plain.indices[3 * t + c]];
      members[t] = x / 3 < 22.3 ? 1 : 0;
    }
    cut.intervals = [packTriangleMask(members)];
    const path: Vec2[] = [];
    for (let a = 120; a >= 60; a -= 3) {
      const r = (a * Math.PI) / 180;
      path.push([20 + 40 * Math.cos(r), -10 + 40 * Math.sin(r)]);
    }

    const normals = (source: StackSectionSource) => {
      const geometry = buildFenceRibbons(source, path)[0].geometry;
      const position = geometry.getAttribute('position');
      const normal = geometry.getAttribute('normal');
      const out = new Map<string, [number, number]>();
      for (let i = 0; i < position.count; i++) {
        out.set(
          `${position.getX(i).toFixed(4)},${position.getZ(i).toFixed(4)}`,
          [normal.getX(i), normal.getZ(i)],
        );
      }
      return out;
    };
    const whole = normals(plain);
    const stopped = normals(cut);
    const key = (p: Vec2) =>
      `${Math.fround(p[0]).toFixed(4)},${Math.fround(p[1]).toFixed(4)}`;
    const sideways = (a: [number, number], b: [number, number]) =>
      Math.abs(a[0] * b[1] - a[1] * b[0]);
    let compared = 0;
    let added = 0;
    let worstKept = 0;
    let worstAdded = 0;
    for (const [at, normal] of stopped) {
      const expected = whole.get(at);
      if (expected) {
        compared++;
        worstKept = Math.max(worstKept, sideways(normal, expected));
        continue;
      }
      // A point the cut added: it shades as the uncut face does there.
      const [x, z] = at.split(',').map(Number);
      for (let k = 0; k + 1 < path.length; k++) {
        const [ax, az] = path[k];
        const [bx, bz] = path[k + 1];
        const len = Math.hypot(bx - ax, bz - az);
        const f = ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / (len * len);
        if (f <= 0 || f >= 1) continue;
        if (Math.abs((x - ax) * (bz - az) - (z - az) * (bx - ax)) / len > 1e-3)
          continue;
        const a = whole.get(key(path[k]))!;
        const b = whole.get(key(path[k + 1]))!;
        const mx = (1 - f) * a[0] + f * b[0];
        const mz = (1 - f) * a[1] + f * b[1];
        const m = Math.hypot(mx, mz);
        worstAdded = Math.max(worstAdded, sideways(normal, [mx / m, mz / m]));
        added++;
        break;
      }
    }
    expect(compared).toBeGreaterThan(5);
    expect(added).toBeGreaterThan(0);
    expect(worstKept).toBeLessThan(1e-6);
    expect(worstAdded).toBeLessThan(1e-5);
  });

  it.each([false, true])(
    'winds every triangle to face along its normal (flip: %s)',
    flip => {
      // ⚠️ The winding once ignored `flip`: a double-sided material then saw the
      // back face and negated the normal, lighting the `left` side from behind.
      const source = flatStack(4, 0, 10);
      const path: Vec2[] = [
        [0.5, 0.5],
        [2, 1.5],
        [3.5, 3.5],
      ];
      const ribbons = buildFenceRibbons(source, path, { flip });
      const position = ribbons[0].geometry.getAttribute('position');
      const normal = ribbons[0].geometry.getAttribute('normal');
      expect(position.count).toBeGreaterThan(0);
      for (let i = 0; i < position.count; i += 3) {
        const ax = position.getX(i);
        const ay = position.getY(i);
        const az = position.getZ(i);
        const ex = position.getX(i + 1) - ax;
        const ey = position.getY(i + 1) - ay;
        const ez = position.getZ(i + 1) - az;
        const fx = position.getX(i + 2) - ax;
        const fy = position.getY(i + 2) - ay;
        const fz = position.getZ(i + 2) - az;
        const cx = ey * fz - ez * fy;
        const cz = ex * fy - ey * fx;
        const n = cx * normal.getX(i) + cz * normal.getZ(i);
        expect(n).toBeGreaterThan(0);
      }
    },
  );
});

describe('fence faces across unfilled intervals', () => {
  // filled 0 → -10, then an unfilled interval -10 → -30 over the half x < 2.
  function gappedStack(isVoid: boolean) {
    const source = flatStack(4, 0, 10);
    const count = source.heights[0].length;
    source.heights.push(new Float32Array(count).fill(-30));
    const triangles = source.indices.length / 3;
    const open = new Uint8Array(triangles);
    for (let t = 0; t < triangles; t++) {
      const v = source.indices[3 * t];
      if (source.positionsXZ[2 * v] < 2) open[t] = 1;
    }
    source.intervals.push(null);
    source.gaps = [null, packTriangleMask(open)];
    source.voids = [false, isVoid];
    return source;
  }
  const path: Vec2[] = [];
  for (let x = 0.25; x <= 3.75; x += 0.5) path.push([x, 2.2]);

  it('builds them only when asked', () => {
    const source = gappedStack(false);
    expect(buildFenceRibbons(source, path).map(r => r.interval)).toEqual([0]);
    const ribbons = buildFenceRibbons(source, path, { gaps: true });
    expect(ribbons.map(r => [r.interval, !!r.gap])).toEqual([
      [0, false],
      [1, true],
    ]);
    // Only over the gap's own triangles.
    const position = ribbons[1].geometry.getAttribute('position');
    for (let i = 0; i < position.count; i++) {
      expect(position.getX(i)).toBeLessThanOrEqual(2 + 1e-6);
      expect(position.getY(i)).toBeGreaterThanOrEqual(-30 - 1e-6);
      expect(position.getY(i)).toBeLessThanOrEqual(-10 + 1e-6);
    }
  });

  it('tells a void from a gap', () => {
    const source = gappedStack(true);
    expect(buildFenceRibbons(source, path, { gaps: true })).toHaveLength(1);
    expect(buildFenceRibbons(source, path, { voids: true })).toHaveLength(2);
  });
});
