import {
  BufferAttribute,
  Camera,
  DataTexture,
  DynamicDrawUsage,
  FloatType,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Matrix4,
  Mesh,
  NearestFilter,
  Object3D,
  RGBAFormat,
  ShaderMaterial,
  Texture,
  Uniform,
  Vector3,
  Vector4,
  WebGLRenderer,
} from 'three';
import { LAYERS } from '../../layers/layers';
import { releaseMaterial } from '../../rendering/precompile';
import {
  LabelAtlas,
  LABEL_GLYPH_TEXELS,
  LABEL_GLYPHS_WIDTH,
  LABEL_RASTER_SIZE,
  LABEL_RUN_FLOATS,
  type LabelTextRun,
} from './label-atlas';
import { cssDisplayColor } from './label-colors';
import { LABEL_LINE_HEIGHT } from './label-text';
import {
  labelAnchor,
  labelFade,
  LabelFadeRanges,
  labelFadeRanges,
  labelPixels,
  labelSlantLeast,
} from './label-geometry';
import {
  labelBand,
  LABEL_COOLDOWN,
  labelPlaceChoice,
  LabelPlacer,
  LABEL_QUAD_FLOATS,
  labelRank,
  stepLabelFade,
} from './label-placement';
import {
  LabelBounds,
  LABEL_EXTENT_FLOATS,
  labelReach,
  LABEL_RECORD_FLOATS,
  LABEL_RECORDS_WIDTH,
  LabelSource,
  labelSources,
  LabelTexts,
  writeLabelRecords,
} from './label-records';
import fragmentShader from './shaders/label-fragment.glsl';
import vertexShader from './shaders/label-vertex.glsl';
import type {
  Label,
  LabelSizing,
  LabelsProvider,
  ResolvedLabelStyle,
} from './types';
import { resolveLabelStyle } from './types';

/** The pixels kept between labels on screen, by default (`<Labels margin>`). */
export const LABEL_MARGIN = 1;

/**
 * Milliseconds a group's placement may take each frame, on average: one that takes longer
 * is done again only after as many frames as it overran by (at most
 * {@link LABEL_PLACE_MAX_WAIT}), so thousands of labels in view cost the frame no more. The
 * labels are drawn where they are by the GPU every frame; only which are shown lags.
 */
export const LABEL_PLACE_BUDGET = 1;

/** The most frames a group's placement waits (see {@link LABEL_PLACE_BUDGET}). */
export const LABEL_PLACE_MAX_WAIT = 3;

/**
 * Texels a layer's style takes in its group's styles' texture (a row each): its colour and
 * opacity, its halo, its size and sizing, its fades, its distances and largest size, its
 * anchor and offset, its lift, flip and growth at a slant, and its frame (4).
 *
 * ⚠️ The labels' vertex shader (`shaders/label-vertex.glsl`) reads them so: keep them alike.
 */
export const LABEL_STYLE_TEXELS = 11;

const STYLE_FLOATS = LABEL_STYLE_TEXELS * 4;
// A float's largest, for Infinity.
const LARGEST = 3.4e38;
const SIZING: Record<LabelSizing, number> = { world: 0, screen: 1, auto: 2 };
const NO_LABELS: readonly Label[] = [];
const IDENTITY = new Matrix4();

/** What a {@link LabelGroup} draws its texts from: a {@link LabelAtlas}, or one like it. */
export type LabelGroupAtlas = LabelTexts & {
  /** its glyphs' coverage */
  readonly texture: Texture;
  /** its glyphs' cells and boxes (`LABEL_GLYPH_TEXELS` each, `LABEL_GLYPHS_WIDTH` a row) */
  readonly glyphTable: Texture;
  readonly generation: number;
  track(user: object, texts: readonly { text: string }[], style: object): void;
  untrack(user: object): void;
  repack(): void;
  setAnisotropy(samples: number): void;
  dispose(): void;
};

/** The view a {@link LabelGroup} places its labels for, once a frame (`LabelGroup.frame`). */
export type LabelGroupView = {
  camera: Camera;
  /** the view's size, in CSS pixels */
  width: number;
  height: number;
  /** seconds: the same for every call in one frame, and only then */
  time: number;
  renderer?: WebGLRenderer;
  /** asks for another frame, while labels fade (an on-demand frame loop) */
  invalidate?: () => void;
};

/** What a {@link LabelGroupLayer} draws, and how (see `LabelLayer`). */
export type LabelGroupLayerOptions = {
  labels: readonly Label[];
  provider?: LabelsProvider;
  style: ResolvedLabelStyle;
  priority: number;
  overlap: boolean;
  visible: boolean;
  scaleRef?: { readonly current: number };
  /** its frame: its labels' positions, normals and directions are in its world matrix's */
  frame?: Object3D | null;
};

/**
 * A layer of a {@link LabelGroup}: its labels and style, and what the group keeps of them —
 * where its records are, its labels in the world, and each one's place on screen (shown or
 * pushed out, its opacity). Made by `LabelLayer`; in a group once `add`ed.
 */
export class LabelGroupLayer {
  labels: readonly Label[] = NO_LABELS;
  provider?: LabelsProvider;
  style: ResolvedLabelStyle = resolveLabelStyle();
  priority = 0;
  overlap = false;
  visible = true;
  scaleRef?: { readonly current: number };
  frame: Object3D | null = null;

