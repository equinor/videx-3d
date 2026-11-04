import type { Texture } from 'three';
import { MapLabelSpacer } from '../../../sdk/layers/map-draw';
import type { MapProjection } from '../../../sdk/projection/map-projections';
import {
  easeMapExtent,
  mapViewLonLatAt,
  mapViewLonLatToPixel,
  type MapView,
} from '../../../sdk/projection/map-view';
import type { Vec2 } from '../../../sdk/types/common';
import type { Rect2 } from '../../../sdk/utils/clip-2d';
import {
  GeoMapStore,
  type GeoMapCameraState,
  type GeoMapCanvasDraw,
  type GeoMapCanvasLayerHandle,
  type GeoMapCanvasTier,
  type GeoMapState,
} from './geo-map-context';
import {
  GeoMapRenderer,
  type GeoMapAppearance,
  type GeoMapTileSource,
} from './geo-map-renderer';
import {
  GEO_MAP_PROJECTION_FADE,
  geoMapHeading,
  geoMapKindFor,
  geoMapNorthAngle,
  geoMapView,
  geoMapViewMoved,
  lonLatDelta,
  METRES_PER_DEGREE,
  offsetLonLat,
  type GeoMapKind,
  type GeoMapProjection,
  type GeoMapView,
} from './geo-map-view';

/** What the controller needs of a {@link GeoMap}'s props, resolved. */
export type GeoMapOptions = {
  /** scene X/Z to longitude and latitude; null without a frame, when nothing is drawn */
  toLonLat: ((x: number, z: number) => Vec2) | null;
  /** longitude and latitude to scene X/Z; null without a frame */
  toXZ: ((longitude: number, latitude: number) => Vec2) | null;
  projection: GeoMapProjection;
  /** `'auto'`: the projection past `globalFrom` */
  globalProjection: MapProjection['name'];
  /** `'auto'`: the extent, metres, from which `globalProjection` draws it */
  globalFrom: number;
  /** a Lambert conformal conic's standard parallels, degrees; null to follow the view */
  lambertParallels: [number, number] | null;
  appearance: GeoMapAppearance;
  /** the least and the most metres across it zooms to */
  minExtent: number;
  maxExtent: number;
  /** seconds a change in zoom takes to close all but 1/e of it; 0 for none */
  smoothing: number;
  /** drag (or a finger) pans it */
  pan: boolean;
  /** the wheel zooms smoothly about the pointer, steps (`onStepZoom`), or does nothing */
  wheel: 'smooth' | 'steps' | 'none';
  /** a double click zooms in about the pointer (with Shift, out) */
  doubleClickZoom: boolean;
  /** with the map focused, the arrow keys pan it and + and − zoom it */
  keyboard: boolean;
  /** the most device pixels the relief is drawn with: past it, at a lower pixel ratio */
  maxPixels: number;
  /** metres of map across per metre of a camera's height, for the layers' bands */
  heightPerExtent: number;
  /** the relief's opacity, 0 to 1 */
  opacity: number;
};

/** What the map draws its relief from: where its tiles come from, how finely, and how it looks. */
export type GeoMapRelief = {
  source: GeoMapTileSource;
  /** device pixels a tile's cell spans, at most */
  cellPixels: number;
  /** `SceneryReliefLooks.texture`, not disposed by the controller */
  looks: Texture;
};

/**
 * What a map follows, as a `GeoMapCamera` tells it every time it moves: where to centre, the
 * extent it asks for, and the scene's direction to point up.
 */
export type GeoMapFollow = {
  /** longitude and latitude to centre on */
  center: Vec2;
  /** metres across it asks for (an adaptive zoom), or null to leave the zoom as it is */
  extent?: number | null;
  /** a direction in scene X/Z to point up (a heading-up map), or null for the map's own */
  upScene?: Vec2 | null;
};

type CanvasLayer = {
  tier: GeoMapCanvasTier;
  order: number;
  seq: number;
  draw: GeoMapCanvasDraw;
  animating: boolean;
};

