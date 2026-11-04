import {
  mapViewLonLatAt,
  mapViewPlaneToPixel,
  mapViewToPixel,
  type MapView,
} from '../projection/map-view';
import type { Vec2 } from '../types/common';
import {
  clipPolylineToRect,
  clipRingToRect,
  type Rect2,
} from '../utils/clip-2d';

// ⚠️ Free of three.js: plain 2D drawing on a canvas, for a map (`GeoMap`) and its layers.

/** Pixels round a map that paths are still drawn over, when cut to it: wider than any stroke. */
export const MAP_CLIP_MARGIN = 16;

/**
 * A map view in pixels, `margin` round it: what its paths are cut to.
 *
 * @group Layers
 */
export function mapClipRect(view: MapView, margin = MAP_CLIP_MARGIN): Rect2 {
  return [-margin, -margin, view.size[0] + margin, view.size[1] + margin];
}

/**
 * Where a path goes: a canvas's 2D context, a `Path2D`, or anything else that draws lines.
 *
 * @group Layers
 */
export type MapPathSink = {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  closePath(): void;
};

/**
 * Trace `pixels` (a line, or a ring when `closed`) on `sink`, only what lies in `clip`
 * (`mapClipRect`): a canvas, as a browser does an SVG path, strokes, dashes and fills a path
 * at its full length, and an outline or a route crossing a map zoomed in reaches a million
 * pixels past it. A ring is cut as an area (`clipRingToRect`), its cuts along the margin, out
 * of sight; a line into the runs in view.
 *
 * @group Layers
 */
export function traceMapPixels(
  sink: MapPathSink,
  pixels: Vec2[],
  closed: boolean,
  clip: Rect2,
) {
  const runs = closed
    ? [clipRingToRect(pixels, clip)]
    : clipPolylineToRect(pixels, clip);
  for (const run of runs) {
    if (run.length < 2) continue;
    sink.moveTo(run[0][0], run[0][1]);
    for (let k = 1; k < run.length; k++) sink.lineTo(run[k][0], run[k][1]);
    if (closed) sink.closePath();
  }
}

/**
 * SVG path data for `pixels`, as {@link traceMapPixels} traces them: only what lies in `clip`.
 *
 * @group Layers
 */
export function mapPathData(pixels: Vec2[], closed: boolean, clip: Rect2) {
  let d = '';
  traceMapPixels(
    {
      moveTo: (x, y) => (d += `M${x.toFixed(1)} ${y.toFixed(1)}`),
      lineTo: (x, y) => (d += `L${x.toFixed(1)} ${y.toFixed(1)}`),
      closePath: () => (d += 'Z'),
    },
    pixels,
    closed,
    clip,
  );
  return d;
}

/**
 * Where a point of the Earth lands in pixels on `view`: through the projection's plane in a
 * projected view (`lonLat`), so anywhere on the Earth; by its scene X/Z (`xz`, worked out
 * once) in the scene's own map, which is a turn and a scale of it.
 *
 * @group Layers
 */
export function mapViewGeoPixel(view: MapView, lonLat: Vec2, xz: Vec2): Vec2 {
  const projected = view.projected;
  if (!projected) return mapViewToPixel(view, xz[0], xz[1]);
  const [u, v] = projected.plane.fromLonLat(lonLat[0], lonLat[1]);
  return mapViewPlaneToPixel(view, u, v);
}

/**
 * A line of the Earth — `lonLat`, and the same points' scene X/Z, `xz` — in pixels on `view`,
 * a vertex closer than `minPixels` to the last one kept dropped (the last vertex always kept):
 * at any extent a line costs what it shows, not what it holds. Densify long edges before (see
 * `densifyPlanarGeometry`): they are drawn straight between their vertices.
 *
 * @group Layers
 */
