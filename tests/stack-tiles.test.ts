import { describe, expect, it } from 'vitest';
import { PlanarPolygonGeometry } from '../src/sdk/geometries/planar-geometry';
import { buildStackCapArrays } from '../src/sdk/geometries/stack-cap-arrays';
import { SurfaceClipHeader } from '../src/sdk/geometries/surface-clip';
import {
  refineStackSeam,
  stackTileInputBuffers,
  stackTileOutputBuffers,
  tessellateStackTile,
  thinChain,
} from '../src/sdk/geometries/stack-tiles';
import {
  collectStackCandidateLevels,
  collectStackCandidates,
} from '../src/sdk/geometries/surface-stack-candidates';
import {
  buildStackReference,
  planStackTessellation,
  StackGridLayer,
  StackTessellation,
  tessellateStack,
} from '../src/sdk/geometries/surface-stack';
import {
  buildSurfaceStack,
  planSurfaceStack,
  SurfaceStackOptions,
  SurfaceStackPlan,
} from '../src/sdk/geometries/surface-stack-geometry';
import { traceThicknessLines } from '../src/sdk/geometries/surface-stack-terminations';
import {
  getStackDerived,
  keepStackDerived,
  StackContext,
} from '../src/generators/surface-stack-context';

const N = 97;
const INC = 50;
const header: SurfaceClipHeader = {
  nx: N,
  ny: N,
  xinc: INC,
  yinc: INC,
  rot: 0,
};
const layerFrom = (depth: (c: number, r: number) => number | null) => {
  const values = new Float32Array(N * N);
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const d = depth(c, r);
      values[r * N + c] = d === null ? -1 : 3000 - d;
    }
  }
  return {
    values,
    header,
    referenceDepth: 3000,
    worldPosition: [0, 0],
  } as StackGridLayer;
};
// A skewed quadrilateral over grid columns/rows [lo, hi].
const outline = (lo: number, hi: number) =>
  new PlanarPolygonGeometry([
    [
      [
        [lo * INC, (lo - (N - 1)) * INC],
        [hi * INC, (lo - (N - 1)) * INC + 7.3],
        [hi * INC - 11.1, (hi - (N - 1)) * INC],
        [lo * INC + 3.7, (hi - (N - 1)) * INC],
      ],
    ],
  ]);
const relief = (c: number, r: number) => 60 * Math.sin(c / 5) * Math.cos(r / 7);
// A unit wedging out along a line, and a layer with a hole in its data.
const layers = () => [
  layerFrom((c, r) => 1000 + relief(c, r)),
  layerFrom(
    (c, r) => 1000 + relief(c, r) + Math.max(0, (c + 0.7 * r - 70) * 8),
  ),
  layerFrom((c, r) =>
    (c - 60) ** 2 + (r - 40) ** 2 < 150 ? null : 1400 + 0.5 * relief(r, c),
  ),
];

const area = ({ coords: c, indices }: StackTessellation) => {
  let sum = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const a = 2 * indices[i];
    const b = 2 * indices[i + 1];
    const d = 2 * indices[i + 2];
    sum +=
      Math.abs(
        (c[b] - c[a]) * (c[d + 1] - c[a + 1]) -
          (c[d] - c[a]) * (c[b + 1] - c[a + 1]),
      ) / 2;
  }
  return sum;
};

// Edges used by one triangle (the outline), their total length, and how many
// lie ON a seam — a crack shows up there, and as extra boundary length.
const boundary = ({ coords: c, indices }: StackTessellation, cells: number) => {
  const uses = new Map<string, number>();
  for (let i = 0; i < indices.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const u = indices[i + k];
      const v = indices[i + ((k + 1) % 3)];
      const key = u < v ? `${u}:${v}` : `${v}:${u}`;
      uses.set(key, (uses.get(key) ?? 0) + 1);
    }
  }
  const seam = (x: number) => (x + 0.5) % cells === 0;
  let length = 0;
  let onSeam = 0;
  let overused = 0;
  for (const [key, n] of uses) {
    if (n > 2) overused++;
    if (n !== 1) continue;
    const [u, v] = key.split(':').map(Number);
    length += Math.hypot(c[2 * v] - c[2 * u], c[2 * v + 1] - c[2 * u + 1]);
    if (
      (c[2 * u] === c[2 * v] && seam(c[2 * u])) ||
      (c[2 * u + 1] === c[2 * v + 1] && seam(c[2 * u + 1]))
    ) {
      onSeam++;
    }
  }
  return { length, onSeam, overused };
};

