import proj4 from 'proj4';
import { PropsWithChildren, useContext, useMemo } from 'react';
import { CRS } from '../../sdk/projection/crs';
import { placeMapPoint } from '../../sdk/projection/geo-frame';
import { useWorld, WorldState } from '../World/world-context';
import { EarthPlacement } from './EarthPlacement';
import { UtmAreaContext, UtmAreaContextProps } from './UtmAreaContext';

/**
 * UtmPosition props
 * @expand
 */
export type UtmPositionProps = {
  easting: number;
  northing: number;
  altitude?: number;
  /**
   * The map `easting` and `northing` are in: a proj4 definition (`getProjectionDefFromUtmZone`
   * gives a UTM zone's, in a datum of your choice), a name proj4 knows, or a `CRS`. Inside a
   * `UtmArea` default the area's own. In a `World` with no `UtmArea` around it, required.
   */
  projection?: string | CRS;
};

/**
 * Container component which allows sub components positioned relative to a UTM coordinate: in
 * the enclosing `UtmArea`, or, given its `projection`, on the enclosing `World`'s Earth.
 *
 * @example
 * <UtmArea utmZone="31N" origin={[474000, 6522000]}>
 *  <UtmPosition easting={easting} northing={northing}>
 *    { children }
 *  </UtmPosition>
 * </UtmArea>
 *
 * @example
 * <World frame={frame} boundary={boundary}>
 *  <UtmArea crsInstance={crs} boundary={boundary}>
 *    { field data }
 *  </UtmArea>
 *  <UtmPosition projection={getProjectionDefFromUtmZone('32N', 'WGS84')} easting={512000} northing={6735000}>
 *    <PlatformModel />
 *  </UtmPosition>
 * </World>
 *
 * @remarks
 * In a `UtmArea`, field data: its easting and northing are in the area's map, or converted to
 * it from `projection`'s, and placed flat: `altitude` is the area's Y, whatever the Earth does
 * there. Under a `Scenery` with its `globe` on that is exact over the sky's flat disc (the one
 * holding the stage's `boundary`), where a field lies. Beyond it the sea falls away with the
 * globe and what this places does not: for a disc of 10 km, at sea level it stands about 25 m
 * over the sea 20 km from the field's middle, 780 m at 100 km and 3.1 km at 200 km, upright in
 * the scene rather than on the globe's up (1.8° apart at 200 km).
 *
 * In a `World` with no `UtmArea` around it, given its `projection`, on the Earth: its children
 * stand at the point on the `World`'s globe, upright there, their X/Z along that map's grid
 * (east and south) and scaled as it is there (`placeMapPoint`, `geoFrameMatrix`), at any
 * distance from the field, and are placed again as the `World`'s frame or globe changes (a
 * switch of the anchor). `altitude` is their Y there, the sea at the globe's level. What is
 * drawn about their origin lies on the globe's tangent there, off the curve by `d² / 2R` at
 * `d` from it (5 m at 8 km): for a facility, not a field. Without a `projection` there, it
 * throws: the `World`'s own map is the anchored field's, and changes with it.
 *
 * Outside both it throws. For a point given in longitude and latitude, see
 * {@link Wgs84Position}.
 *
 * @see {@link UtmArea}
 * @see {@link World}
 *
 * @group Components
 */
export const UtmPosition = (props: PropsWithChildren<UtmPositionProps>) => {
  const area = useContext(UtmAreaContext);
  const world = useWorld();
  const projection =
    typeof props.projection === 'string'
      ? props.projection
      : props.projection?.utmDef;
  if (area)
    return <AreaPosition area={area} {...props} projection={projection} />;
  if (world && projection)
    return <MapPosition world={world} {...props} projection={projection} />;
  throw Error(
    world
      ? 'UtmPosition in a World with no UtmArea around it needs its `projection`: the World\u2019s own map is the anchored field\u2019s, and changes with it.'
      : 'UtmPosition must be inside a UtmArea, or in a World with its `projection`: its easting and northing are in a map.',
  );
};

const AreaPosition = ({
  area,
  easting,
  northing,
  altitude = 0,
  projection,
  children,
}: PropsWithChildren<
  Omit<UtmPositionProps, 'projection'> & {
    area: UtmAreaContextProps;
    projection?: string;
  }
>) => {
  const own = area.frame.projection;
  const position = useMemo(() => {
    const [e, n] =
      projection && projection !== own
        ? proj4(projection, own, [easting, northing])
        : [easting, northing];
    return area.utmToArea(e, n, altitude);
  }, [easting, northing, altitude, projection, own, area]);

  return <group position={position}>{children}</group>;
};

const MapPosition = ({
  world,
  easting,
  northing,
  altitude = 0,
  projection,
  children,
}: PropsWithChildren<
  Omit<UtmPositionProps, 'projection'> & {
    world: WorldState;
    projection: string;
  }
>) => {
  const placement = useMemo(
    () => placeMapPoint(projection, easting, northing, world.frame),
    [projection, easting, northing, world.frame],
  );
  return (
    <EarthPlacement world={world} placement={placement} altitude={altitude}>
      {children}
    </EarthPlacement>
  );
};
