import { describe, expect, it } from 'vitest';
import { PlanarPolygonGeometry } from '../src/sdk/geometries/planar-geometry';
import { SurfaceClipHeader } from '../src/sdk/geometries/surface-clip';
import {
  buildStackReference,
  clampStackToCarrier,
  collapseStackTriangles,
  layEmptyStackLayers,
  measureStackCoverage,
  planStackReference,
  resampleStackLayer,
  resolveStackGrid,
  resolveStackOrder,
  sampleStackHeights,
  sampleStackMasks,
  STACK_MASK_FILLED,
  stackCarrierLevel,
  stackDepthStats,
  stackDuplicateFractions,
  StackGridLayer,
  stackIntervalTriangles,
  stackLayerUvs,
  stackVertexPositions,
  tessellateStack,
} from '../src/sdk/geometries/surface-stack';
import {
  collectCoverageCrossings,
  collectStackCandidates,
} from '../src/sdk/geometries/surface-stack-candidates';
import { buildSurfaceStack } from '../src/sdk/geometries/surface-stack-geometry';
import {
  packBufferGeometry,
  unpackBufferGeometry,
} from '../src/sdk/geometries/packing';

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
): StackGridLayer => {
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

  it('⚠️ lays a layer with NO data anywhere onto its neighbour, not at -1e30', () => {
    // A horizon eroded away across the whole area has nothing to fill from. Left
    // alone its channel keeps the NO_DATA sentinel and draws as a surface
    // reaching to infinity — an endless pillar in the viewport.
    const above = layerFrom(() => 1000);
    const gone = layerFrom(() => null);
    const below = layerFrom(() => 1500);

    const reference = buildStackReference(
      [above, gone, below],
      maskPolygon(4, 28),
    )!;

    const [, empty] = reference.channels;
    for (let i = 0; i < empty.length; i++) {
      expect(empty[i]).toBeCloseTo(-1000, 3);
    }
    // ...and it is still reported as having no data of its own
    expect([...reference.masks[1]].every(v => v === 0)).toBe(true);
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

  // The generator plans the grid from the spec's HEADERS and resamples each layer
  // as its own grid lands (on a worker), so the two halves have to add up to
  // exactly what the one-shot function produces.
  it('is the plan plus one resample per layer, exactly', () => {
    const top = layerFrom((col, row) => 1000 + 3 * col - 2 * row);
    const base = layerFrom((col: number) => (col > 20 ? null : 1400));
    const polygon = maskPolygon(4, 28);

    const oneShot = buildStackReference([top, base], polygon, {
      maxFill: 100,
    })!;
    const plan = planStackReference([top, base], polygon, { maxFill: 100 })!;
    const parts = [top, base].map(l =>
      resampleStackLayer(plan, l, l.referenceDepth, l.nullValue ?? -1),
    );
    layEmptyStackLayers(
      parts.map(p => p.channel),
      parts.map(p => p.empty),
    );

    expect(plan.header).toEqual(oneShot.header);
    expect(plan.worldPosition).toEqual(oneShot.worldPosition);
    expect(plan.step).toBe(oneShot.step);
    parts.forEach((part, i) => {
      expect([...part.channel]).toEqual([...oneShot.channels[i]]);
      expect([...part.mask]).toEqual([...oneShot.masks[i]]);
    });
  });
});

describe('measureStackCoverage', () => {
  // The right half of the grid is unmapped.
  const halfMapped = () => layerFrom((col: number) => (col > 16 ? null : 1000));
  const fullyMapped = () => layerFrom(() => 1200);

  it('reports 1 for a layer mapped over the whole outline', () => {
    const polygon = maskPolygon(4, 12);
    const reference = buildStackReference([fullyMapped()], polygon)!;

    const measured = measureStackCoverage(reference, polygon, reference.masks);

    expect(measured.layerCoverage[0]).toBe(1);
    expect(measured.layerFilled[0]).toBe(0);
  });

  it('reports each layer separately, so the sparse one can be named', () => {
    const polygon = maskPolygon(4, 28);
    const reference = buildStackReference(
      [fullyMapped(), halfMapped()],
      polygon,
    )!;

    const measured = measureStackCoverage(reference, polygon, reference.masks);

    // ⭐ A chunk-level average would hide WHICH layer is standing on nothing,
    // which is the only useful question here.
    expect(measured.layerCoverage[0]).toBe(1);
    expect(measured.layerCoverage[1]).toBeGreaterThan(0.3);
    expect(measured.layerCoverage[1]).toBeLessThan(0.7);
  });

  it('reports 0 for a layer with no data anywhere in the outline', () => {
    // The outline sits entirely on the unmapped side.
    const polygon = maskPolygon(20, 28);
    const reference = buildStackReference([halfMapped()], polygon)!;

    const measured = measureStackCoverage(reference, polygon, reference.masks);

    expect(measured.layerCoverage[0]).toBe(0);
  });

  it('measures over the OUTLINE, not the reference grid', () => {
    // The grid spans both halves; the outline only the mapped one.
    const wide = maskPolygon(4, 28);
    const reference = buildStackReference([halfMapped()], wide)!;

    const whole = measureStackCoverage(reference, wide, reference.masks);
    const left = measureStackCoverage(
      reference,
      maskPolygon(4, 12),
      reference.masks,
    );

    expect(left.layerCoverage[0]).toBe(1);
    expect(whole.layerCoverage[0]).toBeLessThan(1);
  });

  it('⭐ credits data just outside the crop, through bounded fill', () => {
    // The outline sits entirely on the unmapped side, but its near edge is one
    // cell (100 m) from the data — so `maxFill` reaches in and the layer is NOT
    // without local evidence. This is the line between sealing and voiding.
    const outline = maskPolygon(17, 24);
    const layer = () => layerFrom((col: number) => (col > 16 ? null : 1000));

    const strict = buildStackReference([layer()], outline, { maxFill: 0 })!;
    const bridged = buildStackReference([layer()], outline, { maxFill: 250 })!;

    expect(
      measureStackCoverage(strict, outline, strict.masks).layerCoverage[0],
    ).toBe(0);
    expect(
      measureStackCoverage(bridged, outline, bridged.masks).layerCoverage[0],
    ).toBeGreaterThan(0);
  });
});

describe('bounded fill', () => {
  const polygon = maskPolygon(4, 28);

  const count = (mask: Uint8Array, value: number) =>
    mask.reduce((a, v) => a + (v === value ? 1 : 0), 0);

  /** A layer with one rectangular hole, in grid columns/rows. */
  const holed = (
    c0: number,
    c1: number,
    r0: number,
    r1: number,
    h: SurfaceClipHeader = header(),
  ) =>
    layerFrom(
      (col, row) =>
        col >= c0 && col <= c1 && row >= r0 && row <= r1 ? null : 1000,
      2000,
      h,
    );

  const boxPolygon = (lo: number, hi: number, h: SurfaceClipHeader) =>
    new PlanarPolygonGeometry([
      [
        [
          [sceneX(lo, h), sceneZ(lo, h)],
          [sceneX(hi, h), sceneZ(lo, h)],
          [sceneX(hi, h), sceneZ(hi, h)],
          [sceneX(lo, h), sceneZ(hi, h)],
        ],
      ],
    ]);

  it('leaves every filled node absent when no limit is given', () => {
    const reference = buildStackReference([holed(10, 12, 10, 12)], polygon)!;

    expect(count(reference.masks[0], STACK_MASK_FILLED)).toBe(0);
    expect(count(reference.masks[0], 0)).toBeGreaterThan(0);
  });

  it('bridges a hole inside the limit, turning absence into fill', () => {
    // 3 cells across at 100 m: no node is more than 200 m from real data.
    const layer = () => holed(10, 12, 10, 12);
    const absent = count(buildStackReference([layer()], polygon)!.masks[0], 0);

    const reference = buildStackReference([layer()], polygon, {
      maxFill: 250,
    })!;

    // Nothing is absent any more, and exactly the nodes that were absent are the
    // ones now counted as fill — the bound converts absence, it does not invent
    // coverage anywhere else.
    expect(count(reference.masks[0], 0)).toBe(0);
    expect(count(reference.masks[0], STACK_MASK_FILLED)).toBe(absent);
  });

  it('refuses a hole larger than the limit, bridging only its edge', () => {
    const reference = buildStackReference([holed(8, 24, 8, 24)], polygon, {
      maxFill: 250,
    })!;

    // the middle is still absent...
    expect(count(reference.masks[0], 0)).toBeGreaterThan(0);
    // ...while a rim of it, within 250 m of the mapped area, is bridged
    expect(count(reference.masks[0], STACK_MASK_FILLED)).toBeGreaterThan(0);
  });

  it('measures the limit in metres, not cells', () => {
    // The SAME hole in cells, on a grid of twice the increment: its centre is
    // 400 m from real data instead of 200 m, so the same threshold decides
    // differently.
    const coarse = header(NX, NY, INC * 2, INC * 2);
    const coarsePolygon = boxPolygon(4, 28, coarse);

    const at = (maxFill: number) =>
      count(
        buildStackReference([holed(10, 12, 10, 12, coarse)], coarsePolygon, {
          maxFill,
        })!.masks[0],
        0,
      );

    expect(at(250)).toBeGreaterThan(0);
    expect(at(500)).toBe(0);
  });

  it('counts a bridged hole as coverage, and says how much of it is fill', () => {
    const layer = () => holed(10, 12, 10, 12);

    // Unbounded: the hole is absent, so the layer is not covered over all of it.
    const raw = buildStackReference([layer()], polygon)!;
    const cut = measureStackCoverage(raw, polygon, raw.masks);
    expect(cut.layerCoverage[0]).toBeLessThan(1);
    expect(cut.layerFilled[0]).toBe(0);

    const bounded = buildStackReference([layer()], polygon, { maxFill: 250 })!;
    const kept = measureStackCoverage(bounded, polygon, bounded.masks);

    expect(kept.layerCoverage[0]).toBe(1);
    // ...but the coverage is not free: the share standing on fill is reported.
    expect(kept.layerFilled[0]).toBeGreaterThan(0);
    expect(kept.layerFilled[0]).toBeLessThan(0.05);
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

  // The column collects candidates over the WHOLE envelope, and every chunk cut
  // from it used to insert all of them. Dropping the ones outside the chunk is
  // only sound if it changes nothing — which it is, because the rim is a
  // constraint edge and no triangle inside it can use a vertex outside it.
  it('ignores candidates outside its own outline, exactly', () => {
    const bumpy = layerFrom(
      (col, row) => 1000 + 60 * Math.sin(col / 3) * Math.cos(row / 4),
    );
    const envelope = maskPolygon(0, NX - 1);
    const reference = buildStackReference([bumpy], envelope)!;
    const nx = reference.header.nx;
    const all = collectStackCandidates(reference.channels[0], nx, 5);

    // the chunk is a small corner of the column
    const chunk = maskPolygon(4, 12);
    const inside = all.filter(node => {
      const col = node % nx;
      const row = (node - col) / nx;
      return col >= 4 && col <= 12 && row >= 4 && row <= 12;
    });
    expect(inside.length).toBeLessThan(all.length / 4);

    const withAll = tessellateStack(reference, chunk, 5, [all])!;
    const withInside = tessellateStack(reference, chunk, 5, [
      Uint32Array.from(inside),
    ])!;

    // The VERTEX SET is what has to match: those are the points every layer's
    // height is sampled at, so an identical set means an identical surface.
    // ⚠️ The diagonals need not match. A regular grid of equal heights is
    // cocircular everywhere, so several Delaunay triangulations of the same points
    // are equally valid and the insertion history picks one.
    expect([...withInside.coords]).toEqual([...withAll.coords]);
    expect(withInside.indices.length).toBe(withAll.indices.length);
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

  it('⭐ reads coverage per corner but truncation per triangle', () => {
    // The two masks answer different kinds of question, so they are read with
    // different rules — this is what keeps a layer from being drawn past its own
    // survey while a truncation still terminates exactly on the contour.
    const heights = [
      Float32Array.from([0, 0, 0, 0]),
      Float32Array.from([-100, -100, -100, -100]),
    ];
    const indices = new Uint32Array([0, 1, 2, 1, 2, 3]);
    const oneCorner = (v: number, value: number) => {
      const m = new Uint8Array(4).fill(value === 0 ? 1 : 0);
      m[v] = value;
      return m;
    };

    // one UNCOVERED corner takes the triangles that touch it: coverage is binary,
    // so a triangle with a corner off the survey is partly invented
    const uncovered = collapseStackTriangles(heights, indices, {
      coverage: [new Uint8Array(4).fill(1), oneCorner(0, 0)],
    });
    expect(uncovered.droppedAbsent[1]).toBe(1);

    // one TRUNCATED corner takes nothing: the heights vary linearly over the
    // shared topology, so the rest of that triangle is genuinely still there
    const truncated = collapseStackTriangles(heights, indices, {
      threshold: 0,
      absent: [new Uint8Array(4), oneCorner(0, 1)],
    });
    expect(truncated.droppedAbsent[1]).toBe(0);
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

/**
 * Sealing invents geometry, so the block has to be able to say which part. The
 * weights ride through the build as an `inferred` attribute on both the cap and
 * the wall, and its PRESENCE is what tells the appearance layer there is anything
 * to mark at all.
 */
describe('cap bounding volumes', () => {
  const polygon = maskPolygon(4, 28);

  it('gives a position-less cap a real bounding sphere, and it survives packing', () => {
    const top = layerFrom(() => 1000);
    // Relief so the cap has genuine vertical extent to bound.
    const base = layerFrom(
      (col, row) => 1400 + 40 * Math.sin(col / 3) * Math.cos(row / 3),
    );
    const reference = buildStackReference([top, base], polygon)!;
    const build = buildSurfaceStack(reference, [top, base], {
      polygon,
      maxError: 5,
      fills: [true, false],
    })!;

    const geometry = build.layers[0].geometry!;
    // A cap assembles its position in the shader, so it deliberately carries none.
    expect(geometry.hasAttribute('position')).toBe(false);
    // ...but three needs a bounding sphere to frustum-test it — without one the
    // cap is culled the moment the local origin leaves a close-up view.
    expect(geometry.boundingSphere).not.toBeNull();
    expect(geometry.boundingSphere!.radius).toBeGreaterThan(0);
    expect(geometry.boundingBox).not.toBeNull();

    // The bounds have to survive the worker boundary, or the story (which builds
    // in a worker) still ships a cap three cannot frustum-test.
    const [packed] = packBufferGeometry(geometry);
    const restored = unpackBufferGeometry(packed);
    expect(restored.boundingSphere).not.toBeNull();
    expect(restored.boundingSphere!.radius).toBeCloseTo(
      geometry.boundingSphere!.radius,
      5,
    );
    expect(restored.boundingBox).not.toBeNull();
  });
});

describe('carrying the inference through to the geometry', () => {
  const polygon = maskPolygon(4, 28);

  it('marks the invented part of a cap and of the wall below it', () => {
    const top = layerFrom(() => 1000);
    // Relief, so the tessellation carries interior vertices for the weight to be
    // sampled at — a flat pair is refined only at its rim.
    const base = layerFrom(
      (col, row) => 1400 + 40 * Math.sin(col / 3) * Math.cos(row / 3),
    );
    const reference = buildStackReference([top, base], polygon)!;
    // The base is a reconstruction over the right-hand half and measured over the
    // left, with the seal's own weight rising away from the data edge.
    const nodes = reference.header.nx * reference.header.ny;
    const weights = new Float32Array(nodes);
    for (let n = 0; n < nodes; n++) {
      const col = n % reference.header.nx;
      weights[n] = col <= 16 ? 0 : Math.min(1, (col - 16) / 8);
    }

    const build = buildSurfaceStack(reference, [top, base], {
      polygon,
      maxError: 5,
      fills: [true, false],
      inferred: [new Float32Array(nodes), weights],
    })!;

    const cap = build.layers[1].geometry!.getAttribute('inferred');
    const wall = build.walls[0]!.getAttribute('inferred');
    expect(cap).toBeDefined();
    expect(wall).toBeDefined();

    // ⭐ A gradient, not a flag: what is drawn fades from measured into invented.
    const values = Array.from(cap.array as Float32Array);
    expect(Math.min(...values)).toBe(0);
    expect(Math.max(...values)).toBeCloseTo(1, 5);
    expect(new Set(values).size).toBeGreaterThan(2);

    // The fully measured layer has nothing to say, so it carries no attribute —
    // which is what lets the overlay be skipped rather than drawn empty.
    expect(build.layers[0].geometry!.hasAttribute('inferred')).toBe(false);
  });

  it('leaves an unsealed stack unmarked', () => {
    const top = layerFrom(() => 1000);
    const base = layerFrom(() => 1400);
    const reference = buildStackReference([top, base], polygon)!;

    const build = buildSurfaceStack(reference, [top, base], {
      polygon,
      maxError: 5,
      fills: [true, false],
    })!;

    expect(build.inferred).toBeUndefined();
    expect(build.layers[1].geometry!.hasAttribute('inferred')).toBe(false);
    expect(build.walls[0]!.hasAttribute('inferred')).toBe(false);
  });

  it('marks what is drawn on hole fill when nothing sealed it', () => {
    const top = layerFrom(() => 1000);
    const base = layerFrom((col, row) => (col > 16 ? null : 1400 + row));
    const reference = buildStackReference([top, base], polygon, {
      maxFill: 0,
    })!;

    // Nothing dropped and nothing sealed: the unmapped half is drawn on the
    // reference's nearest-valid fill, which is as invented as a taper.
    const drawn = buildSurfaceStack(reference, [top, base], {
      polygon,
      maxError: 5,
      fills: [true, false],
      coverageAbsence: false,
    })!;
    const values = Array.from(
      drawn.layers[1].geometry!.getAttribute('inferred').array as Float32Array,
    );
    expect(values.some(v => v === 1)).toBe(true);
    expect(values.some(v => v === 0)).toBe(true);
    expect(drawn.walls[0]!.hasAttribute('inferred')).toBe(true);

    // With the drops on, nothing is drawn out there and there is nothing to mark.
    const dropped = buildSurfaceStack(reference, [top, base], {
      polygon,
      maxError: 5,
      fills: [true, false],
      coverageAbsence: true,
    })!;
    expect(dropped.inferred).toBeUndefined();
    expect(dropped.layers[1].geometry!.hasAttribute('inferred')).toBe(false);
  });

  it('marks a layer the seal could not reach, weights or no weights', () => {
    // ⚠️ The relief goes on the FULLY MAPPED layer: it is what makes the shared
    // tessellation carry interior vertices, without which there is nothing in the
    // gradient band to sample and every weight lands on 0 or 1.
    const top = layerFrom(
      (col, row) => 1000 + 40 * Math.sin(col / 3) * Math.cos(row / 3),
    );
    const base = layerFrom((col, row) => (col > 16 ? null : 1400 + row));
    const reference = buildStackReference([top, base], polygon, {
      maxFill: 0,
    })!;
    const nodes = reference.header.nx * reference.header.ny;

    // What the seal hands back for a layer it SKIPPED — nothing above or below it
    // to lean on, i.e. the end of a column. The region is drawn on the fill all
    // the same, so weights of zero must not be read as "measured".
    const skipped = buildSurfaceStack(reference, [top, base], {
      polygon,
      maxError: 5,
      fills: [true, false],
      coverageAbsence: false,
      inferred: [new Float32Array(nodes), new Float32Array(nodes)],
    })!;
    const values = Array.from(
      skipped.layers[1].geometry!.getAttribute('inferred')
        .array as Float32Array,
    );
    expect(values.some(v => v === 1)).toBe(true);
    expect(values.some(v => v === 0)).toBe(true);
    // ...while a layer with nothing to say still says nothing
    expect(skipped.layers[0].geometry!.hasAttribute('inferred')).toBe(false);

    // ⚠️ And a real seal's gradient is NOT replaced by the flat coverage answer:
    // the marking has to keep fading with the confidence.
    const weights = new Float32Array(nodes);
    for (let n = 0; n < nodes; n++) {
      const col = n % reference.header.nx;
      weights[n] = col <= 16 ? 0 : Math.min(1, (col - 16) / 8);
    }
    const sealed = buildSurfaceStack(reference, [top, base], {
      polygon,
      maxError: 5,
      fills: [true, false],
      coverageAbsence: false,
      inferred: [new Float32Array(nodes), weights],
    })!;
    const graded = new Set(
      Array.from(
        sealed.layers[1].geometry!.getAttribute('inferred')
          .array as Float32Array,
      ),
    );
    expect(graded.size).toBeGreaterThan(2);
  });
});

/**
 * A sealed surface keeps full thickness either side of the edge of its data, so
 * that edge is not a thickness crossing and nothing else refines it — the taper
 * then starts wherever the height refinement happened to leave a vertex.
 */
describe('refining the edge of a layer’s data', () => {
  const holed = () => layerFrom(col => (col >= 20 ? null : 1000 + col * 2));
  const solid = () => layerFrom(() => 1500);
  const polygon = maskPolygon(4, 28);

  const nearestVertexTo = (coords: Float32Array, col: number, row: number) => {
    let best = Infinity;
    for (let v = 0; v < coords.length / 2; v++) {
      const d = Math.hypot(coords[2 * v] - col, coords[2 * v + 1] - row);
      if (d < best) best = d;
    }
    return best;
  };

  it('finds the nodes bracketing the boundary, and no others', () => {
    const mask = new Uint8Array(6 * 3).fill(1);
    for (let row = 0; row < 3; row++)
      for (let col = 4; col < 6; col++) mask[row * 6 + col] = 0;
    // columns 3 and 4 bracket the flip, in all three rows
    expect(
      Array.from(collectCoverageCrossings(mask, 6)).map(n => n % 6),
    ).toEqual([3, 4, 3, 4, 3, 4]);
  });

  it('keeps every node when the layer covers everything', () => {
    expect(
      collectCoverageCrossings(new Uint8Array(24).fill(1), 6),
    ).toHaveLength(0);
  });

  it('puts vertices ON the data edge, which the height pass does not', () => {
    const layers = [solid(), holed()];
    const reference = buildStackReference(layers, polygon)!;

    const without = buildSurfaceStack(reference, layers, {
      polygon,
      maxError: 5,
      refineCoverage: false,
    })!;
    const with_ = buildSurfaceStack(reference, layers, {
      polygon,
      maxError: 5,
      refineCoverage: true,
    })!;

    // The reference fills a layer's hole from its nearest sample so the grid has
    // no cliffs — which is exactly why the height refinement cannot see the edge.
    expect(
      nearestVertexTo(with_.tessellation.coords, 19, 16),
    ).toBeLessThanOrEqual(1);
    expect(
      nearestVertexTo(without.tessellation.coords, 19, 16),
    ).toBeGreaterThan(nearestVertexTo(with_.tessellation.coords, 19, 16));
  });
});

describe('constraining a layer’s data boundary', () => {
  // Relief on the FULLY MAPPED layer, so the shared TIN is coarse in the interior
  // and fine only where the height needs it — which is the situation a data edge
  // has to survive. A plane refines to two triangles and straddles nothing.
  const rippled = () =>
    layerFrom((col, row) => 1000 + 40 * Math.sin(col / 3) * Math.cos(row / 4));
  // ⚠️ DIAGONAL to the grid. A data edge running along a grid line is the one
  // case the per-corner rule gets right; the comb and the bite are what happens
  // when it runs at an angle to the mesh.
  const holed = () => layerFrom((col, row) => (col + row >= 30 ? null : 1500));
  const polygon = maskPolygon(4, 28);

  // Cells inside the crop whose four corners are all mapped — what the layer may
  // honestly be drawn over.
  const mappedCells = () => {
    const ok = (col: number, row: number) => col + row < 30;
    let cells = 0;
    for (let r = 4; r < 28; r++) {
      for (let c = 4; c < 28; c++) {
        if (ok(c, r) && ok(c + 1, r) && ok(c, r + 1) && ok(c + 1, r + 1)) {
          cells++;
        }
      }
    }
    return cells;
  };

  const build = (constrainCoverage: boolean) => {
    const layers = [rippled(), holed()];
    const reference = buildStackReference(layers, polygon)!;
    return buildSurfaceStack(reference, layers, {
      polygon,
      maxError: 5,
      constrainCoverage,
      // Both sides are measured on a mesh that was NOT densified along the data
      // edge — that pass is what the constraint replaces, and a coarse edge is
      // what a large flat interior gives you anyway.
      refineCoverage: false,
    })!;
  };

  // Drawn area of one layer, in grid cells.
  const drawnArea = (
    result: ReturnType<typeof buildSurfaceStack>,
    layer: number,
  ) => {
    const t = result!.tessellation;
    const indices = result!.collapsed?.indices[layer] ?? t.indices;
    let area = 0;
    for (let i = 0; i < indices.length; i += 3) {
      const a = indices[i];
      const b = indices[i + 1];
      const c = indices[i + 2];
      area +=
        Math.abs(
          (t.coords[2 * b] - t.coords[2 * a]) *
            (t.coords[2 * c + 1] - t.coords[2 * a + 1]) -
            (t.coords[2 * c] - t.coords[2 * a]) *
              (t.coords[2 * b + 1] - t.coords[2 * a + 1]),
        ) / 2;
    }
    return area;
  };

  it('⭐ draws the mapped area exactly, instead of biting into it', () => {
    const mapped = mappedCells();
    const with_ = build(true);
    const without = build(false);

    expect(with_.tessellation.constraintFailures).toBe(0);
    // Exactly, not approximately: the trace follows cell edges, so the drawn
    // region IS the mapped cell region.
    expect(drawnArea(with_, 1)).toBeCloseTo(mapped, 6);
    // The per-corner rule can only drop whole triangles, so it gives up area it
    // has data for — that is the bite.
    expect(drawnArea(without, 1)).toBeLessThan(0.95 * drawnArea(with_, 1));
  });

  it('leaves a fully mapped layer alone', () => {
    const with_ = build(true);
    expect(with_.tessellation.coverage![0].every(f => f === 1)).toBe(true);
    expect(with_.collapsed?.droppedAbsent[0] ?? 0).toBe(0);
  });

  it('costs nothing when nothing is partly mapped', () => {
    const layers = [rippled(), layerFrom(() => 1500)];
    const reference = buildStackReference(layers, polygon)!;
    const t = tessellateStack(
      reference,
      polygon,
      5,
      undefined,
      undefined,
      true,
    )!;
    expect(t.coverageRingPoints).toBe(0);
    expect(t.coverage!.every(flags => flags.every(f => f === 1))).toBe(true);
  });

  it('traces one boundary per distinct extent, not per layer', () => {
    const layers = [rippled(), holed()];
    const reference = buildStackReference(layers, polygon)!;
    const mask = reference.masks[1];
    const shared = tessellateStack(
      { ...reference, masks: [mask, mask] },
      polygon,
      5,
      undefined,
      undefined,
      true,
    )!;
    const copied = tessellateStack(
      { ...reference, masks: [mask, Uint8Array.from(mask)] },
      polygon,
      5,
      undefined,
      undefined,
      true,
    )!;

    // Same extent ⇒ one trace, one set of flags, shared by both layers.
    expect(shared.coverage![0]).toBe(shared.coverage![1]);
    expect(copied.coverageRingPoints).toBe(2 * shared.coverageRingPoints!);
  });
});

describe('cut outlines', () => {
  // Rippled so the refinement produces a real mesh rather than two triangles.
  const rippled = () =>
    layerFrom((col, row) => 1000 + 30 * Math.sin(col / 3) * Math.cos(row / 3));
  const floor = () => layerFrom(() => 1600);
  const polygon = maskPolygon(4, 28);
  // Overlaps the domain's far corner without containing it or being contained.
  const cut = maskPolygon(16, 32);

  const triangleArea = (
    tess: { coords: Float32Array },
    indices: Uint32Array,
  ) => {
    let sum = 0;
    for (let i = 0; i < indices.length; i += 3) {
      const a = indices[i];
      const b = indices[i + 1];
      const c = indices[i + 2];
      sum +=
        Math.abs(
          (tess.coords[2 * b] - tess.coords[2 * a]) *
            (tess.coords[2 * c + 1] - tess.coords[2 * a + 1]) -
            (tess.coords[2 * c] - tess.coords[2 * a]) *
              (tess.coords[2 * b + 1] - tess.coords[2 * a + 1]),
        ) / 2;
    }
    return sum;
  };

  it('flags exactly the triangles the cut covers, on real mesh edges', () => {
    const reference = buildStackReference([rippled(), floor()], polygon)!;
    const tess = tessellateStack(reference, polygon, 5, undefined, [cut])!;

    expect(tess.cuts).toHaveLength(1);
    const flags = tess.cuts![0];
    const inside: number[] = [];
    const outside: number[] = [];
    for (let t = 0; t < flags.length; t++) {
      const tri = tess.indices.subarray(3 * t, 3 * t + 3);
      (flags[t] ? inside : outside).push(...tri);
    }
    expect(inside.length).toBeGreaterThan(0);
    expect(outside.length).toBeGreaterThan(0);

    // The cut is CONSTRAINED, so no triangle straddles it: the flagged area is
    // the overlap exactly, not to within a triangle. (Coords are grid nodes, and
    // the reference is cropped to the mask, so both squares shift by the margin.)
    const overlap = (28 - 16) * (28 - 16);
    expect(triangleArea(tess, Uint32Array.from(inside))).toBeCloseTo(
      overlap,
      6,
    );
  });

  it('removes only the capped layer, leaving its wall and its neighbours', () => {
    const layers = () => [rippled(), floor()];
    const reference = buildStackReference(layers(), polygon)!;
    // Same tessellation in both, so only the exclusion differs — constraining a
    // cut adds vertices, which moves every layer's triangle count on its own.
    const options = {
      polygon,
      maxError: 5,
      fills: [true, false],
      cuts: [cut],
    };
    const plain = buildSurfaceStack(reference, layers(), options)!;
    const clipped = buildSurfaceStack(reference, layers(), {
      ...options,
      capCuts: [[0], null],
    })!;

    const tris = (build: typeof plain, layer: number) =>
      (build.collapsed?.indices[layer] ?? build.tessellation.indices).length /
      3;

    expect(clipped.collapsed!.droppedExcluded[0]).toBeGreaterThan(0);
    expect(clipped.collapsed!.droppedExcluded[1]).toBe(0);
    expect(tris(clipped, 0)).toBeLessThan(tris(plain, 0));
    expect(tris(clipped, 1)).toBe(tris(plain, 1));

    // ⭐ The interval below is still this chunk's, so its wall is untouched.
    expect(clipped.walls[0]!.getAttribute('position').count).toBe(
      plain.walls[0]!.getAttribute('position').count,
    );
  });

  // The lid owner can be the NARROWER chunk (see `resolveSeam`), so a cut can fall
  // wholly inside the outline instead of crossing it — a hole in the cap.
  it('constrains a cut that falls wholly inside the outline', () => {
    const inner = maskPolygon(10, 20);
    const layers = () => [rippled(), floor()];
    const reference = buildStackReference(layers(), polygon)!;
    const tess = tessellateStack(reference, polygon, 5, undefined, [inner])!;

    expect(tess.constraintFailures).toBe(0);
    const flags = tess.cuts![0];
    const inside: number[] = [];
    let outside = 0;
    for (let t = 0; t < flags.length; t++) {
      if (flags[t]) inside.push(...tess.indices.subarray(3 * t, 3 * t + 3));
      else outside++;
    }
    expect(outside).toBeGreaterThan(0);
    expect(triangleArea(tess, Uint32Array.from(inside))).toBeCloseTo(
      (20 - 10) * (20 - 10),
      6,
    );

    const holed = buildSurfaceStack(reference, layers(), {
      polygon,
      maxError: 5,
      fills: [true, false],
      cuts: [inner],
      capCuts: [[0], null],
    })!;
    expect(holed.collapsed!.droppedExcluded[0]).toBe(inside.length / 3);
    expect(holed.collapsed!.droppedExcluded[1]).toBe(0);
  });
});

/**
 * A fluid is a level rather than a horizon: it is ordered like any other boundary
 * but is never the AUTHORITY, so what lies below it is measured against the
 * nearest solid layer above. The sea adds `unbounded` on top of that, which is
 * what lets ground rise through it instead of being flattened onto it.
 */
describe('a fluid boundary', () => {
  const tri = new Uint32Array([0, 1, 2]);
  // Sea level, then a sea bed that stands ABOVE it at the first vertex.
  const water = () => Float32Array.from([0, 0, 0]);
  const seabed = () => Float32Array.from([50, -100, -100]);
  const floor = () => Float32Array.from([-500, -500, -500]);

  it('does not truncate what is below it', () => {
    const heights = [water(), seabed(), floor()];
    resolveStackOrder(heights, { fluid: [true, false, false] });

    expect(heights[1][0]).toBe(50);
    expect(heights[0][0]).toBe(0);
  });

  it('⚠️ without the flag, the ground is flattened onto the plane and dropped', () => {
    const heights = [water(), seabed(), floor()];
    const resolved = resolveStackOrder(heights);

    expect(heights[1][0]).toBe(0);
    expect(resolved.absent[1][0]).toBe(1);
  });

  it('keeps the chain between the solid layers unbroken', () => {
    // The layer below the fluid is the authority for the one below that.
    const heights = [water(), seabed(), Float32Array.from([100, -50, -600])];
    resolveStackOrder(heights, { fluid: [false, true, false] });

    // seabed is fluid here, so the floor is measured against the WATER above it
    expect(heights[2][0]).toBe(0);
    expect(heights[2][1]).toBe(-50);
  });

  it('is itself held under the horizon above it', () => {
    // A contact that would sit ABOVE the top of the unit it divides.
    const top = () => Float32Array.from([-1000, -1000, -1000]);
    const contact = () => Float32Array.from([-900, -1200, -1200]);

    const heights = [top(), contact()];
    resolveStackOrder(heights, { fluid: [false, true] });

    expect(heights[1][0]).toBe(-1000);
  });

  it('⭐ never drags the base of its own unit down — the no-water-leg case', () => {
    const top = () => Float32Array.from([-1000, -1000, -1000]);
    const contact = () => Float32Array.from([-1200, -1200, -1200]);
    // The reservoir base is SHALLOWER than the contact at the first vertex: there
    // is simply no water leg there.
    const base = () => Float32Array.from([-1100, -1300, -1400]);

    const heights = [top(), contact(), base()];
    resolveStackOrder(heights, { fluid: [false, true, false] });

    expect(Array.from(heights[2])).toEqual([-1100, -1300, -1400]);

    // Without the flag the contact becomes the authority and pulls the base down
    // onto itself — an oil column with no water leg under it, and a horizon moved
    // to make room for a level.
    const ordinary = [top(), contact(), base()];
    resolveStackOrder(ordinary);
    expect(ordinary[2][0]).toBe(-1200);
  });

  it('draws its lid whole, and keeps ground that stands above it', () => {
    const emerged = () => Float32Array.from([50, 50, 50]);

    const heights = [water(), emerged()];
    resolveStackOrder(heights, { fluid: [true, false] });
    const collapsed = collapseStackTriangles(heights, tri, {
      threshold: 0.5,
      unbounded: [true, false],
    });
    expect(collapsed.dropped).toEqual([0, 0]);
    expect(heights[1][0]).toBe(50);

    // Without it the ground is clamped onto the plane, and then dropped as a
    // duplicate of it — the lid covers everything and the island is gone.
    const flattened = [water(), emerged()];
    const resolved = resolveStackOrder(flattened);
    expect(
      collapseStackTriangles(flattened, tri, {
        threshold: 0.5,
        absent: resolved.absent,
      }).dropped[1],
    ).toBe(1);
  });

  it('⭐ ends its volume where the ground comes through — the shoreline', () => {
    const above = stackIntervalTriangles([water(), seabed()], tri, {
      threshold: 0.5,
      unbounded: [true, false],
    });
    // the sea bed is above the plane at one corner, but not at all three
    expect(above[0][0]).toBe(1);

    const emerged = stackIntervalTriangles(
      [water(), Float32Array.from([50, 50, 50])],
      tri,
      { threshold: 0.5, unbounded: [true, false] },
    );
    expect(emerged[0][0]).toBe(0);
  });
});

/**
 * A carrier is a flat floor declared for a whole column, and it is a datum rather
 * than a unit: nothing pierces it, and it is the one layer that never yields.
 */
describe('the column carrier', () => {
  const NODES = 8;
  const plane = (y: number) => new Float32Array(NODES).fill(y);
  const all = () => new Uint8Array(NODES).fill(1);

  it('takes an absolute depth as given', () => {
    expect(stackCarrierLevel([plane(-100)], [all()], { depth: 2500 })).toBe(
      -2500,
    );
  });

  it('clears the column’s deepest MAPPED sample, ignoring hole fill', () => {
    const channel = plane(-1000);
    // A node the layer has no data for, filled from far below: it must not drag
    // the floor down with it.
    channel[3] = -9000;
    const mask = all();
    mask[3] = 0;

    expect(stackCarrierLevel([channel], [mask], { below: 500 })).toBe(-1500);
  });

  it('truncates whatever would pierce it, and holds itself flat', () => {
    const shallow = plane(-100);
    const deep = Float32Array.from(plane(-1000));
    deep[0] = -3000;
    const floor = plane(0);
    const moved = clampStackToCarrier([shallow, deep, floor], 2, -2000);

    expect(moved).toEqual([0, 1, 0]);
    expect(deep[0]).toBe(-2000);
    expect(deep[1]).toBe(-1000);
    // untouched above, and the plane itself is restored whatever it held
    expect(shallow[0]).toBe(-100);
    expect(floor[0]).toBe(-2000);
  });

  it('⭐ cannot introduce a crossing — a max against a constant keeps the order', () => {
    const a = Float32Array.from([-100, -2500, -300]);
    const b = Float32Array.from([-200, -2600, -2900]);
    clampStackToCarrier([a, b, plane(0)], 2, -2400);

    for (let n = 0; n < a.length; n++) {
      expect(a[n]).toBeGreaterThanOrEqual(b[n]);
    }
  });

  describe('which of a coincident pair survives', () => {
    // One triangle, in a stack of top / horizon / carrier.
    const tri = new Uint32Array([0, 1, 2]);
    const y = (value: number) => Float32Array.from([value, value, value]);
    const stack = (horizon: number) => [y(-500), y(horizon), y(-2000)];

    it('keeps the floor and drops the horizon flattened onto it', () => {
      const collapsed = collapseStackTriangles(stack(-2000), tri, {
        threshold: 0.5,
        carrier: 2,
      });

      // the truncated horizon goes...
      expect(collapsed.dropped[1]).toBe(1);
      // ...and the floor stays, which is the reverse of the usual rule: without
      // the flag the DEEPER of the two would be the one dropped, leaving a hole
      // in the very surface that closes the block
      expect(collapsed.dropped[2]).toBe(0);
      expect(
        collapseStackTriangles(stack(-2000), tri, { threshold: 0.5 })
          .dropped[2],
      ).toBe(1);
    });

    it('leaves a horizon standing clear of the floor alone', () => {
      const collapsed = collapseStackTriangles(stack(-1000), tri, {
        threshold: 0.5,
        carrier: 2,
      });

      expect(collapsed.dropped).toEqual([0, 0, 0]);
    });

    it('⭐ keeps the unit above a truncated horizon — it is cut off, not removed', () => {
      const heights = stack(-2000);
      const intervals = stackIntervalTriangles(heights, tri, {
        threshold: 0.5,
      });

      // the unit between the top and the truncated horizon still fills the space
      // down to the floor...
      expect(intervals[0][0]).toBe(1);
      // ...while the one below it has nothing left
      expect(intervals[1][0]).toBe(0);
    });
  });
});
