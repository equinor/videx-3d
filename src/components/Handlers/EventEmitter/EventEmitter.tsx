import { ReactNode, useCallback, useEffect, useMemo } from 'react'
import { EventEmitterContext, EventEmitterContextProps, EventEmitterCallback, Listener, KeysPressed } from './EventEmitterContext'
import { BufferGeometry, Color, InstancedBufferAttribute, InstancedMesh, Material, MeshBasicMaterial, Object3D, PerspectiveCamera, Scene, WebGLRenderer } from 'three'
import { useThree } from '@react-three/fiber'
import { LAYERS } from '../../../layers/layers'
import { PickingHelper } from './picking-helper'
import { Vec2 } from '../../../sdk/types/common'
import { idToHexColor } from '../../../sdk/utils/colors'

const CLICK_SPEED = 300
const MOVE_THRESHOLD = 10

/**
 * EventEmitter props
 * @expand
 */
export type EventEmitterProps = {
  children?: ReactNode
}

export type RenderableObject = Object3D & { material: Material, geometry: BufferGeometry }

export type Emitter = {
  source: RenderableObject,
  depth: number,
  material: Material,
  listener: number,
  instanced?: boolean,
  instanceColor?: Float32Array,
}

type PickingMaterials = { pool: MeshBasicMaterial[], index: number }

export type ObjectMapEntry = {
  emitter: Emitter,
  index?: number,
}

export type ObjectMap = {
  map: Map<number, ObjectMapEntry>,
  index: number,
}


type EventState = {
  current: ObjectMapEntry | null
  previous: ObjectMapEntry | null
  buttonDown: boolean
  deltaTime: number
  posX: number
  posY: number
  pickingHelper: PickingHelper
  emitters: Map<number, Emitter>
  listeners: Map<number, Listener>
  needCheckOnMove: boolean
  pickingMaterials: PickingMaterials
  objectMap: ObjectMap,
  moveTest: boolean,
}

const buildEmitterMap = (eventState: EventState) => {
  //console.time('buildEmitterMap')
  eventState.emitters.clear()
  eventState.objectMap.map.clear()
  eventState.objectMap.index = 1
  eventState.pickingMaterials.index = 0
  eventState.listeners.forEach(listener => processObject(listener.object, eventState, listener.object.id, 0))
  //console.log(eventState.emitters)
  //console.timeEnd('buildEmitterMap')
}

function processObject(object: Object3D, eventState: EventState, rootId: number, depth: number) {
  if (object.visible && !object.layers.isEnabled(LAYERS.NOT_EMITTER)) {
    if (object.type === 'Mesh' || object.type === 'Line' || object.type === 'Points') {
      let emitter = eventState.emitters.get(object.id)
      if (!emitter) {
        if (eventState.pickingMaterials.index >= eventState.pickingMaterials.pool.length) {
          // double the materials pool
          const count = eventState.pickingMaterials.pool.length || 100
          for (let i = 0; i < count; i++) {
            eventState.pickingMaterials.pool.push(new MeshBasicMaterial())
          }
        }

        const pickingMaterial = eventState.pickingMaterials.pool[eventState.pickingMaterials.index]

        emitter = {
          source: object as RenderableObject,
          material: pickingMaterial,
          depth,
          listener: null!
        }

        pickingMaterial.side = emitter.source.material.side

        if ((object as InstancedMesh).isInstancedMesh) {
          const instancedObject = object as InstancedMesh
          emitter.instanced = true
          emitter.instanceColor = new Float32Array(instancedObject.count * 3)
          // Need to disable frustum culling, otherwise instance will not be rendered to the render target
          object.frustumCulled = false
          pickingMaterial.color.set(0xffffff)
          for (let i = 0; i < instancedObject.count; i++) {
            const id = eventState.objectMap.index++
            eventState.objectMap.map.set(id, { emitter, index: i })
            new Color(idToHexColor(id)).toArray(emitter.instanceColor, i * 3)
          }
          // Set instance colors to white if not exists
          if (!instancedObject.instanceColor) {
            instancedObject.instanceColor = new InstancedBufferAttribute(new Float32Array(emitter.instanceColor.length).fill(1), 3)
          }
        } else {
          const id = eventState.objectMap.index++
          pickingMaterial.color.set(idToHexColor(id))
          eventState.objectMap.map.set(id, { emitter })
        }
        eventState.emitters.set(object.id, emitter)
        eventState.pickingMaterials.index++
      }
      if (!emitter.listener || emitter.depth > depth) {
        emitter.listener = rootId
        emitter.depth = depth
      }
      object.layers.enable(LAYERS.EMITTER)
    }

    for (let i = 0; i < object.children.length; i++) {
      processObject(object.children[i], eventState, rootId, depth + 1)
    }
  }
}

