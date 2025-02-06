import { ChangeEvent, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { DataContext } from '../../contexts/DataContext'
import { PositionLog } from '../../sdk/data/types/PositionLog'
import { Vec3 } from '../../sdk/types/common'
import { WellboreManager } from '../../sdk/managers/WellboreManager'
import { WellboreSelectedEvent, wellboreSelectedEventType } from '../../events/wellbore-events'
import { CameraFocusAtPointEvent, CameraSetPositionEvent } from '../../events/camera-events'
import { getTrajectory, Trajectory } from '../../sdk/utils/trajectory'

export const DepthSelector = () => {
  const inputRef = useRef<HTMLInputElement>(null)
  const trajectory = useRef<Trajectory | null>(null)
  const offsetPosition = useRef<Vec3>([0, 0, 0])

  const [disabled, setDisabled] = useState(true)

  // const [position, setPosition] = useState(0)

  const dataContext = useContext(DataContext)

  const wellboreManager = useMemo(() => new WellboreManager(), [])

  const updatePosition = useCallback((position: number) => {
    if (trajectory.current) {
      const point = trajectory.current.curve.getPointAt(position) as Vec3
      point[0] += offsetPosition.current[0]
      point[1] += offsetPosition.current[1]
      point[2] += offsetPosition.current[2]
      dispatchEvent(new CameraSetPositionEvent(point))
    }
  }, [])

  useEffect(() => {
    function onSelectWellbore(event: WellboreSelectedEvent) {
      trajectory.current = null
      setDisabled(true)
      if (dataContext) {
        const store = dataContext.connect()
        if (store) {
          const id = event.detail.id
          offsetPosition.current = wellboreManager.getInfo(id)?.position || [0, 0, 0]
          store.get<PositionLog>('position-logs', id).then(poslog => {
            if (poslog) {
              trajectory.current = getTrajectory(id, poslog)
              if (trajectory.current) {
                setDisabled(false)
                if (event.detail.position) {
                  const point = event.detail.position
                  const localPosition: Vec3 = [
                    point[0] - offsetPosition.current[0],
                    point[1] - offsetPosition.current[1],
                    point[2] - offsetPosition.current[2],
                  ]
                  const nearestPosition = trajectory.current.curve.nearest(localPosition)
                  if (nearestPosition) {
                    const destination: Vec3 = [
                      nearestPosition.point[0] + offsetPosition.current[0],
                      nearestPosition.point[1] + offsetPosition.current[1],
                      nearestPosition.point[2] + offsetPosition.current[2],
                    ]
                    if (inputRef.current) {
                      inputRef.current.value = nearestPosition.position.toString()
                      setDisabled(false)
                    }
                    if (event.detail.flyTo) {
                      dispatchEvent(new CameraFocusAtPointEvent({
                        point: destination
                      }))
                    }
                  }
                } else {
                  updatePosition(0)
                }
              }
            }
          })
        }
      }
    }

    addEventListener(wellboreSelectedEventType, onSelectWellbore)

    return () => {
      removeEventListener(wellboreSelectedEventType, onSelectWellbore)
    }
  }, [dataContext, wellboreManager, updatePosition])

  return (
    <div style={{
      padding: '0.5em 0 0.5em 2px',
      background: 'black',
      zIndex: 1,
      pointerEvents: 'none'
    }}>
      {<input
        ref={inputRef}
        type="range"
        min={0}
        max={1}
        defaultValue={0}
        step={0.0001}
        disabled={disabled}
        onChange={(e: ChangeEvent) => updatePosition(Number.parseFloat((e.target as HTMLInputElement).value!))}
        style={{
          writingMode: 'vertical-lr',
          accentColor: 'darkgray',
          height: '100%',
          pointerEvents: 'auto',
          opacity: trajectory.current ? 1 : 0.5
        }}
      />}
    </div>
  )
}