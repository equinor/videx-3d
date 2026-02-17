import { forwardRef, PropsWithChildren, useImperativeHandle, useMemo, useRef } from 'react'
import { Group, Vector3 } from 'three/webgpu'
import { CRS, getProjectionDefFromUtmZone } from '../../sdk/projection/crs'
import { Vec3 } from '../../sdk/types/common'
import { UtmAreaContext, UtmAreaContextProps } from './UtmAreaContext'

/**
 * UtmArea props
 * @expand
 */
export type UtmAreaProps = {
  crsInstance?: CRS,
  utmZone?: string,
  origin: [number, number],
  originUnits?: 'utm' | 'lnglat',
  offset?: Vec3,
  utmProjectionDef?: string,
}


/**
 * A container component that maps a UTM reference point to a 3d world space origin. This can be used by sub components to 
 * position themselves by using UTM or Wgs84 coordinates as well as converting between these and 3d space coordinates.
 * 
 * @example
 * <UtmArea utmZone={utmZone} origin={origin} originUnits={originUnits} offset={offset}>
 *  { children }
 * </UtmArea>
 * 
 * @remarks
 * This component will return the internal CRS instance when passing a ref 
 * 
 * @see [Storybook](/videx-3d/?path=/docs/components-containers-utmarea--docs)
 * @see {@link UtmPosition}
 * @see {@link Wgs84Position}
 * @see {@link UtmAreaContext}
 * @see {@link CRS}
 *  
 * @group Components
 */
export const UtmArea = forwardRef<CRS, PropsWithChildren<UtmAreaProps>>(({ crsInstance, utmZone, origin, originUnits = 'utm', offset = [0, 0, 0], children }, fref) => {
  const ref = useRef<Group>(null)
  const crs = useMemo(() => {
    if (crsInstance) return crsInstance
    if (utmZone) {
      const utmDef = getProjectionDefFromUtmZone(utmZone.toUpperCase())
      return new CRS(utmDef, origin, originUnits)
    }
    throw Error('Either a UTM zone (string containing zone number + N/S for north/south hemisphere) or a CRS instance must be provided as props to the UtmArea component!')
  }, [crsInstance, utmZone, origin, originUnits])

  useImperativeHandle(fref, () => crs, [crs])

  const contextValue = useMemo<UtmAreaContextProps>(() => {
    const utmToArea = (easting: number, northing: number, altitude = 0): Vec3 => {
      const pos = crs.utmToWorld(easting, northing, altitude)
      return [pos.x, pos.y, pos.z]
    }

    const wgs84ToArea = (longitude: number, latitude: number, altitude = 0): Vec3 => {
      const pos = crs.wgs84ToWorld(longitude, latitude, altitude)
      return [pos.x, pos.y, pos.z]
    }

    const areaToUtm = (x: number, y: number, z: number) => {
      const pos = crs.worldToUtm(x, y, z)
      return pos
    }

    const worldToUtm = (x: number, y: number, z: number) => {
      if (!ref.current) throw Error('Missing reference!')
      const worldCoordinates = new Vector3()
      ref.current.getWorldPosition(worldCoordinates)
      const pos = crs.worldToUtm(-worldCoordinates.x + x, -worldCoordinates.y + y, -worldCoordinates.z + z)
      return pos
    }

    const areaToWgs84 = (x: number, y: number, z: number) => {
      const pos = crs.worldToWgs84(x, y, z)
      return pos
    }

    const worldToWgs84 = (x: number, y: number, z: number) => {
      if (!ref.current) throw Error('Missing reference!')
      const worldCoordinates = new Vector3()
      ref.current.getWorldPosition(worldCoordinates)
      const pos = crs.worldToWgs84(-worldCoordinates.x + x, -worldCoordinates.y + y, -worldCoordinates.z + z)
      return pos
    }

    const getWorldPosition = (): Vec3 => {
      if (!ref.current) throw Error('Missing reference!')
      const v = new Vector3()
      ref.current.getWorldPosition(v)
      return [v.x, v.y, v.z]
    }

    const getUtmOrigin = (): Vec3 => {
      const worldPosition = getWorldPosition()
      const origin: Vec3 = [
        worldPosition[0] - crs.originUtm[0],
        -worldPosition[1],
        worldPosition[2] + crs.originUtm[1],
      ]
      return origin
    }

    return {
      originUtm: crs.originUtm,
      originWgs84: crs.originWgs84,
      utmToArea,
      wgs84ToArea,
      areaToUtm,
      worldToUtm,
      areaToWgs84,
      worldToWgs84,
      getWorldPosition,
      getUtmOrigin,
    }
  }, [crs])

  return (
    <group ref={ref} position={offset}>
      <UtmAreaContext.Provider value={contextValue}>
        {children}
      </UtmAreaContext.Provider>
    </group>
  )
})