import { useContext, useEffect, useState } from 'react';
import { Vec2 } from '../../../sdk/types/common';
import { UtmAreaContext } from '../../UtmArea/UtmAreaContext';
import { Grid, GridProps } from './Grid';

type GridConfig = {
  origin: Vec2;
  originValue: Vec2;
  gridScale: Vec2;
};

/**
 * UtmGrid props: a `Grid`'s, less where its axes cross and what they read, which the
 * `UtmArea` sets.
 * @expand
 */
export type UtmGridProps = Omit<
  GridProps,
  'gridOrigin' | 'originValue' | 'gridScale'
> & {
  /** Label the axes in metres from the area's origin instead of in UTM coordinates. */
  relativeValues?: boolean;
};

/**
 * A `Grid` in UTM coordinates, inside a `UtmArea`: its axes cross at the area's origin and are
 * labelled with eastings and northings on the ground (`plane` `'xz'`), or with eastings or
 * northings and heights on a wall (`'xy'`, `'zy'`). With `relativeValues`, in metres from the
 * origin instead.
 *
 * @example
 * <UtmGrid
 *   size={[30000, 30000]}
 *   cellSize={1000}
 *   subDivisions={5}
 *   gridLineWidth={0.015}
 *   opacity={0.9}
 *   showAxes
 *   showRulers
 * />
 *
 * @remarks
 * This component needs to be a child of the `UtmArea` component in order to work.
 *
 * @see {@link Grid}
 *
 * @group Components
 */
export const UtmGrid = (props: UtmGridProps) => {
  const areaContext = useContext(UtmAreaContext);
  const [gridConfig, setGridConfig] = useState<GridConfig>({
    origin: [0, 0],
    originValue: [0, 0],
    gridScale: [1, 1],
  });

  useEffect(() => {
    const worldPosition = areaContext.getWorldPosition();
    let origin: Vec2, originValue: Vec2, gridScale: Vec2;

    if (props.plane === 'xz') {
      origin = [worldPosition[0], worldPosition[2]];
      gridScale = [1, -1];
      originValue = props.relativeValues
        ? [0, 0]
        : [areaContext.originUtm[0], areaContext.originUtm[1]];
    } else if (props.plane === 'xy') {
      origin = [worldPosition[0], worldPosition[1]];
      gridScale = [1, 1];
      originValue = props.relativeValues
        ? [0, 0]
        : [areaContext.originUtm[0], 0];
    } else {
      origin = [worldPosition[2], worldPosition[1]];
      gridScale = [-1, 1];
      originValue = props.relativeValues
        ? [0, 0]
        : [areaContext.originUtm[1], 0];
    }

    setGridConfig({ origin, originValue, gridScale });
  }, [areaContext, props.plane, props.relativeValues]);

  return (
    <Grid
      {...props}
      gridOrigin={gridConfig.origin}
      originValue={gridConfig.originValue}
      gridScale={gridConfig.gridScale}
    />
  );
};
