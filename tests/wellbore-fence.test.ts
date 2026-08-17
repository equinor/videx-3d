import { describe, expect, it } from 'vitest';
import {
  createFenceField,
  createFencePolyline,
  extendFencePolyline,
  fenceCurves,
  fenceTaperRange,
  fenceWidthAt,
  removeChainLoops,
  sampleFenceField,
} from '../src/sdk/geometries/wellbore-fence';
import { Vec2, Vec3 } from '../src/sdk/types/common';

/** A square ring in scene XZ, centred on the origin. */
const square = (half: number): Vec2[] => [
  [-half, -half],
  [half, -half],
  [half, half],
  [-half, half],
];

describe('createFencePolyline', () => {
  it('projects onto XZ and reports the depth range', () => {
    const path: Vec3[] = [
      [0, 0, 0],
      [100, -500, 0],
      [200, -1200, 50],
    ];
    const fence = createFencePolyline(path, 50);
    expect(fence).not.toBeNull();
    expect(fence!.top).toBe(0);
    expect(fence!.bottom).toBe(-1200);
    // Every sample is on the XZ plane of the input, in order.
    expect(fence!.positions[0]).toEqual([0, 0]);
    expect(fence!.positions.length).toBeGreaterThan(1);
  });

  it('does not extend — that is a separate, outline-aware step', () => {
    const path: Vec3[] = [
      [0, 0, 0],
      [300, -1000, 0],
    ];
    const fence = createFencePolyline(path, 50)!;
    const xs = fence.positions.map(p => p[0]);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs)).toBeLessThanOrEqual(300);
  });
});