  /** the labels it draws: its own, then its provider's */
  all: readonly Label[] = NO_LABELS;
  /**
   * where and as what each may be drawn, a record each (`labelSources`), and where each
   * label's start (one more than its labels: the last, where they end)
   */
  sources: LabelSource[] = [];
  starts = new Int32Array(1);
  /** its row in the group's styles */
  row = -1;
  /**
   * its first record in the group's, how many records it has room for, how many labels it
   * has, and how many records they take
   */
  first = 0;
  capacity = 0;
  count = 0;
  records = 0;
  /** per record: its text's width and height in ems, and its ink's */
  extents = new Float32Array(0);
  /** per record: how far its farthest corner reaches from its position, in its size (`labelReach`) */
  reaches = new Float32Array(0);
  /** per record: its position, normal and reading direction in the world (9 floats) */
  world = new Float32Array(0);
  /** per record: its room, width and height in its layer's frame (`Label.bounds`); Infinity, none */
  room = new Float32Array(0);
  /** per label: its priority, its layer's and its own */
  priorities = new Float32Array(0);
  /** per label: its opacity as let in or pushed out, and how long it stays out */
  alpha = new Float32Array(0);
  cooldown = new Float32Array(0);
  /** per label: let in at the last placement */
  shown = new Uint8Array(0);
  /** per label: which of its records it is drawn as, and shrunk by how much to fit its room */
  place = new Uint16Array(0);
  fit = new Float32Array(0);
  keys: string[] = [];
  /**
   * its texts laid out in its group's atlas's glyphs: each distinct one's run and its place
   * in its block of runs (glyphs from its start); which each source draws; how many
   * sources' texts are in (all, unless the atlas is full); and how many glyphs they take
   */
  uniqueRuns: LabelTextRun[] = [];
  uniqueOffsets: number[] = [];
  runOf = new Int32Array(0);
  resolved = 0;
  glyphNeed = 0;
  /** its first glyph in the group's runs, and how many it has room for */
  glyphFirst = 0;
  glyphCapacity = 0;
  readonly bounds = new LabelBounds();
  /** its frame and multiplier as last written */
  readonly matrix = new Matrix4();
  scale = 1;

  dataDirty = true;
  styleDirty = true;
  worldDirty = true;
  providerDirty = true;
  provided: readonly Label[] = NO_LABELS;
  readonly providedView = new Matrix4();

  constructor(readonly group: LabelGroup) {}

  /** Draw what `options` say: only what changed is written again. */
  set(options: LabelGroupLayerOptions) {
    let placed = false;
    if (options.labels !== this.labels) {
      this.labels = options.labels;
      this.dataDirty = true;
    }
    if (options.provider !== this.provider) {
      this.provider = options.provider;
      this.provided = NO_LABELS;
      this.providerDirty = true;
      this.dataDirty = true;
    }
    if (options.style !== this.style) {
      this.style = options.style;
      // Its font, halo, anchor or offset may draw its texts and bounds anew.
      this.styleDirty = true;
      this.dataDirty = true;
    }
    if (options.priority !== this.priority) {
      this.priority = options.priority;
      this.dataDirty = true;
    }
    if (options.overlap !== this.overlap) {
      this.overlap = options.overlap;
      placed = true;
    }
    if (options.visible !== this.visible) {
      this.visible = options.visible;
      this.providerDirty = true;
      placed = true;
    }
    this.scaleRef = options.scaleRef;
    this.frame = options.frame ?? null;
    if (placed || this.dataDirty || this.styleDirty) this.group.invalidate();
  }
}

// Each label's key: kept across its layer's labels written again, so it keeps its place.
const labelKey = (label: Label) =>
  label.id != null
    ? `#${label.id}`
    : `${label.text}|${label.position[0]}|${label.position[1]}|${label.position[2]}`;

const viewProjection = new Matrix4();
const cameraPosition = new Vector3();
const forward = new Vector3();
const scratchDisplay = new Vector4();
const scratchRanges: LabelFadeRanges = { facing: [0, 0], pixels: [0, 0] };
const corner = [-0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5];
const choice = { place: 0, fit: 1 };

/**
 * Labels drawn and kept apart together: its layers' (`LabelGroupLayer`) labels in one
 * instanced draw — two, those depth tested and those drawn over everything — from one text
 * atlas, placed on screen each frame the view or they change.
 *
 * Its labels' records (`writeLabelRecords`: where each is, its frame, its text; one for each
 * way a label may be drawn, `labelSources`) are in a float texture, a block a layer,
 * written only when a layer's labels change; its layers' styles and frames in another, a
 * row each. Each frame the view moves (or a label fades), it chooses where each label with
 * places or room of its own is drawn and how much it shrinks to fit (`labelPlaceChoice`),
 * works out where each label lies on screen as its vertex shader will draw it, lets the
 * best in where they meet (`LabelPlacer`: by priority, then those shown already, whole,
 * central and near), fades those let in or pushed out, and writes what is drawn — each
 * label's record, opacity and shrink — farthest first, so a near label lies over a far one
 * where the two may meet (near and distant ones, `labelBand`). Still, it writes nothing.
 */
export class LabelGroup {
  /** its meshes, for a scene */
  readonly root = new Group();
  readonly atlas: LabelGroupAtlas;
  /** pixels kept between labels on screen */
  margin = LABEL_MARGIN;
  /** milliseconds its placement may take a frame, on average (see {@link LABEL_PLACE_BUDGET}); Infinity places every frame */
  placeBudget = LABEL_PLACE_BUDGET;
  readonly layers: LabelGroupLayer[] = [];
  /** depth tested, and drawn over everything */
  readonly meshes: [
    Mesh<InstancedBufferGeometry, ShaderMaterial>,
    Mesh<InstancedBufferGeometry, ShaderMaterial>,
  ];

  private uniforms = {
    uAtlas: new Uniform<Texture | null>(null),
    uGlyphs: new Uniform<Texture | null>(null),
    uRecords: new Uniform<Texture | null>(null),
    uRuns: new Uniform<Texture | null>(null),
    uStyles: new Uniform<Texture | null>(null),
    uViewHeight: new Uniform(1),
    uFar: new Uniform(0),
  };
  // Its labels' records, a block a layer; its texts' runs of glyphs, a block a layer; its
  // layers' styles, a row each.
  private records: GroupTexture;
  private runs: GroupTexture;
  private styles: GroupTexture;
  private rows: (LabelGroupLayer | null)[] = [];
  private draws: [Float32Array, Float32Array] = [
    new Float32Array(0),
    new Float32Array(0),
  ];
  private placer = new LabelPlacer();
  private time = -1;
  private generation = -1;
  private anisotropy = false;
  private readonly view = new Matrix4();
  private width = 0;
  private height = 0;
  private dirty = true;
  private relayout = true;
  private animating = false;
  private warned = false;
  // When it last placed its labels (seconds), how many frames it waits to place them again,
  // and whether a placement is owed.
  private placedAt = -1;
  private wait = 0;
  private owed = false;
  private renderer: WebGLRenderer | null = null;
  // Each candidate of a placement: its layer and label, its quad on screen, its band,
  // whether it is free to overlap, its rank and depth, and what came of it.
  private candidates = {
    layer: new Int32Array(0),
    label: new Int32Array(0),
    quads: new Float32Array(0),
    bands: new Uint8Array(0),
    free: new Uint8Array(0),
    accepted: new Uint8Array(0),
    ranks: new Float64Array(0),
    depth: new Float32Array(0),
    distance: new Float32Array(0),
    fade: new Float32Array(0),
    centre: new Float32Array(0),
    order: new Int32Array(0),
  };
  private drawOrder = new Int32Array(0);
  // Each place's room as a label's place is chosen (labelPlaceChoice).
  private room = new Float64Array(4);
  // The camera's projection as placed, for the room each place has.
  private projection: ArrayLike<number> = IDENTITY.elements;

