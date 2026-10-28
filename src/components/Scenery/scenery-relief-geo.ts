import { Matrix4 } from 'three';
import type { Globe } from '../../sdk/projection/globe';
import { geoAt } from '../../sdk/tiles/geo-tile-globe';
import type { SceneryStageBounds } from './scenery-stage';

/**
 * The warp (`heightFieldWarp`) that takes world X/Z over `bounds` to `geoTileSquare`'s
 * coordinates scaled by `scale` about (`lon0`, `lat0`): the ground as the tiles draw it,
 * fitted with a quadratic about the middle by least squares over a 5 x 5 grid. What it
 * leaves is cubic, mostly a longitude's along a grid row far north: on the ground 2.4 mm
 * at the edge of an 8 km stage at 58°N, 19 mm at the edge of a 16 km one.
 */
export function geoWarp(
  globe: Globe,
  bounds: SceneryStageBounds,
  lon0: number,
  lat0: number,
  scale: number,
  target: Matrix4,
): Matrix4 {
  const [x0, z0, x1, z1] = bounds;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const hx = Math.max((x1 - x0) / 2, 1);
  const hz = Math.max((z1 - z0) / 2, 1);
  // Normal equations for q = a + b dx + c dz + d dx² + e dx dz + f dz², per coordinate.
  const ata = Array.from({ length: 6 }, () => new Float64Array(6));
  const atq = [new Float64Array(6), new Float64Array(6)];
  const row = new Float64Array(6);
  const there = { latitude: 0, longitude: 0 };
  for (let j = -2; j <= 2; j++) {
    for (let i = -2; i <= 2; i++) {
      const dx = (hx * i) / 2;
      const dz = (hz * j) / 2;
      geoAt(globe, cx + dx, cz + dz, there);
      const q = [
        (((((there.longitude - lon0 + 540) % 360) + 360) % 360) - 180) * scale,
        (lat0 - there.latitude) * scale,
      ];
      row.set([1, dx, dz, dx * dx, dx * dz, dz * dz]);
      for (let a = 0; a < 6; a++) {
        for (let b = 0; b < 6; b++) ata[a][b] += row[a] * row[b];
        atq[0][a] += row[a] * q[0];
        atq[1][a] += row[a] * q[1];
      }
    }
  }
  const [u, v] = atq.map(rhs => solve6(ata, rhs));
  return target.fromArray([
    cx,
    cz,
    u[0],
    v[0],
    u[1],
    u[2],
    v[1],
    v[2],
    u[3],
    u[4],
    u[5],
    0,
    v[3],
    v[4],
    v[5],
    0,
  ]);
}

// A 6 x 6 system by Gaussian elimination with partial pivoting.
function solve6(m: Float64Array[], rhs: Float64Array): number[] {
  const a = m.map((row, i) => [...row, rhs[i]]);
  for (let c = 0; c < 6; c++) {
    let pivot = c;
    for (let r = c + 1; r < 6; r++)
      if (Math.abs(a[r][c]) > Math.abs(a[pivot][c])) pivot = r;
    [a[c], a[pivot]] = [a[pivot], a[c]];
    for (let r = c + 1; r < 6; r++) {
      const f = a[r][c] / a[c][c];
      for (let k = c; k <= 6; k++) a[r][k] -= f * a[c][k];
    }
  }
  const x = new Array<number>(6).fill(0);
  for (let r = 5; r >= 0; r--) {
    let sum = a[r][6];
    for (let k = r + 1; k < 6; k++) sum -= a[r][k] * x[k];
    x[r] = sum / a[r][r];
  }
  return x;
}
