import { describe, expect, it } from 'vitest';
import {
  geoMapHeading,
  geoMapKindFor,
  geoMapNorthAngle,
  geoMapView,
  geoMapViewMoved,
  lonLatDelta,
  offsetLonLat,
  type GeoMapKind,
} from '../src/components/Html/GeoMap/geo-map-view';
import { geoMapTileSlots } from '../src/components/Html/GeoMap/geo-map-renderer';
import { layerExtentVisibilityAt } from '../src/sdk/layers/layer-visibility';
import {
  lonLatBoxesMeet,
  MapLabelSpacer,
  mapClipRect,
  mapPathData,
  mapViewGeoLine,
  mapViewGeoPixel,
  mapViewLonLatBox,
} from '../src/sdk/layers/map-draw';
import {
  mapViewLonLatAt,
  mapViewLonLatToPixel,
  mapViewToPixel,
  type MapView,
} from '../src/sdk/projection/map-view';
import type { Vec2 } from '../src/sdk/types/common';

// A scene of 100 km a degree, about 0°, 0°: X east, Z south.
const toLonLat = (x: number, z: number): Vec2 => [x / 1e5, -z / 1e5];
const toXZ = (lon: number, lat: number): Vec2 => [lon * 1e5, -lat * 1e5];

const input = (kind: GeoMapKind, lonLat: Vec2 = [2, 58], extent = 200000) => ({
  lonLat,
  extent,
  size: [400, 200] as Vec2,
  rotation: 0,
  upScene: null,
  kind,
  toLonLat,
  toXZ,
  lambertParallels: null,
});

describe('geoMapView', () => {
  it('draws its longitude and latitude at the middle, in every projection', () => {
    for (const kind of [
      'scene',
      'web-mercator',
      'equal-earth',
      'lambert-conformal-conic',
    ] as const) {
      const view = geoMapView(input(kind));
      const [c, r] = mapViewLonLatToPixel(view, 2, 58, toXZ);
      expect(c).toBeCloseTo(200, 6);
      expect(r).toBeCloseTo(100, 6);
      // Its extent across the shorter side.
      expect(view.metresPerPixel).toBeCloseTo(1000, 9);
      expect(view.lonLat).toEqual([2, 58]);
    }
  });

  it('is drawn about a longitude far from the scene, where the scene’s map does not reach', () => {
    const view = geoMapView(input('web-mercator', [150, -33], 2e6));
    expect(view.projected?.plane.meridian).toBe(150);
    const [lon, lat] = mapViewLonLatAt(view, 200, 100, toLonLat);
    expect(lon).toBeCloseTo(150, 6);
    expect(lat).toBeCloseTo(-33, 6);
  });

  it('turns its north by the rotation, clockwise', () => {
    const view = geoMapView({ ...input('scene'), rotation: Math.PI / 2 });
    // East up: a point east of the middle lies above it.
    const [c, r] = mapViewToPixel(view, ...toXZ(2.5, 58));
    expect(c).toBeCloseTo(200, 6);
    expect(r).toBeLessThan(100);
    expect(geoMapNorthAngle(view)).toBeCloseTo(-Math.PI / 2, 9);
  });

  it('points the scene’s direction up, carried into a projection', () => {
    const view = geoMapView({ ...input('equal-earth'), upScene: [1, 0] });
    expect(view.up[0]).toBeGreaterThan(0.95);
  });
});

describe('geoMapKindFor', () => {
  it('goes global from the extent given, and back only well under it', () => {
    const at = (extent: number, was: GeoMapKind | null) =>
      geoMapKindFor('auto', extent, 'equal-earth', 2e6, was);
    expect(at(1.9e6, 'scene')).toBe('scene');
    expect(at(2e6, 'scene')).toBe('equal-earth');
    expect(at(1.7e6, 'equal-earth')).toBe('equal-earth');
    expect(at(1.5e6, 'equal-earth')).toBe('scene');
    expect(geoMapKindFor('scene', 5e7, 'equal-earth', 2e6, null)).toBe('scene');
  });
});

describe('geoMapViewMoved', () => {
  const view = geoMapView(input('scene'));

  it('holds still for less than a quarter pixel, and moves past it', () => {
    expect(geoMapViewMoved(null, view)).toBe(true);
    // 100 m is a tenth of a pixel at 1 km a pixel.
    const near = geoMapView(input('scene', [2 + 0.1 / 111.2, 58]));
    expect(geoMapViewMoved(view, near)).toBe(false);
    const far = geoMapView(input('scene', [2.05, 58]));
    expect(geoMapViewMoved(view, far)).toBe(true);
  });

  it('moves for a new scale, size or projection', () => {
    expect(
      geoMapViewMoved(view, geoMapView(input('scene', [2, 58], 210000))),
    ).toBe(true);
    expect(geoMapViewMoved(view, geoMapView(input('web-mercator')))).toBe(true);
    expect(geoMapViewMoved(view, { ...view, size: [401, 200] })).toBe(true);
  });
});

