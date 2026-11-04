// ⚠️ Pure: no canvas, no renderer.

/** Floats per screen quad: its four corners' x and y, in CSS pixels, in order round it. */
export const LABEL_QUAD_FLOATS = 8;

/** Seconds a label takes to fade in or out as it is let in or pushed out by another. */
export const LABEL_FADE_TIME = 0.25;

/**
 * Seconds a label pushed out by another stays out, before it may come back: so two labels
 * that meet as the view moves do not trade places back and forth.
 */
export const LABEL_COOLDOWN = 0.5;

/**
 * The scale (as an annotation's `scaleFactor`: `distanceFactor` over the view's height
 * where it is) from which a label is near: near labels are kept apart from near ones,
 * distant from distant ones, and a near one may lie over a distant one, drawn in front.
 */
export const LABEL_NEAR_SCALE = 0.5;

/**
 * Which band a label is in, 0 near or 1 distant: near while its layer's `distanceFactor`
 * is at least {@link LABEL_NEAR_SCALE} of the view's height where it is (`span`, world units).
 */
export function labelBand(distanceFactor: number, span: number) {
  return distanceFactor >= LABEL_NEAR_SCALE * span ? 0 : 1;
}

/**
 * How much a label is wanted where labels meet, higher first: its `priority` (its layer's
 * and its own) above all; then — between labels of one priority — one shown already
 * (`shown`) over one that is not, so labels keep their places as the view moves, as much
 * as it shows (`fade`, 0 to 1: one all but faded out keeps no place from one that reads
 * whole); then whole rather than faded, near the middle of the view (`centre`: its
 * distance from it squared, as a share of the half diagonal's, 0 to 1) and near the camera
 * (`far`: 0 the nearest of those in view, 1 the farthest).
 */
export function labelRank(
  priority: number,
  shown: boolean,
  fade: number,
  centre: number,
  far: number,
) {
  return (
    priority * 10 +
    (shown ? 2 * fade : 0) +
    fade -
    0.5 * Math.min(centre, 1) -
    0.5 * far
  );
}

/** A label's opacity a step `dt` seconds on toward `target` (0 or 1), over {@link LABEL_FADE_TIME}. */
export function stepLabelFade(alpha: number, target: number, dt: number) {
  const step = dt / LABEL_FADE_TIME;
  return target > alpha
    ? Math.min(alpha + step, target)
    : Math.max(alpha - step, target);
}

/**
 * How much more room a place must give than the one a label is drawn at for it to move
 * there (see {@link labelPlaceChoice}): so one whose text just fits two ways does not
 * switch back and forth as the view moves by a hair.
 */
export const LABEL_PLACE_HYSTERESIS = 0.05;

/**
 * Which of a label's places to draw it at (`Label.places`, or its text's line breaks in its
 * `bounds`), and how much to shrink it there: `room` holds each place's room for its text
 * at the size it is drawn (the least of its bounds over its text's extent, either way: 1
 * just fits, 0 or less not seen), for `count` places in order of preference; `current` the
 * place it is drawn at now. The first that fits, unshrunk; else the one with the most room,
 * shrunk to fit it. It stays where it is while that fits (or, none fitting, has nearly the
 * most room), unless a place before it fits with room to spare
 * ({@link LABEL_PLACE_HYSTERESIS}). Sets `out` and returns it.
 */
export function labelPlaceChoice(
  room: ArrayLike<number>,
  count: number,
  current: number,
  out: { place: number; fit: number },
) {
  const keep = 1 + LABEL_PLACE_HYSTERESIS;
  const now = current >= 0 && current < count ? room[current] : -1;
  let first = -1;
  let most = 0;
  let roomiest = -1;
  for (let k = 0; k < count; k++) {
    if (first < 0 && room[k] >= 1) first = k;
    if (room[k] > most) {
      most = room[k];
      roomiest = k;
    }
  }
  if (first >= 0) {
    let place = first;
    if (now >= 1 && current > first) {
      place = current;
      for (let k = 0; k < current; k++) {
        if (room[k] >= keep) {
          place = k;
          break;
        }
      }
    }
    out.place = place;
    out.fit = 1;
  } else if (roomiest >= 0) {
    const stay = now > 0 && now * keep >= most;
    out.place = stay ? current : roomiest;
    out.fit = Math.min(stay ? now : most, 1);
  } else {
    out.place = current >= 0 && current < count ? current : 0;
    out.fit = 1;
  }
  return out;
}