export function mapViewGeoLine(
  view: MapView,
  lonLat: readonly Vec2[],
  xz: readonly Vec2[],
  minPixels = 1,
): Vec2[] {
  const pixels: Vec2[] = [];
  const projected = view.projected;
  // Too close to project at all: a pixel's worth of degrees, near enough, from the scale.
  const degreesPerPixel =
    ((view.metresPerPixel * minPixels) / 111195) * (projected ? 0.5 : 1);
  const metresPerPixel2 = (view.metresPerPixel * minPixels) ** 2;
  let lastLon = Infinity;
  let lastLat = Infinity;
  let lastX = Infinity;
  let lastZ = Infinity;
  const n = lonLat.length;
  for (let k = 0; k < n; k++) {
    const last = k === n - 1;
    if (!last && pixels.length > 0) {
      if (projected) {
        const [lon, lat] = lonLat[k];
        const cosLat = Math.cos((lat * Math.PI) / 180);
        if (
          Math.abs(lat - lastLat) < degreesPerPixel &&
          Math.abs(lon - lastLon) * cosLat < degreesPerPixel
        )
          continue;
      } else {
        const [x, z] = xz[k];
        if ((x - lastX) ** 2 + (z - lastZ) ** 2 < metresPerPixel2) continue;
      }
    }
    pixels.push(mapViewGeoPixel(view, lonLat[k], xz[k]));
    [lastLon, lastLat] = lonLat[k];
    [lastX, lastZ] = xz[k];
  }
  return pixels;
}

/**
 * The longitudes and latitudes `view` shows, `[west, south, east, north]` in degrees, a
 * little past its edges — the west its middle's longitude less up to 180, the east more, so a
 * box across the antimeridian is one box — or null where it shows too much of the Earth to
 * tell (a whole hemisphere, a pole): what features are tested against before they are drawn
 * (`lonLatBoxesMeet`).
 *
 * @group Layers
 */
export function mapViewLonLatBox(
  view: MapView,
  toLonLat: (x: number, z: number) => Vec2,
): [number, number, number, number] | null {
  const [w, h] = view.size;
  const middle = view.lonLat ?? mapViewLonLatAt(view, w / 2, h / 2, toLonLat);
  let west = Infinity;
  let east = -Infinity;
  let south = Infinity;
  let north = -Infinity;
  const steps = 4;
  for (let j = 0; j <= steps; j++)
    for (let i = 0; i <= steps; i++) {
      const [lon, lat] = mapViewLonLatAt(
        view,
        (i / steps) * w,
        (j / steps) * h,
        toLonLat,
      );
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
      let d = lon - middle[0];
      d -= 360 * Math.round(d / 360);
      west = Math.min(west, middle[0] + d);
      east = Math.max(east, middle[0] + d);
      south = Math.min(south, lat);
      north = Math.max(north, lat);
    }
  const padLon = (east - west) * 0.1;
  const padLat = (north - south) * 0.1;
  if (
    east - west + 2 * padLon > 270 ||
    north + padLat >= 89 ||
    south - padLat <= -89
  )
    return null;
  return [west - padLon, south - padLat, east + padLon, north + padLat];
}

/**
 * Whether a feature's bounds `[west, south, east, north]` meet a view's (`mapViewLonLatBox`),
 * a longitude taken the way round that brings it nearest: a view without bounds meets all.
 *
 * @group Layers
 */
export function lonLatBoxesMeet(
  bounds: readonly [number, number, number, number],
  box: readonly [number, number, number, number] | null,
): boolean {
  if (!box) return true;
  if (bounds[1] > box[3] || bounds[3] < box[1]) return false;
  for (const shift of [0, 360, -360])
    if (bounds[0] + shift <= box[2] && bounds[2] + shift >= box[0]) return true;
  return false;
}

/**
 * How a path or a dot is painted on a map, in CSS colours and pixels.
 *
 * @group Layers
 */
export type MapPaint = {
  /** Default none */
  fill?: string;
  /** Default 1 */
  fillOpacity?: number;
  /** Default none */
  stroke?: string;
  /** Default 1 */
  strokeOpacity?: number;
  /** pixels. Default 1 */
  strokeWidth?: number;
  /** a dash pattern in pixels, `[4, 3]` say */
  dash?: number[];
};

/**
 * Fill and stroke the path traced on `ctx` as `paint` says, the fill even-odd so holes stay
 * open.
 *
 * @group Layers
 */
