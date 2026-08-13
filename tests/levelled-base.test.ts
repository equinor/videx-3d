import { BufferAttribute } from 'three';
import { describe, expect, it } from 'vitest';
import { createLevelledBase } from '../src/sdk/geometries/levelled-base';
import { PlanarPolygonGeometry } from '../src/sdk/geometries/planar-geometry';
import { Vec2 } from '../src/sdk/types/common';

/** A square footprint of `size` metres, centred on the origin. */
function footprint(size = 20) {
  const h = size / 2;
  const ring: Vec2[] = [
    [-h, -h],
    [h, -h],
    [h, h],
    [-h, h],
  ];
  return new PlanarPolygonGeometry([[[...ring, ring[0]]]], [0, 0]);
}

/** Ground sloping 1:10 along +X, 100 m down. */
const slope = (x: number) => -100 + x / 10;

function heights(geometry: { getAttribute(name: string): unknown }) {
  const position = geometry.getAttribute('position') as BufferAttribute;
  const out: number[] = [];
  for (let i = 0; i < position.count; i++) out.push(position.getY(i));
  return out;
}

describe('createLevelledBase', () => {
  it('levels at the highest ground under the footprint', () => {
    const base = createLevelledBase(footprint(), (x: number) => slope(x))!;

    expect(base.level).toBeCloseTo(base.metrics.max, 6);
    expect(base.metrics.max).toBeCloseTo(slope(10), 6);
    expect(base.metrics.min).toBeCloseTo(slope(-10), 6);
    expect(base.metrics.coverage).toBe(1);
    // 2 m of relief across the footprint, so the berm is 2 m at its thickest.
    expect(base.metrics.fill).toBeCloseTo(2, 6);
    expect(base.metrics.cut).toBe(0);
    expect(base.metrics.volume).toBeGreaterThan(0);
  });

  it('puts its top at one height and its foot in the ground', () => {
    const base = createLevelledBase(footprint(), (x: number) => slope(x), {
      embedment: 3,
    })!;

    const top = heights(base.top);
    expect(Math.min(...top)).toBeCloseTo(base.level, 6);
    expect(Math.max(...top)).toBeCloseTo(base.level, 6);

    // Every underside vertex is at least the embedment below the ground above it.
    const underside = heights(base.bottom!);
    expect(Math.max(...underside)).toBeLessThanOrEqual(
      base.metrics.max - 3 + 1e-6,
    );

    const skirt = heights(base.skirt!);
    expect(Math.max(...skirt)).toBeCloseTo(base.level, 6);
    expect(Math.min(...skirt)).toBeLessThan(base.metrics.min);
  });

  it('never inverts the skirt when the level is forced below the ground', () => {
    const base = createLevelledBase(footprint(), (x: number) => slope(x), {
      level: slope(-10),
      minThickness: 1,
    })!;

    expect(base.metrics.cut).toBeCloseTo(2, 6);
    // The underside stays under the top, so no quad turns inside out.
    expect(Math.max(...heights(base.bottom!))).toBeLessThanOrEqual(
      base.level - 1 + 1e-6,
    );
  });

  it('reports how much of the footprint is off the drawn surface', () => {
    const base = createLevelledBase(footprint(), (x: number) =>
      x < 0 ? slope(x) : null,
    )!;

    expect(base.metrics.coverage).toBeGreaterThan(0.3);
    expect(base.metrics.coverage).toBeLessThan(0.7);
    // Still a solid: the unknown half is carried at the mean of the known one.
    expect(heights(base.bottom!).every(Number.isFinite)).toBe(true);
  });

  it('builds nothing where there is no surface at all', () => {
    expect(createLevelledBase(footprint(), () => null)).toBeNull();
  });

  it('leaves the underside out when asked, and still measures the ground', () => {
    const base = createLevelledBase(footprint(), (x: number) => slope(x), {
      closed: false,
    })!;

    expect(base.bottom).toBeNull();
    expect(base.level).toBeCloseTo(base.metrics.max, 6);
  });
});