describe('tiled stack tessellation', () => {
  const polygon = outline(6, 90);
  const cut = outline(50, 96);
  const reference = buildStackReference(layers(), polygon)!;
  const lines = () =>
    [0, 1].map(
      i =>
        traceThicknessLines(
          reference.channels[i],
          reference.channels[i + 1],
          N,
          0.5,
          { channels: reference.channels, maxError: 5 },
        ).rings,
    );
  const cases: [string, () => Parameters<typeof tessellateStack>][] = [
    ['plain', () => [reference, polygon, 5]],
    ['a cut', () => [reference, polygon, 5, undefined, [cut]]],
    ['coverage', () => [reference, polygon, 5, undefined, undefined, true]],
    [
      'pinch-outs',
      () => [reference, polygon, 5, undefined, undefined, false, lines()],
    ],
    [
      'all of it',
      () => [reference, polygon, 5, undefined, [cut], true, lines()],
    ],
  ];

  for (const cells of [7, 16, 40]) {
    for (const [name, args] of cases) {
      it(`joins ${cells}-cell tiles without a crack (${name})`, () => {
        const whole = tessellateStack(...args())!;
        const withTiles = args();
        withTiles[7] = cells;
        const tiled = tessellateStack(...withTiles)!;

        expect(tiled.constraintFailures).toBe(0);
        expect(tiled.rimDropped).toBe(0);
        const a = boundary(whole, cells);
        const b = boundary(tiled, cells);
        expect(b.overused).toBe(0);
        expect(b.onSeam).toBe(0);
        expect(b.length).toBeCloseTo(a.length, 6);
        expect(area(tiled)).toBeCloseTo(area(whole), 3);
        expect((tiled.terminationRingPoints ?? 0) > 0).toBe(
          (whole.terminationRingPoints ?? 0) > 0,
        );
      });
    }
  }

  it('is the untiled build exactly when everything falls in one tile', () => {
    const whole = tessellateStack(...cases[4][1]())!;
    const args = cases[4][1]();
    args[7] = 1000;
    const plan = planStackTessellation(...args);
    expect(plan.tiles).toHaveLength(1);
    expect(plan.tiling).toBeUndefined();
    const one = tessellateStack(...args)!;
    expect(Array.from(one.coords)).toEqual(Array.from(whole.coords));
    expect(Array.from(one.indices)).toEqual(Array.from(whole.indices));
    expect(one.rimVertices).toEqual(whole.rimVertices);
  });

  it('describes its layout', () => {
    const args = cases[0][1]();
    args[7] = 16;
    const plan = planStackTessellation(...args);
    expect(plan.tiling?.cells).toBe(16);
    const [x, y] = plan.tiling!.count;
    expect(x).toBeGreaterThan(1);
    expect(y).toBeGreaterThan(1);
    expect(plan.tiles).toHaveLength(x * y);
  });
});

