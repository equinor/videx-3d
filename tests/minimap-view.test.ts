import { describe, expect, it } from 'vitest';
import { cornerStyle } from '../src/common/corner-style';
import {
  geoFrameFromCrs,
  geoFrameLonLat,
} from '../src/sdk/projection/geo-frame';
import { CRS, getProjectionDefFromUtmZone } from '../src/sdk/projection/crs';
import {
  adaptiveMapExtent,
  altitudeRate,
  boostFactor,
  dropMarker,
  mapViewPan,
  moveAltitude,
  setMarkerAltitude,
  easeMapExtent,
  mapViewFromPixel,
  mapViewGrid,
  mapViewMetresPerPixel,
  mapViewToPixel,
  mapViewUp,
  niceScaleLength,
  rayAtSeaLevel,
  stepMapZoom,
  type MapView,
} from '../src/sdk/projection/map-view';

const view = (up: [number, number]): MapView => ({
  center: [1000, -2000],
  up,
  metresPerPixel: 5,
  size: [200, 100],
});

describe('cornerStyle', () => {
  it('anchors each corner, offset in from it', () => {
    expect(cornerStyle('top-left', [10, 20])).toEqual({
      left: '10px',
      top: '20px',
    });
    expect(cornerStyle('top-right', [10, 20])).toEqual({
      right: '10px',
      top: '20px',
    });
    expect(cornerStyle('bottom-left', [10, 20])).toEqual({
      left: '10px',
      bottom: '20px',
    });
    expect(cornerStyle('bottom-right', [10, 20])).toEqual({
      right: '10px',
      bottom: '20px',
    });
  });
});

describe('mapViewUp', () => {
  it('is north, -Z, for a north-up map whatever the camera does', () => {
    expect(mapViewUp('north-up', [1, 0, 0], [0, 1, 0])).toEqual([0, -1]);
  });

  it('follows the camera’s heading, flattened', () => {
    const [x, z] = mapViewUp('heading-up', [3, -4, 0], [0, 1, 0]);
    expect(x).toBeCloseTo(1);
    expect(z).toBeCloseTo(0);
  });

  it('takes the camera’s up when it looks straight down', () => {
    // Looking down with its top toward +X: the screen's top is east.
    const [x, z] = mapViewUp('heading-up', [0, -1, 0], [1, 0, 0]);
    expect(x).toBeCloseTo(1);
    expect(z).toBeCloseTo(0);
    // Looking straight up, the other way round.
    const [ux] = mapViewUp('heading-up', [0, 1, 0], [1, 0, 0]);
    expect(ux).toBeCloseTo(-1);
  });

  it('falls back to north for a degenerate camera', () => {
    expect(mapViewUp('heading-up', [0, -1, 0], [0, 1, 0])).toEqual([0, -1]);
  });
});

describe('mapView pixels', () => {
  it('puts the centre in the middle and east on the right, north-up', () => {
    const v = view([0, -1]);
    expect(mapViewToPixel(v, 1000, -2000)).toEqual([100, 50]);
    // 100 m east is 20 px right; 100 m north (−Z) is 20 px up.
    const east = mapViewToPixel(v, 1100, -2000);
    expect(east[0]).toBeCloseTo(120);
    expect(east[1]).toBeCloseTo(50);
    const north = mapViewToPixel(v, 1000, -2100);
    expect(north[0]).toBeCloseTo(100);
    expect(north[1]).toBeCloseTo(30);
  });

  it('puts what lies ahead up the screen, heading-up', () => {
    // Looking east: east is up, south (+Z) to the right.
    const v = view([1, 0]);
    const ahead = mapViewToPixel(v, 1100, -2000);
    expect(ahead[0]).toBeCloseTo(100);
    expect(ahead[1]).toBeCloseTo(30);
    const right = mapViewToPixel(v, 1000, -1900);
    expect(right[0]).toBeCloseTo(120);
    expect(right[1]).toBeCloseTo(50);
  });

  it('round trips from pixel to ground and back, at any heading', () => {
    const angle = 0.7;
    const v = view([Math.cos(angle), Math.sin(angle)]);
    for (const [c, r] of [
      [0, 0],
      [200, 100],
      [37, 81],
    ]) {
      const [x, z] = mapViewFromPixel(v, c, r);
      const [c2, r2] = mapViewToPixel(v, x, z);
      expect(c2).toBeCloseTo(c);
      expect(r2).toBeCloseTo(r);
    }
  });

  it('lays out a grid of the view’s corners, row by row from the top left', () => {
    const v = view([0, -1]);
    const grid = mapViewGrid(v, 2);
    expect(grid).toHaveLength(9);
    expect(grid[0]).toEqual(mapViewFromPixel(v, 0, 0));
    expect(grid[2]).toEqual(mapViewFromPixel(v, 200, 0));
    expect(grid[8]).toEqual(mapViewFromPixel(v, 200, 100));
  });

  it('spans the extent along the shorter side', () => {
    expect(mapViewMetresPerPixel(1000, [200, 100])).toBe(10);
    expect(mapViewMetresPerPixel(1000, [100, 400])).toBe(10);
  });
});

