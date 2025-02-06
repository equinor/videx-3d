import { DepthReferencePoint } from '../sdk'

/**
 * DepthChangedEvent name
 */
export const depthChangedType = "depth-changed" as const

export interface DepthChangedEventDetails {
  depth: number,
  referencePoint: DepthReferencePoint,
  source: string,
}

/**
 * Depth changed
 * @event
 */
export class DepthChangedEvent extends CustomEvent<DepthChangedEventDetails> {
  constructor(detail: DepthChangedEventDetails) {
    super(depthChangedType, { detail })
  }
}
declare global {
  interface WindowEventMap {
    [depthChangedType]: DepthChangedEvent
  }
}