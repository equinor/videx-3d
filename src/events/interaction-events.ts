import { EventEmitterCallback } from '../components/EventEmitter/EventEmitterContext'

export type PointerEvents = {
  onPointerEnter?: EventEmitterCallback
  onPointerLeave?: EventEmitterCallback
  onPointerMove?: EventEmitterCallback
  onPointerClick?: EventEmitterCallback
}
