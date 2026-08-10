import { describe, expect, it } from 'vitest';
import { PlanarPolygonGeometry } from '../src/sdk/geometries/planar-geometry';
import { SurfaceClipHeader } from '../src/sdk/geometries/surface-clip';
import {
  buildStackReference,
  collapseOptionalChannels,
  collapseStackTriangles,
  resolveStackGrid,
  resolveStackOrder,
  sampleStackHeights,
  sampleStackMasks,
  stackDepthStats,
  stackDuplicateFractions,
  StackLayer,
  stackLayerUvs,
  stackVertexPositions,
  tessellateStack,
  trimPolygonToCoverage,
} from '../src/sdk/geometries/surface-stack';
import { collectStackCandidates } from '../src/sdk/geometries/surface-stack-candidates';

const NX = 33;
const NY = 33;
const INC = 100;

const header = (
  nx = NX,
  ny = NY,
  xinc = INC,
  yinc = INC,
  rot = 0,
): SurfaceClipHeader => ({ nx, ny, xinc, yinc, rot });

/**
 * A layer built from a true depth function (positive-down). Samples encode
 * `value = referenceDepth - trueDepth`, so scene `y = value - referenceDepth`
 * equals `-trueDepth`.
 */
const layerFrom = (
  depth: (col: number, row: number) => number | null,
  referenceDepth = 2000,
  h: SurfaceClipHeader = header(),
): StackLayer => {
  const values = new Float32Array(h.nx * h.ny);
  for (let row = 0; row < h.ny; row++) {
    for (let col = 0; col < h.nx; col++) {
      const d = depth(col, row);
      values[row * h.nx + col] = d === null ? -1 : referenceDepth - d;
    }
  }
  return { values, header: h, referenceDepth, worldPosition: [0, 0] };
};

// Scene XZ of a grid node for an unrotated grid placed at the origin.
const sceneX = (col: number, h: SurfaceClipHeader = header()) => col * h.xinc;
const sceneZ = (row: number, h: SurfaceClipHeader = header()) =>
  (row - (h.ny - 1)) * h.yinc;

/** Axis-aligned mask covering grid columns/rows `[lo, hi]`. */
const maskPolygon = (lo: number, hi: number) =>
  new PlanarPolygonGeometry([
    [
      [
        [sceneX(lo), sceneZ(lo)],
        [sceneX(hi), sceneZ(lo)],
        [sceneX(hi), sceneZ(hi)],
        [sceneX(lo), sceneZ(hi)],
      ],
    ],
  ]);

describe('buildStackReference', () => {
  it('resamples every layer onto the finest grid, in scene Y', () => {
    const fine = layerFrom(() => 1000, 2000, header());
    // half the resolution, same footprint
    const coarse = layerFrom(
      () => 1500,
      2000,
      header(17, 17, INC * 2, INC * 2),
    );

    const reference = buildStackReference([coarse, fine], maskPolygon(4, 28));
    expect(reference).not.toBeNull();
    // the FINEST layer defines the common domain, whichever order it comes in
    expect(reference!.header.xinc).toBe(INC);

    const [coarseChannel, fineChannel] = reference!.channels;
    // scene Y = -trueDepth for both, regardless of their own grids
    expect(coarseChannel[0]).toBeCloseTo(-1500, 3);
    expect(fineChannel[0]).toBeCloseTo(-1000, 3);
  });

  it('fills holes from the nearest valid sample and flags them in the mask', () => {
    const holed = layerFrom((col, row) =>
      col >= 10 && col <= 12 && row >= 10 && row <= 12 ? null : 1000,
    );

    const reference = buildStackReference([holed], maskPolygon(4, 28))!;
    const { nx } = reference.header;
    const channel = reference.channels[0];
    const mask = reference.masks[0];

    // the hole is filled with a real (continuous) value, not a sentinel
    const holeNode = channel.findIndex((_, i) => mask[i] === 0);
    expect(holeNode).toBeGreaterThanOrEqual(0);
    expect(channel[holeNode]).toBeCloseTo(-1000, 3);
    // ...and a node with data is flagged as such
    expect(mask[0]).toBe(1);
    expect(channel[nx + 1]).toBeCloseTo(-1000, 3);
  });

  it('returns null when the mask misses the grid', () => {
    const flat = layerFrom(() => 1000);
    const away = new PlanarPolygonGeometry([
      [
        [
          [1e6, 1e6],
          [1e6 + 100, 1e6],
          [1e6 + 100, 1e6 + 100],
        ],
      ],
    ]);
    expect(buildStackReference([flat], away)).toBeNull();
  });
});

