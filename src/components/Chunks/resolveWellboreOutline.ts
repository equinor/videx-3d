import { PlanarPolygonGeometry, Vec3 } from '../../sdk';
import { WellboreOutlineResponse, WellboreOutlineSpec } from './chunk-defs';
import {
  buildWellboreOutlineSpec,
  WellboreOutlineInterval,
} from './chunk-spec';
import { WellboreCutoutOptions } from './cutout';

type UtmToArea = (easting: number, northing: number, altitude?: number) => Vec3;

/** The `wellboreOutline` generator, as returned by `useGenerator`. */
export type WellboreOutlineGenerator = (
  spec: WellboreOutlineSpec,
) => Promise<WellboreOutlineResponse | null>;

/**
 * Resolve a wellbore-derived {@link CutoutSource} into a scene-XZ outline polygon,
 * built off the main thread by the `wellboreOutline` generator.
 *
 * Each well's trajectory is cut against EVERY interval, so each stretch of it is
 * buffered with the margin of the depth interval it falls in.
 *
 * ⭐ That per-interval margin is what makes an accumulated outline nest: a deeper
 * chunk's path set contains the shallower one's with the same margins, so its
 * outline contains it whether or not the margin grows with depth. One interval is
 * the ordinary `'window'` case.
 *
 * @internal
 */
export async function resolveWellboreOutline(
  generator: WellboreOutlineGenerator,
  wellbores: string[],
  options: WellboreCutoutOptions | undefined,
  intervals: WellboreOutlineInterval[],
  utmToArea: UtmToArea,
): Promise<PlanarPolygonGeometry | null> {
  if (intervals.length === 0) return null;
  const response = await generator(
    buildWellboreOutlineSpec(wellbores, options, intervals, utmToArea),
  );
  if (!response) return null;
  if (response.metrics) options?.onMetrics?.(response.metrics);
  return response.coordinates
    ? new PlanarPolygonGeometry(response.coordinates)
    : null;
}
