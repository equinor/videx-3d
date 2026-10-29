import { Vector3, type Camera, type Texture } from 'three';
import { cornerStyle, type Corner } from '../../../common/corner-style';
import { globeMapSurface, type Globe } from '../../../sdk/projection/globe';
import {
  lambertConformalConic,
  lambertParallelsFor,
  MAP_PROJECTIONS,
  mapPlane,
  type MapProjection,
} from '../../../sdk/projection/map-projections';
import {
  adaptiveMapExtent,
  dropMarkerOn,
  easeMapExtent,
  flatMapSurface,
  MAP_NORTH,
  mapViewMetresPerPixel,
  mapViewPan,
  mapViewUp,
  projectMapView,
  rayAtSeaLevel,
  setMarkerHeight,
  stepMapZoom,
  type MapOrientation,
  type MapSurface,
  type MapView,
} from '../../../sdk/projection/map-view';
import type { Vec2, Vec3 } from '../../../sdk/types/common';
import {
  MinimapStore,
  type MinimapCenter,
  type MinimapState,
} from './minimap-context';
import {
  MinimapRenderer,
  type MinimapAppearance,
  type MinimapTileSource,
} from './minimap-renderer';

/** How a minimap is zoomed: `'auto'` follows the camera's height; a number is an index into its `zooms`. */
export type MinimapZoom = 'auto' | number;

/** What a minimap's map is drawn in: see `MinimapProps.projection`. */
export type MinimapProjection = 'scene' | MapProjection['name'] | 'auto';

/** The seconds a change of projection cross-fades over. */
export const MINIMAP_PROJECTION_FADE = 0.3;
// With 'auto', back to the scene's map only once this far under `globalFrom`: no flicker
// while the extent hovers about it.
const GLOBAL_HYSTERESIS = 0.8;
// Ground metres a degree of latitude spans, on a sphere of the Earth's mean radius.
const METRES_PER_DEGREE = (6371008.8 * Math.PI) / 180;

/** What the controller needs of a {@link Minimap}'s props, resolved. */
export type MinimapOptions = {
  /** scene X/Z to longitude and latitude; null without a frame */
  toLonLat: ((x: number, z: number) => Vec2) | null;
  /** longitude and latitude to scene X/Z; null without a frame */
  toXZ: ((longitude: number, latitude: number) => Vec2) | null;
  /** what the map is drawn in */
  projection: MinimapProjection;
  /** `'auto'`: the projection past `globalFrom` */
  globalProjection: MapProjection['name'];
  /** `'auto'`: the extent, metres, from which `globalProjection` draws it */
  globalFrom: number;
  /** a Lambert conformal conic's standard parallels, degrees; null to follow the view */
  lambertParallels: [number, number] | null;
  /** extents in metres across the shorter side, ascending */
  zooms: number[];
  zoom: MinimapZoom;
  autoZoomFactor: number;
  /** seconds an adaptive zoom takes to close all but 1/e of a change; 0 for none */
  autoZoomSmoothing: number;
  /** the sea's height in the scene (Y) */
  level: number;
  /**
   * the globe the scene is placed on (a `World`'s, from its `Scenery`), or null: with one,
   * heights are over its sea and positions the map's points under them (`globeMapSurface`)
   */
  globe: Globe | null;
  /** what the map is centred on */
  center: MinimapCenter;
  orientation: MapOrientation;
  appearance: MinimapAppearance;
  width: number;
  height: number;
  origin: Corner;
  offset: [number, number];
  background: string;
  border: string;
  borderRadius: number;
  opacity: number;
  wheelZoom: boolean;
  /** whether dropping a marker moves the controls */
  dragControls: boolean;
  /** whether the right mouse button pans the map */
  pan: boolean;
  /** what a reset returns the camera to; else where it was at the first frame */
  home?: MinimapHome;
};

export type MinimapRelief = {
  /** where its tiles come from */
  source: MinimapTileSource;
  /** device pixels a tile's cell spans, at most */
  cellPixels: number;
  /** `SceneryReliefLooks.texture`, not disposed by the controller */
  looks: Texture;
};

const position = new Vector3();
const forward = new Vector3();
const up = new Vector3();
const pivot = new Vector3();

// What the controls look at: `getTarget` on a drei `CameraControls`, `target` on an `OrbitControls`.
type TargetControls = {
  getTarget?: (out: Vector3) => Vector3;
  target?: Vector3;
};