describe('extendFencePolyline', () => {
  const rings = [square(1000)];

  it('runs both ends clear of the outline', () => {
    const positions: Vec2[] = [
      [-100, 0],
      [100, 0],
    ];
    const extended = extendFencePolyline(positions, { rings, margin: 200 });
    expect(extended.length).toBe(positions.length + 2);
    // Both new ends are outside the square, by at least the margin.
    expect(extended[0][0]).toBeLessThan(-1000);
    expect(extended[extended.length - 1][0]).toBeGreaterThan(1000);
  });

  it('sends the two extensions opposite ways for a well with no plan deviation', () => {
    // A vertical well: every sample lands on the same XZ point.
    const positions: Vec2[] = [
      [0, 0],
      [0, 0],
      [0, 0],
    ];
    const extended = extendFencePolyline(positions, {
      rings,
      margin: 100,
      azimuth: 0,
    });
    const start = extended[0];
    const end = extended[extended.length - 1];
    expect(Math.sign(start[0])).toBe(-Math.sign(end[0]));
    expect(Math.abs(start[0])).toBeGreaterThan(1000);
    expect(Math.abs(end[0])).toBeGreaterThan(1000);
  });

  it('does not let a barely-deviated well point both extensions the same way', () => {
    // 20 m of plan deviation — under FENCE_MIN_DEVIATION, so the start direction
    // must be taken as the reverse of the end one rather than from the trace.
    const positions: Vec2[] = [
      [0, 0],
      [20, 0],
    ];
    const extended = extendFencePolyline(positions, { rings, margin: 100 });
    const start = extended[0];
    const end = extended[extended.length - 1];
    expect(start[0]).toBeLessThan(-1000);
    expect(end[0]).toBeGreaterThan(1000);
  });

  /** Share of a square footprint each side of the finished curve holds. */
  const shares = (curve: Vec2[], half: number) => {
    const field = createFenceField(curve, {
      bounds: [-half, -half, half, half],
      cellSize: (2 * half) / 96,
    })!;
    let pos = 0;
    let neg = 0;
    for (let r = 0; r < field.ny; r++) {
      const z = field.origin[1] + r * field.cell;
      if (z < -half || z > half) continue;
      for (let c = 0; c < field.nx; c++) {
        const x = field.origin[0] + c * field.cell;
        if (x < -half || x > half) continue;
        if (field.values[r * field.nx + c] >= 0) pos++;
        else neg++;
      }
    }
    // side +1 removes the negative component, side -1 the positive one.
    return {
      removedByPlus: neg / (pos + neg),
      removedByMinus: pos / (pos + neg),
    };
  };

  // A well that leaves the head heading +X through a short shallow arc, turns
  // right round and runs back out over itself heading -X — the shape NO 15/9-F-12
  // has, and the one whose run-outs pinch the removed side to nothing.
  const hook: Vec2[] = [
    [0, 0],
    [30, 5],
    [70, 15],
    [110, 35],
    [130, 80],
    [110, 120],
    [40, 140],
    [-60, 130],
    [-300, 90],
    [-700, 60],
    [-1100, 45],
  ];

  it('leaves the removed side a usable piece of block, for either side', () => {
    for (const side of [1, -1] as const) {
      const extended = extendFencePolyline(hook, {
        rings: [square(2000)],
        margin: 200,
        side,
      });
      const s = shares(extended, 2000);
      const removed = side > 0 ? s.removedByPlus : s.removedByMinus;
      // ⚠️ The measure that matters: a run-out pair that pinches this to a few
      // percent gives a cut that either shows nothing or removes everything.
      expect(removed).toBeGreaterThan(0.2);
    }
  });

  /** Smallest angle between a run-out and any trace point beyond `near`. */
  const clearanceAt = (
    positions: Vec2[],
    apex: Vec2,
    tip: Vec2,
    near = 50,
  ): number => {
    const dir = Math.atan2(tip[1] - apex[1], tip[0] - apex[0]);
    let closest = Math.PI;
    for (const p of positions) {
      const vx = p[0] - apex[0];
      const vz = p[1] - apex[1];
      if (Math.hypot(vx, vz) < near) continue;
      let d = Math.abs(Math.atan2(vz, vx) - dir);
      if (d > Math.PI) d = 2 * Math.PI - d;
      if (d < closest) closest = d;
    }
    return closest;
  };

  it('keeps each run-out clear of the trace it leaves', () => {
    // ⚠️⚠️ Independent of the share objective, and NOT implied by it: a run-out
    // folded back alongside the well still splits the block evenly, so it scores
    // well while the cut it opens is a razor wedge closing to nothing at the head.
    // Deleting this constraint put NO 15/9-F-15 D back to a 2 degree head opening
    // with perfectly healthy 25/75 shares.
    for (const side of [1, -1] as const) {
      for (const reveal of [0.15, 0.5, 0.8]) {
        const extended = extendFencePolyline(hook, {
          rings: [square(2000)],
          margin: 200,
          side,
          reveal,
        });
        const head = clearanceAt(hook, hook[0], extended[0]);
        const tail = clearanceAt(
          hook,
          hook[hook.length - 1],
          extended[extended.length - 1],
        );
        expect(head).toBeGreaterThan(Math.PI / 6);
        expect(tail).toBeGreaterThan(Math.PI / 6);
      }
    }
  });

  it('gives both sides the same curve when one pair serves both', () => {
    // A plain deviated well splits the block cleanly whichever way it is cut, so
    // there is nothing to gain by resolving the two sides differently — and the
    // two views should show the same section.
    const clean: Vec2[] = [];
    for (let x = -800; x <= 800; x += 100) clean.push([x, x * 0.3]);
    const plus = extendFencePolyline(clean, {
      rings: [square(2000)],
      margin: 200,
      side: 1,
    });
    const minus = extendFencePolyline(clean, {
      rings: [square(2000)],
      margin: 200,
      side: -1,
    });
    expect(minus[0][0]).toBeCloseTo(plus[0][0], 6);
    expect(minus[0][1]).toBeCloseTo(plus[0][1], 6);
    expect(minus[minus.length - 1][0]).toBeCloseTo(plus[plus.length - 1][0], 6);
  });
});

describe('fenceCurves', () => {
  const hook: Vec2[] = [];
  for (let i = 0; i <= 20; i++) {
    const t = i / 20;
    hook.push([-600 + 1200 * t, 400 * Math.sin(Math.PI * t) - 300 * t]);
  }

  it('agrees bit for bit with extendFencePolyline on both sides', () => {
    // ⚠️ The wrapper is the whole point: one search now resolves both sides, so
    // any drift here is a silent change to every existing caller's cut.
    for (const reveal of [0.1, 0.25, 0.5, 0.75]) {
      const options = { rings: [square(2000)], margin: 200, reveal };
      const curves = fenceCurves(hook, options);
      expect(curves.plus).toEqual(
        extendFencePolyline(hook, { ...options, side: 1 }),
      );
      expect(curves.minus).toEqual(
        extendFencePolyline(hook, { ...options, side: -1 }),
      );
    }
  });

  it('hands back one array, not two equal ones, when the sides agree', () => {
    // ⭐ Identity is the signal `useStackFence` keys on to build a single field
    // and texture for both sides — equality would force it to build two.
    const clean: Vec2[] = [];
    for (let x = -800; x <= 800; x += 100) clean.push([x, x * 0.3]);
    const curves = fenceCurves(clean, { rings: [square(2000)], margin: 200 });
    expect(curves.shared).toBe(true);
    expect(curves.minus).toBe(curves.plus);
  });

  it('shares the curve for a well with no plan deviation', () => {
    const curves = fenceCurves(
      [
        [0, 0],
        [10, 0],
      ],
      { rings: [square(2000)], margin: 200, azimuth: 0 },
    );
    expect(curves.shared).toBe(true);
    expect(curves.minus).toBe(curves.plus);
  });
});

