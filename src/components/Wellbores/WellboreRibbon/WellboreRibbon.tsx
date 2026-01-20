import { PropsWithChildren, useEffect, useMemo, useState } from 'react'
import { BufferAttribute, InstancedBufferGeometry, InstancedInterleavedBuffer, InterleavedBufferAttribute } from 'three'
import { CameraFocusAtPointEvent, cameraFocusAtPointEventType, CameraSetPositionEvent, cameraSetPositionEventType, useData, useWellboreContext } from '../../../main'
import { calculateFrenetFrames, getCurvePositions, getTrajectory, PositionLog, Trajectory, Vec3 } from '../../../sdk'
import { WellboreRibbonContext, WellboreRibbonContextProps } from './WellboreRibbonContext'



function createStripeGeometry(trajectory: Trajectory, segmentsPerMeter: number, simplificationThreshold: number, fromMsl?: number) {
  const positions = new Float32Array([
    0, -0.5,
    1, -0.5,
    1, 0.5,
    0, 0.5,
  ])
  const from = fromMsl !== undefined ? trajectory.getPositionAtDepth(fromMsl, true)! : 0

  const segments = getCurvePositions(
    trajectory.curve,
    from,
    1,
    segmentsPerMeter,
    simplificationThreshold
  )
  const frenetFrames = calculateFrenetFrames(trajectory.curve, segments)

  const attributesBuffer = new Float32Array(frenetFrames.length * 7)

  for (let i = 0; i < frenetFrames.length; i++) {
    const frame = frenetFrames[i]
    const j = i * 7
    attributesBuffer[j] = frame.position[0]
    attributesBuffer[j + 1] = frame.position[1]
    attributesBuffer[j + 2] = frame.position[2]
    attributesBuffer[j + 3] = frame.curvePosition
    attributesBuffer[j + 4] = frame.tangent[0]
    attributesBuffer[j + 5] = frame.tangent[1]
    attributesBuffer[j + 6] = frame.tangent[2]
  }

  const buffer = new InstancedInterleavedBuffer(attributesBuffer, 7, 1)
  const geometry = new InstancedBufferGeometry()
  geometry.instanceCount = frenetFrames.length - 1
  geometry.setIndex(new BufferAttribute(new Uint8Array([0, 1, 2, 0, 2, 3]), 1))
  geometry.setAttribute('position2', new BufferAttribute(positions, 2))
  geometry.setAttribute('point0', new InterleavedBufferAttribute(buffer, 4, 0))
  geometry.setAttribute('point1', new InterleavedBufferAttribute(buffer, 4, 7))
  geometry.setAttribute('tangent0', new InterleavedBufferAttribute(buffer, 3, 4))
  geometry.setAttribute('tangent1', new InterleavedBufferAttribute(buffer, 3, 11))


  return geometry
}

/**
 * The WellboreRibbon component serves as a controller for ribbon stripe components. It provides a context for
 * child components, including geometry needed to create stripe components. 
 * 
 * @example
 * <WellboreRibbon>
 *  <MeasuredDepthStripe ... />
 *  <FormationsStripe ... /> 
 * </WellboreRibbon>
 * 
 * @remarks
 * This is an experimental component and may be changed/removed
 * 
 * @see [Storybook](/videx-3d/?path=/docs/components-wellbores-wellboreformationcolumn--docs)
 * @see {@link WellboreRibbonContext}
 * @see {@link FormationsStripe}
 * @see {@link MeasuredDepthStripe}
 * 
 * @group Components
 */
export const WellboreRibbon = ({ children }: PropsWithChildren) => {
  const store = useData()
  const { id, fromMsl, segmentsPerMeter, simplificationThreshold } = useWellboreContext()
  const [trajectory, setTrajectory] = useState<Trajectory | null>(null)
  const [direction, setDirection] = useState<Vec3>([0, -1, 0])
  const stripeGeometry = useMemo(() => {
    if (trajectory) {
      return createStripeGeometry(trajectory, segmentsPerMeter, simplificationThreshold, fromMsl)
    }
    return null
  }, [trajectory, segmentsPerMeter, simplificationThreshold, fromMsl])

  const context = useMemo<WellboreRibbonContextProps | null>(() => {
    if (trajectory && stripeGeometry) {
      return {
        trajectory,
        direction,
        geometry: stripeGeometry
      }
    }
    return null
  }, [trajectory, direction, stripeGeometry])

  useEffect(() => {
    function onCameraPositionSet(event: CameraSetPositionEvent) {
      if (trajectory) {
        const n = trajectory.curve.nearest(event.detail)
        setDirection(trajectory.curve.getTangentAt(n.position))
      }
    }
    function onCameraFocusAtPoint(event: CameraFocusAtPointEvent) {
      if (trajectory) {
        const n = trajectory.curve.nearest(event.detail.point)
        setDirection(trajectory.curve.getTangentAt(n.position))
      }
    }
    addEventListener(cameraSetPositionEventType, onCameraPositionSet)
    addEventListener(cameraFocusAtPointEventType, onCameraFocusAtPoint)
    return () => {
      removeEventListener(cameraSetPositionEventType, onCameraPositionSet)
      removeEventListener(cameraFocusAtPointEventType, onCameraFocusAtPoint)
    }
  }, [trajectory])

  useEffect(() => {
    if (store) {
      store.get<PositionLog>('position-logs', id).then(response => {
        const trajectory = getTrajectory(id, response)
        setTrajectory(trajectory)
      }).catch(err => console.error(err))
    }
  }, [store, id])
  if (!trajectory) return null
  return (
    <WellboreRibbonContext value={context}>
      {children}
    </WellboreRibbonContext>
  )
}