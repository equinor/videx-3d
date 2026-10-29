import { createContext, useContext, useEffect, useRef } from 'react';
import {
  mapViewFromPixel,
  mapViewToPixel,
  type MapView,
} from '../../../sdk/projection/map-view';
import type { Vec2 } from '../../../sdk/types/common';

/**
 * What a {@link Minimap} shows now, for the layers drawn over it: handed to
 * {@link useMinimapFrame}'s callback each time it changes.
 *
 * @group Components
 */
export type MinimapState = {
  /** the ground the map shows: where it is centred (the camera), which way is up, and its scale */
  view: MapView;
  /** ground metres across the shorter side of the map */
  extent: number;
  /** the camera's heading, in radians clockwise from the map's up (0 on a heading-up map) */
  heading: number;
  /** how far the map's north is from its up, in radians clockwise: what a compass turns by */
  northAngle: number;
  /** the camera's horizontal field of view, in radians */
  fov: number;
  /** the camera's heading on the ground: a unit vector in scene X/Z (see `mapViewCone`) */
  forward: Vec2;
  /** the camera's height over the sea, in metres (over the globe's sea under a `Scenery`) */
  altitude: number;
  /** the height of what the camera looks at over the sea, in metres: the controls' target's (0 without controls) */
  targetAltitude: number;
  /** the camera's position on the map, scene X/Z (on a globe, the map's point under it): not the map's middle when it is centred on the target */
  camera: Vec2;
  /** what the camera looks at, on the sea's level (the controls' target, or where the view ray meets it), scene X/Z */
  target: Vec2;
  /** what the map is centred on */
  center: MinimapCenter;
};

/** What a minimap is centred on: the camera, or what it looks at (its target, at the sea's level). */
export type MinimapCenter = 'camera' | 'target';

type Listener = (state: MinimapState) => void;

/**
 * What a {@link Minimap} offers its layers beyond its state, for a marker the user drags:
 * where the map is on the page, holding it still while they drag, and what a drop does.
 */
export type MinimapHost = {
  /** the minimap's element, for where the pointer is on it */
  element: HTMLElement | null;
  /** whether a marker can be moved: the scene has controls to move, and the host allows it */
  canDrag: () => boolean;
  /** hold the map still, so a marker follows the pointer and not the camera (`true`), or let it follow again */
  freeze: (on: boolean) => void;
  /** a marker was dropped at scene X/Z: move the controls there, and tell the host */
  drop: (kind: 'camera' | 'target', at: Vec2) => void;
  /** set the height of the camera (its target comes along) or of its target alone to `metres` over the sea (flying there with `smooth`) */
  setAltitude: (
    kind: 'camera' | 'target',
    metres: number,
    smooth: boolean,
  ) => void;
  /** fly the camera and its target back to the home pose */
  reset: () => void;
};

/**
 * What a {@link Minimap} hands to its layers: its state, which changes with the camera every
 * frame, kept out of React so that moving costs no render.
 */
export class MinimapStore {
  host: MinimapHost = {
    element: null,
    canDrag: () => false,
    freeze: () => {},
    drop: () => {},
    setAltitude: () => {},
    reset: () => {},
  };
  private current: MinimapState;
  private readonly listeners = new Set<Listener>();

  constructor(state: MinimapState) {
    this.current = state;
  }

  get state() {
    return this.current;
  }

  /** Tell every layer the minimap changed. */
  set(state: MinimapState) {
    this.current = state;
    for (const listener of this.listeners) listener(state);
  }

  /** @returns the way to stop listening */
  subscribe(listener: Listener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

export const MinimapContext = createContext<MinimapStore | null>(null);

/**
 * The enclosing {@link Minimap}'s way of placing scene positions on it, for a layer that
 * draws its own SVG. Not reactive: it reads the minimap as it is now, so call it inside
 * {@link useMinimapFrame}'s callback, or an event handler.
 *
 * @example
 * const { project } = useMinimap();
 * useMinimapFrame(() => {
 *   const [x, y] = project(sceneX, sceneZ);
 *   circle.current?.setAttribute('transform', `translate(${x} ${y})`);
 * });
 *
 * @group Hooks
 */
export function useMinimap() {
  const store = useContext(MinimapContext);
  if (!store) throw new Error('useMinimap: not inside a <Minimap>');
  return {
    /** The minimap's state now. */
    get state() {
      return store.state;
    },
    /** Scene X/Z to pixels on the minimap: `[column, row]` from its top left. */
    project: (x: number, z: number): Vec2 =>
      mapViewToPixel(store.state.view, x, z),
    /** Pixels on the minimap to scene X/Z. */
    unproject: (column: number, row: number): Vec2 =>
      mapViewFromPixel(store.state.view, column, row),
  };
}

/**
 * Run `callback` now, and each time the enclosing {@link Minimap} changes (the camera
 * moves, it turns, the zoom eases or it is resized). Update a layer's SVG through refs
 * here: it runs per frame while the camera moves, so it should not set React state.
 *
 * @group Hooks
 */
export function useMinimapFrame(callback: (state: MinimapState) => void) {
  const store = useContext(MinimapContext);
  if (!store) throw new Error('useMinimapFrame: not inside a <Minimap>');
  const latest = useRef(callback);
  useEffect(() => {
    latest.current = callback;
  });
  useEffect(() => {
    latest.current(store.state);
    return store.subscribe(state => latest.current(state));
  }, [store]);
}
