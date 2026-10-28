import {
  BufferAttribute,
  Color,
  InstancedBufferGeometry,
  InstancedInterleavedBuffer,
  InterleavedBufferAttribute,
  Mesh,
  ShaderMaterial,
  SRGBColorSpace,
  Texture,
  Uniform,
  Vector2,
  Vector3,
  Vector4,
} from 'three';
import { LAYERS } from '../../layers/layers';
import type { LabelAtlas, LabelAtlasEntry } from './label-atlas';
import {
  labelAnchor,
  LabelFadeRanges,
  labelFadeRanges,
  labelFrame,
} from './label-geometry';
import fragmentShader from './shaders/label-fragment.glsl';
import vertexShader from './shaders/label-vertex.glsl';
import type { Label, LabelStyle } from './types';

/** What {@link writeLabelInstances} asks of an atlas: where a text is, if it has room. */
export type LabelTexts = {
  entry(text: string, style: LabelStyle): LabelAtlasEntry | null;
};

/**
 * Floats per label in {@link writeLabelInstances}: its position, normal and reading
 * direction (3 each), its place in the atlas (4) and its size in ems (2).
 */
export const LABEL_INSTANCE_FLOATS = 15;

const normal = new Vector3();
const along = new Vector3();
const top = new Vector3();

/**
 * Write `labels`' instances into `out` (`LABEL_INSTANCE_FLOATS` each, from the start):
 * where each is, its frame (see `labelFrame`) and its text's place in `texts`. False if
 * `texts` ran out of room, with `out` part written.
 */
export function writeLabelInstances(
  labels: readonly Label[],
  style: LabelStyle,
  texts: LabelTexts,
  out: Float32Array,
) {
  let at = 0;
  for (const label of labels) {
    const entry = texts.entry(label.text, style);
    if (!entry) return false;
    if (label.normal) normal.fromArray(label.normal).normalize();
    else normal.set(0, 1, 0);
    labelFrame(normal, label.direction, along, top);
    out[at++] = label.position[0];
    out[at++] = label.position[1];
    out[at++] = label.position[2];
    out[at++] = normal.x;
    out[at++] = normal.y;
    out[at++] = normal.z;
    out[at++] = along.x;
    out[at++] = along.y;
    out[at++] = along.z;
    out[at++] = entry.u0;
    out[at++] = entry.v0;
    out[at++] = entry.u1;
    out[at++] = entry.v1;
    out[at++] = entry.width;
    out[at++] = entry.height;
  }
  return true;
}

const RGBA = /^rgba?\(([^)]*)\)$/i;
const HEX_ALPHA = /^#([0-9a-f]{6})([0-9a-f]{2})$/i;

/** Set `color` from a CSS colour, its alpha left out; the alpha. */
export function cssColorAlpha(css: string, color: Color) {
  const text = css.trim();
  const rgba = RGBA.exec(text);
  if (rgba) {
    const parts = rgba[1].split(/[\s,/]+/).filter(Boolean);
    color.setStyle(`rgb(${parts.slice(0, 3).join(',')})`);
    if (parts.length < 4) return 1;
    const alpha = parseFloat(parts[3]);
    return parts[3].endsWith('%') ? alpha / 100 : alpha;
  }
  const hex = HEX_ALPHA.exec(text);
  if (hex) {
    color.setStyle(`#${hex[1]}`);
    return parseInt(hex[2], 16) / 255;
  }
  color.setStyle(text);
  return 1;
}

const scratchColor = new Color();
const scratchDisplay = new Vector4();
const scratchRanges: LabelFadeRanges = { facing: [0, 0], pixels: [0, 0] };
const scratchRgb = { r: 0, g: 0, b: 0 };

/**
 * A CSS colour in display (sRGB) values, 0 to 1, and its alpha (x, y, z and w of `target`):
 * as a canvas mixes colours, not as the scene does.
 */
export function cssDisplayColor(css: string, target: Vector4) {
  const alpha = cssColorAlpha(css, scratchColor);
  scratchColor.getRGB(scratchRgb, SRGBColorSpace);
  return target.set(scratchRgb.r, scratchRgb.g, scratchRgb.b, alpha);
}

/**
 * A layer's labels as one instanced draw: a quad per label, painted in its plane, its text
 * from the atlas (see `shaders/label-vertex.glsl`). Its instances are written again only
 * when its labels change.
 */
export class LabelLayerMesh {
  readonly mesh: Mesh<InstancedBufferGeometry, ShaderMaterial>;
  /** the labels it draws */
  labels: readonly Label[] = [];
  /** the `LabelAtlas.generation` its texts were looked up in */
  generation = -1;
  private data = new Float32Array(0);
  // The style's size, and the live multiplier on it (setScale).
  private size = 1;
  private scale = 1;

