import { describe, expect, it } from 'vitest';
import {
  sealStackChannels,
  splitVoidChannels,
  TAPER_MAX_SLOPE,
  TAPER_MIN_THICKNESS,
} from '../src/sdk/geometries/surface-seal';
import {
  collapseStackTriangles,
  resolveStackGrid,
  stackIntervalTriangles,
} from '../src/sdk/geometries/surface-stack';

const NX = 9;
const NY = 9;
const COUNT = NX * NY;
const CELL = 100;

const flat = (y: number) => new Float32Array(COUNT).fill(y);
const covered = () => new Uint8Array(COUNT).fill(1);

/** Mapped up to (and including) column `lastCol`, unmapped beyond it. */
const mappedTo = (lastCol: number) => {
  const mask = new Uint8Array(COUNT);
  for (let n = 0; n < COUNT; n++) if (n % NX <= lastCol) mask[n] = 1;
  return mask;
};

/** A footprint covering columns up to (and including) `lastCol`. */
const drawnTo = (lastCol: number) => mappedTo(lastCol);

const at = (channel: Float32Array, col: number) => channel[col];

describe('sealStackChannels', () => {
  /** A above at 0, C below sloping away, B mapped to column 3 at a quarter down. */
  const setup = () => {
    const a = flat(0);
    const c = new Float32Array(COUNT);
    const b = new Float32Array(COUNT);
    for (let n = 0; n < COUNT; n++) {
      const col = n % NX;
      c[n] = -300 - 50 * col;
      b[n] = a[n] - 0.25 * (a[n] - c[n]);
    }
    return { channels: [a, b, c], masks: [covered(), mappedTo(3), covered()] };
  };

  it('leaves a fully mapped stack untouched, and shares its channels', () => {
    const channels = [flat(0), flat(-100)];
    const result = sealStackChannels(channels, [covered(), covered()], NX, {});

    // identity: on a shared column these belong to every chunk cut from it
    expect(result.channels[0]).toBe(channels[0]);
    expect(result.channels[1]).toBe(channels[1]);
    expect(result.tapered).toEqual([0, 0]);
  });

  it('keeps the relative depth it had where it was last mapped', () => {
    const { channels, masks } = setup();
    const c = channels[2];

    const b = sealStackChannels(channels, masks, NX, {}).channels[1];

    // ⭐ It follows the SHAPE of the pair rather than flattening onto either: the
    // ratio is held at 0.25 while the room between them grows column by column.
    for (let col = 4; col < NX; col++) {
      expect(at(b, col)).toBeCloseTo(0.25 * at(c, col), 4);
    }
  });

  it('stays strictly between its neighbours, so monotonicity is free', () => {
    const { channels, masks } = setup();

    const sealed = sealStackChannels(channels, masks, NX, {});

    for (let n = 0; n < COUNT; n++) {
      expect(sealed.channels[0][n]).toBeGreaterThanOrEqual(
        sealed.channels[1][n],
      );
      expect(sealed.channels[1][n]).toBeGreaterThanOrEqual(
        sealed.channels[2][n],
      );
    }
    expect(sealed.tapered[1]).toBe(5 * NY);
  });

  it('reports the inference as a WEIGHT that grows away from the data edge', () => {
    const { channels, masks } = setup();

    const w = sealStackChannels(channels, masks, NX, {}).inferred[1];

    // ⭐ Not a flag: the reconstruction leans on the nearest real data, so it is
    // least trustworthy furthest from it — which is what a marking should shade by.
    expect(w[3]).toBe(0); // last mapped column: measured
    expect(w[4]).toBeGreaterThan(0);
    expect(w[4]).toBeLessThan(w[8]);
    expect(w[8]).toBeCloseTo(1, 5); // the far side of the gap
    // a fully mapped layer has nothing to report
    expect(
      sealStackChannels(channels, masks, NX, {}).inferred[0].every(
        v => v === 0,
      ),
    ).toBe(true);
  });

  it('tapers onto its one neighbour at the top of a stack', () => {
    // No layer above, so there is no ratio to hold — only one interval to close.
    const channels = [flat(0), flat(-100)];
    const masks = [mappedTo(3), covered()];

    const top = sealStackChannels(channels, masks, NX, {}).channels[0];

    // it moves toward the neighbour...
    expect(at(top, 8)).toBeLessThan(at(top, 3));
    // ...but stops an absolute distance short, so the unit below keeps a skin
    expect(at(top, 8)).toBeCloseTo(-100 + TAPER_MIN_THICKNESS, 3);
  });

  it('⭐ leaves the same thickness standing whatever the room — not a share of it', () => {
    const thin = sealStackChannels(
      [flat(0), flat(-20)],
      [mappedTo(3), covered()],
      NX,
      { minThickness: 2 },
    ).channels[0];
    const thick = sealStackChannels(
      [flat(0), flat(-800)],
      [mappedTo(3), covered()],
      NX,
      { minThickness: 2 },
    ).channels[0];

    expect(at(thin, 8)).toBeCloseTo(-18, 3);
    expect(at(thick, 8)).toBeCloseTo(-798, 3);
  });

  it('does not move at all where there is less room than the minimum', () => {
    const sealed = sealStackChannels(
      [flat(0), flat(-1)],
      [mappedTo(3), covered()],
      NX,
      { minThickness: 5 },
    ).channels[0];

    expect(at(sealed, 8)).toBeCloseTo(0, 6);
  });

  it('⭐ reaches across the GAP, so travel sets the gradient and not the run', () => {
    // 5 unmapped columns of room, closed against a neighbour 1000 m below and
    // against one 5000 m below.
    const shallow = sealStackChannels(
      [flat(0), flat(-1000)],
      [mappedTo(3), covered()],
      NX,
      {},
    ).channels[0];
    const deep = sealStackChannels(
      [flat(0), flat(-5000)],
      [mappedTo(3), covered()],
      NX,
      {},
    ).channels[0];

    // Both land at the far side of the same gap, each stopping the same absolute
    // distance short of its neighbour.
    expect(at(shallow, 8)).toBeCloseTo(-1000 + TAPER_MIN_THICKNESS, 3);
    expect(at(deep, 8)).toBeCloseTo(-5000 + TAPER_MIN_THICKNESS, 3);

    // ⭐ So their gradients are in the ratio of their travels rather than equal.
    // Making the run proportional to travel instead cancels it out, and every
    // taper leaves the edge at the same angle however far it has to go.
    const gradient = (top: Float32Array) =>
      Math.abs(at(top, 8) - at(top, 3)) / ((8 - 3) * CELL);
    expect(gradient(deep) / gradient(shallow)).toBeCloseTo(
      (5000 - TAPER_MIN_THICKNESS) / (1000 - TAPER_MIN_THICKNESS),
      6,
    );
  });

  it('⭐⭐ measures the gap over the DRAWN footprint, not the whole grid', () => {
    const channels = [flat(0), flat(-1000)];
    const masks = [mappedTo(3), covered()];

    // The unmapped region runs to the edge of the grid, but only columns up to 6
    // are inside the chunk, so that is the gap the taper has to close.
    const cropped = sealStackChannels(channels, masks, NX, {
      inside: drawnTo(6),
    }).channels[0];
    const whole = sealStackChannels(channels, masks, NX, {}).channels[0];

    // landed by the edge of the footprint...
    expect(at(cropped, 6)).toBeCloseTo(-1000 + TAPER_MIN_THICKNESS, 3);
    // ...and still short of it when the run is stretched over invisible ground,
    // which is the whole defect: resizing an outline changed every seal inside it
    expect(at(whole, 6)).toBeGreaterThan(at(cropped, 6) + 1);
    // beyond the footprint it simply holds, rather than overshooting
    expect(at(cropped, 8)).toBeCloseTo(at(cropped, 6), 6);
  });

  it('⭐ bounds the travel by the gap’s own reach, so a small gap only dimples', () => {
    // 5 unmapped columns = a reach of 5 cells, so at most 5 * CELL * slope of
    // travel however far the neighbour is.
    const cap = TAPER_MAX_SLOPE * 5 * CELL;
    const sealed = sealStackChannels(
      [flat(0), flat(-5000)],
      [mappedTo(3), covered()],
      NX,
      { cellSize: CELL },
    ).channels[0];

    expect(at(sealed, 8)).toBeCloseTo(-cap, 3);
    // ...where the same gap dives the whole way without a cell size to compare
    // the reach against
    const unbounded = sealStackChannels(
      [flat(0), flat(-5000)],
      [mappedTo(3), covered()],
      NX,
      {},
    ).channels[0];
    expect(at(unbounded, 8)).toBeCloseTo(-5000 + TAPER_MIN_THICKNESS, 3);
  });

  it('leaves a gap with room to spare alone — the bound is a slope, not a size', () => {
    // 8 unmapped columns against a neighbour only 300 m below: the room runs out
    // long before the slope does, so this lands exactly where it always did.
    const sealed = sealStackChannels(
      [flat(0), flat(-300)],
      [mappedTo(0), covered()],
      NX,
      { cellSize: CELL },
    ).channels[0];

    expect(TAPER_MAX_SLOPE * 8 * CELL).toBeGreaterThan(300);
    expect(at(sealed, 8)).toBeCloseTo(-300 + TAPER_MIN_THICKNESS, 3);
  });

  it('stays monotone after the resolve when layers taper into each other', () => {
    const channels = [flat(0), flat(-100), flat(-200), flat(-300)];
    const masks = [covered(), mappedTo(3), mappedTo(3), covered()];

    const sealed = sealStackChannels(channels, masks, NX, {});
    resolveStackGrid(sealed.channels, { minGap: 0 });

    for (let n = 0; n < COUNT; n++) {
      for (let i = 1; i < sealed.channels.length; i++) {
        expect(sealed.channels[i - 1][n]).toBeGreaterThanOrEqual(
          sealed.channels[i][n] - 1e-6,
        );
      }
    }
  });
});

