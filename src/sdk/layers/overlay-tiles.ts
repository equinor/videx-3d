import type { Vec2 } from '../types/common';
import type { PlanarPolygonCoordinates } from '../geometries/planar-geometry';
import { geoTileRegion } from '../tiles/geo-tile-keys';

// ⚠️ Free of three.js: built where the generators run.

const DEG = Math.PI / 180;

/**
 * Texels along an overlay tile's side, its border aside (see {@link buildOverlayTile}).
 *
 * @group Layers
 */
export const OVERLAY_TILE_SIZE = 64;

/**
 * How far from an edge an overlay tile's distance is exact, in texels: the widest
 * outline it can draw, at about one texel a pixel.
 *
 * @group Layers
 */
export const OVERLAY_TILE_BAND = 4;

/**
 * Polygons for one overlay tile, packed flat so they cross to a worker cheaply (see
 * {@link packOverlayShapes}): only those over the tile are sent.
 *
 * @group Layers
 */
export type OverlayShapes = {
  /** longitude, latitude pairs (degrees), every ring's points one after another */
  coords: Float64Array;
  /** where each ring starts in `coords`, in points; one more at the end */
  rings: Uint32Array;
  /** where each shape's rings start in `rings`; one more at the end */
  shapes: Uint32Array;
  /** each shape's id, what its style is found by: under 65535 */
  ids: Uint32Array;
};

/**
 * Pack polygons (in longitude and latitude) for {@link buildOverlayTile}: each with its
 * id, in drawing order — where shapes overlap, the last one's fill is on top. Every ring
 * of a shape, its holes and other parts too, is read even-odd.
 *
 * @group Layers
 */
export function packOverlayShapes(
  shapes: { id: number; polygon: PlanarPolygonCoordinates }[],
): OverlayShapes {
  let points = 0;
  let rings = 0;
  for (const { polygon } of shapes) {
    for (const part of polygon) {
      for (const ring of part) {
        points += ring.length;
        rings++;
      }
    }
  }
  const packed: OverlayShapes = {
    coords: new Float64Array(points * 2),
    rings: new Uint32Array(rings + 1),
    shapes: new Uint32Array(shapes.length + 1),
    ids: new Uint32Array(shapes.length),
  };
  let point = 0;
  let ring = 0;
  shapes.forEach(({ id, polygon }, s) => {
    packed.shapes[s] = ring;
    packed.ids[s] = id;
    for (const part of polygon) {
      for (const r of part) {
        packed.rings[ring++] = point;
        for (const [lon, lat] of r) {
          packed.coords[2 * point] = lon;
          packed.coords[2 * point + 1] = lat;
          point++;
        }
      }
    }
  });
  packed.rings[ring] = point;
  packed.shapes[shapes.length] = ring;
  return packed;
}

/**
 * An overlay tile: polygons over a geographic tile (`geo-tile-keys`), as `size + 2`
 * texels a side — the tile's `size`, and a border of one all round so neighbours filter
 * alike across their edge — RGBA, row by row from the north-west:
 *
 * - **R**: the distance from the texel's middle to the nearest edge of any shape, in
 *   texels along a meridian (metres alike both ways: along a parallel a texel is
 *   `cos(latitude)` narrower), positive inside any shape, 128 at the edge and
 *   `127 / band` a texel, clamped at `band`. Filtered, it gives every outline — where
 *   shapes overlap too — and the fill's edge, sharp at any zoom.
 * - **G, B**: the id + 1 of the last shape over the texel (G the high byte), 0 for none;
 *   spread one texel past the shapes, so a pixel just inside an edge finds it. Read
 *   unfiltered (`texelFetch`).
 * - **A**: 255.
 *
 * A tile with nothing drawn on it (`empty`) holds no texels: its `data` is empty.
 *
 * @group Layers
 */
export type OverlayTile = {
  key: number;
  size: number;
  band: number;
  data: Uint8Array;
  /** no edge lies within the band: nothing finer to see, it is never split */
  leaf: boolean;
  /** nothing is drawn on it */
  empty: boolean;
};

// From point (px, pz) to the segment from (ax, az) to (bx, bz).
function toSegment(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
) {
  const dx = bx - ax;
  const dz = bz - az;
  const length = dx * dx + dz * dz;
  const t =
    length > 0
      ? Math.min(Math.max(((px - ax) * dx + (pz - az) * dz) / length, 0), 1)
      : 0;
  return Math.hypot(px - ax - t * dx, pz - az - t * dz);
}

/**
 * Rasterise polygons over the geographic tile `key` (see {@link OverlayTile}): the
 * distance to their edges near them, exact within `band` texels, and which shape is on
 * top over each texel. Costs in proportion to the edges and the rows their shapes cross,
 * not to the texels: a tile under hundreds of shapes is quick.
 *
 * A shape under every texel's middle shows as a dot at least, a texel across, so small
 * ones are not lost from afar.
 *
 * @group Layers
 */
