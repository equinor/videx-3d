import { useFrame, useThree } from '@react-three/fiber';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Corner } from '../../../common/corner-style';
import { useGenerator } from '../../../hooks/useGenerator';
import type { ReliefLayer } from '../../../sdk/geometries/relief-tiles';
import {
  geoFrameLonLat,
  type GeoFrame,
} from '../../../sdk/projection/geo-frame';
import type { MapOrientation } from '../../../sdk/projection/map-view';
import type { Vec2 } from '../../../sdk/types/common';
import {
  sceneryRelief,
  type SceneryReliefResponse,
} from '../../Scenery/scenery-defs';
import { SCENERY_RELIEF_FAR_MAX_LAYERS } from '../../Scenery/scenery-relief';
import {
  SceneryReliefLooks,
  type ReliefColor,
  type ReliefContours,
  type ReliefLook,
} from '../../Scenery/scenery-relief-look';
import { useWorld } from '../../World/world-context';
import type { MinimapCenter } from './minimap-context';
import {
  MinimapController,
  type MinimapHome,
  type MinimapOptions,
  type MinimapRelief,
  type MinimapZoom,
} from './minimap-controller';
import {
  resolveMinimapAltitudeControl,
  type MinimapAltitudeControlOptions,
  type MinimapLayout,
} from './minimap-layout';
import type { MinimapMode } from './minimap-renderer';
import {
  MINIMAP_CONTROLS,
  MinimapOverlay,
  type MinimapControl,
} from './MinimapOverlay';

/** The extents a minimap zooms between by default, in metres across its shorter side. */
export const MINIMAP_DEFAULT_ZOOMS = [1000, 5000, 25000, 100000];

/**
 * Minimap props
 * @expand
 */