type Gesture =
  | {
      kind: 'pan';
      view: MapView;
      x: number;
      y: number;
    }
  | {
      kind: 'pinch';
      distance: number;
      extent: number;
      lonLat: Vec2;
    };

// The seconds a panned map following something takes to close all but 1/e of the way back.
const PAN_RETURN_SECONDS = 0.12;
// How much a pixel of wheel zooms: e^(pixels x this).
const WHEEL_ZOOM = 0.002;
// Wheel pixels to a step, and the ms without a turn after which a partial one is forgotten.
const WHEEL_STEP = 60;
const WHEEL_IDLE_MS = 250;
// The most device pixels to a CSS pixel.
const MAX_PIXEL_RATIO = 2;
// What a key's pan moves, of the map's size.
const KEY_PAN = 0.125;

/**
 * The imperative half of a {@link GeoMap}: its canvases, its renderer, its view and the
 * gestures that change it, and its canvas layers. It draws on demand, on an animation frame
 * of its own, or at once when told to (`flush`, from a camera following in R3F's frame):
 * nothing while it holds still or is off the page.
 */
export class GeoMapController {
  readonly store: GeoMapStore;
  /** told the map's own view at the end of a gesture, once it has settled */
  onViewChange: (view: Required<GeoMapView>) => void = () => {};
  /** asked for a step of zoom (`1` in, `-1` out): a map zoomed by levels; null zooms itself */
  onStepZoom: ((direction: 1 | -1) => void) | null = null;

  private readonly element: HTMLElement;
  private readonly reliefSlot = document.createElement('div');
  private readonly canvases: Record<GeoMapCanvasTier, HTMLCanvasElement> = {
    features: document.createElement('canvas'),
    live: document.createElement('canvas'),
  };
  private readonly contexts: Partial<
    Record<GeoMapCanvasTier, CanvasRenderingContext2D>
  > = {};
  private renderer: GeoMapRenderer | null = null;
  private relief: GeoMapRelief | null = null;
  private options: GeoMapOptions | null = null;

  // The map's own view: where it is when it follows nothing.
  private center: Vec2 = [0, 0];
  private rotation = 0;
  // The extent shown, easing toward the one asked for.
  private extent = NaN;
  private extentTarget = 50000;
  private follow: GeoMapFollow | null = null;
  // While following: how far the user panned it from what it follows, in degrees.
  private panOffset: Vec2 = [0, 0];
  private frozen = false;
  private readonly pointers = new Map<number, Vec2>();
  private gesture: Gesture | null = null;
  // A zoom about a point: its ground stays under its pixel while the zoom eases.
  private anchor: { lonLat: Vec2; pixel: Vec2 } | null = null;
  private wheel = { pixels: 0, at: 0 };

  private size: Vec2 = [0, 0];
  private pixelRatio2d = 1;
  private drawn: MapView | null = null;
  private kind: GeoMapKind | null = null;
  private fade: { from: GeoMapKind; t: number } | null = null;
  private camera: Omit<GeoMapCameraState, 'heading'> | null = null;
  private stateNow: GeoMapState | null = null;
  // The boxes the map's own items take: no label is written over them.
  private reserved: Rect2[] = [];

  private readonly layers: CanvasLayer[] = [];
  private seq = 0;
  private reliefDirty = true;
  private paintDirty: Record<GeoMapCanvasTier, boolean> = {
    features: true,
    live: true,
  };
  private notify = true;
  private raf = 0;
  private last = 0;
  private visible = true;
  private viewChanged = false;
  private readonly resize: ResizeObserver;
  private readonly intersection: IntersectionObserver | null;