  constructor(atlas: LabelGroupAtlas = new LabelAtlas()) {
    this.atlas = atlas;
    this.records = new GroupTexture(
      LABEL_RECORDS_WIDTH,
      1,
      texture => (this.uniforms.uRecords.value = texture),
    );
    this.runs = new GroupTexture(
      LABEL_RECORDS_WIDTH,
      1,
      texture => (this.uniforms.uRuns.value = texture),
    );
    this.styles = new GroupTexture(
      LABEL_STYLE_TEXELS,
      4,
      texture => (this.uniforms.uStyles.value = texture),
    );
    this.meshes = [this.createMesh(true), this.createMesh(false)];
    this.root.name = 'labels';
    // For tools inspecting a scene (Storybook's `videx3d`, say): the group its meshes draw.
    this.root.userData.labelGroup = this;
    this.root.add(...this.meshes);
  }

  /** Place its labels again at the next frame. */
  invalidate() {
    this.dirty = true;
  }

  /** Draw `layer`'s labels in it. */
  add(layer: LabelGroupLayer) {
    if (this.layers.includes(layer)) return;
    this.layers.push(layer);
    let row = this.rows.indexOf(null);
    if (row < 0) row = this.rows.length;
    this.rows[row] = layer;
    layer.row = row;
    if (
      row >= this.styles.rows &&
      this.styles.grow(Math.max(4, this.rows.length * 2))
    )
      for (const each of this.layers) each.styleDirty = true;
    layer.dataDirty = true;
    layer.styleDirty = true;
    this.relayout = true;
    this.dirty = true;
  }

  /** Draw `layer`'s labels no more. */
  remove(layer: LabelGroupLayer) {
    const at = this.layers.indexOf(layer);
    if (at < 0) return;
    this.layers.splice(at, 1);
    this.rows[layer.row] = null;
    layer.row = -1;
    this.atlas.untrack(layer);
    this.dirty = true;
  }

  /** the labels drawn, depth tested and over everything */
  get drawn(): [number, number] {
    return [
      this.meshes[0].geometry.instanceCount,
      this.meshes[1].geometry.instanceCount,
    ];
  }

  /**
   * Draw its labels for `view`, once a frame (again in the same frame, nothing): its
   * providers asked again as the view changes, what changed written, and its labels
   * placed again as the view or they change, or while any fades.
   */
  frame(view: LabelGroupView) {
    if (view.time === this.time) return;
    this.time = view.time;
    const { camera, width, height } = view;
    if (view.renderer) {
      this.renderer = view.renderer;
      if (!this.anisotropy) {
        this.anisotropy = true;
        this.atlas.setAnisotropy(view.renderer.capabilities.getMaxAnisotropy());
      }
    }
    camera.updateMatrixWorld();
    viewProjection.multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse,
    );
    let changed =
      !viewProjection.equals(this.view) ||
      width !== this.width ||
      height !== this.height;
    this.view.copy(viewProjection);
    this.width = width;
    this.height = height;
    this.uniforms.uViewHeight.value = height;
    this.uniforms.uFar.value = (camera as { far?: number }).far ?? 0;

