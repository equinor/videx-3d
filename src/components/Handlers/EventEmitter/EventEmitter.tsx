import { useThree } from '@react-three/fiber'
import { ReactNode, useCallback, useEffect, useMemo } from 'react'
import { BufferGeometry, Color, InstancedBufferAttribute, InstancedMesh, Material, MeshBasicMaterial, Object3D, PerspectiveCamera, Scene, Vector2, WebGLRenderer } from 'three'
import { LAYERS } from '../../../main'
import { idToHexColor, Vec2, Vec3 } from '../../../sdk'
import { EventEmitterCallback, EventEmitterContext, EventEmitterContextProps, KeysPressed, Listener } from './EventEmitterContext'
import { PickingHelper } from './picking-helper'

const CLICK_SPEED = 300
const MOVE_THRESHOLD = 10

const color = new Color()

export type EmitterResultEvent = {
  offset: Vec2 | null
  match: RenderableObject | undefined
  instanced?: boolean
  instanceIndex?: number
  position: Promise<Vec3> | null
}
export type EmitterCallback = (e: EmitterResultEvent) => void

/**
 * EventEmitter props
 * @expand
 */
export type EventEmitterProps = {
  threshold?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10,
  children?: ReactNode
  onResult?: EmitterCallback
}

export type RenderableObject = Object3D & { material: Material, geometry: BufferGeometry }

export type Emitter = {
  source: RenderableObject,
  depth: number,
  material: Material,
  listener: number,
  instanced?: boolean,
  instanceColor?: Float32Array,
  threshold: number
}

export type ObjectMapEntry = {
  emitter: Emitter,
  index?: number,
}

export type ObjectMap = {
  map: Map<number, ObjectMapEntry>,
  index: number,
}

type PickingMaterials = { pool: MeshBasicMaterial[], index: number }

type EventState = {
  current: ObjectMapEntry | null
  buttonDown: boolean
  deltaTime: number
  posX: number
  posY: number
  pickingHelper: PickingHelper
  emitters: Map<number, Emitter>
  listeners: Map<number, Listener>
  needCheckOnMove: boolean
  pickingMaterials: PickingMaterials
  objectMap: ObjectMap
  gl: WebGLRenderer
  scene: Scene
  camera: PerspectiveCamera
  pointer: Vector2
}

function processObject(object: Object3D, eventState: EventState, rootId: number, threshold: number = 0, depth: number) {
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
          listener: null!,
          threshold: Number.isFinite(threshold) ? threshold : (object.type === 'Mesh' ? 0 : 3)
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
            color.set(idToHexColor(id)).toArray(emitter.instanceColor, i * 3)
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
      processObject(object.children[i], eventState, rootId, threshold, depth + 1)
    }
  }
}

const buildEmitterMap = (eventState: EventState) => {
  eventState.emitters = new Map()
  eventState.objectMap = {
    map: new Map(),
    index: 1,
  }
  eventState.pickingMaterials.index = 0
  eventState.listeners.forEach(listener => processObject(listener.object, eventState, listener.object.id, listener.threshold, 0))
}