describe('trimPolygonToCoverage', () => {
  // The right half of the grid is unmapped.
  const halfMapped = () => layerFrom((col: number) => (col > 16 ? null : 1000));
  const fullyMapped = () => layerFrom(() => 1200);

  it('hands back the SAME polygon when the outline is fully covered', () => {
    const polygon = maskPolygon(4, 12);
    const reference = buildStackReference([fullyMapped()], polygon)!;

    const trim = trimPolygonToCoverage(reference, polygon, reference.masks);

    expect(trim.trimmed).toBe(false);
    expect(trim.coverage).toBe(1);
    // identity, not just an equal shape — an untouched chunk must be untouched
    expect(trim.polygon).toBe(polygon);
  });

  it('cuts the outline back to the mapped area', () => {
    const polygon = maskPolygon(4, 28);
    const reference = buildStackReference([halfMapped()], polygon)!;

    const trim = trimPolygonToCoverage(reference, polygon, reference.masks);

    expect(trim.trimmed).toBe(true);
    expect(trim.coverage).toBeGreaterThan(0.3);
    expect(trim.coverage).toBeLessThan(0.7);
    // the survivors all sit on the mapped (left) side
    const xs = (trim.polygon!.coordinates as number[][][][])
      .flat(2)
      .map(([x]) => x);
    expect(Math.max(...xs)).toBeLessThan(sceneX(20));
  });

  it('returns no polygon at all when nothing is mapped', () => {
    const polygon = maskPolygon(20, 28);
    const reference = buildStackReference([halfMapped()], polygon)!;

    const trim = trimPolygonToCoverage(reference, polygon, reference.masks);

    expect(trim.polygon).toBeNull();
    expect(trim.coverage).toBe(0);
  });

  it("'any' keeps what one layer covers, 'all' does not", () => {
    const polygon = maskPolygon(4, 28);
    const reference = buildStackReference(
      [halfMapped(), fullyMapped()],
      polygon,
    )!;

    const all = trimPolygonToCoverage(reference, polygon, reference.masks, {
      rule: 'all',
    });
    const any = trimPolygonToCoverage(reference, polygon, reference.masks, {
      rule: 'any',
    });

    expect(all.trimmed).toBe(true);
    expect(any.trimmed).toBe(false);
    expect(any.coverage).toBeGreaterThan(all.coverage);
  });

  it('an OPTIONAL layer does not cut the outline, but is still reported', () => {
    const polygon = maskPolygon(4, 28);
    // The fully mapped layer is the chunk's own subject; the half mapped one is a
    // boundary borrowed from the chunk below.
    const reference = buildStackReference(
      [fullyMapped(), halfMapped()],
      polygon,
    )!;

    const required = trimPolygonToCoverage(
      reference,
      polygon,
      reference.masks,
      {},
    );
    const optional = trimPolygonToCoverage(
      reference,
      polygon,
      reference.masks,
      {
        optional: [false, true],
      },
    );

    // Borrowed, it no longer drags the footprint down to someone else's survey.
    expect(required.trimmed).toBe(true);
    expect(optional.trimmed).toBe(false);
    expect(optional.polygon).toBe(polygon);
    // ...but the trade stays visible: both report the same per-layer coverage.
    expect(optional.layerCoverage[0]).toBe(1);
    expect(optional.layerCoverage[1]).toBeLessThan(0.7);
    expect(optional.layerCoverage).toEqual(required.layerCoverage);
  });

  it('keeps the whole outline when EVERY layer is optional', () => {
    const polygon = maskPolygon(4, 28);
    const reference = buildStackReference([halfMapped()], polygon)!;

    for (const rule of ['all', 'any'] as const) {
      const trim = trimPolygonToCoverage(reference, polygon, reference.masks, {
        rule,
        optional: [true],
      });
      expect(trim.trimmed).toBe(false);
      expect(trim.polygon).toBe(polygon);
    }
  });
});