    for (const layer of this.layers) {
      layer.frame?.updateWorldMatrix(true, false);
      const matrix = layer.frame ? layer.frame.matrixWorld : IDENTITY;
      if (!layer.matrix.equals(matrix)) {
        layer.matrix.copy(matrix);
        layer.worldDirty = true;
        layer.styleDirty = true;
      }
      const scale = layer.scaleRef?.current ?? 1;
      if (scale !== layer.scale) {
        layer.scale = scale;
        layer.styleDirty = true;
      }
      if (
        layer.provider &&
        layer.visible &&
        (layer.providerDirty || !viewProjection.equals(layer.providedView))
      ) {
        layer.providerDirty = false;
        layer.providedView.copy(viewProjection);
        const provided = layer.provider({ camera, width, height });
        // The same labels as before: nothing to write again.
        if (provided !== layer.provided) {
          layer.provided = provided;
          layer.dataDirty = true;
        }
      }
      if (layer.styleDirty || layer.worldDirty) changed = true;
    }
    if (this.writeRecords()) changed = true;
    this.writeStyles();
    if (this.dirty) changed = true;
    this.dirty = false;
    if (!changed && !this.animating && !this.owed) return;
    // Its last placement overran its budget: placed again a few frames on, and owed till.
    if (this.wait > 0) {
      this.wait--;
      this.owed = true;
      view.invalidate?.();
      return;
    }
    const dt =
      this.placedAt < 0
        ? 0
        : Math.min(Math.max(view.time - this.placedAt, 0), 0.1);
    this.placedAt = view.time;
    this.owed = false;
    const started = performance.now();
    this.place(camera, width, height, dt);
    this.wait = Math.min(
      Math.ceil((performance.now() - started) / this.placeBudget) - 1,
      LABEL_PLACE_MAX_WAIT,
    );
    if (this.animating || this.wait > 0) view.invalidate?.();
  }

  /**
   * Free what it holds on the GPU: drawn again, it is made anew. With `renderer`, its
   * materials are let go as they finish compiling (`releaseMaterial`).
   */
  release(renderer: WebGLRenderer | null = this.renderer) {
    for (const mesh of this.meshes) {
      mesh.geometry.dispose();
      if (renderer) releaseMaterial(renderer, mesh.material);
      else mesh.material.dispose();
    }
    this.records.dispose();
    this.runs.dispose();
    this.styles.dispose();
    this.atlas.texture.dispose();
    this.atlas.glyphTable.dispose();
  }

  /** Free it for good: its GPU resources and its atlas. */
  dispose(renderer: WebGLRenderer | null = this.renderer) {
    this.release(renderer);
    this.atlas.dispose();
  }

  // Write the records and runs of each layer whose labels changed (all, once its atlas is
  // packed again); laid out again, each layer a block of each, when one outgrows its own.
  // True if any.
  private writeRecords() {
    const atlasChanged = this.atlas.generation !== this.generation;
    if (atlasChanged) for (const layer of this.layers) layer.dataDirty = true;
    if (!this.relayout && !this.layers.some(layer => layer.dataDirty))
      return false;
    for (const layer of this.layers) {
      if (!layer.dataDirty) continue;
      layer.all = layer.provided.length
        ? layer.labels.length
          ? layer.labels.concat(layer.provided)
          : layer.provided
        : layer.labels;
      this.expand(layer);
    }
    // Their texts in the atlas's glyphs: twice at the most, once more after the atlas is
    // packed again. Still full, each layer draws those of its labels whose texts are in.
    let full = false;
    for (let attempt = 0; attempt < 2; attempt++) {
      const last = attempt === 1;
      full = false;
      for (const layer of this.layers) {
        if (!layer.dataDirty) continue;
        this.atlas.track(layer, layer.sources, layer.style);
        if (!this.resolve(layer)) {
          full = true;
          if (!last) break;
        }
      }
      if (!full || last) break;
      this.atlas.repack();
      for (const layer of this.layers) layer.dataDirty = true;
    }
    for (const layer of this.layers) {
      if (
        layer.dataDirty &&
        (layer.sources.length > layer.capacity ||
          layer.glyphNeed > layer.glyphCapacity)
      )
        this.relayout = true;
    }
    if (this.relayout) this.layOut();
    for (const layer of this.layers)
      if (layer.dataDirty) this.writeLayer(layer);
    for (const layer of this.layers) layer.dataDirty = false;
    if (full) this.warnFull();
    this.records.upload();
    this.runs.upload();
    this.generation = this.atlas.generation;
    this.uniforms.uAtlas.value = this.atlas.texture;
    this.uniforms.uGlyphs.value = this.atlas.glyphTable;
    return true;
  }

  // Where and as what each of `layer`'s labels may be drawn (`labelSources`): its places,
  // or its text's line breaks where it has room of its own, measured by the atlas.
  private expand(layer: LabelGroupLayer) {
    const labels = layer.all;
    if (layer.starts.length < labels.length + 1)
      layer.starts = new Int32Array(Math.ceil((labels.length + 1) * 1.5));
    layer.sources.length = 0;
    const { style } = layer;
    labelSources(
      labels,
      style.maxLines,
      line => this.atlas.measure(line, style),
      layer.sources,
      layer.starts,
    );
  }

  // Lay each of `layer`'s sources' texts out in the atlas's glyphs, each distinct text once:
  // its run, and where in the layer's block of runs. False if the atlas is full: those
  // before are in (`resolved`).
  private resolve(layer: LabelGroupLayer) {
    const { sources, style } = layer;
    if (layer.runOf.length < sources.length)
      layer.runOf = new Int32Array(Math.ceil(sources.length * 1.5));
    layer.uniqueRuns.length = 0;
    layer.uniqueOffsets.length = 0;
    const unique = new Map<string, number>();
    let glyphs = 0;
    for (let r = 0; r < sources.length; r++) {
      const { text } = sources[r];
      let u = unique.get(text);
      if (u === undefined) {
        const run = this.atlas.text(text, style);
        if (!run) {
          layer.resolved = r;
          layer.glyphNeed = glyphs;
          return false;
        }
        u = layer.uniqueRuns.length;
        unique.set(text, u);
        layer.uniqueRuns.push(run);
        layer.uniqueOffsets.push(glyphs);
        glyphs += run.count;
      }
      layer.runOf[r] = u;
    }
    layer.resolved = sources.length;
    layer.glyphNeed = glyphs;
    return true;
  }

  // Each layer a block of records and a block of runs with room to grow, the textures
  // grown to them: all written again, and uploaded whole.
  private layOut() {
    let next = 0;
    let nextGlyph = 0;
    for (const layer of this.layers) {
      const count = layer.sources.length;
      layer.capacity = count > layer.capacity ? Math.ceil(count * 1.5) : count;
      layer.first = next;
      next += layer.capacity;
      const glyphs = layer.glyphNeed;
      layer.glyphCapacity =
        glyphs > layer.glyphCapacity ? Math.ceil(glyphs * 1.5) : glyphs;
      layer.glyphFirst = nextGlyph;
      nextGlyph += layer.glyphCapacity;
      layer.dataDirty = true;
    }
    this.records.grow(Math.max(1, Math.ceil(next / (LABEL_RECORDS_WIDTH / 4))));
    this.runs.grow(Math.max(1, Math.ceil(nextGlyph / LABEL_RECORDS_WIDTH)));
    this.records.all();
    this.runs.all();
    this.relayout = false;
  }

  // Write `layer`'s records, their extents and room, its texts' runs, and its labels'
  // priorities and keys: those whose texts are all in (`resolve`). Its labels keep their
  // places by key.
  private writeLayer(layer: LabelGroupLayer) {
    const labels = layer.all;
    const sources = layer.sources;
    if (layer.extents.length < sources.length * LABEL_EXTENT_FLOATS) {
      layer.extents = new Float32Array(layer.capacity * LABEL_EXTENT_FLOATS);
      layer.reaches = new Float32Array(layer.capacity);
      layer.world = new Float32Array(layer.capacity * 9);
      layer.room = new Float32Array(layer.capacity * 2);
    }
    if (layer.priorities.length < labels.length)
      layer.priorities = new Float32Array(Math.ceil(labels.length * 1.5));
    // Whole labels, all their places.
    let count = labels.length;
    while (count > 0 && layer.starts[count] > layer.resolved) count--;
    const records = layer.starts[count];
    const runs = new Array<LabelTextRun>(records);
    const runStarts = new Int32Array(records);
    for (let r = 0; r < records; r++) {
      const u = layer.runOf[r];
      runs[r] = layer.uniqueRuns[u];
      runStarts[r] = layer.glyphFirst + layer.uniqueOffsets[u];
    }
    const data = this.records.data;
    writeLabelRecords(
      records === sources.length ? sources : sources.slice(0, records),
      runs,
      runStarts,
      layer.row,
      data,
      layer.first,
      layer.extents,
    );
    const glyphs = this.runs.data;
    for (let u = 0; u < layer.uniqueRuns.length; u++)
      glyphs.set(
        layer.uniqueRuns[u].glyphs,
        (layer.glyphFirst + layer.uniqueOffsets[u]) * LABEL_RUN_FLOATS,
      );
    const keys = labels.slice(0, count).map(labelKey);
    const before = new Map<string, number>();
    layer.keys.forEach((key, i) => before.set(key, i));
    const alpha = new Float32Array(count);
    const cooldown = new Float32Array(count);
    const shown = new Uint8Array(count);
    const place = new Uint16Array(count);
    const fit = new Float32Array(count).fill(1);
    const anchor = labelAnchor(layer.style.align, layer.style.baseline);
    for (let r = 0; r < records; r++) {
      layer.reaches[r] = labelReach(
        layer.extents[r * LABEL_EXTENT_FLOATS],
        layer.extents[r * LABEL_EXTENT_FLOATS + 1],
        anchor,
        layer.style.offset,
      );
      const bounds = sources[r].bounds;
      layer.room[r * 2] = bounds ? bounds[0] : Infinity;
      layer.room[r * 2 + 1] = bounds ? bounds[1] : Infinity;
    }
    for (let i = 0; i < count; i++) {
      layer.priorities[i] = layer.priority + (labels[i].priority ?? 0);
      const was = before.get(keys[i]);
      if (was === undefined || was >= layer.count) continue;
      alpha[i] = layer.alpha[was];
      cooldown[i] = layer.cooldown[was];
      shown[i] = layer.shown[was];
      if (layer.place[was] < layer.starts[i + 1] - layer.starts[i]) {
        place[i] = layer.place[was];
        fit[i] = layer.fit[was];
      }
    }
    layer.keys = keys;
    layer.alpha = alpha;
    layer.cooldown = cooldown;
    layer.shown = shown;
    layer.place = place;
    layer.fit = fit;
    layer.count = count;
    layer.records = records;
    layer.bounds.bound(data, layer.first, records, layer.extents, layer.style);
    layer.worldDirty = true;
    this.records.range(
      layer.first * LABEL_RECORD_FLOATS,
      records * LABEL_RECORD_FLOATS,
    );
    this.runs.range(
      layer.glyphFirst * LABEL_RUN_FLOATS,
      layer.glyphNeed * LABEL_RUN_FLOATS,
    );
  }

  // Tell, once, that its atlas cannot hold every glyph its layers draw.
  private warnFull() {
    if (this.warned) return;
    this.warned = true;
    const missing = this.layers.reduce(
      (sum, layer) => sum + layer.all.length - layer.count,
      0,
    );
    console.warn(
      `Labels: the glyph atlas is full; ${missing} labels are not drawn. Each distinct character, font and halo width takes room: give fewer fonts or halo widths, or split the layers into <Labels> groups of their own.`,
    );
  }

  // Write each changed layer's style row: its colours, size, fades, placement and frame.
  private writeStyles() {
    const data = this.styles.data;
    let any = false;
    for (const layer of this.layers) {
      if (!layer.styleDirty) continue;
      layer.styleDirty = false;
      any = true;
      const style = layer.style;
      const at = layer.row * STYLE_FLOATS;
      // In display values: the shader mixes fill and halo as a canvas does.
      cssDisplayColor(style.color, scratchDisplay);
      data[at] = scratchDisplay.x;
      data[at + 1] = scratchDisplay.y;
      data[at + 2] = scratchDisplay.z;
      data[at + 3] = style.opacity;
      cssDisplayColor(style.haloColor, scratchDisplay);
      data[at + 4] = scratchDisplay.x;
      data[at + 5] = scratchDisplay.y;
      data[at + 6] = scratchDisplay.z;
      data[at + 7] = style.haloWidth > 0 ? scratchDisplay.w : 0;
      data[at + 8] = style.size * layer.scale;
      data[at + 9] = SIZING[style.sizing] ?? 0;
      data[at + 10] = style.distanceFactor;
      data[at + 11] = style.minScale;
      const { facing, pixels } = labelFadeRanges(style, scratchRanges);
      data[at + 12] = facing[0];
      data[at + 13] = facing[1];
      data[at + 14] = pixels[0];
      data[at + 15] = pixels[1];
      data[at + 16] = style.minDistance;
      data[at + 17] = Math.min(style.maxDistance, LARGEST);
      data[at + 18] = style.fadeDistance;
      data[at + 19] = Math.min(style.maxPixels, LARGEST);
      const [ax, ay] = labelAnchor(style.align, style.baseline);
      data[at + 20] = ax;
      data[at + 21] = ay;
      data[at + 22] = style.offset[0];
      data[at + 23] = style.offset[1];
      data[at + 24] = style.lift;
      data[at + 25] = style.liftPerDistance;
      data[at + 26] = style.flip ? 1 : 0;
      data[at + 27] = labelSlantLeast(style.slantGrowth);
      data.set(layer.matrix.elements, at + 28);
      this.styles.range(at, STYLE_FLOATS);
    }
    if (!any) return;
    this.styles.upload();
  }

  // Where each record lies in the world, from its record and its layer's frame, as the
  // vertex shader has it: its normal and reading direction by the frame's 3 × 3, unit length.
  private placeInWorld(layer: LabelGroupLayer) {
    layer.worldDirty = false;
    const data = this.records.data;
    const m = layer.matrix.elements;
    const world = layer.world;
    for (let i = 0; i < layer.records; i++) {
      const r = (layer.first + i) * LABEL_RECORD_FLOATS;
      const w = i * 9;
      const x = data[r];
      const y = data[r + 1];
      const z = data[r + 2];
      world[w] = m[0] * x + m[4] * y + m[8] * z + m[12];
      world[w + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
      world[w + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
      turnUnit(m, data, r + 4, world, w + 3);
      turnUnit(m, data, r + 8, world, w + 6);
    }
  }

  // Place every label for the view: where each lies on screen as drawn, the best let in
  // where they meet, each faded toward shown or not, and those seen written farthest first.
  private place(camera: Camera, width: number, height: number, dt: number) {
    const v = viewProjection.elements;
    const p = camera.projectionMatrix.elements;
    this.projection = p;
    const far = (camera as { far?: number }).far ?? 0;
    cameraPosition.setFromMatrixPosition(camera.matrixWorld);
    forward.set(0, 0, -1).transformDirection(camera.matrixWorld);
    const total = this.layers.reduce((sum, layer) => sum + layer.count, 0);
    const c = this.grow(total);
    const halfDiagonal2 = (width * width + height * height) / 4 || 1;
    let n = 0;
    let nearest = Infinity;
    let farthest = 0;
    let animating = false;

    for (let li = 0; li < this.layers.length; li++) {
      const layer = this.layers[li];
      const style = layer.style;
      // Counting down whether seen or not.
      for (let i = 0; i < layer.count; i++) {
        if (layer.cooldown[i] > 0) {
          layer.cooldown[i] = Math.max(layer.cooldown[i] - dt, 0);
          animating = true;
        }
      }
      if (
        !layer.visible ||
        layer.count === 0 ||
        style.opacity <= 0 ||
        !layer.bounds.reachable(
          camera,
          height,
          layer.matrix,
          style,
          layer.scale,
        )
      ) {
        layer.alpha.fill(0);
        layer.shown.fill(0);
        continue;
      }
      if (layer.worldDirty) this.placeInWorld(layer);
      const data = this.records.data;
      const world = layer.world;
      const [ax, ay] = labelAnchor(style.align, style.baseline);
      const [ox, oy] = style.offset;
      // Its frame's scale: a record's room is in its frame's units.
      const frameScale = layer.matrix.getMaxScaleOnAxis();
      for (let i = 0; i < layer.count; i++) {
        // Which of its places, shrunk how much: by the room each has as the view sizes it.
        const start = layer.starts[i];
        const places = layer.starts[i + 1] - start;
        let r = start;
        let fit = 1;
        if (
          places > 1 ||
          layer.room[start * 2] < Infinity ||
          layer.room[start * 2 + 1] < Infinity
        ) {
          if (this.room.length < places)
            this.room = new Float64Array(Math.ceil(places * 1.5));
          for (let k = 0; k < places; k++)
            this.room[k] = this.roomAt(layer, start + k, height, frameScale);
          labelPlaceChoice(this.room, places, layer.place[i], choice);
          layer.place[i] = choice.place;
          fit = choice.fit;
          r = start + choice.place;
        }
        layer.fit[i] = fit;
        const w = r * 9;
        const px = world[w];
        const py = world[w + 1];
        const pz = world[w + 2];
        const nx = world[w + 3];
        const ny = world[w + 4];
        const nz = world[w + 5];
        const gx = world[w + 6];
        const gy = world[w + 7];
        const gz = world[w + 8];
        const tx = cameraPosition.x - px;
        const ty = cameraPosition.y - py;
        const tz = cameraPosition.z - pz;
        const away = Math.sqrt(tx * tx + ty * ty + tz * tz);
        const facing = away > 1e-6 ? (tx * nx + ty * ny + tz * nz) / away : 0;
        const depth = v[3] * px + v[7] * py + v[11] * pz + v[15];
        if (facing <= 0 || depth <= 0) {
          layer.alpha[i] = 0;
          layer.shown[i] = 0;
          continue;
        }
        const perUnit = (p[5] * height * 0.5) / Math.max(depth, 1e-6);
        const own = data[(layer.first + r) * LABEL_RECORD_FLOATS + 7];
        // Its font face-on as drawn: as its sizing has it, no larger than its largest, and
        // shrunk to fit its room.
        const pixels =
          Math.min(
            labelPixels(style, own * layer.scale, perUnit, height, facing),
            style.maxPixels,
          ) * fit;
        const size = pixels / perUnit;
        const reach = layer.reaches[r] * size;
        // Off the view by more than its text reaches: not drawn, and in no one's way.
        const sx0 =
          ((v[0] * px + v[4] * py + v[8] * pz + v[12]) / depth) * 0.5 + 0.5;
        const sy0 =
          0.5 - ((v[1] * px + v[5] * py + v[9] * pz + v[13]) / depth) * 0.5;
        const radius = reach * perUnit;
        if (
          sx0 * width + radius < 0 ||
          sx0 * width - radius > width ||
          sy0 * height + radius < 0 ||
          sy0 * height - radius > height
        ) {
          layer.alpha[i] = 0;
          layer.shown[i] = 0;
          continue;
        }
        const deepest =
          -(tx * forward.x + ty * forward.y + tz * forward.z) + reach;
        const fade = labelFade(style, facing, pixels, away, deepest, far);
        if (fade <= 0) {
          layer.alpha[i] = 0;
          layer.shown[i] = 0;
          continue;
        }
        // Its cell's middle off its position, and its ink's half extent: what it keeps others
        // from, the same flipped or not.
        const e = r * LABEL_EXTENT_FLOATS;
        const mx = ax * layer.extents[e] + ox;
        const my = ay * layer.extents[e + 1] + oy;
        const iw = layer.extents[e + 2];
        const ih = layer.extents[e + 3];
        // Its quad on screen, as the shader draws it: lifted toward the camera.
        const lift = Math.min(
          style.lift + style.liftPerDistance * away,
          0.5 * away,
        );
        const bx = px + (tx / away) * lift;
        const by = py + (ty / away) * lift;
        const bz = pz + (tz / away) * lift;
        // Its top: normal × reading direction.
        const ux = ny * gz - nz * gy;
        const uy = nz * gx - nx * gz;
        const uz = nx * gy - ny * gx;
        const q = n * LABEL_QUAD_FLOATS;
        let footprint = true;
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (let k = 0; k < 4; k++) {
          const lx = (mx + corner[k * 2] * iw) * size;
          const ly = (my + corner[k * 2 + 1] * ih) * size;
          const x = bx + gx * lx + ux * ly;
          const y = by + gy * lx + uy * ly;
          const z = bz + gz * lx + uz * ly;
          const cw = v[3] * x + v[7] * y + v[11] * z + v[15];
          if (cw <= 1e-6) {
            footprint = false;
            break;
          }
          const sx =
            ((v[0] * x + v[4] * y + v[8] * z + v[12]) / cw) * 0.5 + 0.5;
          const sy =
            0.5 - ((v[1] * x + v[5] * y + v[9] * z + v[13]) / cw) * 0.5;
          c.quads[q + k * 2] = sx * width;
          c.quads[q + k * 2 + 1] = sy * height;
          minX = Math.min(minX, sx * width);
          maxX = Math.max(maxX, sx * width);
          minY = Math.min(minY, sy * height);
          maxY = Math.max(maxY, sy * height);
        }
        // Off the view: not drawn, and in no one's way.
        if (
          footprint &&
          (maxX < 0 || minX > width || maxY < 0 || minY > height)
        ) {
          layer.alpha[i] = 0;
          layer.shown[i] = 0;
          continue;
        }
        const cx = (minX + maxX) / 2 - width / 2;
        const cy = (minY + maxY) / 2 - height / 2;
        c.layer[n] = li;
        c.label[n] = i;
        // Across the camera's plane (it reaches behind it): drawn, in no one's way.
        c.free[n] = layer.overlap || !footprint ? 1 : 0;
        c.bands[n] = labelBand(style.distanceFactor, height / perUnit);
        c.depth[n] = depth;
        c.distance[n] = away;
        c.fade[n] = fade;
        c.centre[n] = footprint ? (cx * cx + cy * cy) / halfDiagonal2 : 0;
        nearest = Math.min(nearest, away);
        farthest = Math.max(farthest, away);
        n++;
      }
    }

    // Ranked, best first; those cooling down after being pushed out sit out.
    const logNear = Math.log(Math.max(nearest, 1e-6));
    const logSpan = Math.log(Math.max(farthest, 1e-6)) - logNear || 1;
    let ranked = 0;
    for (let k = 0; k < n; k++) {
      const layer = this.layers[c.layer[k]];
      const i = c.label[k];
      c.accepted[k] = 0;
      if (layer.cooldown[i] > 0 && !c.free[k]) continue;
      c.ranks[k] = labelRank(
        layer.priorities[i],
        layer.shown[i] === 1,
        c.fade[k],
        c.centre[k],
        (Math.log(Math.max(c.distance[k], 1e-6)) - logNear) / logSpan,
      );
      c.order[ranked++] = k;
    }
    const order = c.order.subarray(0, ranked);
    order.sort((a, b) => c.ranks[b] - c.ranks[a]);
    this.placer.place(
      ranked,
      order,
      c.quads,
      c.bands,
      c.free,
      this.margin,
      c.accepted,
    );

    // Faded toward let in or pushed out; those seen drawn, farthest first.
    let seen = 0;
    for (let k = 0; k < n; k++) {
      const layer = this.layers[c.layer[k]];
      const i = c.label[k];
      const accepted = c.accepted[k] === 1;
      if (layer.shown[i] && !accepted) layer.cooldown[i] = LABEL_COOLDOWN;
      layer.shown[i] = accepted ? 1 : 0;
      const target = accepted ? 1 : 0;
      const alpha = stepLabelFade(layer.alpha[i], target, dt);
      layer.alpha[i] = alpha;
      if (alpha !== target) animating = true;
      if (alpha > 0) this.drawOrder[seen++] = k;
    }
    const drawOrder = this.drawOrder.subarray(0, seen);
    drawOrder.sort((a, b) => c.depth[b] - c.depth[a]);
    const counts = [0, 0];
    this.ensureDraws(seen);
    for (const k of drawOrder) {
      const layer = this.layers[c.layer[k]];
      const i = c.label[k];
      const which = layer.style.depthTest ? 0 : 1;
      const out = this.draws[which];
      const at = counts[which]++ * 4;
      out[at] = layer.first + layer.starts[i] + layer.place[i];
      out[at + 1] = layer.alpha[i];
      out[at + 2] = layer.fit[i];
      out[at + 3] = 0;
    }
    for (let which = 0; which < 2; which++) {
      const mesh = this.meshes[which];
      const geometry = mesh.geometry;
      geometry.instanceCount = counts[which];
      mesh.visible = counts[which] > 0;
      const attribute = geometry.getAttribute(
        'labelDraw',
      ) as InstancedBufferAttribute;
      attribute.clearUpdateRanges();
      attribute.addUpdateRange(0, counts[which] * 4);
      attribute.needsUpdate = true;
    }
    this.animating = animating;
  }

  // The room record `r` of `layer` has for its text as the view sizes it (see
  // `labelPlaceChoice`): the least of its room over its ink's extent either way, in the
  // world, its size as drawn there; 0 where it is not seen (behind the camera, or facing
  // away).
  private roomAt(
    layer: LabelGroupLayer,
    r: number,
    height: number,
    frameScale: number,
  ) {
    const width = layer.room[r * 2];
    const tall = layer.room[r * 2 + 1];
    if (width === Infinity && tall === Infinity) return Infinity;
    const v = viewProjection.elements;
    const w = r * 9;
    const px = layer.world[w];
    const py = layer.world[w + 1];
    const pz = layer.world[w + 2];
    const tx = cameraPosition.x - px;
    const ty = cameraPosition.y - py;
    const tz = cameraPosition.z - pz;
    const away = Math.sqrt(tx * tx + ty * ty + tz * tz);
    const facing =
      away > 1e-6
        ? (tx * layer.world[w + 3] +
            ty * layer.world[w + 4] +
            tz * layer.world[w + 5]) /
          away
        : 0;
    const depth = v[3] * px + v[7] * py + v[11] * pz + v[15];
    if (facing <= 0 || depth <= 0) return 0;
    const perUnit = (this.projection[5] * height * 0.5) / Math.max(depth, 1e-6);
    const data = this.records.data;
    const own = data[(layer.first + r) * LABEL_RECORD_FLOATS + 7];
    const style = layer.style;
    const size =
      Math.min(
        labelPixels(style, own * layer.scale, perUnit, height, facing),
        style.maxPixels,
      ) / perUnit;
    const e = r * LABEL_EXTENT_FLOATS;
    return Math.min(
      (width * frameScale) / (layer.extents[e + 2] * size),
      (tall * frameScale) / (layer.extents[e + 3] * size),
    );
  }

  // Room for `count` candidates.
  private grow(count: number) {
    const c = this.candidates;
    if (c.layer.length >= count) return c;
    const size = Math.ceil(count * 1.5);
    this.candidates = {
      layer: new Int32Array(size),
      label: new Int32Array(size),
      quads: new Float32Array(size * LABEL_QUAD_FLOATS),
      bands: new Uint8Array(size),
      free: new Uint8Array(size),
      accepted: new Uint8Array(size),
      ranks: new Float64Array(size),
      depth: new Float32Array(size),
      distance: new Float32Array(size),
      fade: new Float32Array(size),
      centre: new Float32Array(size),
      order: new Int32Array(size),
    };
    this.drawOrder = new Int32Array(size);
    return this.candidates;
  }

  // Room for `count` labels drawn by each mesh: its geometry made anew to grow.
  private ensureDraws(count: number) {
    for (let which = 0; which < 2; which++) {
      if (this.draws[which].length >= count * 4) continue;
      const capacity = Math.ceil(count * 1.5);
      this.meshes[which].geometry.dispose();
      this.meshes[which].geometry = this.createGeometry(capacity, which);
    }
  }

  // A quad, -0.5 to 0.5 across and up, and room for `capacity` labels drawn.
  private createGeometry(capacity: number, which: number) {
    const geometry = new InstancedBufferGeometry();
    geometry.setAttribute(
      'position',
      new BufferAttribute(
        new Float32Array([
          -0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0,
        ]),
        3,
      ),
    );
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    this.draws[which] = new Float32Array(capacity * 4);
    geometry.setAttribute(
      'labelDraw',
      new InstancedBufferAttribute(this.draws[which], 4).setUsage(
        DynamicDrawUsage,
      ),
    );
    geometry.instanceCount = 0;
    return geometry;
  }

  private createMesh(depthTest: boolean) {
    const which = depthTest ? 0 : 1;
    const material = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: this.uniforms,
      defines: {
        LABEL_RECORDS_WIDTH,
        LABEL_GLYPHS_WIDTH,
        LABEL_GLYPH_TEXELS,
        LABEL_RASTER_SIZE: LABEL_RASTER_SIZE.toFixed(1),
        LABEL_LINE_HEIGHT: LABEL_LINE_HEIGHT.toFixed(2),
      },
      transparent: true,
      premultipliedAlpha: true,
      depthWrite: false,
      depthTest,
    });
    const mesh = new Mesh(this.createGeometry(0, which), material);
    // Its quads are placed in the shader: its bounds would mean nothing.
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.visible = false;
    mesh.name = depthTest ? 'labels' : 'labels-over';
    // Drawn last by the OITRenderPass, after the transparent layers resolve, with their
    // own blending; elsewhere, after the transparent objects, those drawn over everything
    // last. Never picked.
    mesh.layers.enable(LAYERS.OVERLAY);
    mesh.layers.enable(LAYERS.NOT_EMITTER);
    mesh.renderOrder = depthTest ? 1000 : 1001;
    return mesh;
  }
}

