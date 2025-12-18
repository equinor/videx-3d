import { useFrame, useThree } from '@react-three/fiber'
import { ReactNode, useCallback, useEffect, useMemo } from 'react'
import { BufferGeometry, Color, InstancedBufferAttribute, InstancedMesh, Material, MeshBasicMaterial, Object3D, PerspectiveCamera, SRGBColorSpace } from 'three'
import { LAYERS } from '../../../main'
import { Vec2, Vec3 } from '../../../sdk'
import { EventEmitterContext, EventEmitterContextProps, KeysPressed, Listener } from './EventEmitterContext'
import { PickingHelper, PickResult } from './picking-helper'

const CLICK_SPEED = 300
const MOVE_THRESHOLD = 10

const color = new Color()

export type EmitterResultEvent = {
  offset: Vec2 | null
  match: RenderableObject | undefined
  instanced?: boolean
  instanceIndex?: number
  position: Vec3 | null
}
export type EmitterCallback = (e: EmitterResultEvent) => void

/**
 * EventEmitter props
 * @expand
 */
export type EventEmitterProps = {
  threshold?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10,
  onResult?: EmitterCallback
  children?: ReactNode
}

export type RenderableObject = Object3D & { material: Material, geometry: BufferGeometry }

export type PickingMaterial = Material & {
  color: Color
}

export type Emitter = {
  source?: RenderableObject
  depth: number
  material: PickingMaterial
  sourceMaterial?: Material
  indices: number[]
  listener: number
  instanced?: boolean
  instanceColor?: InstancedBufferAttribute
  sourceInstanceColor?: InstancedBufferAttribute | undefined
  threshold: number
}

export type ObjectMapEntry = {
  emitter: Emitter
  index?: number
}

type EventState = {
  prevResult: PickResult,
  current: ObjectMapEntry | null
  buttonDown: boolean
  deltaTime: number
  posX: number
  posY: number
  pickingHelper: PickingHelper
  emitters: Map<number, Emitter>
  listeners: Map<number, Listener>
  needCheckOnMove: boolean
  objectMap: Map<number, ObjectMapEntry>
  emitterPool: Emitter[]
  emitterIndex: number
  indexPool: number[]
}

function traverseObject(
  object: Object3D,
  eventState: EventState,
  rootId: number,
  threshold: number = 0,
  depth: number
) {
  if (object.visible && !object.layers.isEnabled(LAYERS.NOT_EMITTER)) {
    if (object.type === 'Mesh' || object.type === 'Line' || object.type === 'Points') {
      if (!eventState.emitters.has(object.id)) {
        const source = object as RenderableObject
        const emitterThreshold = Number.isFinite(threshold) ? threshold : (object.type === 'Mesh' ? 0 : 3)
        const instanced = (object as InstancedMesh).isInstancedMesh

        if (!instanced || (instanced && (object as InstancedMesh).count > 0)) {
          let emitter = eventState.emitterPool.pop()
          if (!emitter) {
            emitter = {
              material: new MeshBasicMaterial(),
              depth,
              listener: -1,
              threshold: 0,
              indices: []
            }
          }

          emitter.listener = rootId
          emitter.source = source
          emitter.depth = depth
          emitter.threshold = emitterThreshold
          emitter.instanced = instanced

          if (instanced) {
            const instancedObject = object as InstancedMesh
            emitter.instanceColor = new InstancedBufferAttribute(new Float32Array(instancedObject.count * 3), 3)
            emitter.material.color.set(0xffffff)
            for (let i = 0; i < instancedObject.count; i++) {
              const index = eventState.indexPool.pop() || (++eventState.emitterIndex)
              emitter.indices.push(index)
              eventState.objectMap.set(index, { emitter, index: i })
              color.setRGB(
                ((index >> 16) & 0xff) / 255,
                ((index >> 8) & 0xff) / 255,
                (index & 0xff) / 255,
                SRGBColorSpace
              ).toArray(emitter.instanceColor.array, i * 3)

            }
            emitter.instanceColor.needsUpdate = true
          } else {
            const index = eventState.indexPool.pop() || (++eventState.emitterIndex)
            emitter.material.color.setRGB(
              ((index >> 16) & 0xff) / 255,
              ((index >> 8) & 0xff) / 255,
              (index & 0xff) / 255,
              SRGBColorSpace
            )
            emitter.indices.push(index)
            eventState.objectMap.set(index, { emitter })
          }
          emitter.material.side = source.material.side
          eventState.emitters.set(object.id, emitter)

          object.layers.enable(LAYERS.EMITTER)
        }
      } else {
        const emitter = eventState.emitters.get(object.id)
        if (emitter && depth > emitter.depth) {
          emitter.depth = depth
          emitter.listener = rootId
        }
      }
    }

    for (let i = 0; i < object.children.length; i++) {
      traverseObject(object.children[i], eventState, rootId, threshold, depth + 1)
    }
  }
}

// Needed because child objects may not be in the scene when the listener is registered.
// This ensures that any missing objects are traversed and any missing emitters are created.
const updateListeners = (eventState: EventState) => {
  //console.time('updateListeners')
  eventState.listeners.forEach(listener => traverseObject(listener.object, eventState, listener.object.id, listener.threshold, 0))
  //console.timeEnd('updateListeners')
}

