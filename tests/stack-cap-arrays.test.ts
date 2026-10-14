import { describe, expect, it } from 'vitest';
import { BufferAttribute, BufferGeometry } from 'three';
import { computeUpwardNormals } from '../src/sdk/geometries/geometry-attributes';
import { buildStackCapArrays } from '../src/sdk/geometries/stack-cap-arrays';

// A wavy n x n grid TIN. `up` winds it so its normals face +Y.
function grid(n: number, up: boolean) {
  const xz = new Float32Array(n * n * 2);
  const y = new Float32Array(n * n);
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const v = j * n + i;
      xz[2 * v] = i * 10;
      xz[2 * v + 1] = j * 10;
      y[v] = -100 + 5 * Math.sin(i * 0.7) * Math.cos(j * 0.5);
    }
  const index: number[] = [];
  for (let j = 0; j + 1 < n; j++)
    for (let i = 0; i + 1 < n; i++) {
      const a = j * n + i;
      const b = a + 1;
      const c = a + n + 1;
      const d = a + n;
      if (up) index.push(a, c, b, a, d, c);
      else index.push(a, b, c, a, c, d);
    }
  return { xz, y, index: new Uint32Array(index) };
}

// What the cap build did before it was moved off three.js.
function viaThree(xz: Float32Array, y: Float32Array, index: Uint32Array) {
  const position = new Float32Array(y.length * 3);
  for (let v = 0; v < y.length; v++) {
    position[3 * v] = xz[2 * v];
    position[3 * v + 1] = y[v];
    position[3 * v + 2] = xz[2 * v + 1];
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(position, 3));
  geometry.setIndex(new BufferAttribute(index, 1));
  computeUpwardNormals(geometry);
  const normal = geometry.getAttribute('normal').array as Float32Array;
  const { min, max } = geometry.boundingBox!;
  const { center, radius } = geometry.boundingSphere!;
  return {
    normal: Array.from(normal, v =>
      Math.max(-32767, Math.min(32767, Math.round(v * 32767))),
    ),
    index: Array.from(index),
    box: [min.x, min.y, min.z, max.x, max.y, max.z],
    sphere: [center.x, center.y, center.z, radius],
  };
}

describe('buildStackCapArrays', () => {
  it('matches three exactly, for either winding', () => {
    for (const up of [false, true]) {
      const ours = grid(12, up);
      const arrays = buildStackCapArrays({
        positionsXZ: ours.xz,
        y: ours.y,
        shared: new Uint32Array(0),
        own: ours.index,
        peel: null,
      });
      const theirs = grid(12, up);
      const expected = viaThree(theirs.xz, theirs.y, theirs.index);
      expect(Array.from(arrays.normal!)).toEqual(expected.normal);
      expect(Array.from(arrays.index!)).toEqual(expected.index);
      expect(arrays.box).toEqual(expected.box);
      expect(arrays.sphere).toEqual(expected.sphere);
    }
  });

  it('re-winds its own index with a flipped peel, and returns the difference', () => {
    const { xz, y, index: peel } = grid(6, false);
    const own = new Uint32Array(
      Array.from(peel).filter((_, k) => Math.floor(k / 3) % 2 === 0),
    );
    const before = Array.from(own);
    const arrays = buildStackCapArrays({
      positionsXZ: xz,
      y,
      shared: new Uint32Array(0),
      own,
      peel,
    });
    const flipped = Array.from(peel).filter(
      (_, k) => Math.floor(k / 3) % 2 === 0,
    );
    expect(flipped).not.toEqual(before);
    expect(arrays.index).toBe(own);
    expect(Array.from(own)).toEqual(flipped);
    expect(Array.from(arrays.patchIndex!)).toEqual(
      Array.from(peel).filter((_, k) => Math.floor(k / 3) % 2 === 1),
    );
  });

  it('hands back the shared index as null unless it had to re-wind it', () => {
    const cap = (up: boolean) => {
      const { xz, y, index } = grid(4, up);
      const arrays = buildStackCapArrays({
        positionsXZ: xz,
        y,
        shared: index,
        own: null,
        peel: null,
      });
      return { arrays, index };
    };
    expect(cap(true).arrays.index).toBeNull();
    const down = cap(false);
    expect(down.arrays.index).toBe(down.index);
  });

  it('also bakes the normals into a map, when given the grid', () => {
    const { xz, y, index } = grid(6, true);
    const arrays = buildStackCapArrays({
      positionsXZ: xz,
      y,
      shared: new Uint32Array(0),
      own: index,
      peel: null,
      toGrid: [0.1, 0, 0, 0, 0.1, 0],
    });
    const plain = buildStackCapArrays({
      positionsXZ: xz,
      y,
      shared: new Uint32Array(0),
      own: grid(6, true).index,
      peel: null,
    });
    expect(Array.from(arrays.normal)).toEqual(Array.from(plain.normal));
    expect(plain.normalMap).toBeNull();
    expect(arrays.normalMap!.width).toBeGreaterThan(0);
  });
});