describe('zoom', () => {
  const extents = [1000, 5000, 25000, 100000];

  it('adapts to the camera’s height, within the range', () => {
    expect(adaptiveMapExtent(500, [1000, 100000], 4)).toBe(2000);
    expect(adaptiveMapExtent(10, [1000, 100000], 4)).toBe(1000);
    expect(adaptiveMapExtent(-50, [1000, 100000], 4)).toBe(1000);
    expect(adaptiveMapExtent(1e6, [1000, 100000], 4)).toBe(100000);
  });

  it('steps in and out from a level or from between two', () => {
    expect(stepMapZoom(extents, 5000, 1)).toBe(0);
    expect(stepMapZoom(extents, 5000, -1)).toBe(2);
    // An adaptive extent lies between levels: in goes to the next below, out above.
    expect(stepMapZoom(extents, 8000, 1)).toBe(1);
    expect(stepMapZoom(extents, 8000, -1)).toBe(2);
    // The ends hold.
    expect(stepMapZoom(extents, 1000, 1)).toBe(0);
    expect(stepMapZoom(extents, 100000, -1)).toBe(3);
    expect(stepMapZoom(extents, 400, 1)).toBe(0);
  });

  it('eases a ratio the same way in either direction, and snaps home', () => {
    const out = easeMapExtent(1000, 4000, 0.1, 0.25);
    const back = easeMapExtent(4000, 1000, 0.1, 0.25);
    expect(out / 1000).toBeCloseTo(4000 / back);
    expect(out).toBeGreaterThan(1000);
    expect(out).toBeLessThan(4000);
    expect(easeMapExtent(1000, 1000.5, 0.1, 0.25)).toBe(1000.5);
    expect(easeMapExtent(1000, 4000, 0.1, 0)).toBe(4000);
  });
});

describe('dropMarker', () => {
  const camera: [number, number, number] = [100, 3000, 200];
  const target: [number, number, number] = [150, -80, 50];

  it('re-aims the camera: only the target moves, at the height it has', () => {
    const dropped = dropMarker('target', camera, target, [900, -400]);
    expect(dropped.camera).toEqual(camera);
    expect(dropped.target).toEqual([900, -80, -400]);
  });

  it('flies the camera: it takes its target along, both at their heights', () => {
    const dropped = dropMarker('camera', camera, target, [1100, 700]);
    expect(dropped.camera).toEqual([1100, 3000, 700]);
    expect(dropped.target).toEqual([1150, -80, 550]);
  });

  it('leaves what it is given alone', () => {
    dropMarker('camera', camera, target, [0, 0]);
    expect(camera).toEqual([100, 3000, 200]);
    expect(target).toEqual([150, -80, 50]);
  });
});

