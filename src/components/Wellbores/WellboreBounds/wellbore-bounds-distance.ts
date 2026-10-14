/**
 * Distance from `(x, y, z)` (the bounds' own frame) to a wellbore's bounds, as
 * `WellboreBounds` reports it: `spheres` is the generator's output, the main
 * sphere `[cx, cy, cz, r]` first and then each sampled one. Outside the main
 * sphere it is at least the main radius; inside it, the nearest sampled sphere.
 * Divided by `zoom`, so a zoomed-in camera reads as nearer.
 *
 * @internal
 */
export function wellboreBoundsDistance(
  spheres: ArrayLike<number>,
  x: number,
  y: number,
  z: number,
  zoom: number,
): number {
  const radius = spheres[3];
  const main = (sphereDistance(spheres, 0, x, y, z) - radius) / zoom;
  if (spheres.length <= 4) return Math.max(0, main);
  if (main > 0) return Math.max(radius, main);
  let nearest = radius;
  for (let i = 4; i + 3 < spheres.length; i += 4) {
    const d = Math.max(0, (sphereDistance(spheres, i, x, y, z) - spheres[i + 3]) / zoom);
    if (d < nearest) nearest = d;
  }
  return nearest;
}

function sphereDistance(
  spheres: ArrayLike<number>,
  at: number,
  x: number,
  y: number,
  z: number,
) {
  const dx = x - spheres[at];
  const dy = y - spheres[at + 1];
  const dz = z - spheres[at + 2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
