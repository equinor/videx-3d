import { Vector3 } from 'three'
import { CameraControls } from '../../components/CameraControls/CameraControls'
import {
  cameraFocusAtPointEventType,
  cameraSetPositionEventType,
} from '../../events/camera-events'
import { Vec3 } from '../types/common'

const cameraTarget = new Vector3()
const cameraPosition = new Vector3()
const direction = new Vector3()
const v1 = new Vector3()
const v2 = new Vector3()

async function focusAtPoint(
  point: Vec3,
  distance: number,
  controls: CameraControls,
) {
  controls.normalizeRotations()
  const useDistance = Math.min(controls.distance, distance)
  cameraTarget.set(...point)
  controls.getPosition(cameraPosition)
  direction.subVectors(cameraTarget, cameraPosition)
  distance = Math.min(direction.length() * 1.5, useDistance)
  direction.normalize()
  cameraPosition.copy(cameraTarget).addScaledVector(direction, -useDistance)

  return controls.setLookAt(
    cameraPosition.x,
    cameraPosition.y,
    cameraPosition.z,
    cameraTarget.x,
    cameraTarget.y,
    cameraTarget.z,
    true,
  )
}

function setPosition(point: Vec3, controls: CameraControls) {
  controls.normalizeRotations()
  v1.set(...point)
  //console.log(point)

  controls.getTarget(cameraTarget)

  v2.subVectors(cameraTarget, v1)

  controls.getPosition(cameraPosition)
  cameraPosition.sub(v2)
  controls.setPosition(cameraPosition.x, cameraPosition.y, cameraPosition.z)
  controls.setTarget(v1.x, v1.y, v1.z)
}

export class CameraManager {
  controls: CameraControls | null = null
  removeEventlisteners: (() => void) | null = null

  constructor() {
    this.setControls = this.setControls.bind(this)
  }
  private addEventListeners() {
    const onSetPosition = (event: any) => {
      if (this.controls) {
        setPosition(event.detail as Vec3, this.controls)
      }
    }

    const onFocusPoint = (event: any) => {
      if (this.controls) {
        const callback = event.detail.callback
        focusAtPoint(
          event.detail.point as Vec3,
          event.detail.distance || 200,
          this.controls,
        ).then(() => {
          if (callback) callback()
        })
      }
    }

    addEventListener(cameraSetPositionEventType, onSetPosition)
    addEventListener(cameraFocusAtPointEventType, onFocusPoint)

    this.removeEventlisteners = () => {
      removeEventListener(cameraSetPositionEventType, onSetPosition)
      removeEventListener(cameraFocusAtPointEventType, onFocusPoint)
    }
  }

  async setTarget(target: Vec3) {
    const controls = this.controls
    if (controls) {
      cameraTarget.set(...target)
      controls.getPosition(cameraPosition)
      direction.subVectors(cameraTarget, cameraPosition)
      direction.normalize()
      return controls.setLookAt(
        cameraPosition.x,
        cameraPosition.y,
        cameraPosition.z,
        cameraTarget.x,
        cameraTarget.y,
        cameraTarget.z,
        true,
      )
    }
    return null
  }

  setControls(controls: CameraControls) {
    this.controls = controls
    if (this.removeEventlisteners) {
      this.removeEventlisteners()
    }
    this.addEventListeners()
  }

  dispose() {
    this.controls = null
    if (this.removeEventlisteners) {
      this.removeEventlisteners()
    }
  }
}
