import { createContext } from 'react'
import { Vec2, Vec3 } from '../../sdk'

export type UtmCoords = { easting: number, northing: number, altitude: number}
export type Wgs84Coords = { lng: number, lat: number, alt: number }

/**
 * UtmAreaContext props
 * @expand
 */
export type UtmAreaContextProps = {
  originUtm: Vec2,
  originWgs84: Vec2,
  utmToArea: (easting: number, northing: number, altitude?: number) => Vec3,
  wgs84ToArea: (longitude: number, latitude: number, altitude?: number) => Vec3,
  areaToUtm: (x: number, y: number, z: number) => UtmCoords,
  worldToUtm: (x: number, y: number, z: number) => UtmCoords,
  areaToWgs84: (x: number, y: number, z: number) => Wgs84Coords,
  worldToWgs84: (x: number, y: number, z: number) => Wgs84Coords,
  getUtmOrigin: () => Vec3,
  getWorldPosition: () => Vec3,
}

/**
 * Utm Area context
 * @group Contexts
 */
export const UtmAreaContext = createContext<UtmAreaContextProps>(null!)
