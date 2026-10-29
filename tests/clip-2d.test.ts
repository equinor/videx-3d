import { describe, expect, it } from 'vitest';
import {
  clipPolylineToRect,
  clipRingToRect,
  clipSegmentToRect,
  type Rect2,
} from '../src/sdk/utils/clip-2d';
import type { Vec2 } from '../src/sdk/types/common';

const rect: Rect2 = [0, 0, 10, 10];

describe('clipSegmentToRect', () => {
  it('keeps what is inside, cuts what crosses, and drops what misses', () => {
    expect(clipSegmentToRect([1, 1], [9, 9], rect)).toEqual([0, 1]);
    expect(clipSegmentToRect([-10, 5], [20, 5], rect)).toEqual([1 / 3, 2 / 3]);
    expect(clipSegmentToRect([-5, -5], [-1, 20], rect)).toBeNull();
    // Along an edge counts as inside.
    expect(clipSegmentToRect([0, -5], [0, 5], rect)).toEqual([0.5, 1]);
  });
});

describe('clipPolylineToRect', () => {
  it('cuts a line a million pixels long to the part in view', () => {
    const runs = clipPolylineToRect(
      [
        [-1e6, 5],
        [1e6, 5],
      ],
      rect,
    );
    expect(runs).toHaveLength(1);
    expect(runs[0]).toHaveLength(2);
    expect(runs[0][0][0]).toBeCloseTo(0, 6);
    expect(runs[0][1][0]).toBeCloseTo(10, 6);
    expect(runs[0][0][1]).toBe(5);
  });

  it('splits a line that leaves and comes back into runs', () => {
    const line: Vec2[] = [
      [2, 2],
      [2, 20],
      [8, 20],
      [8, 2],
    ];
    expect(clipPolylineToRect(line, rect)).toEqual([
      [
        [2, 2],
        [2, 10],
      ],
      [
        [8, 10],
        [8, 2],
      ],
    ]);
    expect(
      clipPolylineToRect(
        [
          [20, 20],
          [30, 30],
        ],
        rect,
      ),
    ).toEqual([]);
  });
});

describe('clipRingToRect', () => {
  it('keeps a ring inside, cuts one across, and empties one outside', () => {
    const inside: Vec2[] = [
      [1, 1],
      [9, 1],
      [9, 9],
    ];
    expect(clipRingToRect(inside, rect)).toEqual(inside);
    const across: Vec2[] = [
      [-10, -10],
      [20, -10],
      [20, 20],
      [-10, 20],
    ];
    const cut = clipRingToRect(across, rect);
    expect(cut).toHaveLength(4);
    for (const [x, y] of cut) {
      expect(x === 0 || x === 10).toBe(true);
      expect(y === 0 || y === 10).toBe(true);
    }
    expect(
      clipRingToRect(
        [
          [20, 20],
          [30, 20],
          [30, 30],
        ],
        rect,
      ),
    ).toEqual([]);
  });
});