const addListener = (listener: Listener, eventState: EventState) => {
  if (listener.handlers.enter || listener.handlers.leave || listener.handlers.move) {
    eventState.needCheckOnMove = true
  }
  eventState.listeners.set(listener.object.id, listener)
  traverseObject(listener.object, eventState, listener.object.id, listener.threshold, 0)
}

const removeListener = (id: number, eventState: EventState) => {
  const listener = eventState.listeners.get(id)
  if (listener) {
    const { object } = listener
    // clear and put all emitters into pool for re-use
    eventState.emitters.forEach((emitter, objId) => {
      if (emitter.listener === id) {
        emitter.indices.forEach(index => {
          // remove link from object map and add to pool
          eventState.objectMap.delete(index)
          eventState.indexPool.push(index)
        })
        eventState.emitters.delete(objId)
        if (emitter.sourceMaterial && emitter.source) {
          emitter.source.material = emitter.sourceMaterial
        }
        if (emitter.sourceInstanceColor && emitter.source) {
          const instanceMesh = emitter.source as InstancedMesh
          instanceMesh.instanceColor = emitter.sourceInstanceColor || null
        }
        emitter.listener = -1
        emitter.indices = []
        emitter.depth = 0
        emitter.threshold = 0
        emitter.instanced = false
        emitter.instanceColor = undefined
        emitter.source = undefined
        emitter.sourceMaterial = undefined

        eventState.emitterPool.push(emitter)
      }
    })

    object.traverse(obj => obj.layers.disable(LAYERS.EMITTER))
    eventState.listeners.delete(id)
  }
}