describe('altitude control', () => {
  it('is pulled further, the more the further it goes: a quadratic response past a dead zone', () => {
    expect(altitudeRate(0, 100)).toBe(0);
    expect(altitudeRate(4, 100)).toBe(0);
    expect(altitudeRate(-3, 100)).toBe(0);
    const half = altitudeRate(4 + 96 / 2, 100);
    expect(half).toBeCloseTo(0.25);
    // Not twice as hard for twice as far.
    expect(altitudeRate(4 + 96 / 4, 100)).toBeCloseTo(0.0625);
    expect(altitudeRate(4 + 96 * 0.9, 100)).toBeGreaterThan(half);
  });

  it('tops out at the drag range, either way, up positive', () => {
    expect(altitudeRate(100, 100)).toBe(1);
    expect(altitudeRate(5000, 100)).toBe(1);
    expect(altitudeRate(-100, 100)).toBe(-1);
    expect(altitudeRate(-30, 100)).toBeLessThan(0);
    expect(altitudeRate(30, 3)).toBe(0);
  });
});

describe('boostFactor', () => {
  it('is 1 until the knob has been held, then doubles every doubling time', () => {
    expect(boostFactor(0, 1, 200)).toBe(1);
    expect(boostFactor(-1, 1, 200)).toBe(1);
    expect(boostFactor(1, 1, 200)).toBe(2);
    expect(boostFactor(3, 1, 200)).toBe(8);
    expect(boostFactor(3, 1.5, 200)).toBe(4);
  });

  it('stops at its most', () => {
    expect(boostFactor(60, 1, 200)).toBe(200);
    expect(boostFactor(10, 1, 1)).toBe(1);
  });

  it('is no boost for a doubling time that is nothing', () => {
    expect(boostFactor(5, 0, 200)).toBe(1);
  });
});

describe('moveAltitude', () => {
  const range: [number, number] = [-5000, 50000];

  it('moves in a straight line at the velocity, the same at any height', () => {
    for (const height of [-3000, -20, 0, 40, 9000]) {
      expect(moveAltitude(height, 100, 0.5, range)).toBeCloseTo(height + 50);
      expect(moveAltitude(height, -100, 0.5, range)).toBeCloseTo(height - 50);
    }
  });

  it('stands still at velocity 0', () => {
    expect(moveAltitude(500, 0, 0.1, range)).toBe(500);
  });

  it('stays in the range', () => {
    expect(moveAltitude(49990, 100, 1, range)).toBe(50000);
    expect(moveAltitude(-4990, -100, 1, range)).toBe(-5000);
  });

  it('lets a height outside the range come back, and go no further out', () => {
    expect(moveAltitude(400000, 1000, 1, range)).toBe(400000);
    expect(moveAltitude(400000, -1000, 1, range)).toBe(399000);
    expect(moveAltitude(-9000, -100, 1, range)).toBe(-9000);
    expect(moveAltitude(-9000, 100, 1, range)).toBe(-8900);
  });
});

describe('setMarkerAltitude', () => {
  const camera: [number, number, number] = [100, 3000, 200];
  const target: [number, number, number] = [150, -80, 50];

  it('moves the camera with its target along, and the target alone', () => {
    // 3000 -> 500: the target comes 2500 down too, at the same offset from the camera.
    expect(setMarkerAltitude('camera', camera, target, 500)).toEqual({
      camera: [100, 500, 200],
      target: [150, -2580, 50],
    });
    expect(setMarkerAltitude('target', camera, target, -2000)).toEqual({
      camera,
      target: [150, -2000, 50],
    });
  });

  it('keeps the camera’s view whatever the height', () => {
    const moved = setMarkerAltitude('camera', camera, target, -75);
    for (let i = 0; i < 3; i++)
      expect(moved.target[i] - moved.camera[i]).toBeCloseTo(
        target[i] - camera[i],
      );
  });
});

describe('mapViewPan', () => {
  it('moves the map’s centre against the pointer, north-up', () => {
    const v = view([0, -1]);
    // Dragged 20 px right and 10 px down: the map goes with it, its centre 100 m west, 50 m north.
    const [x, z] = mapViewPan(v, 20, 10);
    expect(x).toBeCloseTo(1000 - 100);
    expect(z).toBeCloseTo(-2000 - 50);
  });

  it('follows the map’s turn', () => {
    // Heading east: a drag to the right moves what is south of the centre toward it, so the
    // centre goes north.
    const [x, z] = mapViewPan(view([1, 0]), 20, 0);
    expect(x).toBeCloseTo(1000);
    expect(z).toBeCloseTo(-2000 - 100);
  });

  it('is no move for no drag', () => {
    expect(mapViewPan(view([0, -1]), 0, 0)).toEqual([1000, -2000]);
  });
});

