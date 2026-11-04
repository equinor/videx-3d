import { Camera, Matrix4, Vector3 } from 'three';
import type { Vec3 } from '../../sdk/types/common';
import type { LabelTextRun } from './label-atlas';
import {
  labelAnchor,
  labelFadeRanges,
  labelFrame,
  LabelFadeRanges,
  labelPixels,
} from './label-geometry';
import { LABEL_LINE_HEIGHT, wrapLabelText } from './label-text';
import type { Label, LabelStyle, ResolvedLabelStyle } from './types';

// ⚠️ Pure: no canvas, no renderer.

/**
 * Where and as what a label may be drawn, a record each: one of its `places` filled in by
 * it, its text broken into lines one way where it has `bounds`, or the label itself.
 */
export type LabelSource = {
  text: string;
  position: Vec3;
  normal?: Vec3;
  direction?: Vec3;
  size?: number;
  bounds?: [number, number];
};

/**
 * Push each label's sources onto `out` — its `places`, filled in by it; else, where it has
 * `bounds`, its text broken into lines each way up to `maxLines` (`wrapLabelText`,
 * `measure` a line's width), fewest lines first, those that could be no larger in its
 * room than in fewer lines left out; else the label itself — and where each label's start
 * in `starts` (one more than the labels: the last, where they end).
 */
export function labelSources(
  labels: readonly Label[],
  maxLines: number,
  measure: (line: string) => number,
  out: LabelSource[],
  starts: Int32Array,
) {
  for (let i = 0; i < labels.length; i++) {
    const label = labels[i];
    starts[i] = out.length;
    if (label.places?.length) {
      for (const place of label.places)
        out.push({
          text: place.text ?? label.text,
          position: place.position ?? label.position,
          normal: place.normal ?? label.normal,
          direction: place.direction ?? label.direction,
          size: label.size,
          bounds: place.bounds ?? label.bounds,
        });
    } else if (label.bounds && maxLines > 1) {
      const texts = wrapLabelText(label.text, measure, maxLines);
      // As large as each could be in its room (its halo left out): one no larger than in
      // fewer lines would never be drawn.
      const [width, height] = label.bounds;
      let largest = -Infinity;
      const kept = texts.filter(text => {
        const lines = text.split('\n');
        const size = Math.min(
          width / Math.max(...lines.map(measure), 1e-6),
          height / (1 + (lines.length - 1) * LABEL_LINE_HEIGHT),
        );
        if (size <= largest) return false;
        largest = size;
        return true;
      });
      if (kept.length === 1) out.push(label);
      else
        for (const text of kept)
          out.push({
            text,
            position: label.position,
            normal: label.normal,
            direction: label.direction,
            size: label.size,
            bounds: label.bounds,
          });
    } else {
      out.push(label);
    }
  }
  starts[labels.length] = out.length;
}

/**
 * Floats per record in a label group's records (4 RGBA texels) — a label's, or one of the
 * places it may be drawn at (`LabelSource`): its position and its layer's row
 * (`labelLayerRow`), its normal and own size (`Label.size`), its reading direction and its
 * text's lines, and its text's run of glyphs in the group's runs (its first, how many) and
 * its cell's width and height in ems (`LabelTextRun`).
 *
 * ⚠️ The labels' vertex shader (`shaders/label-vertex.glsl`) reads them so: keep them alike.
 */
export const LABEL_RECORD_FLOATS = 16;

/** Texels across a label group's records' texture: 512 labels a row; and its runs': 2048 glyphs. */
export const LABEL_RECORDS_WIDTH = 2048;

/** Floats in a row of a label group's records' texture. */
export const LABEL_RECORDS_ROW_FLOATS = LABEL_RECORDS_WIDTH * 4;

/** What a label group asks of its atlas: a text laid out in its glyphs, if it has room. */
export type LabelTexts = {
  text(text: string, style: LabelStyle): LabelTextRun | null;
  /** how wide a line of text is set, in ems, its halo left out: for wrapping */
  measure(line: string, style: LabelStyle): number;
};

/**
 * Floats per label in {@link writeLabelRecords}' `extents`: its text's width and height in
 * ems, its halo included, and its ink's (`LabelTextRun`).
 */
export const LABEL_EXTENT_FLOATS = 4;

const normal = new Vector3();
const along = new Vector3();
const top = new Vector3();

/**
 * Write a record into `out` from record `first` (`LABEL_RECORD_FLOATS` each) for each of
 * `labels` — or of their sources (`labelSources`) — with its text laid out (`runs`, each
 * the label's, its glyphs from `runStarts`' in its group's runs): where each is, its frame
 * (see `labelFrame`), its own size, its layer's row in the group's styles (`row`) and its
 * text's run; and its text's extent and its ink's in ems into `extents`
 * (`LABEL_EXTENT_FLOATS` each, from the start).
 */
