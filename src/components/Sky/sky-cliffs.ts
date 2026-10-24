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
import { createSkyGeometry } from './sky-material';
import fragmentShader from './shaders/sky-cliffs-fragment.glsl';

/** The texels across the void's baked cliffs. */
export const SKY_CLIFFS_SIZE = 1024;

/**
 * Bake the cliffs the void's walls are drawn from (`SkyMaterial.abyssWallRock`): how far
 * their rock stands out and its relief, one tile repeating both ways, with its mip levels.
 * Dispose of it when done.
 */
export function bakeSkyCliffs(
  renderer: WebGLRenderer,
  size = SKY_CLIFFS_SIZE,
): WebGLRenderTarget {
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
  const previous = renderer.getRenderTarget();
  renderer.setRenderTarget(target);
  renderer.render(scene, new OrthographicCamera());
  renderer.setRenderTarget(previous);
  geometry.dispose();
  material.dispose();
  return target;
}
