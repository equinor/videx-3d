import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { MapLabelSpacer } from '../../../sdk/layers/map-draw';
import {
  mapViewFromPixel,
  mapViewLonLatToPixel,
  mapViewToPixel,
  type MapView,
} from '../../../sdk/projection/map-view';
import type { Vec2 } from '../../../sdk/types/common';
import type { GeoMapController } from './geo-map-controller';
import type { GeoMapKind } from './geo-map-view';

/**
 * Where the camera is on a map, for its markers: told by a `GeoMapCamera` each time it moves.
 *
 * @group Components
 */
export type GeoMapCameraState = {
  /** the camera's heading, in radians clockwise from the map's up (0 on a heading-up map) */
  heading: number;
  /** the camera's horizontal field of view, in radians */
  fov: number;
  /** the camera's heading on the ground: a unit vector in scene X/Z (see `mapViewCone`) */
  forward: Vec2;
  /** the camera's height over the sea, in metres (over the globe's sea in a `World`) */
  altitude: number;
  /** the height of what the camera looks at over the sea, in metres: the controls' target's (0 without controls) */
  targetAltitude: number;
  /** the camera's place on the map, scene X/Z (on a globe, the map's point under it) */
  camera: Vec2;
  /** what the camera looks at, on the sea's level (the controls' target, or where the view ray meets it), scene X/Z */
  target: Vec2;
  /** what the map follows: the camera, its target, or neither */
  follow: 'camera' | 'target' | null;
};

/**
 * What a {@link GeoMap} shows now, for the layers drawn over it: handed to
 * {@link useGeoMapFrame}'s callback, and to a canvas layer's `draw`, each time it changes.
 *
 * @group Components
 */
export type GeoMapState = {
  /** the ground the map shows: its middle, which way is up, its scale, and its projection */
  view: MapView;
  /** ground metres across the shorter side of the map */
  extent: number;
  /** how far the map's north is from its up, in radians clockwise: what a compass turns by */
  northAngle: number;
  /** what it is drawn in now */
  kind: GeoMapKind;
  /** scene X/Z to longitude and latitude, through the map's frame */
  toLonLat: (x: number, z: number) => Vec2;
  /** longitude and latitude to scene X/Z, through the map's frame */
  toXZ: (longitude: number, latitude: number) => Vec2;
  /**
   * metres of map across per metre of a camera's height: what turns a layer's band of heights
   * (`minHeight`, `maxHeight`) into a band of extents (see `layerExtentVisibilityAt`)
   */
  heightPerExtent: number;
  /** where the camera is, with a `GeoMapCamera` in the map; null without */
  camera: GeoMapCameraState | null;
  /**
   * the room the labels written so far in this drawing take, and the map's own items (its
   * compass, buttons and labels): take a label's room from it (`drawMapLabel`'s `spacer`) and
   * the labels of every layer keep out of each other's way and off the map's buttons, the
   * layers drawn first winning
   */
  labelSpacer: MapLabelSpacer;
};

type Listener = (state: GeoMapState) => void;

/**
 * What a {@link GeoMap} hands to its layers: its state, which changes as it moves, kept out
 * of React so that moving costs no render.
 */
export class GeoMapStore {
  private current: GeoMapState;
  private readonly listeners = new Set<Listener>();

  constructor(state: GeoMapState) {
    this.current = state;
  }

  get state() {
    return this.current;
  }