describe('a tiled stack across a worker boundary', () => {
  it('builds the same stack from tiles transferred out and back', () => {
    const polygon = outline(6, 90);
    const stackLayers = layers();
    const reference = buildStackReference(stackLayers, polygon)!;
    const options: SurfaceStackOptions = {
      polygon,
      maxError: 5,
      cuts: [outline(50, 96)],
      constrainCoverage: true,
      constrainTerminations: true,
      tileCells: 16,
    };
    const direct = buildSurfaceStack(reference, stackLayers, options)!;

    // What the pool does: each tile's arrays go out by transfer, the output back.
    const plan = planSurfaceStack(reference, stackLayers, options);
    expect(plan.tiles.length).toBeGreaterThan(1);
    const sent = plan.tiles.reduce((sum, tile) => sum + tile.nodes.length, 0);
    expect(sent).toBeGreaterThan(0);
    const posted = plan.tiles.map(tile =>
      structuredClone(tile, { transfer: stackTileInputBuffers(tile) }),
    );
    expect(plan.tiles.every(tile => tile.nodes.byteLength === 0)).toBe(true);
    const outputs = posted.map(tile => {
      const output = tessellateStackTile(tile);
      return structuredClone(output, {
        transfer: stackTileOutputBuffers(output),
      });
    });
    const pending = plan.begin(outputs)!;
    const viaTiles = pending.finish(
      pending.jobs.map((job, i) =>
        pending.finishCap(i, job && buildStackCapArrays(job)),
      ),
    );

    const a = direct.tessellation;
    const b = viaTiles.tessellation;
    expect(b.terminationRingPoints).toBeGreaterThan(0);
    expect(Array.from(b.coords)).toEqual(Array.from(a.coords));
    expect(Array.from(b.indices)).toEqual(Array.from(a.indices));
    expect(b.rimVertices).toEqual(a.rimVertices);
    expect(b.terminationVertices).toEqual(a.terminationVertices);
    expect(viaTiles.heights.map(h => Array.from(h))).toEqual(
      direct.heights.map(h => Array.from(h)),
    );
  });
});

describe('reusing what a stack plan derived', () => {
  const polygon = outline(6, 90);
  const stackLayers = layers();
  const reference = buildStackReference(stackLayers, polygon)!;
  const options: SurfaceStackOptions = {
    polygon,
    maxError: 5,
    constrainTerminations: true,
    tileCells: 16,
  };
  const tessellationOf = (plan: SurfaceStackPlan) => {
    const pending = plan.begin(plan.tiles.map(tessellateStackTile))!;
    return pending.finish(
      pending.jobs.map((job, i) =>
        pending.finishCap(i, job && buildStackCapArrays(job)),
      ),
    ).tessellation;
  };

  it('builds the same stack from what an earlier plan derived', () => {
    const first = planSurfaceStack(reference, stackLayers, options);
    expect(first.terminationLines).toHaveLength(2);
    expect(first.coverageCrossings?.some(c => c && c.length > 0)).toBe(true);
    const again = planSurfaceStack(reference, stackLayers, {
      ...options,
      terminationLines: first.terminationLines,
      coverageCrossings: first.coverageCrossings,
    });
    expect(again.terminationLines).toBe(first.terminationLines);
    again.coverageCrossings!.forEach((c, i) =>
      expect(c).toBe(first.coverageCrossings![i]),
    );
    const a = tessellationOf(first);
    const b = tessellationOf(again);
    expect(Array.from(b.coords)).toEqual(Array.from(a.coords));
    expect(Array.from(b.indices)).toEqual(Array.from(a.indices));
  });

  it('keeps it with the column, for the column own arrays only', () => {
    const context = { reference } as unknown as StackContext;
    const { channels, masks } = reference;
    expect(getStackDerived(context, channels, masks, 'k')).toEqual({});
    const plan = planSurfaceStack(reference, stackLayers, options);
    keepStackDerived(context, channels, masks, 'k', plan);

    const kept = getStackDerived(context, channels, masks, 'k');
    expect(kept.terminationLines).toEqual(plan.terminationLines);
    expect(kept.coverageCrossings).toEqual(plan.coverageCrossings);
    // Another threshold or error, or a channel made for this build alone.
    expect(
      getStackDerived(context, channels, masks, 'other').terminationLines,
    ).toBeUndefined();
    const foreign = [...channels];
    foreign[1] = foreign[1].slice();
    expect(
      getStackDerived(context, foreign, masks, 'k').terminationLines,
    ).toBeUndefined();
    const ownMask = [...masks];
    ownMask[2] = masks[2].slice();
    expect(
      getStackDerived(context, channels, ownMask, 'k').coverageCrossings?.[2],
    ).toBeUndefined();
  });
});