// The controls' target in `out`, or false without one.
function controlsTarget(controls: unknown, out: Vector3) {
  const c = controls as TargetControls | null | undefined;
  if (c?.getTarget) {
    c.getTarget(out);
    return true;
  }
  if (c?.target) {
    out.copy(c.target);
    return true;
  }
  return false;
}

// What moves the camera and what it looks at: `setLookAt` on a drei `CameraControls`, which
// flies there; else the camera and `target` of an `OrbitControls`, set.
type PoseControls = TargetControls & {
  setLookAt?: (
    positionX: number,
    positionY: number,
    positionZ: number,
    targetX: number,
    targetY: number,
    targetZ: number,
    enableTransition?: boolean,
  ) => unknown;
  update?: () => unknown;
};

// Put the camera and its target where `pose` says, through `controls`: flying there, unless
// `smooth` is off.
function moveControls(
  controls: unknown,
  camera: Camera,
  pose: { camera: Vec3; target: Vec3 },
  smooth = true,
) {
  const c = controls as PoseControls;
  if (c.setLookAt) {
    c.setLookAt(...pose.camera, ...pose.target, smooth);
  } else if (c.target) {
    camera.position.set(...pose.camera);
    c.target.set(...pose.target);
    c.update?.();
  }
}

// A pixel's fraction of the map the view may drift by before it is drawn again.
const MOVE_PIXELS = 0.25;
// The most the camera's heading may turn, in radians, before layers hear of it.
const HEADING_STEP = 0.002;
// How far off along the ground the view ray's sea-level point is taken, in metres.
const TARGET_REACH = 2e6;
// The seconds a panned map takes to close all but 1/e of the way back to its centre.
const PAN_RETURN_SECONDS = 0.12;
// The metres a height has to change by before layers hear of it.
const ALTITUDE_STEP = 0.05;

/** The camera and what it looks at, in the scene: a pose to return to. */
export type MinimapHome = {
  position: Vec3;
  target: Vec3;
};

/**
 * The imperative half of a {@link Minimap}: its DOM, its renderer and its per-frame
 * follow of the camera. Everything that changes every frame goes through here, not React.
 */