describe('collapseOptionalChannels', () => {
  const halfMapped = () => layerFrom((col: number) => (col > 16 ? null : 1000));

  it('pinches the optional interval out where the layer has no data', () => {
    const polygon = maskPolygon(4, 28);
    const reference = buildStackReference(
      [layerFrom(() => 800), halfMapped()],
      polygon,
    )!;
    const [above, borrowed] = reference.channels;
    // buildStackReference fills the unmapped half from the nearest sample, so
    // without this the interval would stand on a flat extrapolation.
    const filled = borrowed.findIndex((_, n) => reference.masks[1][n] === 0);
    expect(filled).toBeGreaterThanOrEqual(0);
    expect(borrowed[filled]).not.toBe(above[filled]);

    const collapsed = collapseOptionalChannels(
      reference.channels,
      reference.masks,
      [false, true],
    );

    // zero thickness where it is absent, untouched where it is mapped
    expect(collapsed[1][filled]).toBe(above[filled]);
    const mapped = reference.masks[1].findIndex(v => v === 1);
    expect(collapsed[1][mapped]).toBe(borrowed[mapped]);
    // the layers it did not touch are shared, not copied
    expect(collapsed[0]).toBe(reference.channels[0]);
    expect(collapsed[1]).not.toBe(reference.channels[1]);
  });

  it('is a no-op when nothing is optional', () => {
    const polygon = maskPolygon(4, 28);
    const reference = buildStackReference([halfMapped()], polygon)!;

    expect(
      collapseOptionalChannels(reference.channels, reference.masks, [false]),
    ).toBe(reference.channels);
  });
});

describe('tessellateStack', () => {
  it('gives every layer the same topology and honours the mask', () => {
    const top = layerFrom(() => 1000);
    const base = layerFrom((col: number) => 1200 - 10 * col);

    const polygon = maskPolygon(4, 28);
    const reference = buildStackReference([top, base], polygon)!;
    const tess = tessellateStack(reference, polygon, 5)!;

    expect(tess).not.toBeNull();
    expect(tess.indices.length).toBeGreaterThan(0);
    expect(tess.rimVertices.length).toBe(1);
    expect(tess.rimVertices[0].length).toBeGreaterThanOrEqual(3);

    const heights = sampleStackHeights(reference, tess.coords);
    expect(heights).toHaveLength(2);
    // one Y per shared vertex, for every layer
    const vertices = tess.coords.length / 2;
    expect(heights[0].length).toBe(vertices);
    expect(heights[1].length).toBe(vertices);

    // every triangle stays inside the mask
    const positions = stackVertexPositions(reference, tess.coords);
    for (let i = 0; i < tess.indices.length; i++) {
      const v = tess.indices[i];
      expect(positions[2 * v]).toBeGreaterThanOrEqual(sceneX(4) - 1e-6);
      expect(positions[2 * v]).toBeLessThanOrEqual(sceneX(28) + 1e-6);
    }
  });

  it('accepts precomputed per-layer candidates', () => {
    const bumpy = layerFrom(
      (col, row) => 1000 + 60 * Math.sin(col / 3) * Math.cos(row / 4),
    );
    const polygon = maskPolygon(4, 28);
    const reference = buildStackReference([bumpy], polygon)!;

    const candidates = [
      collectStackCandidates(reference.channels[0], reference.header.nx, 5),
    ];
    const a = tessellateStack(reference, polygon, 5)!;
    const b = tessellateStack(reference, polygon, 5, candidates)!;

    expect(candidates[0].length).toBeGreaterThan(4);
    expect(b.indices.length).toBe(a.indices.length);
  });
});