describe('coarser levels of detail', () => {
  const polygon = outline(6, 90);
  const cut = outline(50, 96);
  const reference = buildStackReference(layers(), polygon)!;
  const lines = () =>
    [0, 1].map(
      i =>
        traceThicknessLines(
          reference.channels[i],
          reference.channels[i + 1],
          N,
          0.5,
          { channels: reference.channels, maxError: 5 },
        ).rings,
    );
  const build = (cells: number) =>
    tessellateStack(
      reference,
      polygon,
      5,
      undefined,
      [cut],
      true,
      lines(),
      cells,
      { errors: [20, 80] },
    )!;
  const sorted = (values: ArrayLike<number>) =>
    Array.from(values).sort((a, b) => a - b);

  it('nests the refinement exactly: a coarser level is what refining to its error gives', () => {
    const channel = reference.channels[1];
    const { nodes, errors } = collectStackCandidateLevels(channel, N, 5);
    expect(Array.from(nodes)).toEqual(
      Array.from(collectStackCandidates(channel, N, 5)),
    );
    for (const error of [10, 20, 40]) {
      const kept = Array.from(nodes).filter((_, i) => errors[i] > error);
      expect(sorted(kept)).toEqual(
        sorted(collectStackCandidates(channel, N, error)),
      );
    }
  });

  for (const cells of [16, 40]) {
    it(`builds every level crack-free over the same outline (${cells}-cell tiles)`, () => {
      const full = build(cells);
      expect(full.levels).toHaveLength(2);
      const outer = boundary(full, cells);
      let previous = full.indices.length;
      for (const level of full.levels!) {
        expect(level.constraintFailures).toBe(0);
        const view = { ...full, indices: level.indices };
        const b = boundary(view, cells);
        expect(b.overused).toBe(0);
        expect(b.onSeam).toBe(0);
        expect(b.length).toBeCloseTo(outer.length, 6);
        expect(area(view)).toBeCloseTo(area(full), 3);
        expect(level.indices.length).toBeLessThan(previous);
        previous = level.indices.length;
      }
    });
  }

  it('meets a neighbour at any level: the seams are the same edges in every level', () => {
    const cells = 16;
    const full = build(cells);
    const c = full.coords;
    const seam = (x: number) => (x + 0.5) % cells === 0;
    const seamEdges = (indices: Uint32Array) => {
      const edges = new Set<string>();
      for (let i = 0; i < indices.length; i += 3) {
        for (let k = 0; k < 3; k++) {
          const u = indices[i + k];
          const v = indices[i + ((k + 1) % 3)];
          const along =
            (c[2 * u] === c[2 * v] && seam(c[2 * u])) ||
            (c[2 * u + 1] === c[2 * v + 1] && seam(c[2 * u + 1]));
          if (!along) continue;
          const a = `${c[2 * u]},${c[2 * u + 1]}`;
          const b = `${c[2 * v]},${c[2 * v + 1]}`;
          edges.add(a < b ? `${a}|${b}` : `${b}|${a}`);
        }
      }
      return [...edges].sort();
    };
    const fine = seamEdges(full.indices);
    expect(fine.length).toBeGreaterThan(0);
    for (const level of full.levels!) {
      expect(seamEdges(level.indices)).toEqual(fine);
    }
  });

  it('gives every cap its levels, its normals, and a normal map over every vertex they use', () => {
    const stack = buildSurfaceStack(reference, layers(), {
      polygon,
      maxError: 5,
      constrainTerminations: true,
      tileCells: 16,
      lod: { levels: 2, factor: 4 },
    })!;
    const { tessellation } = stack;
    expect(tessellation.levels).toHaveLength(2);
    let capped = 0;
    let outside = 0;
    for (const layer of stack.layers) {
      if (!layer.geometry) continue;
      capped++;
      expect(layer.levels).toHaveLength(2);
      expect(layer.geometry.hasAttribute('normal')).toBe(true);
      const [a, b, c, d, e, f] = layer.normalMap!.toUv;
      const xz = layer.geometry.getAttribute('xz').array;
      const own = layer.geometry.index!.count;
      layer.levels!.forEach(level => {
        expect(level.length).toBeLessThan(own);
        for (const v of level) {
          const u = a * xz[2 * v] + b * xz[2 * v + 1] + c;
          const w = d * xz[2 * v] + e * xz[2 * v + 1] + f;
          if (!(u > 0 && u < 1 && w > 0 && w < 1)) outside++;
        }
      });
    }
    expect(capped).toBeGreaterThan(0);
    expect(outside).toBe(0);
  });

  it('says where each tile starts in every cap, at every level', () => {
    const stack = buildSurfaceStack(reference, layers(), {
      polygon,
      maxError: 5,
      constrainTerminations: true,
      tileCells: 16,
      lod: { levels: 2, factor: 4 },
    })!;
    const { coords, tiling } = stack.tessellation;
    const { cells, first, count } = tiling!;
    // Which tile a point lies in, as the planner cuts them.
    const tileOf = (x: number, y: number) => {
      const clamp = (v: number, k0: number, n: number) =>
        Math.min(Math.max(Math.floor((v + 0.5) / cells), k0), k0 + n - 1) - k0;
      return (
        clamp(y, first[1], count[1]) * count[0] + clamp(x, first[0], count[0])
      );
    };
    let misplaced = 0;
    let checked = 0;
    for (const layer of stack.layers) {
      if (!layer.geometry) continue;
      const lists = [
        layer.geometry.index!.array as Uint32Array,
        ...layer.levels!,
      ];
      expect(layer.tileStarts).toHaveLength(lists.length);
      lists.forEach((list, k) => {
        const starts = layer.tileStarts![k];
        expect(starts).toHaveLength(count[0] * count[1] + 1);
        expect(starts[starts.length - 1]).toBe(list.length / 3);
        for (let t = 0; t + 1 < starts.length; t++) {
          for (let tri = starts[t]; tri < starts[t + 1]; tri++) {
            const [a, b, c] = [0, 1, 2].map(j => list[3 * tri + j]);
            const x = (coords[2 * a] + coords[2 * b] + coords[2 * c]) / 3;
            const y = (coords[2 * a + 1] + coords[2 * b + 1] + coords[2 * c + 1]) / 3;
            checked++;
            if (tileOf(x, y) !== t) misplaced++;
          }
        }
      });
    }
    expect(checked).toBeGreaterThan(0);
    expect(misplaced).toBe(0);
  });

  it('gives a cap its patch at every level, tile by tile', () => {
    const stack = buildSurfaceStack(reference, layers(), {
      polygon,
      maxError: 5,
      constrainTerminations: true,
      collapseThreshold: 0.5,
      peelable: true,
      tileCells: 16,
      lod: { levels: 2, factor: 4 },
    })!;
    const { coords, tiling, levels } = stack.tessellation;
    const { cells, first, count } = tiling!;
    const tileOf = (x: number, y: number) => {
      const clamp = (v: number, k0: number, n: number) =>
        Math.min(Math.max(Math.floor((v + 0.5) / cells), k0), k0 + n - 1) - k0;
      return (
        clamp(y, first[1], count[1]) * count[0] + clamp(x, first[0], count[0])
      );
    };
    const triples = (list: ArrayLike<number>) => {
      const out = new Set<string>();
      for (let i = 0; i < list.length; i += 3) {
        out.add(`${list[i]},${list[i + 1]},${list[i + 2]}`);
      }
      return out;
    };
    let patched = 0;
    let coarse = 0;
    let misplaced = 0;
    let overlapping = 0;
    let foreign = 0;
    for (const layer of stack.layers) {
      if (!layer.geometry || !layer.patchLevels) continue;
      patched++;
      const patches = [layer.patchIndex ?? new Uint32Array(0), ...layer.patchLevels];
      const kept = [layer.geometry.index!.array, ...layer.levels!];
      const shared = [stack.tessellation.indices, ...levels!.map(l => l.indices)];
      expect(layer.patchTileStarts).toHaveLength(patches.length);
      patches.forEach((patch, k) => {
        if (k > 0) coarse += patch.length / 3;
        const starts = layer.patchTileStarts![k];
        expect(starts[starts.length - 1]).toBe(patch.length / 3);
        for (let t = 0; t + 1 < starts.length; t++) {
          for (let tri = starts[t]; tri < starts[t + 1]; tri++) {
            const [a, b, c] = [0, 1, 2].map(j => patch[3 * tri + j]);
            const x = (coords[2 * a] + coords[2 * b] + coords[2 * c]) / 3;
            const y = (coords[2 * a + 1] + coords[2 * b + 1] + coords[2 * c + 1]) / 3;
            if (tileOf(x, y) !== t) misplaced++;
          }
        }
        // What the cap gave up at that level: none of what it keeps, all of the level.
        const keeps = triples(kept[k]);
        const level = triples(shared[k]);
        for (const tri of triples(patch)) {
          if (keeps.has(tri)) overlapping++;
          if (k > 0 && !level.has(tri)) foreign++;
        }
      });
    }
    expect(patched).toBeGreaterThan(0);
    expect(coarse).toBeGreaterThan(0);
    expect(misplaced).toBe(0);
    expect(overlapping).toBe(0);
    expect(foreign).toBe(0);
  });

  it('meets the walls at every level: the full outline, and heights along it', () => {
    // Along grid lines, so refinement nodes lie ON the rim; the wedge's pinch-out
    // line crosses it.
    const rect = new PlanarPolygonGeometry([
      [
        [
          [8 * INC, (8 - (N - 1)) * INC],
          [88 * INC, (8 - (N - 1)) * INC],
          [88 * INC, (88 - (N - 1)) * INC],
          [8 * INC, (88 - (N - 1)) * INC],
        ],
      ],
    ]);
    const stackLayers = layers();
    const stack = buildSurfaceStack(
      buildStackReference(stackLayers, rect)!,
      stackLayers,
      {
        polygon: rect,
        maxError: 5,
        constrainTerminations: true,
        tileCells: 16,
        lod: { levels: 2, factor: 4 },
      },
    )!;
    const { coords: c, indices, levels } = stack.tessellation;
    const outlineEdges = (list: Uint32Array) => {
      const uses = new Map<number, number>();
      const V = c.length / 2;
      for (let i = 0; i < list.length; i += 3) {
        for (let k = 0; k < 3; k++) {
          const u = list[i + k];
          const v = list[i + ((k + 1) % 3)];
          const key = u < v ? u * V + v : v * V + u;
          uses.set(key, (uses.get(key) ?? 0) + 1);
        }
      }
      return [...uses]
        .filter(([, n]) => n === 1)
        .map(([key]) => [Math.floor(key / V), key % V]);
    };
    const fullEdges = outlineEdges(indices);
    const full = new Set(fullEdges.flat());
    const dropped: number[] = [];
    const gaps: string[] = [];
    let added = 0;
    for (const level of levels!) {
      const mine = new Set(outlineEdges(level.indices).flat());
      for (const v of full) if (!mine.has(v)) dropped.push(v);
      for (const v of mine) {
        if (full.has(v)) continue;
        added++;
        // The full outline's edge it lies on, which is where the walls run.
        const on = fullEdges.find(([a, b]) => {
          const dx = c[2 * b] - c[2 * a];
          const dy = c[2 * b + 1] - c[2 * a + 1];
          const px = c[2 * v] - c[2 * a];
          const py = c[2 * v + 1] - c[2 * a + 1];
          const along = (px * dx + py * dy) / (dx * dx + dy * dy);
          return along > 0 && along < 1 && Math.abs(px * dy - py * dx) < 1e-6;
        });
        if (!on) {
          gaps.push(`v${v} is on no edge of the full outline`);
          continue;
        }
        const [a, b] = on;
        const t =
          Math.hypot(c[2 * v] - c[2 * a], c[2 * v + 1] - c[2 * a + 1]) /
          Math.hypot(c[2 * b] - c[2 * a], c[2 * b + 1] - c[2 * a + 1]);
        stack.heights.forEach((h, layer) => {
          const gap = Math.abs(h[v] - (h[a] + t * (h[b] - h[a])));
          if (gap > 1e-3) gaps.push(`v${v} layer ${layer}: ${gap.toFixed(2)} m`);
        });
      }
    }
    expect(added).toBeGreaterThan(0);
    expect(dropped).toEqual([]);
    expect(gaps).toEqual([]);
  });
});

