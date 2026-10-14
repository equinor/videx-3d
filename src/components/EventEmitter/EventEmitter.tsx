import { ReactNode, useCallback, useEffect, useMemo } from 'react';
import { BufferGeometry, Material, Object3D, PerspectiveCamera } from 'three';
import {
  EventEmitterContext,
  EventEmitterContextProps,
  KeysPressed,
  Listener,
} from './EventEmitterContext';

import { useFrame, useThree } from '@react-three/fiber';
import {
  createPickSchedule,
  markPicked,
  markRead,
  observeCamera,
  PickSchedule,
  pickDue,
} from './pick-schedule';
import { PickingHelper, PickResult } from './picking-helper';

const CLICK_SPEED = 300;
const MOVE_THRESHOLD = 10;

export type EmitterCallback = (e: PickResult) => void;

/**
 * EventEmitter props
 * @expand
 */
export type EventEmitterProps = {
  /**
   * Check every frame whether to pick (default `true`). A pick runs only while a
   * listener is registered and the pointer is over the canvas, once the previous
   * one is read back and four times its read back has passed (a read back waits
   * for the GPU), and only when the pointer or the listeners changed since, the
   * camera did and has stopped, or `update()` from the context asked for one.
   * With `false`, `update()` picks at once instead.
   */
  autoUpdate?: boolean;
  autoUpdateRenderPriority?: number;
  threshold?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
  onResult?: EmitterCallback;
  children?: ReactNode;
};

export type RenderableObject = Object3D & {
  material: Material;
  geometry: BufferGeometry;
};

type EventState = {
  currentResult: PickResult;
  buttonDown: boolean;
  busy: boolean;
  /** the pointer is over the canvas */
  over: boolean;
  schedule: PickSchedule;
  keys: KeysPressed;
  deltaTime: number;
  posX: number;
  posY: number;
  button: number;
  pickingHelper: PickingHelper;
};

