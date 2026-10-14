import { describe, expect, it } from 'vitest';
import {
  bakeCapNormalMap,
  StackCapNormalMap,
} from '../src/sdk/geometries/cap-normal-map';
import { buildStackCapArrays } from '../src/sdk/geometries/stack-cap-arrays';

type Vec3 = [number, number, number];

// Scene metres to grid cells: 10 m cells, origin at the scene origin.
const toGrid: [number, number, number, number, number, number] = [
  0.1, 0, 0, 0, 0.1, 0,
];

function fromHalf(h: number): number {
  const sign = h & 0x8000 ? -1 : 1;
  const e = (h >> 10) & 0x1f;
  const m = h & 0x3ff;
  if (e === 0) return sign * m * 2 ** -24;
  return sign * (1 + m / 1024) * 2 ** (e - 15);
}

/** What the shader reads at scene `(x, z)`: linear filtering, clamped, y rebuilt. */
function sample(map: StackCapNormalMap, x: number, z: number): Vec3 {
  const [a, b, c, d, e, f] = map.toUv;
  const fx = (a * x + b * z + c) * map.width - 0.5;
  const fy = (d * x + e * z + f) * map.height - 0.5;
  const i0 = Math.floor(fx);
  const j0 = Math.floor(fy);
  const tx = fx - i0;
  const ty = fy - j0;
  const at = (i: number, j: number, k: number) => {
    const ii = Math.min(Math.max(i, 0), map.width - 1);
    const jj = Math.min(Math.max(j, 0), map.height - 1);
    return fromHalf(map.data[2 * (jj * map.width + ii) + k]);
  };
  const lerp = (k: number) =>
    (at(i0, j0, k) * (1 - tx) + at(i0 + 1, j0, k) * tx) * (1 - ty) +
    (at(i0, j0 + 1, k) * (1 - tx) + at(i0 + 1, j0 + 1, k) * tx) * ty;
  const nx = lerp(0);
  const nz = lerp(1);
  const n: Vec3 = [nx, Math.sqrt(Math.max(1 - nx * nx - nz * nz, 0)), nz];
  const l = Math.hypot(...n);
  return [n[0] / l, n[1] / l, n[2] / l];
}

const degrees = (p: Vec3, q: Vec3) => {
  const cross = Math.hypot(
    p[1] * q[2] - p[2] * q[1],
    p[2] * q[0] - p[0] * q[2],
    p[0] * q[1] - p[1] * q[0],
  );
  const dot = p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
  return (Math.atan2(cross, dot) * 180) / Math.PI;
};

/** An `n` x `n` node TIN on 10 m cells, heights from `h`, wound up. */
function tin(n: number, h: (x: number, z: number) => number) {
  const xz = new Float32Array(n * n * 2);
  const y = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      xz[2 * (j * n + i)] = i * 10;
      xz[2 * (j * n + i) + 1] = j * 10;
      y[j * n + i] = h(i * 10, j * 10);
    }
  }
  const quads = (keep: (i: number, j: number) => boolean) => {
    const out: number[] = [];
    for (let j = 0; j + 1 < n; j++) {
      for (let i = 0; i + 1 < n; i++) {
        if (!keep(i, j)) continue;
        const a = j * n + i;
        out.push(a, a + n + 1, a + 1, a, a + n, a + n + 1);
      }
    }
    return Uint32Array.from(out);
  };
  return { xz, y, quads };
}

// y = 0.3 x - 0.2 z: the plane's upward normal.
const plane = (x: number, z: number) => 0.3 * x - 0.2 * z;
const planeNormal: Vec3 = (() => {
  const l = Math.hypot(0.3, 1, 0.2);
  return [-0.3 / l, 1 / l, 0.2 / l];
})();

const repeat = (count: number, n: Vec3) =>
  Float32Array.from({ length: count * 3 }, (_, k) => n[k % 3]);

describe('bakeCapNormalMap', () => {
  it('holds each vertex normal at its grid node, as the attribute had it', () => {
    const wavy = (x: number, z: number) =>
      40 * Math.sin(x * 0.07) * Math.cos(z * 0.05);
    const { xz, y, quads } = tin(12, wavy);
    const index = quads(() => true);
    const input = { positionsXZ: xz, y, shared: new Uint32Array(0), peel: null };
    const attribute = buildStackCapArrays({ ...input, own: index.slice() })
      .normal!;
    const { normalMap } = buildStackCapArrays({
      ...input,
      own: index.slice(),
      toGrid,
    });
    let worst = 0;
    for (let v = 0; v < y.length; v++) {
      const n: Vec3 = [
        attribute[3 * v] / 32767,
        attribute[3 * v + 1] / 32767,
        attribute[3 * v + 2] / 32767,
      ];
      worst = Math.max(
        worst,
        degrees(sample(normalMap!, xz[2 * v], xz[2 * v + 1]), n),
      );
    }
    expect(worst).toBeLessThan(0.1);
  });

  it("reads a plane's normal right up to the cap's edge", () => {
    // One triangle below the diagonal x = z: filtering just inside it reads texels
    // above the diagonal, which no triangle covers.
    const xz = Float32Array.from([0, 0, 100, 0, 100, 100]);
    const y = Float32Array.from([plane(0, 0), plane(100, 0), plane(100, 100)]);
    const map = bakeCapNormalMap(
      xz,
      y,
      repeat(3, planeNormal),
      Uint32Array.from([0, 2, 1]),
      null,
      toGrid,
    );
    for (const [x, z] of [
      [55, 52],
      [91, 89],
      [30, 10],
      [100, 0],
    ]) {
      expect(degrees(sample(map, x, z), planeNormal)).toBeLessThan(0.1);
    }
  });

  it("fills what only a coarser level draws with that level's normal", () => {
    // The full level keeps the left two columns of cells, the level the whole
    // square in two triangles. The full level's normals point straight up, so
    // what the level fills is told apart from what the full level spread.
    const { xz, y, quads } = tin(11, plane);
    const full = quads(i => i < 2);
    const normals = new Float32Array(y.length * 3);
    for (const v of full) normals[3 * v + 1] = 1;
    const level = Uint32Array.from([0, 120, 10, 0, 110, 120]);
    const map = bakeCapNormalMap(xz, y, normals, full, [level], toGrid);
    // On the level's edge from (100, 0) to (100, 100): neither corner has a normal.
    expect(degrees(sample(map, 100, 50), planeNormal)).toBeLessThan(0.1);
    const without = bakeCapNormalMap(xz, y, normals, full, null, toGrid);
    expect(degrees(sample(without, 100, 50), [0, 1, 0])).toBeLessThan(0.1);
  });

  it('leaves its normal behind from a sliver no texel centre lies in', () => {
    const xz = Float32Array.from([2, 2, 38, 4, 38, 6]);
    const y = new Float32Array(3);
    const n: Vec3 = [0.6, 0.8, 0];
    const map = bakeCapNormalMap(
      xz,
      y,
      repeat(3, n),
      Uint32Array.from([0, 2, 1]),
      null,
      toGrid,
    );
    expect(degrees(sample(map, 26, 4.5), n)).toBeLessThan(0.1);
  });
});