  /** Tell every layer the map changed. */
  set(state: GeoMapState) {
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

/**
 * Where a canvas layer draws: `'features'`, drawn again when the map moves or the layer
 * changes; or `'live'`, over it, drawn again also as the camera moves (a camera's cone,
 * tracks moving): a still map moving its live layers does not redraw its features.
 *
 * @group Components
 */
export type GeoMapCanvasTier = 'features' | 'live';

/**
 * What a canvas layer draws: on `ctx`, in the map's CSS pixels from its top left, for the
 * map as it is now. Its state saved and restored around it.
 *
 * @group Components
 */
export type GeoMapCanvasDraw = (
  ctx: CanvasRenderingContext2D,
  state: GeoMapState,
) => void;

/** A canvas layer's handle on its map. */
export type GeoMapCanvasLayerHandle = {
  /** draw it again at the next frame: its data or its style changed */
  invalidate: () => void;
  /** keep the map drawing every frame while on (something on it moves by itself) */
  animate: (on: boolean) => void;
  remove: () => void;
};

export const GeoMapContext = createContext<GeoMapController | null>(null);

function useController(hook: string) {
  const controller = useContext(GeoMapContext);
  if (!controller) throw new Error(`${hook}: not inside a <GeoMap>`);
  return controller;
}

/**
 * The enclosing {@link GeoMap}'s way of placing positions on it, for a layer of your own. Not
 * reactive: it reads the map as it is now, so call it inside {@link useGeoMapFrame}'s
 * callback, a canvas layer's `draw`, or an event handler.
 *
 * @example
 * const { project } = useGeoMap();
 * useGeoMapFrame(() => {
 *   const [x, y] = project(sceneX, sceneZ);
 *   circle.current?.setAttribute('transform', `translate(${x} ${y})`);
 * });
 *
 * @group Hooks
 */
export function useGeoMap() {
  const controller = useController('useGeoMap');
  const store = controller.store;
  return {
    /** The map's state now. */
    get state() {
      return store.state;
    },
    /** Scene X/Z to pixels on the map: `[column, row]` from its top left. */
    project: (x: number, z: number): Vec2 =>
      mapViewToPixel(store.state.view, x, z),
    /** Longitude and latitude to pixels on the map, anywhere on the Earth. */
    projectLonLat: (longitude: number, latitude: number): Vec2 =>
      mapViewLonLatToPixel(
        store.state.view,
        longitude,
        latitude,
        store.state.toXZ,
      ),
    /** Pixels on the map to scene X/Z. */
    unproject: (column: number, row: number): Vec2 =>
      mapViewFromPixel(store.state.view, column, row),
    /** The map itself: its element, its view, and its canvas layers. */
    controller,
  };
}

/**
 * Run `callback` now, and each time the enclosing {@link GeoMap} changes (it moves, turns,
 * zooms or is resized; the camera moves on it). Update a layer's SVG through refs here: it
 * runs per frame while the map moves, so it should not set React state.
 *
 * @group Hooks
 */
export function useGeoMapFrame(callback: (state: GeoMapState) => void) {
  const controller = useController('useGeoMapFrame');
  const latest = useRef(callback);
  useEffect(() => {
    latest.current = callback;
  });
  useEffect(() => {
    const store = controller.store;
    latest.current(store.state);
    return store.subscribe(state => latest.current(state));
  }, [controller]);
}

/**
 * Draw on the enclosing {@link GeoMap}'s canvas: `draw` is called each time the map changes
 * (for the `'live'` tier, as the camera moves too), and again when `draw` itself changes, so
 * keep it stable (`useCallback`) over what it draws. Layers are drawn by `order`, then in the
 * order they came.
 *
 * @returns the layer's handle: `invalidate` to draw again, `animate` to draw every frame
 *
 * @group Hooks
 */
export function useGeoMapCanvasLayer(
  draw: GeoMapCanvasDraw,
  {
    tier = 'features',
    order = 0,
  }: { tier?: GeoMapCanvasTier; order?: number } = {},
): GeoMapCanvasLayerHandle {
  const controller = useController('useGeoMapCanvasLayer');
  const latest = useRef(draw);
  const handle = useRef<GeoMapCanvasLayerHandle | null>(null);
  useEffect(() => {
    const added = controller.addCanvasLayer({
      tier,
      order,
      draw: (ctx, state) => latest.current(ctx, state),
    });
    handle.current = added;
    return () => {
      handle.current = null;
      added.remove();
    };
  }, [controller, tier, order]);
  useEffect(() => {
    latest.current = draw;
    handle.current?.invalidate();
  }, [draw]);
  // Stable: the calls go to whichever layer is added now.
  const [stable] = useState<GeoMapCanvasLayerHandle>(() => ({
    invalidate: () => handle.current?.invalidate(),
    animate: on => handle.current?.animate(on),
    remove: () => handle.current?.remove(),
  }));
  return stable;
}
