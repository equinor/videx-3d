import { WellboreAddedEvent, wellboreAddedEventType, WellboreRemovedEvent, wellboreRemovedEventType } from '../../events/wellbore-events'
import { Vec3 } from '../types/common'

export type WellboreManagerRecord = {
  wellboreId: string,
  objectId: number,
  objectUuid: string,
  position: Vec3,
}

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
      position: event.detail.position,
      objectId: event.detail.objectId,
      objectUuid: event.detail.objectUuid,
    })
  }

  private onWellboreRemoved(event: WellboreRemovedEvent) {
    this.map.delete(event.detail.id)
  }

  getInfo(id: string) {
    return this.map.get(id)
  }

  getAll() {
    return this.map.values()
  }

  dispose() {
    removeEventListener(wellboreAddedEventType, this.onWellboreAdded)
    removeEventListener(wellboreRemovedEventType, this.onWellboreRemoved)
  }
}
