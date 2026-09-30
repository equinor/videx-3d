import { useEffect, useMemo, useState } from 'react';
import { useData } from '../../hooks/useData';
import { Vec2 } from '../../sdk';
import { PositionLog } from '../../sdk/data/types/PositionLog';
import { WellboreHeader } from '../../sdk/data/types/WellboreHeader';
import {
  CoordinatesTransformFunction,
  PlanarPolygonGeometry,
} from '../../sdk/geometries/planar-geometry';
import { createWellboreOutline } from '../../sdk/geometries/wellbore-outline';
import { CRS, getProjectionDefFromUtmZone } from '../../sdk/projection/crs';
import storyArgs from '../story-args.json';

const crs = new CRS(
  getProjectionDefFromUtmZone(storyArgs.utmZone),
  storyArgs.origin as Vec2,
  'utm',
);

export type FieldOutlineOptions = {
  /** buffer margin around every trajectory, scene units (default 1500) */
  radius?: number;
  /** restrict to these wellbores; default is every wellbore with a position log */
  wellboreIds?: string[];
  /**
   * Remap scene XZ to the frame the caller works in. Mirroring is safe: the
   * outline is contoured AFTER the transform, so ring winding comes out right.
   * Three.js shapes are authored in XY with north up, so they want
   * `([x, z]) => [x, -z]`.
   */
  transform?: CoordinatesTransformFunction;
};

/**
 * The demo field's footprint, **derived from the wells** rather than read from a
 * field-outline file — storybook only.
 *
 * ⭐ A checked-in outline is a CRS trap: its coordinates only mean anything against
 * one field's origin and UTM zone, so swapping the dataset silently puts it in the
 * wrong place. Buffering the trajectories instead makes the footprint a
 * consequence of the data, correct for whichever field is loaded.
 *
 * The work is {@link createWellboreOutline}'s: each trajectory is buffered by
 * `radius` into a distance field and contoured, so the result is concave, follows
 * the well corridors, and splits into several components (or grows holes) exactly
 * where the buffers fail to meet.
 *
 * @returns the outline, or `null` until the position logs have loaded
 */
export const useFieldOutline = (
  options: FieldOutlineOptions = {},
): PlanarPolygonGeometry | null => {
  const store = useData();
  const { radius = 1500, wellboreIds, transform } = options;

  const [paths, setPaths] = useState<Vec2[][]>([]);

  useEffect(() => {
    let cancelled = false;
    if (!store) return;

    const build = async () => {
      const headers =
        (await store.all<WellboreHeader>('wellbore-headers')) || [];
      const selected = wellboreIds
        ? headers.filter(h => wellboreIds.includes(h.id))
        : headers;

      const logs = await Promise.all(
        selected.map(async header => {
          const log = await store.get<PositionLog>('position-logs', header.id);
          if (!log || log.length < 8) return null;
          const points: Vec2[] = [];
          for (let i = 0; i + 3 < log.length; i += 4) {
            const p = crs.utmToWorld(
              header.easting + log[i],
              header.northing + log[i + 2],
              0,
            );
            const xz: Vec2 = [p.x, p.z];
            points.push(transform ? transform(xz) : xz);
          }
          return points;
        }),
      );

      return logs.filter((p): p is Vec2[] => p !== null);
    };

    build().then(result => {
      if (!cancelled) setPaths(result);
    });

    return () => {
      cancelled = true;
    };
  }, [store, wellboreIds, transform]);

  return useMemo(() => {
    if (paths.length === 0) return null;
    return createWellboreOutline(paths, {
      radius,
      feather: 1,
      smoothing: 2,
    });
  }, [paths, radius]);
};
