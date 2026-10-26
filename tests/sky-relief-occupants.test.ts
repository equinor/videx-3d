import { describe, expect, it } from 'vitest';
import { SkyReliefOccupantFields } from '../src/components/Sky/sky-relief-tiles';
import { polygonDistanceField } from '../src/sdk/geometries/polygon-distance-field';

describe('SkyReliefOccupantFields', () => {
  it('lays each occupant’s field side by side, with its frame', () => {
    const a = polygonDistanceField(
      [
        [
          [
            [0, 0],
            [100, 0],
            [100, 100],
            [0, 100],
          ],
        ],
      ],
      [0, 0],
      16,
    )!;
    const b = polygonDistanceField(
      [
        [
          [
            [0, 0],
            [50, 0],
            [0, 80],
          ],
        ],
      ],
      [5000, -300],
      16,
    )!;
    const fields = new SkyReliefOccupantFields([a, b]);
    const { data, width, height } = fields.texture.image as {
      data: Float32Array;
      width: number;
      height: number;
    };
    expect([width, height]).toEqual([32, 16]);
    expect(fields.count).toBe(2);
    for (const [i, j] of [
      [0, 0],
      [7, 9],
      [15, 15],
    ]) {
      expect(data[j * 32 + i]).toBe(a.values[j * 16 + i]);
      expect(data[j * 32 + 16 + i]).toBe(b.values[j * 16 + i]);
    }
    expect(fields.frames[1].toArray()).toEqual([
      b.origin[0],
      b.origin[1],
      b.cell,
    ]);
    // Each square's border lies outside its outline: no read bleeds into the next.
    for (let j = 0; j < 16; j++) {
      expect(data[j * 32 + 15]).toBeLessThan(0);
      expect(data[j * 32 + 16]).toBeLessThan(0);
    }
    fields.dispose();
  });
});