export function writeLabelRecords(
  labels: readonly LabelSource[],
  runs: readonly LabelTextRun[],
  runStarts: ArrayLike<number>,
  row: number,
  out: Float32Array,
  first: number,
  extents: Float32Array,
) {
  let at = first * LABEL_RECORD_FLOATS;
  for (let i = 0; i < labels.length; i++) {
    const label = labels[i];
    const run = runs[i];
    if (label.normal) normal.fromArray(label.normal).normalize();
    else normal.set(0, 1, 0);
    labelFrame(normal, label.direction, along, top);
    out[at++] = label.position[0];
    out[at++] = label.position[1];
    out[at++] = label.position[2];
    out[at++] = row;
    out[at++] = normal.x;
    out[at++] = normal.y;
    out[at++] = normal.z;
    out[at++] = label.size ?? 1;
    out[at++] = along.x;
    out[at++] = along.y;
    out[at++] = along.z;
    out[at++] = run.lines;
    out[at++] = runStarts[i];
    out[at++] = run.count;
    out[at++] = run.width;
    out[at++] = run.height;
    extents[i * LABEL_EXTENT_FLOATS] = run.width;
    extents[i * LABEL_EXTENT_FLOATS + 1] = run.height;
    extents[i * LABEL_EXTENT_FLOATS + 2] = run.inkWidth;
    extents[i * LABEL_EXTENT_FLOATS + 3] = run.inkHeight;
  }
}

/**
 * How far a label's farthest corner lies from its position, in its size: half its extent
 * about its middle, which its anchor moves off its position, and its offset, in ems.
 *
 * ⚠️ The labels' vertex shader (`shaders/label-vertex.glsl`) does the same: keep them alike.
 */
export function labelReach(
  width: number,
  height: number,
  anchor: [number, number],
  offset: [number, number],
) {
  return (
    Math.hypot(
      width * (Math.abs(anchor[0]) + 0.5),
      height * (Math.abs(anchor[1]) + 0.5),
    ) + Math.hypot(offset[0], offset[1])
  );
}

// Cells along each side of a layer's labels' box, and floats a cell (its middle, its radius
// and its largest own size).
const LABEL_GRID = 32;
const LABEL_CELL_FLOATS = 5;

const scratchEye = new Vector3();
const scratchInverse = new Matrix4();
const scratchRanges: LabelFadeRanges = { facing: [0, 0], pixels: [0, 0] };

/**
 * A layer's labels' bounds, in its frame: a grid of up to 32 cells along each side of their
 * box, each occupied one a sphere round its labels' positions and their largest own size;
 * and how far any text reaches from its position, in its size. For telling whether any of
 * them could show (`reachable`), so a layer far off or too small costs nothing.
 */
export class LabelBounds {
  private cells = new Float64Array(0);
  private cellCount = 0;
  private reach = 0;

  /** the occupied cells */
  get count() {
    return this.cellCount;
  }