describe('resolveStackOrder', () => {
  // A tilted base that starts below the flat top and rises through it.
  const top = () => layerFrom(() => 1000);
  const base = () => layerFrom((col: number) => 1200 - 10 * col);

  it('reports the crossings it finds', () => {
    const polygon = maskPolygon(4, 28);
    const reference = buildStackReference([top(), base()], polygon)!;
    const tess = tessellateStack(reference, polygon, 5)!;
    const heights = sampleStackHeights(reference, tess.coords);

    const result = resolveStackOrder(heights);

    expect(result.pairs).toHaveLength(1);
    expect(result.pairs[0].crossings).toBeGreaterThan(0);
    expect(result.pairs[0].maxOverlap).toBeGreaterThan(50);
  });

  it('leaves NO interpenetration anywhere on the shared tessellation', () => {
    const polygon = maskPolygon(4, 28);
    const reference = buildStackReference([top(), base()], polygon)!;
    const tess = tessellateStack(reference, polygon, 5)!;
    const heights = sampleStackHeights(reference, tess.coords);

    // before: the surfaces genuinely cross
    let crossingBefore = 0;
    for (let v = 0; v < heights[0].length; v++) {
      if (heights[1][v] > heights[0][v]) crossingBefore++;
    }
    expect(crossingBefore).toBeGreaterThan(0);

    resolveStackOrder(heights);

    // after: monotone at every vertex...
    for (let v = 0; v < heights[0].length; v++) {
      expect(heights[1][v]).toBeLessThanOrEqual(heights[0][v] + 1e-6);
    }

    // ...and therefore monotone INSIDE every triangle too — the guarantee the
    // shared tessellation exists for. Sample barycentric points per triangle.
    const bary: [number, number, number][] = [
      [1 / 3, 1 / 3, 1 / 3],
      [0.6, 0.2, 0.2],
      [0.2, 0.6, 0.2],
      [0.2, 0.2, 0.6],
      [0.5, 0.5, 0],
    ];
    let worst = 0;
    for (let i = 0; i < tess.indices.length; i += 3) {
      const a = tess.indices[i];
      const b = tess.indices[i + 1];
      const c = tess.indices[i + 2];
      for (const [wa, wb, wc] of bary) {
        const yTop =
          wa * heights[0][a] + wb * heights[0][b] + wc * heights[0][c];
        const yBase =
          wa * heights[1][a] + wb * heights[1][b] + wc * heights[1][c];
        worst = Math.max(worst, yBase - yTop);
      }
    }
    expect(worst).toBeLessThanOrEqual(1e-6);
  });

  it('keeps a minimum separation when asked', () => {
    const polygon = maskPolygon(4, 28);
    const reference = buildStackReference([top(), base()], polygon)!;
    const tess = tessellateStack(reference, polygon, 5)!;
    const heights = sampleStackHeights(reference, tess.coords);

    resolveStackOrder(heights, { minGap: 25 });

    for (let v = 0; v < heights[0].length; v++) {
      expect(heights[0][v] - heights[1][v]).toBeGreaterThanOrEqual(25 - 1e-6);
    }
  });

  it('reports whether it applied', () => {
    const polygon = maskPolygon(4, 28);
    const reference = buildStackReference([top(), base()], polygon)!;
    const tess = tessellateStack(reference, polygon, 5)!;
    const heights = sampleStackHeights(reference, tess.coords);
    const before = Float32Array.from(heights[1]);

    const measured = resolveStackOrder(heights, { apply: false });

    expect(measured.applied).toBe(false);
    expect(measured.moved).toBeGreaterThan(0);
    expect(Array.from(heights[1])).toEqual(Array.from(before));
    expect(resolveStackOrder(heights).applied).toBe(true);
  });

  it('marks truncated vertices absent, and only in truncate mode', () => {
    const polygon = maskPolygon(4, 28);
    const reference = buildStackReference([top(), base()], polygon)!;
    const tess = tessellateStack(reference, polygon, 5)!;

    const truncated = resolveStackOrder(
      sampleStackHeights(reference, tess.coords),
      { mode: 'truncate' },
    );
    const clamped = resolveStackOrder(
      sampleStackHeights(reference, tess.coords),
      { mode: 'clamp' },
    );

    const cut = truncated.absent[1].reduce((a, v) => a + v, 0);
    expect(cut).toBe(truncated.pairs[0].moved);
    // the shallowest layer is never truncated
    expect(truncated.absent[0].reduce((a, v) => a + v, 0)).toBe(0);
    expect(clamped.absent[1].reduce((a, v) => a + v, 0)).toBe(0);
  });

  it('separates crossings in real data from crossings against the fill', () => {
    // The top deepens over the right half; the lower layer is only MAPPED over
    // the left half, so its nearest-value fill sits above the top out there —
    // a crossing that says nothing about the geology.
    const dippingTop = layerFrom((col: number) => (col <= 16 ? 1000 : 1400));
    const partialBase = layerFrom((col: number) => (col <= 16 ? 1200 : null));

    const polygon = maskPolygon(4, 28);
    const reference = buildStackReference([dippingTop, partialBase], polygon)!;
    const tess = tessellateStack(reference, polygon, 5)!;
    const heights = sampleStackHeights(reference, tess.coords);
    const masks = sampleStackMasks(reference, tess.coords);

    const resolved = resolveStackOrder(heights, {
      apply: false,
      coverage: masks,
    });

    const pair = resolved.pairs[0];
    expect(pair.crossings).toBeGreaterThan(0);
    // ...but none of them are where both layers actually have data
    expect(pair.crossingsCovered).toBe(0);
    expect(pair.maxOverlapCovered).toBe(0);
    expect(pair.compared).toBeLessThan(heights[0].length);
  });
});

