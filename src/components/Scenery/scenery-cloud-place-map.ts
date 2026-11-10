import {
  HalfFloatType,
  LinearFilter,
  LinearMipmapLinearFilter,
  Material,
  Matrix3,
  Mesh,
  NoBlending,
  OrthographicCamera,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  Texture,
  Uniform,
  Vector3,
  Vector4,
  WebGLArrayRenderTarget,
  WebGLRenderer,
} from 'three';
import { createSceneryGeometry } from './scenery-material';

// Texels a side, at least and at most.
const SIZE_LEAST = 128;
const SIZE_MOST = 1024;
// The camera's foot may move this share of the map's half-width before it is centred again.
const RECENTRE = 0.1;
// The broadest it reaches about the camera's foot (radians): its tangent, gnomonic.
const ANGLE_MOST = 1.2;

/** What a {@link CloudPlaceMap} is drawn for, frame by frame. */
export type CloudPlaceMapInputs = {
  /** the camera, fixed on the Earth, from its centre (m) */
  camera: Vector3;
  /** the Earth's radius (m) */
  radius: number;
  /** the camera's height over the sea (m) */
  height: number;
  /** the highest the clouds reach over the sea (m): the map reaches as far as they show */
  top: number;
  /** the cloud map's texel at a face's middle (m): the map's is half that, where it can be */
  texel: number;
  /** everything it is drawn from but the camera: drawn anew once it changes (the clock, the drawings) */
  key: string;
};

const camera = new OrthographicCamera();
const up = new Vector3();
const east = new Vector3();
const north = new Vector3();
const pole = new Vector3();

/**
 * A global weather's cloud map and types about the camera (`CloudVolumeRenderer`), as the march
 * reads them at each place it marches (cloud-volume-march.glsl, `cloudPlace`): both drawings,
 * each where its cloud has drifted to, the newer dissolved in. On a gnomonic map of the Earth
 * about the camera's foot, as far as the clouds over the horizon, at half the cloud map's texel
 * (as fine as a texel of its, so its reads cost what a read of the drawings would, and give
 * nearly the same). Out of it, the march reads the drawings themselves.
 *
 * Drawn by the march's own program (`CLOUD_PLACE_MAP`), from its uniforms as the frame has them,
 * so it follows the clock: drawn again whenever the clock moves the drawings' drift, they are
 * drawn anew, the settings change, or the camera's foot has moved RECENTRE of its reach.
 */
export class CloudPlaceMap {
  /** the march's own uniforms for it */
  readonly uniforms = {
    uCloudPlaceMap: new Uniform<Texture | null>(null),
    uCloudPlaceAxes: new Uniform(new Matrix3()),
    uCloudPlaceArea: new Uniform(new Vector4(1, 1, 1, 0)),
  };
  /** Counts it being drawn anew. */
  version = 0;
  private material: ShaderMaterial | null = null;
  private mesh: Mesh | null = null;
  private readonly scene = new Scene();
  private target: WebGLArrayRenderTarget | null = null;
  private held: { key: string; half: number; size: number } | null = null;
  // The camera's way (fixed on the Earth) it was centred on.
  private readonly centre = new Vector3();

  /**
   * What draws it: the march's program as `CLOUD_PLACE_MAP` in a global weather, its uniforms
   * the march's own (made once, for `march`); compile it before it draws.
   */
  generator(march: ShaderMaterial): Mesh {
    if (!this.mesh) {
      this.material = new ShaderMaterial({
        name: 'scenery-cloud-place-map',
        vertexShader: march.vertexShader,
        fragmentShader: march.fragmentShader,
        defines: { ...march.defines, CLOUD_GLOBAL: '', CLOUD_PLACE_MAP: '' },
        uniforms: { ...march.uniforms, uCloudPlaceLayer: new Uniform(0) },
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
   * none, as in a local weather or with the globe off), and set what the march reads. Within
   * the scene's draw, after the march's uniforms are set for the frame: it draws with them.
   * `renderer`'s target is left as it was.
   */
  update(renderer: WebGLRenderer, inputs: CloudPlaceMapInputs | null) {
    const area = this.uniforms.uCloudPlaceArea.value;
    if (!inputs || !this.material) {
      area.w = 0;
      return;
    }
    const { radius } = inputs;
    // As far as the clouds show over the horizon: the camera's horizon and the clouds' own.
    const angle = Math.min(
      Math.acos(radius / (radius + Math.max(inputs.height, 0))) +
        Math.acos(radius / (radius + Math.max(inputs.top, 1))),
      ANGLE_MOST,
    );
    const half = Math.tan(angle);
    const size = Math.min(
      SIZE_MOST,
      Math.max(
        SIZE_LEAST,
        Math.ceil((2 * half * radius) / (0.5 * inputs.texel) / 64) * 64,
      ),
    );
    up.copy(inputs.camera).normalize();
    const held = this.held;
    const moved =
      !held ||
      this.centre.angleTo(up) > RECENTRE * Math.atan(held.half) ||
      Math.abs(Math.log(half / held.half)) > Math.log(1.25);
    if (moved) this.centre.copy(up);
    if (moved || !held || held.key !== inputs.key) {
      const centre = this.centre;
      pole.set(0, 0, 1);
      if (Math.abs(centre.z) > 0.999) pole.set(1, 0, 0);
      east.crossVectors(pole, centre).normalize();
      north.crossVectors(centre, east);
      this.uniforms.uCloudPlaceAxes.value.set(
        east.x,
        north.x,
        centre.x,
        east.y,
        north.y,
        centre.y,
        east.z,
        north.z,
        centre.z,
      );
      const drawnHalf = moved ? half : held!.half;
      const drawnSize = moved ? size : held!.size;
      area.set(drawnHalf, drawnSize, (2 * drawnHalf * radius) / drawnSize, 0);
      this.draw(renderer, drawnSize);
      this.held = { key: inputs.key, half: drawnHalf, size: drawnSize };
      this.version++;
    }
    this.uniforms.uCloudPlaceMap.value = this.target!.texture;
    area.w = 1;
  }

  // Both layers, then the mipmaps.
  private draw(renderer: WebGLRenderer, size: number) {
    const target = this.targetOf(size);
    const material = this.material!;
    const outer = renderer.getRenderTarget();
    const cubeFace = renderer.getActiveCubeFace();
    const mipLevel = renderer.getActiveMipmapLevel();
    const autoClear = renderer.autoClear;
    const autoReset = renderer.info.autoReset;
    renderer.autoClear = false;
    renderer.info.autoReset = false;
    this.scene.add(this.mesh!);
    for (let layer = 0; layer < 2; layer++) {
      material.uniforms.uCloudPlaceLayer.value = layer;
      target.texture.generateMipmaps = layer === 1;
      renderer.setRenderTarget(target, layer);
      renderer.render(this.scene, camera);
    }
    target.texture.generateMipmaps = false;
    this.scene.remove(this.mesh!);
    renderer.setRenderTarget(outer, cubeFace, mipLevel);
    renderer.autoClear = autoClear;
    renderer.info.autoReset = autoReset;
  }

  // Its target, `size` texels a side, made anew if it is not.
  private targetOf(size: number): WebGLArrayRenderTarget {
    let target = this.target;
    if (target && target.width !== size) {
      target.dispose();
      target = null;
    }
    if (!target) {
      target = new WebGLArrayRenderTarget(size, size, 2, {
        type: HalfFloatType,
        format: RGBAFormat,
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
