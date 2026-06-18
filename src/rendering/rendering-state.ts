import { useThree } from '@react-three/fiber';
import { Object3D } from 'three';
import { useStore } from 'zustand';
import { createStore, StoreApi } from 'zustand/vanilla';

/**
 * Transparency rendering mode currently active for a given scene/canvas.
 *
 * - `'standard'`: default rendering, as if no custom rendering pipeline is used.
 *   Components apply their default self-transparency workarounds.
 * - `'oit'`: an order-independent-transparency pipeline (e.g. {@link OITRenderPass})
 *   is active. Components should disable workarounds that conflict with OIT (such as
 *   depth-only mask passes) and let the pipeline resolve transparency.
 */
export type TransparencyMode = 'standard' | 'oit';

/**
 * Per-canvas rendering pipeline state.
 *
 * Lets components react to which rendering pipeline (if any) is active without the
 * user having to manually configure each component. The defaults match the behavior
 * of default rendering with no custom pipeline.
 *
 * @group Rendering
 */
export type RenderingState = {
  /** The active transparency mode. Defaults to `'standard'`. */
  transparencyMode: TransparencyMode;
  /** @internal reference count of active OIT pipelines. */
  _oitCount: number;
  /**
   * Register an active OIT pipeline. Sets {@link RenderingState.transparencyMode}
   * to `'oit'`. Returns a release function that must be called when the pipeline is
   * disposed; the mode reverts to `'standard'` once all registrations are released.
   * Reference counted so multiple/short-lived passes behave correctly.
   */
  acquireOit: () => () => void;
};

function createRenderingStore(): StoreApi<RenderingState> {
  return createStore<RenderingState>((set, get) => ({
    transparencyMode: 'standard',
    _oitCount: 0,
    acquireOit: () => {
      set(state => ({
        _oitCount: state._oitCount + 1,
        transparencyMode: 'oit',
      }));
      let released = false;
      return () => {
        if (released) return;
        released = true;
        const next = Math.max(0, get()._oitCount - 1);
        set({
          _oitCount: next,
          transparencyMode: next > 0 ? 'oit' : 'standard',
        });
      };
    },
  }));
}

/**
 * Registry of per-scene rendering state stores. Keyed on the R3F `scene` object so
 * each canvas gets an isolated store. A `WeakMap` keeps this GC-safe and avoids
 * polluting `scene.userData`.
 */
const storeRegistry = new WeakMap<Object3D, StoreApi<RenderingState>>();

/**
 * Get (or lazily create) the {@link RenderingState} store for a given scene.
 *
 * Both the rendering passes (which hold a reference to the scene) and the hooks used
 * by components (which resolve the scene via R3F) call this with the same scene, so
 * they share a single store instance per canvas. No provider is required — the store
 * is created on first access, so components used without any pipeline still work and
 * simply observe the `'standard'` default.
 *
 * @group Rendering
 */
export function getRenderingState(scene: Object3D): StoreApi<RenderingState> {
  let store = storeRegistry.get(scene);
  if (!store) {
    store = createRenderingStore();
    storeRegistry.set(scene, store);
  }
  return store;
}

/**
 * Hook to read the per-canvas {@link RenderingState}. Resolves the store from the
 * current R3F scene, so it must be used inside a `Canvas`.
 *
 * @example
 * ```tsx
 * const isOit = useRenderingState(state => state.transparencyMode === 'oit');
 * ```
 *
 * @group Hooks
 * @category Rendering
 */
export function useRenderingState<T>(
  selector: (state: RenderingState) => T,
): T {
  const scene = useThree(state => state.scene);
  return useStore(getRenderingState(scene), selector);
}