  constructor() {
    const material = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uAtlas: new Uniform<Texture | null>(null),
        uColor: new Uniform(new Vector3(1, 1, 1)),
        uHaloColor: new Uniform(new Vector4()),
        uSize: new Uniform(1),
        uFacing: new Uniform(new Vector2()),
        uPixels: new Uniform(new Vector2()),
        uDistance: new Uniform(new Vector3(0, 3.4e38, 0)),
        uOpacity: new Uniform(1),
        uAnchor: new Uniform(new Vector2()),
        uOffset: new Uniform(new Vector2()),
        uLift: new Uniform(new Vector2()),
        uViewHeight: new Uniform(1),
        uFar: new Uniform(0),
        uMaxPixels: new Uniform(3.4e38),
        uFlip: new Uniform(0),
      },
      transparent: true,
      premultipliedAlpha: true,
      depthWrite: false,
    });
    this.mesh = new Mesh(this.createGeometry(0), material);
    // Its quads are placed in the shader: its bounds would mean nothing.
    this.mesh.frustumCulled = false;
    this.mesh.name = 'labels';
    // Drawn last by the OITRenderPass, after the transparent layers resolve, with its own
    // blending; elsewhere, after the transparent objects. Never picked.
    this.mesh.layers.enable(LAYERS.OVERLAY);
    this.mesh.layers.enable(LAYERS.NOT_EMITTER);
    this.mesh.renderOrder = 1000;
  }

  /** the labels it draws */
  get count() {
    return this.mesh.geometry.instanceCount;
  }

  setStyle(style: LabelStyle) {
    const { uniforms } = this.mesh.material;
    // In display values: the shader mixes fill and halo as a canvas does.
    const fill = cssDisplayColor(style.color, scratchDisplay);
    uniforms.uColor.value.set(fill.x, fill.y, fill.z);
    const halo = cssDisplayColor(style.haloColor, uniforms.uHaloColor.value);
    if (style.haloWidth <= 0) halo.w = 0;
    this.size = style.size;
    uniforms.uSize.value = style.size * this.scale;
    const { facing, pixels } = labelFadeRanges(style, scratchRanges);
    uniforms.uFacing.value.set(facing[0], facing[1]);
    uniforms.uPixels.value.set(pixels[0], pixels[1]);
    uniforms.uMaxPixels.value = Math.min(style.maxPixels, 3.4e38);
    // A float's largest, for Infinity.
    uniforms.uDistance.value.set(
      style.minDistance,
      Math.min(style.maxDistance, 3.4e38),
      style.fadeDistance,
    );
    uniforms.uOpacity.value = style.opacity;
    uniforms.uAnchor.value.fromArray(labelAnchor(style.align, style.baseline));
    uniforms.uOffset.value.fromArray(style.offset);
    uniforms.uFlip.value = style.flip ? 1 : 0;
    uniforms.uLift.value.set(style.lift, style.liftPerDistance);
    this.mesh.material.depthTest = style.depthTest;
  }

  setAtlas(texture: Texture) {
    this.mesh.material.uniforms.uAtlas.value = texture;
  }

  setViewHeight(height: number) {
    this.mesh.material.uniforms.uViewHeight.value = height;
  }

  /** The camera's far plane (0: none known): labels fade out before it. */
  setFar(far: number) {
    this.mesh.material.uniforms.uFar.value = far;
  }

  /** Scale every label by `scale`, on the GPU alone: nothing is written again. */
  setScale(scale: number) {
    if (scale === this.scale) return;
    this.scale = scale;
    this.mesh.material.uniforms.uSize.value = this.size * scale;
  }

  /**
   * Draw `labels`, their texts from `atlas`, packing it again if it is full (its other
   * users then draw theirs again, as their `generation` tells them).
   */
  update(labels: readonly Label[], style: LabelStyle, atlas: LabelAtlas) {
    atlas.track(this, labels, style);
    if (!this.write(labels, style, atlas)) {
      atlas.repack();
      this.write(labels, style, atlas);
    }
    this.generation = atlas.generation;
    this.setAtlas(atlas.texture);
  }

  /** Draw `labels`; false if `texts` ran out of room (draws none then). */
  write(labels: readonly Label[], style: LabelStyle, texts: LabelTexts) {
    this.labels = labels;
    const floats = labels.length * LABEL_INSTANCE_FLOATS;
    if (floats > this.data.length) {
      // Grown by half again, not to grow at every label added.
      const capacity = Math.ceil(labels.length * 1.5);
      this.data = new Float32Array(capacity * LABEL_INSTANCE_FLOATS);
      this.mesh.geometry.dispose();
      this.mesh.geometry = this.createGeometry(capacity);
    }
    const written = writeLabelInstances(labels, style, texts, this.data);
    const geometry = this.mesh.geometry;
    geometry.instanceCount = written ? labels.length : 0;
    const buffer = (
      geometry.getAttribute('labelPosition') as InterleavedBufferAttribute
    ).data;
    buffer.clearUpdateRanges();
    buffer.addUpdateRange(0, floats);
    buffer.needsUpdate = true;
    return written;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }

  // A quad, -0.5 to 0.5 across and up, and room for `capacity` labels.
  private createGeometry(capacity: number) {
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
    if (this.data.length < capacity * LABEL_INSTANCE_FLOATS)
      this.data = new Float32Array(capacity * LABEL_INSTANCE_FLOATS);
    const buffer = new InstancedInterleavedBuffer(
      this.data,
      LABEL_INSTANCE_FLOATS,
    );
    const attribute = (size: number, offset: number) =>
      new InterleavedBufferAttribute(buffer, size, offset);
    geometry.setAttribute('labelPosition', attribute(3, 0));
    geometry.setAttribute('labelNormal', attribute(3, 3));
    geometry.setAttribute('labelAlong', attribute(3, 6));
    geometry.setAttribute('labelRect', attribute(4, 9));
    geometry.setAttribute('labelExtent', attribute(2, 13));
    geometry.instanceCount = 0;
    return geometry;
  }
}