export type MinimapProps = {
  /**
   * The reliefs in the store (`relief-meta` and `relief-values`), coarse to fine: later ones
   * win where they have data, as a `SceneryStage`'s `relief.layers` do. Read by the
   * `sceneryRelief` generator, so it needs a `GeneratorsProvider`. At most six are used.
   */
  layers: ReliefLayer[];
  /** the height where no layer has data, metres over the sea. Default -100 */
  base?: number;
  /** the most texels a layer's map may have along either side: each is held on the GPU. Default 2048 */
  maxSize?: number;
  /** where the scene lies on the Earth. Default the enclosing `World`'s */
  frame?: GeoFrame;

  /** `'shaded'`: coloured by height and lit by its slope; `'outline'`: the coast and contours as lines. Default `'shaded'` */
  mode?: MinimapMode;
  /**
   * what points up the map: `'north-up'` (the scene's map north) or `'heading-up'` (where the
   * camera looks). The compass toggles it. Give it to control the orientation; the compass
   * then asks for a change through `onOrientationChange`. Default `'north-up'` (see
   * `defaultOrientation`)
   */
  orientation?: MapOrientation;
  /** the orientation before the user changes it, when not controlled. Default `'north-up'` */
  defaultOrientation?: MapOrientation;
  onOrientationChange?: (orientation: MapOrientation) => void;
  /**
   * what the map is centred on: `'camera'`, or `'target'`: what the camera looks at, at the
   * sea's level (the controls' target — R3F's `state.controls`, drei's `CameraControls` or
   * `OrbitControls` — dropped to it; without controls, where the view ray meets the sea).
   * The marker button toggles it. Give it to control it; the button then asks for a change
   * through `onCenterChange`.
   */
  center?: MinimapCenter;
  /** the centre before the user changes it, when not controlled. Default `'camera'` */
  defaultCenter?: MinimapCenter;
  onCenterChange?: (center: MinimapCenter) => void;
  /** the colour by height, as a `SceneryStage` relief's. Default the terrain ramp over the bathymetry ramp */
  color?: ReliefColor;
  /** contour lines, as a `SceneryStage` relief's. Default none */
  contours?: boolean | ReliefContours;
  /** a look of its own for a layer, by id */
  layerLooks?: Record<string, ReliefLook>;
  /** shaded mode: the slope's lighting */
  shading?: {
    /** vertical exaggeration of the slope. Default 2 */
    exaggeration?: number;
    /** how strongly it shades, 0 to 1. Default 0.8 */
    strength?: number;
  };
  /** the sea's colour where the look's seabed takes it. Default `'#1c4a66'` */
  seaColor?: string;
  /** outline mode */
  outline?: {
    /** the coast's and the contours' colour. Default white */
    color?: string;
    /** the land's fill. Default white */
    fill?: string;
    /** Default 0.15 */
    fillOpacity?: number;
  };

  /**
   * The zoom levels, in metres across the minimap's shorter side, ascending. Default
   * {@link MINIMAP_DEFAULT_ZOOMS}: 1, 5, 25 and 100 km.
   */
  zooms?: number[];
  /**
   * `'auto'` zooms with the camera's height over the sea (the adaptive mode: the nearer the
   * ground, the finer the map); a number is an index into `zooms`. Give it to control the zoom;
   * its buttons and wheel then ask for a change through `onZoomChange`.
   */
  zoom?: MinimapZoom;
  /** the zoom before the user changes it, when not controlled. Default `'auto'` */
  defaultZoom?: MinimapZoom;
  onZoomChange?: (zoom: MinimapZoom) => void;
  /** `'auto'`: metres of map across per metre of height. Default 4 */
  autoZoomFactor?: number;
  /** `'auto'`: seconds a change in zoom takes (to close all but 1/e of it); 0 for none. Default 0.3 */
  autoZoomSmoothing?: number;
  /**
   * the sea's height in the scene (Y), what heights are measured from: the readout, `'auto'`
   * and the altitude control. Under a `Scenery` they are over its globe's sea, so far from the
   * field, where the sea curves below Y = 0, they are still heights over it. Default 0
   */
  level?: number;
  /** zoom with the mouse wheel over the map. Default `true` */
  wheelZoom?: boolean;
  /**
   * Which buttons to show: `true` for all of {@link MINIMAP_CONTROLS}, `false` for none, or a
   * list of them, in the order they are shown: `'zoom-in'`, `'zoom-out'`, `'zoom-auto'` and
   * `'center'` (the camera / target toggle, drawn as the marker it centres on). Default `true`
   */
  controls?: boolean | MinimapControl[];
  /** a compass turning with the map, which a click toggles north-up and heading-up. Default `true` */
  compass?: boolean;
  /**
   * whether dropping a marker (`MinimapCameraMarker`, `MinimapTargetMarker`) moves the scene's
   * controls (R3F's `state.controls`: drei's `CameraControls`, which fly there, or
   * `OrbitControls`): the camera marker flies the camera, with its target, to the drop; the
   * target marker re-aims the camera at it. Both keep their heights. Set it to `false` to
   * handle the drop yourself in `onMarkerDrop`. Default `true`
   */
  dragControls?: boolean;
  /** a marker was dropped on the map, at scene X/Z (a drop outside the map, or cancelled, is not reported) */
  onMarkerDrop?: (kind: 'camera' | 'target', at: Vec2) => void;
  /**
   * the altitude readout, top centre: the height over the sea of what the map is centred on (the
   * camera, or its target), as text like the extent. A display only; see `altitudeControl`.
   * Default `true`
   */
  altitude?: boolean;
  /**
   * the altitude control: a slim vertical control fixed on the map, on its left edge, to change
   * the height of what the map is centred on. Pull its knob up to climb or down to descend: it
   * sets the speed directly, in metres a second, the same at any height, growing with the square
   * of how far the knob is from the middle up to `maxSpeed` at the end of its travel. Held at
   * the end it accelerates, doubling every `boostTime` seconds up to `boost` times `maxSpeed`;
   * pulled back from the end it is at once direct again. Let go and it springs back, Escape puts
   * the height back. `true` for the defaults, `false` to leave it out, or
   * {@link MinimapAltitudeControlOptions}: the range (default -5 km to +50 km), `maxSpeed`
   * (100), `boost` (200) and `boostTime` (1), the travel (`dragRange`) and the `color`. It moves
   * the controls as dropping a marker does (see `dragControls`): the camera takes its target
   * along, at the same angle; its target alone leaves the camera. Dimmed and inert without
   * controls. Default `true`
   */
  altitudeControl?: boolean | MinimapAltitudeControlOptions;
  /**
   * where the compass, the altitude readout and control, the buttons and the extent and
   * distance labels go: an anchor each (a corner, or the middle of an edge), how the buttons
   * flow (`direction`) and, among those at one anchor, their `order`. See
   * `MINIMAP_DEFAULT_LAYOUT`
   */
  layout?: MinimapLayout;
  /**
   * the pose the camera and its target go back to when the marker button is double-clicked:
   * `{ position, target }` in the scene. Default the pose they had at the first frame
   */
  home?: MinimapHome;
  /** pan the map by dragging it with the right mouse button; it eases back to its centre on release. Default `true` */
  pan?: boolean;

  /** in CSS pixels. Default 220 */
  width?: number;
  /** in CSS pixels. Default 220 */
  height?: number;
  /** the corner it sits in, as a `Panel`'s. Default `'bottom-right'` */
  origin?: Corner;
  /** pixels in from the corner, `[x, y]`. Default `[10, 10]` */
  offset?: [number, number];
  /** behind the relief, and where it has no data. Default a translucent dark */
  background?: string;
  /** CSS border, e.g., '1px solid white'. Default '1px solid white' */
  border?: string;
  /** Default 1 */
  borderRadius?: number;
  /** the relief's opacity, 0 to 1. Default 1 */
  opacity?: number;
  /** DOM element it is appended to. Default the renderer canvas's parent, falling back to `document.body` */
  parent?: HTMLElement | null;

  /**
   * Layers over the relief: SVG, in the minimap's pixels (`MinimapCameraMarker`,
   * `MinimapPoints`, `MinimapPolyline`, `MinimapLayer`, your own with `useMinimapFrame`).
   * They are rendered in a React root of their own, so they do not see the contexts the
   * `Canvas` provides.
   */
  children?: ReactNode;
};