describe('fence taper', () => {
  it('reads the shallow depth off the path, not off the plan step count', () => {
    // 800 m of hole for the first 20 m of plan — the near-vertical section whose
    // plan trace says nothing about how deep it goes.
    const path: Vec3[] = [
      [0, 0, 0],
      [20, -800, 0],
      [520, -1600, 0],
    ];
    const fence = createFencePolyline(path, 20)!;
    expect(fence.depths.length).toBe(fence.positions.length);
    expect(fence.depths[0]).toBeCloseTo(0, 6);
    // The second sample is 20 m along in PLAN, which is 800 m down.
    expect(fence.depths[1]).toBeCloseTo(-800, 3);
    expect(fence.depths[fence.depths.length - 1]).toBeCloseTo(-1600, 3);
  });

  it('turns a depth range into the arc lengths it spans', () => {
    const positions: Vec2[] = [
      [0, 0],
      [100, 0],
      [200, 0],
      [300, 0],
    ];
    const depths = [0, -500, -1500, -2500];
    const [from, to] = fenceTaperRange(positions, depths, -500, -1500);
    expect(from).toBeCloseTo(100, 6);
    expect(to).toBeCloseTo(200, 6);
  });

  it('runs to the end of the curve when the deep limit is never reached', () => {
    const positions: Vec2[] = [
      [0, 0],
      [100, 0],
      [200, 0],
    ];
    const [, to] = fenceTaperRange(positions, [0, -100, -200], -50, -9000);
    expect(to).toBeCloseTo(200, 6);
  });

  it('holds the head width, falls smoothly, and is off outside the range', () => {
    const taper = { headWidth: 400, from: 1000, to: 2000 };
    expect(fenceWidthAt(taper, 0)).toBe(400);
    expect(fenceWidthAt(taper, 1000)).toBe(400);
    expect(fenceWidthAt(taper, 1500)).toBeCloseTo(200, 6);
    expect(fenceWidthAt(taper, 2000)).toBe(0);
    expect(fenceWidthAt(taper, 5000)).toBe(0);
    expect(fenceWidthAt(null, 1500)).toBe(0);
    // ⚠️ A degenerate range must disable it rather than divide by zero — the
    // shader's guard is the same test.
    expect(fenceWidthAt({ headWidth: 400, from: 2000, to: 2000 }, 1500)).toBe(
      0,
    );
  });

  it('matches the smoothstep the shader uses', () => {
    // ⚠️⚠️ `fenceTaperWidth` in depth-map.glsl is
    // `taper.x * (1 - smoothstep(taper.y, taper.z, along))`. The cut face is
    // placed with the CPU one and the block removed by the GPU one, so a
    // disagreement is a sliver of block standing proud of the face.
    const taper = { headWidth: 300, from: 400, to: 1600 };
    const smoothstep = (a: number, b: number, x: number) => {
      const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
      return t * t * (3 - 2 * t);
    };
    for (let along = 0; along <= 2000; along += 37) {
      expect(fenceWidthAt(taper, along)).toBeCloseTo(
        300 * (1 - smoothstep(400, 1600, along)),
        9,
      );
    }
  });
});

