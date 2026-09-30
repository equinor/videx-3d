import {
  ChunkSurfaceLayer,
  collectTrajectoryRuns,
  createSurfaceDepthSampler,
  createWellboreOutline,
  PlanarPolygonGeometry,
  PositionLog,
  Store,
  Vec3,
  WellboreHeader,
  WellborePath,
} from '../../sdk';
import { WellboreCutoutOptions } from './cutout';

type UtmToArea = (easting: number, northing: number, altitude?: number) => Vec3;

/** Densify a scene-space polyline so no gap between points exceeds `spacing`. */
function densifyPolyline(points: Vec3[], spacing: number): Vec3[] {
  if (points.length < 2 || spacing <= 0) return points;
  const out: Vec3[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const dz = b[2] - a[2];
    const len = Math.hypot(dx, dy, dz);
    const steps = Math.floor(len / spacing);
    for (let s = 1; s < steps; s++) {
      const t = (s * spacing) / len;
      out.push([a[0] + dx * t, a[1] + dy * t, a[2] + dz * t]);
    }
    out.push(b);
  }
  return out;
}

/**
 * One depth interval of the outline, and the margin the trajectory inside it is
 * buffered with. Either bound may be `null`, which makes that side unbounded (the
 * wellhead above, TD below).
 *
 * @internal
 */
export type WellboreOutlineInterval = {
  top: ChunkSurfaceLayer | null;
  base: ChunkSurfaceLayer | null;
  radius: number;
};

/**
 * Resolve a wellbore-derived {@link CutoutSource} into a scene-XZ outline polygon.
 *
 * For each wellbore, the MSL-normalized position log (head-relative deltas) is
 * placed into the scene frame via `utmToArea(head.easting + dE, head.northing +
 * dN, -tvdMsl)` — the exact frame the surfaces use — then densified once and cut
 * against EVERY interval, so each stretch of trajectory is buffered with the
 * margin of the depth interval it falls in.
 *
 * ⭐ That per-interval margin is what makes an accumulated outline nest: a deeper
 * chunk's path set contains the shallower one's with the same margins, so its
 * outline contains it whether or not the margin grows with depth. One interval is
 * the ordinary `'window'` case.
 *
 * @internal
 */
export async function resolveWellboreOutline(
  wellbores: string[],
  options: WellboreCutoutOptions | undefined,
  intervals: WellboreOutlineInterval[],
  store: Store,
  utmToArea: UtmToArea,
): Promise<PlanarPolygonGeometry | null> {
  if (intervals.length === 0) return null;
  const radius = options?.radius ?? 500;
  const sampleSpacing = options?.sampleSpacing ?? 50;
  const window = {
    tolerance: options?.tolerance ?? 0,
    unmapped: options?.unmapped,
  };

  const bounds = intervals.map(interval => ({
    top: interval.top ? createSurfaceDepthSampler(interval.top) : null,
    base: interval.base ? createSurfaceDepthSampler(interval.base) : null,
    radius: interval.radius,
  }));

  const paths: WellborePath[] = [];
  await Promise.all(
    wellbores.map(async id => {
      const [header, poslog] = await Promise.all([
        store.get<WellboreHeader>('wellbore-headers', id),
        store.get<PositionLog>('position-logs', id),
      ]);
      if (!header || !poslog || poslog.length < 2 * 4) return;
      const scenePts: Vec3[] = [];
      for (let j = 0; j + 3 < poslog.length; j += 4) {
        const east = header.easting + poslog[j];
        const tvd = poslog[j + 1];
        const north = header.northing + poslog[j + 2];
        // utmToArea signature is (easting, northing, altitude); depth is
        // downward-negative altitude.
        scenePts.push(utmToArea(east, north, -tvd));
      }
      const dense = densifyPolyline(scenePts, sampleSpacing);
      for (const bound of bounds)
        for (const run of collectTrajectoryRuns(
          dense,
          bound.top,
          bound.base,
          window,
        ))
          paths.push({ points: run, radius: bound.radius });
    }),
  );

  if (paths.length === 0) return null;
  return createWellboreOutline(paths, { ...options, radius });
}
