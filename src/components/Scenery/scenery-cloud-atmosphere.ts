import {
  ClampToEdgeWrapping,
  DataTexture,
  FloatType,
  HalfFloatType,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  NearestFilter,
  NoBlending,
  OrthographicCamera,
  RedFormat,
  RepeatWrapping,
  RGBAFormat,
  RGFormat,
  Scene,
  ShaderMaterial,
  Texture,
  Uniform,
  Vector2,
  Vector3,
  Vector4,
  WebGL3DRenderTarget,
  WebGLRenderer,
} from 'three';
import {
  ATMOSPHERE_LEVELS,
  ATMOSPHERE_MOISTURE,
  ATMOSPHERE_STEP,
  atmosphereExtent,
  atmosphereTable,
  THERMAL_SPREAD,
  type Atmosphere,
} from '../../sdk/weather/atmosphere';
import {
  binBubbles,
  BUBBLE_FLOATS,
  PATCHES_PERIOD,
  PATCHES_SIZE,
  patchesMap,
  SHEET_LOBES,
  SHEET_LUMPS,
  thermalBubbles,
} from '../../sdk/weather/thermal-field';
import { curlNoiseMap } from '../../sdk/materials/cloud-noise';
import { createSceneryGeometry } from './scenery-material';
import fragmentShader from './shaders/cloud-atmosphere-bake.glsl';
import lightShader from './shaders/cloud-atmosphere-light.glsl';

/** Half the side of the square the atmosphere's clouds are baked over, about the middle (m). */
export const CLOUD_ATMOSPHERE_HALF = 8000;
/** Texels along the volume's sides (x and y east and north, z up over the heights it spans). */
export const CLOUD_ATMOSPHERE_SIZE: readonly [number, number, number] = [320, 320, 160];
/**
 * Texels along the light volume's sides: half the density volume's each way. The march takes the
 * light near a point finely from the density, and from this beyond.
 */
export const CLOUD_ATMOSPHERE_LIGHT_SIZE: readonly [number, number, number] = [160, 160, 80];
/** What a unit of the volume's r stands for (g/kg of condensate). */
export const CLOUD_ATMOSPHERE_CONDENSATE = 3;
/**
 * How far the inversion swells up and down (m), in cells a kilometre or so across: the cloud tops
 * it caps follow it, so a field of them is not cut off in one plane.
 */
export const CLOUD_ATMOSPHERE_SWELL = 80;
/**
 * The clouds are baked ahead of the clock, a step apart, and shown blended between the two bakes
 * the clock lies between, so they change smoothly: a step is this long at least (s), and as long
 * as the clock runs in CLOUD_ATMOSPHERE_LEAD of the wall's seconds, so each bake is ready before
 * the clock reaches it. Baked again at once past CLOUD_ATMOSPHERE_JUMP (s): the clock set.
 */
export const CLOUD_ATMOSPHERE_REBAKE = 1;
export const CLOUD_ATMOSPHERE_LEAD = 0.5;
export const CLOUD_ATMOSPHERE_JUMP = 600;
/**
 * Slices baked a frame, of the clouds and then of their light: a bake spread over some 15
 * frames, so none stalls the view.
 */
export const CLOUD_ATMOSPHERE_SLICES = 16;
// Thermals' rows in the atmosphere's table.
const ROWS = 32;
// The bubbles' bins across and up (binBubbles).
const BINS_ACROSS = 40;
const BINS_UP = 16;
// The most bubbles, and bin entries, the bake takes; and their textures' rows (the bake's
// BAKE_BUBBLE_ROW and BAKE_INDEX_ROW).
const MOST_BUBBLES = 8192;
const BUBBLE_ROW = 256;
const MOST_ENTRIES = 1 << 20;
const INDEX_ROW = 2048;
// The cosines of how far the light may turn before the light volumes shown are lit again: half a
// degree while the clock stands (else the bakes ahead take it in), five degrees at any time.
const LIGHT_TURN = Math.cos((0.5 * Math.PI) / 180);
const LIGHT_TURN_FAR = Math.cos((5 * Math.PI) / 180);
const lightTexel = new Vector2();

