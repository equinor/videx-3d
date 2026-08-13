import { Vec2, Vec3 } from '../types/common';

/**
 * Options for {@link drapePolyline}.
 *
 * @group Geometries
 */
export type DrapePolylineOptions = {
  /** distance between sampled nodes along the route, in metres. Default 25. */
  spacing?: number;
  /**
   * Lift the line this far above the surface, in metres — pass the object's own
   * radius and it RESTS on the ground rather than being centred in it. Default 0.
   */
  clearance?: number;
  /**
   * Longest hollow the line bridges, in metres. Default 0, which drapes it over
   * every dip exactly.
   *
   * ⭐ A pipeline is stiff: it rests on the high points and SPANS the hollows
   * between them, so following the ground exactly is the one shape it definitely
   * does not take. This takes a rolling MAXIMUM over the window, which is that
   * behaviour and nothing more — no mechanics are pretended. Being a maximum, it
   * can only ever move the line UP, so it cannot push it into the ground.
   */
  span?: number;
  /**
   * Rounds off the corners `span` leaves, over a window in metres. Default 0.
   *
   * ⚠️ A shape filter, not an analysis. It is applied before the clearance and
   * clamped back to the ground, so it cannot sink the line either.
   */
  smoothing?: number;
};

/**
 * A route laid onto a surface by {@link drapePolyline}.
 *
 * @group Geometries
 */
export type DrapedPolyline = {
  /** the draped centreline, in scene XYZ */
  points: Vec3[];
  /** its length in 3D, which exceeds the map length by the ground it climbs */
  length: number;
  /**
   * Nodes that found no surface. ⭐ Their height is interpolated from the
   * neighbours that did, so the line stays continuous — and this number says how
   * much of it is a guess.
   */
  gaps: number;
  /** greatest height `span` lifted the line off the ground (m) */
  lifted: number;
};

/** Nodes every `spacing` along the route, the given vertices always included. */
function densify(route: Vec2[], spacing: number): Vec2[] {
  const out: Vec2[] = [route[0]];
  for (let i = 1; i < route.length; i++) {
    const [ax, az] = route[i - 1];
    const [bx, bz] = route[i];
    const dx = bx - ax;
    const dz = bz - az;
    const length = Math.hypot(dx, dz);
    const steps = Math.floor(length / spacing);
    for (let s = 1; s <= steps; s++) {
      const t = (s * spacing) / length;
      if (t < 1) out.push([ax + dx * t, az + dz * t]);
    }
    out.push(route[i]);
  }
  return out;
}

/** Rolling maximum over ±`half` nodes. */
function rollingMax(values: Float64Array, half: number): Float64Array {
  if (half < 1) return values;
  const out = new Float64Array(values.length);
  for (let i = 0; i < values.length; i++) {
    const from = Math.max(0, i - half);
    const to = Math.min(values.length - 1, i + half);
    let best = values[from];
    for (let j = from + 1; j <= to; j++) {
      if (values[j] > best) best = values[j];
    }
    out[i] = best;
  }
  return out;
}

/** Moving average over ±`half` nodes. */
function smooth(values: Float64Array, half: number): Float64Array {
  if (half < 1) return values;
  const out = new Float64Array(values.length);
  for (let i = 0; i < values.length; i++) {
    const from = Math.max(0, i - half);
    const to = Math.min(values.length - 1, i + half);
    let sum = 0;
    for (let j = from; j <= to; j++) sum += values[j];
    out[i] = sum / (to - from + 1);
  }
  return out;
}

/**
 * Lay a route onto a surface: sample the ground along it and return the line that
 * follows it — a pipeline, a cable, a survey line.
 *
 * The route is given in scene XZ (a map route in UTM is mapped through
 * `UtmArea` first), and sampled against whatever height function it is handed —
 * typically a `SurfaceSampler` over the drawn sea bed, so the line follows the
 * surface as it is SEEN rather than the grid it was built from.
 *
 * @param route the route's vertices in scene XZ, in order
 * @param heightAt ground height at a world X/Z, `null` where there is none
 * @returns the draped line, or `null` when the route finds no surface at all
 *
 * @group Geometries
 */
export function drapePolyline(
  route: Vec2[],
  heightAt: (x: number, z: number) => number | null,
  options: DrapePolylineOptions = {},
): DrapedPolyline | null {
  if (route.length < 2) return null;
  const spacing = Math.max(options.spacing ?? 25, 0.1);
  const nodes = densify(route, spacing);

  const ground = new Float64Array(nodes.length);
  const known: number[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const height = heightAt(nodes[i][0], nodes[i][1]);
    if (height !== null && Number.isFinite(height)) {
      ground[i] = height;
      known.push(i);
    }
  }
  if (known.length === 0) return null;
  const gaps = nodes.length - known.length;

  // Carry the unknown nodes between the ones that are known, so a stretch running
  // off the drawn surface leaves the line continuous rather than broken.
  for (let k = 0; k < known.length - 1; k++) {
    const a = known[k];
    const b = known[k + 1];
    for (let i = a + 1; i < b; i++) {
      ground[i] = ground[a] + ((ground[b] - ground[a]) * (i - a)) / (b - a);
    }
  }
  ground.fill(ground[known[0]], 0, known[0]);
  ground.fill(ground[known[known.length - 1]], known[known.length - 1] + 1);

  const spanHalf = Math.round((options.span ?? 0) / 2 / spacing);
  const shaped = rollingMax(ground, spanHalf);
  const smoothed = smooth(
    shaped,
    Math.round((options.smoothing ?? 0) / 2 / spacing),
  );

  const clearance = options.clearance ?? 0;
  const points: Vec3[] = [];
  let lifted = 0;
  let length = 0;
  for (let i = 0; i < nodes.length; i++) {
    // Clamped back to the ground: the smoothing is an average and would otherwise
    // pull the line down into it between two highs.
    const y = Math.max(smoothed[i], ground[i]) + clearance;
    lifted = Math.max(lifted, y - clearance - ground[i]);
    points.push([nodes[i][0], y, nodes[i][1]]);
    if (i > 0) {
      const [px, py, pz] = points[i - 1];
      length += Math.hypot(nodes[i][0] - px, y - py, nodes[i][1] - pz);
    }
  }

  return { points, length, gaps, lifted };
}
