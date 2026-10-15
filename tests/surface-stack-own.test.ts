import { describe, expect, it } from 'vitest';
import { PlanarPolygonGeometry } from '../src/sdk/geometries/planar-geometry';
import { SurfaceClipHeader } from '../src/sdk/geometries/surface-clip';
import {
  buildStackReference,
  sampleStackHeights,
  StackGridLayer,
} from '../src/sdk/geometries/surface-stack';
import { collectStackCandidateLevels } from '../src/sdk/geometries/surface-stack-candidates';
import {
  buildSurfaceStack,
  planSurfaceStack,
} from '../src/sdk/geometries/surface-stack-geometry';
import { sampleStackOwnLayer } from '../src/sdk/geometries/surface-stack-own';
import { buildStackCapArrays } from '../src/sdk/geometries/stack-cap-arrays';
import { tessellateStackTile } from '../src/sdk/geometries/stack-tiles';
import { createTinSampler } from '../src/sdk/geometries/tin-sampler';

const N = 33;
const INC = 100;
const MAX_ERROR = 5;
const header: SurfaceClipHeader = {
  nx: N,
  ny: N,
  xinc: INC,
  yinc: INC,
  rot: 0,
};

// Samples encode `referenceDepth - depth`, so scene y = -depth.
const layerFrom = (
  depth: (col: number, row: number) => number,
): StackGridLayer => {
  const values = new Float32Array(N * N);
  for (let row = 0; row < N; row++) {
    for (let col = 0; col < N; col++)
      values[row * N + col] = 2000 - depth(col, row);
  }
  return { values, header, referenceDepth: 2000, worldPosition: [0, 0] };
};

const polygon = (() => {
  const x = (col: number) => col * INC;
  const z = (row: number) => (row - (N - 1)) * INC;
  return new PlanarPolygonGeometry([
    [
      [
        [x(4), z(4)],
        [x(28), z(4)],
        [x(28), z(28)],
        [x(4), z(28)],
      ],
    ],
  ]);
})();

// Each layer has detail where the other is gently curved, so each is refined
// where the other is not — and carries the other's vertices as passengers, at
// points its own TIN only approximates.
const wavy = (col: number, row: number) =>
  40 * Math.sin(col / 2) * Math.cos(row / 3);
const upper = () =>
  layerFrom((c, r) => 1000 + (c < 16 ? wavy(c, r) : 9 * Math.sin(r / 3)));
const lower = () =>
  layerFrom((c, r) => 1500 + (c >= 16 ? wavy(c, r) : 9 * Math.sin(c / 3)));

const build = (layers: StackGridLayer[], own = true) => {
  const reference = buildStackReference(layers, polygon)!;
  const levels = reference.channels.map(channel =>
    collectStackCandidateLevels(channel, reference.header.nx, MAX_ERROR),
  );
  const result = buildSurfaceStack(reference, layers, {
    polygon,
    maxError: MAX_ERROR,
    candidates: levels.map(l => l.nodes),
    candidateTriangles: own ? levels.map(l => l.triangles) : undefined,
  })!;
  return { reference, levels, result };
};

const key = (coords: Float32Array, v: number) =>
  `${coords[2 * v]},${coords[2 * v + 1]}`;

/** Largest per-component difference of layer 0's normals at the vertices both builds have. */
const normalDrift = (
  a: ReturnType<typeof build>['result'],
  b: ReturnType<typeof build>['result'],
) => {
  const at = new Map<string, number>();
  const ca = a.tessellation.coords;
  for (let v = 0; v < ca.length >> 1; v++) at.set(key(ca, v), v);
  const na = a.layers[0].geometry!.getAttribute('normal').array;
  const nb = b.layers[0].geometry!.getAttribute('normal').array;
  const cb = b.tessellation.coords;
  let worst = 0;
  let shared = 0;
  for (let v = 0; v < cb.length >> 1; v++) {
    const u = at.get(key(cb, v));
    if (u === undefined) continue;
    shared++;
    for (let k = 0; k < 3; k++)
      worst = Math.max(worst, Math.abs(na[3 * u + k] - nb[3 * v + k]));
  }
  return { worst, shared };
};

