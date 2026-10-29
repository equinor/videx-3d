import proj4 from 'proj4';
import { describe, expect, it } from 'vitest';
import { gridToRelief } from '../src/sdk/data/relief/grid-to-relief';
import { reliefWindow } from '../src/sdk/data/relief/relief-window';
import type {
  ReliefData,
  ReliefWindow,
} from '../src/sdk/data/types/ReliefMeta';
import {
  buildGeoReliefTile,
  buildReliefTile,
  geoReliefTileHeightAt,
  ReliefReader,
  reliefTileHeightAt,
  reliefWrapColumns,
} from '../src/sdk/geometries/relief-tiles';
import { wgs84Def } from '../src/sdk/projection/crs';
import {
  GEO_TILE_ROOTS,
  geoTileKeyAt,
  geoTileRegion,
} from '../src/sdk/tiles/geo-tile-keys';
import {
  tileAddress,
  tileChildren,
  tileKeyAt,
  tileParent,
} from '../src/sdk/tiles/tile-keys';

const UTM = '+proj=utm +zone=31 +datum=WGS84 +units=m +no_defs';
const LONLAT = '+proj=longlat +datum=WGS84 +no_defs';
// The demo field, in UTM 31N.
const E0 = 434500;
const N0 = 6478000;
const CELLS = 32;
const NODES = CELLS + 3;

function storeOf(...reliefs: ReliefData[]) {
  const read = async (dataType: string, id: string, window?: ReliefWindow) => {
    const relief = reliefs.find(r => r.meta.id === id);
    if (!relief) return null;
    if (dataType === 'relief-meta') return relief.meta;
    return reliefWindow(relief, window!);
  };
  return new ReliefReader(read);
}

// A plane in UTM about the field, 100 m cells over ±6 km: it rises 0.01 a metre east and
// 0.02 a metre south.
const plane = (e: number, n: number) => 0.01 * (e - E0) - 0.02 * (n - N0);
function utmPlane(): ReliefData {
  const cell = 100;
  const nx = 121;
  const values = new Float32Array(nx * nx);
  for (let row = 0; row < nx; row++) {
    for (let col = 0; col < nx; col++) {
      const e = E0 - 6000 + col * cell;
      const n = N0 - 6000 + (nx - 1 - row) * cell;
      values[row * nx + col] = plane(e, n);
    }
  }
  return gridToRelief(
    {
      values,
      size: [nx, nx],
      origin: [E0 - 6000, N0 - 6000],
      cell: [cell, cell],
      crs: UTM,
    },
    { id: 'plane', name: 'plane' },
  );
}

// A grid in longitude and latitude over 0–6°E, 56–62°N, 0.01° cells: linear in each.
const sloped = (lon: number, lat: number) => 100 * lon - 50 * (lat - 56);
function lonLatGrid(): ReliefData {
  const cell = 0.01;
  const nx = 601;
  const values = new Float32Array(nx * nx);
  for (let row = 0; row < nx; row++) {
    for (let col = 0; col < nx; col++) {
      values[row * nx + col] = sloped(col * cell, 56 + (nx - 1 - row) * cell);
    }
  }
  return gridToRelief(
    {
      values,
      size: [nx, nx],
      origin: [0, 56],
      cell: [cell, cell],
      crs: LONLAT,
    },
    { id: 'lonlat', name: 'lonlat' },
  );
}

// The whole Earth, 1° cells at their centres: smooth round it in longitude.
const round = (lon: number, lat: number) =>
  1000 * Math.sin((lon * Math.PI) / 180) + 10 * lat;
function worldGrid(repeat = false): ReliefData {
  const nx = repeat ? 361 : 360;
  const ny = 180;
  const west = repeat ? -180 : -179.5;
  const values = new Float32Array(nx * ny);
  for (let row = 0; row < ny; row++) {
    for (let col = 0; col < nx; col++) {
      values[row * nx + col] = round(west + col, 89.5 - row);
    }
  }
  return gridToRelief(
    {
      values,
      size: [nx, ny],
      origin: [west, -89.5],
      cell: [1, 1],
      crs: LONLAT,
    },
    { id: 'world', name: 'world' },
  );
}