export class MinimapController {
  readonly container = document.createElement('div');
  /** where React draws the layers and controls */
  readonly overlay = document.createElement('div');
  readonly store: MinimapStore;
  /** asked for a zoom: `'auto'` or a level */
  onZoom: (zoom: MinimapZoom) => void = () => {};
  /** a marker was dropped on the map, at scene X/Z, after the controls were moved */
  onDrop: (kind: 'camera' | 'target', at: Vec2) => void = () => {};
  private readonly canvasSlot = document.createElement('div');
  private renderer: MinimapRenderer | null = null;
  // What the renderer was made for: a new source or detail alone does not make a new one.
  private relief: MinimapRelief | null = null;
  private options: MinimapOptions | null = null;
  // Heights and map points, flat or on the globe, by the options.
  private surface: MapSurface = flatMapSurface();
  // What it last followed: what a drop moves.
  private camera: Camera | null = null;
  private controls: unknown = null;
  private frozen = false;
  // The pose a reset returns to, when the host gives none: the first the controls had.
  private home: MinimapHome | null = null;
  // The right mouse button's pan: the map's offset from its centre, in scene metres, and the
  // drag that sets it (null once released: it then eases back to nothing).
  private panOffset: Vec2 = [0, 0];
  private panning: {
    id: number;
    x: number;
    y: number;
    view: MapView;
    offset: Vec2;
  } | null = null;
  private extent = NaN;
  // The view in the scene's map, which a move is measured by, and as drawn: in a projection's
  // plane, where one draws it.
  private view: MapView | null = null;
  private drawn: MapView | null = null;
  // What the map is drawn in now, and what it cross-fades from, and how far (0 to 1).
  private kind: 'scene' | MapProjection['name'] | null = null;
  private fade: { from: 'scene' | MapProjection['name']; t: number } | null =
    null;
  private heading = NaN;
  private markers: {
    camera: Vec2;
    target: Vec2;
    center: MinimapCenter;
    cameraAltitude: number;
    targetAltitude: number;
  } | null = null;
  private dirty = true;
  private readonly onWheel = (event: WheelEvent) => {
    if (!this.options?.wheelZoom) return;
    event.preventDefault();
    event.stopPropagation();
    this.stepZoom(event.deltaY < 0 ? 1 : -1);
  };
  private readonly onPanStart = (event: PointerEvent) => {
    // A press on the map is not a press on the scene: the scene's controls listen on the
    // canvas's parent (R3F's event source), which the map sits in, so keep it from them.
    // The map's own buttons and handles have heard it by now: React's listener is below.
    event.stopPropagation();
    if (event.button !== 2 || !this.options?.pan || this.frozen || !this.drawn)
      return;
    this.container.setPointerCapture(event.pointerId);
    this.panning = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      view: this.drawn,
      offset: [...this.panOffset],
    };
  };
  private readonly onPanMove = (event: PointerEvent) => {
    const pan = this.panning;
    if (!pan || event.pointerId !== pan.id) return;
    const [x, z] = mapViewPan(
      pan.view,
      event.clientX - pan.x,
      event.clientY - pan.y,
    );
    this.panOffset = [
      pan.offset[0] + x - pan.view.center[0],
      pan.offset[1] + z - pan.view.center[1],
    ];
  };
  private readonly onPanEnd = (event: PointerEvent) => {
    if (event.pointerId === this.panning?.id) this.panning = null;
  };
  private readonly onContextMenu = (event: Event) => {
    if (this.options?.pan) event.preventDefault();
  };

  constructor(host: HTMLElement) {
    const fill = {
      position: 'absolute',
      left: '0',
      top: '0',
      right: '0',
      bottom: '0',
    };
    Object.assign(this.container.style, {
      position: 'absolute',
      zIndex: '10',
      overflow: 'hidden',
      boxSizing: 'border-box',
      userSelect: 'none',
      pointerEvents: 'auto',
    });
    Object.assign(this.canvasSlot.style, fill, { lineHeight: '0' });
    Object.assign(this.overlay.style, fill, {
      fontFamily: 'verdana, sans-serif',
      color: '#fff',
    });
    this.container.append(this.canvasSlot, this.overlay);
    this.container.addEventListener('wheel', this.onWheel, { passive: false });
    this.container.addEventListener('pointerdown', this.onPanStart);
    this.container.addEventListener('pointermove', this.onPanMove);
    this.container.addEventListener('pointerup', this.onPanEnd);
    this.container.addEventListener('pointercancel', this.onPanEnd);
    this.container.addEventListener('contextmenu', this.onContextMenu);
    host.appendChild(this.container);
    this.store = new MinimapStore({
      view: {
        center: [0, 0],
        up: [...MAP_NORTH],
        metresPerPixel: 1,
        size: [1, 1],
      },
      extent: 1,
      heading: 0,
      northAngle: 0,
      fov: 1,
      forward: [...MAP_NORTH],
      altitude: 0,
      targetAltitude: 0,
      camera: [0, 0],
      target: [0, 0],
      center: 'camera',
    });
    this.store.host = {
      element: this.container,
      canDrag: () => this.canDrag(),
      freeze: on => {
        this.frozen = on;
      },
      drop: (kind, at) => this.drop(kind, at),
      setAltitude: (kind, metres, smooth) =>
        this.setAltitude(kind, metres, smooth),
      reset: () => this.reset(),
    };
  }

  // Whether a marker can be moved: the scene has controls to move, and the host allows it.
  private canDrag() {
    return !!this.options?.dragControls && controlsTarget(this.controls, pivot);
  }

  // A marker dropped at `at`: the controls move there (unless the host does it), and the host hears.
  private drop(kind: 'camera' | 'target', at: Vec2) {
    const camera = this.camera;
    if (camera && this.canDrag()) {
      camera.getWorldPosition(position);
      const pose = dropMarkerOn(
        this.surface,
        kind,
        [position.x, position.y, position.z],
        [pivot.x, pivot.y, pivot.z],
        at,
      );
      moveControls(this.controls, camera, pose);
    }
    this.onDrop(kind, at);
  }

  // The height of the camera or its target set to `metres` over the sea: the camera takes its
  // target along, the target alone leaves the camera.
  private setAltitude(
    kind: 'camera' | 'target',
    metres: number,
    smooth: boolean,
  ) {
    const camera = this.camera;
    if (!camera || !this.options || !this.canDrag()) return;
    camera.getWorldPosition(position);
    moveControls(
      this.controls,
      camera,
      setMarkerHeight(
        this.surface,
        kind,
        [position.x, position.y, position.z],
        [pivot.x, pivot.y, pivot.z],
        metres,
      ),
      smooth,
    );
  }

  // The camera and its target flown back to the pose given as `home`, or the first it had;
  // the map is brought back to its centre too.
  private reset() {
    const camera = this.camera;
    const home = this.options?.home ?? this.home;
    if (!camera || !home || !this.canDrag()) return;
    moveControls(this.controls, camera, {
      camera: home.position,
      target: home.target,
    });
    this.panning = null;
  }

  /** The ground extent now, in metres across the shorter side; NaN before the first frame. */
  get currentExtent() {
    return this.extent;
  }

  setOptions(options: MinimapOptions) {
    const before = this.options;
    this.options = options;
    if (
      !before ||
      before.globe !== options.globe ||
      before.level !== options.level
    )
      this.surface = options.globe
        ? globeMapSurface(options.globe, options.level)
        : flatMapSurface(options.level);
    const style = this.container.style;
    // Reset all four first: a corner change leaves the old pair set otherwise.
    style.left = style.right = style.top = style.bottom = '';
    Object.assign(style, cornerStyle(options.origin, options.offset), {
      width: `${options.width}px`,
      height: `${options.height}px`,
      background: options.background,
      border: options.border,
      borderRadius: `${options.borderRadius}px`,
    });
    this.canvasSlot.style.opacity = String(options.opacity);
    if (
      !before ||
      before.width !== options.width ||
      before.height !== options.height
    )
      this.applySize();
    this.renderer?.setAppearance(options.appearance);
    this.dirty = true;
  }

  /**
   * Draw `relief`, or nothing (null). A renderer — a WebGL context — is made only for new
   * looks: a new source or detail is set on the one there is.
   */
  setRelief(relief: MinimapRelief | null) {
    const was = this.relief;
    this.relief = relief;
    this.dirty = true;
    if (relief && was && this.renderer && relief.looks === was.looks) {
      if (relief.source !== was.source) this.renderer.setSource(relief.source);
      this.renderer.setCellPixels(relief.cellPixels);
      return;
    }
    this.renderer?.canvas.remove();
    this.renderer?.dispose();
    this.renderer = null;
    if (!relief) return;
    try {
      this.renderer = new MinimapRenderer(relief.looks);
    } catch (error) {
      console.warn('Minimap: no WebGL context to draw the relief on', error);
      return;
    }
    // A tile came in: draw the map again, and choose what it wants next.
    this.renderer.onTiles = () => {
      this.dirty = true;
    };
    this.renderer.setSource(relief.source);
    this.renderer.setCellPixels(relief.cellPixels);
    this.canvasSlot.appendChild(this.renderer.canvas);
    this.applySize();
    if (this.options) this.renderer.setAppearance(this.options.appearance);
  }

  /** Draw the map again at the next frame, as its look (its colours, contours) changed. */
  invalidate() {
    this.dirty = true;
  }

  /**
   * Zoom in (`1`) or out (`-1`) one level from where the map is: from its level when it has
   * one (so a second click before the first has eased in goes on a level), else from the
   * adaptive extent now.
   */
  stepZoom(direction: 1 | -1) {
    const o = this.options;
    if (!o?.zooms.length) return;
    const from =
      o.zoom === 'auto'
        ? this.extent
        : o.zooms[
            Math.min(Math.max(Math.round(o.zoom), 0), o.zooms.length - 1)
          ];
    this.onZoom(
      stepMapZoom(
        o.zooms,
        Number.isFinite(from) ? from : o.zooms[0],
        direction,
      ),
    );
  }

  /**
   * Follow `camera`: re-place the map, draw it if it moved, and tell the layers.
   *
   * @param controls the scene's controls (R3F's `state.controls`), for the target the camera
   *   looks at; without them it is where the view ray meets the sea
   */
  update(camera: Camera, dt: number, controls?: unknown) {
    const o = this.options;
    this.camera = camera;
    this.controls = controls;
    // A marker is being dragged: the map holds still under it.
    if (!o?.toLonLat || this.frozen) return;
    camera.getWorldPosition(position);
    camera.getWorldDirection(forward);
    up.set(0, 1, 0).transformDirection(camera.matrixWorld);

    // What the camera looks at, on the sea's level: the controls' target dropped to it.
    const surface = this.surface;
    const eye: Vec3 = [position.x, position.y, position.z];
    const hasControls = controlsTarget(controls, pivot);
    const aim: Vec3 = [pivot.x, pivot.y, pivot.z];
    const target: Vec2 = hasControls
      ? surface.foot(aim)
      : rayAtSeaLevel(
          eye,
          [forward.x, forward.y, forward.z],
          o.level,
          TARGET_REACH,
        );
    const targetAltitude = hasControls ? surface.altitude(aim) : 0;
    if (hasControls && !this.home) this.home = { position: eye, target: aim };
    const cameraAt = surface.foot(eye);

    const zooms = o.zooms;
    const altitude = surface.altitude(eye);
    const wanted =
      o.zoom === 'auto'
        ? adaptiveMapExtent(
            altitude,
            [zooms[0], zooms[zooms.length - 1]],
            o.autoZoomFactor,
          )
        : zooms[Math.min(Math.max(Math.round(o.zoom), 0), zooms.length - 1)];
    this.extent = Number.isFinite(this.extent)
      ? easeMapExtent(this.extent, wanted, dt, o.autoZoomSmoothing)
      : wanted;

    const size: Vec2 = [o.width, o.height];
    const mapUp = mapViewUp(
      o.orientation,
      [forward.x, forward.y, forward.z],
      [up.x, up.y, up.z],
    );
    const metresPerPixel = mapViewMetresPerPixel(this.extent, size);
    // A panned map eases back to its centre once the button is released.
    if (!this.panning && (this.panOffset[0] !== 0 || this.panOffset[1] !== 0)) {
      const keep = Math.exp(-dt / PAN_RETURN_SECONDS);
      const offset: Vec2 = [this.panOffset[0] * keep, this.panOffset[1] * keep];
      this.panOffset =
        Math.hypot(offset[0], offset[1]) < 0.1 * metresPerPixel
          ? [0, 0]
          : offset;
    }
    const centre = o.center === 'target' ? target : cameraAt;
    const view: MapView = {
      center: [centre[0] + this.panOffset[0], centre[1] + this.panOffset[1]],
      up: mapUp,
      metresPerPixel,
      size,
    };

    // What the map is drawn in: fixed, or with 'auto' the scene's map up to `globalFrom`
    // and the global projection past it. A change cross-fades.
    const kind = this.projectionFor(o);
    if (kind !== this.kind) {
      if (this.kind !== null && this.renderer)
        this.fade = { from: this.kind, t: 0 };
      this.kind = kind;
      this.dirty = true;
    }
    if (this.fade) {
      this.fade.t += dt / MINIMAP_PROJECTION_FADE;
      if (this.fade.t >= 1) this.fade = null;
      this.dirty = true;
    }
    const drawn = this.drawnView(view, kind, o);

    // The camera's heading on the map: its own, whichever way the map is turned — and
    // carried into a projection's plane where it is drawn in one.
    const sceneWay = mapViewUp(
      'heading-up',
      [forward.x, forward.y, forward.z],
      [up.x, up.y, up.z],
    );
    const way = drawn.projected
      ? projectMapView(
          { ...view, up: sceneWay },
          drawn.projected.plane,
          'heading-up',
        ).up
      : sceneWay;
    const mapUpDrawn = drawn.up;
    const heading = Math.atan2(
      -way[0] * mapUpDrawn[1] + way[1] * mapUpDrawn[0],
      way[0] * mapUpDrawn[0] + way[1] * mapUpDrawn[1],
    );
    const northAngle = Math.atan2(-mapUpDrawn[0], -mapUpDrawn[1]);
    const perspective = (camera as { fov?: number; aspect?: number }).fov;
    const aspect = (camera as { aspect?: number }).aspect ?? 1;
    const fov = perspective
      ? 2 * Math.atan(Math.tan((perspective * Math.PI) / 360) * aspect)
      : 0;

    const moved = this.moved(view);
    const headed =
      !Number.isFinite(this.heading) ||
      Math.abs(
        Math.atan2(
          Math.sin(heading - this.heading),
          Math.cos(heading - this.heading),
        ),
      ) > HEADING_STEP;
    // The camera and the target move over the map as well as it over the ground: when it is
    // centred on one, the other.
    const reach = MOVE_PIXELS * view.metresPerPixel;
    const markers =
      !this.markers ||
      Math.hypot(
        cameraAt[0] - this.markers.camera[0],
        cameraAt[1] - this.markers.camera[1],
      ) > reach ||
      Math.hypot(
        target[0] - this.markers.target[0],
        target[1] - this.markers.target[1],
      ) > reach ||
      this.markers.center !== o.center ||
      Math.abs(altitude - this.markers.cameraAltitude) > ALTITUDE_STEP ||
      Math.abs(targetAltitude - this.markers.targetAltitude) > ALTITUDE_STEP;
    if (!moved && !headed && !markers && !this.dirty) return;

    if (moved || this.dirty) {
      this.view = view;
      this.drawn = drawn;
      if (this.renderer) {
        const fade = this.fade;
        // Eased: the new projection comes in, and the old goes, gently at both ends.
        const t = fade ? fade.t * fade.t * (3 - 2 * fade.t) : 1;
        this.renderer.setView(
          fade
            ? [
                { view: this.drawnView(view, fade.from, o), opacity: 1 - t },
                { view: drawn, opacity: t },
              ]
            : { view: drawn, opacity: 1 },
          o.toLonLat,
          o.toXZ ?? undefined,
        );
        this.renderer.render();
      }
    }
    this.dirty = false;
    this.heading = heading;
    this.markers = {
      camera: cameraAt,
      target,
      center: o.center,
      cameraAltitude: altitude,
      targetAltitude,
    };
    this.store.set({
      view: this.drawn ?? drawn,
      extent: this.extent,
      heading,
      northAngle,
      fov,
      forward: sceneWay,
      altitude,
      targetAltitude,
      camera: cameraAt,
      target,
      center: o.center,
    } satisfies MinimapState);
  }

  dispose() {
    this.container.removeEventListener('wheel', this.onWheel);
    this.container.removeEventListener('pointerdown', this.onPanStart);
    this.container.removeEventListener('pointermove', this.onPanMove);
    this.container.removeEventListener('pointerup', this.onPanEnd);
    this.container.removeEventListener('pointercancel', this.onPanEnd);
    this.container.removeEventListener('contextmenu', this.onContextMenu);
    this.renderer?.dispose();
    this.renderer = null;
    this.relief = null;
    this.camera = null;
    this.controls = null;
    this.container.remove();
  }

  // What the map is drawn in at the extent now: fixed, or with 'auto' the global projection
  // from `globalFrom` on, and back to the scene's map only once well under it.
  private projectionFor(o: MinimapOptions): 'scene' | MapProjection['name'] {
    if (!o.toLonLat || !o.toXZ) return 'scene';
    if (o.projection !== 'auto') return o.projection;
    const global = o.globalProjection;
    const from =
      this.kind === global ? o.globalFrom * GLOBAL_HYSTERESIS : o.globalFrom;
    return this.extent >= from ? global : 'scene';
  }

  // `view` as drawn in `kind`: itself in the scene's map, or carried into the projection's
  // plane about the meridian under its middle, so the antimeridian lies at the map's edge.
  private drawnView(
    view: MapView,
    kind: 'scene' | MapProjection['name'],
    o: MinimapOptions,
  ): MapView {
    if (kind === 'scene' || !o.toLonLat || !o.toXZ) return view;
    const [longitude, latitude] = o.toLonLat(view.center[0], view.center[1]);
    // A cone about the middle's parallel, its standard parallels following the map's
    // extent north–south unless fixed.
    const projection =
      kind === 'lambert-conformal-conic'
        ? lambertConformalConic(
            o.lambertParallels ??
              lambertParallelsFor(
                latitude,
                (Math.max(view.size[0], view.size[1]) * view.metresPerPixel) /
                  METRES_PER_DEGREE,
              ),
            latitude,
          )
        : MAP_PROJECTIONS[kind];
    const plane = mapPlane(projection, longitude, o.toLonLat, o.toXZ);
    return projectMapView(view, plane, o.orientation);
  }

  // Whether the map moved enough since it was last drawn to draw it again: a quarter pixel
  // of travel, a pixel's worth of turn at its edge, or a thousandth of its scale.
  private moved(view: MapView) {
    const last = this.view;
    if (!last) return true;
    if (
      last.size[0] !== view.size[0] ||
      last.size[1] !== view.size[1] ||
      Math.abs(view.metresPerPixel / last.metresPerPixel - 1) > 1e-3
    )
      return true;
    const travel = Math.hypot(
      view.center[0] - last.center[0],
      view.center[1] - last.center[1],
    );
    if (travel > MOVE_PIXELS * view.metresPerPixel) return true;
    const turn = Math.hypot(view.up[0] - last.up[0], view.up[1] - last.up[1]);
    return turn > 1 / Math.max(view.size[0], view.size[1]);
  }

  private applySize() {
    const o = this.options;
    if (!o || !this.renderer) return;
    this.renderer.setSize(
      o.width,
      o.height,
      Math.min(window.devicePixelRatio || 1, 2),
    );
    this.dirty = true;
  }
}
