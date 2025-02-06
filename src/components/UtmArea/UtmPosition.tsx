import { PropsWithChildren, useContext, useMemo } from 'react'
import { UtmAreaContext } from './UtmAreaContext'

/**
 * UtmPosition props
 * @expand
 */
export type UtmPositionProps = {
  easting: number,
  northing: number,
  altitude?: number,
}

/**
 * Container component which allows sub components positioned relative to a UTM coordinate. Used with the `UtmArea`
 * component.
 * 
 * @example
 * <UtmArea utmZone="31N" origin={[474000, 6522000]}>
 *  <UtmPosition easing={easting} northing={northing}>
 *    { children }
 *  </UtmPosition>
 * </UtmArea>
 * 
 * @see {@link UtmArea}
 * 
 * @group Components
 */
export const UtmPosition = ({ easting, northing, altitude = 0, children }: PropsWithChildren<UtmPositionProps>) => {
  const context = useContext(UtmAreaContext)
  const position = useMemo(() => context.utmToArea(easting, northing, altitude), [easting, northing, altitude, context])

  return (
    <group position={position}>
      { children }
    </group>
  )
}