const vertexShader = /* glsl */ `
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const scene = new Scene();
const camera = new OrthographicCamera();

// A number as a GLSL float literal.
const glslFloat = (value: number) => (Number.isInteger(value) ? value.toFixed(1) : `${value}`);

// The curl noise the bubbles' billows are read through (curlNoiseMap): a tile of it over a tile
// of the shape volume, as finely.
const CURL_SIZE = 128;

// Half floats: a cloud's faint edges keep their density, in its mipmaps too (where 8 bits round
// it away, and the march's skipping of empty space with it cut the clouds flat).
const createDensity = () => {
  const target = new WebGL3DRenderTarget(...CLOUD_ATMOSPHERE_SIZE, {
    depthBuffer: false,
    generateMipmaps: false,
    format: RedFormat,
    type: HalfFloatType,
  });
  const texture = target.texture;
  texture.wrapS = texture.wrapT = texture.wrapR = ClampToEdgeWrapping;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.magFilter = LinearFilter;
  return target;
};

const createLight = () => {
  const target = new WebGL3DRenderTarget(...CLOUD_ATMOSPHERE_LIGHT_SIZE, {
    depthBuffer: false,
    generateMipmaps: false,
    format: RGFormat,
    type: HalfFloatType,
  });
  const texture = target.texture;
  texture.wrapS = texture.wrapT = texture.wrapR = ClampToEdgeWrapping;
  texture.minFilter = texture.magFilter = LinearFilter;
  return target;
};

const createData = (
  width: number,
  height: number,
  format: typeof RGBAFormat | typeof RGFormat | typeof RedFormat,
  channels: number,
) => {
  const texture = new DataTexture(
    new Float32Array(width * height * channels),
    width,
    height,
    format,
    FloatType,
  );
  texture.minFilter = texture.magFilter = NearestFilter;
  return texture;
};

// The clouds at a time: their density, their light, the time, the light's way it is lit for,
// and whether it is baked.
type Slot = {
  density: WebGL3DRenderTarget;
  light: WebGL3DRenderTarget;
  time: number;
  way: Vector3;
  ready: boolean;
};

// A bake under way: the clouds at `time` into slot `slot` (while `stage` is 'clouds'), then their
// light, for light from `way`.
type Job = {
  time: number;
  stage: 'clouds' | 'light';
  slice: number;
  slot: number;
  way: Vector3;
};

/**
 * The atmosphere's clouds (sdk/weather/atmosphere.ts) baked into a density volume over a square
 * about the local weather's middle (`cloud-atmosphere-bake.glsl`), at a time in their lives,
 * drifted by the wind to then: their condensate, with mipmaps, from their bubbles listed and
 * binned on the CPU (sdk/weather/thermal-field.ts). With it a coarser light volume
 * (`cloud-atmosphere-light.glsl`): how much cloud lies toward the light and above each texel.
 * Three of each: the two the clock lies between, shown blended ({@link from}, {@link to},
 * {@link blend}), and the next, baked ahead of the clock a few slices a frame ({@link update}).
 */
export class CloudAtmosphereVolume {
  private readonly slots: Slot[] = [0, 1, 2].map(() => ({
    density: createDensity(),
    light: createLight(),
    time: 0,
    way: new Vector3(0, 0, 1),
    ready: false,
  }));
  private readonly table: DataTexture;
  private tableData: Float32Array = new Float32Array(0);
  private readonly patches: DataTexture;
  private patchData: Float32Array = new Float32Array(0);
  private readonly bubbles = createData(3 * BUBBLE_ROW, MOST_BUBBLES / BUBBLE_ROW, RGBAFormat, 4);
  private readonly bins = createData(BINS_ACROSS, BINS_ACROSS * BINS_UP, RGFormat, 2);
  private readonly indices = createData(INDEX_ROW, MOST_ENTRIES / INDEX_ROW, RedFormat, 1);
  private readonly curl: DataTexture;
  private readonly material: ShaderMaterial;
  private readonly mesh: Mesh;
  private readonly lightMaterial: ShaderMaterial;
  private readonly lightMesh: Mesh;
  // The heights the volumes span (m): where the atmosphere's clouds can lie.
  private readonly span = new Vector2(0, 300);
  // The wind: the way the mixed layer's blows toward (east, north), its speed (m/s), and the
  // shear over it (m/s per m); and the mixed layer's top (m).
  private readonly windOf = new Vector4(0, 1, 0, 0);
  private mixed = 0;
  private atmosphere: Atmosphere | null = null;
  private seed = 0;
  private patchSeed = NaN;
  private key = '';
  // What it comes out of changed since it was baked: baked again at once.
  private dirty = true;
  // The slots shown (the clock between their times), and the one baked after them (-1: none yet).
  private fromSlot = 0;
  private toSlot = 0;
  private aheadSlot = -1;
  private job: Job | null = null;

  constructor() {
    this.table = new DataTexture(
      new Float32Array(ATMOSPHERE_LEVELS * (2 * ROWS + 1) * 4),
      ATMOSPHERE_LEVELS,
      2 * ROWS + 1,
      RGBAFormat,
      FloatType,
    );
    this.table.minFilter = this.table.magFilter = LinearFilter;
    this.table.wrapS = this.table.wrapT = ClampToEdgeWrapping;
    this.patches = new DataTexture(
      new Float32Array(PATCHES_SIZE * PATCHES_SIZE * 2),
      PATCHES_SIZE,
      PATCHES_SIZE,
      RGFormat,
      FloatType,
    );
    this.patches.minFilter = this.patches.magFilter = LinearFilter;
    this.patches.wrapS = this.patches.wrapT = RepeatWrapping;
    this.curl = new DataTexture(curlNoiseMap(CURL_SIZE), CURL_SIZE, CURL_SIZE, RGBAFormat, FloatType);
    this.curl.minFilter = this.curl.magFilter = LinearFilter;
    this.curl.wrapS = this.curl.wrapT = RepeatWrapping;
    this.curl.needsUpdate = true;
    this.material = new ShaderMaterial({
      name: 'scenery-cloud-atmosphere-bake',
      vertexShader,
      fragmentShader,
      defines: {
        BAKE_SPREAD: glslFloat(THERMAL_SPREAD),
        BAKE_LOBES: glslFloat(SHEET_LOBES),
        BAKE_LUMPS: glslFloat(SHEET_LUMPS),
      },
      uniforms: {
        uAtmosphere: new Uniform<Texture>(this.table),
        uAtmosphereSize: new Uniform(new Vector3(ATMOSPHERE_LEVELS, ROWS, ATMOSPHERE_STEP)),
        uBakeSize: new Uniform(new Vector3(...CLOUD_ATMOSPHERE_SIZE)),
        uBakeDomain: new Uniform(
          new Vector4(CLOUD_ATMOSPHERE_HALF, 0, 0, ATMOSPHERE_MOISTURE),
        ),
        uBakeExtent: new Uniform(this.span),
        uBakePatchMap: new Uniform<Texture>(this.patches),
        uBakePatches: new Uniform(new Vector4(PATCHES_PERIOD, 0, 0, 0)),
        uBakeCarried: new Uniform(new Vector2()),
        uBakeMixedTop: new Uniform(0),
        uBakeInversion: new Uniform(new Vector2()),
        uBakeBubbles: new Uniform<Texture>(this.bubbles),
        uBakeBins: new Uniform<Texture>(this.bins),
        uBakeIndices: new Uniform<Texture>(this.indices),
        uBakeBinGrid: new Uniform(
          new Vector4(BINS_ACROSS, BINS_UP, (2 * CLOUD_ATMOSPHERE_HALF) / BINS_ACROSS, 0),
        ),
        uCloudShape: new Uniform<Texture | null>(null),
        uBakeCurl: new Uniform<Texture>(this.curl),
      },
      depthTest: false,
      depthWrite: false,
      blending: NoBlending,
    });
    this.mesh = new Mesh(createSceneryGeometry(), this.material);
    this.mesh.frustumCulled = false;
    this.lightMaterial = new ShaderMaterial({
      name: 'scenery-cloud-atmosphere-light',
      vertexShader,
      fragmentShader: lightShader,
      uniforms: {
        uLightDensity: new Uniform<Texture>(this.slots[0].density.texture),
        uLightSize: new Uniform(new Vector4(...CLOUD_ATMOSPHERE_LIGHT_SIZE, 0)),
        uLightDomain: new Uniform(
          new Vector2(
            CLOUD_ATMOSPHERE_HALF,
            (2 * CLOUD_ATMOSPHERE_HALF) / CLOUD_ATMOSPHERE_SIZE[0],
          ),
        ),
        uLightExtent: new Uniform(this.span),
        uLightWay: new Uniform(new Vector3(0, 0, 1)),
      },
      depthTest: false,
      depthWrite: false,
      blending: NoBlending,
    });
    this.lightMesh = new Mesh(createSceneryGeometry(), this.lightMaterial);
    this.lightMesh.frustumCulled = false;
  }

  /**
   * The clouds the clock is past: their condensate (r over CLOUD_ATMOSPHERE_CONDENSATE, with
   * mipmaps), their light (the cloud toward the light (r) and above (g) from each texel, r m),
   * and their time (s).
   */
  get from(): { density: Texture; light: Texture; time: number } {
    const slot = this.slots[this.fromSlot];
    return { density: slot.density.texture, light: slot.light.texture, time: slot.time };
  }

  /** The clouds the clock is coming to (as {@link from}): the same where it has none ahead. */
  get to(): { density: Texture; light: Texture; time: number } {
    const slot = this.slots[this.toSlot];
    return { density: slot.density.texture, light: slot.light.texture, time: slot.time };
  }

  /** How far the clock at `time` is from {@link from}'s time to {@link to}'s, 0 to 1. */
  blend(time: number): number {
    const from = this.slots[this.fromSlot].time;
    const to = this.slots[this.toSlot].time;
    return to > from ? Math.min(Math.max((time - from) / (to - from), 0), 1) : 0;
  }

  /** The heights the volumes span (m, over the sea): where the atmosphere's clouds can lie. */
  get extent(): Vector2 {
    return this.span;
  }

  /**
   * The wind: the way the mixed layer's blows toward (east, north), its speed (m/s), and the shear
   * over it (m/s per m). Shared: read it, don't change it.
   */
  get wind(): Vector4 {
    return this.windOf;
  }

  /** The top of the mixed layer (m), where the shear starts. */
  get mixedTop(): number {
    return this.mixed;
  }

  /** The metres a texel of the light volume spans across and up. */
  get lightTexel(): Vector2 {
    return lightTexel.set(
      (2 * CLOUD_ATMOSPHERE_HALF) / CLOUD_ATMOSPHERE_LIGHT_SIZE[0],
      (this.span.y - this.span.x) / CLOUD_ATMOSPHERE_LIGHT_SIZE[2],
    );
  }

  /**
   * Bake `atmosphere` with `seed`, its clouds drifting with `wind` (the mixed layer's: the way it
   * blows from, degrees, and its speed, m/s; none, still): at once, at the next {@link update}.
   */
  set(
    atmosphere: Atmosphere,
    seed: number,
    wind: { from: number; speed: number } | null,
  ) {
    const key = JSON.stringify([atmosphere, seed, wind]);
    if (key === this.key) return;
    this.key = key;
    this.dirty = true;
    this.atmosphere = atmosphere;
    this.seed = seed;
    this.tableData = atmosphereTable(atmosphere, ROWS);
    (this.table.image.data as Float32Array).set(this.tableData);
    this.table.needsUpdate = true;
    this.span.fromArray(atmosphereExtent(atmosphere, this.tableData, ROWS));
    if (seed !== this.patchSeed) {
      this.patchSeed = seed;
      this.patchData = patchesMap(seed);
      (this.patches.image.data as Float32Array).set(this.patchData);
      this.patches.needsUpdate = true;
    }
    const toward = (((wind?.from ?? 0) + 180) * Math.PI) / 180;
    this.windOf.set(
      Math.sin(toward),
      Math.cos(toward),
      wind?.speed ?? 0,
      wind ? atmosphere.shear / 1000 : 0,
    );
    this.mixed = Math.min(atmosphere.mixedLayer, atmosphere.inversionHeight);
    const u = this.material.uniforms;
    (u.uBakeDomain.value as Vector4).z = atmosphere.patchiness;
    u.uBakeMixedTop.value = this.mixed;
    (u.uBakeInversion.value as Vector2).set(
      atmosphere.inversionHeight,
      atmosphere.inversionStrength > 0 ? CLOUD_ATMOSPHERE_SWELL : 0,
    );
  }

  /**
   * The clouds at `time` (s into their lives) and their light from `way` (on the field's frame:
   * east, north, up), drawn with `renderer` (their billows from `shape`, the clouds' shape
   * volume), the clock running at `rate` (its seconds a second: 0 stood). Baked whole at once
   * after a {@link set}, a jump of the clock, or a fall of its rate that leaves the next bake far
   * ahead. Else the clouds the clock has reached are shown from, the next to; and the one after,
   * a step on, baked ahead CLOUD_ATMOSPHERE_SLICES slices a frame. Lit again at once as the
   * light turns far, or at all while the clock stands (else the bakes ahead take it in). Each
   * frame, within the scene's draw: `renderer`'s target and settings are left as they were.
   */
  update(renderer: WebGLRenderer, shape: Texture, time: number, rate: number, way: Vector3) {
    if (!this.atmosphere) return;
    this.material.uniforms.uCloudShape.value = shape;
    const step = Math.max(CLOUD_ATMOSPHERE_REBAKE, Math.abs(rate) * CLOUD_ATMOSPHERE_LEAD);
    const from = this.slots[this.fromSlot];
    const to = this.slots[this.toSlot];
    if (
      this.dirty ||
      !from.ready ||
      time < from.time - CLOUD_ATMOSPHERE_REBAKE ||
      time > to.time + CLOUD_ATMOSPHERE_JUMP ||
      (rate !== 0 && to.time > time + 2 * step + CLOUD_ATMOSPHERE_REBAKE)
    ) {
      this.dirty = false;
      this.slots.forEach(slot => (slot.ready = false));
      this.start(0, time);
      this.run(renderer, way, Infinity);
      this.fromSlot = this.toSlot = 0;
      this.aheadSlot = -1;
      return;
    }
    const turned = Math.min(
      ...this.slots.filter(slot => slot.ready).map(slot => slot.way.dot(way)),
    );
    if (turned < LIGHT_TURN_FAR || (turned < LIGHT_TURN && rate === 0 && !this.job))
      this.slots.forEach(slot => slot.ready && this.relight(renderer, slot, way));
    // The clock has reached the clouds ahead: they are shown to, the ones before from.
    if (this.aheadSlot >= 0 && time >= to.time) {
      this.fromSlot = this.toSlot;
      this.toSlot = this.aheadSlot;
      this.aheadSlot = -1;
    }
    // The clouds a step on from those shown to, in the slot neither shows.
    if (!this.job && this.aheadSlot < 0) {
      const slot = [0, 1, 2].find(s => s !== this.fromSlot && s !== this.toSlot)!;
      this.start(slot, this.slots[this.toSlot].time + step);
    }
    if (this.job) this.run(renderer, way, CLOUD_ATMOSPHERE_SLICES);
  }

  // A bake of the clouds at `time` into `slot` (their bubbles listed, binned and sent), then of
  // their light.
  private start(slot: number, time: number) {
    this.list(time);
    this.slots[slot].ready = false;
    this.job = { time, stage: 'clouds', slice: 0, slot, way: new Vector3() };
  }

  private list(time: number) {
    const a = this.atmosphere!;
    const wind = this.windOf;
    const field = thermalBubbles(
      this.tableData,
      ROWS,
      this.patchData,
      {
        half: CLOUD_ATMOSPHERE_HALF,
        time,
        seed: this.seed,
        heating: a.heating,
        patchiness: a.patchiness,
        east: wind.x,
        north: wind.y,
        speed: wind.z,
        shear: wind.w,
        mixedTop: this.mixed,
      },
      MOST_BUBBLES,
    );
    const bins = binBubbles(
      field,
      CLOUD_ATMOSPHERE_HALF,
      [this.span.x, this.span.y],
      BINS_ACROSS,
      BINS_UP,
      MOST_ENTRIES,
    );
    (this.bubbles.image.data as Float32Array).set(
      field.bubbles.subarray(0, field.count * BUBBLE_FLOATS),
    );
    this.bubbles.needsUpdate = true;
    (this.bins.image.data as Float32Array).set(bins.bins);
    this.bins.needsUpdate = true;
    (this.indices.image.data as Float32Array).set(bins.indices.subarray(0, bins.entries));
    this.indices.needsUpdate = true;
    // The air's patches, carried by the wind at their height.
    const u = this.material.uniforms;
    (u.uBakeCarried.value as Vector2).set(wind.x * wind.z * time, wind.y * wind.z * time);
    const patches = u.uBakePatches.value as Vector4;
    patches.y = wind.x * wind.w * time;
    patches.z = wind.y * wind.w * time;
  }

  // Bake `budget` slices of the job under way: the clouds', then their light's; once whole, the
  // clouds ahead.
  private run(renderer: WebGLRenderer, way: Vector3, budget: number) {
    const job = this.job!;
    const slot = this.slots[job.slot];
    let left = budget;
    if (job.stage === 'clouds') {
      const target = slot.density;
      const to = Math.min(job.slice + left, target.depth);
      const domain = this.material.uniforms.uBakeDomain.value as Vector4;
      drawSlices(renderer, target, this.mesh, s => (domain.y = s), job.slice, to, true);
      left -= to - job.slice;
      job.slice = to;
      if (to < target.depth) return;
      job.stage = 'light';
      job.slice = 0;
    }
    if (left <= 0) return;
    if (job.slice === 0) job.way.copy(way);
    const to = Math.min(job.slice + left, slot.light.depth);
    this.light(renderer, slot, job.way, job.slice, to);
    job.slice = to;
    if (to < slot.light.depth) return;
    slot.time = job.time;
    slot.way.copy(job.way);
    slot.ready = true;
    this.aheadSlot = job.slot;
    this.job = null;
  }

  // Light `slot`'s clouds from `way`, slices `from` to `to` (not included).
  private light(renderer: WebGLRenderer, slot: Slot, way: Vector3, from: number, to: number) {
    const u = this.lightMaterial.uniforms;
    u.uLightDensity.value = slot.density.texture;
    (u.uLightWay.value as Vector3).copy(way);
    const size = u.uLightSize.value as Vector4;
    drawSlices(renderer, slot.light, this.lightMesh, s => (size.w = s), from, to, false);
  }

  // Light `slot`'s clouds again, whole, from `way`.
  private relight(renderer: WebGLRenderer, slot: Slot, way: Vector3) {
    this.light(renderer, slot, way, 0, slot.light.depth);
    slot.way.copy(way);
  }

  dispose() {
    this.slots.forEach(slot => {
      slot.density.dispose();
      slot.light.dispose();
    });
    this.table.dispose();
    this.patches.dispose();
    this.bubbles.dispose();
    this.bins.dispose();
    this.indices.dispose();
    this.curl.dispose();
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.lightMesh.geometry.dispose();
    this.lightMaterial.dispose();
  }
}

// Draw `mesh` into the slices `from` to `to` (not included) of `target` (telling `slice` which),
// and its mipmaps after its last if `mipmaps`; `renderer`'s target and settings left as they were.
function drawSlices(
  renderer: WebGLRenderer,
  target: WebGL3DRenderTarget,
  mesh: Mesh,
  slice: (slice: number) => void,
  from: number,
  to: number,
  mipmaps: boolean,
) {
  if (from >= to) return;
  const outer = renderer.getRenderTarget();
  const cubeFace = renderer.getActiveCubeFace();
  const mipLevel = renderer.getActiveMipmapLevel();
  const autoClear = renderer.autoClear;
  const autoReset = renderer.info.autoReset;
  renderer.autoClear = false;
  renderer.info.autoReset = false;
  const texture = target.texture;
  const last = target.depth - 1;
  scene.add(mesh);
  for (let s = from; s < to; s++) {
    slice(s);
    texture.generateMipmaps = mipmaps && s === last;
    renderer.setRenderTarget(target, s);
    renderer.render(scene, camera);
  }
  texture.generateMipmaps = false;
  scene.remove(mesh);
  renderer.setRenderTarget(outer, cubeFace, mipLevel);
  renderer.autoClear = autoClear;
  renderer.info.autoReset = autoReset;
}
