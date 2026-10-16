/** Floats per prepared chain segment: start `a`, direction `u = b - a`, `1 / |u|²`. */
const SEGMENT = 7;

/**
 * Prepares generated bounds (a sphere `[cx, cy, cz, r]`, then chain points
 * `[x, y, z, ...]`) for {@link wellboreBoundsDistance}: the sphere, then each chain
 * segment as `[ax, ay, az, ux, uy, uz, 1 / |u|²]`. A single point becomes one
 * zero-length segment.
 *
 * @internal
 */
export function prepareWellboreBounds(bounds: ArrayLike<number>): Float64Array {
  const points = Math.max(0, Math.floor((bounds.length - 4) / 3));
  const segments = points === 1 ? 1 : Math.max(0, points - 1);
  const out = new Float64Array(4 + segments * SEGMENT);
  for (let i = 0; i < 4; i++) out[i] = bounds[i];
  for (let s = 0; s < segments; s++) {
    const a = 4 + s * 3;
    const b = points === 1 ? a : a + 3;
    const ux = bounds[b] - bounds[a];
    const uy = bounds[b + 1] - bounds[a + 1];
    const uz = bounds[b + 2] - bounds[a + 2];
    const uu = ux * ux + uy * uy + uz * uz;
    const o = 4 + s * SEGMENT;
    out[o] = bounds[a];
    out[o + 1] = bounds[a + 1];
    out[o + 2] = bounds[a + 2];
    out[o + 3] = ux;
    out[o + 4] = uy;
    out[o + 5] = uz;
    out[o + 6] = uu > 0 ? 1 / uu : 0;
  }
  return out;
}

/**
 * Distance from `(x, y, z)` (the bounds' own frame) to a wellbore, as `WellboreBounds`
 * publishes it: to the chain, less `padding`, divided by `zoom`.
 *
 * Exact (to the chain's tolerance) below `exactWithin`. Beyond it, a cheaper value that
 * is never less than `exactWithin` nor more than the true distance: once the bounding
 * sphere alone is far enough, the distance to the sphere (one square root). It equals
 * `max(min(chain, cutoff), sphere)` everywhere, so it never jumps.
 *
 * @param bounds from {@link prepareWellboreBounds}
 *
 * @internal
 */
export function wellboreBoundsDistance(
  bounds: Float64Array,
  x: number,
  y: number,
  z: number,
  zoom: number,
  exactWithin: number,
  padding: number,
): number {
  const ex = x - bounds[0];
  const ey = y - bounds[1];
  const ez = z - bounds[2];
  const sphere = Math.sqrt(ex * ex + ey * ey + ez * ez) - bounds[3];
  const cutoff = exactWithin * zoom + padding;

  let distance = sphere;
  if (sphere < cutoff && bounds.length > 4) {
    let nearest = Infinity;
    for (let o = 4; o < bounds.length; o += SEGMENT) {
      const wx = x - bounds[o];
      const wy = y - bounds[o + 1];
      const wz = z - bounds[o + 2];
      const ux = bounds[o + 3];
      const uy = bounds[o + 4];
      const uz = bounds[o + 5];
      let t = (wx * ux + wy * uy + wz * uz) * bounds[o + 6];
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const dx = wx - t * ux;
      const dy = wy - t * uy;
      const dz = wz - t * uz;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < nearest) nearest = d;
    }
    distance = Math.max(Math.min(Math.sqrt(nearest), cutoff), sphere);
  }
  return Math.max(0, distance - padding) / zoom;
}