describe('resolveStackGrid', () => {
  // Three channels over the same 4 nodes; the middle one pokes above the top at
  // nodes 1 and 2, the bottom one is fine.
  const channels = () => [
    Float32Array.from([-1000, -1000, -1000, -1000]),
    Float32Array.from([-1200, -900, -1000, -1100]),
    Float32Array.from([-1400, -1400, -1400, -1400]),
  ];

  it('makes the whole column monotone on the grid', () => {
    const c = channels();
    const result = resolveStackGrid(c);

    for (let i = 1; i < c.length; i++) {
      for (let n = 0; n < c[i].length; n++) {
        expect(c[i][n]).toBeLessThanOrEqual(c[i - 1][n] + 1e-6);
      }
    }
    // node 1 rose 100 above the ceiling; node 2 is exactly coincident, which is
    // zero thickness rather than a violation — that is the collapse's business,
    // not the resolve's, so it is neither moved nor marked absent.
    expect(result.pairs[0].crossings).toBe(1);
    expect(result.pairs[0].maxOverlap).toBeCloseTo(100, 5);
    expect(result.moved).toBe(1);
  });

  it('marks truncated nodes absent in truncate mode only', () => {
    const truncated = resolveStackGrid(channels(), { mode: 'truncate' });
    const clamped = resolveStackGrid(channels(), { mode: 'clamp' });

    expect(Array.from(truncated.absent[1])).toEqual([0, 1, 0, 0]);
    // the shallowest channel is never truncated
    expect(Array.from(truncated.absent[0])).toEqual([0, 0, 0, 0]);
    expect(Array.from(clamped.absent[1])).toEqual([0, 0, 0, 0]);
  });

  it('keeps a minimum separation, and can measure without applying', () => {
    const gapped = channels();
    resolveStackGrid(gapped, { minGap: 50 });
    for (let n = 0; n < gapped[1].length; n++) {
      expect(gapped[0][n] - gapped[1][n]).toBeGreaterThanOrEqual(50 - 1e-6);
    }

    const measured = channels();
    const before = measured.map(c => Array.from(c));
    const result = resolveStackGrid(measured, { apply: false });
    expect(result.pairs[0].crossings).toBe(1);
    measured.forEach((c, i) => expect(Array.from(c)).toEqual(before[i]));
  });
});

