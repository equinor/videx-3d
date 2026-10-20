import { describe, expect, it } from 'vitest';
import { BufferAttribute, BufferGeometry } from 'three';
import {
  createSkyStageBand,
  createSkyStageGeometry,
  createSkyStageRelief,
  SkyStageBounds,
} from '../src/components/Sky/sky-stage';
import {
  PlanarPolygonCoordinates,
  PlanarPolygonGeometry,
} from '../src/sdk/geometries/planar-geometry';
import { pointInPolygon } from '../src/sdk/geometries/polygon-outline';

const BED_Y = -100;
const near: SkyStageBounds = [-6000, -6000, 6000, 6000];
const ring: [number, number][] = [];
for (let j = 0; j < 96; j++) {
  const a = (j / 96) * Math.PI * 2;
  const r = 3000 * (1 + 0.2 * Math.sin(3 * a));
  ring.push([r * Math.cos(a), r * Math.sin(a)]);
}
const outline = new PlanarPolygonGeometry([[ring]] as PlanarPolygonCoordinates);
const heightAt = (x: number, z: number) => BED_Y + 0.01 * x - 0.005 * z;
const elevations = [[ring.map(([x, z]) => heightAt(x, z))]];

const key = (x: number, z: number) =>
  `${Math.fround(x).toFixed(3)},${Math.fround(z).toFixed(3)}`;

/** The vertices on edges used by exactly one triangle. */
const boundary = (geometry: BufferGeometry) => {
  const index = geometry.getIndex()!.array;
  const p = geometry.getAttribute('position') as BufferAttribute;
  const counts = new Map<string, number>();
  for (let i = 0; i < index.length; i += 3) {
    for (let e = 0; e < 3; e++) {
      const a = index[i + e];
      const b = index[i + ((e + 1) % 3)];
      const k = a < b ? `${a}_${b}` : `${b}_${a}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }
  const vertices = new Map<string, number>();
  for (const [k, n] of counts) {
    if (n !== 1) continue;
    for (const v of k.split('_').map(Number)) {
      vertices.set(key(p.getX(v), p.getZ(v)), p.getY(v));
    }
  }
  return vertices;
};

const onRectangle = ([x, z]: number[]) =>
  [x - near[0], z - near[1], near[2] - x, near[3] - z].some(
    d => Math.abs(d) < 1e-3,
  );

describe('sky stage caps', () => {
  it('⭐ the relief meets the walls at the elevations and the far rings at the bed', () => {
    const relief = createSkyStageRelief(near, outline, elevations, BED_Y, 2000);
    const rim = boundary(relief);
    for (const [x, z] of ring) {
      expect(rim.get(key(x, z))).toBeCloseTo(heightAt(x, z), 3);
    }
    for (const [at, y] of rim) {
      const [x, z] = at.split(',').map(Number);
      if (ring.some(p => key(p[0], p[1]) === at)) continue;
      // anything else on its boundary lies on the near rectangle, at the bed
      expect(onRectangle([x, z])).toBe(true);
      expect(y).toBeCloseTo(BED_Y, 3);
    }
  });

  it('the flat near cap keeps the same rim', () => {
    const { near: cap } = createSkyStageGeometry(
      near,
      [-50000, -50000, 50000, 50000],
      outline,
    );
    const rim = boundary(cap);
    for (const [x, z] of ring) expect(rim.has(key(x, z))).toBe(true);
    for (const at of rim.keys()) {
      if (ring.some(p => key(p[0], p[1]) === at)) continue;
      expect(onRectangle(at.split(',').map(Number))).toBe(true);
    }
  });

  it('the band starts on the outline at the elevations, fully shown, and fades inward', () => {
    const coordinates = outline.coordinates as PlanarPolygonCoordinates;
    const band = createSkyStageBand(
      outline,
      elevations,
      (x, z) => (pointInPolygon(x, z, coordinates) ? heightAt(x, z) : null),
      500,
    )!;
    const p = band.getAttribute('position') as BufferAttribute;
    const fade = band.getAttribute('fade') as BufferAttribute;
    const fadeAt = new Map<string, number>();
    for (let v = 0; v < p.count; v++) {
      fadeAt.set(key(p.getX(v), p.getZ(v)), fade.getX(v));
    }
    const rim = boundary(band);
    for (const [x, z] of ring) {
      expect(rim.get(key(x, z))).toBeCloseTo(heightAt(x, z), 3);
      expect(fadeAt.get(key(x, z))).toBe(1);
    }
    const index = band.getIndex()!.array;
    for (let i = 0; i < index.length; i += 3) {
      const shown = [0, 1, 2].some(k => fade.getX(index[i + k]) > 0);
      expect(shown).toBe(true);
    }
  });
});
