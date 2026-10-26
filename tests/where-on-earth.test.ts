import proj4 from 'proj4';
import { describe, expect, it } from 'vitest';
import { reliefFrameFromCrs } from '../src/sdk/geometries/relief-grid';
import {
  CRS,
  crsOriginLocation,
  getProjectionDefFromUtmZone,
  wgs84Def,
} from '../src/sdk/projection/crs';

// The demo field (story-args.json): UTM 31N.
const utmDef = getProjectionDefFromUtmZone('31N');
const crs = new CRS(utmDef, [434500, 6478000], 'utm');

describe('crsOriginLocation', () => {
  it('gives the origin in degrees north and east', () => {
    const { latitude, longitude } = crsOriginLocation(crs);
    expect(latitude).toBeCloseTo(58.4359, 4);
    expect(longitude).toBeCloseTo(1.8766, 4);
  });

  it('gives back an origin given in longitude and latitude', () => {
    const place = crsOriginLocation(new CRS(utmDef, [2.5, 59.25], 'lnglat'));
    expect(place).toEqual({ latitude: 59.25, longitude: 2.5 });
  });
});

describe('reliefFrameFromCrs', () => {
  it('takes the CRS projection and origin', () => {
    const frame = reliefFrameFromCrs(crs);
    expect(frame.projection).toBe(utmDef);
    expect(frame.origin).toEqual(crs.originUtm);
    expect(frame.origin).not.toBe(crs.originUtm);
    expect(frame.offset).toBeUndefined();
    expect(reliefFrameFromCrs(crs, [10, -20]).offset).toEqual([10, -20]);
  });

  it('places a point where the CRS places it', () => {
    const frame = reliefFrameFromCrs(crs);
    const [lng, lat] = [2.9, 58.1];
    const world = crs.wgs84ToWorld(lng, lat);
    // Scene X runs east and Z south of the frame's origin.
    const [e, n] = proj4(wgs84Def, frame.projection, [lng, lat]);
    expect(e - frame.origin[0]).toBeCloseTo(world.x, 6);
    expect(frame.origin[1] - n).toBeCloseTo(world.z, 6);
  });
});