describe('splitVoidChannels', () => {
  const setup = () => ({
    channels: [flat(0), flat(-100), flat(-300)],
    masks: [covered(), mappedTo(3), covered()],
  });

  it('splits an unmapped surface in two, with an EMPTY interval between', () => {
    const { channels, masks } = setup();

    const out = splitVoidChannels(channels, masks, NX, {});

    // 3 layers in, 4 out — the middle one became two
    expect(out.source).toEqual([0, 1, 1, 2]);
    // ⭐ The upper copy is the CEILING of the void, which is also what says it
    // holds no volume: the caller fills every other copy from its own layer, so
    // the split needs no fill state of its own.
    expect(out.ceiling).toEqual([false, true, false, false]);
  });

  it('opens the void between the neighbours, and closes it where there is data', () => {
    const { channels, masks } = setup();

    const out = splitVoidChannels(channels, masks, NX, {});
    const upper = out.channels[1];
    const lower = out.channels[2];

    // where the surface has data the copies are identical: no void at all
    expect(at(upper, 2)).toBeCloseTo(at(lower, 2), 6);
    // out in the gap they part, the upper rising and the lower sinking
    expect(at(upper, 8)).toBeGreaterThan(at(lower, 8));
    expect(at(upper, 8)).toBeGreaterThan(at(upper, 3));
    expect(at(lower, 8)).toBeLessThan(at(lower, 3));
    // ...and neither reaches its neighbour, so both units keep a skin
    expect(at(upper, 8)).toBeLessThan(0);
    expect(at(lower, 8)).toBeGreaterThan(-300);
  });

  it('⭐ leaves the SAME thickness of both neighbouring units standing', () => {
    const { channels, masks } = setup();

    const out = splitVoidChannels(channels, masks, NX, {
      minThickness: 10,
    });

    // fully open at the far side of the gap: 10 m of the unit above survives
    // above the ceiling, and 10 m of the unit below beneath the floor
    expect(at(out.channels[1], 8)).toBeCloseTo(-10, 3);
    expect(at(out.channels[2], 8)).toBeCloseTo(-290, 3);
  });

  it('leaves a layer with one neighbour unsplit — there is no void to open', () => {
    const out = splitVoidChannels(
      [flat(0), flat(-100)],
      [mappedTo(3), covered()],
      NX,
      {},
    );

    expect(out.source).toEqual([0, 1]);
  });

  it('shares fully mapped layers by reference', () => {
    const { channels, masks } = setup();
    const out = splitVoidChannels(channels, masks, NX, {});

    expect(out.channels[0]).toBe(channels[0]);
    expect(out.channels[3]).toBe(channels[2]);
  });

  it('⭐ opens a narrow void only as far as its reach allows', () => {
    // Neighbours far enough away that the reach, not the room, is what binds.
    const channels = [flat(0), flat(-1000), flat(-3000)];
    const masks = [covered(), mappedTo(3), covered()];
    const cap = TAPER_MAX_SLOPE * 5 * CELL;

    const out = splitVoidChannels(channels, masks, NX, {
      cellSize: CELL,
    });

    // The bound applies to both copies, so the void opens symmetrically about the
    // surface rather than reaching each neighbour.
    expect(at(out.channels[1], 8)).toBeCloseTo(-1000 + cap, 3);
    expect(at(out.channels[2], 8)).toBeCloseTo(-1000 - cap, 3);
  });
});

