import {
  LinearFilter,
  LinearMipmapNearestFilter,
  Mesh,
  NoBlending,
  RedFormat,
  RepeatWrapping,
  Scene,
  ShaderMaterial,
  Uniform,
  WebGL3DRenderTarget,
  WebGLRenderer,
} from 'three';
import { createClipSpaceCamera } from '../../sdk/utils/depth-buffer';
import { renderAside } from '../../sdk/utils/render-aside';
import { createSceneryGeometry } from './scenery-material';
import fragmentShader from './shaders/cloud-noise-volume.glsl';

// Texels along a side of the shape volume.
export const CLOUD_SHAPE_SIZE = 128;

const vertexShader = /* glsl */ `
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

/**
 * The 3D clouds' noise volume (`cloud-noise-volume.glsl`): the shape's, the lumps that move
 * their surface close up. Made on the GPU, once per renderer, and shared by everything drawing
 * with it.
 */
export type CloudNoiseVolumes = {
  shape: WebGL3DRenderTarget;
  /** what draws a slice: compile it first ({@link precompile}), then {@link generate} */
  generator: Mesh;
  generated: boolean;
};

type Shared = CloudNoiseVolumes & { users: number };

const volumes = new WeakMap<WebGLRenderer, Shared>();

const createVolume = (size: number) => {
  // One channel: the lumps read only the Perlin-Worley (cloud-noise-volume.glsl). As RGBA8 every
  // read fetched four times what it used: the march took 1.2–1.85 times as long about the
  // clouds (RTX A1000, 2026-11-16), its image the same.
  const target = new WebGL3DRenderTarget(size, size, size, {
    depthBuffer: false,
    generateMipmaps: false,
    format: RedFormat,
  });
  const texture = target.texture;
  texture.wrapS = texture.wrapT = texture.wrapR = RepeatWrapping;
  // From the nearest mipmap, not blended between two: a read fetches 8 texels, not 16. The march
  // took 6 % less (3.7 of 61 ms, RTX A1000, 2026-11-17), and moving about, the lumps were not
  // seen to pop, flicker or morph.
  texture.minFilter = LinearMipmapNearestFilter;
  texture.magFilter = LinearFilter;
  return target;
};

/** `renderer`'s noise volume, made (not drawn yet) the first time: let go with {@link releaseCloudNoiseVolumes}. */
export function acquireCloudNoiseVolumes(
  renderer: WebGLRenderer,
): CloudNoiseVolumes {
  let shared = volumes.get(renderer);
  if (!shared) {
    const material = new ShaderMaterial({
      name: 'scenery-cloud-noise',
      vertexShader,
      fragmentShader,
      uniforms: {
        uNoiseSize: new Uniform(1),
        uNoiseSlice: new Uniform(0),
      },
      depthTest: false,
      depthWrite: false,
      blending: NoBlending,
    });
    const generator = new Mesh(createSceneryGeometry(), material);
    generator.frustumCulled = false;
    shared = {
      shape: createVolume(CLOUD_SHAPE_SIZE),
      generator,
      generated: false,
      users: 0,
    };
    volumes.set(renderer, shared);
  }
  shared.users++;
  return shared;
}

/** Let go of `renderer`'s noise volume: disposed of once nothing else holds it. */
export function releaseCloudNoiseVolumes(renderer: WebGLRenderer) {
  const shared = volumes.get(renderer);
  if (!shared || --shared.users > 0) return;
  volumes.delete(renderer);
  shared.shape.dispose();
  shared.generator.geometry.dispose();
  (shared.generator.material as ShaderMaterial).dispose();
}

const scene = new Scene();
const camera = createClipSpaceCamera();

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
  renderAside(renderer, () => {
    const uniforms = (noise.generator.material as ShaderMaterial).uniforms;
    scene.add(noise.generator);
    const target = noise.shape;
    const size = target.depth;
    uniforms.uNoiseSize.value = size;
    for (let slice = 0; slice < size; slice++) {
      uniforms.uNoiseSlice.value = slice;
      // Its mipmaps once, after the last slice.
      target.texture.generateMipmaps = slice === size - 1;
      renderer.setRenderTarget(target, slice);
      renderer.render(scene, camera);
    }
    target.texture.generateMipmaps = false;
    scene.remove(noise.generator);
  });
}
