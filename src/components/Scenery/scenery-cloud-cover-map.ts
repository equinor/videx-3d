import {
  HalfFloatType,
  LinearFilter,
  LinearMipmapLinearFilter,
  Material,
  Mesh,
  NoBlending,
  OrthographicCamera,
  RedFormat,
  Scene,
  ShaderMaterial,
  Texture,
  Uniform,
  Vector4,
  WebGLArrayRenderTarget,
  WebGLRenderer,
} from 'three';
import { createSceneryGeometry } from './scenery-material';

// Texels a side at most: some 200 m over a weather of 100 km's radius.
const SIZE_MOST = 1024;

/** What a {@link CloudCoverMap} is drawn from, frame by frame. */
export type CloudCoverMapInputs = {
  /** the levels drawn (a layer each) */
  levels: number;
  /** the map's half-width on the field about the weather's middle (m) */
  half: number;
  /** the texel wanted (m): the finest level's cover texel */
  texel: number;
  /** everything it is drawn from but the clock and the camera: drawn anew once it changes */
  key: string;
  /** the weather's clock (s): drawn anew whenever it moves (the clouds drift, form and fade) */
  time: number;
};

const camera = new OrthographicCamera();

/**
 * The cover maps of a local weather's 3D clouds (`CloudsRenderer`): for each level, the
 * mean cover of each column (cloud-march.glsl, cloudCoverAt), as its two reads of the 3D
 * cover volume give it, on the field over the weather's disc, fixed on the Earth. A level's cover
 * is the same all up a column, so the march, its light and its shadows read it once from a 2D map
 * (`cloudCoverOf`) instead of twice from the volume, at every step; its spread about the mean is
 * the volume's, by the footprint alone (`cloudSpreadOf`).
 *
 * Drawn by the march's own program (`CLOUD_COVER_MAP`), from its uniforms as the frame has them:
 * the levels' drift with their winds and their clouds' forming and fading on the clock, so it is
 * drawn again, all of it, whenever the clock moves, and once what it is drawn from changes
 * (`key`: the settings, the globe). Never for the camera: it lies fixed on the Earth.
 */
export class CloudCoverMap {
  /** the march's own uniforms for it */
  readonly uniforms = {
    uCloudCoverMap: new Uniform<Texture | null>(null),
    uCloudCoverArea: new Uniform(new Vector4(0, 0, 1, 1)),
    uCloudCoverOn: new Uniform(false),
  };
  /** Counts it being drawn anew. */
  version = 0;
  private material: ShaderMaterial | null = null;
  private mesh: Mesh | null = null;
  private readonly scene = new Scene();
  private target: WebGLArrayRenderTarget | null = null;
  private held: (Omit<CloudCoverMapInputs, 'texel'> & { size: number }) | null =
    null;

  /**
   * What draws it: the march's program as `CLOUD_COVER_MAP`, its uniforms the march's own (made
   * once, for `march`); compile it before it draws.
   */
  generator(march: ShaderMaterial): Mesh {
    if (!this.mesh) {
      // A local weather's alone: never a global one's.
      const defines = { ...march.defines };
      delete defines.CLOUD_GLOBAL;
      this.material = new ShaderMaterial({
        name: 'scenery-cloud-cover-map',
        vertexShader: march.vertexShader,
        fragmentShader: march.fragmentShader,
        defines: { ...defines, CLOUD_COVER_MAP: '' },
        uniforms: { ...march.uniforms, uCloudCoverLevel: new Uniform(0) },
        depthTest: false,
        depthWrite: false,
        blending: NoBlending,
      });
      this.mesh = new Mesh(createSceneryGeometry(), this.material);
      this.mesh.frustumCulled = false;
    }
    return this.mesh;
  }

  /**
   * Draw it anew with `renderer` if what it is drawn from has changed since, for `inputs` (null:
   * none, as in a global weather), and set what the march reads. Within the scene's draw, after
   * the march's uniforms are set for the frame: it draws with them. `renderer`'s target is left
   * as it was.
   */
  update(renderer: WebGLRenderer, inputs: CloudCoverMapInputs | null) {
    const u = this.uniforms;
    if (!inputs || !this.material || inputs.levels === 0) {
      u.uCloudCoverOn.value = false;
      return;
    }
    const size = Math.min(
      SIZE_MOST,
      Math.max(64, Math.ceil((2 * inputs.half) / inputs.texel / 64) * 64),
    );
    const held = this.held;
    if (
      !held ||
      held.key !== inputs.key ||
      held.time !== inputs.time ||
      held.size !== size ||
      held.levels !== inputs.levels ||
      held.half !== inputs.half
    ) {
      const area = u.uCloudCoverArea.value;
      area.set(0, 0, inputs.half, size);
      this.draw(renderer, size, inputs.levels);
      this.held = {
        key: inputs.key,
        time: inputs.time,
        levels: inputs.levels,
        half: inputs.half,
        size,
      };
      this.version++;
    }
    u.uCloudCoverMap.value = this.target!.texture;
    u.uCloudCoverOn.value = true;
  }

  // Every level's layer, then the mipmaps.
  private draw(renderer: WebGLRenderer, size: number, levels: number) {
    const target = this.targetOf(size, levels);
    const material = this.material!;
    const outer = renderer.getRenderTarget();
    const cubeFace = renderer.getActiveCubeFace();
    const mipLevel = renderer.getActiveMipmapLevel();
    const autoClear = renderer.autoClear;
    const autoReset = renderer.info.autoReset;
    renderer.autoClear = false;
    renderer.info.autoReset = false;
    this.scene.add(this.mesh!);
    for (let layer = 0; layer < levels; layer++) {
      material.uniforms.uCloudCoverLevel.value = layer;
      target.texture.generateMipmaps = layer === levels - 1;
      renderer.setRenderTarget(target, layer);
      renderer.render(this.scene, camera);
    }
    target.texture.generateMipmaps = false;
    this.scene.remove(this.mesh!);
    renderer.setRenderTarget(outer, cubeFace, mipLevel);
    renderer.autoClear = autoClear;
    renderer.info.autoReset = autoReset;
  }

  // Its target, `size` texels a side and `levels` deep, made anew if it is not: the mean cover in
  // half floats.
  private targetOf(size: number, levels: number): WebGLArrayRenderTarget {
    let target = this.target;
    if (
      target &&
      (target.width !== size ||
        target.height !== size ||
        target.depth !== levels)
    ) {
      target.dispose();
      target = null;
    }
    if (!target) {
      target = new WebGLArrayRenderTarget(size, size, levels, {
        type: HalfFloatType,
        format: RedFormat,
        minFilter: LinearMipmapLinearFilter,
        magFilter: LinearFilter,
        depthBuffer: false,
        generateMipmaps: false,
      });
      this.target = target;
    }
    return target;
  }

  /** Let go of its map, and its generator's material through `release` (default `dispose`). */
  dispose(release?: (material: Material) => void) {
    this.target?.dispose();
    this.target = null;
    this.held = null;
    if (this.material) {
      if (release) release(this.material);
      else this.material.dispose();
    }
    this.mesh?.geometry.dispose();
    this.material = null;
    this.mesh = null;
  }
}
