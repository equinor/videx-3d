import {
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  OrthographicCamera,
  RepeatWrapping,
  Scene,
  ShaderMaterial,
  Uniform,
  Vector2,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import {
  precompile,
  PRECOMPILE_PRIORITY,
  PrecompileOptions,
} from '../../rendering/precompile';
import { createSkyGeometry } from './sky-material';
import fragmentShader from './shaders/sky-cliffs-fragment.glsl';

/** The texels across the void's baked cliffs. */
export const SKY_CLIFFS_SIZE = 1024;

/** The cliffs being baked (`bakeSkyCliffs`). */
export type SkyCliffsBake = {
  /** the cliffs, once `ready` resolves `true` */
  target: WebGLRenderTarget;
  /** `true` once baked, `false` if disposed of first */
  ready: Promise<boolean>;
  dispose(): void;
};

/**
 * Bake the cliffs the void's walls are drawn from (`SkyMaterial.abyssWallRock`): how far
 * their rock stands out and its relief, one tile repeating both ways, with its mip levels.
 * Baked once its program is compiled, in the background where the browser can (see
 * `precompile`). Dispose of it when done.
 *
 * ⚠️ Drawing with a program still compiling makes Chrome's GPU process wait for it, which
 * freezes every tab and the browser itself. The wait is behind every compile queued
 * before it: 3.4 s for this small program behind the sky's own. `onProgress` follows its
 * compile (see `PrecompileOptions`).
 */
export function bakeSkyCliffs(
  renderer: WebGLRenderer,
  size = SKY_CLIFFS_SIZE,
  onProgress?: PrecompileOptions['onProgress'],
): SkyCliffsBake {
  const target = new WebGLRenderTarget(size, size, {
    wrapS: RepeatWrapping,
    wrapT: RepeatWrapping,
    minFilter: LinearMipmapLinearFilter,
    magFilter: LinearFilter,
    generateMipmaps: true,
    depthBuffer: false,
  });
  const geometry = createSkyGeometry();
  const material = new ShaderMaterial({
    vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader,
    uniforms: { uRockSize: new Uniform(new Vector2(size, size)) },
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  const scene = new Scene();
  scene.add(mesh);
  const camera = new OrthographicCamera();

  let disposed = false;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    geometry.dispose();
    material.dispose();
  };
  const bake = () => {
    if (disposed) return false;
    const previous = renderer.getRenderTarget();
    const face = renderer.getActiveCubeFace();
    const mipmap = renderer.getActiveMipmapLevel();
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    renderer.setRenderTarget(previous, face, mipmap);
    release();
    return true;
  };
  const compiling = precompile(renderer, scene, camera, scene, 'offscreen', {
    priority: PRECOMPILE_PRIORITY.background,
    onProgress,
  });
  return {
    target,
    ready: compiling ? compiling.then(bake) : Promise.resolve(bake()),
    dispose() {
      if (disposed) return;
      disposed = true;
      release();
      target.dispose();
    },
  };
}
