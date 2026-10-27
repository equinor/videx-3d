import { PropsWithChildren, useContext, useMemo } from 'react';
import { UtmAreaContext } from './UtmAreaContext';

/**
 * UtmPosition props
 * @expand
 */
export type UtmPositionProps = {
  easting: number;
  northing: number;
  altitude?: number;
};

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
 * @remarks
 * Flat: `altitude` is the area's Y, whatever the Earth does there. Under a `Scenery` with its
 * `globe` on that is exact over the sky's flat disc (a `SceneryStage`'s `bounds`), where
 * a field lies. Beyond it the sea falls away with the globe and what this places does not:
 * for a disc of 10 km, at sea level it stands about 25 m over the sea 20 km from the
 * field's middle, 780 m at 100 km and 3.1 km at 200 km, upright in the scene rather than
 * on the globe's up (1.8° apart at 200 km). To put such content on the globe, wrap it in a
 * `SceneryAnchor` at its point (`at`, from `utmToArea`). See documents/world.md, For a host.
 *
 * @see {@link UtmArea}
 *
 * @group Components
 */
export const UtmPosition = ({
  easting,
  northing,
  altitude = 0,
  children,
}: PropsWithChildren<UtmPositionProps>) => {
  const context = useContext(UtmAreaContext);
  const position = useMemo(
    () => context.utmToArea(easting, northing, altitude),
    [easting, northing, altitude, context],
  );

  return <group position={position}>{children}</group>;
};
