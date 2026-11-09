import {
  FloatType,
  HalfFloatType,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  NearestFilter,
  NoBlending,
  OrthographicCamera,
  RepeatWrapping,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  Uniform,
  WebGL3DRenderTarget,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import {
  softCoverStatistics,
  type SoftCoverStatistics,
} from '../../sdk/weather/soft-clouds';
import { createSceneryGeometry } from './scenery-material';
import volumeShader from './shaders/cloud-cover-volume.glsl';

/** Texels along a side of the clouds' cover volume: a tile of them repeats every way. */
export const CLOUD_COVER_VOLUME_SIZE = 128;
/**
 * How the march reads the cover volume's patches (cloud-volume-march.glsl, cloudCoverOf):
 * twice, a second time `broader` times broader (turned), at full weight, and where the masses
 * are, at `fine`'s weight: the broad read's octaves run on into the fine read's, halving.
 */
export const CLOUD_COVER_PATCHES = { broader: 6, fine: 0.15 } as const;
// Slices of the cover volume drawn a frame: it is drawn over a few frames, none of them long.
const VOLUME_SLICES = 16;
// Samples of the volume's values taken for its distribution (a grid this many each way).
const SAMPLES = 128;

const vertexShader = /* glsl */ `
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const scene = new Scene();
const camera = new OrthographicCamera();

/**
 * The clouds' cover volume (`cloud-cover-volume.glsl`): a tile of noise repeating every way, of
 * how much each column is clouded over, read on the Earth's curved surface where each column
 * stands, so the clouds are fixed to the Earth and keep their shape anywhere on the globe. Broad
 * patches and rounded masses apart — (patches, masses, patches², masses²) in half floats with
 * mipmaps — so a read gives the mean and the spread of what a footprint holds, for any weight
 * of the masses against the patches (a level's look). Drawn on the GPU a few slices a frame when
 * its seed changes, with a few thousand of its values sampled and read back (without stalling)
 * for their distribution ({@link statistics}). Some 19 MB.
 */
export class CloudCoverVolume {
  readonly target: WebGL3DRenderTarget;
  private readonly samples: WebGLRenderTarget;
  private readonly material: ShaderMaterial;
  private readonly sampleMaterial: ShaderMaterial;
  private readonly mesh: Mesh;
  private key = '';
  // The next slice to draw: past the last once drawn.
  private slice = CLOUD_COVER_VOLUME_SIZE;
  // The samples read back (fine patches, masses, broad patches, …, a pixel each); null until they are.
  private read: Float32Array | null = null;
  // Their distribution by the masses' weight.
  private readonly stats = new Map<number, SoftCoverStatistics>();
  private disposed = false;

  constructor() {
    const size = CLOUD_COVER_VOLUME_SIZE;
    this.target = new WebGL3DRenderTarget(size, size, size, {
      type: HalfFloatType,
      format: RGBAFormat,
      depthBuffer: false,
      generateMipmaps: false,
    });
    const texture = this.target.texture;
    texture.wrapS = texture.wrapT = texture.wrapR = RepeatWrapping;
    texture.minFilter = LinearMipmapLinearFilter;
    texture.magFilter = LinearFilter;
    this.samples = new WebGLRenderTarget(SAMPLES, SAMPLES, {
      type: FloatType,
      format: RGBAFormat,
      depthBuffer: false,
      generateMipmaps: false,
      minFilter: NearestFilter,
      magFilter: NearestFilter,
    });
    const uniforms = {
      uCoverSize: new Uniform(size),
      uCoverSlice: new Uniform(0),
      uCoverSeed: new Uniform(0),
    };
    const common = {
      vertexShader,
      fragmentShader: volumeShader,
      uniforms,
      depthTest: false,
      depthWrite: false,
      blending: NoBlending,
    };
    this.material = new ShaderMaterial({
      ...common,
      name: 'scenery-cloud-cover-volume',
    });
    this.sampleMaterial = new ShaderMaterial({
      ...common,
      name: 'scenery-cloud-cover-volume-sample',
      defines: { COVER_SAMPLE: '' },
    });
    this.mesh = new Mesh(createSceneryGeometry(), this.material);
    this.mesh.frustumCulled = false;
  }

  /** The generator's materials, to compile before it draws. */
  get materials(): ShaderMaterial[] {
    return [this.material, this.sampleMaterial];
  }

  /**
   * The distribution of the cover as the march reads it — its broad patches, its fine ones
   * (`CLOUD_COVER_PATCHES`) and its masses weighed `masses` against them — once read back; null
   * until then.
   */
  statistics(masses: number): SoftCoverStatistics | null {
    const read = this.read;
    if (!read) return null;
    let stats = this.stats.get(masses);
    if (!stats) {
      const mixed = new Float32Array(read.length / 4);
      for (let i = 0; i < mixed.length; i++)
        mixed[i] =
          read[i * 4 + 2] +
          CLOUD_COVER_PATCHES.fine * read[i * 4] +
          masses * read[i * 4 + 1];
      stats = softCoverStatistics(mixed);
      this.stats.set(masses, stats);
    }
    return stats;
  }

  /**
   * Drawn with `seed`, with `renderer`: a few slices a frame from when it changes, then its
   * mipmaps, then its distribution read back over the next frames. Whether it is ready to draw
   * with. Within the scene's draw: `renderer`'s target and settings are left as they were.
   */
  update(renderer: WebGLRenderer, seed: number): boolean {
    const key = `${seed}`;
    if (key !== this.key) {
      this.key = key;
      this.read = null;
      this.stats.clear();
      this.slice = 0;
      this.material.uniforms.uCoverSeed.value = Math.max(Math.round(seed), 0);
    }
    const size = CLOUD_COVER_VOLUME_SIZE;
    if (this.slice >= size) return this.read !== null;

    const outer = renderer.getRenderTarget();
    const cubeFace = renderer.getActiveCubeFace();
    const mipLevel = renderer.getActiveMipmapLevel();
    const autoClear = renderer.autoClear;
    const autoReset = renderer.info.autoReset;
    renderer.autoClear = false;
    renderer.info.autoReset = false;
    scene.add(this.mesh);
    const u = this.material.uniforms;
    this.mesh.material = this.material;
    const last = Math.min(this.slice + VOLUME_SLICES, size);
    for (; this.slice < last; this.slice++) {
      u.uCoverSlice.value = this.slice;
      // Its mipmaps once, after the last slice.
      this.target.texture.generateMipmaps = this.slice === size - 1;
      renderer.setRenderTarget(this.target, this.slice);
      renderer.render(scene, camera);
    }
    this.target.texture.generateMipmaps = false;
    const done = this.slice >= size;
    if (done) {
      this.mesh.material = this.sampleMaterial;
      u.uCoverSize.value = SAMPLES;
      renderer.setRenderTarget(this.samples);
      renderer.render(scene, camera);
      u.uCoverSize.value = size;
    }
    scene.remove(this.mesh);
    renderer.setRenderTarget(outer, cubeFace, mipLevel);
    renderer.autoClear = autoClear;
    renderer.info.autoReset = autoReset;

    if (done) {
      const buffer = new Float32Array(SAMPLES * SAMPLES * 4);
      renderer
        .readRenderTargetPixelsAsync(
          this.samples,
          0,
          0,
          SAMPLES,
          SAMPLES,
          buffer,
        )
        .then(() => {
          if (this.key === key && !this.disposed) this.read = buffer;
        })
        .catch(error =>
          console.warn('SceneryCloudVolume: no cover statistics', error),
        );
    }
    return false;
  }

  dispose() {
    this.disposed = true;
    this.target.dispose();
    this.samples.dispose();
    this.material.dispose();
    this.sampleMaterial.dispose();
    this.mesh.geometry.dispose();
  }
}