const [LON, LAT] = proj4(UTM, wgs84Def, [E0, N0]);

describe('geographic tile keys', () => {
  it('two roots, west and east, pole to pole', () => {
    expect(GEO_TILE_ROOTS.map(geoTileRegion)).toEqual([
      [-180, 90, 180],
      [0, 90, 180],
    ]);
    expect(geoTileKeyAt(0, LON, LAT)).toBe(GEO_TILE_ROOTS[1]);
    expect(geoTileKeyAt(0, -LON, LAT)).toBe(GEO_TILE_ROOTS[0]);
  });

  it('holds its point, its children tile it, and back', () => {
    const key = geoTileKeyAt(13, LON, LAT);
    const [west, north, span] = geoTileRegion(key);
    expect(LON).toBeGreaterThanOrEqual(west);
    expect(LON).toBeLessThan(west + span);
    expect(LAT).toBeLessThanOrEqual(north);
    expect(LAT).toBeGreaterThan(north - span);
    const children = tileChildren(key).map(geoTileRegion);
    expect(children[0]).toEqual([west, north, span / 2]);
    expect(children[3]).toEqual([west + span / 2, north - span / 2, span / 2]);
    for (const child of tileChildren(key)) expect(tileParent(child)).toBe(key);
  });

  it('wraps the longitude and clamps the latitude', () => {
    expect(geoTileKeyAt(4, 180, 0)).toBe(geoTileKeyAt(4, -180, 0));
    expect(geoTileKeyAt(4, 541, 10)).toBe(geoTileKeyAt(4, -179, 10));
    const [, , j] = tileAddress(geoTileKeyAt(4, 0, -90));
    expect(j).toBe(2 ** 4 - 1);
    expect(tileAddress(geoTileKeyAt(4, 0, 95))[2]).toBe(0);
  });
});

