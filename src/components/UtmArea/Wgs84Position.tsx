import { PropsWithChildren, useContext, useMemo } from 'react';
import { UtmAreaContext } from './UtmAreaContext';

/**
 * Wgs84Position props
 * @expand
 */
export type Wgs84PositionProps = {
  long: number;
  lat: number;
  altitude?: number;
};

/**
 * Container component which allows sub components positioned relative to a long lat coordinate. Used with the `UtmArea`
 * component.
 *
 * @example
 * <UtmArea utmZone="31N" origin={[474000, 6522000]}>
 *  <Wgs84Position long={long} lat={lat}>
 *    { children }
 *  </Wgs84Position>
 * </UtmArea>
 *
 * @remarks
 * Through the area's UTM zone, and as flat as {@link UtmPosition}: `altitude` is the
 * area's Y. Far from the field, under a `Sky` with its `globe` on, what this places
 * stands off the curved sea; see {@link UtmPosition}.
 *
 * @see {@link UtmArea}
 *
 * @group Components
 */
export const Wgs84Position = ({
  long,
  lat,
  altitude = 0,
  children,
}: PropsWithChildren<Wgs84PositionProps>) => {
  const context = useContext(UtmAreaContext);
  const position = useMemo(
    () => context.wgs84ToArea(long, lat, altitude),
    [long, lat, altitude, context],
  );

  return <group position={position}>{children}</group>;
};
