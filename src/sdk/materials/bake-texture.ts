import {
  BufferGeometry,
  Float32BufferAttribute,
  IUniform,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  OrthographicCamera,
  RepeatWrapping,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  Texture,
  UnsignedByteType,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import {
  precompile,
  PRECOMPILE_PRIORITY,
  PrecompileOptions,
} from '../../rendering/precompile';

/**
 * A texture drawn once on the GPU by a fragment shader of its own ({@link bakeTexture}).
 *
 * @group Materials
 */
export type BakedTexture = {
  /** the texture; drawn once `ready` resolves `true`, undefined until then */
  texture: Texture;
  /** `true` once drawn, `false` if disposed of first */
  ready: Promise<boolean>;
  /** let go of it on the GPU */
  dispose(): void;
};

/** Options of {@link bakeTexture}. */
export type BakeTextureOptions = {
  /** texels along a side */
  size: number;
  /**
   * the shader's own uniforms (besides `vUv`, the texel's place 0 to 1, and `uLoops`, which it
   * is given)
   */
  uniforms?: Record<string, IUniform>;
  /** anisotropic filtering, capped at the GPU's. Default 4 */
  anisotropy?: number;
  /** the texture's name, for debugging */
  name?: string;
  /** where its compile goes in the queue (`PRECOMPILE_PRIORITY`). Default background */
  priority?: number;
  /** told how its compile goes (see `PrecompileOptions`) */
  onProgress?: PrecompileOptions['onProgress'];
};

const vertexShader = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/**
 * Draw `fragmentShader` once into a square texture that repeats both ways and has mipmaps, 8
 * bits a channel, as data (no colour space): a tile a material reads instead of computing it
 * per pixel. The shader writes `gl_FragColor` at `varying vec2 vUv`, 0 to 1 across the tile.
 *
 * It may declare `uniform int uLoops`, always 1, and write its loops' counts times it: Direct3D
 * (ANGLE, so Chrome and Edge on Windows) then cannot count their turns and keeps each loop as
 * one, instead of copying its body out for every turn. A shader drawn once loses nothing by
 * it, and an unrolled one can take tens of seconds to compile (the rock texture 10–22 s, RTX
 * A1000, 2026-11-19). For the same reason it calls a heavy function from one place: every call
 * compiles a copy of it.
 *
 * It is drawn only once its program has compiled, in the background where the browser can
 * (see `precompile`): drawn while it compiles, Chrome's GPU process waits for it, which
 * freezes every tab and the browser itself. Show what reads it once `ready` resolves.
 *
 * @group Materials
 */
export function bakeTexture(
  renderer: WebGLRenderer,
  fragmentShader: string,
  {
    size,
    uniforms = {},
    anisotropy = 4,
    name = 'baked',
    priority = PRECOMPILE_PRIORITY.background,
    onProgress,
  }: BakeTextureOptions,
): BakedTexture {
  const target = new WebGLRenderTarget(size, size, {
    format: RGBAFormat,
    type: UnsignedByteType,
    depthBuffer: false,
    generateMipmaps: true,
    minFilter: LinearMipmapLinearFilter,
    magFilter: LinearFilter,
    wrapS: RepeatWrapping,
    wrapT: RepeatWrapping,
  });
  target.texture.name = name;
  target.texture.anisotropy = Math.min(
    anisotropy,
    renderer.capabilities.getMaxAnisotropy(),
  );

  const geometry = new BufferGeometry();
  geometry.setAttribute(
    'position',
    new Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3),
  );
  const material = new ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: { uLoops: { value: 1 }, ...uniforms },
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
  const draw = () => {
    if (disposed) return false;
    const previous = renderer.getRenderTarget();
    const face = renderer.getActiveCubeFace();
    const mipmap = renderer.getActiveMipmapLevel();
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    renderer.setRenderTarget(previous, face, mipmap);
    renderer.autoClear = autoClear;
    release();
    return true;
  };
  const compiling = precompile(renderer, scene, camera, scene, 'offscreen', {
    priority,
    onProgress,
  });
  return {
    texture: target.texture,
    ready: compiling ? compiling.then(draw) : Promise.resolve(draw()),
    dispose() {
      if (disposed) return;
      disposed = true;
      release();
      target.dispose();
    },
  };
}