export const EventEmitter = ({
  threshold,
  onResult,
  children
}: EventEmitterProps) => {
  const { gl, camera, scene, pointer } = useThree()

  const eventState = useMemo<EventState>(() => ({
    current: null,
    buttonDown: false,
    needCheckOnMove: false,
    posX: -1,
    posY: -1,
    deltaTime: 0,
    pickingHelper: Number.isFinite(threshold) ? new PickingHelper({ radius: threshold }) : new PickingHelper(),
    emitters: new Map(),
    listeners: new Map(),
    objectMap: { map: new Map(), index: 0 },
    pickingMaterials: { index: 0, pool: [] },
    gl,
    scene,
    camera: camera as PerspectiveCamera,
    pointer
  }), [
    threshold,
    gl,
    scene,
    camera,
    pointer,
  ])

  const context = useMemo<EventEmitterContextProps>(() => {
    return {
      register: (obj: Object3D, handlers: Record<string, EventEmitterCallback>, ref?: any, threshold?: number) => {
        eventState.listeners.set(obj.id, { object: obj, handlers, ref, threshold })
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

  const checkOnClick = useCallback(async (keys: KeysPressed) => {
    buildEmitterMap(eventState)
    const {
      gl,
      scene,
      camera,
      pointer,
      emitters,
      objectMap,
      pickingHelper,
    } = eventState

    const point = pointer.toArray()
    const result = await pickingHelper.pick(
      point,
      gl,
      scene,
      camera,
      emitters,
      objectMap,
      true,
    )

    if (result && onResult) {
      onResult({
        offset: result.offset,
        match: result.match?.emitter.source,
        instanced: result.match?.emitter.instanced,
        instanceIndex: result.match?.index,
        position: result.position
      })
    }
    if (result && result.match && result.position) {
      const picked = result.match
      const listener = eventState.listeners.get(picked.emitter.listener)

      if (listener && listener.handlers.click) {
        listener.handlers.click({
          position: await result.position,
          target: listener.object,
          source: picked.emitter.source,
          ref: listener.ref,
          instanceIndex: picked.index,
          keys,
          pointer: point,
          camera,
          domElement: gl.domElement
        })
      }
    }
  }, [eventState, onResult])

  const checkOnMove = useCallback(async (keys: KeysPressed) => {
    buildEmitterMap(eventState)

    const point = eventState.pointer.toArray()
    //console.time('pick')
    const result = await eventState.pickingHelper.pick(
      point,
      eventState.gl,
      eventState.scene,
      eventState.camera,
      eventState.emitters,
      eventState.objectMap,
      false,
    )
    //console.timeEnd('pick')
    if (!result) return // aborted

    if (onResult) {
      onResult({
        offset: result.offset,
        match: result.match?.emitter.source,
        instanced: result.match?.emitter.instanced,
        instanceIndex: result.match?.index,
        position: result.position
      })
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
      if (listener && listener.handlers.leave) {
        listener.handlers.leave({
          target: listener.object,
          source: previous.emitter.source,
          ref: listener.ref,
          instanceIndex: previous.index,
          keys,
          pointer: point,
          camera: eventState.camera,
          domElement: eventState.gl.domElement
        })
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
      if (listener && listener.handlers.enter) {
        listener.handlers.enter({
          target: listener.object,
          source: eventState.current.emitter.source,
          ref: listener.ref,
          instanceIndex: eventState.current.index,
          keys,
          pointer: point,
          camera: eventState.camera,
          domElement: eventState.gl.domElement
        })
      }
    }

    // Determine pointer move event
    if (eventState.current) {
      const listener = eventState.listeners.get(eventState.current.emitter.listener)
      if (listener && listener.handlers.move) {
        const source = eventState.current.emitter.source
        const instanceIndex = eventState.current.index
        listener.handlers.move({
          target: listener.object,
          source,
          ref: listener.ref,
          instanceIndex,
          position: await result.position!,
          keys,
          pointer: point,
          camera: eventState.camera,
          domElement: eventState.gl.domElement
        })
      }
    }

  }, [eventState, onResult])

  useEffect(() => {
    const { gl } = eventState
    let debounce: any = undefined
    function onPointerMove(event: PointerEvent) {
      clearTimeout(debounce)
      const keys: KeysPressed = {
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
      }
      debounce = setTimeout(() => {
        if (eventState.needCheckOnMove && !eventState.buttonDown) {
          checkOnMove(keys)//.finally(() => console.timeEnd('move'))
        }
      }, 1)
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
        if (listener && listener.handlers.leave) {
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
            camera: eventState.camera,
            domElement: gl.domElement
          })
        }
        eventState.current = null
      }
      eventState.buttonDown = false
    }

    gl?.domElement.addEventListener('pointermove', onPointerMove, { passive: true, capture: true })
    gl?.domElement.addEventListener('pointerdown', onPointerDown, { passive: true, capture: true })
    gl?.domElement.addEventListener('pointerup', onPointerUp, { passive: true, capture: true })
    gl?.domElement.addEventListener('wheel', onWheel, { passive: true, capture: true })
    gl?.domElement.addEventListener('pointercancel', onCancel, { passive: true, capture: true })
    gl?.domElement.addEventListener('pointerleave', onCancel, { passive: true, capture: true })
    return () => {
      gl?.domElement.removeEventListener('pointermove', onPointerMove)
      gl?.domElement.removeEventListener('pointerdown', onPointerDown)
      gl?.domElement.removeEventListener('pointerup', onPointerUp)
      gl?.domElement.removeEventListener('wheel', onWheel)
      gl?.domElement.removeEventListener('pointercancel', onCancel)
      gl?.domElement.removeEventListener('pointerleave', onPointerMove)
    }
  }, [eventState, checkOnMove, checkOnClick])

  // dispose
  useEffect(() => {
    return () => {
      eventState.current = null
      eventState.listeners.clear()
      eventState.pickingHelper.dispose()
      eventState.pickingMaterials.pool.splice(0, eventState.pickingMaterials.pool.length)
    }
  }, [eventState])

  return (
    <EventEmitterContext.Provider value={context}>
      {children}
    </EventEmitterContext.Provider>
  )
}