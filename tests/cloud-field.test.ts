import { describe, expect, it } from 'vitest';
import {
  cloudFieldHash,
  CUMULUS_GRIDS,
  CUMULUS_MARGIN,
  CUMULUS_REACH,
  CUMULUS_WRAP,
  cumulusAspect,
  cumulusAt,
  cumulusCovers,
  cumulusEpoch,
  cumulusGrids,
  cumulusGridSeed,
  cumulusLife,
  cumulusTopRadius,
  STRATO_OCTAVES,
  stratoField,
  stratoOctaveShift,
  stratoStatistics,
  stratoThreshold,
} from '../src/sdk/weather/cloud-field';

const layerOf = (cover: number, base = 1200, top = 2400) => ({
  base,
  top,
  cover,
});

// The share of the ground under the cumulus of `layer`, at `time`: counted over a square of
// cells `n` of the largest grid's across, each grid's clouds over its own cells.
function measuredCover(
  layer: { base: number; top: number; cover: number },
  time: number,
  n = 16,
  step = 120,
) {
  const { grids } = cumulusGrids(layer);
  const side = grids[grids.length - 1].cell * n;
  const thickness = layer.top - layer.base;
  let covered = 0;
  let count = 0;
  for (let x = 0; x < side; x += step)
    for (let y = 0; y < side; y += step) {
      count++;
      const under = grids.some((grid, k) => {
        const cloud = cumulusAt(
          grid,
          Math.floor(x / grid.cell),
          Math.floor(y / grid.cell),
          cumulusEpoch(grid, time),
          { base: layer.base, thickness },
          cumulusGridSeed(0, k),
        );
        return cloud !== null && cumulusCovers(cloud, x, y);
      });
      if (under) covered++;
    }
  return covered / count;
}

describe('cloudFieldHash', () => {
  it('is deterministic and well spread', () => {
    expect(cloudFieldHash(1, 2, 3, 4)).toBe(cloudFieldHash(1, 2, 3, 4));
    expect(cloudFieldHash(1, 2, 3, 4)).not.toBe(cloudFieldHash(1, 2, 3, 5));
    let ones = 0;
    const n = 4096;
    for (let i = 0; i < n; i++) ones += cloudFieldHash(i, 7, 0, 11) & 1;
    expect(Math.abs(ones / n - 0.5)).toBeLessThan(0.03);
  });

  it('stays an unsigned 32-bit integer', () => {
    let worst = 0;
    for (let i = 0; i < 1000; i++) {
      const h = cloudFieldHash(i * 7919, -i, i * 13, 0xffffff);
      if (!(Number.isInteger(h) && h >= 0 && h < 2 ** 32)) worst = h;
    }
    expect(worst).toBe(0);
  });
});

