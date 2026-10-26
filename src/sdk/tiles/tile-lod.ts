import { Box3, Frustum, Matrix4, Vector3 } from 'three';
import { selectLodLevel } from '../utils/lod';

// The level-of-detail rules a grid of tiles is chosen by, whatever the tiles hold: the
// chunks' fixed grids of tiles use them as they are, and `selectQuadtreeTiles` follows the
// same rules for a quadtree loaded as it is seen (see documents/tiles.md).

/**
 * Per tile, whether its prism — its footprint `corners` (four X/Z corners, eight numbers
 * per tile) over its `heights` (low, high pairs) — reaches into `frustum`, which must be
 * in the same frame. A tile is out only when all eight corners are behind one plane, so a
 * prism near a frustum corner stays in.
 *
 * @group Tiles
 */
export function tilesInView(
  frustum: Frustum,
  corners: ArrayLike<number>,
  heights: ArrayLike<number>,
  inView: Uint8Array,
): void {
  const planes = frustum.planes;
  for (let t = 0; t < inView.length; t++) {
    const low = heights[2 * t];
    const high = heights[2 * t + 1];
    let shows = 1;
    for (let p = 0; p < planes.length && shows; p++) {
      const { normal: n, constant } = planes[p];
      let behind = true;
      for (let k = 8 * t; k < 8 * t + 8 && behind; k += 2) {
        const d = n.x * corners[k] + n.z * corners[k + 1] + constant;
        if (d + n.y * low >= 0 || d + n.y * high >= 0) behind = false;
      }
      if (behind) shows = 0;
    }
    inView[t] = shows;
  }
}

const worldEye = new Vector3();
const nearest = new Vector3();

/**
 * Pick each tile's level of detail: the coarsest whose height error, projected at
 * the tile's nearest point to the eye, stays within `pixelError` pixels (see
 * `selectLodLevel`).
 *
 * @param eye the camera position in the boxes' frame
 * @param errors per level, the full one first: its height error, ascending
 * @param levels per tile, its current level; updated in place
 * @param scales per tile, written with its pixels per unit of height error when given
 * @param frame the boxes' frame to world, when the two differ: distances are
 *   measured in the world, and the height errors take its vertical scale (a
 *   vertical exaggeration)
 * @returns whether any tile changed level
 *
 * @group Tiles
 */
export function selectTileLevels(
  boxes: Box3[],
  eye: Vector3,
  scale: (distance: number) => number,
  errors: number[],
  pixelError: number,
  levels: Uint8Array,
  scales?: Float32Array,
  frame?: Matrix4,
): boolean {
  let changed = false;
  let vertical = 1;
  if (frame) {
    const m = frame.elements;
    vertical = Math.hypot(m[4], m[5], m[6]);
    worldEye.copy(eye).applyMatrix4(frame);
  }
  for (let t = 0; t < boxes.length; t++) {
    // Per axis is exact for the scale an exaggeration is: diagonal in the box's frame.
    const distance = frame
      ? boxes[t]
          .clampPoint(eye, nearest)
          .applyMatrix4(frame)
          .distanceTo(worldEye)
      : boxes[t].distanceToPoint(eye);
    const ppu = scale(distance) * vertical;
    if (scales) scales[t] = ppu;
    const k = selectLodLevel(errors, ppu, pixelError, levels[t]);
    if (k !== levels[t]) {
      levels[t] = k;
      changed = true;
    }
  }
  return changed;
}

/**
 * The tiles whose drawn level (`applied`) is not the one wanted (`levels`), in the
 * order to redraw them: those that need more detail first, the most visible error
 * (`excess`, e.g. pixels) first; then those that can do with less, the least
 * visible first.
 *
 * @group Tiles
 */
export function orderTileChanges(
  levels: Uint8Array,
  applied: Uint8Array,
  excess: ArrayLike<number>,
): number[] {
  const finer: number[] = [];
  const coarser: number[] = [];
  for (let t = 0; t < levels.length; t++) {
    if (levels[t] < applied[t]) finer.push(t);
    else if (levels[t] > applied[t]) coarser.push(t);
  }
  finer.sort((a, b) => excess[b] - excess[a]);
  coarser.sort((a, b) => excess[a] - excess[b]);
  return finer.concat(coarser);
}
