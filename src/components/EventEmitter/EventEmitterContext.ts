import { createContext, useContext } from 'react';
import { Camera, Material, Object3D } from 'three';
import { Vec2, Vec3 } from '../../sdk';

export type KeysPressed = {
  altKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
};

export type EventEmitterCallbackEvent = {
  target: Object3D;
  source: Object3D;
  instanceIndex?: number;
  position?: Vec3;
  pointer: Vec2;
  camera: Camera;
  domElement: HTMLElement;
  keys: KeysPressed;
  /**
   * Which mouse button started the click (`0` left, `1` middle, `2` right), as
   * `PointerEvent.button`. Set on `click` only — the other handlers fire while no
   * button is down.
   */
  button?: number;
  ref: any;
};

export type EventEmitterCallback = (event: EventEmitterCallbackEvent) => void;

export type Listener = {
  object: Object3D;
  ref?: any;
  threshold?: number;
  handlers: Record<string, EventEmitterCallback>;
  customMaterial?: Material;
};

export type Emitter = {
  source: Object3D;
  depth: number;
  listener: number;
  instanced: boolean;
  instanceCount: number;
  threshold: number;
  /** the traversal that last saw this object (see `PickingHelper.updateListeners`) */
  generation?: number;
};

export type ObjectMapEntry = {
  emitter: number;
  index: number;
};

export type EventEmitterContextProps = {
  register: (listener: Listener) => () => void;
  update: () => void;
};

/**
 * Context for registering event handlers to the `EventEmitter`
 *
 * @see {@link EventEmitter}
 *
 * @group Contexts
 */
export const EventEmitterContext = createContext<EventEmitterContextProps>(
  null!,
);

/**
 * Used to register event handlers for renderable components.
 *
 * @example
 * const eventHandler = useEventEmitter()
 *
 * @remarks
 * Nothing is picked while no listener is registered, so an `EventEmitter` costs
 * nothing until one is. Call `update()` when what is under a still pointer
 * changes on its own (the emitter otherwise picks again only when the pointer, the
 * camera or the listeners change).
 *
 * An optional `threshold` may be given with the listener. This is used
 * to weight the distance when performing GPU picking, making objects with a
 * higher threshold more likely to be hit. This is usually used for thin/small objects,
 * which may otherwise be hard to hit.
 * @example
 *
 * useEffect(() => {
 *   if (!eventHandler || !ref.current) return
 *   const handlers: Record<string, EventEmitterCallback> = {}
 *
 *   if (onPointerClick) handlers.click = onPointerClick
 *   if (onPointerEnter) handlers.enter = onPointerEnter
 *   if (onPointerLeave) handlers.leave = onPointerLeave
 *   if (onPointerMove) handlers.move = onPointerMove
 *
 *   if (Object.keys(handlers).length === 0) return
 *   // returns the unregister function, which the effect cleanup calls
 *   return eventHandler.register({ object: ref.current, handlers, ref: id })
 * }, [eventHandler, onPointerClick, onPointerEnter, onPointerLeave, onPointerMove])
 *
 * @see {@link EventEmitter}
 *
 * @group Hooks
 */
export const useEventEmitter = () => useContext(EventEmitterContext);
