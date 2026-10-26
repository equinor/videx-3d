import { DataTexture, Vector4 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  buildHeightFieldIndex,
  heightFieldIndexAt,
  heightFieldPatchAt,
  heightFieldPatchSlope,
  HeightFieldTile,
} from '../src/sdk/geometries/height-field-clip';
import {
  applyHeightFieldClip,
  createHeightFieldClipBinding,
  HeightFieldClip,
} from '../src/sdk/materials/height-field-clip';

const tile = (
  minX: number,
  minZ: number,
  width: number,
  slot: number,
): HeightFieldTile => ({ minX, minZ, width, slot });

describe('buildHeightFieldIndex', () => {
  it('lays entries as wide as the narrowest tile, aligned to it', () => {
    // A 200 m tile, and two 100 m tiles beside it.
    const index = buildHeightFieldIndex(
      [tile(0, 0, 200, 0), tile(200, 0, 100, 1), tile(200, 100, 100, 2)],
      [30, 20, 290, 180],
    )!;
    expect(index.entry).toBe(100);
    expect(index.origin).toEqual([0, 0]);
    expect(index.size).toEqual([3, 2]);
    const slotAt = (x: number, z: number) => {
      const at = heightFieldIndexAt(index, x, z);
      return at < 0 ? -1 : index.data[at + 3];
    };
    expect(slotAt(50, 50)).toBe(0);
    expect(slotAt(150, 150)).toBe(0);
    expect(slotAt(250, 50)).toBe(1);
    expect(slotAt(250, 150)).toBe(2);
    // Each entry holds its tile's square.
    const at = heightFieldIndexAt(index, 150, 150);
    expect(Array.from(index.data.subarray(at, at + 4))).toEqual([0, 0, 200, 0]);
    // Outside the index: nothing.
    expect(heightFieldIndexAt(index, -10, 50)).toBe(-1);
    expect(heightFieldIndexAt(index, 350, 50)).toBe(-1);
  });

  it('keeps the earlier tile, and fills what none covers', () => {
    const asked: [number, number][] = [];
    const index = buildHeightFieldIndex(
      [tile(0, 0, 100, 0), tile(0, 0, 100, 5)],
      [0, 0, 200, 100],
      (x, z) => {
        asked.push([x, z]);
        return tile(100, 0, 100, 7);
      },
    )!;
    expect(index.data[3]).toBe(0);
    expect(asked).toEqual([[150, 50]]);
    expect(index.data[4 + 3]).toBe(7);
    // Left empty without a fill.
    const empty = buildHeightFieldIndex(
      [tile(0, 0, 100, 0)],
      [0, 0, 200, 100],
    )!;
    expect(heightFieldIndexAt(empty, 150, 50)).toBe(-1);
  });

  it('widens its entries past the most allowed, each the tile at its middle', () => {
    const tiles = [tile(0, 0, 10, 0), tile(10, 0, 10, 1)];
    const index = buildHeightFieldIndex(tiles, [0, 0, 100, 10], undefined, 4)!;
    expect(index.entry).toBe(40);
    expect(index.size).toEqual([3, 1]);
    // The first entry's middle (20, 20) lies in neither tile.
    expect(heightFieldIndexAt(index, 5, 5)).toBe(-1);
    expect(buildHeightFieldIndex([], [0, 0, 1, 1])).toBeNull();
  });
});

describe('heightFieldPatchAt', () => {
  // Nodes of a 2 x 2 cell patch: heights i + 10 j, but node (1, 1) raised to 50.
  const node = (i: number, j: number) => (i === 1 && j === 1 ? 50 : i + 10 * j);

  it('is the height of the triangles, split from (i + 1, j) to (i, j + 1)', () => {
    // On the nodes.
    expect(heightFieldPatchAt(node, 2, 0, 0)).toBe(0);
    expect(heightFieldPatchAt(node, 2, 1, 1)).toBe(50);
    // Cell (0, 0), below its diagonal: the plane through (0,0), (1,0), (0,1).
    expect(heightFieldPatchAt(node, 2, 0.25, 0.25)).toBeCloseTo(
      0.25 * 1 + 0.25 * 10,
    );
    // On the diagonal, halfway: the mean of (1, 0) and (0, 1), whatever (1, 1) is.
    expect(heightFieldPatchAt(node, 2, 0.5, 0.5)).toBeCloseTo(5.5);
    // Above it: the plane through (1,0), (0,1), (1,1).
    expect(heightFieldPatchAt(node, 2, 0.75, 0.75)).toBeCloseTo(
      50 + 0.25 * (10 - 50) + 0.25 * (1 - 50),
    );
  });

  it('clamps to the patch', () => {
    expect(heightFieldPatchAt(node, 2, -1, -1)).toBe(0);
    expect(heightFieldPatchAt(node, 2, 3, 3)).toBe(node(2, 2));
  });
});

describe('heightFieldPatchSlope', () => {
  const node = (i: number, j: number) => (i === 1 && j === 1 ? 50 : i + 10 * j);

  it('is the slope of the triangle heightFieldPatchAt draws there', () => {
    const e = 1e-4;
    for (const [u, v] of [
      [0.25, 0.25],
      [0.75, 0.75],
      [1.3, 0.2],
      [1.6, 1.7],
      [0.1, 1.8],
    ]) {
      const [du, dv] = heightFieldPatchSlope(node, 2, u, v);
      const at = heightFieldPatchAt(node, 2, u, v);
      expect(du).toBeCloseTo(
        (heightFieldPatchAt(node, 2, u + e, v) - at) / e,
        3,
      );
      expect(dv).toBeCloseTo(
        (heightFieldPatchAt(node, 2, u, v + e) - at) / e,
        3,
      );
    }
  });
});

describe('createHeightFieldClipBinding', () => {
  it('reads whichever clip is set, and clips nothing without one', () => {
    const binding = createHeightFieldClipBinding();
    const into: Record<string, { value: unknown }> = {};
    applyHeightFieldClip(into, binding.uniforms);
    expect((into.heightClipParams.value as Vector4).x).toBe(0);
    expect(into.heightClipIndex.value).toBeNull();

    const index = new DataTexture();
    const clip: HeightFieldClip = {
      uniforms: {
        heightClipTiles: { value: null },
        heightClipIndex: { value: index },
        heightClipRegion: { value: new Vector4(1, 2, 3, 0) },
        heightClipParams: { value: new Vector4(1, -10, -200, 32) },
      },
      heightAt: () => null,
      margin: 0,
    };
    binding.set(clip);
    expect(into.heightClipIndex.value).toBe(index);
    expect((into.heightClipParams.value as Vector4).x).toBe(1);
    // Read as it is drawn: a change to the clip reaches the binding with no copy.
    clip.uniforms.heightClipParams.value.x = 0;
    expect((into.heightClipParams.value as Vector4).x).toBe(0);
    binding.set(null);
    expect(into.heightClipIndex.value).toBeNull();
  });
});
