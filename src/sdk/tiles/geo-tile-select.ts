import {
  GEO_TILE_ROOT_SPAN,
  GEO_TILE_ROOTS,
  geoTileRegion,
} from './geo-tile-keys';
import { tileAddress, tileChildren } from './tile-keys';

// ⚠️ Free of three.js: a map drawn top-down chooses its tiles where it likes.

// Metres along a meridian a degree spans, on a sphere of the Earth's mean radius.
const METRES_PER_DEGREE = (6371008.8 * Math.PI) / 180;

/**
 * The shallowest depth of the geographic quadtree whose tiles, `cells` cells along a side,
 * have cells no larger than `cellMetres` at `latitude`: their size there the geometric mean
 * of their height (north–south) and their width, narrower by the cosine of the latitude.
 * Clamped to 0…`maxDepth`.
 *
 * @group Tiles
 */
export function geoTileDepthFor(
  cellMetres: number,
  cells: number,
  maxDepth = 24,
  latitude = 0,
): number {
  if (!(cellMetres > 0)) return maxDepth;
  const across = Math.sqrt(
    Math.max(Math.cos((latitude * Math.PI) / 180), 1e-3),
  );
  const depth = Math.ceil(
    Math.log2(
      (GEO_TILE_ROOT_SPAN * METRES_PER_DEGREE * across) / (cells * cellMetres),
    ),
  );
  return Math.min(Math.max(depth, 0), maxDepth);
}

/**
 * How many geographic tiles at `depth` lie over `bounds` (west, south, east and north,
 * degrees): at most, as a grid of them.
 *
 * @group Tiles
 */
export function geoTileCountOver(
  bounds: [west: number, south: number, east: number, north: number],
  depth: number,
): number {
  const span = GEO_TILE_ROOT_SPAN / 2 ** depth;
  const [west, south, east, north] = bounds;
  const columns = Math.floor(east / span) - Math.floor(west / span) + 1;
  const rows = Math.floor(north / span) - Math.floor(south / span) + 1;
  return Math.max(columns, 0) * Math.max(rows, 0);
}

/**
 * What {@link selectGeoMapTiles} needs of a tile that is in.
 *
 * @group Tiles
 */
export type GeoMapTileInfo = {
  /** nothing finer lies under it: it is drawn, whatever the depth asked for */
  leaf: boolean;
};

/**
 * How {@link selectGeoMapTiles} chooses.
 *
 * @group Tiles
 */
export type GeoMapTileOptions = {
  /**
   * west, south, east and north (degrees) of what the map shows; across the antimeridian
   * west may lie below -180 or east above 180
   */
  bounds: [west: number, south: number, east: number, north: number];
  /** the depth wanted over all of it (see {@link geoTileDepthFor}) */
  depth: number;
  /**
   * the depth wanted over a tile, where it varies over the map — as a projection's scale
   * does: instead of `depth`, asked of each tile gone through
   */
  depthAt?: (key: number) => number;
  /**
   * levels to go on past a `leaf`, toward `depth`: a tile is a leaf while its layers' data
   * is no finer than about four thirds of its cells (`buildGeoReliefTile`), so a level more
   * holds all of it. Default 0
   */
  pastLeaf?: number;
  /** a tile that is in, or undefined */
  info: (key: number) => GeoMapTileInfo | undefined;
};

/**
 * What {@link selectGeoMapTiles} chose.
 *
 * @group Tiles
 */
export type GeoMapTileSelection = {
  /**
   * the tiles to draw, all in, the finest first: where a finer tile is not in yet its
   * nearest ancestor that is stands in for it, under the finer ones drawn beside it. An
   * index that keeps the first tile over each point (`buildHeightFieldIndex`) draws each
   * point from the finest tile there
   */
  draw: number[];
  /** the tiles wanted and not in, the coarsest the most: the map sharpens level by level */
  want: { key: number; priority: number }[];
  /** the tiles in that were gone through, to be kept in (`TileStreamer.update`) */
  used: number[];
};

/**
 * Choose the geographic tiles to draw a top-down map from: from the roots down over
 * `bounds`, to `depth` or to a `leaf`. A tile is gone into only once it is in, so a map
 * fills in from the roots, coarse to fine, and no point is ever left without ground once
 * the roots are in.
 *
 * @group Tiles
 */
export function selectGeoMapTiles(
  options: GeoMapTileOptions,
): GeoMapTileSelection {
  const {
    bounds: [west, south, east, north],
    depth,
    depthAt,
    pastLeaf = 0,
    info,
  } = options;
  const finest: number[] = [];
  const standIns = new Set<number>();
  const want: GeoMapTileSelection['want'] = [];
  const used: number[] = [];

  const overlaps = (key: number) => {
    const [w, n, span] = geoTileRegion(key);
    if (n - span >= north || n <= south) return false;
    for (const shift of [-360, 0, 360]) {
      if (w + shift < east && w + shift + span > west) return true;
    }
    return false;
  };

  // `stopAt`: the depth a leaf above, and `pastLeaf`, end the way down at.
  const visit = (key: number, ancestor: number | null, stopAt: number) => {
    if (!overlaps(key)) return;
    const [d] = tileAddress(key);
    const tile = info(key);
    if (!tile) {
      want.push({ key, priority: -d });
      if (ancestor !== null) standIns.add(ancestor);
      return;
    }
    used.push(key);
    const end = tile.leaf ? Math.min(stopAt, d + pastLeaf) : stopAt;
    if (d >= (depthAt ? depthAt(key) : depth) || d >= end) {
      finest.push(key);
      return;
    }
    for (const child of tileChildren(key)) visit(child, key, end);
  };
  for (const root of GEO_TILE_ROOTS) visit(root, null, Infinity);

  const deepestFirst = (a: number, b: number) =>
    tileAddress(b)[0] - tileAddress(a)[0];
  return {
    draw: [...finest.sort(deepestFirst), ...[...standIns].sort(deepestFirst)],
    want,
    used,
  };
}