describe('geoMapHeading', () => {
  it('is the heading clockwise from the map’s up', () => {
    const view = geoMapView(input('scene'));
    const at = toXZ(2, 58);
    expect(geoMapHeading(view, at, [0, -1])).toBeCloseTo(0, 9);
    expect(geoMapHeading(view, at, [1, 0])).toBeCloseTo(Math.PI / 2, 9);
    const turned = geoMapView({ ...input('scene'), rotation: Math.PI / 2 });
    expect(geoMapHeading(turned, at, [1, 0])).toBeCloseTo(0, 9);
  });

  it('carries the heading into a projection', () => {
    const view = geoMapView(input('web-mercator'));
    expect(geoMapHeading(view, toXZ(2, 58), [1, 0])).toBeCloseTo(
      Math.PI / 2,
      2,
    );
  });
});

describe('offsetLonLat and lonLatDelta', () => {
  it('go the short way round, across the antimeridian', () => {
    expect(lonLatDelta([179, 0], [-179, 1])).toEqual([2, 1]);
    expect(offsetLonLat([179, 0], [2, 1])).toEqual([-179, 1]);
    expect(offsetLonLat([0, 89], [0, 5])[1]).toBe(90);
  });
});

describe('geoMapTileSlots', () => {
  it('is 512 for a small map, more for a large one, within the GPU’s limit', () => {
    expect(geoMapTileSlots(220, 220, 2, 2)).toBe(512);
    const large = geoMapTileSlots(1920, 1080, 1, 2);
    expect(large).toBeGreaterThan(512);
    expect(large).toBeLessThanOrEqual(2048);
    expect(geoMapTileSlots(1920, 1080, 2, 2, 1024)).toBe(1024);
    // Coarser cells, fewer tiles.
    expect(geoMapTileSlots(1920, 1080, 1, 8)).toBe(512);
  });
});

describe('layerExtentVisibilityAt', () => {
  it('takes a band of heights to the extents a map shows from them', () => {
    // Up to 50 km high is up to 200 km across, at 4 metres across a metre high.
    expect(layerExtentVisibilityAt(150000, { maxHeight: 50000 })).toBe(1);
    expect(layerExtentVisibilityAt(250000, { maxHeight: 50000 })).toBe(0);
    expect(layerExtentVisibilityAt(150000, { maxHeight: 50000 }, 2)).toBe(0);
  });

  it('takes a band of extents of its own over the heights', () => {
    expect(
      layerExtentVisibilityAt(150000, { maxHeight: 50000, maxExtent: 100000 }),
    ).toBe(0);
    expect(layerExtentVisibilityAt(500, { minExtent: 1000, fade: 0 })).toBe(0);
    expect(layerExtentVisibilityAt(500, { visible: false })).toBe(0);
  });
});

describe('map drawing', () => {
  const view: MapView = {
    center: [0, 0],
    up: [0, -1],
    metresPerPixel: 1000,
    size: [200, 100],
  };

  it('cuts a path to the map and its margin', () => {
    const clip = mapClipRect(view, 10);
    expect(clip).toEqual([-10, -10, 210, 110]);
    // A line from far off the left to the middle: only what lies in it.
    expect(
      mapPathData(
        [
          [-5000, 50],
          [100, 50],
        ],
        false,
        clip,
      ),
    ).toBe('M-10.0 50.0L100.0 50.0');
    expect(
      mapPathData(
        [
          [-500, -500],
          [-400, -400],
        ],
        false,
        clip,
      ),
    ).toBe('');
  });

  it('drops the vertices closer than a pixel, but never the last', () => {
    const lonLat: Vec2[] = [];
    for (let k = 0; k <= 100; k++) lonLat.push([k * 0.0001, 0]);
    const xz = lonLat.map(([lon, lat]) => toXZ(lon, lat));
    // 10 m apart at 1 km a pixel: the first and the last.
    const pixels = mapViewGeoLine(view, lonLat, xz);
    expect(pixels).toHaveLength(2);
    expect(pixels[1]).toEqual(mapViewGeoPixel(view, lonLat[100], xz[100]));
  });

  it('bounds what a map shows in longitude and latitude, for the features met', () => {
    const box = mapViewLonLatBox(view, toLonLat);
    expect(box).not.toBeNull();
    const [west, south, east, north] = box!;
    expect(west).toBeLessThan(-1);
    expect(east).toBeGreaterThan(1);
    expect(south).toBeLessThan(-0.5);
    expect(north).toBeGreaterThan(0.5);
    expect(lonLatBoxesMeet([0.1, 0.1, 0.2, 0.2], box)).toBe(true);
    expect(lonLatBoxesMeet([5, 5, 6, 6], box)).toBe(false);
    // Across the antimeridian: taken the way round that meets.
    expect(lonLatBoxesMeet([179, 0, 180, 1], [-182, -1, -178, 2])).toBe(true);
    // A view without bounds meets all.
    expect(lonLatBoxesMeet([5, 5, 6, 6], null)).toBe(true);
  });

  it('has no bounds for a view of a whole hemisphere', () => {
    const wide = geoMapView(input('equal-earth', [0, 0], 3e7));
    expect(mapViewLonLatBox(wide, toLonLat)).toBeNull();
  });

  it('places a label only where it meets none placed before', () => {
    const spacer = new MapLabelSpacer(400);
    expect(spacer.take([10, 10, 60, 20])).toBe(true);
    expect(spacer.take([50, 12, 100, 22])).toBe(false);
    expect(spacer.take([70, 10, 120, 20])).toBe(true);
    // Across a cell's edge too.
    expect(spacer.take([60, 60, 70, 70])).toBe(true);
    expect(spacer.take([66, 66, 140, 75])).toBe(false);
  });
});
