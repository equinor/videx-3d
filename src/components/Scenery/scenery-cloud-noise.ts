import {
  Camera,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  NoBlending,
  RepeatWrapping,
  Scene,
  ShaderMaterial,
  Uniform,
  WebGL3DRenderTarget,
  WebGLRenderer,
} from 'three';
import { createSceneryGeometry } from './scenery-material';
import fragmentShader from './shaders/cloud-noise-volume.glsl';

// Texels along a side of the shape volume and of the detail volume.
export const CLOUD_SHAPE_SIZE = 128;
export const CLOUD_DETAIL_SIZE = 32;

const vertexShader = /* glsl */ `
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

/**
 * The 3D clouds' noise volumes (`cloud-noise-volume.glsl`): the shape's, the billows a
 * cloud is made of, and the detail's, which roughens their edges close up. Made on the GPU,
 * once per renderer, and shared by everything drawing with it.
 */
export type CloudNoiseVolumes = {
  shape: WebGL3DRenderTarget;
  detail: WebGL3DRenderTarget;
  /** what draws a slice: compile it first ({@link precompile}), then {@link generate} */
  generator: Mesh;
  generated: boolean;
};

type Shared = CloudNoiseVolumes & { users: number };

const volumes = new WeakMap<WebGLRenderer, Shared>();

const createVolume = (size: number) => {
  const target = new WebGL3DRenderTarget(size, size, size, {
    depthBuffer: false,
    generateMipmaps: false,
  });
  const texture = target.texture;
  texture.wrapS = texture.wrapT = texture.wrapR = RepeatWrapping;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.magFilter = LinearFilter;
  return target;
};

/** `renderer`'s noise volumes, made (not drawn yet) the first time: let go with {@link releaseCloudNoiseVolumes}. */
export function acquireCloudNoiseVolumes(renderer: WebGLRenderer): CloudNoiseVolumes {
  let shared = volumes.get(renderer);
  if (!shared) {
    const material = new ShaderMaterial({
      name: 'scenery-cloud-noise',
      vertexShader,
      fragmentShader,
      uniforms: {
        uNoiseSize: new Uniform(1),
        uNoiseSlice: new Uniform(0),
        uNoiseVolume: new Uniform(0),
      },
      depthTest: false,
      depthWrite: false,
      blending: NoBlending,
    });
    const generator = new Mesh(createSceneryGeometry(), material);
    generator.frustumCulled = false;
    shared = {
      shape: createVolume(CLOUD_SHAPE_SIZE),
      detail: createVolume(CLOUD_DETAIL_SIZE),
      generator,
      generated: false,
      users: 0,
    };
    volumes.set(renderer, shared);
  }
  shared.users++;
  return shared;
}

/** Let go of `renderer`'s noise volumes: disposed of once nothing else holds them. */
export function releaseCloudNoiseVolumes(renderer: WebGLRenderer) {
  const shared = volumes.get(renderer);
  if (!shared || --shared.users > 0) return;
  volumes.delete(renderer);
  shared.shape.dispose();
  shared.detail.dispose();
  shared.generator.geometry.dispose();
  (shared.generator.material as ShaderMaterial).dispose();
}

const scene = new Scene();
const camera = new Camera();

/**
 * Draw `noise` with `renderer`, slice by slice, and its mipmaps, unless done already. May be
 * called while `renderer` draws a scene: its target and settings are left as they were.
 */
export function generateCloudNoiseVolumes(
  renderer: WebGLRenderer,
  noise: CloudNoiseVolumes,
) {
  if (noise.generated) return;
  noise.generated = true;
  const outer = renderer.getRenderTarget();
  const cubeFace = renderer.getActiveCubeFace();
  const mipLevel = renderer.getActiveMipmapLevel();
  const autoClear = renderer.autoClear;
  const autoReset = renderer.info.autoReset;
  const shadows = renderer.shadowMap.autoUpdate;
  renderer.autoClear = false;
  renderer.info.autoReset = false;
  renderer.shadowMap.autoUpdate = false;

  const uniforms = (noise.generator.material as ShaderMaterial).uniforms;
  scene.add(noise.generator);
  [noise.shape, noise.detail].forEach((target, volume) => {
    const size = target.depth;
    uniforms.uNoiseSize.value = size;
    uniforms.uNoiseVolume.value = volume;
    for (let slice = 0; slice < size; slice++) {
      uniforms.uNoiseSlice.value = slice;
      // Its mipmaps once, after the last slice.
      target.texture.generateMipmaps = slice === size - 1;
      renderer.setRenderTarget(target, slice);
      renderer.render(scene, camera);
    }
    target.texture.generateMipmaps = false;
  });
  scene.remove(noise.generator);

  renderer.setRenderTarget(outer, cubeFace, mipLevel);
  renderer.autoClear = autoClear;
  renderer.info.autoReset = autoReset;
  renderer.shadowMap.autoUpdate = shadows;
}
