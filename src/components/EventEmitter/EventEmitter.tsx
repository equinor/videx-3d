import { ReactNode, useCallback, useEffect, useMemo } from 'react'
import { BufferGeometry, Material, Object3D, PerspectiveCamera } from 'three'
import { Vec2, Vec3 } from '../../sdk'
import { EventEmitterContext, EventEmitterContextProps, KeysPressed, Listener } from './EventEmitterContext'

import { useFrame, useThree } from '@react-three/fiber'
import { PickingHelper, PickResult } from './picking-helper'

const CLICK_SPEED = 300
const MOVE_THRESHOLD = 10

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
  autoUpdate?: boolean
  autoUpdateRenderPriority?: number
  threshold?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10,
  onResult?: EmitterCallback
  children?: ReactNode
}

export type RenderableObject = Object3D & { material: Material, geometry: BufferGeometry }

type EventState = {
  currentResult: PickResult
  buttonDown: boolean
  busy: boolean
  keys: KeysPressed
  deltaTime: number
  posX: number
  posY: number
  pickingHelper: PickingHelper
}

export const EventEmitter = ({
  autoUpdate = true,
  autoUpdateRenderPriority,
  threshold,
  children
}: EventEmitterProps) => {
  const { gl, camera, scene, pointer } = useThree()

  const eventState = useMemo<EventState>(() => ({
    busy: false,
    currentResult: {
      match: null,
      point: [0, 0],
      position: [0, 0, 0]
    },
    buttonDown: false,
    keys: {
      altKey: false,
      shiftKey: false,
      ctrlKey: false
    },
    posX: -1,
    posY: -1,
    deltaTime: 0,
    pickingHelper: Number.isFinite(threshold) ? new PickingHelper({ radius: threshold }) : new PickingHelper(),
  }), [threshold])

  const pickResultHandler = useCallback((result: PickResult) => {
    const { pickingHelper, currentResult, keys } = eventState

    const current = result.match
    const previous = currentResult.match

    // pointer leave check
    if (
      previous &&
      (!current ||
        current.emitter.listener !== previous.emitter.listener ||
        (current.emitter.listener === previous.emitter.listener &&
          current.emitter.instanced &&
          current.index !== previous.index))
    ) {
      const listener = pickingHelper.getListener(previous.emitter.listener)
      if (listener && listener.handlers.leave) {
        listener.handlers.leave({
          target: listener.object,
          source: previous.emitter.source,
          ref: listener.ref,
          instanceIndex: previous.index,
          pointer: result.point,
          position: result.position,
          keys,
          camera,
          domElement: gl.domElement,
        })
      }
    }

    if (current) {
      const listener = pickingHelper.getListener(current.emitter.listener)
      // pointer enter check
      if (
        !previous ||
        current.emitter.listener !== previous.emitter.listener ||
        (current.emitter.listener === previous.emitter.listener &&
          current.emitter.instanced &&
          current.index !== previous.index)
      ) {
        const listener = pickingHelper.getListener(current.emitter.listener)
        if (listener && listener.handlers.enter) {
          listener.handlers.enter({
            target: listener.object,
            source: current.emitter.source,
            ref: listener.ref,
            instanceIndex: current.index,
            pointer: result.point,
            position: result.position,
            keys,
            camera,
            domElement: gl.domElement,
          })
        }
      }

      // pointer move check
      if (listener && listener.handlers.move) {
        listener.handlers.move({
          target: listener.object,
          source: current.emitter.source,
          ref: listener.ref,
          instanceIndex: current.index,
          pointer: result.point,
          position: result.position,
          keys,
          camera,
          domElement: gl.domElement,
        })
      }
    }

    eventState.currentResult = result

  }, [eventState, gl, camera])

  const checkOnClick = useCallback(() => {
    const current = eventState.currentResult.match

    if (current) {
      const listener = eventState.pickingHelper.getListener(current.emitter.listener)
      if (listener && listener.handlers.click) {
        listener.handlers.click({
          target: listener.object,
          source: current.emitter.source,
          ref: listener.ref,
          instanceIndex: current.index,
          pointer: eventState.currentResult.point,
          position: eventState.currentResult.position,
          keys: eventState.keys,
          camera,
          domElement: gl.domElement,
        })
      }
    }
  }, [eventState, gl, camera])

  const update = useCallback(() => {
    if (eventState?.pickingHelper && !eventState.busy && !eventState.buttonDown) {
      eventState.busy = true
      eventState.pickingHelper.updateListeners()
      eventState.pickingHelper.render(pointer, gl, scene, camera as PerspectiveCamera)
        .then(pickResultHandler)
        .finally(() => eventState.busy = false)
    }

  }, [gl, camera, scene, pointer, eventState, pickResultHandler])

  const context = useMemo<EventEmitterContextProps>(() => {
    return {
      register: (listener: Listener) => {
        if (!listener?.object) throw Error('Unable to register event listener without an object reference!')
        const id = listener.object.id
        eventState.pickingHelper.addListener(listener)
        return () => {
          eventState.pickingHelper.removeListener(id)
        }
      },
      update
    }
  }, [eventState, update])

  // dispose
  useEffect(() => {
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
        const wasDown = eventState.buttonDown
        eventState.buttonDown = false
        if (
          wasDown &&
          time - eventState.deltaTime < CLICK_SPEED &&
          Math.abs(event.pageX - eventState.posX) < MOVE_THRESHOLD &&
          Math.abs(event.pageY - eventState.posY) < MOVE_THRESHOLD
        ) {
          checkOnClick()
        }
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      eventState.keys.shiftKey = event.shiftKey
      eventState.keys.ctrlKey = event.ctrlKey
      eventState.keys.altKey = event.altKey
    }

    function onPointerLeave() {
      setTimeout(() => {
        pickResultHandler({ match: null, point: [0, 0], position: [0, 0, 0] })
      }, 60)
    }

    addEventListener('keydown', onKeyDown, { passive: true, capture: true })
    addEventListener('keyup', onKeyDown, { passive: true, capture: true })

    gl.domElement.addEventListener('pointerdown', onPointerDown, { passive: true, capture: true })
    gl.domElement.addEventListener('pointerup', onPointerUp, { passive: true, capture: true })
    gl.domElement.addEventListener('pointerleave', onPointerLeave, { passive: true, capture: true })

    return () => {
      removeEventListener('keydown', onKeyDown)
      removeEventListener('keyup', onKeyDown)

      gl.domElement.removeEventListener('pointerdown', onPointerDown)
      gl.domElement.removeEventListener('pointerup', onPointerUp)
      gl.domElement.removeEventListener('pointerleave', onPointerLeave)

      eventState.pickingHelper.dispose()
    }
  }, [eventState, gl, checkOnClick, pickResultHandler])

  useFrame(() => {
    if (autoUpdate) {
      update()
    }
  }, autoUpdateRenderPriority)

  return (
    <EventEmitterContext.Provider value={context}>
      {children}
    </EventEmitterContext.Provider>
  )
}