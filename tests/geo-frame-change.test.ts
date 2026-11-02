import proj4 from 'proj4';
import { Matrix4, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { getProjectionDefFromUtmZone } from '../src/sdk/projection/crs';
import { GeoFrame, placeGeoFrame } from '../src/sdk/projection/geo-frame';
import { Globe } from '../src/sdk/projection/globe';
import {
  geoFrameChangeMatrix,
  geoFrameMatrix,
  globeCarry,
} from '../src/sdk/projection/place-frame';

// The demo field (UTM 31N) and a field over the Norwegian Trench, 123 km east in UTM 32N, as
// the WorldFields story has them: a 16 km stage about Volve, one of Troll's size there.
const utm31 = getProjectionDefFromUtmZone('31N');
const utm32 = getProjectionDefFromUtmZone('32N');
const volve: GeoFrame = { projection: utm31, origin: [434500, 6478000] };
const trench: GeoFrame = {
  projection: utm32,
  origin: proj4(utm31, utm32, [434500 + 123000, 6478000 + 7000]).map(
    Math.round,
  ) as [number, number],
};
const VOLVE_STAGE: [number, number, number, number] = [
  -8000, -8000, 8000, 8000,
];
const TRENCH_STAGE: [number, number, number, number] = [
  -13500, -13500, 13500, 13500,
];

// A World's globe, lying in `frame` and cut flat over `disc`.
const lying = (frame: GeoFrame, disc: [number, number, number, number]) => {
  const g = new Globe();
  g.setFrame(frame);
  g.setDisc(disc);
  return g;
};

// The globe before and after anchoring the trench field instead of Volve.
const switched = () => {
  const before = lying(volve, VOLVE_STAGE);
  const after = before.clone();
  after.setFrame(trench);
  after.setDisc(TRENCH_STAGE);
  return { before, after };
};

// Where `frame`'s field is placed in a World lying in `world`, on `globe`.
const placed = (frame: GeoFrame, world: GeoFrame, globe: Globe | null) =>
  geoFrameMatrix(placeGeoFrame(frame, world), globe, new Matrix4());

// Points 5 km around a field's middle, in its own X/Z.
const ring = (r = 5000) =>
  Array.from({ length: 16 }, (_, k) => {
    const a = (k / 16) * 2 * Math.PI;
    return new Vector3(r * Math.cos(a), 0, r * Math.sin(a));
  });

describe('Globe.clone', () => {
  it('places as the globe it was taken from, and is a globe of its own', () => {
    const g = lying(volve, VOLVE_STAGE);
    g.level = 7;
    const copy = g.clone();
    for (const [x, z] of [
      [0, 0],
      [7000, -3000],
      [123000, -7000],
      [-400000, 250000],
    ]) {
      const a = g.place(x, z, 30, new Vector3());
      const b = copy.place(x, z, 30, new Vector3());
      expect(b.distanceTo(a)).toBe(0);
    }
    expect(copy.radius).toBe(g.radius);
    copy.setFrame(trench);
    expect(g.frame).toBe(volve);
  });
});

describe('placeGeoFrame about a pivot', () => {
  it('in the same map, only moves, exactly, and leaves the pivot of the same frame where it is', () => {
    const near: GeoFrame = {
      projection: utm31,
      origin: [volve.origin[0] + 3000, volve.origin[1] - 4000],
    };
    const p = placeGeoFrame(near, volve, [500, -200]);
    expect(p).toEqual({
      x: 3500,
      z: 3800,
      rotation: 0,
      scale: 1,
      pivot: [500, -200],
    });
    const m = geoFrameMatrix(p, null, new Matrix4());
    expect(new Vector3(123.25, 7, -45.5).applyMatrix4(m).toArray()).toEqual([
      3123.25, 7, 3954.5,
    ]);
    // What `UtmArea` takes for not placed at all.
    const own = placeGeoFrame(volve, volve, [1234.5, -678.25]);
    expect([own.x, own.z]).toEqual([1234.5, -678.25]);
  });

  it('in another zone, is placed best about the pivot', () => {
    // A field whose origin lies 8 km west of its stage's middle.
    const field: GeoFrame = {
      projection: utm32,
      origin: [trench.origin[0] - 8000, trench.origin[1]],
    };
    const truth = (e: number, n: number) => {
      const [x, y] = proj4(utm32, utm31, [
        field.origin[0] + e,
        field.origin[1] + n,
      ]);
      return new Vector3(x - volve.origin[0], 0, volve.origin[1] - y);
    };
    // The worst miss 5 km around the stage's middle (8000, 0).
    const miss = (m: Matrix4) =>
      Math.max(
        ...ring().map(p =>
          new Vector3(8000 + p.x, 0, p.z)
            .applyMatrix4(m)
            .distanceTo(truth(8000 + p.x, -p.z)),
        ),
      );
    const atOrigin = miss(placed(field, volve, null));
    const atPivot = miss(
      geoFrameMatrix(
        placeGeoFrame(field, volve, [8000, 0]),
        null,
        new Matrix4(),
      ),
    );
    // Measured: 0.72 m against 0.11 m, the maps' second order from where it is measured.
    expect(atOrigin).toBeGreaterThan(0.5);
    expect(atPivot).toBeLessThan(0.15);
  });

  it('on the globe, sets the pivot on the ground there, upright', () => {
    const g = lying(volve, VOLVE_STAGE);
    const p = placeGeoFrame(trench, volve, [6000, -2000]);
    const m = geoFrameMatrix(p, g, new Matrix4());
    const ground = g.place(p.x, p.z, 0, new Vector3());
    expect(
      new Vector3(6000, 0, -2000).applyMatrix4(m).distanceTo(ground),
    ).toBeLessThan(1e-6);
    const up = g.upAt(ground, new Vector3());
    expect(new Vector3(0, 1, 0).transformDirection(m).angleTo(up)).toBeLessThan(
      1e-9,
    );
  });
});

describe('geoFrameChangeMatrix', () => {
  it('is the identity for the same frame, and moves by a new offset', () => {
    const g = lying(volve, VOLVE_STAGE);
    expect(
      geoFrameChangeMatrix(volve, volve, g, new Matrix4()).equals(
        new Matrix4(),
      ),
    ).toBe(true);
    expect(
      geoFrameChangeMatrix(
        volve,
        { ...volve, offset: [5, -7] },
        g,
        new Matrix4(),
      ).equals(new Matrix4().makeTranslation(5, 0, -7)),
    ).toBe(true);
  });

  it("carries the new field's own content to where it is drawn once anchored", () => {
    const { before } = switched();
    const m = geoFrameChangeMatrix(volve, trench, before, new Matrix4());
    const there = placed(trench, volve, before);
    for (const own of ring()) {
      const carried = own.clone().applyMatrix4(there).applyMatrix4(m);
      expect(carried.distanceTo(own)).toBeLessThan(1e-6);
    }
  });

  it('far from the new field, is an affine fit: tens of metres off 123 km away', () => {
    const { before, after } = switched();
    const m = geoFrameChangeMatrix(volve, trench, before, new Matrix4());
    // A camera 500 m over Volve's middle; measured 462.6 m over the sea after, its foot
    // 0.56 m from Volve's middle.
    const camera = new Vector3(0, 500, 0).applyMatrix4(m);
    const volveMiddle = new Vector3().applyMatrix4(
      placed(volve, trench, after),
    );
    expect(Math.abs(after.altitude(camera) - 500)).toBeGreaterThan(20);
    expect(Math.abs(after.altitude(camera) - 500)).toBeLessThan(60);
    expect(
      after
        .foot(camera, new Vector3())
        .distanceTo(after.foot(volveMiddle, new Vector3())),
    ).toBeLessThan(1);
  });
});

describe('globeCarry', () => {
  it('carries a camera over the old field by where it is on the Earth, at any distance', () => {
    const { before, after } = switched();
    const carry = globeCarry(before, after);
    const camera = carry.point(new Vector3(0, 500, 0), new Vector3());
    const volveMiddle = new Vector3().applyMatrix4(
      placed(volve, trench, after),
    );
    expect(after.altitude(camera)).toBeCloseTo(500, 6);
    expect(
      after
        .foot(camera, new Vector3())
        .distanceTo(after.foot(volveMiddle, new Vector3())),
    ).toBeLessThan(0.01);
  });

  it('carries the up there to the up there, and back again', () => {
    const { before, after } = switched();
    const at = new Vector3(2000, 300, -1500);
    const there = globeCarry(before, after).point(at, new Vector3());
    const up = globeCarry(before, after).direction(
      new Vector3(0, 1, 0),
      at,
      new Vector3(),
    );
    expect(up.angleTo(after.upAt(there, new Vector3()))).toBeLessThan(1e-4);
    const back = globeCarry(after, before).point(there, new Vector3());
    expect(back.distanceTo(at)).toBeLessThan(1e-3);
  });

  it('may write a point onto itself', () => {
    const { before, after } = switched();
    const p = new Vector3(1000, 200, 1000);
    const apart = globeCarry(before, after).point(p, new Vector3());
    expect(globeCarry(before, after).point(p, p).distanceTo(apart)).toBe(0);
  });
});
