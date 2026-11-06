import type { Material, Texture, WebGLRenderer } from 'three';

// Textures kept for the whole page and drawn with by any renderer (the colour ramps). three adds
// a listener to a texture for each renderer that uploads it, and takes it off only as the texture
// is disposed: one never disposed kept every renderer that had drawn with it alive once its
// Canvas had gone. So as a renderer that drew with them loses its context (R3F forces that as a
// Canvas unmounts), they are disposed: each renderer lets go of its copy and its listener, and
// those still drawing upload them again from the data they keep.

const shared = new Set<Texture>();
const WATCHED = Symbol('shared textures watched');

type Watched = { [WATCHED]?: true } & Partial<
  Pick<HTMLCanvasElement, 'addEventListener'>
>;

function releaseSharedTextures() {
  for (const texture of shared) texture.dispose();
}

/**
 * @internal
 * Keep `texture` for the page: let go of by every renderer as one that drew with it goes
 * ({@link watchSharedTextures}). Its data must stay, to be uploaded again.
 */
export function shareTexture<T extends Texture>(texture: T): T {
  shared.add(texture);
  return texture;
}

/**
 * @internal
 * Let go of the shared textures ({@link shareTexture}) as `renderer` loses its context. Once
 * per canvas: cheap enough to call on each draw.
 */
export function watchSharedTextures(renderer: WebGLRenderer) {
  const canvas = renderer.domElement as unknown as Watched;
  if (canvas[WATCHED] || !canvas.addEventListener) return;
  canvas[WATCHED] = true;
  canvas.addEventListener('webglcontextlost', releaseSharedTextures);
}

/**
 * @internal
 * `material`, whose draws watch their renderer ({@link watchSharedTextures}): for one that binds
 * a shared texture. Its `onBeforeRender` is taken; a copy made with `clone` does not keep it.
 */
export function drawsSharedTextures<T extends Material>(material: T): T {
  material.onBeforeRender = watchSharedTextures;
  return material;
}
