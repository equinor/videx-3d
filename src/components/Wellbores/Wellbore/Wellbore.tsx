import { ReactNode, useEffect, useMemo, useRef } from 'react'
import { WellboreContext } from './WellboreContext'
import { Object3D, Vector3 } from 'three'

import { WellboreAddedEvent, WellboreRemovedEvent } from '../../../events/wellbore-events'
import { Vec3 } from '../../../sdk/types/common'
import { PointerEvents } from '../../../events/interaction-events'
import { EventEmitterCallback, useEventEmitter } from '../../Handlers/EventEmitter/EventEmitterContext'

/**
 * Wellbore props
 * @expand
 */
export type WellboreProps = {
  id: string,
  fromMsl?: number,
  segmentsPerMeter?: number,
  simplificationThreshold?: number,
  position?: Vec3,
  visible?: boolean,
  children?: ReactNode,
} & PointerEvents

const vec = new Vector3()

/**
 * The `Wellbore` component serves as a provider/container component only. It does not visualize anything alone!  
 * Visualization components, such as the `BasicTrajectory`, `TubeTrajectory`, `Casings`, `CompletionTools` etc. must be
 * added as child components, which will get the data needed from the `WellboreContext` provided this component.
 * 
 * @example
 * <Wellbore id={wellboreId}>
 *  <BasicTrajectory color="red" />
 * </Wellbore>
 * 
 * @see {@link WellboreContext}
 * @see {@link BasicTrajectory}
 * @see {@link TubeTrajectory}
 * @see {@link Casings}
 * @see {@link CasingAnnotations}
 * @see {@link CompletionTools}
 * @see {@link CompletionAnnotations}
 * @see {@link DepthMarkers}
 * @see {@link Perforations}
 * @see {@link Perimeter}
 * @see {@link Picks}
 * @see {@link Shoes}
 * @see {@link WellboreBounds}
 * @see {@link WellboreLabel}
 * 
 * @group Components
 */
export const Wellbore = ({
  id,
  fromMsl,
  segmentsPerMeter = 0.1,
  simplificationThreshold = 0,
  position = [0, 0, 0],
  visible = true,
  onPointerClick,
  onPointerEnter,
  onPointerLeave,
  onPointerMove,
  children,
}: WellboreProps) => {
  const wellboreRef = useRef<Object3D>(null!)
  const wellboreContext = useMemo(() => {
    return {
      id,
      fromMsl,
      segmentsPerMeter,
      simplificationThreshold,
    }
  }, [fromMsl, id, segmentsPerMeter, simplificationThreshold])

  const eventHandler = useEventEmitter()

  // register event handlers
  useEffect(() => {
    let unregister: (() => void) | null = null
    if (eventHandler) {
      const handlers: Record<string, EventEmitterCallback> = {}

      if (onPointerClick) handlers.click = onPointerClick
      if (onPointerEnter) handlers.enter = onPointerEnter
      if (onPointerLeave) handlers.leave = onPointerLeave
      if (onPointerMove) handlers.move = onPointerMove

      if (Object.keys(handlers).length) {
        unregister = eventHandler.register(wellboreRef.current, handlers, id)
      }
    }

    return () => {
      if (unregister) unregister()
    }
  }, [eventHandler, onPointerClick, onPointerEnter, onPointerLeave, onPointerMove, id])

  useEffect(() => {
    wellboreRef.current.getWorldPosition(vec)
    dispatchEvent(new WellboreAddedEvent({
      id,
      position: vec.toArray() as Vec3,
      objectId: wellboreRef.current.id,
      objectUuid: wellboreRef.current.uuid,
    }))

    return () => {
      dispatchEvent(new WellboreRemovedEvent({ id }))
    }
  }, [id])

  return (
    <WellboreContext.Provider value={wellboreContext}>
      <object3D position={position} visible={visible} ref={wellboreRef}>
        {children}
      </object3D>
    </WellboreContext.Provider>
  )
}