/**
 * Whether quads `a` and `b` of `quads` (`LABEL_QUAD_FLOATS` each, convex) come closer than
 * `margin` pixels: no axis square to an edge of either separates them by that much.
 */
export function labelQuadsOverlap(
  quads: Float32Array,
  a: number,
  b: number,
  margin = 0,
) {
  const A = a * LABEL_QUAD_FLOATS;
  const B = b * LABEL_QUAD_FLOATS;
  return (
    !separatedByEdges(quads, A, A, B, margin) &&
    !separatedByEdges(quads, B, A, B, margin)
  );
}

// Whether an axis square to an edge of the quad at `base` parts quads `A` and `B` (float
// offsets) by `margin` or more.
function separatedByEdges(
  quads: Float32Array,
  base: number,
  A: number,
  B: number,
  margin: number,
) {
  for (let k = 0; k < 4; k++) {
    const x1 = quads[base + k * 2];
    const y1 = quads[base + k * 2 + 1];
    const x2 = quads[base + ((k + 1) % 4) * 2];
    const y2 = quads[base + ((k + 1) % 4) * 2 + 1];
    let nx = y1 - y2;
    let ny = x2 - x1;
    const length = Math.sqrt(nx * nx + ny * ny);
    if (length < 1e-9) continue;
    nx /= length;
    ny /= length;
    let minA = Infinity;
    let maxA = -Infinity;
    let minB = Infinity;
    let maxB = -Infinity;
    for (let i = 0; i < 4; i++) {
      const pa = quads[A + i * 2] * nx + quads[A + i * 2 + 1] * ny;
      const pb = quads[B + i * 2] * nx + quads[B + i * 2 + 1] * ny;
      minA = Math.min(minA, pa);
      maxA = Math.max(maxA, pa);
      minB = Math.min(minB, pb);
      maxB = Math.max(maxB, pb);
    }
    if (maxA + margin <= minB || maxB + margin <= minA) return true;
  }
  return false;
}

// The most cells a placement's grid has: its cells grow past LABEL_GRID_CELL to keep to it.
const MAX_GRID_CELLS = 4096;

/** The side of a placement grid's cells, in pixels, at the least. */
export const LABEL_GRID_CELL = 32;

/**
 * Keeps labels apart on screen, as annotations are: taken best first, a label is let in
 * where its quad comes near none let in before it in its band (`labelBand`); one that may
 * overlap (`free`) is always let in and keeps none out. Those let in are kept in a grid of
 * cells over the candidates' extent, a band each, so each is tested only against those in
 * the cells it covers; nothing is made per placement once its arrays have grown.
 */
export class LabelPlacer {
  // Per candidate: its box (min x, min y, max x, max y) and the last test that met it.
  private boxes = new Float32Array(0);
  private stamps = new Int32Array(0);
  // Per band and cell, its first entry; per entry, the next in its cell and its candidate.
  private heads = new Int32Array(0);
  private next = new Int32Array(0);
  private items = new Int32Array(0);
  private stamp = 0;

