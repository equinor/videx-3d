import { Object3D } from 'three';
import { Vec3 } from '../sdk';

export const wellboreSelectedEventType = 'wellbore-selected' as const;
export const wellboreAddedEventType = 'wellbore-added' as const;
export const wellboreRemovedEventType = 'wellbore-removed' as const;

export interface WellboreAddedEventDetails {
  id: string;
  object: Object3D;
}

export interface WellboreRemovedEventDetails {
  id: string;
}

export interface WellboreSelectedEventDetails {
  id: string;
  position?: Vec3;
  depth?: number;
  flyTo?: boolean;
}

/**
 * Wellbore selected event
 * @event
 */
export class WellboreSelectedEvent extends CustomEvent<WellboreSelectedEventDetails> {
  constructor(detail: WellboreSelectedEventDetails) {
    super(wellboreSelectedEventType, { detail });
  }
}

/**
 * Wellbore added event
 * @event
 */
export class WellboreAddedEvent extends CustomEvent<WellboreAddedEventDetails> {
  constructor(detail: WellboreAddedEventDetails) {
    super(wellboreAddedEventType, { detail });
  }
}

/**
 * Wellbore removed event
 * @event
 */
export class WellboreRemovedEvent extends CustomEvent<WellboreRemovedEventDetails> {
  constructor(detail: WellboreRemovedEventDetails) {
    super(wellboreRemovedEventType, { detail });
  }
}

declare global {
  interface WindowEventMap {
    [wellboreSelectedEventType]: WellboreSelectedEvent;
    [wellboreAddedEventType]: WellboreAddedEvent;
    [wellboreRemovedEventType]: WellboreRemovedEvent;
  }
}
