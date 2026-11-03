import proj4 from 'proj4';
import { describe, expect, it } from 'vitest';
import {
  getProjectionDefFromUtmZone,
  getUtmZoneFromLatLng,
  wgs84Def,
} from '../src/sdk/projection/crs';
import {
  GeoFrame,
  placeGeoPoint,
  placeMapPoint,
} from '../src/sdk/projection/geo-frame';

// Volve, in the North Sea: zone 31N.
const VOLVE: [number, number] = [1.887, 58.441];

describe('getProjectionDefFromUtmZone', () => {
  it('keeps ED50 the default, its definition as it was', () => {
    expect(getProjectionDefFromUtmZone('31N')).toBe(
      '+proj=utm +zone=31 +ellps=intl +towgs84=-87,-98,-121,0,0,0,0 +units=m +no_defs',
    );
    expect(getProjectionDefFromUtmZone('31N', 'ED50')).toBe(
      getProjectionDefFromUtmZone('31N'),
    );
  });

  it('takes a datum: the same place is some 200 m apart between ED50 and WGS84', () => {
    const ed50 = proj4(wgs84Def, getProjectionDefFromUtmZone('31N'), VOLVE);
    const wgs84 = proj4(
      wgs84Def,
      getProjectionDefFromUtmZone('31N', 'WGS84'),
      VOLVE,
    );
    const etrs89 = proj4(
      wgs84Def,
      getProjectionDefFromUtmZone('31N', 'ETRS89'),
      VOLVE,
    );
    const apart = Math.hypot(ed50[0] - wgs84[0], ed50[1] - wgs84[1]);
    expect(apart).toBeGreaterThan(150);
    expect(apart).toBeLessThan(300);
    expect(Math.hypot(etrs89[0] - wgs84[0], etrs89[1] - wgs84[1])).toBeLessThan(
      1e-3,
    );
    // A shift of one's own: the published 7-parameter ED50 one, a few metres from the default.
    const own = proj4(
      wgs84Def,
      getProjectionDefFromUtmZone('31N', {
        ellps: 'intl',
        towgs84: [-90.365, -101.13, -123.384, 0.333, 0.077, 0.894, 1.994],
      }),
      VOLVE,
    );
    const off = Math.hypot(own[0] - ed50[0], own[1] - ed50[1]);
    expect(off).toBeGreaterThan(0.5);
    expect(off).toBeLessThan(10);
  });

  it('reads one-digit zones and the southern hemisphere, and throws for anything else', () => {
    expect(getProjectionDefFromUtmZone('5S', 'WGS84')).toBe(
      '+proj=utm +zone=5 +south +datum=WGS84 +units=m +no_defs',
    );
    expect(getProjectionDefFromUtmZone('05n')).toContain('+zone=5 ');
    // What getUtmZoneFromLatLng gives, it takes.
    const zone = getUtmZoneFromLatLng([-153, -20]);
    expect(zone).toBe('5S');
    expect(() => getProjectionDefFromUtmZone(zone)).not.toThrow();
    for (const bad of ['', '61N', '0N', '31X', 'N31'])
      expect(() => getProjectionDefFromUtmZone(bad)).toThrow(
        'is not a UTM zone',
      );
  });
});

describe('placeMapPoint', () => {
  const scene: GeoFrame = {
    projection: getProjectionDefFromUtmZone('31N', 'WGS84'),
    origin: proj4(
      wgs84Def,
      getProjectionDefFromUtmZone('31N', 'WGS84'),
      VOLVE,
    ) as [number, number],
  };

  it('in the scene’s own map only moves, exactly', () => {
    const [e, n] = scene.origin;
    const placed = placeMapPoint(
      scene.projection,
      e + 1234.5,
      n - 678.25,
      scene,
    );
    expect(placed).toEqual({ x: 1234.5, z: 678.25, rotation: 0, scale: 1 });
  });

  it('in the next zone, lands where longitude and latitude do, turned to that grid', () => {
    const utm32 = getProjectionDefFromUtmZone('32N', 'WGS84');
    const point: [number, number] = [3.2, 58.9];
    const [e, n] = proj4(wgs84Def, utm32, point);
    const byMap = placeMapPoint(utm32, e, n, scene);
    const byLonLat = placeGeoPoint(point[0], point[1], scene);
    expect(byMap.x).toBeCloseTo(byLonLat.x, 6);
    expect(byMap.z).toBeCloseTo(byLonLat.z, 6);
    // Zone 32's grid north is turned from true north there by its convergence, 3° or so at
    // 58.9°N and 5.8° west of its central meridian; true north (placeGeoPoint) by zone 31's.
    const convergence = (byMap.rotation - byLonLat.rotation) * (180 / Math.PI);
    expect(Math.abs(convergence)).toBeGreaterThan(4);
    expect(Math.abs(convergence)).toBeLessThan(6);
    expect(byMap.scale).toBeCloseTo(1, 2);
  });
});