  /**
   * @param element the map's element: its size, and where its gestures are heard
   * @param host where its canvases go, under what else it shows
   */
  constructor(element: HTMLElement, host: HTMLElement) {
    this.element = element;
    const fill = {
      position: 'absolute',
      left: '0',
      top: '0',
      width: '100%',
      height: '100%',
      pointerEvents: 'none',
    };
    Object.assign(this.reliefSlot.style, fill, { lineHeight: '0' });
    host.appendChild(this.reliefSlot);
    for (const tier of ['features', 'live'] as const) {
      Object.assign(this.canvases[tier].style, fill, { display: 'none' });
      host.appendChild(this.canvases[tier]);
    }
    this.store = new GeoMapStore({
      view: { center: [0, 0], up: [0, -1], metresPerPixel: 1, size: [1, 1] },
      extent: 1,
      northAngle: 0,
      kind: 'scene',
      toLonLat: (x, z) => [x, z],
      toXZ: (x, z) => [x, z],
      heightPerExtent: 4,
      camera: null,
      labelSpacer: new MapLabelSpacer(1),
    });
    element.addEventListener('wheel', this.onWheel, { passive: false });
    this.resize = new ResizeObserver(entries => {
      const box = entries[entries.length - 1]?.contentRect;
      if (box) this.setSize(box.width, box.height);
    });
    this.resize.observe(element);
    this.intersection =
      typeof IntersectionObserver === 'undefined'
        ? null
        : new IntersectionObserver(entries => {
            const seen = entries[entries.length - 1]?.isIntersecting ?? true;
            if (seen === this.visible) return;
            this.visible = seen;
            if (seen) this.schedule();
          });
    this.intersection?.observe(element);
  }

  /** The view as last drawn, or null before the first. */
  get view() {
    return this.drawn;
  }

  /** The map's element: what its pixels are measured from. */
  get domElement() {
    return this.element;
  }

  /** The extent shown now, metres across the shorter side; NaN before the first frame. */
  get extentNow() {
    return this.extent;
  }

  /** The map's own view: what it is centred on, how far it is zoomed (the extent it eases to), how it is turned. */
  getView(): Required<GeoMapView> {
    return {
      center: this.centerNow(),
      extent: this.extentTarget,
      rotation: this.rotation,
    };
  }

  setOptions(options: GeoMapOptions) {
    const before = this.options;
    this.options = options;
    this.reliefSlot.style.opacity = String(options.opacity);
    this.extentTarget = this.clamp(this.extentTarget);
    if (
      !before ||
      before.maxPixels !== options.maxPixels ||
      before.toLonLat !== options.toLonLat
    )
      this.applySize();
    this.renderer?.setAppearance(options.appearance);
    this.markAll();
  }

  /**
   * Draw `relief`, or none (null). A renderer — a WebGL context — is made only for new looks:
   * a new source or detail is set on the one there is.
   */
  setRelief(relief: GeoMapRelief | null) {
    const was = this.relief;
    this.relief = relief;
    this.reliefDirty = true;
    this.schedule();
    if (relief && was && this.renderer && relief.looks === was.looks) {
      if (relief.source !== was.source) this.renderer.setSource(relief.source);
      this.renderer.setCellPixels(relief.cellPixels);
      return;
    }
    this.dropRenderer();
    if (!relief) return;
    let renderer: GeoMapRenderer;
    try {
      renderer = new GeoMapRenderer(relief.looks);
    } catch (error) {
      console.warn('GeoMap: no WebGL context to draw the relief on', error);
      return;
    }
    this.renderer = renderer;
    // A tile came in: draw the relief again, and choose what it wants next.
    renderer.onTiles = () => {
      this.reliefDirty = true;
      this.schedule();
    };
    renderer.canvas.addEventListener('webglcontextlost', this.onContextLost);
    renderer.canvas.addEventListener(
      'webglcontextrestored',
      this.onContextRestored,
    );
    renderer.setSource(relief.source);
    renderer.setCellPixels(relief.cellPixels);
    this.reliefSlot.appendChild(renderer.canvas);
    this.applySize();
    if (this.options) renderer.setAppearance(this.options.appearance);
  }

  /** Draw the relief again: its looks were written in place. */
  invalidateRelief() {
    this.reliefDirty = true;
    this.schedule();
  }