describe('cumulus', () => {
  it('grow taller than broad the larger they are', () => {
    expect(cumulusAspect(400)).toBeCloseTo(0.45, 5);
    expect(cumulusAspect(1000)).toBeGreaterThan(cumulusAspect(500));
    expect(cumulusAspect(4000)).toBeGreaterThan(1.2);
    expect(cumulusAspect(1e6)).toBeCloseTo(1.9, 5);
  });

  it('take larger clouds into a deeper layer', () => {
    expect(cumulusTopRadius(600)).toBeLessThan(cumulusTopRadius(1200));
    expect(cumulusTopRadius(1200)).toBeLessThan(cumulusTopRadius(3000));
  });

  it('come and go with nothing at either end of their lives', () => {
    expect(cumulusLife(0).height).toBe(0);
    expect(cumulusLife(0).density).toBe(0);
    expect(cumulusLife(1).density).toBe(0);
    // Built up before they spread out, and whole in the middle of their lives.
    expect(cumulusLife(0.2).height).toBeGreaterThan(0.5);
    expect(cumulusLife(0.5)).toEqual({ height: 1, radius: 1, density: 1 });
  });

  it('cover the share of the ground asked, as far as the grids reach', () => {
    for (const cover of [0.1, 0.25, 0.4]) {
      const layer = layerOf(cover);
      expect(cumulusGrids(layer).cover).toBeCloseTo(cover, 6);
      // Averaged over a few moments of their lives.
      const measured =
        [0, 333, 777].reduce(
          (sum, time) => sum + measuredCover(layer, time),
          0,
        ) / 3;
      expect(
        Math.abs(measured - cover),
        `cover ${cover}: measured ${measured}`,
      ).toBeLessThan(0.05);
    }
  });

  it('cover no more than their cells hold, and say so', () => {
    const { cover } = cumulusGrids(layerOf(0.95));
    expect(cover).toBeGreaterThan(0.45);
    expect(cover).toBeLessThan(0.95);
  });

  it('stay within their cells, clear of the margins the march skips by', () => {
    const layer = layerOf(0.4, 800, 3400);
    const { grids } = cumulusGrids(layer);
    let worst = { overreach: -Infinity, at: '' };
    grids.forEach((grid, k) => {
      for (let cx = 0; cx < 40; cx++)
        for (let cy = 0; cy < 40; cy++) {
          const cloud = cumulusAt(
            grid,
            cx,
            cy,
            cumulusEpoch(grid, 1000),
            { base: layer.base, thickness: layer.top - layer.base },
            cumulusGridSeed(3, k),
          );
          if (!cloud) continue;
          const reach =
            CUMULUS_REACH * cloud.radius + CUMULUS_MARGIN * grid.cell;
          const inside = Math.min(
            cloud.x - cx * grid.cell,
            (cx + 1) * grid.cell - cloud.x,
            cloud.y - cy * grid.cell,
            (cy + 1) * grid.cell - cloud.y,
          );
          const overreach = reach - inside;
          if (overreach > worst.overreach)
            worst = { overreach, at: `grid ${k} cell ${cx},${cy}` };
        }
    });
    expect(worst.overreach, worst.at).toBeLessThanOrEqual(1e-6);
  });

  it('fall off in number as they grow, and stand no taller than the layer', () => {
    const layer = layerOf(0.4, 800, 3400);
    const { grids } = cumulusGrids(layer);
    expect(grids).toHaveLength(CUMULUS_GRIDS);
    const thickness = layer.top - layer.base;
    const counts = grids.map(grid => grid.occupancy / (grid.cell * grid.cell));
    for (let k = 1; k < grids.length; k++) {
      expect(grids[k].least).toBeCloseTo(grids[k - 1].most, 6);
      expect(counts[k]).toBeLessThan(counts[k - 1]);
    }
    let tallest = 0;
    grids.forEach((grid, k) => {
      for (let c = 0; c < 400; c++) {
        const cloud = cumulusAt(
          grid,
          c,
          c * 3,
          cumulusEpoch(grid, 0),
          { base: layer.base, thickness },
          cumulusGridSeed(0, k),
        );
        if (cloud) tallest = Math.max(tallest, cloud.height);
      }
    });
    expect(tallest).toBeLessThanOrEqual(thickness);
    expect(tallest).toBeGreaterThan(0.6 * thickness);
  });

  it('are the same cloud across the drift’s wrap', () => {
    const layer = layerOf(0.4);
    const { grids } = cumulusGrids(layer);
    const grid = grids[0];
    const clock = cumulusEpoch(grid, 500);
    const at = (cx: number) =>
      cumulusAt(grid, cx, 5, clock, { base: 1200, thickness: 1200 }, 9);
    const differ: number[] = [];
    for (let cx = 0; cx < 50; cx++) {
      const a = at(cx);
      const b = at(cx + CUMULUS_WRAP);
      if ((a === null) !== (b === null) || (a && b && a.radius !== b.radius))
        differ.push(cx);
    }
    expect(differ).toEqual([]);
  });
});

describe('strato', () => {
  const shifts = Array.from({ length: STRATO_OCTAVES + 1 }, (_, o) =>
    stratoOctaveShift(o - 1, 0, 0, 0),
  );

  it('measures a field about 0.5 with some spread', () => {
    const { mean, deviation, quantiles } = stratoStatistics();
    expect(mean).toBeGreaterThan(0.4);
    expect(mean).toBeLessThan(0.6);
    expect(deviation).toBeGreaterThan(0.03);
    for (let i = 1; i < quantiles.length; i++)
      expect(quantiles[i]).toBeGreaterThanOrEqual(quantiles[i - 1]);
  });

  it('covers the share of the ground asked', () => {
    for (const cover of [0.2, 0.5, 0.8]) {
      const level = stratoThreshold(cover);
      let over = 0;
      const n = 80;
      for (let i = 0; i < n; i++)
        for (let j = 0; j < n; j++)
          if (stratoField(40 + i * 0.41, 90 + j * 0.41, shifts) > level) over++;
      const measured = over / (n * n);
      expect(
        Math.abs(measured - cover),
        `cover ${cover}: measured ${measured}`,
      ).toBeLessThan(0.08);
    }
  });

  it('drifts with the wind without changing', () => {
    const drifted = Array.from({ length: STRATO_OCTAVES + 1 }, (_, o) =>
      stratoOctaveShift(o - 1, 2.5, -1.25, 0),
    );
    let worst = 0;
    for (let i = 0; i < 50; i++) {
      const x = 3 + i * 0.37;
      const y = 7 - i * 0.21;
      worst = Math.max(
        worst,
        Math.abs(
          stratoField(x + 2.5, y - 1.25, drifted) - stratoField(x, y, shifts),
        ),
      );
    }
    expect(worst).toBeLessThan(1e-6);
  });

  it('takes none at no cover and all at full', () => {
    const { quantiles } = stratoStatistics();
    expect(stratoThreshold(0)).toBeGreaterThan(quantiles[16]);
    expect(stratoThreshold(1)).toBeLessThan(quantiles[0]);
  });
});
