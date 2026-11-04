import { describe, expect, it } from 'vitest';
import {
  RELIEF_CONTOUR_LABEL_FADE,
  RELIEF_CONTOUR_LABEL_LINE_PIXELS,
  reliefContourLabelClass,
  reliefContourLabelClassReach,
  reliefContourLineGap,
} from '../src/components/Layers/relief-contour-label-reach';

describe('relief contour label reach', () => {
  it('finds the next labelled line by the ground’s slope', () => {
    // Rising 10 m a 100 m column east: 1 in 10, so the 500 m step is 5 km off.
    expect(reliefContourLineGap([10, 0], 500, 100, 100)).toBeCloseTo(5000);
    // Along a 50 m column as much over half the ground: twice as steep.
    expect(reliefContourLineGap([10, 0], 500, 50, 100)).toBeCloseTo(2500);
    // East and south together: their slopes add as a vector.
    expect(reliefContourLineGap([30, 40], 500, 100, 100)).toBeCloseTo(1000);
    expect(reliefContourLineGap([0, 0], 500, 100, 100)).toBe(Infinity);
  });

  it('reaches as its spacing lets it, nearer where its lines crowd', () => {
    const unit = 1000;
    // Flat ground: its kind's alone, each finer kind half as far.
    expect(reliefContourLabelClass(unit, 3, Infinity)).toBe(3);
    expect(reliefContourLabelClass(unit, 4, Infinity)).toBe(4);
    // Lines far apart: still its kind's.
    expect(
      reliefContourLabelClass(unit, 3, 1e6 * RELIEF_CONTOUR_LABEL_LINE_PIXELS),
    ).toBe(3);
    // Lines a quarter as far apart on screen as its spacing allows: two classes nearer;
    // a little more than that, rounded down to the class below.
    const kindReach = unit * 2 ** -3;
    expect(
      reliefContourLabelClass(
        unit,
        3,
        (kindReach / 4) * RELIEF_CONTOUR_LABEL_LINE_PIXELS,
      ),
    ).toBe(5);
    expect(
      reliefContourLabelClass(
        unit,
        3,
        (kindReach / 3) * RELIEF_CONTOUR_LABEL_LINE_PIXELS,
      ),
    ).toBe(5);
    expect(reliefContourLabelClass(unit, 3, 0)).toBe(Infinity);
  });

  it('is whole within its class’s reach at the focal length, gone a little past', () => {
    const [whole, gone] = reliefContourLabelClassReach(1000, 3, 500);
    expect(whole).toBeCloseTo(1000 * 2 ** -3 * 500);
    expect(gone).toBeCloseTo(whole / RELIEF_CONTOUR_LABEL_FADE);
  });
});
