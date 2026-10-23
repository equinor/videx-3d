import type { Vec3 } from '../types/common';

// ⚠️ Free of three.js.

/**
 * How a terrain's level of detail picks its nodes (see {@link selectTerrainNodes}): a
 * quadtree of square nodes, each drawn as the same patch of a grid, whose finest nodes
 * are `nodeSize` wide and every level up twice that.
 *
 * @group Geometries
 */
export type TerrainLod = {
  /** the finest nodes' width, in world units */
  nodeSize: number;
  /** levels above the finest: the coarsest nodes are `nodeSize * 2^levels` wide */
  levels: number;
  /** how far each level reaches, in its own node widths; at least 2 keeps neighbours within a level of each other */
  range: number;
  /** nodes wholly farther than this from the camera, its height above or below the terrain counted, are left out */
  reach: number;
  /** the lowest and highest heights the terrain holds, in world Y */
  minY: number;
  maxY: number;
};

/** Share of the way from the level below's range to its own where a level starts to morph. */
const MORPH_START = 0.66;

/**
 * A {@link TerrainLod} for a terrain whose finest detail is `cell` apart, drawn in patches
 * of `cells` cells, out to `reach`: as many levels as it takes for the coarsest to reach it.
 *
 * @group Geometries
 */
export function createTerrainLod(
  cell: number,
  cells: number,
  reach: number,
  minY: number,
  maxY: number,
  range = 2.5,
): TerrainLod {
  const nodeSize = cell * cells;
  const levels = Math.max(
    Math.ceil(Math.log2(reach / (range * nodeSize))),
    0,
  );
  return { nodeSize, levels, range, reach, minY, maxY };
}

/** How far each level reaches. */
export function terrainLodRanges(lod: TerrainLod): number[] {
  const ranges: number[] = [];
  for (let level = 0; level <= lod.levels; level++) {
    ranges.push(lod.range * lod.nodeSize * 2 ** level);
  }
  return ranges;
}

/**
 * Per level, the distances over which its grid morphs into the next level's, `[start,
 * end]` in a flat array: it ends where the level's range does, so a node meets a coarser
 * neighbour on that neighbour's grid. Measure a vertex's distance as the selection does
 * its nodes': along the level, and the camera's height above or below the terrain's range.
 *
 * @group Geometries
 */
export function terrainLodMorph(lod: TerrainLod): Float32Array {
  const ranges = terrainLodRanges(lod);
  const morph = new Float32Array(2 * ranges.length);
  ranges.forEach((end, level) => {
    const before = level > 0 ? ranges[level - 1] : 0;
    morph[2 * level] = before + (end - before) * MORPH_START;
    morph[2 * level + 1] = end;
  });
  return morph;
}

/** How far `camera` is above or below every height the terrain holds. */
export function terrainLodHeightGap(camera: Vec3, lod: TerrainLod) {
  return Math.max(camera[1] - lod.maxY, lod.minY - camera[1], 0);
}

/**
 * Pick the nodes to draw from `camera`, as CDLOD does (Strugar 2010): a node is drawn at
 * its level within that level's range, and split where the next level down reaches it.
 * A quarter of a split node that the finer level does not reach is still drawn as a
 * finer node, which lies past that level's morph and so takes its parent's grid. Writes
 * each node's min X, min Z, width and level into `out`, 4 numbers each.
 *
 * @returns the number of nodes, at most `out.length / 4`
 *
 * @group Geometries
 */
export function selectTerrainNodes(
  camera: Vec3,
  lod: TerrainLod,
  out: Float32Array,
): number {
  const ranges = terrainLodRanges(lod);
  const dy = terrainLodHeightGap(camera, lod);
  const [cx, , cz] = camera;
  const max = out.length >> 2;
  let count = 0;

  const emit = (x: number, z: number, size: number, level: number) => {
    if (count >= max) return;
    out[4 * count] = x;
    out[4 * count + 1] = z;
    out[4 * count + 2] = size;
    out[4 * count + 3] = level;
    count++;
  };
  // Along the level, from the camera to the nearest point of the node.
  const across = (x: number, z: number, size: number) => {
    const dx = Math.max(x - cx, cx - (x + size), 0);
    const dz = Math.max(z - cz, cz - (z + size), 0);
    return Math.hypot(dx, dz);
  };

  // Whether the node is handled: drawn, split, or beyond the reach.
  const select = (x: number, z: number, size: number, level: number) => {
    const flat = across(x, z, size);
    const distance = Math.hypot(flat, dy);
    if (distance > lod.reach) return true;
    if (distance > ranges[level]) return false;
    if (level === 0 || distance > ranges[level - 1]) {
      emit(x, z, size, level);
      return true;
    }
    const half = size / 2;
    for (let j = 0; j < 2; j++) {
      for (let i = 0; i < 2; i++) {
        const qx = x + i * half;
        const qz = z + j * half;
        if (!select(qx, qz, half, level - 1)) emit(qx, qz, half, level - 1);
      }
    }
    return true;
  };

  const root = lod.nodeSize * 2 ** lod.levels;
  const x0 = Math.floor((cx - lod.reach) / root) * root;
  const z0 = Math.floor((cz - lod.reach) / root) * root;
  for (let z = z0; z < cz + lod.reach; z += root) {
    for (let x = x0; x < cx + lod.reach; x += root) {
      if (!select(x, z, root, lod.levels)) emit(x, z, root, lod.levels);
    }
  }
  return count;
}
