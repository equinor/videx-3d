import { describe, expect, it } from 'vitest';
import {
  buildFenceSegmentIndex,
  FENCE_MASKED,
  fenceAutoSide,
  fenceHalfAt,
  fenceSideAt,
} from '../src/sdk/geometries/fence-segments';
import {
  buildFenceRibbons,
} from '../src/sdk/geometries/fence-ribbon';
import {
  packTriangleMask,
  StackSectionSource,
} from '../src/sdk/geometries/surface-section';
import {
  createFenceField,
  maskFenceField,
} from '../src/sdk/geometries/wellbore-fence';
import { Vec2 } from '../src/sdk/types/common';

const bounds: [number, number, number, number] = [-1000, -1000, 1000, 1000];
const CELL = 50;
// a straight cut along x = 0, the removed half at x < 0
const curve: Vec2[] = [
  [0, -1500],
  [0, 1500],
];
// the island the cut is kept to: x, z in [-400, 400]
const island: Vec2[] = [
  [-400, -400],
  [400, -400],
  [400, 400],
  [-400, 400],
];

function maskedField() {
  const field = createFenceField(curve, { bounds, cellSize: CELL, seed: [-500, 0] })!;
  const index = buildFenceSegmentIndex(curve, field);
  maskFenceField(field, [island]);
  return { field, index };
}

describe('a fence masked to an island', () => {
  it('cuts inside the island as before', () => {
    const { field, index } = maskedField();
    expect(fenceSideAt(index, field, -200, 0)).toBeLessThan(0);
    expect(fenceSideAt(index, field, 200, 0)).toBeGreaterThan(0);
  });

  it('keeps everything more than a cell outside it, however near the cut', () => {
    const { field, index } = maskedField();
    // ⚠️ next to the curve, where the exact segment test would otherwise answer
    expect(fenceSideAt(index, field, -1, 800)).toBe(FENCE_MASKED);
    expect(fenceSideAt(index, field, -600, -800)).toBe(FENCE_MASKED);
  });

  it('is grown by a cell, so the island edge reads its own side', () => {
    const { field, index } = maskedField();
    // the node nearest to this point lies just outside the island
    expect(fenceSideAt(index, field, -200, 420)).toBeLessThan(0);
    expect(fenceSideAt(index, field, -200, 400 + 3 * CELL)).toBe(FENCE_MASKED);
  });

  it('honours holes', () => {
    const field = createFenceField(curve, { bounds, cellSize: CELL, seed: [-500, 0] })!;
    const index = buildFenceSegmentIndex(curve, field);
    const hole: Vec2[] = [
      [-300, -300],
      [-100, -300],
      [-100, 300],
      [-300, 300],
    ];
    maskFenceField(field, [island, hole]);
    expect(fenceSideAt(index, field, -200, 0)).toBe(FENCE_MASKED);
    expect(fenceSideAt(index, field, -50, 0)).toBeLessThan(0);
  });

  it('still knows which half a masked point is in', () => {
    const { field, index } = maskedField();
    expect(fenceHalfAt(index, field, -600, -800)).toBe(-FENCE_MASKED);
    expect(fenceHalfAt(index, field, 600, -800)).toBe(FENCE_MASKED);
    expect(fenceHalfAt(index, field, -200, 0)).toBeLessThan(0);
    expect(fenceHalfAt(index, field, 200, 0)).toBeGreaterThan(0);
  });

  it('lets auto choose a side from outside the island', () => {
    const { field, index } = maskedField();
    // the field's removed half is the LEFT side's, at x < 0
    expect(fenceAutoSide('right', index, field, curve, -600, -800)).toBe('left');
    expect(fenceAutoSide('left', index, field, curve, 600, 800)).toBe('right');
  });
});

describe('buildFenceRibbons inside a region', () => {
  it('stops the face exactly at its boundary', () => {
    const n = 4;
    const side = n + 1;
    const positionsXZ = new Float32Array(side * side * 2);
    for (let r = 0; r < side; r++) {
      for (let c = 0; c < side; c++) {
        positionsXZ[2 * (r * side + c)] = c;
        positionsXZ[2 * (r * side + c) + 1] = r;
      }
    }
    const tris: number[] = [];
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const a = r * side + c;
        tris.push(a, a + 1, a + side + 1, a, a + side + 1, a + side);
      }
    }
    const indices = new Uint32Array(tris);
    const count = side * side;
    const source: StackSectionSource = {
      positionsXZ,
      indices,
      heights: [new Float32Array(count).fill(0), new Float32Array(count).fill(-10)],
      intervals: [packTriangleMask(new Uint8Array(indices.length / 3).fill(1))],
    };
    const path: Vec2[] = [];
    for (let x = 0.25; x <= 4; x += 0.5) path.push([x, 2]);
    const ribbons = buildFenceRibbons(source, path, { inside: x => x < 2.3 });
    const position = ribbons[0].geometry.getAttribute('position');
    let maxX = -Infinity;
    for (let i = 0; i < position.count; i++) maxX = Math.max(maxX, position.getX(i));
    expect(maxX).toBeCloseTo(2.3, 4);
  });
});