const DEFAULT_OFFSET: [number, number] = [10, 10];

const defaultColor: ReliefColor = {
  ramp: 'terrain',
  seabed: { ramp: 'bathymetry' },
};

/**
 * An inlet map of the relief that follows the camera: a small panel over the canvas, drawn
 * top-down from the relief's layers (the same data as a `SceneryStage`'s `relief`, in
 * longitude and latitude, merged as its tiles and its overview merge them) in the scene's
 * map. It shows the relief shaded or as an outline, zooms between discrete levels or
 * automatically with the camera's height over the sea, turns north-up or heading-up, and
 * carries layers of your own as SVG.
 *
 * Place it inside a `<Canvas>` (it needs the camera) and a `GeneratorsProvider` with the
 * `sceneryRelief` generator. It draws on a canvas and a WebGL context of its own, only
 * when the view changes, so it costs no frame of the 3D view's. The layers' maps are held on
 * the GPU a second time, for that context: see `maxSize`.
 *
 * @see `documents/minimap.md`
 *
 * @example
 * <Minimap layers={[{ id: 'etopo-2022-nordic' }, { id: 'emodnet-2020-volve', feather: 500 }]}>
 *   <MinimapCameraMarker />
 *   <MinimapPoints points={wellheads} />
 * </Minimap>
 *
 * @group Components
 */
