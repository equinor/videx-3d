import {
  ChunkSurfaceLayer,
  collectTrajectoryRuns,
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
 * placed into the scene frame via `utmToArea(head.easting + dE, head.northing +
 * dN, -tvdMsl)` — the exact frame the surfaces use — then densified, cut to the
 * depth window the {@link WellboreOutlineMode} asks for, and buffered into an
 * outline by the SDK `createWellboreOutline` pipeline.
 *
 * `top` and `base` are the chunk's bounding surfaces; `'above'` uses only `base`
 * and `'below'` only `top`, so the unused one is simply ignored.
 *
 * ⭐ The stack's ENVELOPE stays correct under every mode without special casing:
 * resolving it against the column's shallowest and deepest surfaces gives exactly
 * the widest window any chunk can ask for, since a chunk's own bounds are always
 * a sub-range of the column's.
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
  const mode = options?.mode ?? 'window';
  const window = {
    tolerance: options?.tolerance ?? 0,
    unmapped: options?.unmapped,
  };

  const topSampler = mode === 'above' ? null : createSurfaceDepthSampler(top);
  const baseSampler = mode === 'below' ? null : createSurfaceDepthSampler(base);

  const paths: Vec2[][] = [];
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
      for (const run of collectTrajectoryRuns(
        dense,
        topSampler,
        baseSampler,
        window,
      ))
        paths.push(run);
    }),
  );

  if (paths.length === 0) return null;
  return createWellboreOutline(paths, { ...options, radius });
}
