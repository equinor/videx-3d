import { Object3D, Vector3 } from 'three/webgpu'
import {
  WellboreAddedEvent,
  wellboreAddedEventType,
  WellboreRemovedEvent,
  wellboreRemovedEventType,
} from '../../events/wellbore-events'
import { Vec3 } from '../types/common'

export type WellboreManagerRecord = {
  wellboreId: string
  object: Object3D
}

const position = new Vector3()
export class WellboreManager {
  private map: Map<string, WellboreManagerRecord> = new Map()

  constructor() {
    this.onWellboreAdded = this.onWellboreAdded.bind(this)
    this.onWellboreRemoved = this.onWellboreRemoved.bind(this)

    addEventListener(wellboreAddedEventType, this.onWellboreAdded)
    addEventListener(wellboreRemovedEventType, this.onWellboreRemoved)
  }

  private onWellboreAdded(event: WellboreAddedEvent) {
    this.map.set(event.detail.id, {
      wellboreId: event.detail.id,
      object: event.detail.object,
    })
  }

  private onWellboreRemoved(event: WellboreRemovedEvent) {
    this.map.delete(event.detail.id)
  }

  getInfo(id: string) {
    const record = this.map.get(id)
    if (record) {
      record.object.getWorldPosition(position)
      return {
        ...record,
        position: position.toArray() as Vec3,
      }
    }
  }

  dispose() {
    removeEventListener(wellboreAddedEventType, this.onWellboreAdded)
    removeEventListener(wellboreRemovedEventType, this.onWellboreRemoved)
  }
}