describe('thinChain', () => {
  const points = (xy: number[]) => Float64Array.from(xy);

  it('keeps only the ends of a straight, level line', () => {
    const line = points([0, 0, 1, 0, 2, 0, 3, 0]);
    expect(Array.from(thinChain(line, new Float32Array(8), 2, 1, 0.5))).toEqual(
      [1, 0, 0, 1],
    );
  });

  it('keeps a bend beyond the plan tolerance', () => {
    const line = points([0, 0, 1, 0, 2, 2, 3, 0, 4, 0]);
    expect(Array.from(thinChain(line, new Float32Array(5), 1, 1, 1))).toEqual([
      1, 0, 1, 0, 1,
    ]);
  });

  it('keeps a point any one layer needs in height', () => {
    const line = points([0, 0, 1, 0, 2, 0]);
    // two layers; the second rises 5 at the middle point
    const heights = Float32Array.from([0, 0, 0, 5, 0, 0]);
    expect(Array.from(thinChain(line, heights, 2, 1, 0.5))).toEqual([1, 1, 1]);
    expect(Array.from(thinChain(line, heights, 2, 10, 0.5))).toEqual([1, 0, 1]);
  });
});

describe('refineStackSeam', () => {
  const channel = (f: (c: number, r: number) => number) => {
    const out = new Float32Array(N * N);
    for (let r = 0; r < N; r++)
      for (let c = 0; c < N; c++) out[r * N + c] = f(c, r);
    return out;
  };

  it('keeps only the ends of a straight profile', () => {
    const plane = channel((c, r) => 2 * c + 3 * r);
    expect(refineStackSeam([plane], N, 'x', 15.5, 0, N - 1, 0.1)).toEqual([
      0,
      N - 1,
    ]);
  });

  it('keeps the kink every layer needs, unioned over layers', () => {
    const a = channel((_, r) => (r < 30 ? 0 : 10 * (r - 30)));
    const b = channel((_, r) => (r < 60 ? 0 : 10 * (r - 60)));
    expect(refineStackSeam([a, b], N, 'x', 15.5, 0, N - 1, 0.5)).toEqual([
      0,
      30,
      60,
      N - 1,
    ]);
  });

  it('reads a horizontal seam as the mean of the rows either side', () => {
    const step = channel((c, r) => (r <= 15 && c > 40 ? 20 : 0));
    // Rows 15 and 16 average to a 10 m step at column 41.
    expect(refineStackSeam([step], N, 'y', 15.5, 0, N - 1, 4)).toEqual([
      0,
      40,
      41,
      N - 1,
    ]);
    expect(refineStackSeam([step], N, 'y', 15.5, 0, N - 1, 11)).toEqual([
      0,
      N - 1,
    ]);
  });
});
