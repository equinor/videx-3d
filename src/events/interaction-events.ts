import { EventEmitterCallback } from '../components/Handlers/EventEmitter/EventEmitterContext'


export type PointerEvents = {
  onPointerEnter?: EventEmitterCallback,
  onPointerLeave?: EventEmitterCallback,
  onPointerMove?: EventEmitterCallback,
  onPointerClick?: EventEmitterCallback,
}