/**
 * A void splits a surface across the WHOLE grid, so outside the hole the two
 * copies are coincident and one of them has to go. Which one is not a detail: the
 * ceiling is the invention, the copy below it is the horizon.
 */
describe('which copy of a void pair survives', () => {
  // Three vertices of one triangle, in a stack of A / U / L / floor.
  const tri = new Uint32Array([0, 1, 2]);
  const at = (y: number) => Float32Array.from([y, y, y]);

  const collapse = (uY: number, lY: number) =>
    collapseStackTriangles([at(-1000), at(uY), at(lY), at(-2000)], tri, {
      threshold: 0.5,
      ceiling: [false, true, false, false],
    });

  it('drops the CEILING where it has closed onto the horizon below it', () => {
    // outside the void the copies are identical
    const out = collapse(-1200, -1200);
    expect(out.indices[1]).toHaveLength(0); // the ceiling is gone
    expect(out.indices[2]).toBeNull(); // the horizon is untouched
    expect(out.droppedCollapsed[1]).toBe(1);
    expect(out.droppedCollapsed[2]).toBe(0);
  });

  it('would drop the horizon instead without the flag — the bug this fixes', () => {
    const out = collapseStackTriangles(
      [at(-1000), at(-1200), at(-1200), at(-2000)],
      tri,
      { threshold: 0.5 },
    );
    expect(out.indices[1]).toBeNull(); // the ceiling survives...
    expect(out.indices[2]).toHaveLength(0); // ...and the horizon is dropped
  });

  it('keeps both where the void is open', () => {
    const out = collapse(-1100, -1500);
    expect(out.indices[1]).toBeNull();
    expect(out.indices[2]).toBeNull();
  });

  it('keeps the interval ABOVE the ceiling where the void is shut', () => {
    // The unit above the split surface exists over mapped ground, which is why
    // the ceiling cannot simply be marked absent there.
    const member = stackIntervalTriangles(
      [at(-1000), at(-1200), at(-1200), at(-2000)],
      tri,
      { threshold: 0.5, ceiling: [false, true, false, false] },
    );
    expect(member[0][0]).toBe(1); // A -> ceiling: the unit above, still there
    expect(member[1][0]).toBe(0); // ceiling -> horizon: the void, shut
    expect(member[2][0]).toBe(1); // horizon -> floor: the unit below
  });
});