export const Minimap = ({
  layers,
  base = -100,
  maxSize = 2048,
  frame,
  mode = 'shaded',
  orientation,
  defaultOrientation = 'north-up',
  onOrientationChange,
  center,
  defaultCenter = 'camera',
  onCenterChange,
  color = defaultColor,
  contours,
  layerLooks,
  shading,
  seaColor = '#1c4a66',
  outline,
  zooms = MINIMAP_DEFAULT_ZOOMS,
  zoom,
  defaultZoom = 'auto',
  onZoomChange,
  autoZoomFactor = 4,
  autoZoomSmoothing = 0.3,
  level = 0,
  wheelZoom = true,
  controls = true,
  compass = true,
  dragControls = true,
  onMarkerDrop,
  altitude = true,
  altitudeControl = false,
  layout,
  home,
  pan = true,
  width = 220,
  height = 220,
  origin = 'bottom-right',
  offset = DEFAULT_OFFSET,
  background = 'rgba(8, 16, 24, 0.6)',
  border = '2px solid rgba(255, 255, 255, 0.9)',
  borderRadius = 2,
  opacity = 1,
  parent,
  children,
}: MinimapProps) => {
  const gl = useThree(state => state.gl);
  const world = useWorld();
  const mapFrame = frame ?? world?.frame ?? null;
  const globe = world?.globe ?? null;
  const generator = useGenerator<SceneryReliefResponse>(sceneryRelief);

  const [handle, setHandle] = useState<{
    controller: MinimapController;
    root: Root;
  } | null>(null);
  const controllerRef = useRef<MinimapController | null>(null);
  useEffect(() => {
    const host = parent ?? gl.domElement.parentElement ?? document.body;
    const controller = new MinimapController(host);
    const root = createRoot(controller.overlay);
    controllerRef.current = controller;
    setHandle({ controller, root });
    return () => {
      controllerRef.current = null;
      setHandle(null);
      controller.dispose();
      // Not while React is rendering: it warns of unmounting a root from inside one.
      setTimeout(() => root.unmount());
    };
  }, [gl, parent]);

  const [activeZoom, requestZoom] = useControllable(
    zoom,
    defaultZoom,
    onZoomChange,
  );
  const [activeOrientation, requestOrientation, orientationNow] =
    useControllable(orientation, defaultOrientation, onOrientationChange);
  const [activeCenter, requestCenter, centerNow] = useControllable(
    center,
    defaultCenter,
    onCenterChange,
  );

  // The relief's layers baked onto longitude and latitude, as the stage's overview bakes them.
  const layerKey = JSON.stringify(
    layers
      .slice(0, SCENERY_RELIEF_FAR_MAX_LAYERS)
      .map(({ id, feather }) => [id, feather ?? 0]),
  );
  useEffect(() => {
    if (import.meta.env.DEV && layers.length > SCENERY_RELIEF_FAR_MAX_LAYERS)
      console.warn(
        `Minimap: it draws the relief's first ${SCENERY_RELIEF_FAR_MAX_LAYERS} layers of ${layers.length}`,
      );
  }, [layers.length]);
  const [baked, setBaked] = useState<MinimapRelief['layers'] | null>(null);
  useEffect(() => {
    let current = true;
    const specs = JSON.parse(layerKey) as [string, number][];
    Promise.all(
      specs.map(([id, feather]) => generator(id, { feather, maxSize })),
    ).then(made => {
      if (!current) return;
      const grids = made.flatMap((grid, i) =>
        grid ? [{ grid, look: i + 1 }] : [],
      );
      setBaked(grids.length ? grids : null);
    });
    return () => {
      current = false;
      setBaked(null);
    };
  }, [generator, layerKey, maxSize]);

  const looks = useMemo(() => new SceneryReliefLooks(), []);
  useEffect(() => () => looks.dispose(), [looks]);
  const lookKey = JSON.stringify([color, contours, layerLooks, layerKey]);
  useEffect(() => {
    const specs = JSON.parse(layerKey) as [string, number][];
    looks.update(
      { color, contours },
      specs.map(([id]) => layerLooks?.[id]),
    );
    // Written in place: the map has to be drawn again to show it.
    handle?.controller.invalidate();
    // The look by value: an inline `color` is a new object each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [looks, lookKey, handle]);

  useEffect(() => {
    handle?.controller.setRelief(
      baked ? { layers: baked, base, looks: looks.texture } : null,
    );
  }, [handle, baked, base, looks]);

  const frameKey = JSON.stringify(mapFrame);
  const toLonLat = useMemo(
    () => (mapFrame ? geoFrameLonLat(mapFrame) : null),
    // The frame by value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [frameKey],
  );
  useEffect(() => {
    if (!mapFrame && import.meta.env.DEV)
      console.warn('Minimap: give it a `frame`, or place it in a <World>');
  }, [mapFrame]);

  const zoomsKey = JSON.stringify(zooms);
  const sortedZooms = useMemo(
    () => [...(JSON.parse(zoomsKey) as number[])].sort((a, b) => a - b),
    [zoomsKey],
  );
  // Objects the host may give inline, by value: a new one each render must not redraw the map.
  const homeKey = JSON.stringify(home ?? null);
  const stableHome = useMemo(
    () => (JSON.parse(homeKey) as MinimapHome | null) ?? undefined,
    [homeKey],
  );
  const altitudeControlKey = JSON.stringify(altitudeControl);
  const altitudeControlOptions = useMemo(() => {
    const given = JSON.parse(altitudeControlKey) as
      | boolean
      | MinimapAltitudeControlOptions
      | undefined;
    return given === false
      ? null
      : resolveMinimapAltitudeControl(typeof given === 'object' ? given : {});
  }, [altitudeControlKey]);
  const layoutKey = JSON.stringify(layout ?? null);
  const stableLayout = useMemo(
    () => (JSON.parse(layoutKey) as MinimapLayout | null) ?? undefined,
    [layoutKey],
  );
  const [offsetX, offsetY] = offset;
  const options = useMemo<MinimapOptions>(
    () => ({
      toLonLat,
      zooms: sortedZooms.length ? sortedZooms : MINIMAP_DEFAULT_ZOOMS,
      zoom: activeZoom,
      autoZoomFactor,
      autoZoomSmoothing,
      level,
      globe,
      center: activeCenter,
      orientation: activeOrientation,
      appearance: {
        mode,
        exaggeration: shading?.exaggeration ?? 2,
        strength: shading?.strength ?? 0.8,
        seaColor,
        outlineColor: outline?.color ?? '#ffffff',
        outlineFill: outline?.fill ?? '#ffffff',
        outlineFillOpacity: outline?.fillOpacity ?? 0.15,
      },
      width,
      height,
      origin,
      offset: [offsetX, offsetY],
      background,
      border,
      borderRadius,
      opacity,
      wheelZoom,
      dragControls,
      pan,
      home: stableHome,
    }),
    [
      toLonLat,
      sortedZooms,
      activeZoom,
      autoZoomFactor,
      autoZoomSmoothing,
      level,
      globe,
      activeCenter,
      activeOrientation,
      mode,
      shading?.exaggeration,
      shading?.strength,
      seaColor,
      outline?.color,
      outline?.fill,
      outline?.fillOpacity,
      width,
      height,
      origin,
      offsetX,
      offsetY,
      background,
      border,
      borderRadius,
      opacity,
      wheelZoom,
      dragControls,
      pan,
      stableHome,
    ],
  );
  useEffect(() => {
    handle?.controller.setOptions(options);
  }, [handle, options]);

  const autoZoom = useCallback(() => requestZoom('auto'), [requestZoom]);
  const stepZoom = useCallback(
    (direction: 1 | -1) => controllerRef.current?.stepZoom(direction),
    [],
  );
  const toggleOrientation = useCallback(
    () =>
      requestOrientation(
        orientationNow.current === 'heading-up' ? 'north-up' : 'heading-up',
      ),
    [requestOrientation, orientationNow],
  );
  const toggleCenter = useCallback(
    () => requestCenter(centerNow.current === 'target' ? 'camera' : 'target'),
    [requestCenter, centerNow],
  );
  useEffect(() => {
    if (!handle) return;
    handle.controller.onZoom = requestZoom;
  }, [handle, requestZoom]);
  const onDrop = useRef(onMarkerDrop);
  useEffect(() => {
    onDrop.current = onMarkerDrop;
  });
  useEffect(() => {
    if (!handle) return;
    handle.controller.onDrop = (kind, at) => onDrop.current?.(kind, at);
  }, [handle]);
  const buttons = useMemo(
    () => (controls === true ? MINIMAP_CONTROLS : controls || []),
    [controls],
  );
  const resetHome = useCallback(
    () => controllerRef.current?.store.host.reset(),
    [],
  );
  useEffect(() => {
    handle?.root.render(
      <MinimapOverlay
        store={handle.controller.store}
        zoom={activeZoom}
        center={activeCenter}
        orientation={activeOrientation}
        controls={buttons}
        compass={compass}
        altitude={altitude}
        altitudeControl={altitudeControlOptions}
        layout={stableLayout}
        onStep={stepZoom}
        onAuto={autoZoom}
        onToggleOrientation={toggleOrientation}
        onToggleCenter={toggleCenter}
        onReset={resetHome}
      >
        {children}
      </MinimapOverlay>,
    );
  }, [
    handle,
    activeZoom,
    activeCenter,
    activeOrientation,
    buttons,
    compass,
    altitude,
    altitudeControlOptions,
    stableLayout,
    stepZoom,
    autoZoom,
    toggleOrientation,
    toggleCenter,
    resetHome,
    children,
  ]);

  useFrame((state, dt) => {
    controllerRef.current?.update(state.camera, dt, state.controls);
  });

  return null;
};

// A value the host may control or leave to the component: `request` asks for a change, which
// the component takes itself unless the host gives `value`.
function useControllable<T>(
  value: T | undefined,
  initial: T,
  onChange?: (next: T) => void,
): [T, (next: T) => void, { readonly current: T }] {
  const [inner, setInner] = useState(initial);
  const controlled = value !== undefined;
  const shown = controlled ? value : inner;
  const latest = useRef({ controlled, onChange });
  // What it is now, ahead of the next render: a toggle clicked twice in a frame toggles twice.
  const current = useRef(shown);
  useEffect(() => {
    latest.current = { controlled, onChange };
    current.current = shown;
  });
  const request = useCallback((next: T) => {
    current.current = next;
    if (!latest.current.controlled) setInner(next);
    latest.current.onChange?.(next);
  }, []);
  return [shown, request, current];
}
