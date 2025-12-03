import { createContext, useContext } from 'react'
import { Camera, Object3D } from 'three'
import { Vec2, Vec3 } from '../../../sdk'

export type KeysPressed = {
  altKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
}

export type EventEmitterCallbackEvent = {
  target: Object3D
  source: Object3D
  instanceIndex?: number
  position?: Vec3
  pointer: Vec2
  camera: Camera
  domElement: HTMLElement
  keys: KeysPressed
  ref: any
}

export type EventEmitterCallback = (
  event: EventEmitterCallbackEvent
) => Promise<void>

export type Listener = {
  object: Object3D
  ref?: any
  threshold?: number
  handlers: Record<string, EventEmitterCallback>
}

export type EventEmitterContextProps = {
  register: (
    obj: Object3D,
    handlers: Record<string, EventEmitterCallback>,
    ref?: any,
    threshold?: number
  ) => () => void
}

/**
 * Context for registering event handlers to the `EventEmitter`
 *
 * @see {@link EventEmitter}
 *
 * @group Contexts
 */
export const EventEmitterContext = createContext<EventEmitterContextProps>(
  null!
)

/**
 * Used to register event handlers for renderable components.
 *
 * @example
 * const eventHandler = useEventEmitter()
 *
 * @remarks
 * The generator is an async function that process and returns data required
 * by your components, such as geometry for a mesh.
 *
 * An optional threshold value may be provided in the register method. This is used
 * to weight the distance when performing GPU picking, making objects with a
 * higher threshold more likely to be hit. This is usually used for thin/small objects,
 * which may otherwise be hard to hit.
 * @example
 *
 * useEffect(() => {
 *   let unregister: (() => void) | null = null
 *   if (eventHandler && ref.current) {
 *     const handlers: Record<string, EventEmitterCallback> = {}
 *
 *     if (onPointerClick) handlers.click = onPointerClick
 *     if (onPointerEnter) handlers.enter = onPointerEnter
 *     if (onPointerLeave) handlers.leave = onPointerLeave
 *     if (onPointerMove) handlers.move = onPointerMove
 *
 *     if (Object.keys(handlers).length) {
 *       unregister = eventHandler.register(ref.current, handlers, id)
 *     }
 *   }
 *
 *   return () => {
 *     if (unregister) unregister()
 *   }
 * }, [eventHandler, onPointerClick, onPointerEnter, onPointerLeave, onPointerMove])
 *
 * @see {@link EventEmitter}
 *
 * @group Hooks
 */
export const useEventEmitter = () => useContext(EventEmitterContext)
