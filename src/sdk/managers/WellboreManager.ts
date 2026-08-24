import { Object3D, Vector3 } from 'three';
import {
  WellboreAddedEvent,
  wellboreAddedEventType,
  WellboreRemovedEvent,
  wellboreRemovedEventType,
} from '../../events/wellbore-events';
import { Vec3 } from '../types/common';

export type WellboreManagerRecord = {
  wellboreId: string;
  object: Object3D;
};

const position = new Vector3();
export class WellboreManager {
  // ⚠️ WEAK on purpose: this is a lookup, not an owner. A wellbore unmounted
  // without dispatching its removal event would otherwise keep its whole subtree —
  // geometries and materials included — alive for the life of the page.
  private map: Map<string, WeakRef<Object3D>> = new Map();

  constructor() {
    this.onWellboreAdded = this.onWellboreAdded.bind(this);
    this.onWellboreRemoved = this.onWellboreRemoved.bind(this);

    addEventListener(wellboreAddedEventType, this.onWellboreAdded);
    addEventListener(wellboreRemovedEventType, this.onWellboreRemoved);
  }

  private onWellboreAdded(event: WellboreAddedEvent) {
    this.map.set(event.detail.id, new WeakRef(event.detail.object));
  }

  private onWellboreRemoved(event: WellboreRemovedEvent) {
    this.map.delete(event.detail.id);
  }

  getInfo(id: string) {
    const object = this.map.get(id)?.deref();
    if (!object) {
      // Collected: drop the empty reference rather than keep answering `undefined`.
      this.map.delete(id);
      return;
    }
    object.getWorldPosition(position);
    return {
      wellboreId: id,
      object,
      position: position.toArray() as Vec3,
    };
  }

  dispose() {
    removeEventListener(wellboreAddedEventType, this.onWellboreAdded);
    removeEventListener(wellboreRemovedEventType, this.onWellboreRemoved);
    this.map.clear();
  }
}
