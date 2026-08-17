import { Box3, Object3D, Scene, Vector3 } from 'three';
import { CameraManager } from '../../sdk/managers/CameraManager';
import { Vec3 } from '../../sdk';

/**
 * What an agent (or a curious human) can reach from the browser console.
 *
 * ⭐ Storybook ONLY — the library never touches `window`. This exists so a view
 * can be set by coordinate and a scene waited on by signal, instead of by
 * trial-and-error orbiting and fixed sleeps.
 */
export type Videx3dHandle = {
  camera: CameraManager;
  scene: Scene;
  /** resolves once the scene graph has stopped growing — data loaded, chunks built */
  ready: (options?: {
    stableFrames?: number;
    timeout?: number;
  }) => Promise<boolean>;
  /** world-space bounds of everything currently in the scene */
  bounds: () => { min: Vec3; max: Vec3; center: Vec3; size: Vec3 } | null;
  /** scene-frame position of a named thing, when a story has registered a locator */
  locate?: (kind: string, id: string) => Record<string, Vec3> | null;
  /** change story controls WITHOUT reloading the page */
  setArgs: (args: Record<string, unknown>) => Promise<void>;
  getArgs: () => Record<string, unknown> | null;
};

declare global {
  interface Window {
    videx3d?: Partial<Videx3dHandle>;
  }
}

/**
 * Merge a slice of the handle in. Several places contribute: the canvas decorator
 * owns the camera and the scene, a story owns whatever `locate` means for it.
 *
 * @returns a function that removes exactly the keys it added
 */
export function registerVidex3d(part: Partial<Videx3dHandle>): () => void {
  window.videx3d = { ...window.videx3d, ...part };
  const keys = Object.keys(part) as (keyof Videx3dHandle)[];
  return () => {
    if (!window.videx3d) return;
    for (const key of keys) delete window.videx3d[key];
    if (Object.keys(window.videx3d).length === 0) delete window.videx3d;
  };
}

/**
 * Wait until the scene graph stops changing.
 *
 * ⚠️ Deliberately a HEURISTIC on object count rather than a promise threaded
 * through every loader: chunks arrive from workers over many frames and there is
 * no single "done". Stability is the observable that actually matters to a
 * screenshot, and it needs no cooperation from the components being watched.
 *
 * ⚠️⚠️ An EMPTY scene is perfectly stable. Without the mesh floor this returns
 * immediately on a story whose data has not arrived yet — measured resolving in
 * 4.5 s against a scene with zero meshes, which then screenshots as nothing.
 *
 * @returns true when it settled, false when it gave up
 */
export function waitForStableScene(
  scene: Object3D,
  options: {
    stableFrames?: number;
    timeout?: number;
    /** meshes that must exist before stability is allowed to count. Default 1. */
    minMeshes?: number;
  } = {},
): Promise<boolean> {
  const stableFrames = options.stableFrames ?? 30;
  const timeout = options.timeout ?? 60000;
  const minMeshes = options.minMeshes ?? 1;
  return new Promise(resolve => {
    const deadline = performance.now() + timeout;
    let last = -1;
    let steady = 0;
    const tick = () => {
      let count = 0;
      let meshes = 0;
      scene.traverse(object => {
        count++;
        if ((object as { isMesh?: boolean }).isMesh) meshes++;
      });
      if (meshes < minMeshes) {
        steady = 0;
        last = -1;
      } else if (count === last) steady++;
      else {
        steady = 0;
        last = count;
      }
      if (steady >= stableFrames) return resolve(true);
      if (performance.now() > deadline) return resolve(false);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

const box = new Box3();
const size = new Vector3();
const centre = new Vector3();

export function sceneBounds(scene: Object3D) {
  box.makeEmpty();
  box.setFromObject(scene);
  if (box.isEmpty()) return null;
  box.getSize(size);
  box.getCenter(centre);
  return {
    min: [box.min.x, box.min.y, box.min.z] as Vec3,
    max: [box.max.x, box.max.y, box.max.z] as Vec3,
    center: [centre.x, centre.y, centre.z] as Vec3,
    size: [size.x, size.y, size.z] as Vec3,
  };
}

/** The Storybook id of the story in this frame, from the URL. */
function storyId(): string | null {
  return new URLSearchParams(location.search).get('id');
}

/**
 * Set story args in place.
 *
 * ⭐⭐ The alternative is reloading the iframe, which on a data-heavy story costs
 * tens of seconds per control change — by far the most expensive part of an
 * A/B. The addons channel applies them in a frame.
 */
export function setStoryArgs(args: Record<string, unknown>): Promise<void> {
  const channel = (window as any).__STORYBOOK_ADDONS_CHANNEL__;
  const id = storyId();
  if (!channel || !id) return Promise.resolve();
  return new Promise(resolve => {
    const done = () => {
      channel.off('storyArgsUpdated', done);
      requestAnimationFrame(() => resolve());
    };
    channel.on('storyArgsUpdated', done);
    channel.emit('updateStoryArgs', { storyId: id, updatedArgs: args });
    // The channel is not guaranteed to answer for an unchanged value.
    setTimeout(done, 2000);
  });
}

export function getStoryArgs(): Record<string, unknown> | null {
  const store = (window as any).__STORYBOOK_PREVIEW__
    ?.storeInitializationPromise
    ? (window as any).__STORYBOOK_STORY_STORE__
    : null;
  const id = storyId();
  if (!store || !id) return null;
  try {
    return store.args?.get?.(id) ?? null;
  } catch {
    return null;
  }
}