describe('removeChainLoops', () => {
  const crossings = (e: Vec2[]) => {
    const hit = (a: Vec2, b: Vec2, c: Vec2, d: Vec2) => {
      const rx = b[0] - a[0];
      const rz = b[1] - a[1];
      const sx = d[0] - c[0];
      const sz = d[1] - c[1];
      const den = rx * sz - rz * sx;
      if (den === 0) return false;
      const t = ((c[0] - a[0]) * sz - (c[1] - a[1]) * sx) / den;
      const u = ((c[0] - a[0]) * rz - (c[1] - a[1]) * rx) / den;
      return t > 1e-9 && t < 1 - 1e-9 && u > 1e-9 && u < 1 - 1e-9;
    };
    let n = 0;
    for (let i = 0; i + 1 < e.length; i++)
      for (let j = i + 2; j + 1 < e.length; j++)
        if (hit(e[i], e[i + 1], e[j], e[j + 1])) n++;
    return n;
  };

  // ⚠️ The return leg has to cross the outgoing one TRANSVERSALLY. Coming back to
  // the same vertex is a touch, not a crossing, and nothing detects it.
  const loopAt = (x: number): Vec2[] => [
    [x + 100, 0],
    [x + 200, 0],
    [x + 260, 60],
    [x + 200, 120],
    [x + 140, 60],
    [x + 150, -20],
    [x + 300, 0],
  ];

  it('excises a loop and leaves the rest of the chain alone', () => {
    const chain: Vec2[] = [[0, 0], ...loopAt(0), [500, 0]];
    expect(crossings(chain)).toBeGreaterThan(0);
    const clean = removeChainLoops(chain);
    expect(crossings(clean)).toBe(0);
    // Both ends survive — they are what carries the fence out of the block.
    expect(clean[0]).toEqual([0, 0]);
    expect(clean[clean.length - 1]).toEqual([500, 0]);
    expect(clean.length).toBeLessThan(chain.length);
  });

  it('returns a chain with no loops unchanged', () => {
    const straight: Vec2[] = [
      [0, 0],
      [100, 10],
      [200, 30],
      [300, 60],
      [400, 100],
    ];
    expect(removeChainLoops(straight)).toEqual(straight);
  });

  it('clears a chain that loops more than once', () => {
    const chain: Vec2[] = [
      [0, 0],
      ...loopAt(0),
      ...loopAt(500),
      ...loopAt(1000),
      [1500, 0],
    ];
    expect(crossings(chain)).toBeGreaterThan(2);
    expect(crossings(removeChainLoops(chain))).toBe(0);
  });
});