  /** Set the map's own view: at once, or eased into (`animate`, the zoom). */
  setView(view: GeoMapView, animate = false) {
    this.center = [view.center[0], view.center[1]];
    this.rotation = view.rotation ?? 0;
    this.extentTarget = this.clamp(view.extent);
    if (!animate) this.extent = this.extentTarget;
    this.anchor = null;
    this.markAll();
  }

  /**
   * Follow what `follow` says (a camera, its target), or stop following (null) where the map
   * is now. Ignored while frozen.
   */
  setFollow(follow: GeoMapFollow | null) {
    if (this.frozen) return;
    if (!follow && this.follow) {
      this.center = this.centerNow();
      this.panOffset = [0, 0];
    }
    if (follow?.extent) {
      this.extentTarget = this.clamp(follow.extent);
      // Starting to follow: at the extent asked for at once, not eased in from the map's own.
      if (!this.follow) this.extent = this.extentTarget;
    }
    this.follow = follow;
    this.schedule();
  }

  /** Where the camera is, for the markers and the live layers; null for none. */
  setCamera(camera: Omit<GeoMapCameraState, 'heading'> | null) {
    this.camera = camera;
    this.paintDirty.live = true;
    this.notify = true;
    this.schedule();
  }

  /** Hold the map still (`true`): a marker dragged follows the pointer, not the camera. */
  freeze(on: boolean) {
    this.frozen = on;
  }

  /**
   * The boxes the map's own items take, in its pixels (`[minX, minY, maxX, maxY]`): the
   * labels its layers write keep off them.
   */
  setReserved(boxes: Rect2[]) {
    this.reserved = boxes;
    this.paintDirty.features = true;
    this.paintDirty.live = true;
    this.schedule();
  }

  /** Zoom by `factor` (its extent times it): about `pixel`, or the middle. */
  zoomBy(factor: number, pixel?: Vec2) {
    const o = this.options;
    this.extentTarget = this.clamp(this.extentTarget * factor);
    this.anchor =
      pixel && !this.follow && this.drawn && o?.toLonLat
        ? {
            lonLat: mapViewLonLatAt(this.drawn, pixel[0], pixel[1], o.toLonLat),
            pixel,
          }
        : null;
    if (!this.follow) this.viewChanged = true;
    this.schedule();
  }

  /** Zoom in (`1`) or out (`-1`) a step: by the host's levels (`onStepZoom`), else by half or double. */
  stepZoom(direction: 1 | -1, pixel?: Vec2) {
    if (this.onStepZoom) this.onStepZoom(direction);
    else this.zoomBy(direction > 0 ? 0.5 : 2, pixel);
  }

  /** Turn the map's own view to north up. */
  resetRotation() {
    this.rotation = 0;
    this.viewChanged = true;
    this.markAll();
  }

  /** Draw a canvas layer, by `order` then in the order they came. */
  addCanvasLayer(layer: {
    tier: GeoMapCanvasTier;
    order: number;
    draw: GeoMapCanvasDraw;
  }): GeoMapCanvasLayerHandle {
    const entry: CanvasLayer = { ...layer, seq: this.seq++, animating: false };
    this.layers.push(entry);
    this.layers.sort((a, b) => a.order - b.order || a.seq - b.seq);
    this.paintDirty[layer.tier] = true;
    this.schedule();
    return {
      invalidate: () => {
        this.paintDirty[entry.tier] = true;
        this.schedule();
      },
      animate: on => {
        entry.animating = on;
        if (on) this.schedule();
      },
      remove: () => {
        const at = this.layers.indexOf(entry);
        if (at < 0) return;
        this.layers.splice(at, 1);
        this.paintDirty[entry.tier] = true;
        this.schedule();
      },
    };
  }

  // ---- gestures, from the map's element ----