describe('scale bar', () => {
  it('picks the longest 1, 2 or 5 x 10^n that fits', () => {
    expect(niceScaleLength(10, 55).metres).toBe(500);
    expect(niceScaleLength(10, 25).metres).toBe(200);
    expect(niceScaleLength(10, 12).metres).toBe(100);
    expect(niceScaleLength(10, 99).metres).toBe(500);
    expect(niceScaleLength(0.5, 40).metres).toBe(20);
    expect(niceScaleLength(1000, 55).metres).toBe(50000);
  });

  it('gives its length in pixels at that scale, never over the target', () => {
    for (const [mpp, target] of [
      [3.3, 60],
      [125, 55],
      [4000, 70],
    ]) {
      const { metres, pixels } = niceScaleLength(mpp, target);
      expect(pixels).toBeCloseTo(metres / mpp);
      expect(pixels).toBeLessThanOrEqual(target + 1e-9);
      expect(pixels).toBeGreaterThan(target / 2.5 - 1e-9);
    }
  });
});

describe('rayAtSeaLevel', () => {
  it('meets the sea where the ray does', () => {
    // 100 m up, looking 45° down toward +X: 100 m east.
    const [x, z] = rayAtSeaLevel([10, 100, 20], [1, -1, 0], 0);
    expect(x).toBeCloseTo(110);
    expect(z).toBeCloseTo(20);
  });

  it('measures from the level, not from Y = 0', () => {
    const [x] = rayAtSeaLevel([0, 150, 0], [0, -1, 1], 50);
    expect(x).toBeCloseTo(0);
    expect(rayAtSeaLevel([0, 150, 0], [0, -1, 1], 50)[1]).toBeCloseTo(100);
  });

  it('stays at the camera for a ray straight down, level or up', () => {
    expect(rayAtSeaLevel([5, 100, 7], [0, -1, 0], 0)).toEqual([5, 7]);
    expect(rayAtSeaLevel([5, 100, 7], [1, 0, 0], 0)).toEqual([5, 7]);
    expect(rayAtSeaLevel([5, 100, 7], [1, 1, 0], 0)).toEqual([5, 7]);
    // Under the sea, too.
    expect(rayAtSeaLevel([5, -100, 7], [1, -1, 0], 0)).toEqual([5, 7]);
  });

  it('goes no farther than the cap along a grazing ray', () => {
    const [x, z] = rayAtSeaLevel([0, 100, 0], [1, -0.0001, 0], 0, 50000);
    expect(x).toBeCloseTo(50000);
    expect(z).toBeCloseTo(0);
  });
});

describe('geoFrameLonLat', () => {
  it('converts the frame’s X/Z to longitude and latitude, X east and Z south', () => {
    const crs = new CRS(
      getProjectionDefFromUtmZone('31N'),
      [500000, 6500000],
      'utm',
    );
    const frame = geoFrameFromCrs(crs);
    const toLonLat = geoFrameLonLat(frame);
    const [lon0, lat0] = toLonLat(0, 0);
    // The central meridian of zone 31 is 3°E, give or take the datum shift.
    expect(lon0).toBeCloseTo(3, 2);
    expect(toLonLat(5000, 0)[0]).toBeGreaterThan(lon0);
    expect(toLonLat(0, -5000)[1]).toBeGreaterThan(lat0);
    expect(toLonLat(0, 5000)[1]).toBeLessThan(lat0);
  });

  it('honours the frame’s offset', () => {
    const crs = new CRS(
      getProjectionDefFromUtmZone('31N'),
      [500000, 6500000],
      'utm',
    );
    const plain = geoFrameLonLat(geoFrameFromCrs(crs));
    const shifted = geoFrameLonLat(geoFrameFromCrs(crs, [100, 200]));
    expect(shifted(100, 200)).toEqual(plain(0, 0));
  });
});
