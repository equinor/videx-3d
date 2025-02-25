import proj4, { Converter } from "proj4"

export const wgs84Def = '+proj=longlat +ellps=WGS84 +datum=WGS84 +no_defs'

/**
 * Maps between real world UTM coordinates and 3d world coordinates by assigning a known real world 
 * position to the center of the 3d world and specifying an UTM zone.
 */
export class CRS {
  utmDef: string
  originWgs84: [number, number]
  originUtm: [number, number]
  _projection: Converter


  constructor(utmDef: string, origin: [number, number], originUnits: 'utm' | 'lnglat' = 'lnglat') {
    this.utmDef = utmDef
    this._projection = proj4(wgs84Def, utmDef)

    if (originUnits === 'lnglat') {
      this.originWgs84 = origin
      this.originUtm = this.wgs84ToUtm(origin)
    } else {
      this.originWgs84 = this.utmToWgs84(origin)
      this.originUtm = origin
    }
  }

  utmToWgs84(eastingNorthing: [number, number]) : [number, number] {
    return this._projection.inverse(eastingNorthing)
  }

  wgs84ToUtm(lngLat: [number, number]): [number, number] {
    return this._projection.forward(lngLat)
  }
  
  utmToWorld(easting: number, northing: number, altitude: number) {
    return {
      x: easting - this.originUtm[0],
      y: altitude,
      z: this.originUtm[1] - northing,
    }
  }

  worldToUtm(x: number, y: number, z: number) {
    return {
      easting: x + this.originUtm[0],
      altitude: y,
      northing: this.originUtm[1] - z,
    }
  }

  wgs84ToWorld(lng: number, lat: number, altitude = 0) {
    const utm = this.wgs84ToUtm([lng, lat])
    return this.utmToWorld(utm[0], utm[1], altitude)
  }

  worldToWgs84(x: number, y: number, z: number) {
    const utm = this.worldToUtm(x, y, z)
    const wgs = this.utmToWgs84([utm.easting, utm.northing])
  
    return {
      lng: wgs[0],
      lat: wgs[1],
      alt: y,
    }
  }
}

export function getProjectionDefFromUtmZone(utmZone: string) {
  const [, zone, hemisphere] = new RegExp(/^([0-9]{2})([N|S]?)$/).exec(utmZone) || []
  return `+proj=utm +zone=${zone}${hemisphere === 'S' ? ' +south' : ''} +ellps=intl +towgs84=-87,-98,-121,0,0,0,0 +units=m +no_defs`
}

export function getUtmZoneFromLatLng([lng, lat] : [number, number]) {
  // Special Cases for Norway & Svalbard
  if (lat > 55 && lat < 64 && lng > 2 && lng < 6) {
    return '32N'
  }
  if (lat > 71 && lng >= 6 && lng < 9) {
    return '31N'
  }
  if (lat > 71 && ((lng >= 9 && lng < 12) || (lng >= 18 && lng < 21))) {
    return '33N'
  }
  if (lat > 71 && ((lng >= 21 && lng < 24) || (lng >= 30 && lng < 33))) {
    return '35N'
  }
  // Rest of the world
  if (lng >= -180 && lng <= 180) {
    const zone = (Math.floor((lng + 180) / 6) % 60) + 1
    return lat < 0 ? `${zone}S` : `${zone}N`
  }

  throw new Error(`getUtmZoneFromLatLng: Cannot figure out UTM zone from give Lat: ${lat}, Lng: ${lng}`)
}