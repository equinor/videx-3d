import { geoTileKeyAt } from './geo-tile-keys';
import { tileAddress, tileChildren, tileParent } from './tile-keys';

// ⚠️ Free of three.js: shared with code that runs where the generators run.

/**
 * Where a tile lies in another, as `tileOffsetIn` gives it: its west/north corner across
 * the other (0…1 east and south), and its size there.
 *
 * @group Tiles
 */
export type TileOffset = [u: number, v: number, scale: number];

/**
 * The offset of a tile in a tile two levels of ancestry up: `inner` where the tile lies in
 * its ancestor, `outer` where that ancestor lies in its own (each as `tileOffsetIn` gives
 * them).
 *
 * @group Tiles
 */
export function composeTileOffsets(
  inner: TileOffset,
  outer: TileOffset,
): TileOffset {
  return [
    outer[0] + inner[0] * outer[2],
    outer[1] + inner[1] * outer[2],
    inner[2] * outer[2],
  ];
}

/**
 * Every strict ancestor of `keys`: where, below a coarser tile, to look for them (see
 * {@link tilesUnder}).
 *
 * @group Tiles
 */
export function tileAncestors(keys: Iterable<number>): Set<number> {
  const found = new Set<number>();
  for (const key of keys) {
    let at = key;
    while (tileAddress(at)[0] > 0) {
      at = tileParent(at);
      if (found.has(at)) break;
      found.add(at);
    }
  }
  return found;
}

/**
 * A square to draw over, and the tile of another layer under it: `square` lies in `under`,
 * or is it.
 *
 * @group Tiles
 */
export type TileCover = { square: number; under: number };

/**
 * How the tiles another layer of the same quadtree draws cover tile `key`: the one drawn
 * over all of it — itself or an ancestor — or else, square by square, those of its
 * descendants drawn. Where neither is drawn there is nothing: the part of `key` with no
 * tile of `drawn` over it is left out.
 *
 * To lie on another layer's surface exactly, draw each square once, from `key`'s data at
 * its offset (`tileOffsetIn(square, key)`) and the other layer's at its own
 * (`tileOffsetIn(square, under)`).
 *
 * @param drawn the other layer's tiles drawn
 * @param ancestors every strict ancestor of `drawn` ({@link tileAncestors})
 *
 * @group Tiles
 */
export function tilesUnder(
  key: number,
  drawn: { has(key: number): boolean },
  ancestors: ReadonlySet<number>,
  out: TileCover[] = [],
): TileCover[] {
  for (let at = key; ; at = tileParent(at)) {
    if (drawn.has(at)) {
      out.push({ square: key, under: at });
      return out;
    }
    if (tileAddress(at)[0] === 0) break;
  }
  if (!ancestors.has(key)) return out;
  const below = (at: number) => {
    for (const child of tileChildren(at)) {
      if (drawn.has(child)) out.push({ square: child, under: child });
      else if (ancestors.has(child)) below(child);
    }
  };
  below(key);
  return out;
}

/**
 * The geographic tile drawn over a point (`longitude`, `latitude`, degrees) among another
 * layer's tiles `drawn`, found from the roots down through their `ancestors`
 * ({@link tileAncestors}); null where none is drawn there.
 *
 * @group Tiles
 */
export function geoDrawnTileAt(
  longitude: number,
  latitude: number,
  drawn: { has(key: number): boolean },
  ancestors: ReadonlySet<number>,
  maxDepth = 30,
): number | null {
  for (let depth = 0; depth <= maxDepth; depth++) {
    const key = geoTileKeyAt(depth, longitude, latitude);
    if (drawn.has(key)) return key;
    if (!ancestors.has(key)) return null;
  }
  return null;
}