  /**
   * Bound `count` labels' records in `records` from record `first`, their texts' `extents`
   * (`LABEL_EXTENT_FLOATS` a label), drawn in `style`.
   */
  bound(
    records: Float32Array,
    first: number,
    count: number,
    extents: Float32Array,
    style: Pick<LabelStyle, 'align' | 'baseline' | 'offset'>,
  ) {
    const F = LABEL_RECORD_FLOATS;
    const base = first * F;
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < count; i++) {
      const at = base + i * F;
      minX = Math.min(minX, records[at]);
      minY = Math.min(minY, records[at + 1]);
      minZ = Math.min(minZ, records[at + 2]);
      maxX = Math.max(maxX, records[at]);
      maxY = Math.max(maxY, records[at + 1]);
      maxZ = Math.max(maxZ, records[at + 2]);
    }
    const side =
      Math.max(maxX - minX, maxY - minY, maxZ - minZ) / LABEL_GRID || 1;
    const cellOf = (v: number, min: number) =>
      Math.min(Math.floor((v - min) / side), LABEL_GRID - 1);
    // Each occupied cell's box and largest own size, by its index.
    const boxes = new Map<number, number[]>();
    const anchor = labelAnchor(style.align, style.baseline);
    let reach = 0;
    for (let i = 0; i < count; i++) {
      const at = base + i * F;
      const x = records[at];
      const y = records[at + 1];
      const z = records[at + 2];
      const own = records[at + 7];
      const key =
        (cellOf(x, minX) * LABEL_GRID + cellOf(y, minY)) * LABEL_GRID +
        cellOf(z, minZ);
      const box = boxes.get(key);
      if (!box) boxes.set(key, [x, y, z, x, y, z, own]);
      else {
        box[0] = Math.min(box[0], x);
        box[1] = Math.min(box[1], y);
        box[2] = Math.min(box[2], z);
        box[3] = Math.max(box[3], x);
        box[4] = Math.max(box[4], y);
        box[5] = Math.max(box[5], z);
        box[6] = Math.max(box[6], own);
      }
      const corner = labelReach(
        extents[i * LABEL_EXTENT_FLOATS],
        extents[i * LABEL_EXTENT_FLOATS + 1],
        anchor,
        style.offset,
      );
      reach = Math.max(reach, corner * own);
    }
    if (this.cells.length < boxes.size * LABEL_CELL_FLOATS)
      this.cells = new Float64Array(boxes.size * LABEL_CELL_FLOATS);
    let c = 0;
    for (const box of boxes.values()) {
      const at = c++ * LABEL_CELL_FLOATS;
      this.cells[at] = (box[0] + box[3]) / 2;
      this.cells[at + 1] = (box[1] + box[4]) / 2;
      this.cells[at + 2] = (box[2] + box[5]) / 2;
      this.cells[at + 3] =
        Math.hypot(box[3] - box[0], box[4] - box[1], box[5] - box[2]) / 2;
      this.cells[at + 4] = box[6];
    }
    this.cellCount = boxes.size;
    this.reach = reach;
  }

  /**
   * Whether any label could show to `camera` (a view `viewHeight` CSS pixels high), its
   * layer's frame `matrixWorld`, drawn in `style` with its size times `scale`: one within its
   * distances, and large enough on screen to read (`minPixels`) at the nearest it could
   * be. Tested a cell at a time, so a layer spread over a region is judged by its nearest
   * part. Facing is left to the labels one by one. Conservative: true where it cannot tell.
   */
  reachable(
    camera: Camera,
    viewHeight: number,
    matrixWorld: Matrix4,
    style: ResolvedLabelStyle,
    scale = 1,
  ): boolean {
    if (this.cellCount === 0 || style.opacity <= 0) return false;
    const fadesFrom = labelFadeRanges(style, scratchRanges).pixels[0];
    const maxPixels = style.maxPixels;
    // No larger on screen than maxPixels, as the shader shrinks it.
    if (fadesFrom > 0 && maxPixels <= fadesFrom) return false;
    // The camera in its frame; distances there scaled to the world's. Label sizes are in
    // world units, or CSS pixels drawn on screen.
    const worldScale = matrixWorld.getMaxScaleOnAxis();
    const eye = scratchEye
      .copy(camera.position)
      .applyMatrix4(scratchInverse.copy(matrixWorld).invert());
    const size = style.size * scale;
    const inWorld = style.sizing === 'world';
    const p = camera.projectionMatrix.elements;
    const orthographic = p[15] === 1;
    // The CSS pixels a world unit spans face-on, at a depth of 1 (or any, orthographic).
    const perSize = p[5] * viewHeight * 0.5;
    // In view, a point's depth is at least its distance times the cosine of the view's
    // half diagonal.
    const cosine = 1 / Math.sqrt(1 + 1 / (p[0] * p[0]) + 1 / (p[5] * p[5]));
    const cells = this.cells;
    for (let c = 0; c < this.cellCount; c++) {
      const at = c * LABEL_CELL_FLOATS;
      const toMiddle =
        Math.hypot(
          cells[at] - eye.x,
          cells[at + 1] - eye.y,
          cells[at + 2] - eye.z,
        ) * worldScale;
      // Its text's reach in world units: on screen, as large as a label of its size in
      // pixels at its farthest, never larger.
      const em = inWorld
        ? size
        : (size * (orthographic ? 1 : toMiddle + cells[at + 3] * worldScale)) /
          perSize;
      const radius = cells[at + 3] * worldScale + this.reach * em;
      const nearest = Math.max(toMiddle - radius, 0);
      if (nearest > style.maxDistance) continue;
      if (toMiddle + radius < style.minDistance) continue;
      if (fadesFrom <= 0) return true;
      // Its largest on screen: at the least depth it could be.
      const depth = orthographic ? 1 : nearest * cosine;
      if (depth <= 0) return true;
      const pixels = labelPixels(
        style,
        cells[at + 4] * scale,
        perSize / depth,
        viewHeight,
      );
      if (Math.min(pixels, maxPixels) > fadesFrom) return true;
    }
    return false;
  }
}
