import proj4, { Converter } from 'proj4';

export const wgs84Def = '+proj=longlat +ellps=WGS84 +datum=WGS84 +no_defs';

/**
 * Maps between real world UTM coordinates and 3d world coordinates by assigning a known real world
 * position to the center of the 3d world and specifying an UTM zone.
 */
export class CRS {
  utmDef: string;
  originWgs84: [number, number];
  originUtm: [number, number];
  _projection: Converter;

  constructor(
    utmDef: string,
    origin: [number, number],
    originUnits: 'utm' | 'lnglat' = 'lnglat',
  ) {
    this.utmDef = utmDef;
    this._projection = proj4(wgs84Def, utmDef);

    if (originUnits === 'lnglat') {
      this.originWgs84 = origin;
      this.originUtm = this.wgs84ToUtm(origin);
    } else {
      this.originWgs84 = this.utmToWgs84(origin);
      this.originUtm = origin;
    }
  }

  utmToWgs84(eastingNorthing: [number, number]): [number, number] {
    return this._projection.inverse(eastingNorthing);
  }

  wgs84ToUtm(lngLat: [number, number]): [number, number] {
    return this._projection.forward(lngLat);
  }

  utmToWorld(easting: number, northing: number, altitude: number) {
    return {
      x: easting - this.originUtm[0],
      y: altitude,
      z: this.originUtm[1] - northing,
    };
  }

  worldToUtm(x: number, y: number, z: number) {
    return {
      easting: x + this.originUtm[0],
      altitude: y,
      northing: this.originUtm[1] - z,
    };
  }

  wgs84ToWorld(lng: number, lat: number, altitude = 0) {
    const utm = this.wgs84ToUtm([lng, lat]);
    return this.utmToWorld(utm[0], utm[1], altitude);
  }

  worldToWgs84(x: number, y: number, z: number) {
    const utm = this.worldToUtm(x, y, z);
    const wgs = this.utmToWgs84([utm.easting, utm.northing]);

    return {
      lng: wgs[0],
      lat: wgs[1],
      alt: y,
    };
  }
}

/**
 * The geodetic datum a UTM zone's coordinates are given in ({@link getProjectionDefFromUtmZone}):
 *
 * - `'ED50'`: European Datum 1950 (International 1924 ellipsoid), shifted to WGS84 by the
 *   3-parameter `-87,-98,-121`, about 2–3 m from the 7-parameter shifts published for the
 *   North Sea. Much of the North Sea's older well and seismic data is in it.
 * - `'WGS84'`: what GPS, and most web maps, give.
 * - `'ETRS89'`: Europe's (GRS80 ellipsoid), within a metre of WGS84, taken as equal to it.
 * - `{ ellps, towgs84 }`: any other, as proj4 takes it: an ellipsoid name, and the shift to
 *   WGS84, 3 or 7 numbers (metres, and for 7, rotations in arc seconds and the scale in ppm,
 *   in the position vector convention: published coordinate frame rotations change sign).
 *
 * @group Utils
 */
export type UtmDatum =
  | 'ED50'
  | 'WGS84'
  | 'ETRS89'
  | { ellps: string; towgs84: number[] };

function datumDef(datum: UtmDatum) {
  if (datum === 'ED50') return '+ellps=intl +towgs84=-87,-98,-121,0,0,0,0';
  if (datum === 'WGS84') return '+datum=WGS84';
  if (datum === 'ETRS89') return '+ellps=GRS80 +towgs84=0,0,0,0,0,0,0';
  return `+ellps=${datum.ellps} +towgs84=${datum.towgs84.join(',')}`;
}

/**
 * The proj4 definition of a UTM zone: its number and hemisphere, `'31N'` or `'5S'`, in
 * `datum` (default `'ED50'`; see {@link UtmDatum}). Throws for anything else.
 *
 * @group Utils
 */
export function getProjectionDefFromUtmZone(
  utmZone: string,
  datum: UtmDatum = 'ED50',
) {
  const [, zone, hemisphere] =
    /^([0-9]{1,2})([NS]?)$/i.exec(utmZone.trim()) || [];
  const number = Number(zone);
  if (!zone || number < 1 || number > 60)
    throw new Error(
      `getProjectionDefFromUtmZone: '${utmZone}' is not a UTM zone: its number, 1 to 60, and N or S`,
    );
  const south = hemisphere?.toUpperCase() === 'S';
  return `+proj=utm +zone=${number}${south ? ' +south' : ''} ${datumDef(datum)} +units=m +no_defs`;
}

export function getUtmZoneFromLatLng([lng, lat]: [number, number]) {
  // Special Cases for Norway & Svalbard
  if (lat > 55 && lat < 64 && lng > 2 && lng < 6) {
    return '32N';
  }
  if (lat > 71 && lng >= 6 && lng < 9) {
    return '31N';
  }
  if (lat > 71 && ((lng >= 9 && lng < 12) || (lng >= 18 && lng < 21))) {
    return '33N';
  }
  if (lat > 71 && ((lng >= 21 && lng < 24) || (lng >= 30 && lng < 33))) {
    return '35N';
  }
  // Rest of the world
  if (lng >= -180 && lng <= 180) {
    const zone = (Math.floor((lng + 180) / 6) % 60) + 1;
    return lat < 0 ? `${zone}S` : `${zone}N`;
  }

  throw new Error(
    `getUtmZoneFromLatLng: Cannot figure out UTM zone from give Lat: ${lat}, Lng: ${lng}`,
  );
}