  /** A press on the map: a pan begins, or with a second finger a pinch. */
  pointerDown(event: PointerEvent) {
    const o = this.options;
    if (!o?.pan || this.frozen || !this.drawn) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    // The map's own buttons are pressed, not the map.
    if ((event.target as Element | null)?.closest?.('button')) return;
    this.element.setPointerCapture(event.pointerId);
    this.pointers.set(event.pointerId, this.local(event));
    this.beginGesture();
  }

  pointerMove(event: PointerEvent) {
    if (!this.pointers.has(event.pointerId)) return;
    this.pointers.set(event.pointerId, this.local(event));
    const o = this.options;
    const g = this.gesture;
    if (!g || !o?.toLonLat) return;
    if (g.kind === 'pan') {
      const [x, y] = this.pointers.values().next().value as Vec2;
      const [w, h] = g.view.size;
      const centre = mapViewLonLatAt(
        g.view,
        w / 2 - (x - g.x),
        h / 2 - (y - g.y),
        o.toLonLat,
      );
      this.moveCentre(centre);
    } else {
      const [a, b] = [...this.pointers.values()];
      const distance = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const mid: Vec2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      if (!this.follow) {
        this.extentTarget = this.extent = this.clamp(
          (g.extent * g.distance) / Math.max(distance, 1),
        );
        this.anchor = { lonLat: g.lonLat, pixel: mid };
        this.viewChanged = true;
      }
    }
    this.schedule();
  }

  pointerUp(event: PointerEvent) {
    if (!this.pointers.delete(event.pointerId)) return;
    if (this.element.hasPointerCapture(event.pointerId))
      this.element.releasePointerCapture(event.pointerId);
    // The fingers left go on with what they do now.
    if (this.pointers.size) this.beginGesture();
    else {
      this.gesture = null;
      if (this.anchor && this.extent === this.extentTarget) this.anchor = null;
    }
    this.schedule();
  }

  /** A double click: a step in about the pointer (with Shift, out). */
  doubleClick(event: MouseEvent) {
    if (!this.options?.doubleClickZoom || this.frozen) return;
    if ((event.target as Element | null)?.closest?.('button')) return;
    this.stepZoom(event.shiftKey ? -1 : 1, this.local(event));
  }

  /** A key, with the map focused: the arrows pan, + and − zoom. */
  keyDown(event: KeyboardEvent) {
    const o = this.options;
    if (!o?.keyboard || !this.drawn || !o.toLonLat) return;
    const [w, h] = this.drawn.size;
    const pans: Record<string, Vec2> = {
      ArrowLeft: [-w * KEY_PAN, 0],
      ArrowRight: [w * KEY_PAN, 0],
      ArrowUp: [0, -h * KEY_PAN],
      ArrowDown: [0, h * KEY_PAN],
    };
    const pan = pans[event.key];
    if (pan && o.pan && !this.follow) {
      this.moveCentre(
        mapViewLonLatAt(this.drawn, w / 2 + pan[0], h / 2 + pan[1], o.toLonLat),
      );
      this.viewChanged = true;
    } else if (event.key === '+' || event.key === '=') this.stepZoom(1);
    else if (event.key === '-' || event.key === '_') this.stepZoom(-1);
    else return;
    event.preventDefault();
    this.schedule();
  }

  // ---- drawing ----

  /** Draw what changed at the next frame. */
  invalidate() {
    this.markAll();
  }