export function paintMapPath(ctx: CanvasRenderingContext2D, paint: MapPaint) {
  if (paint.fill && paint.fill !== 'none') {
    ctx.globalAlpha = paint.fillOpacity ?? 1;
    ctx.fillStyle = paint.fill;
    ctx.fill('evenodd');
  }
  if (paint.stroke && paint.stroke !== 'none') {
    ctx.globalAlpha = paint.strokeOpacity ?? 1;
    ctx.strokeStyle = paint.stroke;
    ctx.lineWidth = paint.strokeWidth ?? 1;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.setLineDash(paint.dash ?? []);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/**
 * How a label is written on a map: small text with a dark halo, readable on light ground and
 * dark.
 *
 * @group Layers
 */
export type MapLabelStyle = {
  /** CSS pixels. Default 10 */
  fontSize?: number;
  /** Default `'verdana, sans-serif'` */
  fontFamily?: string;
  /** Default white */
  color?: string;
  /** the halo's colour. Default black */
  halo?: string;
  /** the halo's width, pixels. Default 2.5 */
  haloWidth?: number;
  /** where it sits from its point: centred on it, or to its right. Default `'right'` */
  align?: 'center' | 'right';
  /** pixels from its point, to the right. Default 0 */
  offset?: number;
};

/**
 * Places a map's labels so they do not overlap: each is placed only where it meets none
 * placed before it, so the first asked win (place the most wanted first). A grid of the
 * map's cells keeps the test short however many there are.
 *
 * @group Layers
 */
export class MapLabelSpacer {
  private readonly cells = new Map<number, Rect2[]>();
  private readonly cell: number;
  private readonly columns: number;

  /** @param cell pixels a grid cell spans: about a label's size */
  constructor(width: number, cell = 64) {
    this.cell = cell;
    this.columns = Math.ceil(width / cell) + 2;
  }

  /** Take `rect` if nothing taken meets it; `pad` pixels kept clear round it. */
  take(rect: Rect2, pad = 2): boolean {
    const [x0, y0, x1, y1] = [
      rect[0] - pad,
      rect[1] - pad,
      rect[2] + pad,
      rect[3] + pad,
    ];
    const keys: number[] = [];
    for (
      let j = Math.floor(y0 / this.cell);
      j <= Math.floor(y1 / this.cell);
      j++
    )
      for (
        let i = Math.floor(x0 / this.cell);
        i <= Math.floor(x1 / this.cell);
        i++
      ) {
        const key = j * this.columns + i;
        for (const other of this.cells.get(key) ?? [])
          if (other[0] < x1 && other[2] > x0 && other[1] < y1 && other[3] > y0)
            return false;
        keys.push(key);
      }
    const taken: Rect2 = [x0, y0, x1, y1];
    for (const key of keys) {
      const list = this.cells.get(key);
      if (list) list.push(taken);
      else this.cells.set(key, [taken]);
    }
    return true;
  }
}

/**
 * Write `text` at pixel `x`, `y` on `ctx` with a halo, if `spacer` (when given) finds room
 * for it.
 *
 * @returns whether it was written
 *
 * @group Layers
 */
export function drawMapLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  style: MapLabelStyle = {},
  spacer?: MapLabelSpacer,
): boolean {
  const size = style.fontSize ?? 10;
  ctx.font = `${size}px ${style.fontFamily ?? 'verdana, sans-serif'}`;
  const width = ctx.measureText(text).width;
  const align = style.align ?? 'right';
  const left = align === 'center' ? x - width / 2 : x + (style.offset ?? 0);
  if (
    spacer &&
    !spacer.take([left, y - size * 0.6, left + width, y + size * 0.6])
  )
    return false;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.setLineDash([]);
  ctx.lineWidth = style.haloWidth ?? 2.5;
  ctx.strokeStyle = style.halo ?? 'rgba(0, 0, 0, 0.8)';
  ctx.strokeText(text, left, y);
  ctx.fillStyle = style.color ?? '#ffffff';
  ctx.fillText(text, left, y);
  return true;
}
