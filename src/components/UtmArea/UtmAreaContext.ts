import { createContext } from 'react';
import { Vec2, Vec3 } from '../../sdk';

export type UtmCoords = { easting: number; northing: number; altitude: number };
export type Wgs84Coords = { lng: number; lat: number; alt: number };

/**
 * UtmAreaContext props
 * @expand
 */
export type UtmAreaContextProps = {
  originUtm: Vec2;
  originWgs84: Vec2;
  utmToArea: (easting: number, northing: number, altitude?: number) => Vec3;
  wgs84ToArea: (longitude: number, latitude: number, altitude?: number) => Vec3;
  areaToUtm: (x: number, y: number, z: number) => UtmCoords;
  worldToUtm: (x: number, y: number, z: number) => UtmCoords;
  areaToWgs84: (x: number, y: number, z: number) => Wgs84Coords;
  worldToWgs84: (x: number, y: number, z: number) => Wgs84Coords;
  getUtmOrigin: () => Vec3;
  getWorldPosition: () => Vec3;
};

/**
 * Utm Area context
 *
 * @remarks
 * The conversions are flat: an altitude is the area's Y. Far from the field, under a `Sky`
 * with a curved horizon, a point on the curved sea or on the relief reads as below the sea
 * (about −3.1 km at 200 km out) and a little nearer the field than its map position (about
 * 100 m at 200 km). See {@link UtmPosition}.
 *
 * @group Contexts
 */
export const UtmAreaContext = createContext<UtmAreaContextProps>(null!);