  /**
   * Draw what changed now — the relief, the canvas layers, the layers told — rather than at
   * the next frame: from a camera following in the 3D view's frame, so the map moves with it.
   */
  flush() {
    if (this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
    const now = performance.now();
    const dt = this.last ? Math.min((now - this.last) / 1000, 0.1) : 0;
    this.last = now;
    const o = this.options;
    if (
      !o?.toLonLat ||
      !o.toXZ ||
      this.size[0] < 1 ||
      this.size[1] < 1 ||
      !this.visible
    ) {
      this.last = 0;
      return;
    }
    const animating = this.step(dt, o);
    this.draw(o);
    // The zoom about a point has eased in: its last frame drawn, the point let go.
    if (
      this.anchor &&
      this.extent === this.extentTarget &&
      this.gesture?.kind !== 'pinch'
    )
      this.anchor = null;
    if (animating || this.layers.some(layer => layer.animating))
      this.schedule();
    else {
      // At rest: the next change starts from no time gone.
      this.last = 0;
      if (this.viewChanged && !this.gesture) {
        this.viewChanged = false;
        this.onViewChange(this.getView());
      }
    }
  }

  dispose() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.element.removeEventListener('wheel', this.onWheel);
    this.resize.disconnect();
    this.intersection?.disconnect();
    this.dropRenderer();
    this.relief = null;
    this.layers.length = 0;
    this.reliefSlot.remove();
    for (const canvas of Object.values(this.canvases)) canvas.remove();
  }

  private readonly onWheel = (event: WheelEvent) => {
    const o = this.options;
    if (!o || o.wheel === 'none' || this.frozen) return;
    event.preventDefault();
    event.stopPropagation();
    // In pixels, whatever the wheel counts in.
    const scale =
      event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? this.size[1] : 1;
    const pixels = event.deltaY * scale;
    if (o.wheel === 'steps' || (this.follow && this.onStepZoom)) {
      const now = performance.now();
      if (now - this.wheel.at > WHEEL_IDLE_MS) this.wheel.pixels = 0;
      this.wheel.at = now;
      this.wheel.pixels += pixels;
      // A notch of a wheel is a step; a trackpad's flicks add up to one.
      if (Math.abs(this.wheel.pixels) >= WHEEL_STEP || event.deltaMode !== 0) {
        this.stepZoom(this.wheel.pixels < 0 ? 1 : -1);
        this.wheel.pixels = 0;
      }
      return;
    }
    this.zoomBy(Math.exp(pixels * WHEEL_ZOOM), this.local(event));
  };

  private readonly onContextLost = (event: Event) => {
    // Kept, so the browser gives it back.
    event.preventDefault();
  };

  private readonly onContextRestored = () => {
    // Its textures went with it: a renderer made again, its tiles loaded again.
    const relief = this.relief;
    this.dropRenderer();
    this.relief = null;
    this.setRelief(relief);
  };

  private dropRenderer() {
    const renderer = this.renderer;
    if (!renderer) return;
    renderer.canvas.removeEventListener('webglcontextlost', this.onContextLost);
    renderer.canvas.removeEventListener(
      'webglcontextrestored',
      this.onContextRestored,
    );
    renderer.canvas.remove();
    renderer.dispose();
    this.renderer = null;
  }

  // The pointer's pixel on the map, from its top left.
  private local(event: { clientX: number; clientY: number }): Vec2 {
    const rect = this.element.getBoundingClientRect();
    return [event.clientX - rect.left, event.clientY - rect.top];
  }

  private beginGesture() {
    const o = this.options;
    const view = this.drawn;
    if (!view || !o?.toLonLat) return;
    const points = [...this.pointers.values()];
    this.anchor = null;
    if (points.length === 1) {
      this.gesture = { kind: 'pan', view, x: points[0][0], y: points[0][1] };
      return;
    }
    const [a, b] = points;
    const mid: Vec2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    this.gesture = {
      kind: 'pinch',
      distance: Math.max(Math.hypot(b[0] - a[0], b[1] - a[1]), 1),
      extent: this.extent,
      lonLat: mapViewLonLatAt(view, mid[0], mid[1], o.toLonLat),
    };
  }

  // The map's middle moved to `centre` by the user: its own, or, following, how far off it is.
  private moveCentre(centre: Vec2) {
    if (this.follow) this.panOffset = lonLatDelta(this.follow.center, centre);
    else {
      this.center = centre;
      this.viewChanged = true;
    }
  }

  private centerNow(): Vec2 {
    return this.follow
      ? offsetLonLat(this.follow.center, this.panOffset)
      : this.center;
  }