  /**
   * Place `count` candidates, taken in `order` (best first): `accepted[i]` 1 where
   * candidate `i`'s quad (in `quads`, `LABEL_QUAD_FLOATS` each) comes no closer than
   * `margin` pixels to any let in before it in its band (`bands[i]`, 0 near or 1 distant),
   * or it is `free`; else 0.
   */
  place(
    count: number,
    order: ArrayLike<number>,
    quads: Float32Array,
    bands: Uint8Array,
    free: Uint8Array,
    margin: number,
    accepted: Uint8Array,
  ) {
    const candidates = quads.length / LABEL_QUAD_FLOATS;
    if (this.boxes.length < candidates * 4) {
      this.boxes = new Float32Array(candidates * 4);
      this.stamps = new Int32Array(candidates);
      this.stamp = 0;
    }
    const boxes = this.boxes;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let k = 0; k < count; k++) {
      const i = order[k];
      const q = i * LABEL_QUAD_FLOATS;
      let x0 = quads[q];
      let x1 = x0;
      let y0 = quads[q + 1];
      let y1 = y0;
      for (let c = 2; c < 8; c += 2) {
        const x = quads[q + c];
        const y = quads[q + c + 1];
        if (x < x0) x0 = x;
        else if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        else if (y > y1) y1 = y;
      }
      boxes[i * 4] = x0;
      boxes[i * 4 + 1] = y0;
      boxes[i * 4 + 2] = x1;
      boxes[i * 4 + 3] = y1;
      if (x0 < minX) minX = x0;
      if (y0 < minY) minY = y0;
      if (x1 > maxX) maxX = x1;
      if (y1 > maxY) maxY = y1;
    }
    if (count === 0) return;
    // The grid over them all, its cells no fewer pixels than LABEL_GRID_CELL a side.
    minX -= margin;
    minY -= margin;
    const spanX = maxX + margin - minX;
    const spanY = maxY + margin - minY;
    const cell = Math.max(
      LABEL_GRID_CELL,
      Math.sqrt((spanX * spanY) / MAX_GRID_CELLS),
    );
    const cols = Math.max(1, Math.ceil(spanX / cell));
    const rows = Math.max(1, Math.ceil(spanY / cell));
    const cells = cols * rows;
    if (this.heads.length < 2 * cells) this.heads = new Int32Array(2 * cells);
    const heads = this.heads;
    heads.fill(-1, 0, 2 * cells);
    let entries = 0;
    for (let k = 0; k < count; k++) {
      const i = order[k];
      if (free[i]) {
        accepted[i] = 1;
        continue;
      }
      const b = i * 4;
      const x0 = boxes[b] - margin;
      const y0 = boxes[b + 1] - margin;
      const x1 = boxes[b + 2] + margin;
      const y1 = boxes[b + 3] + margin;
      const c0 = Math.min(
        Math.max(Math.floor((x0 - minX) / cell), 0),
        cols - 1,
      );
      const c1 = Math.min(
        Math.max(Math.floor((x1 - minX) / cell), 0),
        cols - 1,
      );
      const r0 = Math.min(
        Math.max(Math.floor((y0 - minY) / cell), 0),
        rows - 1,
      );
      const r1 = Math.min(
        Math.max(Math.floor((y1 - minY) / cell), 0),
        rows - 1,
      );
      const band = bands[i] ? cells : 0;
      const stamp = ++this.stamp;
      let clear = true;
      for (let r = r0; r <= r1 && clear; r++) {
        for (let c = c0; c <= c1 && clear; c++) {
          for (let e = heads[band + r * cols + c]; e >= 0; e = this.next[e]) {
            const j = this.items[e];
            if (this.stamps[j] === stamp) continue;
            this.stamps[j] = stamp;
            const o = j * 4;
            if (
              boxes[o] > x1 ||
              boxes[o + 2] < x0 ||
              boxes[o + 1] > y1 ||
              boxes[o + 3] < y0
            )
              continue;
            if (labelQuadsOverlap(quads, i, j, margin)) {
              clear = false;
              break;
            }
          }
        }
      }
      accepted[i] = clear ? 1 : 0;
      if (!clear) continue;
      // Into each cell its box covers.
      const needed = entries + (r1 - r0 + 1) * (c1 - c0 + 1);
      if (this.next.length < needed) {
        const grown = Math.max(needed, this.next.length * 2, 1024);
        const next = new Int32Array(grown);
        const items = new Int32Array(grown);
        next.set(this.next.subarray(0, entries));
        items.set(this.items.subarray(0, entries));
        this.next = next;
        this.items = items;
      }
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const at = band + r * cols + c;
          this.items[entries] = i;
          this.next[entries] = heads[at];
          heads[at] = entries++;
        }
      }
    }
  }
}
