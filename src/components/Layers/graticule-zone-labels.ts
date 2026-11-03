import { Vector3 } from 'three';
import type { Globe } from '../../sdk/projection/globe';
import type { Label } from '../Labels/types';

/** A zone's cell on the Earth, in degrees (WGS84), and its name. */
export type GraticuleZoneCell = {
  west: number;
  east: number;
  south: number;
  north: number;
  text: string;
};

/** A zone label's font size, by default, as a fraction of its cell's narrower side. */
export const GRATICULE_ZONE_LABEL_SIZE = 0.18;

// The UTM latitude bands' southern edges, C to X: every 8° from 80°S, X 12° to 84°N.
const BAND_COUNT = 20;
const bandSouth = (band: number) => -80 + 8 * band;
const bandNorth = (band: number) =>
  band === BAND_COUNT - 1 ? 84 : bandSouth(band) + 8;
// Bands V (56°N–64°N) and X (72°N–84°N), where Norway's and Svalbard's zones differ.
const BAND_V = 17;
const BAND_X = 19;

/** A UTM zone as its projection is named: its number and hemisphere, `32N`, `23S`. */
export function utmZoneLabelText(zone: number, south: boolean) {
  return `${zone}${south ? 'S' : 'N'}`;
}

/**
 * A nautical time zone as an offset from UTC, east ahead: `UTC+1`, `UTC−3` (a true minus),
 * `UTC±0`.
 */
export function timeZoneLabelText(offset: number) {
  if (offset === 0) return 'UTC±0';
  return `UTC${offset > 0 ? '+' : '\u2212'}${Math.abs(offset)}`;
}

/**
 * The UTM zones' cells, each named as its zone's projection is (`utmZoneLabelText`): zones
 * every 6° from 180°W, by the latitude bands from 80°S to 84°N (every 8°, the last, X, 12°)
 * — Norway's 31V 0°–3°E and 32V 3°–12°E, and in band X Svalbard's 31X 0°–9°E, 33X
 * 9°–21°E, 35X 21°–33°E and 37X 33°–42°E, 32X, 34X and 36X left out — as `graticule.glsl`
 * draws their edges.
 */
export function utmZoneCells(): GraticuleZoneCell[] {
  const cells: GraticuleZoneCell[] = [];
  const svalbard: Record<number, [number, number] | null> = {
    31: [0, 9],
    32: null,
    33: [9, 21],
    34: null,
    35: [21, 33],
    36: null,
    37: [33, 42],
  };
  for (let band = 0; band < BAND_COUNT; band++) {
    const south = bandSouth(band);
    const north = bandNorth(band);
    for (let zone = 1; zone <= 60; zone++) {
      let west = -180 + 6 * (zone - 1);
      let east = west + 6;
      if (band === BAND_V && zone === 31) east = 3;
      if (band === BAND_V && zone === 32) west = 3;
      if (band === BAND_X && zone in svalbard) {
        const span = svalbard[zone];
        if (!span) continue;
        [west, east] = span;
      }
      cells.push({
        west,
        east,
        south,
        north,
        text: utmZoneLabelText(zone, north <= 0),
      });
    }
  }
  return cells;
}

/**
 * The nautical time zones' cells, each named by its offset (`timeZoneLabelText`): 15° wide
 * about every 15th meridian, the one about 180° split at the date line into UTC+12 west of
 * it and UTC−12 east; in rows as the UTM bands are, from 80°S to 84°N, so a zone's name is
 * met wherever along it the view is.
 */
export function timeZoneCells(): GraticuleZoneCell[] {
  const cells: GraticuleZoneCell[] = [];
  for (let band = 0; band < BAND_COUNT; band++) {
    const south = bandSouth(band);
    const north = bandNorth(band);
    for (let offset = -12; offset <= 12; offset++) {
      cells.push({
        west: Math.max(offset * 15 - 7.5, -180),
        east: Math.min(offset * 15 + 7.5, 180),
        south,
        north,
        text: timeZoneLabelText(offset),
      });
    }
  }
  return cells;
}

// Metres along a meridian per degree of latitude, on the Earth's mean sphere.
const METRES_PER_DEGREE = (Math.PI / 180) * 6371008.8;
const DEG = Math.PI / 180;

/**
 * A zone label's font size, in metres: `fraction` of its cell's narrower side — east–west
 * at its poleward edge, where it is narrowest, or north–south — so it fits its cell at any
 * latitude.
 */
export function graticuleZoneLabelSize(
  cell: GraticuleZoneCell,
  fraction = GRATICULE_ZONE_LABEL_SIZE,
) {
  const poleward = Math.max(Math.abs(cell.south), Math.abs(cell.north));
  const across =
    (cell.east - cell.west) * Math.cos(Math.min(poleward, 89.9) * DEG);
  return (
    fraction * Math.min(across, cell.north - cell.south) * METRES_PER_DEGREE
  );
}

const at = new Vector3();
const toward = new Vector3();
const up = new Vector3();

/**
 * A label for each of `cells` on the sea's level of `globe` (it needs a frame): its name at
 * its middle, lying flat on the Earth and reading east, its own size in metres
 * ({@link graticuleZoneLabelSize}; draw them in a layer of `size` 1).
 */
export function graticuleZoneLabels(
  globe: Globe,
  cells: readonly GraticuleZoneCell[],
  fraction = GRATICULE_ZONE_LABEL_SIZE,
): Label[] {
  return cells.map(cell => {
    const latitude = (cell.south + cell.north) / 2;
    const longitude = (cell.west + cell.east) / 2;
    const position = globe.geodetic(latitude, longitude, 0, at).toArray();
    const normal = globe.upAt(at, up).toArray();
    globe.geodetic(latitude, longitude + 1e-3, 0, toward);
    const direction = toward.sub(at).toArray();
    return {
      text: cell.text,
      position,
      normal,
      direction,
      size: graticuleZoneLabelSize(cell, fraction),
    };
  });
}