describe('sampleStackMasks', () => {
  it('reports where a layer has data of its own', () => {
    const covered = layerFrom(() => 1000);
    // only the left half is mapped
    const partial = layerFrom((col: number) => (col <= 16 ? 1200 : null));

    const polygon = maskPolygon(4, 28);
    const reference = buildStackReference([covered, partial], polygon)!;
    const tess = tessellateStack(reference, polygon, 5)!;

    const masks = sampleStackMasks(reference, tess.coords);
    const positions = stackVertexPositions(reference, tess.coords);

    expect(masks[0].every(v => v === 1)).toBe(true);
    let inside = 0;
    let outside = 0;
    for (let v = 0; v < masks[1].length; v++) {
      // the mapped half ends at column 16
      if (positions[2 * v] < sceneX(15)) inside += masks[1][v];
      if (positions[2 * v] > sceneX(18)) outside += masks[1][v];
    }
    expect(inside).toBeGreaterThan(0);
    expect(outside).toBe(0);
  });
});

describe('stackDuplicateFractions', () => {
  it('flags a horizon that is the same as the one above it', () => {
    const polygon = maskPolygon(4, 28);
    const reference = buildStackReference(
      [layerFrom(() => 1000), layerFrom(() => 1000), layerFrom(() => 1400)],
      polygon,
    )!;
    const tess = tessellateStack(reference, polygon, 5)!;
    const heights = sampleStackHeights(reference, tess.coords);
    const masks = sampleStackMasks(reference, tess.coords);

    const duplicates = stackDuplicateFractions(heights, masks, 0.5);

    expect(duplicates[0]).toBe(0);
    expect(duplicates[1]).toBeCloseTo(1, 5);
    expect(duplicates[2]).toBeCloseTo(0, 5);
  });
});

describe('stackDepthStats', () => {
  it('measures each layer inside the footprint, ordering-key independent', () => {
    const polygon = maskPolygon(4, 28);
    // Deliberately given in the WRONG order: the flat 1500 m surface is deeper
    // than the flat 1000 m one, but arrives first.
    const reference = buildStackReference(
      [layerFrom(() => 1500), layerFrom(() => 1000)],
      polygon,
    )!;
    const tess = tessellateStack(reference, polygon, 5)!;
    const heights = sampleStackHeights(reference, tess.coords);

    const stats = stackDepthStats(heights);

    expect(stats[0].medianY).toBeCloseTo(-1500, 3);
    expect(stats[1].medianY).toBeCloseTo(-1000, 3);
    // sorting by descending medianY = shallowest first = the corrected order
    const order = stats
      .map(s => s.index)
      .sort((a, b) => stats[b].medianY - stats[a].medianY);
    expect(order).toEqual([1, 0]);
  });
});