/**
 * The EventEmitter provider component allow child components to register as an event emitter.
 * Event emitter objects are rendered offscreen every frame and tested for proximity to the pointer location (i.e. mouse cursor).
 * 
 * Each object is asigned an unique color, using an override material, and a small area
 * is rendered around the pointer. The rendered framebuffer is returned from the GPU and 
 * processed on the CPU side to detect pointer events, such as pointer click, pointer enter,
 * pointer exit and pointer move.
 * 
 * This allows for a more performant interaction model (than using raycasting) when there are 
 * a large number of objects that needs to be tested.     
 * 
 * To add a component as an event emitter, use the `useEventEmitter` hook.
 * 
 * @example
 * <EventEmitter>
 *  { children }
 * </EventEmitter>
 * 
 * @remarks
 * When a component is added as an event emitter, the entire object graph is added by default.
 * Objects may be excluded by assigning it the `NOT_EMITTER` layer.
 * 
 * @see {@link useEventEmitter}
 * @see {@link LAYERS}
 * 
 * @group Components
 */
export const EventEmitter = ({ children }: EventEmitterProps) => {
  const { gl, camera, scene, pointer } = useThree()

  const eventState = useMemo<EventState>(() => ({
    current: null,
    previous: null,
    buttonDown: false,
    needCheckOnMove: false,
    posX: -1,
    posY: -1,
    deltaTime: 0,
    pickingHelper: new PickingHelper(),
    emitters: new Map(),
    listeners: new Map(),
    objectMap: { map: new Map(), index: 0 },
    pickingMaterials: { index: 0, pool: [] },
    moveTest: false,
  }), [])

  const context = useMemo<EventEmitterContextProps>(() => {
    return {
      register: (obj: Object3D, handlers: Record<string, EventEmitterCallback>, ref?: any) => {
        eventState.listeners.set(obj.id, { object: obj, handlers, ref })
        if (handlers.enter || handlers.leave || handlers.move) {
          eventState.needCheckOnMove = true
        }
        return () => {
          obj.traverse(obj => obj.layers.disable(LAYERS.EMITTER))
          eventState.listeners.delete(obj.id)
        }
      }
    }
  }, [eventState])

  const checkOnMove = useCallback((gl: WebGLRenderer, camera: PerspectiveCamera, scene: Scene, pointer: Vec2, keys: KeysPressed) => {
    eventState.moveTest = true
    buildEmitterMap(eventState)

    //console.time('pick')
    eventState.pickingHelper.pick(pointer, gl, scene, camera, eventState.emitters, eventState.objectMap).then(result => {
      if (!result) return // aborted

      eventState.current = result.match

      if (eventState.previous &&
        (!eventState.current ||
          (eventState.current.emitter.listener !== eventState.previous.emitter.listener) ||
          (eventState.current.emitter.listener === eventState.previous.emitter.listener && eventState.current.index !== eventState.previous.index)
        )
      ) {
        const listener = eventState.listeners.get(eventState.previous.emitter.listener)
        if (listener && listener.handlers.leave) {
          listener.handlers.leave({
            target: listener.object,
            source: eventState.previous.emitter.source,
            ref: listener.ref,
            instanceIndex: eventState.previous.index,
            keys,
          })
          gl.domElement.style.cursor = ''
        }
      }
      // Deermine pointer enter event
      if (eventState.current &&
        (!eventState.previous ||
          (eventState.previous.emitter.listener !== eventState.current.emitter.listener) ||
          (eventState.current.emitter.listener === eventState.previous.emitter.listener && eventState.current.index !== eventState.previous.index)
        )
      ) {
        const listener = eventState.listeners.get(eventState.current.emitter.listener)
        if (listener && listener.handlers.enter) {
          listener.handlers.enter({
            target: listener.object,
            source: eventState.current.emitter.source,
            ref: listener.ref,
            instanceIndex: eventState.current.index,
            keys,
          })
          gl.domElement.style.cursor = listener.handlers.click ? 'pointer' : ''
        }
      }
      // Determine pointer move event
      if (eventState.current &&
        (eventState.previous === null ||
          (eventState.previous.emitter.listener === eventState.current.emitter.listener &&
            (!eventState.previous.index || eventState.previous.index === eventState.current.index)
          )
        )
      ) {
        const listener = eventState.listeners.get(eventState.current.emitter.listener)
        if (listener && listener.handlers.move) {
          const source = eventState.current.emitter.source
          const instanceIndex = eventState.current.index
          
          if (result.position) {
            result.position.then(value => {
              listener.handlers.move({
                target: listener.object,
                source,
                ref: listener.ref,
                instanceIndex,
                position: value,
                keys,
              })
            })
          }
        }
      }

      eventState.previous = eventState.current
      eventState.moveTest = false
    })

    //console.timeEnd('pick')
    // Determine pointer leave event

  }, [eventState])

  const checkOnClick = useCallback((gl: WebGLRenderer, camera: PerspectiveCamera, scene: Scene, pointer: Vec2, keys: KeysPressed) => {
    buildEmitterMap(eventState)

    eventState.pickingHelper.pick(pointer, gl, scene, camera, eventState.emitters, eventState.objectMap, true).then(result => {
      if (result && result.match) {
        const picked = result.match
        const listener = eventState.listeners.get(picked.emitter.listener)
        if (listener && listener.handlers.click) {
          
          if (result.position) {
            result.position.then(value => {
              listener.handlers.click({
                position: value,
                target: listener.object,
                source: picked.emitter.source,
                ref: listener.ref,
                instanceIndex: picked.index,
                keys,
              })
            })
          }
        }
      }
    })
  }, [eventState])

  useEffect(() => {
    function onPointerMove(event: PointerEvent) {

      if (!eventState.moveTest) {

        if (eventState.needCheckOnMove && !eventState.buttonDown) {

          const keys: KeysPressed = {
            ctrlKey: event.ctrlKey,
            shiftKey: event.shiftKey,
            altKey: event.altKey,
          }
          checkOnMove(gl, camera as PerspectiveCamera, scene, pointer.toArray(), keys)
        }
      }
    }

    function onPointerDown(event: PointerEvent) {
      if (event.isPrimary) {
        eventState.buttonDown = true
        eventState.posX = event.pageX
        eventState.posY = event.pageY
        eventState.deltaTime = performance.now()
      }
    }

    function onPointerUp(event: PointerEvent) {
      if (event.isPrimary) {
        const time = performance.now()
        if (
          eventState.buttonDown &&
          time - eventState.deltaTime < CLICK_SPEED &&
          Math.abs(event.pageX - eventState.posX) < MOVE_THRESHOLD &&
          Math.abs(event.pageY - eventState.posY) < MOVE_THRESHOLD
        ) {
          const keys: KeysPressed = {
            ctrlKey: event.ctrlKey,
            shiftKey: event.shiftKey,
            altKey: event.altKey,
          }
          checkOnClick(gl, camera as PerspectiveCamera, scene, pointer.toArray(), keys)
        }
        // else if ( // long click
        //   eventState.buttonDown &&
        //   time - eventState.deltaTime < (CLICK_SPEED * 3) &&
        //   Math.abs(event.pageX - eventState.posX) < MOVE_THRESHOLD &&
        //   Math.abs(event.pageY - eventState.posY) < MOVE_THRESHOLD
        // ) {
        //   checkOnMove(gl, camera as PerspectiveCamera, scene, pointer.toArray(), event)
        // }
        eventState.buttonDown = false
      }
    }

    function onCancel() {
      eventState.current = null
      eventState.previous = null
    }

    // delay check on this event to wait for zoom transition of the camera controls
    function onWheel(event: WheelEvent) {
      const keys: KeysPressed = {
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
      }
      setTimeout(() => {
        if (eventState.needCheckOnMove && !eventState.buttonDown && !eventState.moveTest) {
          checkOnMove(gl, camera as PerspectiveCamera, scene, pointer.toArray(), keys)
        }
      }, 250)
    }

    gl.domElement.addEventListener('pointermove', onPointerMove, { passive: true, capture: true })
    gl.domElement.addEventListener('pointerdown', onPointerDown, { passive: true, capture: true })
    gl.domElement.addEventListener('pointerup', onPointerUp, { passive: true, capture: true })
    gl.domElement.addEventListener('pointercancel', onCancel, { passive: true, capture: true })
    gl.domElement.addEventListener('pointerenter', onPointerMove, { passive: true, capture: true })
    gl.domElement.addEventListener('pointerleave', onPointerMove, { passive: true, capture: true })
    gl.domElement.addEventListener('wheel', onWheel, { passive: true, capture: true })
    return () => {
      gl.domElement.removeEventListener('pointermove', onPointerMove)
      gl.domElement.removeEventListener('pointerdown', onPointerDown)
      gl.domElement.removeEventListener('pointerup', onPointerUp)
      gl.domElement.removeEventListener('pointercancel', onCancel)
      gl.domElement.removeEventListener('pointerenter', onPointerMove)
      gl.domElement.removeEventListener('pointerleave', onPointerMove)
      gl.domElement.removeEventListener('wheel', onWheel)
    }
  }, [gl, pointer, camera, scene, checkOnMove, checkOnClick, eventState])

  // dispose
  useEffect(() => {
    return () => {
      eventState.current = null
      eventState.previous = null
      eventState.listeners.clear()
      eventState.pickingHelper.dispose()
      eventState.pickingMaterials.pool.splice(0, eventState.pickingMaterials.pool.length)
    }
  }, [eventState])

  // useFrame(() => {
  //   gl.domElement.style.cursor = eventState.current ? 'pointer' : ''
  // })
  return (
    <EventEmitterContext.Provider value={context}>
      {children}
    </EventEmitterContext.Provider>
  )
}