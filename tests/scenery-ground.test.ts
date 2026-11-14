import proj4 from 'proj4';
import { Matrix3, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  earthFrame,
  groundLevelFrame,
  groundLevelFromWorld,
} from '../src/components/Scenery/scenery-ground';
import { conformalOffset } from '../src/sdk/projection/conformal-sphere';
import {
  getProjectionDefFromUtmZone,
  wgs84Def,
} from '../src/sdk/projection/crs';
import type { GeoFrame } from '../src/sdk/projection/geo-frame';
import { Globe } from '../src/sdk/projection/globe';

// The demo field's frame (UTM 31N), the stage's disc 8 km across about its origin.
const UTM31 = getProjectionDefFromUtmZone('31N');
const FRAME: GeoFrame = { projection: UTM31, origin: [434500, 6478000] };

const latLonAt = (x: number, z: number) => {
  const [lon, lat] = proj4(UTM31, wgs84Def, [
    FRAME.origin[0] + x,
    FRAME.origin[1] - z,
  ]);
  return { lat, lon };
};

// The map's texels across its side, as the scenery's fine level has.
const TEXELS = 512;

describe('SceneryGround: where a world point lies on its maps', () => {
  // ground-map.glsl's read, in 64-bit: from the Earth's centre, into the square.
  const across = (globe: Globe, fromWorld: Matrix3, p: Vector3) => {
    const q = p
      .clone()
      .sub(globe.discCentre)
      .addScaledVector(globe.up, globe.centreDepth);
    const v = q.applyMatrix3(fromWorld);
    return [v.x / v.z, v.y / v.z];
  };

  it('finds each point where the map drew its latitude and longitude, on the disc, past it and under the ground', () => {
    const globe = new Globe();
    globe.setDisc([-4000, -4000, 4000, 4000]);
    globe.setFrame(FRAME);
    globe.enabled = true;
    const origin = globe.conformalOrigin!;
    const toEarth = earthFrame(globe, new Matrix3());
    const toWorld = toEarth.clone().transpose();

    const middle = latLonAt(5000, -3000);
    const frame = groundLevelFrame(origin, middle.lat, middle.lon);
    const reach = 15000 / globe.radius;
    const fromWorld = groundLevelFromWorld(
      frame,
      reach,
      toWorld,
      new Matrix3(),
    );

    let worst = 0;
    let where = '';
    let worstTurn = 0;
    for (const [x, z, height] of [
      [0, 0, 0],
      [3000, -2500, 0],
      [5000, -3000, -80],
      [14000, 9000, 0],
      [-9000, -12000, -300],
    ]) {
      const { lat, lon } = latLonAt(x, z);
      const p = globe.geodetic(lat, lon, height, new Vector3());
      // Where the generator drew it (ground-terrain.glsl): its direction fixed on the Earth.
      const [offset, delta] = conformalOffset(origin, lat, lon);
      const chi = origin.sphere.chi0 + offset;
      const lambda = origin.longitude0 + delta;
      const d = new Vector3(
        Math.cos(chi) * Math.cos(lambda),
        Math.cos(chi) * Math.sin(lambda),
        Math.sin(chi),
      );
      const drawn = [
        d.dot(frame.east) / (d.dot(frame.centre) * reach),
        d.dot(frame.north) / (d.dot(frame.centre) * reach),
      ];
      const read = across(globe, fromWorld, p);
      const texels =
        Math.hypot(read[0] - drawn[0], read[1] - drawn[1]) * (TEXELS / 2);
      if (texels > worst) {
        worst = texels;
        where = `${x}, ${z}, ${height}`;
      }
      // The Earth's map, by direction.
      const q = p
        .clone()
        .sub(globe.discCentre)
        .addScaledVector(globe.up, globe.centreDepth)
        .applyMatrix3(toEarth)
        .normalize();
      worstTurn = Math.max(worstTurn, q.distanceTo(d));
    }
    expect(worst, `at ${where}`).toBeLessThan(0.01);
    expect(worstTurn).toBeLessThan(1e-9);
  });
});
