import { BufferAttribute, BufferGeometry } from 'three';
import { Vec2 } from '../types/common';

/**
 * Extract the boundary loops of an indexed triangle mesh as ordered arrays of
 * vertex indices. A boundary edge is one used by a single triangle, so the
 * loops include both the outer outline and any internal hole rings. Useful for
 * outlining a mesh or relaxing/snapping only its rim vertices.
 *
 * @group Geometries
 */
export function extractBoundaryLoops(geometry: BufferGeometry): number[][] {
  const index = geometry.getIndex();
  const posAttr = geometry.getAttribute('position') as BufferAttribute;
  if (!index || !posAttr) return [];
  const idx = index.array;
  const n = posAttr.count;
  const keyOf = (a: number, b: number) => (a < b ? a * n + b : b * n + a);
  const tri: Vec2[] = [
    [0, 1],
    [1, 2],
    [2, 0],
  ];
  const count = new Map<number, number>();
  for (let i = 0; i + 2 < idx.length; i += 3) {
    for (const [u, v] of tri) {
      const k = keyOf(idx[i + u], idx[i + v]);
      count.set(k, (count.get(k) ?? 0) + 1);
    }
  }
  const adj = new Map<number, number[]>();
  const link = (a: number, b: number) => {
    let l = adj.get(a);
    if (!l) {
      l = [];
      adj.set(a, l);
    }
    if (!l.includes(b)) l.push(b);
  };
  for (let i = 0; i + 2 < idx.length; i += 3) {
    for (const [u, v] of tri) {
      const a = idx[i + u];
      const b = idx[i + v];
      if (count.get(keyOf(a, b)) === 1) {
        link(a, b);
        link(b, a);
      }
    }
  }
  const visited = new Set<number>();
  const loops: number[][] = [];
  for (const start of adj.keys()) {
    const startNeighbors = adj.get(start)!;
    if (startNeighbors.every(nb => visited.has(keyOf(start, nb)))) continue;
    const loop: number[] = [];
    let prev = -1;
    let cur = start;
    while (cur !== -1) {
      loop.push(cur);
      const neighbors = adj.get(cur)!;
      let next = -1;
      for (const nb of neighbors) {
        if (nb !== prev && !visited.has(keyOf(cur, nb))) {
          next = nb;
          break;
        }
      }
      if (next === -1) {
        for (const nb of neighbors) {
          if (!visited.has(keyOf(cur, nb))) {
            next = nb;
            break;
          }
        }
      }
      if (next === -1) break;
      visited.add(keyOf(cur, next));
      prev = cur;
      cur = next === start ? -1 : next;
    }
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}

/**
 * Smooth the given vertex loops (e.g. from {@link extractBoundaryLoops}) in
 * place with an iterated windowed moving average, moving only the X/Z position
 * of the existing boundary vertices and leaving their Y untouched. Unlike a
 * local corner-cutting pass (which only rounds individual steps into small
 * arcs), the averaging window spans several vertices, so long grid-aligned
 * staircase runs collapse onto their straight centre line — the rim reads as one
 * continuous curve rather than a chain of little bumps. The window grows with
 * `strength`.
 *
 * @group Geometries
 */
export function smoothBoundaryLoops(
  geometry: BufferGeometry,
  loops: number[][],
  strength: number,
): void {
  const pos = geometry.getAttribute('position') as BufferAttribute;
  if (!pos) return;
  const passes = 2;
  for (const loop of loops) {
    const m = loop.length;
    if (m < 4) continue;
    // Half-window grows with strength; capped so small loops/holes stay intact.
    const radius = Math.max(1, Math.min(strength * 2, Math.floor((m - 1) / 3)));
    let xs = new Float64Array(m);
    let zs = new Float64Array(m);
    for (let k = 0; k < m; k++) {
      xs[k] = pos.getX(loop[k]);
      zs[k] = pos.getZ(loop[k]);
    }
    // Two box-filter passes approximate a Gaussian (a smooth, continuous curve).
    for (let p = 0; p < passes; p++) {
      const nx = new Float64Array(m);
      const nz = new Float64Array(m);
      for (let k = 0; k < m; k++) {
        let sx = 0;
        let sz = 0;
        for (let d = -radius; d <= radius; d++) {
          const j = (((k + d) % m) + m) % m;
          sx += xs[j];
          sz += zs[j];
        }
        const cnt = radius * 2 + 1;
        nx[k] = sx / cnt;
        nz[k] = sz / cnt;
      }
      xs = nx;
      zs = nz;
    }
    for (let k = 0; k < m; k++) {
      pos.setX(loop[k], xs[k]); // depth (Y) left untouched
      pos.setZ(loop[k], zs[k]);
    }
  }
  pos.needsUpdate = true;
}

/**
 * Snap the boundary (rim) vertices of an indexed mesh onto the nearest point of
 * a set of reference polylines (closed world-X/Z outlines). Used to pull a mesh
 * rim exactly onto a shared outline, so two meshes that meet at an edge (e.g. a
 * surface and the floor it bounds) share one rim curve instead of two
 * independently triangulated (and diverging) ones.
 *
 * When `getY` is provided, each snapped rim vertex's Y is also set to
 * `getY(x, z)` at its new position, so the rim can be pinned to a shared height
 * as well as X/Z. When omitted, only X/Z are moved and Y is left as-is.
 *
 * @group Geometries
 */
export function snapBoundaryToOutline(
  geometry: BufferGeometry,
  polylines: Vec2[][],
  getY?: (x: number, z: number) => number,
): void {
  const pos = geometry.getAttribute('position') as BufferAttribute;
  if (!pos) return;
  const loops = extractBoundaryLoops(geometry);
  const seen = new Set<number>();
  for (const loop of loops) {
    for (const vi of loop) {
      if (seen.has(vi)) continue;
      seen.add(vi);
      const px = pos.getX(vi);
      const pz = pos.getZ(vi);
      let bestX = px;
      let bestZ = pz;
      let bestD = Infinity;
      for (const pl of polylines) {
        for (let i = 0; i + 1 < pl.length; i++) {
          const ax = pl[i][0];
          const az = pl[i][1];
          const ex = pl[i + 1][0] - ax;
          const ez = pl[i + 1][1] - az;
          const len2 = ex * ex + ez * ez || 1;
          let t = ((px - ax) * ex + (pz - az) * ez) / len2;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const qx = ax + ex * t;
          const qz = az + ez * t;
          const d = (px - qx) * (px - qx) + (pz - qz) * (pz - qz);
          if (d < bestD) {
            bestD = d;
            bestX = qx;
            bestZ = qz;
          }
        }
      }
      pos.setX(vi, bestX);
      pos.setZ(vi, bestZ);
      if (getY) pos.setY(vi, getY(bestX, bestZ));
    }
  }
  pos.needsUpdate = true;
}
