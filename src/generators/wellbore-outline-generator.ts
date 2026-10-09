import {
  WellboreOutlineResponse,
  WellboreOutlineSpec,
} from '../components/Chunks/chunk-defs';
import {
  collectTrajectoryRuns,
  createSurfaceDepthSampler,
  PositionLog,
  ReadonlyStore,
  Vec3,
  WellboreHeader,
  WellborePath,
} from '../sdk';
import { buildOutlineCoordinates } from './workers/stack-worker-pool';

/**
 * Build a chunk's wellbore-derived outline: every well's trajectory is cut to the
 * spec's depth intervals, each run buffered with its interval's margin, and the
 * result contoured into an outline.
 *
 * ⭐ The bounding surfaces are read here, next to the store, and never leave this
 * thread — only the cut runs go to the worker pool for the raster.
 *
 * @group Generators
 */
export async function generateWellboreOutline(
  this: ReadonlyStore,
  spec: WellboreOutlineSpec,
): Promise<WellboreOutlineResponse | null> {
  const options = spec.options ?? {};

  const samplers = await Promise.all(
    spec.surfaces.map(async surface => {
      const values = await this.get<Float32Array>('surface-values', surface.id);
      return values ? createSurfaceDepthSampler({ ...surface, values }) : null;
    }),
  );
  // An interval whose bound failed to load would be silently unbounded, which
  // grows the outline rather than shrinking it — drop it instead.
  const bounds = spec.intervals.flatMap(({ top, base, radius }) => {
    const topSampler = top === null ? null : samplers[top];
    const baseSampler = base === null ? null : samplers[base];
    if ((top !== null && !topSampler) || (base !== null && !baseSampler))
      return [];
    return [{ top: topSampler, base: baseSampler, radius }];
  });
  if (bounds.length === 0) return null;

  const window = {
    tolerance: options.tolerance ?? 0,
    unmapped: options.unmapped,
  };
  const spacing = options.sampleSpacing ?? 50;
  const m = spec.utmToScene;

  const perWell = await Promise.all(
    spec.wellbores.map(async id => {
      const [header, log] = await Promise.all([
        this.get<WellboreHeader>('wellbore-headers', id),
        this.get<PositionLog>('position-logs', id),
      ]);
      if (!header || !log || log.length < 2 * 4) return [];
      // Groups of 4, MSL-normalized deltas from the wellhead: [dE, tvd, dN, ...].
      const points: Vec3[] = [];
      for (let j = 0; j + 3 < log.length; j += 4) {
        const e = header.easting + log[j];
        const n = header.northing + log[j + 2];
        const a = -log[j + 1];
        points.push([
          m[0] * e + m[1] * n + m[2] * a + m[3],
          m[4] * e + m[5] * n + m[6] * a + m[7],
          m[8] * e + m[9] * n + m[10] * a + m[11],
        ]);
      }
      const dense = densifyPolyline(points, spacing);
      const paths: WellborePath[] = [];
      for (const bound of bounds)
        for (const run of collectTrajectoryRuns(
          dense,
          bound.top,
          bound.base,
          window,
        ))
          paths.push({ points: run, radius: bound.radius });
      return paths;
    }),
  );
  // Flattened in well order, so the result does not depend on which store call
  // answered first.
  const paths = perWell.flat();
  if (paths.length === 0) return null;

  return buildOutlineCoordinates(paths, {
    ...options,
    radius: options.radius ?? 500,
  });
}

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
