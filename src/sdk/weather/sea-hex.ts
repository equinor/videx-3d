/**
 * Hex-tile sampling of a sea layer's tile (Heitz and Neyret 2018; Mikkelsen 2022), so the tile
 * never repeats: the plane is cut into hexagonal cells, each showing the tile shifted by its
 * own random offset, and a point blends the three cells about it by their barycentric
 * weights. Shifted only, never turned: the waves still run downwind. Variance-preserving: a
 * blend of n copies is Σ wᵢ·xᵢ / √Σ wᵢ², so the sea is as rough where cells meet.
 *
 * The GPU's twin is `shaders/sea-hex.glsl` (the Ocean component's); both hash in 32-bit
 * integers, so a point blends the same copies on either.
 */

/** Hex cells a tile's side holds about: cells smaller than a tile hold no whole repeat. */
export const SEA_HEX_SCALE = 3.4641016;

/** The three copies blended at a point: their offsets in tile units, and their weights. */
export type SeaHexTiles = {
  offsets: [number, number][];
  weights: [number, number, number];
};

// A 32-bit integer hash (lowbias32), as the shader's.
function hash32(x: number): number {
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}

// A cell's offset in tile units, for layer `layer`.
function cellOffset(i: number, j: number, layer: number): [number, number] {
  const seed =
    (Math.imul(i, 73856093) ^
      Math.imul(j, 19349663) ^
      Math.imul(layer, 83492791)) >>>
    0;
  const a = hash32(seed);
  const b = hash32(a);
  return [a / 4294967296, b / 4294967296];
}

/** The copies of layer `layer`'s tile blended at (u, v), in tile units. */
export function seaHexTiles(u: number, v: number, layer: number): SeaHexTiles {
  const su = u * SEA_HEX_SCALE;
  const sv = v * SEA_HEX_SCALE;
  // Onto the skewed grid of triangles whose corners are the hexagons' middles.
  const x = su;
  const y = -0.57735027 * su + 1.15470054 * sv;
  const bx = Math.floor(x);
  const by = Math.floor(y);
  const fx = x - bx;
  const fy = y - by;
  const fz = 1 - fx - fy;
  const s = fz < 0 ? 1 : 0;
  const s2 = 2 * s - 1;
  const w1 = -fz * s2;
  const w2 = s - fy * s2;
  const w3 = s - fx * s2;
  return {
    offsets: [
      cellOffset(bx + s, by + s, layer),
      cellOffset(bx + s, by + 1 - s, layer),
      cellOffset(bx + 1 - s, by + s, layer),
    ],
    weights: [w1, w2, w3],
  };
}
