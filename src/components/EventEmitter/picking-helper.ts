import {
  Color,
  FloatType,
  InstancedMesh,
  Material,
  NearestFilter,
  NoColorSpace,
  Object3D,
  PerspectiveCamera,
  RGBAFormat,
  Scene,
  Vector2,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import { LAYERS } from '../../layers/layers';
import { normalizedDeviceToScreen, Vec2, Vec3 } from '../../sdk';
import { RenderableObject } from './EventEmitter';
import { Emitter, Listener } from './EventEmitterContext';
import { getPickingMaterial, PickingMaterial } from './picking-material';

const defaults = {
  radius: 3,
};

/** Polls after which a read back still not done is given up (a wedged or lost GPU). */
const PICK_MAX_FRAMES = 120;

export type PickedObject = {
  emitter: Emitter;
  index: number;
};

export type PickResult = {
  match: PickedObject | null;
  position: Vec3;
  point: Vec2;
};

/**
 * Used internally by the `EventEmitter` component
 * @internal
 */
export class PickingHelper {
  private _size: number;
  private _radius: number;
  /** the patch under the pointer is rendered here, then read back */
  private _target: WebGLRenderTarget;
  private _buffer: Float32Array;
  private _prevClearColor: Color = new Color();

  private _material = new PickingMaterial();

  /**
   * Dedicated camera used for the picking render so the shared scene camera is
   * never mutated. `setViewOffset` rebuilds a camera's projection (it remaps the
   * frustum to the tiny patch under the cursor), and that mutation would clobber
   * any external modification of the real camera's projection — e.g. the
   * sub-pixel jitter a TAA pass bakes in. Each pick this camera is `copy()`d from
   * the real camera (which faithfully mirrors `matrixWorld`,
   * `matrixWorldInverse`, the projection and all intrinsics) and the view offset
   * is applied here instead. `matrixWorldAutoUpdate` is disabled so the renderer
   * uses the copied world matrix verbatim rather than recomputing it.
   */
  private _camera = new PerspectiveCamera();

  private _listeners = new Map<number, Listener>();
  private _emitters = new Map<number, Emitter>();
  /** Stamped on every emitter each traversal, so stale ones can be swept. */
  private _generation = 0;
  private _version = 0;

  /** Meshes picked with a material of their own this pick (see `collectSwap`). */
  private _swapObjects: RenderableObject[] = [];
  private _swapMaterials: Material[] = [];
  private _swapOriginals: Material[] = [];
  private _swapCount = 0;
  private _swapSeen = new Set<Object3D>();

  /** The read back in flight: a pixel pack buffer per pick, deleted once read. */
  private _gl: WebGL2RenderingContext | null = null;
  private _pack: WebGLBuffer | null = null;
  private _sync: WebGLSync | null = null;
  private _pending: {
    mapLength: number;
    mapTotal: number;
    point: Vec2;
    frames: number;
  } | null = null;

  /** listeners registered; nothing is picked while there are none */
  get listenerCount() {
    return this._listeners.size;
  }

  /** changes whenever a listener is added or removed */
  get version() {
    return this._version;
  }

  // Range-based object map rebuilt every pick. Each emitter occupies a
  // contiguous range of flat ids [start, start + count) so we store a single
  // entry per emitter instead of one per instance. The shader emits
  // `start + gl_InstanceID`, so the per-pixel instance index is recovered as
  // `flatId - start`. The arrays are reused across picks (only the active
  // length changes) to avoid per-frame allocation.
  private _mapStarts: number[] = [];
  private _mapObjectIds: number[] = [];
  private _objectMapLength = 0;
  private _objectMapCount = 0;

  constructor(options = {}) {
    const { radius } = { ...defaults, ...options };
    this._radius = Math.max(Math.min(10, radius), 0);
    this._size = 2 * this._radius + 1;

    this._target = new WebGLRenderTarget(this._size, this._size, {
      colorSpace: NoColorSpace,
      samples: 0,
      format: RGBAFormat,
      type: FloatType,
      magFilter: NearestFilter,
      minFilter: NearestFilter,
      depthBuffer: true,
      stencilBuffer: false,
      generateMipmaps: false,
    });

    this._buffer = new Float32Array(this._size * this._size * 4);

    // The picking camera's world matrix is copied from the real camera each pick;
    // disabling auto-update stops the renderer recomputing it from
    // position/quaternion/scale (which the copy does not set).
    this._camera.matrixWorldAutoUpdate = false;
  }

  private traverseObject = (
    object: Object3D,
    rootId: number,
    depth: number,
    threshold?: number,
    custom?: Material,
  ) => {
    if (object.visible && !object.layers.isEnabled(LAYERS.NOT_EMITTER)) {
      if (
        object.type === 'Mesh' ||
        object.type === 'Line' ||
        object.type === 'Points'
      ) {
        const instanced = !!(object as InstancedMesh).isInstancedMesh;
        const instanceCount = instanced ? (object as InstancedMesh).count : 1;
        const emitterThreshold: number = Number.isFinite(threshold)
          ? threshold!
          : object.type === 'Mesh'
            ? 0
            : 3;

        if (instanceCount > 0) {
          let emitter = this._emitters.get(object.id);
          if (!emitter) {
            emitter = {
              source: object,
              depth,
              listener: rootId,
              threshold: emitterThreshold,
              instanced,
              instanceCount,
              generation: this._generation,
            };
            this._emitters.set(object.id, emitter);
          } else {
            // The emitter may already be added in a previous update, but we should still
            // update its references, in case an object id is re-used by three js for another object
            emitter.source = object;
            emitter.threshold = emitterThreshold;
            emitter.instanced = instanced;
            emitter.instanceCount = instanceCount;
            emitter.generation = this._generation;

            // if this object is reachable from more than one listener, we need to set the
            // listener to the one closest to the object, i.e. the one with the lesser depth value
            if (depth < emitter.depth) {
              emitter.depth = depth;
              emitter.listener = rootId;
            }
          }
          const baseId = this._objectMapCount;
          const index = this._objectMapLength;
          this._mapStarts[index] = baseId;
          this._mapObjectIds[index] = object.id;
          this._objectMapLength = index + 1;
          this._objectMapCount = baseId + emitter.instanceCount;
          // assign an emitter id to the object and activate emitter layer
          object.userData.__emitterID = baseId + 1;
          object.layers.enable(LAYERS.EMITTER);
          this.collectSwap(object as RenderableObject, custom);
        } else {
          object.layers.disable(LAYERS.EMITTER);
          delete object.userData.__emitterID;
        }
      }

      for (let i = 0; i < object.children.length; i++) {
        this.traverseObject(
          object.children[i],
          rootId,
          depth + 1,
          threshold,
          custom,
        );
      }
    }
  };

  /**
   * Swap in custom emitter materials so displaced / instanced geometry (e.g. the
   * Trajectory tube, whose shape is reconstructed in its vertex shader) is picked
   * with the same silhouette it is drawn with. A material may be provided per-mesh
   * via `userData.emitterMaterial` (preferred — works under any ancestor listener,
   * e.g. a Wellbore, with no dedicated registration), by the mesh's own material
   * via `setPickingMaterial` (so a material that discards fragments is picked with
   * the same discards), or per-listener via `customMaterial`. A mesh reachable from
   * more than one listener is swapped once, so its own material comes back.
   */
  private collectSwap(object: RenderableObject, custom?: Material) {
    if (!object.material || this._swapSeen.has(object)) return;
    const material =
      (object.userData.emitterMaterial as Material | undefined) ||
      (Array.isArray(object.material)
        ? undefined
        : getPickingMaterial(object.material)) ||
      custom;
    if (!material) return;
    this._swapSeen.add(object);
    this._swapObjects[this._swapCount] = object;
    this._swapMaterials[this._swapCount] = material;
    this._swapCount++;
  }

  updateListeners = () => {
    this._objectMapLength = 0;
    this._objectMapCount = 0;
    this._swapCount = 0;
    this._swapSeen.clear();
    const generation = ++this._generation;
    this._listeners.forEach(listener => {
      this.traverseObject(
        listener.object,
        listener.object.id,
        0,
        listener.threshold,
        listener.customMaterial,
      );
    });
    // ⚠⚠ `traverseObject` only ever ADDS, and `removeListener` can only reach the
    // descendants a listener has AT THAT MOMENT. A component that rebuilds its
    // geometry hands over entirely new meshes, so without this sweep every mesh it
    // has ever produced stays referenced here — and with it the geometry's CPU
    // arrays and materials, which `dispose()` does not release.
    if (this._emitters.size > this._objectMapLength) {
      this._emitters.forEach((emitter, id) => {
        if (emitter.generation !== generation) this._emitters.delete(id);
      });
    }
  };

  addListener = (listener: Listener) => {
    this._listeners.set(listener.object.id, listener);
    this._version++;
  };

  getListener = (id: number) => {
    return this._listeners.get(id);
  };

  removeListener = (id: number) => {
    const listener = this._listeners.get(id);
    if (listener) {
      const { object } = listener;
      // remove listener and associated emitters
      this._listeners.delete(id);
      this._version++;
      object.traverse(obj => {
        obj.layers.disable(LAYERS.EMITTER);
        delete obj.userData.__emitterID;
        this._emitters.delete(obj.id);
      });
    }
  };

  /**
   * Render the patch under `pointer` and start reading it back, without waiting:
   * {@link poll} hands over the result once the GPU has it. Run {@link
   * updateListeners} first. Returns false when nothing was started.
   */
  start(
    pointer: Vector2,
    renderer: WebGLRenderer,
    scene: Scene,
    camera: PerspectiveCamera,
  ): boolean {
    const gl = renderer.getContext() as WebGL2RenderingContext;
    if (this._pending || gl.isContextLost()) return false;

    const width = renderer.domElement.clientWidth;
    const height = renderer.domElement.clientHeight;
    const point = pointer.toArray();
    const screen = normalizedDeviceToScreen(point, width, height);

    const x = screen[0] - this._radius;
    const y = screen[1] - this._radius;

    const prevSceneBackground = scene.background;
    const prevTarget = renderer.getRenderTarget();

    renderer.getClearColor(this._prevClearColor);
    const prevClearAlpha = renderer.getClearAlpha();
    scene.background = null;
    scene.overrideMaterial = this._material;

    // Mirror the real camera onto the dedicated picking camera: copy() brings
    // across matrixWorld, matrixWorldInverse, the projection and all intrinsics,
    // so the picking render matches what is on screen (including near/far, which
    // keeps logarithmic-depth precision consistent). The real camera is never
    // touched. recursive=false: we don't need the camera's children.
    const pickCamera = this._camera;
    pickCamera.copy(camera, false);
    pickCamera.layers.set(LAYERS.EMITTER);

    // set the view offset to represent just the patch we need to render under the
    // mouse (rebuilds the picking camera's projection only).
    pickCamera.setViewOffset(width, height, x, y, this._size, this._size);

    const swaps = this._swapCount;
    for (let i = 0; i < swaps; i++) {
      const object = this._swapObjects[i];
      this._swapOriginals[i] = object.material;
      object.material = this._swapMaterials[i];
    }

    renderer.setRenderTarget(this._target);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(scene, pickCamera);

    scene.background = prevSceneBackground;
    scene.overrideMaterial = null;
    for (let i = 0; i < swaps; i++) {
      this._swapObjects[i].material = this._swapOriginals[i];
      this._swapOriginals[i] = null!;
    }

    // Copy the patch into the pack buffer ON the GPU while the target is bound, and
    // fence it: three's own async read asks the GPU for the pixel type first, which
    // waits for it as long as a read back does.
    renderer.setRenderTarget(this._target);
    this._gl = gl;
    // A new buffer each pick: refilling one makes Chrome warn on every pick.
    this._pack = gl.createBuffer();
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this._pack);
    gl.bufferData(gl.PIXEL_PACK_BUFFER, this._buffer.byteLength, gl.STREAM_READ);
    gl.readPixels(0, 0, this._size, this._size, gl.RGBA, gl.FLOAT, 0);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    this._sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();

    renderer.setClearColor(this._prevClearColor, prevClearAlpha);
    renderer.setRenderTarget(prevTarget);

    // The object map is not touched again until this pick is polled out.
    this._pending = {
      mapLength: this._objectMapLength,
      mapTotal: this._objectMapCount,
      point,
      frames: 0,
    };
    return true;
  }

  /**
   * The pick {@link start} began, once the GPU has it: `undefined` while it is
   * still on its way, `null` when there is none (none started, the context was
   * lost, or it waited `PICK_MAX_FRAMES` polls). Poll once per frame.
   */
  poll(): { result: PickResult; readMs: number } | null | undefined {
    const pending = this._pending;
    const gl = this._gl;
    if (!pending || !gl || !this._sync) return null;
    if (gl.isContextLost()) {
      this.contextLost();
      return null;
    }
    const status = gl.clientWaitSync(this._sync, 0, 0);
    if (status === gl.TIMEOUT_EXPIRED && ++pending.frames < PICK_MAX_FRAMES) {
      return undefined;
    }
    const pack = this._pack;
    gl.deleteSync(this._sync);
    this._sync = null;
    this._pack = null;
    this._pending = null;
    if (status !== gl.ALREADY_SIGNALED && status !== gl.CONDITION_SATISFIED) {
      gl.deleteBuffer(pack);
      return null;
    }
    const t0 = performance.now();
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pack);
    gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, this._buffer);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    const readMs = performance.now() - t0;
    gl.deleteBuffer(pack);
    return {
      result: this.pick(
        this._buffer,
        pending.mapLength,
        pending.mapTotal,
        pending.point,
      ),
      readMs,
    };
  }

  /** Forget the GPU objects of a lost context; the next pick makes new ones. */
  contextLost() {
    this._pack = null;
    this._sync = null;
    this._pending = null;
  }

  /**
   * Locate the emitter owning a flat id via binary search. Emitter ranges are
   * contiguous and sorted by start, so the owner is the rightmost entry whose
   * start is `<= flatId`.
   */
  private findEmitterIndex(flatId: number, mapLength: number): number {
    let lo = 0;
    let hi = mapLength - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this._mapStarts[mid] <= flatId) {
        found = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return found;
  }

  private pick(
    buffer: Float32Array,
    mapLength: number,
    mapTotal: number,
    point: Vec2,
  ): PickResult {
    const match: {
      object: PickedObject | null;
      lsqr: number;
      bufferIndex: number;
    } = {
      object: null,
      lsqr: Infinity,
      bufferIndex: 0,
    };

    let i = 0;
    let ox = 0;
    let oy = 0;
    let lsqr = 0;
    let emitterId = 0;
    let emitterIndex = 0;
    let objectId = 0;
    let instanceIndex = 0;
    let emitter: Emitter | undefined = undefined;

    // Find closest match if any
    for (let r = this._size - 1; r >= 0; r--) {
      for (let c = 0; c < this._size; c++, i += 4) {
        emitterId = buffer[i] - 1;
        if (emitterId >= 0 && emitterId < mapTotal) {
          emitterIndex = this.findEmitterIndex(emitterId, mapLength);
          if (emitterIndex >= 0) {
            objectId = this._mapObjectIds[emitterIndex];
            instanceIndex = emitterId - this._mapStarts[emitterIndex];

            emitter = this._emitters.get(objectId);
            if (emitter) {
              ox = c - this._radius;
              oy = r - this._radius;
              lsqr = ox ** 2 + oy ** 2 - emitter.threshold ** 2;

              if (!match.object || match.lsqr > lsqr) {
                match.object = {
                  emitter,
                  index: instanceIndex,
                };
                match.lsqr = lsqr;
                match.bufferIndex = i;
              }
            }
          }
        }
      }
    }

    const result: PickResult = {
      match: match.object,
      point,
      position: [
        buffer[match.bufferIndex + 1],
        buffer[match.bufferIndex + 2],
        buffer[match.bufferIndex + 3],
      ],
    };

    return result;
  }

  dispose() {
    this._target.dispose();
    const gl = this._gl;
    if (gl && !gl.isContextLost()) {
      if (this._sync) gl.deleteSync(this._sync);
      if (this._pack) gl.deleteBuffer(this._pack);
    }
    this.contextLost();
    this._gl = null;
    this._swapObjects.length = 0;
    this._swapMaterials.length = 0;
    this._swapOriginals.length = 0;
    this._swapCount = 0;
    this._swapSeen.clear();
    const listeners = Array.from(this._listeners.values());
    this._material.dispose();
    listeners.forEach(listener =>
      listener.object.traverse(obj => {
        obj.layers.disable(LAYERS.EMITTER);
        delete obj.userData.__emitterID;
      }),
    );

    this._listeners.clear();
    this._emitters.clear();
  }
}
