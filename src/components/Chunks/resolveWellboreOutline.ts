import {
  ChunkSurfaceLayer,
  clusterPoints2D,
  collectTrajectoryPoints,
  createSurfaceDepthSampler,
  createWellboreOutline,
  PlanarPolygonGeometry,
  PositionLog,
  Store,
  Vec2,
  Vec3,
  WellboreHeader,
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
 * Resolve a wellbore-derived {@link CutoutSource} into a scene-XZ outline polygon.
 *
 * For each wellbore, the MSL-normalized position log (head-relative deltas) is
 * placed into the scene frame via `utmToArea(head.easting + dE, -tvdMsl,
 * head.northing + dN)` — the exact frame the surfaces use — then densified,
 * clipped to the chunk's vertical window (between its `top` and `base` surfaces),
 * clustered, and turned into an outline by the SDK `createWellboreOutline`
 * pipeline.
 *
 * @internal
 */
export async function resolveWellboreOutline(
  wellbores: string[],
  options: WellboreCutoutOptions | undefined,
  top: ChunkSurfaceLayer,
  base: ChunkSurfaceLayer,
  store: Store,
  utmToArea: UtmToArea,
): Promise<PlanarPolygonGeometry | null> {
  const radius = options?.radius ?? 500;
  const sampleSpacing = options?.sampleSpacing ?? 50;
  const clusterDistance = options?.clusterDistance ?? radius * 2;
  const tolerance = options?.tolerance ?? 0;

  const topSampler = createSurfaceDepthSampler(top);
  const baseSampler = createSurfaceDepthSampler(base);

  const all: Vec2[] = [];
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
      const kept = collectTrajectoryPoints(
        dense,
        topSampler,
        baseSampler,
        tolerance,
      );
      for (const p of kept) all.push(p);
    }),
  );

  if (all.length === 0) return null;
  const clusters = clusterPoints2D(all, clusterDistance);
  return createWellboreOutline(clusters, { ...options, radius });
}