// Turn the direction at `from` in `data` by the 3 × 3 of `m` (a matrix's elements), unit
// length, into `out` at `to`: as the shader's normalize(mat3(frame) * v).
function turnUnit(
  m: ArrayLike<number>,
  data: Float32Array,
  from: number,
  out: Float32Array,
  to: number,
) {
  const vx = data[from];
  const vy = data[from + 1];
  const vz = data[from + 2];
  const tx = m[0] * vx + m[4] * vy + m[8] * vz;
  const ty = m[1] * vx + m[5] * vy + m[9] * vz;
  const tz = m[2] * vx + m[6] * vy + m[10] * vz;
  const length = Math.hypot(tx, ty, tz) || 1;
  out[to] = tx / length;
  out[to + 1] = ty / length;
  out[to + 2] = tz / length;
}

// Mark `count` floats of `texture` from `start` to upload, a row of `row` floats at a time
// (three uploads a range within one row).
function addRowRanges(
  texture: DataTexture,
  start: number,
  count: number,
  row: number,
) {
  let at = start;
  const end = start + count;
  while (at < end) {
    const rowEnd = (Math.floor(at / row) + 1) * row;
    const to = Math.min(end, rowEnd);
    texture.addUpdateRange(at, to - at);
    at = to;
  }
}

