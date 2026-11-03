import { PropsWithChildren, useContext, useMemo } from 'react';
import { placeGeoPoint } from '../../sdk/projection/geo-frame';
import { useWorld, WorldState } from '../World/world-context';
import { EarthPlacement } from './EarthPlacement';
import { UtmAreaContext, UtmAreaContextProps } from './UtmAreaContext';

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
 * Container component which allows sub components positioned relative to a long lat coordinate:
 * in the enclosing `UtmArea`, or, with none, on the enclosing `World`'s Earth.
 *
 * Recommended for what is given in longitude and latitude and is not a field's data (a
 * facility, a marker): outside the `UtmArea`, in the `World` (the second example), where it
 * stands on the Earth at the point at any distance. Inside a `UtmArea` it is field data, flat
 * in the area's map.
 *
 * @example
 * <UtmArea utmZone="31N" origin={[474000, 6522000]}>
 *  <Wgs84Position long={long} lat={lat}>
 *    { children }
 *  </Wgs84Position>
 * </UtmArea>
 *
 * @example
 * <World frame={frame} boundary={boundary}>
 *  <UtmArea crsInstance={crs} boundary={boundary}>
 *    { field data }
 *  </UtmArea>
 *  <Wgs84Position long={4.2} lat={60.6}>
 *    <PlatformModel />
 *  </Wgs84Position>
 * </World>
 *
 * @remarks
 * In a `UtmArea`, field data: through the area's map, and as flat as {@link UtmPosition}:
 * `altitude` is the area's Y. Far from the field, under a `Scenery` with its `globe` on, what
 * this places stands off the curved sea; see {@link UtmPosition}.
 *
 * In a `World` with no `UtmArea` around it, on the Earth: its children stand at the point on
 * the `World`'s globe, upright there and their −Z true north, at any distance from the field
 * (`placeGeoPoint`, `geoFrameMatrix`), and are placed again as the `World`'s frame or globe
 * changes (a switch of the anchor). `altitude` is their Y there, as in a `UtmArea`: the sea
 * lies at the globe's level. What is drawn about their origin lies on the globe's tangent
 * there, off the curve by `d² / 2R` at `d` from it (5 m at 8 km): for a facility, not a field.
 *
 * Outside both it throws.
 *
 * @see {@link UtmArea}
 * @see {@link World}
 *
 * @group Components
 */
export const Wgs84Position = (props: PropsWithChildren<Wgs84PositionProps>) => {
  const area = useContext(UtmAreaContext);
  const world = useWorld();
  if (area) return <AreaPosition area={area} {...props} />;
  if (world) return <EarthPosition world={world} {...props} />;
  throw Error(
    'Wgs84Position must be inside a UtmArea or a World: it places by the map of one or the Earth of the other.',
  );
};

const AreaPosition = ({
  area,
  long,
  lat,
  altitude = 0,
  children,
}: PropsWithChildren<Wgs84PositionProps & { area: UtmAreaContextProps }>) => {
  const position = useMemo(
    () => area.wgs84ToArea(long, lat, altitude),
    [long, lat, altitude, area],
  );

  return <group position={position}>{children}</group>;
};

const EarthPosition = ({
  world,
  long,
  lat,
  altitude = 0,
  children,
}: PropsWithChildren<Wgs84PositionProps & { world: WorldState }>) => {
  const placement = useMemo(
    () => placeGeoPoint(long, lat, world.frame),
    [long, lat, world.frame],
  );
  return (
    <EarthPlacement world={world} placement={placement} altitude={altitude}>
      {children}
    </EarthPlacement>
  );
};