  private clamp(extent: number) {
    const o = this.options;
    if (!o || !Number.isFinite(extent)) return extent;
    return Math.min(Math.max(extent, o.minExtent), o.maxExtent);
  }

  private markAll() {
    this.reliefDirty = true;
    this.paintDirty.features = true;
    this.paintDirty.live = true;
    this.notify = true;
    this.schedule();
  }

  private schedule() {
    if (!this.raf) this.raf = requestAnimationFrame(this.tick);
  }

  private readonly tick = () => {
    this.raf = 0;
    this.flush();
  };

  // The animations' step: the zoom easing, a panned map going back, a projection fading.
  private step(dt: number, o: GeoMapOptions): boolean {
    let animating = false;
    if (!Number.isFinite(this.extent)) this.extent = this.extentTarget;
    else if (this.extent !== this.extentTarget) {
      this.extent = easeMapExtent(
        this.extent,
        this.extentTarget,
        dt,
        o.smoothing,
      );
      animating = this.extent !== this.extentTarget;
    }
    if (
      this.follow &&
      this.gesture?.kind !== 'pan' &&
      (this.panOffset[0] !== 0 || this.panOffset[1] !== 0)
    ) {
      const keep = Math.exp(-dt / PAN_RETURN_SECONDS);
      const next: Vec2 = [this.panOffset[0] * keep, this.panOffset[1] * keep];
      const latitude = (this.follow.center[1] * Math.PI) / 180;
      const metres =
        Math.hypot(next[0] * Math.cos(latitude), next[1]) * METRES_PER_DEGREE;
      const pixel = this.extent / Math.max(Math.min(...this.size), 1);
      this.panOffset = metres < 0.1 * pixel ? [0, 0] : next;
      animating = true;
    }
    const kind = geoMapKindFor(
      o.projection,
      this.extent,
      o.globalProjection,
      o.globalFrom,
      this.kind,
    );
    if (kind !== this.kind) {
      if (this.kind !== null && this.renderer)
        this.fade = { from: this.kind, t: 0 };
      this.kind = kind;
      this.reliefDirty = true;
    }
    if (this.fade) {
      this.fade.t += dt / GEO_MAP_PROJECTION_FADE;
      if (this.fade.t >= 1) this.fade = null;
      this.reliefDirty = true;
      animating = true;
    }
    return animating;
  }

  private buildView(lonLat: Vec2, kind: GeoMapKind, o: GeoMapOptions) {
    return geoMapView({
      lonLat,
      extent: this.extent,
      size: this.size,
      rotation: this.rotation,
      upScene: this.follow?.upScene ?? null,
      kind,
      toLonLat: o.toLonLat!,
      toXZ: o.toXZ!,
      lambertParallels: o.lambertParallels,
    });
  }

  private draw(o: GeoMapOptions) {
    const kind = this.kind ?? 'scene';
    let lonLat = this.centerNow();
    let view = this.buildView(lonLat, kind, o);
    // A zoom about a point: the middle moved so its ground stays under its pixel. Moving the
    // middle changes a projection's scale there (Mercator's grows toward the poles): a few
    // steps bring it in.
    const anchor = this.anchor;
    if (anchor && !this.follow) {
      for (let k = 0; k < 4; k++) {
        const [px, py] = mapViewLonLatToPixel(
          view,
          anchor.lonLat[0],
          anchor.lonLat[1],
          o.toXZ!,
        );
        if (!Number.isFinite(px) || !Number.isFinite(py)) break;
        const dx = px - anchor.pixel[0];
        const dy = py - anchor.pixel[1];
        if (Math.abs(dx) < 0.05 && Math.abs(dy) < 0.05) break;
        lonLat = mapViewLonLatAt(
          view,
          this.size[0] / 2 + dx,
          this.size[1] / 2 + dy,
          o.toLonLat!,
        );
        this.center = lonLat;
        view = this.buildView(lonLat, kind, o);
      }
    }
    if (geoMapViewMoved(this.drawn, view)) {
      this.drawn = view;
      this.reliefDirty = true;
      this.paintDirty.features = true;
      this.paintDirty.live = true;
      this.notify = true;
    }
    const drawn = this.drawn ?? view;
    if (this.reliefDirty && this.renderer) {
      const fade = this.fade;
      // Eased: the new projection comes in, and the old goes, gently at both ends.
      const t = fade ? fade.t * fade.t * (3 - 2 * fade.t) : 1;
      this.renderer.setView(
        fade
          ? [
              { view: this.buildView(lonLat, fade.from, o), opacity: 1 - t },
              { view: drawn, opacity: t },
            ]
          : { view: drawn, opacity: 1 },
        o.toLonLat!,
        o.toXZ!,
      );
      this.renderer.render();
    }
    this.reliefDirty = false;
    this.stateNow = null;
    if (this.paintDirty.features) this.paint('features', o);
    if (this.paintDirty.live) this.paint('live', o);
    if (this.notify) {
      this.notify = false;
      this.store.set(this.state(o));
    }
  }