export const EventEmitter = ({
  threshold,
  onResult,
  children
}: EventEmitterProps) => {
  const pointer = useThree(state => state.pointer)
  const camera = useThree(state => state.camera)
  const gl = useThree(state => state.gl)
  const scene = useThree(state => state.scene)

  const eventState = useMemo<EventState>(() => ({
    prevResult: false,
    current: null,
    buttonDown: false,
    needCheckOnMove: false,
    posX: -1,
    posY: -1,
    deltaTime: 0,
    pickingHelper: Number.isFinite(threshold) ? new PickingHelper({ radius: threshold }) : new PickingHelper(),
    emitters: new Map(),
    listeners: new Map(),
    objectMap: new Map(),
    pickingMaterials: { index: 0, pool: [] },
    emitterPool: [],
    emitterIndex: 0,
    indexPool: []
  }), [
    threshold
  ])

  const context = useMemo<EventEmitterContextProps>(() => {
    const queue = new Set<number>()
    return {
      register: (listener: Listener) => {
        if (!listener?.object) throw Error('Unable to register event listener without an object reference!')
        const id = listener.object.id
        queue.add(id)
        // delay registering of event listener
        setTimeout(() => {
          if (queue.has(id)) {
            queue.delete(id)
            addListener(listener, eventState)
          }
        }, 250)

        return () => {
          removeListener(id, eventState)
        }
      }
    }
  }, [eventState])

  const checkOnClick = useCallback(async (keys: KeysPressed) => {
    const {
      objectMap,
      pickingHelper,
    } = eventState

    // if there's already a valid result from the "checkOnMove" function, we can reuse it for the click event
    const result = eventState.prevResult && eventState.prevResult.match ? eventState.prevResult : pickingHelper.pick(
      camera as PerspectiveCamera,
      objectMap,
    )

    if (result && onResult) {
      requestAnimationFrame(() => onResult({
        offset: result.offset,
        match: result.match?.emitter.source,
        instanced: result.match?.emitter.instanced,
        instanceIndex: result.match?.index,
        position: result.position
      }))
    }
    if (result && result.match && result.position) {
      const picked = result.match
      const listener = eventState.listeners.get(picked.emitter.listener)

      if (listener && listener.handlers.click && picked.emitter.source) {
        const clickEvent = {
          position: result.position,
          target: listener.object,
          source: picked.emitter.source,
          ref: listener.ref,
          instanceIndex: picked.index,
          keys,
          pointer: result.point,
          camera,
          domElement: gl.domElement
        }
        requestAnimationFrame(() => listener.handlers.click(clickEvent))
      }
    }
  }, [eventState, onResult, gl, camera])

  const checkOnMove = useCallback(async (keys: KeysPressed) => {
    const result = eventState.pickingHelper.pick(
      camera as PerspectiveCamera,
      eventState.objectMap,
    )

    if (!result) return // aborted

    eventState.prevResult = result // save to state to resuse in a click event if exist

    if (onResult) {
      requestAnimationFrame(() => onResult({
        offset: result.offset,
        match: result.match?.emitter.source,
        instanced: result.match?.emitter.instanced,
        instanceIndex: result.match?.index,
        position: result.position
      }))
    }

    const previous = eventState.current
    eventState.current = result.position ? result.match : null

    // Determine pointer leave event
    if (previous &&
      (!eventState.current ||
        (eventState.current.emitter.listener !== previous.emitter.listener) ||
        (eventState.current.emitter.listener === previous.emitter.listener && Number.isFinite(previous.index) && Number.isFinite(eventState.current.index) && eventState.current.index !== previous.index)
      )
    ) {
      const listener = eventState.listeners.get(previous.emitter.listener)
      if (listener && listener.handlers.leave && previous.emitter.source) {
        const leaveEvent = {
          target: listener.object,
          source: previous.emitter.source,
          ref: listener.ref,
          instanceIndex: previous.index,
          keys,
          pointer: result.point,
          camera: camera,
          domElement: gl.domElement
        }
        requestAnimationFrame(() => listener.handlers.leave(leaveEvent))
      }
    }

    // Determine pointer enter event
    if (eventState.current && result.position &&
      (!previous ||
        (eventState.current.emitter.listener !== previous.emitter.listener) ||
        (eventState.current.emitter.listener === previous.emitter.listener && Number.isFinite(previous.index) && Number.isFinite(eventState.current.index) && eventState.current.index !== previous.index)
      )
    ) {
      const listener = eventState.listeners.get(eventState.current.emitter.listener)
      if (listener && listener.handlers.enter && eventState.current.emitter.source) {
        const enterEvent = {
          target: listener.object,
          source: eventState.current.emitter.source,
          ref: listener.ref,
          instanceIndex: eventState.current.index,
          keys,
          pointer: result.point,
          camera: camera,
          domElement: gl.domElement
        }
        requestAnimationFrame(() => listener.handlers.enter(enterEvent))
      }
    }

    // Determine pointer move event
    if (eventState.current && result.position) {
      const listener = eventState.listeners.get(eventState.current.emitter.listener)
      if (listener && listener.handlers.move && eventState.current.emitter.source) {
        const moveEvent = {
          target: listener.object,
          source: eventState.current.emitter.source,
          ref: listener.ref,
          instanceIndex: eventState.current.index,
          position: result.position,
          keys,
          pointer: result.point,
          camera: camera,
          domElement: gl.domElement
        }
        requestAnimationFrame(() => listener.handlers.move(moveEvent))
      }
    }
  }, [eventState, onResult, gl, camera])

  useFrame(() => {
    const point = pointer.toArray()
    eventState.pickingHelper.render(
      point,
      gl,
      scene,
      camera as PerspectiveCamera,
      eventState.emitters,
    )
  })

  useEffect(() => {
    const ref = setInterval(() => {
      updateListeners(eventState)
    }, 1000)
    return () => {
      clearInterval(ref)
    }
  }, [eventState])

  useEffect(() => {
    function onPointerMove(event: PointerEvent) {
      const keys: KeysPressed = {
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
      }

      if (eventState.needCheckOnMove && !eventState.buttonDown) {
        checkOnMove(keys)
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
          checkOnClick(keys)
        }
        eventState.buttonDown = false
      }
    }
    let scrollCheck: any = undefined

    function onWheel(event: WheelEvent) {
      const keys: KeysPressed = {
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
      }
      clearTimeout(scrollCheck)
      scrollCheck = setTimeout(() => {
        if (eventState.needCheckOnMove && !eventState.buttonDown) {
          checkOnMove(keys)
        }
      }, 250)
    }

    function onCancel() {
      if (eventState.current) {
        const listener = eventState.listeners.get(eventState.current.emitter.listener)
        if (listener && listener.handlers.leave && eventState.current.emitter.source) {
          listener.handlers.leave({
            target: listener.object,
            source: eventState.current.emitter.source,
            ref: listener.ref,
            instanceIndex: eventState.current.index,
            keys: {
              ctrlKey: false,
              shiftKey: false,
              altKey: false,
            },
            pointer: [0, 0],
            camera,
            domElement: gl.domElement
          })
        }
        eventState.current = null
      }
      eventState.buttonDown = false
    }

    gl.domElement.addEventListener('pointermove', onPointerMove, { passive: true, capture: true })
    gl.domElement.addEventListener('pointerdown', onPointerDown, { passive: true, capture: true })
    gl.domElement.addEventListener('pointerup', onPointerUp, { passive: true, capture: true })
    gl.domElement.addEventListener('wheel', onWheel, { passive: true, capture: true })
    gl.domElement.addEventListener('pointerleave', onCancel, { passive: true, capture: true })
    return () => {
      gl.domElement.removeEventListener('pointermove', onPointerMove)
      gl.domElement.removeEventListener('pointerdown', onPointerDown)
      gl.domElement.removeEventListener('pointerup', onPointerUp)
      gl.domElement.removeEventListener('wheel', onWheel)
      gl.domElement.removeEventListener('pointerleave', onCancel)
    }
  }, [eventState, checkOnMove, checkOnClick, gl, camera])

  // dispose
  useEffect(() => {
    return () => {
      eventState.current = null
      eventState.listeners.clear()
      eventState.pickingHelper.dispose()
    }
  }, [eventState])

  return (
    <EventEmitterContext.Provider value={context}>
      {children}
    </EventEmitterContext.Provider>
  )
}