describe('createFenceField', () => {
  const bounds: [number, number, number, number] = [-1000, -1000, 1000, 1000];

  it('measures distance to a straight fence and flips sign across it', () => {
    // A line along Z at x = 0, spanning the whole area.
    const positions: Vec2[] = [
      [0, -1500],
      [0, 1500],
    ];
    const field = createFenceField(positions, { bounds, cellSize: 25 })!;
    const at = sampleFenceField(field);

    for (const x of [-800, -400, -100, 100, 400, 800]) {
      // ⭐ EXACT, not approximate: the distance is measured against the polyline
      // itself, and bilinear sampling of a field that is linear either side of
      // the curve reproduces it. A chamfer transform would be a few percent out.
      expect(Math.abs(at(x, 0))).toBeCloseTo(Math.abs(x), 3);
    }
    expect(Math.sign(at(-500, 0))).toBe(-Math.sign(at(500, 0)));
    expect(Math.abs(at(0, 0))).toBeLessThan(1e-6);
  });

  it('puts the zero contour ON the curve, even between grid nodes', () => {
    // ⚠️⚠️ THE regression guard for the barrier band. The flood fill that signs
    // the field cannot enter the cells the curve passes through, so those cells
    // used to keep the negative sign whichever side they were on — a one-cell
    // band of wrong-signed values straddling the curve, each wrong by its own
    // distance. The zero contour then wiggled at CELL PERIOD, which is the
    // jagged cut at width 0. It hides on a curve that lands on the lattice
    // (distance 0 either way), so this one deliberately sits between nodes.
    const offset = 7.3;
    const positions: Vec2[] = [
      [offset, -1500],
      [offset, 1500],
    ];
    const field = createFenceField(positions, { bounds, cellSize: 25 })!;
    const at = sampleFenceField(field);

    for (let z = -900; z <= 900; z += 37) {
      expect(Math.abs(at(offset, z))).toBeLessThan(0.05);
    }
    // And it still measures true distance immediately either side of the band.
    expect(at(offset + 25, 0)).toBeCloseTo(-at(offset - 25, 0), 4);
    expect(Math.abs(at(offset + 25, 0))).toBeCloseTo(25, 4);
  });

  it('keeps a diagonal cut straight at every iso, not just the wide ones', () => {
    // The same failure seen from the contour's side: walk out to a series of
    // widths and check each iso is flat. ⚠️ The diagonal is nudged OFF the
    // lattice on purpose — an exact x=z diagonal passes through grid nodes, so
    // its barrier cells all sit at distance 0 and the sign bug cannot show.
    const skew = 9.4;
    const positions: Vec2[] = [
      [-1500 + skew, -1500],
      [1500 + skew, 1500],
    ];
    const field = createFenceField(positions, { bounds, cellSize: 25 })!;
    const at = sampleFenceField(field);
    const inv = Math.SQRT1_2;

    for (const width of [0, 10, 25, 60, 200]) {
      let min = Infinity;
      let max = -Infinity;
      for (let t = -800; t <= 800; t += 13) {
        // A point exactly `width` off the line, on the positive side.
        const v = at(t * inv - width * inv + skew, t * inv + width * inv);
        if (v < min) min = v;
        if (v > max) max = v;
      }
      expect(max - min).toBeLessThan(0.05);
      expect(Math.abs(Math.abs(max) - width)).toBeLessThan(0.05);
    }
  });

  it('is not anisotropic — every direction measures the same', () => {
    // ⚠️ THE regression guard for the chamfer transform, whose error depends on
    // DIRECTION: it overestimates diagonals by a few percent, which at a
    // kilometre-wide corridor makes it visibly wider on the diagonals.
    // ⚠️ The tolerance is a quarter of a cell, not zero: the sampler is
    // Hermite-weighted to match the shader exactly, and that bows between nodes.
    // The node VALUES are exact; a chamfer's are not, and would miss by 10-20 m.
    const positions: Vec2[] = [
      [-1500, -1500],
      [1500, 1500],
    ];
    const cellSize = 25;
    const field = createFenceField(positions, { bounds, cellSize })!;
    const at = sampleFenceField(field);
    const d = 500;
    for (let i = 0; i < 8; i++) {
      // Perpendicular offsets from the 45° line, swept around it.
      const angle = Math.PI / 4 + (i / 8) * 2 * Math.PI;
      const x = Math.cos(angle) * d;
      const z = Math.sin(angle) * d;
      const truth = Math.abs(x - z) / Math.SQRT2;
      expect(Math.abs(Math.abs(at(x, z)) - truth)).toBeLessThan(
        cellSize * 0.25,
      );
    }
  });

  it('flips which side is removed', () => {
    const positions: Vec2[] = [
      [0, -1500],
      [0, 1500],
    ];
    const a = sampleFenceField(
      createFenceField(positions, { bounds, cellSize: 25 })!,
    );
    const b = sampleFenceField(
      createFenceField(positions, { bounds, cellSize: 25, flip: true })!,
    );
    expect(Math.sign(a(500, 0))).toBe(-Math.sign(b(500, 0)));
    expect(a(500, 0)).toBeCloseTo(-b(500, 0), 3);
  });

  it('stays finite where the trajectory turns back on itself', () => {
    // A hairpin: out, back past itself, and out again.
    const positions: Vec2[] = [
      [-900, -300],
      [500, -300],
      [500, 0],
      [-500, 0],
      [-500, 300],
      [900, 300],
    ];
    const field = createFenceField(positions, { bounds, cellSize: 25 })!;
    expect(field.values.every(v => Number.isFinite(v))).toBe(true);
    const at = sampleFenceField(field);
    // The magnitude is a distance to the SET, so the hairpin's own corridor is
    // near zero everywhere rather than needing an offset curve repaired.
    expect(Math.abs(at(0, -300))).toBeLessThan(25);
    expect(Math.abs(at(0, 0))).toBeLessThan(25);
    expect(Math.abs(at(0, -150))).toBeGreaterThan(100);
  });

  it('honours the node budget by coarsening the cell', () => {
    const positions: Vec2[] = [
      [0, -1500],
      [0, 1500],
    ];
    const field = createFenceField(positions, {
      bounds,
      cellSize: 5,
      maxCells: 4096,
    })!;
    expect(field.nx * field.ny).toBeLessThanOrEqual(4096 * 1.3);
    expect(field.cell).toBeGreaterThan(5);
  });

  it('returns null for an empty trace or a degenerate area', () => {
    expect(createFenceField([], { bounds })).toBeNull();
    expect(createFenceField([[0, 0]], { bounds: [0, 0, 0, 0] })).toBeNull();
  });
});