describe('collapseStackTriangles', () => {
  const polygon = maskPolygon(4, 28);

  // A tilted, rippled base: the ripples force the shared TIN to carry interior
  // vertices (two planes would collapse to a couple of triangles), and the tilt
  // takes it up through the flat top so the clamp welds it over a large area.
  const rippledBase = () =>
    layerFrom(
      (col, row) =>
        1200 - 10 * col + 25 * Math.sin(col / 2) * Math.cos(row / 3),
    );

  it('drops triangles where a layer has welded onto the one above', () => {
    const reference = buildStackReference(
      [layerFrom(() => 1000), rippledBase()],
      polygon,
    )!;
    const tess = tessellateStack(reference, polygon, 5)!;
    const heights = sampleStackHeights(reference, tess.coords);
    resolveStackOrder(heights);

    const { indices, dropped } = collapseStackTriangles(heights, tess.indices, {
      threshold: 0.5,
    });

    // the shallowest layer has nothing above it, so it always keeps everything
    expect(indices[0]).toBeNull();
    expect(dropped[0]).toBe(0);

    expect(dropped[1]).toBeGreaterThan(0);
    expect(indices[1]).not.toBeNull();
    expect(indices[1]!.length).toBe(tess.indices.length - dropped[1] * 3);

    // every surviving triangle is one of the shared triangles
    const shared = new Set<string>();
    for (let i = 0; i < tess.indices.length; i += 3) {
      shared.add(
        `${tess.indices[i]}/${tess.indices[i + 1]}/${tess.indices[i + 2]}`,
      );
    }
    for (let i = 0; i < indices[1]!.length; i += 3) {
      expect(
        shared.has(
          `${indices[1]![i]}/${indices[1]![i + 1]}/${indices[1]![i + 2]}`,
        ),
      ).toBe(true);
    }
  });

  it('keeps layers that have real thickness everywhere', () => {
    const reference = buildStackReference(
      [layerFrom(() => 1000), layerFrom(() => 1200)],
      polygon,
    )!;
    const tess = tessellateStack(reference, polygon, 5)!;
    const heights = sampleStackHeights(reference, tess.coords);
    resolveStackOrder(heights);

    const { indices, dropped } = collapseStackTriangles(heights, tess.indices);

    expect(dropped).toEqual([0, 0]);
    expect(indices).toEqual([null, null]);
  });

  it('drops triangles a layer has no data for, and says so separately', () => {
    // The TOP carries the relief, so the shared TIN is dense across the whole
    // footprint; the second layer is only mapped over the left half.
    const rippledTop = layerFrom(
      (col, row) => 1000 + 25 * Math.sin(col / 2) * Math.cos(row / 3),
    );
    const partial = layerFrom((col: number) => (col <= 16 ? 1200 : null));
    const reference = buildStackReference([rippledTop, partial], polygon)!;
    const tess = tessellateStack(reference, polygon, 5)!;
    const heights = sampleStackHeights(reference, tess.coords);
    const masks = sampleStackMasks(reference, tess.coords);
    resolveStackOrder(heights);

    const result = collapseStackTriangles(heights, tess.indices, {
      coverage: masks,
    });

    // the unmapped half is dropped as ABSENT, not as collapsed
    expect(result.droppedAbsent[1]).toBeGreaterThan(0);
    expect(result.droppedCollapsed[1]).toBe(0);
    expect(result.dropped[1]).toBe(result.droppedAbsent[1]);
    // the fully-covered layer keeps everything
    expect(result.dropped[0]).toBe(0);
    expect(result.indices[0]).toBeNull();
  });

  it('drops triangles marked absent by a truncating resolve', () => {
    const reference = buildStackReference(
      [layerFrom(() => 1000), rippledBase()],
      polygon,
    )!;
    const tess = tessellateStack(reference, polygon, 5)!;
    const heights = sampleStackHeights(reference, tess.coords);
    const resolved = resolveStackOrder(heights, { mode: 'truncate' });

    // absence alone (threshold 0) must already drop the truncated area
    const result = collapseStackTriangles(heights, tess.indices, {
      threshold: 0,
      absent: resolved.absent,
    });

    expect(result.droppedAbsent[1]).toBeGreaterThan(0);
  });

  it('does not modify any height', () => {
    const reference = buildStackReference(
      [layerFrom(() => 1000), rippledBase()],
      polygon,
    )!;
    const tess = tessellateStack(reference, polygon, 5)!;
    const heights = sampleStackHeights(reference, tess.coords);
    resolveStackOrder(heights);
    const snapshot = heights.map(y => Float32Array.from(y));

    collapseStackTriangles(heights, tess.indices, { threshold: 0.5 });

    heights.forEach((y, i) => {
      expect(Array.from(y)).toEqual(Array.from(snapshot[i]));
    });
  });
});

describe('stackLayerUvs', () => {
  it('maps shared vertices into each layer’s own grid space', () => {
    const flat = layerFrom(() => 1000);
    const polygon = maskPolygon(4, 28);
    const reference = buildStackReference([flat], polygon)!;
    const tess = tessellateStack(reference, polygon, 5)!;

    const uvs = stackLayerUvs(reference, tess.coords, flat);
    const positions = stackVertexPositions(reference, tess.coords);

    for (let v = 0; v < tess.coords.length / 2; v++) {
      // unrotated grid at the origin: u = x / ((nx - 1) * xinc)
      const expectedU = positions[2 * v] / ((NX - 1) * INC);
      expect(uvs[2 * v]).toBeCloseTo(expectedU, 5);
      expect(uvs[2 * v]).toBeGreaterThanOrEqual(-1e-6);
      expect(uvs[2 * v]).toBeLessThanOrEqual(1 + 1e-6);
    }
  });
});
