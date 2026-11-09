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
  Vector2,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import {
  softCoverStatistics,
  type SoftCoverStatistics,
} from '../../sdk/weather/soft-clouds';
import { createSceneryGeometry } from './scenery-material';
import fragmentShader from './shaders/cloud-cover-map.glsl';

/** Texels along the clouds' cover map's side: a tile of them repeats over the field. */
export const CLOUD_COVER_SIZE = 2048;
// Samples of the map's values taken for its distribution (a grid this many each way).
const SAMPLES = 128;

const vertexShader = /* glsl */ `
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const scene = new Scene();
const camera = new OrthographicCamera();

/**
 * The clouds' cover map (`cloud-cover-map.glsl`): a tile of noise of how much each column is
 * clouded over, as broad patches and rounded masses apart — (patches, masses, patches²,
 * masses²) in half floats with mipmaps, filtered anisotropically — so a read along a stretch of
 * a view gives the mean and the spread of what it passes over, for any weight of the masses
 * against the patches (a level's look). Drawn on the GPU when its seed changes, with a few
 * thousand of its values sampled and read back (without stalling) for their distribution
 * ({@link statistics}): the cover's level a share of the ground under cloud picks. Some 45 MB.
 */
export class CloudCoverMap {
  readonly target: WebGLRenderTarget;
  private readonly samples: WebGLRenderTarget;
  private readonly material: ShaderMaterial;
  private readonly sampleMaterial: ShaderMaterial;
  private readonly mesh: Mesh;
  private key = '';
  // The samples read back (patches, masses, …, a pixel each); null until they are.
  private read: Float32Array | null = null;
  // Their distribution by the masses' weight.
  private readonly stats = new Map<number, SoftCoverStatistics>();
  private disposed = false;

  constructor() {
    this.target = new WebGLRenderTarget(CLOUD_COVER_SIZE, CLOUD_COVER_SIZE, {
      type: HalfFloatType,
      format: RGBAFormat,
      depthBuffer: false,
      generateMipmaps: true,
      minFilter: LinearMipmapLinearFilter,
      magFilter: LinearFilter,
      wrapS: RepeatWrapping,
      wrapT: RepeatWrapping,
      anisotropy: 16,
    });
    this.samples = new WebGLRenderTarget(SAMPLES, SAMPLES, {
      type: FloatType,
      format: RGBAFormat,
      depthBuffer: false,
      generateMipmaps: false,
      minFilter: NearestFilter,
      magFilter: NearestFilter,
    });
    const uniforms = {
      uCoverSize: new Uniform(new Vector2(CLOUD_COVER_SIZE, CLOUD_COVER_SIZE)),
      uCoverSeed: new Uniform(0),
    };
    const common = {
      vertexShader,
      fragmentShader,
      uniforms,
      depthTest: false,
      depthWrite: false,
      blending: NoBlending,
    };
    this.material = new ShaderMaterial({
      ...common,
      name: 'scenery-cloud-cover',
    });
    this.sampleMaterial = new ShaderMaterial({
      ...common,
      name: 'scenery-cloud-cover-sample',
      defines: { COVER_SAMPLE: '' },
    });
    this.mesh = new Mesh(createSceneryGeometry(), this.material);
    this.mesh.frustumCulled = false;
  }

  /** Whether its samples are read back: {@link statistics} has them from then on. */
  get ready(): boolean {
    return this.read !== null;
  }

  /**
   * The distribution of its values with the masses weighed `masses` against the patches
   * (patches + masses × masses' value), once read back; null until then.
   */
  statistics(masses: number): SoftCoverStatistics | null {
    const read = this.read;
    if (!read) return null;
    let stats = this.stats.get(masses);
    if (!stats) {
      const mixed = new Float32Array(read.length / 4);
      for (let i = 0; i < mixed.length; i++)
        mixed[i] = read[i * 4] + masses * read[i * 4 + 1];
      stats = softCoverStatistics(mixed);
      this.stats.set(masses, stats);
    }
    return stats;
  }

  /**
   * Drawn with `seed`, with `renderer`: at once if it changed, its distribution read back over
   * the next frames. Whether it is ready to draw with. Within the scene's draw: `renderer`'s
   * target and settings are left as they were.
   */
  update(renderer: WebGLRenderer, seed: number): boolean {
    const key = `${seed}`;
    if (key === this.key) return this.read !== null;
    this.key = key;
    this.read = null;
    this.stats.clear();
    const u = this.material.uniforms;
    u.uCoverSeed.value = Math.max(Math.round(seed), 0);

    const outer = renderer.getRenderTarget();
    const cubeFace = renderer.getActiveCubeFace();
    const mipLevel = renderer.getActiveMipmapLevel();
    const autoClear = renderer.autoClear;
    const autoReset = renderer.info.autoReset;
    renderer.autoClear = false;
    renderer.info.autoReset = false;
    scene.add(this.mesh);
    this.mesh.material = this.material;
    (u.uCoverSize.value as Vector2).set(CLOUD_COVER_SIZE, CLOUD_COVER_SIZE);
    renderer.setRenderTarget(this.target);
    renderer.render(scene, camera);
    this.mesh.material = this.sampleMaterial;
    (u.uCoverSize.value as Vector2).set(SAMPLES, SAMPLES);
    renderer.setRenderTarget(this.samples);
    renderer.render(scene, camera);
    scene.remove(this.mesh);
    renderer.setRenderTarget(outer, cubeFace, mipLevel);
    renderer.autoClear = autoClear;
    renderer.info.autoReset = autoReset;

    const buffer = new Float32Array(SAMPLES * SAMPLES * 4);
    renderer
      .readRenderTargetPixelsAsync(this.samples, 0, 0, SAMPLES, SAMPLES, buffer)
      .then(() => {
        if (this.key === key && !this.disposed) this.read = buffer;
      })
      .catch(error =>
        console.warn('SceneryCloudVolume: no cover statistics', error),
      );
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