describe('buildGeoReliefTile', () => {
  it('reads a layer in a map onto its longitudes and latitudes', async () => {
    const reader = storeOf(utmPlane());
    const key = geoTileKeyAt(13, LON, LAT);
    const tile = await buildGeoReliefTile(
      reader,
      { layers: [{ id: 'plane' }], base: -120 },
      key,
    );
    const [west, north, span] = geoTileRegion(key);
    const step = span / CELLS;
    let worst = 0;
    for (let v = 0; v < NODES; v++) {
      for (let u = 0; u < NODES; u++) {
        const [e, n] = proj4(wgs84Def, UTM, [
          west + (u - 1) * step,
          north - (v - 1) * step,
        ]);
        worst = Math.max(
          worst,
          Math.abs(tile.heights[v * NODES + u] - plane(e, n)),
        );
      }
    }
    expect(worst).toBeLessThan(1e-3);
    expect(tile.error).toBeLessThan(1e-3);
    // Its cells (76 m north–south, 40 m east–west) are finer than the layer's 100 m.
    expect(tile.leaf).toBe(true);
    const coarse = await buildGeoReliefTile(
      reader,
      { layers: [{ id: 'plane' }], base: -120 },
      geoTileKeyAt(10, LON, LAT),
    );
    expect(coarse.leaf).toBe(false);
  });

  it('splits over a layer lying wholly between its nodes', async () => {
    // Nodes 1.4° apart, about 80 km from the 12 km plane: none takes any of it.
    const tile = await buildGeoReliefTile(
      storeOf(utmPlane()),
      { layers: [{ id: 'plane' }], base: -120 },
      geoTileKeyAt(2, LON, LAT),
    );
    expect(tile.heights.every(h => h === -120)).toBe(true);
    expect(tile.leaf).toBe(false);
    expect(tile.edge).toBe(true);
    // The plane reaches ±180 m; the tile stays at -120.
    expect(tile.error).toBeGreaterThan(150);
  });

  it('gives its normals east and south where each node lies, in metres', async () => {
    const reader = storeOf(utmPlane());
    const tile = await buildGeoReliefTile(
      reader,
      { layers: [{ id: 'plane' }], base: -120 },
      geoTileKeyAt(13, LON, LAT),
    );
    // Rising 0.01 east and 0.02 south: the normal leans west and north. True north is
    // 1° from grid north here, and UTM's metres 0.9996 of the ground's: a few in 10⁴.
    const length = Math.hypot(0.01, 1, 0.02);
    const half = (bits: number) => {
      const sign = bits >> 15 ? -1 : 1;
      const exponent = (bits >> 10) & 0x1f;
      const fraction = bits & 0x3ff;
      return sign * 2 ** (exponent - 15) * (1 + fraction / 1024);
    };
    const k = 2 * (17 * NODES + 17);
    expect(half(tile.normals[k])).toBeCloseTo(-0.01 / length, 3);
    expect(half(tile.normals[k + 1])).toBeCloseTo(-0.02 / length, 3);
  });

  it('agrees with a tile in the map where both lie', async () => {
    const reader = storeOf(utmPlane());
    const source = { layers: [{ id: 'plane' }], base: -120 };
    const geo = await buildGeoReliefTile(
      reader,
      source,
      geoTileKeyAt(13, LON, LAT),
    );
    const frame = { projection: UTM, origin: [E0, N0] as [number, number] };
    const [west, north, span] = geoTileRegion(geo.key);
    for (const [fu, fv] of [
      [0.25, 0.25],
      [0.5, 0.7],
      [0.9, 0.1],
    ]) {
      const lon = west + fu * span;
      const lat = north - fv * span;
      const [e, n] = proj4(wgs84Def, UTM, [lon, lat]);
      const [x, z] = [e - E0, N0 - n];
      const flat = await buildReliefTile(
        reader,
        { ...source, frame },
        tileKeyAt(16, x, z),
      );
      expect(geoReliefTileHeightAt(geo, lon, lat)).toBeCloseTo(
        reliefTileHeightAt(flat, x, z),
        2,
      );
    }
  });

  it('reads a layer in longitude and latitude node for node', async () => {
    const reader = storeOf(lonLatGrid());
    const key = geoTileKeyAt(9, 3.3, 59.1);
    const tile = await buildGeoReliefTile(
      reader,
      { layers: [{ id: 'lonlat' }], base: 0 },
      key,
    );
    const [west, north, span] = geoTileRegion(key);
    const step = span / CELLS;
    let worst = 0;
    for (let v = 1; v <= CELLS + 1; v++) {
      for (let u = 1; u <= CELLS + 1; u++) {
        const expected = sloped(west + (u - 1) * step, north - (v - 1) * step);
        worst = Math.max(
          worst,
          Math.abs(tile.heights[v * NODES + u] - expected),
        );
      }
    }
    expect(worst).toBeLessThan(1e-3);
    expect(
      geoReliefTileHeightAt(tile, west + span / 3, north - span / 5),
    ).toBeCloseTo(sloped(west + span / 3, north - span / 5), 3);
  });

  it('reads a layer round the Earth across the antimeridian', async () => {
    for (const repeat of [false, true]) {
      const world = worldGrid(repeat);
      expect(reliefWrapColumns(world.meta)).toBe(360);
      for (const feather of [0, 200000]) {
        const reader = storeOf(world);
        // Ending at 180°E and starting at 180°W: their borders lie across it.
        for (const lon of [179, -179]) {
          const key = geoTileKeyAt(3, lon, 10);
          const tile = await buildGeoReliefTile(
            reader,
            { layers: [{ id: 'world', feather }], base: -5000 },
            key,
          );
          const [west, north, span] = geoTileRegion(key);
          const step = span / CELLS;
          let worst = 0;
          for (let v = 0; v < NODES; v++) {
            for (let u = 0; u < NODES; u++) {
              const k = v * NODES + u;
              expect(tile.layers[k]).toBe(1);
              const expected = round(
                west + (u - 1) * step,
                north - (v - 1) * step,
              );
              worst = Math.max(worst, Math.abs(tile.heights[k] - expected));
            }
          }
          expect(worst).toBeLessThan(1);
        }
      }
    }
    expect(reliefWrapColumns(lonLatGrid().meta)).toBe(0);
    expect(reliefWrapColumns(utmPlane().meta)).toBe(0);
  });
});