  // The state the layers are told, made once a frame.
  private state(o: GeoMapOptions): GeoMapState {
    if (this.stateNow) return this.stateNow;
    const view = this.drawn!;
    const camera = this.camera;
    this.stateNow = {
      view,
      extent: this.extent,
      northAngle: geoMapNorthAngle(view),
      kind: this.kind ?? 'scene',
      toLonLat: o.toLonLat!,
      toXZ: o.toXZ!,
      heightPerExtent: o.heightPerExtent,
      camera: camera
        ? {
            ...camera,
            heading: geoMapHeading(view, camera.camera, camera.forward),
          }
        : null,
      labelSpacer: this.labelSpacer(view),
    };
    return this.stateNow;
  }

  // A spacer for one drawing's labels, the map's own items' room taken already.
  private labelSpacer(view: MapView) {
    const spacer = new MapLabelSpacer(view.size[0]);
    for (const box of this.reserved) spacer.take(box, 0);
    return spacer;
  }

  private paint(tier: GeoMapCanvasTier, o: GeoMapOptions) {
    this.paintDirty[tier] = false;
    const canvas = this.canvases[tier];
    const any = this.layers.some(layer => layer.tier === tier);
    // An empty canvas is cleared once, and not composited.
    if (!any && canvas.style.display === 'none') return;
    const ctx = (this.contexts[tier] ??= canvas.getContext('2d') ?? undefined);
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    canvas.style.display = any ? '' : 'none';
    if (!any) return;
    // The labels of this canvas's layers share one spacer: none covers another.
    const shared = this.state(o);
    const state: GeoMapState = {
      ...shared,
      labelSpacer: this.labelSpacer(shared.view),
    };
    for (const layer of this.layers) {
      if (layer.tier !== tier) continue;
      ctx.setTransform(this.pixelRatio2d, 0, 0, this.pixelRatio2d, 0, 0);
      ctx.save();
      try {
        layer.draw(ctx, state);
      } catch (error) {
        console.error('GeoMap: a canvas layer failed to draw', error);
      }
      ctx.restore();
    }
  }

  private setSize(width: number, height: number) {
    if (width === this.size[0] && height === this.size[1]) return;
    this.size = [width, height];
    this.applySize();
  }

  private applySize() {
    const [width, height] = this.size;
    if (width < 1 || height < 1) return;
    const device = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
    // The relief within its budget of device pixels: a large map at a lower ratio.
    const budget = this.options?.maxPixels ?? Infinity;
    const ratio = Math.max(
      Math.min(device, Math.sqrt(budget / (width * height))),
      0.25,
    );
    this.renderer?.setSize(width, height, ratio);
    this.pixelRatio2d = device;
    for (const canvas of Object.values(this.canvases)) {
      canvas.width = Math.max(Math.round(width * device), 1);
      canvas.height = Math.max(Math.round(height * device), 1);
    }
    this.markAll();
  }
}
