import { WebGLRenderer } from 'three';

/**
 * Run `draw`, which sets render targets and draws into them (or compiles, or reads pixels),
 * and leave `renderer` as it was: its render target, cube face and mipmap level. Safe while
 * `renderer` is in the middle of drawing a scene, from an object's `onBeforeRender` say, as
 * three's render is re-entrant.
 *
 * While `draw` runs, three's own clearing (`autoClear`), counter resets (`info.autoReset`) and
 * shadow map updates (`shadowMap.autoUpdate`) are off, so a `render` in it draws only what it
 * is given: clear a target yourself where it needs it. All of it is put back even if `draw`
 * throws. Returns what `draw` returns.
 *
 * @example
 * renderAside(renderer, () => {
 *   renderer.setRenderTarget(target);
 *   renderer.render(passScene, camera);
 * });
 */
export function renderAside<T>(renderer: WebGLRenderer, draw: () => T): T {
  const target = renderer.getRenderTarget();
  const cubeFace = renderer.getActiveCubeFace();
  const mipLevel = renderer.getActiveMipmapLevel();
  const autoClear = renderer.autoClear;
  const autoReset = renderer.info.autoReset;
  const shadows = renderer.shadowMap.autoUpdate;
  renderer.autoClear = false;
  renderer.info.autoReset = false;
  renderer.shadowMap.autoUpdate = false;
  try {
    return draw();
  } finally {
    renderer.setRenderTarget(target, cubeFace, mipLevel);
    renderer.autoClear = autoClear;
    renderer.info.autoReset = autoReset;
    renderer.shadowMap.autoUpdate = shadows;
  }
}