/**
 * A float RGBA texture of a label group's — its records, its styles, its texts' runs of
 * glyphs — `width` texels a row: uploaded whole at its next upload once made anew, laid
 * out again or freed on the GPU, till three tells it has uploaded it (`onUpdate`); by the
 * ranges marked (`range`) after. A range uploaded first, into a texture newly made on the
 * GPU, would leave the rest of it zero.
 */
class GroupTexture {
  texture: DataTexture;
  private whole = true;

  constructor(
    readonly width: number,
    rows: number,
    private readonly bind: (texture: DataTexture) => void,
  ) {
    this.texture = this.create(rows);
  }

  get rows() {
    return this.texture.image.height;
  }

  get data() {
    return this.texture.image.data as Float32Array;
  }

  /** At least `rows` rows, made anew if it had fewer (its data lost: write it all again). True if made anew. */
  grow(rows: number) {
    if (rows <= this.rows) return false;
    this.texture.dispose();
    this.texture = this.create(rows);
    return true;
  }

  /** Upload all of it at its next upload. */
  all() {
    this.whole = true;
  }

  /** Upload `count` floats from `start` at its next upload (all of it while whole). */
  range(start: number, count: number) {
    if (!this.whole && count > 0)
      addRowRanges(this.texture, start, count, this.width * 4);
  }

  /** Upload what was marked at its next upload. */
  upload() {
    if (this.whole) this.texture.clearUpdateRanges();
    this.texture.needsUpdate = true;
  }

  dispose() {
    this.texture.dispose();
  }

  private create(rows: number) {
    const texture = new DataTexture(
      new Float32Array(this.width * 4 * rows),
      this.width,
      rows,
      RGBAFormat,
      FloatType,
    );
    texture.minFilter = NearestFilter;
    texture.magFilter = NearestFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    // Freed on the GPU (`release`, or by anyone), it is made anew at its next use from what
    // is to upload: the whole of it, not the ranges last marked, or the rest would be zero.
    texture.addEventListener('dispose', () => {
      texture.clearUpdateRanges();
      if (texture === this.texture) this.whole = true;
    });
    // Uploaded: ranges will do from now on.
    texture.onUpdate = () => {
      if (texture === this.texture) this.whole = false;
    };
    this.whole = true;
    this.bind(texture);
    return texture;
  }
}