describe('own surfaces', () => {
  it('⭐ interpolates the vertices other layers add on the layer’s own TIN', () => {
    const { reference, levels, result } = build([upper(), lower()]);
    const { coords } = result.tessellation;
    const tin = levels[0];
    const nx = reference.header.nx;
    const positions = new Float64Array(tin.nodes.length * 3);
    tin.nodes.forEach((node, j) => {
      positions[3 * j] = node % nx;
      positions[3 * j + 1] = reference.channels[0][node];
      positions[3 * j + 2] = Math.floor(node / nx);
    });
    const sampler = createTinSampler(positions, tin.triangles);
    const rim = new Set(result.tessellation.rimVertices.flat());
    const grid = sampleStackHeights(reference, coords)[0];

    let worst = 0;
    let offGrid = 0;
    for (let v = 0; v < coords.length >> 1; v++) {
      if (rim.has(v)) continue;
      const own = sampler.getHeightAt(coords[2 * v], coords[2 * v + 1])!;
      worst = Math.max(worst, Math.abs(result.heights[0][v] - own));
      if (Math.abs(grid[v] - own) > 0.1) offGrid++;
    }
    expect(worst).toBeLessThan(1e-3);
    // ...and the grid would have put many of them elsewhere: the rule is not vacuous.
    expect(offGrid).toBeGreaterThan(10);
  });

  it('⭐ shades a layer the same whichever layers share its stack', () => {
    const alone = build([upper()]).result;
    const both = build([upper(), lower()]).result;
    const drift = normalDrift(alone, both);
    expect(drift.shared).toBeGreaterThan(50);
    // snorm16 units: a few is rounding.
    expect(drift.worst).toBeLessThanOrEqual(2);

    // Control: normals taken from the shared triangles DO change.
    const old = normalDrift(
      build([upper()], false).result,
      build([upper(), lower()], false).result,
    );
    expect(old.worst).toBeGreaterThan(300);
  });

  it('⭐ keeps a unit exactly as thin as its grid says where it pinches out', () => {
    // The lower unit wedges out along col + row = 30, onto shared relief.
    const relief = (c: number, r: number) =>
      40 * Math.sin(c / 3) * Math.cos(r / 4);
    const layers = [
      layerFrom((c, r) => 1000 + relief(c, r)),
      layerFrom((c, r) => 1000 + relief(c, r) + Math.max(0, (c + r - 30) * 10)),
    ];
    for (const constrainTerminations of [false, true]) {
      const reference = buildStackReference(layers, polygon)!;
      const result = buildSurfaceStack(reference, layers, {
        polygon,
        maxError: MAX_ERROR,
        constrainTerminations,
      })!;
      const grid = sampleStackHeights(reference, result.tessellation.coords);
      const [top, bottom] = result.heights;
      let thin = 0;
      let thinDrift = 0;
      let thickest = Infinity;
      for (let v = 0; v < top.length; v++) {
        const thickness = grid[0][v] - grid[1][v];
        if (thickness <= 0.5) {
          thin++;
          thinDrift = Math.max(
            thinDrift,
            Math.abs(top[v] - bottom[v] - thickness),
          );
        } else {
          thickest = Math.min(thickest, top[v] - bottom[v]);
        }
      }
      expect(thin).toBeGreaterThan(10);
      expect(thinDrift).toBeLessThan(1e-3);
      expect(thickest).toBeGreaterThan(0.5);
    }
  });

  it('builds the same stack from its layers sampled in any order', () => {
    const layers = [upper(), lower(), layerFrom((c, r) => 1800 + wavy(r, c))];
    const reference = buildStackReference(layers, polygon)!;
    const options = { polygon, maxError: MAX_ERROR };
    const serial = buildSurfaceStack(reference, layers, options)!;

    const plan = planSurfaceStack(reference, layers, options);
    const stitched = plan.stitch(plan.tiles.map(tessellateStackTile))!;
    expect(stitched.jobs).toHaveLength(layers.length);
    for (let i = stitched.jobs.length - 1; i >= 0; i--) {
      stitched.own!.add(i, sampleStackOwnLayer(stitched.jobs[i]));
    }
    const pending = stitched.begin();
    const built = pending.finish(
      pending.jobs.map((job, i) =>
        pending.finishCap(i, job && buildStackCapArrays(job)),
      ),
    );
    built.heights.forEach((y, i) =>
      expect(Array.from(y)).toEqual(Array.from(serial.heights[i])),
    );
    built.layers.forEach((layer, i) =>
      expect(Array.from(layer.geometry!.getAttribute('normal').array)).toEqual(
        Array.from(serial.layers[i].geometry!.getAttribute('normal').array),
      ),
    );
  });
});