export const EventEmitter = ({
  autoUpdate = true,
  autoUpdateRenderPriority,
  threshold,
  onResult,
  children,
}: EventEmitterProps) => {
  const { gl, camera, scene, pointer } = useThree();

  const eventState = useMemo<EventState>(
    () => ({
      busy: false,
      over: false,
      schedule: createPickSchedule(),
      currentResult: {
        match: null,
        point: [0, 0],
        position: [0, 0, 0],
      },
      buttonDown: false,
      keys: {
        altKey: false,
        shiftKey: false,
        ctrlKey: false,
      },
      posX: -1,
      posY: -1,
      button: -1,
      deltaTime: 0,
      pickingHelper: Number.isFinite(threshold)
        ? new PickingHelper({ radius: threshold })
        : new PickingHelper(),
    }),
    [threshold],
  );

  const pickResultHandler = useCallback(
    (result: PickResult) => {
      const { pickingHelper, currentResult, keys } = eventState;

      const current = result.match;
      const previous = currentResult.match;
      const prevPoint = currentResult.point;

      // pointer leave check
      if (
        previous &&
        (!current ||
          current.emitter.listener !== previous.emitter.listener ||
          (current.emitter.listener === previous.emitter.listener &&
            current.emitter.instanced &&
            current.index !== previous.index))
      ) {
        const listener = pickingHelper.getListener(previous.emitter.listener);
        if (listener && listener.handlers.leave) {
          const leaveEvent = {
            target: listener.object,
            source: previous.emitter.source,
            ref: listener.ref,
            instanceIndex: previous.index,
            pointer: result.point,
            position: result.position,
            keys,
            camera,
            domElement: gl.domElement,
          };
          listener.handlers.leave(leaveEvent);
        }
      }

      if (current) {
        const listener = pickingHelper.getListener(current.emitter.listener);
        // pointer enter check
        if (
          !previous ||
          current.emitter.listener !== previous.emitter.listener ||
          (current.emitter.listener === previous.emitter.listener &&
            current.emitter.instanced &&
            current.index !== previous.index)
        ) {
          if (listener && listener.handlers.enter) {
            const enterEvent = {
              target: listener.object,
              source: current.emitter.source,
              ref: listener.ref,
              instanceIndex: current.index,
              pointer: result.point,
              position: result.position,
              keys,
              camera,
              domElement: gl.domElement,
            };
            listener.handlers.enter(enterEvent);
          }
        }

        // pointer move check
        if (
          listener &&
          listener.handlers.move &&
          (result.point[0] !== prevPoint[0] || result.point[1] !== prevPoint[1])
        ) {
          const moveEvent = {
            target: listener.object,
            source: current.emitter.source,
            ref: listener.ref,
            instanceIndex: current.index,
            pointer: result.point,
            position: result.position,
            keys,
            camera,
            domElement: gl.domElement,
          };
          listener.handlers.move(moveEvent);
        }
      }

      // result event
      if (onResult && (current !== null || previous !== null)) {
        onResult(result);
      }

      eventState.currentResult = result;
    },
    [eventState, gl, camera, onResult],
  );

  const checkOnClick = useCallback(() => {
    const current = eventState.currentResult.match;

    if (current) {
      const listener = eventState.pickingHelper.getListener(
        current.emitter.listener,
      );
      if (listener && listener.handlers.click) {
        listener.handlers.click({
          target: listener.object,
          source: current.emitter.source,
          ref: listener.ref,
          instanceIndex: current.index,
          pointer: eventState.currentResult.point,
          position: eventState.currentResult.position,
          keys: eventState.keys,
          button: eventState.button,
          camera,
          domElement: gl.domElement,
        });
      }
    }
  }, [eventState, gl, camera]);

  const pick = useCallback(() => {
    const helper = eventState.pickingHelper;
    if (
      eventState.busy ||
      eventState.buttonDown ||
      helper.listenerCount === 0
    ) {
      return;
    }
    markPicked(eventState.schedule, pointer, camera, helper.version);
    helper.updateListeners();
    eventState.busy = helper.start(
      pointer,
      gl,
      scene,
      camera as PerspectiveCamera,
    );
  }, [gl, camera, scene, pointer, eventState]);

  const update = useCallback(() => {
    eventState.schedule.requested = true;
    if (!autoUpdate) pick();
  }, [eventState, autoUpdate, pick]);

  const context = useMemo<EventEmitterContextProps>(() => {
    return {
      register: (listener: Listener) => {
        if (!listener?.object)
          throw Error(
            'Unable to register event listener without an object reference!',
          );
        const id = listener.object.id;
        eventState.pickingHelper.addListener(listener);
        return () => {
          eventState.pickingHelper.removeListener(id);
        };
      },
      update,
    };
  }, [eventState, update]);

  // wire up pointer and keyboard listeners (and dispose the picking helper on unmount)
  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (event.isPrimary) {
        eventState.buttonDown = true;
        eventState.posX = event.pageX;
        eventState.posY = event.pageY;
        eventState.button = event.button;
        eventState.deltaTime = performance.now();
      }
    }

    function onPointerUp(event: PointerEvent) {
      if (event.isPrimary) {
        const time = performance.now();
        const wasDown = eventState.buttonDown;
        eventState.buttonDown = false;
        if (
          wasDown &&
          time - eventState.deltaTime < CLICK_SPEED &&
          Math.abs(event.pageX - eventState.posX) < MOVE_THRESHOLD &&
          Math.abs(event.pageY - eventState.posY) < MOVE_THRESHOLD
        ) {
          checkOnClick();
        }
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      eventState.keys.shiftKey = event.shiftKey;
      eventState.keys.ctrlKey = event.ctrlKey;
      eventState.keys.altKey = event.altKey;
    }

    function onPointerOver() {
      eventState.over = true;
    }

    let leaving: ReturnType<typeof setTimeout> | undefined;
    function onPointerLeave() {
      eventState.over = false;
      clearTimeout(leaving);
      leaving = setTimeout(() => {
        pickResultHandler({ match: null, point: [0, 0], position: [0, 0, 0] });
      }, 60);
    }

    function onContextLost() {
      eventState.pickingHelper.contextLost();
      eventState.busy = false;
    }

    addEventListener('keydown', onKeyDown, { passive: true, capture: true });
    addEventListener('keyup', onKeyDown, { passive: true, capture: true });

    gl.domElement.addEventListener('pointerdown', onPointerDown, {
      passive: true,
      capture: true,
    });
    gl.domElement.addEventListener('pointerup', onPointerUp, {
      passive: true,
      capture: true,
    });
    gl.domElement.addEventListener('pointermove', onPointerOver, {
      passive: true,
      capture: true,
    });
    gl.domElement.addEventListener('pointerenter', onPointerOver, {
      passive: true,
      capture: true,
    });
    gl.domElement.addEventListener('pointerleave', onPointerLeave, {
      passive: true,
      capture: true,
    });
    gl.domElement.addEventListener('webglcontextlost', onContextLost);

    return () => {
      // ⚠️ `capture` is part of a listener's identity: removing without it does
      // nothing, and these keep the whole picking state (and every object it has
      // registered) alive for the life of the page.
      removeEventListener('keydown', onKeyDown, { capture: true });
      removeEventListener('keyup', onKeyDown, { capture: true });

      gl.domElement.removeEventListener('pointerdown', onPointerDown, {
        capture: true,
      });
      gl.domElement.removeEventListener('pointerup', onPointerUp, {
        capture: true,
      });
      gl.domElement.removeEventListener('pointermove', onPointerOver, {
        capture: true,
      });
      gl.domElement.removeEventListener('pointerenter', onPointerOver, {
        capture: true,
      });
      gl.domElement.removeEventListener('pointerleave', onPointerLeave, {
        capture: true,
      });
      gl.domElement.removeEventListener('webglcontextlost', onContextLost);
      clearTimeout(leaving);

      eventState.pickingHelper.dispose();
    };
  }, [eventState, gl, checkOnClick, pickResultHandler]);

  useFrame(() => {
    const helper = eventState.pickingHelper;
    const schedule = eventState.schedule;
    observeCamera(schedule, camera);
    if (eventState.busy) {
      const read = helper.poll();
      if (read === undefined) return;
      eventState.busy = false;
      if (!read) return;
      markRead(schedule, performance.now(), read.readMs);
      // Landed after the pointer left: the leave reset already ran.
      if (eventState.over) pickResultHandler(read.result);
      return;
    }
    if (!autoUpdate) return;
    if (helper.listenerCount === 0) {
      // Nothing left to tell: drop a hover whose listener is gone.
      if (eventState.currentResult.match) {
        eventState.currentResult = { ...eventState.currentResult, match: null };
      }
      return;
    }
    if (eventState.buttonDown || !eventState.over) return;
    if (!pickDue(schedule, pointer, camera, helper.version, performance.now()))
      return;
    pick();
  }, autoUpdateRenderPriority);

  return (
    <EventEmitterContext.Provider value={context}>
      {children}
    </EventEmitterContext.Provider>
  );
};
