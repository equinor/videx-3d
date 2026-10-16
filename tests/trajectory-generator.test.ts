import { describe, expect, it } from 'vitest';
import { generateTrajectory } from '../src/generators/trajectory-generator';
import type { PositionLog, ReadonlyStore, Vec3 } from '../src/sdk';

const STRIDE = 10;

// Vertical to 1000 m, a 600 m radius build to horizontal, then 1500 m flat, as
// position-log rows [east, tvd, north, md].
function surveyed(every: number) {
  const r = 600;
  const arc = (Math.PI / 2) * r;
  const length = 1000 + arc + 1500;
  const at = (md: number): Vec3 => {
    if (md <= 1000) return [0, md, 0];
    if (md <= 1000 + arc) {
      const a = (md - 1000) / r;
      return [r - r * Math.cos(a), 1000 + r * Math.sin(a), 0];
    }
    return [r + md - 1000 - arc, 1000 + r, 0];
  };
  const values: number[] = [];
  for (let md = 0; md < length + every; md += every) {
    const m = Math.min(md, length);
    values.push(...at(m), m);
  }
  return Float32Array.from(values) as PositionLog;
}

async function generate() {
  const store = { get: async () => surveyed(30) } as unknown as ReadonlyStore;
  return (await generateTrajectory.call(store, 'w', 0.1, 0))!;
}

function rows(buffer: Float32Array) {
  const out: number[][] = [];
  for (let i = 0; i < buffer.length; i += STRIDE) {
    out.push(Array.from(buffer.subarray(i, i + STRIDE)));
  }
  return out;
}

function toPolyline(points: number[][], p: number[]) {
  let best = Infinity;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const u = [0, 1, 2].map(k => points[i][k] - a[k]);
    const w = [0, 1, 2].map(k => p[k] - a[k]);
    const uu = u[0] * u[0] + u[1] * u[1] + u[2] * u[2];
    const t =
      uu > 0
        ? Math.max(
            0,
            Math.min(1, (w[0] * u[0] + w[1] * u[1] + w[2] * u[2]) / uu),
          )
        : 0;
    best = Math.min(
      best,
      Math.hypot(w[0] - t * u[0], w[1] - t * u[1], w[2] - t * u[2]),
    );
  }
  return best;
}

describe('generateTrajectory levels', () => {
  it('gives coarser levels that copy rows of the full one, ends included', async () => {
    const section = await generate();
    const full = rows(section.attributesBuffer);
    const keys = new Set(full.map(row => row.join(',')));
    expect(section.levels!.length).toBeGreaterThan(1);
    for (const level of section.levels!) {
      const kept = rows(level.attributesBuffer);
      expect(kept.length).toBe(level.segments);
      for (const row of kept) expect(keys.has(row.join(','))).toBe(true);
      expect(kept[0]).toEqual(full[0]);
      expect(kept[kept.length - 1]).toEqual(full[full.length - 1]);
    }
  });

  it('keeps every level within its tolerance, coarser as the tolerance grows', async () => {
    const section = await generate();
    const full = rows(section.attributesBuffer);
    let previous = full.length;
    let previousTolerance = 0;
    for (const level of section.levels!) {
      const kept = rows(level.attributesBuffer);
      expect(level.tolerance).toBeGreaterThan(previousTolerance);
      expect(kept.length).toBeLessThan(previous);
      for (const row of full) {
        expect(toPolyline(kept, row)).toBeLessThanOrEqual(
          level.tolerance + 1e-3,
        );
      }
      previous = kept.length;
      previousTolerance = level.tolerance;
    }
  });
});