export function buildOverlayTile(
  shapes: OverlayShapes,
  key: number,
  size = OVERLAY_TILE_SIZE,
  band = OVERLAY_TILE_BAND,
): OverlayTile {
  const [west, north, span] = geoTileRegion(key);
  const n = size + 2;
  const cell = span / size;
  // Along a parallel, a texel is this much of one along a meridian.
  const k = Math.max(Math.cos((north - span / 2) * DEG), 1e-3);
  // A point's place in texels from the grid's first texel's corner (the border's):
  // u east, v south. A texel's middle is at (i + 0.5, j + 0.5).
  const u = (lon: number) => (lon - west) / cell + 1;
  const v = (lat: number) => (north - lat) / cell + 1;

  const distance = new Float32Array(n * n).fill(band);
  const inside = new Uint8Array(n * n);
  const ids = new Uint16Array(n * n);
  const { coords, rings, ids: shapeIds } = shapes;
  const count = shapes.shapes.length - 1;
  let edges = false;
  const crossings: number[] = [];
  const ring: Vec2[] = [];

  for (let s = 0; s < count; s++) {
    const r0 = shapes.shapes[s];
    const r1 = shapes.shapes[s + 1];
    const id = shapeIds[s] + 1;
    let minV = Infinity;
    let maxV = -Infinity;
    let minU = Infinity;
    let maxU = -Infinity;
    // Near each edge, the distance to it, in texels along a meridian.
    for (let r = r0; r < r1; r++) {
      ring.length = 0;
      for (let p = rings[r]; p < rings[r + 1]; p++)
        ring.push([u(coords[2 * p]), v(coords[2 * p + 1])]);
      for (let e = 0; e < ring.length; e++) {
        const [au, av] = ring[e];
        const [bu, bv] = ring[(e + 1) % ring.length];
        minU = Math.min(minU, au);
        maxU = Math.max(maxU, au);
        minV = Math.min(minV, av);
        maxV = Math.max(maxV, av);
        const i0 = Math.max(Math.floor(Math.min(au, bu) - band / k), 0);
        const i1 = Math.min(Math.ceil(Math.max(au, bu) + band / k), n - 1);
        const j0 = Math.max(Math.floor(Math.min(av, bv) - band), 0);
        const j1 = Math.min(Math.ceil(Math.max(av, bv) + band), n - 1);
        for (let j = j0; j <= j1; j++) {
          for (let i = i0; i <= i1; i++) {
            const d = toSegment((i + 0.5) * k, j + 0.5, au * k, av, bu * k, bv);
            const at = j * n + i;
            if (d < distance[at]) {
              distance[at] = d;
              edges = true;
            }
          }
        }
      }
    }
    // Inside, even-odd along each row of texel middles it crosses.
    let covered = false;
    const jFrom = Math.max(Math.ceil(minV - 0.5), 0);
    const jTo = Math.min(Math.floor(maxV - 0.5), n - 1);
    for (let j = jFrom; j <= jTo; j++) {
      const pv = j + 0.5;
      crossings.length = 0;
      for (let r = r0; r < r1; r++) {
        const p0 = rings[r];
        const p1 = rings[r + 1];
        for (let p = p0, q = p1 - 1; p < p1; q = p++) {
          const vk = v(coords[2 * p + 1]);
          const vl = v(coords[2 * q + 1]);
          if (vk > pv !== vl > pv) {
            const uk = u(coords[2 * p]);
            const ul = u(coords[2 * q]);
            crossings.push(((ul - uk) * (pv - vk)) / (vl - vk) + uk);
          }
        }
      }
      crossings.sort((a, b) => a - b);
      for (let c = 0; c + 1 < crossings.length; c += 2) {
        const i0 = Math.max(Math.ceil(crossings[c] - 0.5), 0);
        const i1 = Math.min(Math.ceil(crossings[c + 1] - 0.5) - 1, n - 1);
        for (let i = i0; i <= i1; i++) {
          inside[j * n + i] = 1;
          ids[j * n + i] = id;
          covered = true;
        }
      }
    }
    // Smaller than a texel: a dot at its middle, if that is on the tile.
    if (!covered && maxU >= minU) {
      const i = Math.floor((minU + maxU) / 2);
      const j = Math.floor((minV + maxV) / 2);
      if (i >= 0 && i < n && j >= 0 && j < n) {
        inside[j * n + i] = 1;
        ids[j * n + i] = id;
        distance[j * n + i] = Math.max(distance[j * n + i], 0.5);
      }
    }
  }

  // The ids spread a texel past the shapes, into texels with none.
  const spread = ids.slice();
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const at = j * n + i;
      if (ids[at]) continue;
      spread[at] =
        (i > 0 && ids[at - 1]) ||
        (i < n - 1 && ids[at + 1]) ||
        (j > 0 && ids[at - n]) ||
        (j < n - 1 && ids[at + n]) ||
        0;
    }
  }

  const data = new Uint8Array(n * n * 4);
  let any = false;
  for (let at = 0; at < n * n; at++) {
    const d = inside[at] ? distance[at] : -distance[at];
    if (inside[at]) any = true;
    data[4 * at] = Math.round(
      Math.min(Math.max(128 + (d / band) * 127, 0), 255),
    );
    data[4 * at + 1] = spread[at] >> 8;
    data[4 * at + 2] = spread[at] & 255;
    data[4 * at + 3] = 255;
  }
  // Nothing drawn on it: no texels to hold, so it costs a streamer next to nothing.
  return {
    key,
    size,
    band,
    data: any ? data : new Uint8Array(0),
    leaf: !edges,
    empty: !any,
  };
}
