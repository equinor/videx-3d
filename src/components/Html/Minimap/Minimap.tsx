import { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import type { Corner } from '../../../common/corner-style';
import { useControllable } from '../../../hooks/useControllable';
import type { MapOrientation } from '../../../sdk/projection/map-view';
import { stepMapZoom } from '../../../sdk/projection/map-view';
import type { Vec2 } from '../../../sdk/types/common';
import { GeoMap, type GeoMapHandle, type GeoMapProps } from '../GeoMap/GeoMap';
import { GeoMapCamera, type GeoMapCameraHandle } from '../GeoMap/GeoMapCamera';
import type { GeoMapHome } from '../GeoMap/geo-map-camera';
import { useGeoMapFrame } from '../GeoMap/geo-map-context';
import type { GeoMapLayout } from '../GeoMap/GeoMapControls';
import { GeoMapIcon, GeoMapMarkerIcon } from '../GeoMap/GeoMapIcons';
import {
  formatHudAltitude,
  HUD_ACTIVE,
  HUD_BUTTON,
  HUD_IDLE,
  HUD_LABEL,
  setHudText,
} from '../hud';
import type { OverlayAnchor } from '../Overlay/overlay-context';
import {
  Panel,
  usePanel,
  type PanelCollapsed,
  type PanelResizeLimits,
} from '../Panel/Panel';

/** The extents a minimap zooms between by default, in metres across its shorter side. */
export const MINIMAP_DEFAULT_ZOOMS = [1000, 5000, 25000, 100000, 1000000];

/** How a minimap is zoomed: `'auto'` follows the camera's height; a number is an index into its `zooms`. */
export type MinimapZoom = 'auto' | number;

/** What a minimap is centred on: the camera, or what it looks at (its target, at the sea's level). */
export type MinimapCenter = 'camera' | 'target';

/**
 * A button a {@link Minimap} can show: `'zoom-in'`, `'zoom-out'`, `'zoom-auto'` (the
 * adaptive zoom), `'center'` (the camera / target toggle; double-click: home) and `'close'`
 * (into its button, a closable minimap's).
 *
 * @group Components
 */
export type MinimapControl =
  | 'zoom-in'
  | 'zoom-out'
  | 'zoom-auto'
  | 'center'
  | 'close';

/** Every {@link MinimapControl}, in the order they are shown by default. */
export const MINIMAP_CONTROLS: MinimapControl[] = [
  'zoom-in',
  'zoom-out',
  'zoom-auto',
  'center',
  'close',
];

/**
 * Minimap props
 * @expand
 */
export type MinimapProps = Omit<
  GeoMapProps,
  | 'view'
  | 'defaultView'
  | 'onViewChange'
  | 'wheel'
  | 'onStepZoom'
  | 'buttons'
  | 'items'
  | 'controls'
  | 'onCompassClick'
  | 'compassTitle'
  | 'minExtent'
  | 'maxExtent'
  | 'smoothing'
  | 'heightPerExtent'
  | 'layout'
  | 'pan'
  | 'doubleClickZoom'
  | 'keyboard'
  | 'children'
  | 'style'
> & {
  /**
   * what points up the map: `'north-up'` (the scene's map north) or `'heading-up'` (where the
   * camera looks). The compass toggles it. Give it to control it; the compass then asks for a
   * change through `onOrientationChange`
   */
  orientation?: MapOrientation;
  /** the orientation before the user changes it, when not controlled. Default `'north-up'` */
  defaultOrientation?: MapOrientation;
  onOrientationChange?: (orientation: MapOrientation) => void;
  /**
   * what the map is centred on: `'camera'`, or `'target'`: what the camera looks at, at the
   * sea's level. The marker button toggles it. Give it to control it; the button then asks
   * for a change through `onCenterChange`
   */
  center?: MinimapCenter;
  /** the centre before the user changes it, when not controlled. Default `'camera'` */
  defaultCenter?: MinimapCenter;
  onCenterChange?: (center: MinimapCenter) => void;

  /** The zoom levels, in metres across the minimap's shorter side, ascending. Default {@link MINIMAP_DEFAULT_ZOOMS}: 1, 5, 25, 100 and 1000 km */
  zooms?: number[];
  /**
   * `'auto'` zooms with the camera's height over the sea; a number is an index into `zooms`.
   * Give it to control the zoom; its buttons and wheel then ask through `onZoomChange`
   */
  zoom?: MinimapZoom;
  /** the zoom before the user changes it, when not controlled. Default `'auto'` */
  defaultZoom?: MinimapZoom;
  onZoomChange?: (zoom: MinimapZoom) => void;
  /** `'auto'`: metres of map across per metre of height. Default 4 */
  autoZoomFactor?: number;
  /** seconds a change in zoom takes (to close all but 1/e of it); 0 for none. Default 0.3 */
  autoZoomSmoothing?: number;
  /**
   * the sea's height in the scene (Y), what heights are measured from: the readout, `'auto'`.
   * In a `World`, over its globe's sea. Default 0
   */
  level?: number;
  /** step the zoom with the mouse wheel over the map. Default `true` */
  wheelZoom?: boolean;
  /**
   * which buttons to show, in order: `true` for all of {@link MINIMAP_CONTROLS} (`'close'` only
   * when `closable`), `false` for none, or a list. Default `true`
   */
  controls?: boolean | MinimapControl[];
  /**
   * whether dropping a marker (`GeoMapCameraMarker`, `GeoMapTargetMarker`) moves the scene's
   * controls (drei's `CameraControls`, which fly there, or `OrbitControls`). Set it to `false`
   * to handle the drop yourself in `onMarkerDrop`. Default `true`
   */
  dragControls?: boolean;
  /** a marker was dropped on the map, at scene X/Z */
  onMarkerDrop?: (kind: 'camera' | 'target', at: Vec2) => void;
  /** the height over the sea of what the map is centred on, top centre: a display. Default `true` */
  altitude?: boolean;
  /**
   * where the compass, the altitude readout (`altitude`), the buttons (`controls`) and the
   * extent and distance labels go (see `GeoMapLayout`)
   */
  layout?: GeoMapLayout;
  /** the pose a double-click on the marker button sends the camera back to. Default the pose it had at the first frame */
  home?: GeoMapHome;
  /** drag the map to look around; it eases back to its centre when let go. Default `true` */
  pan?: boolean;

  /** in CSS pixels, the width it starts at. Default 220 */
  width?: number;
  /** in CSS pixels, the height it starts at. Default 220 */
  height?: number;
  /** in an `Overlay`, where it sits. Default `origin` */
  anchor?: OverlayAnchor;
  /** in an `Overlay`, its order among the items at its anchor. Default 0 */
  order?: number;
  /** names it in the overlay's `layout` */
  id?: string;
  /**
   * outside an `Overlay`, the corner of its container it sits in (unless `inline`); either
   * way, its resize handles face away from it. Default `'bottom-right'`
   */
  origin?: Corner;
  /** outside an `Overlay`, at a corner: pixels in from it. Default `[10, 10]` */
  offset?: [number, number];
  /**
   * outside an `Overlay`: in the flow of its container, where a layout of your own puts it,
   * rather than at a corner of it. Default false
   */
  inline?: boolean;
  /** CSS border. Default `'2px solid rgba(255, 255, 255, 0.9)'` */
  border?: string;
  /** Default 2 */
  borderRadius?: number;
  /** resized by dragging its edges away from where it sits, within limits. Default `true`: at least 120 x 120 */
  resizable?: boolean | PanelResizeLimits;
  /** its size, `[width, height]`, when the host controls it */
  size?: [number, number];
  /** told once a resize ends */
  onSizeChange?: (size: [number, number]) => void;
  /**
   * it can be closed into a button (its `'close'` control), which opens it again: closed, the
   * map is unmounted — its WebGL context given back, nothing done per frame — and its size,
   * zoom, orientation and centre kept. Default `true`
   */
  closable?: boolean;
  /** whether it is open, when the host controls it */
  open?: boolean;
  /** whether it starts open, when not controlled. Default true */
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** the button a closed minimap becomes. Default a folded map, where the minimap sits */
  collapsed?: PanelCollapsed;
  /**
   * Its layers: `GeoMapCameraMarker`, `GeoMapTargetMarker`, and any of a `GeoMap`'s
   * (`GeoMapPoints`, `GeoMapPolygons`, …)
   */
  children?: ReactNode;
};

const RESIZE_LIMITS: PanelResizeLimits = { minWidth: 120, minHeight: 120 };

/**
 * An inlet map of the relief that follows the camera: a `GeoMap` with a `GeoMapCamera` in a
 * resizable, closable `Panel` — the relief shaded or as an outline, centred on the camera or
 * what it looks at, zoomed by level or by the camera's height, north-up or heading-up, with
 * layers of your own. Dragged, it looks around and eases back; its markers dropped on it fly
 * the camera there. Closed into its button, it is unmounted, and keeps its size, zoom,
 * orientation and centre for when it opens again.
 *
 * HTML that follows the 3D view's camera, so it needs the `Canvas`'s contexts: render it in
 * an `Overlay` (at `anchor`), or in a layout of your own in a `CanvasHtml` — over the view or
 * in an element of the page beside it — at a corner of its container (`origin`) or in its
 * flow (`inline`). Inside a `World` and a `GeneratorsProvider` with the `sceneryReliefTile`
 * generator. Not directly in the `<Canvas>`: it is not a 3D object.
 *
 * @see `documents/minimap.md`
 *
 * @example
 * <Overlay>
 *   <Minimap anchor="bottom-right" layers={[{ id: 'etopo-2022-nordic' }]}>
 *     <GeoMapTargetMarker />
 *     <GeoMapCameraMarker />
 *   </Minimap>
 * </Overlay>
 *
 * @group Components
 */
export const Minimap = ({
  zoom,
  defaultZoom = 'auto',
  onZoomChange,
  orientation,
  defaultOrientation = 'north-up',
  onOrientationChange,
  center,
  defaultCenter = 'camera',
  onCenterChange,
  width = 220,
  height = 220,
  anchor,
  order,
  id,
  origin = 'bottom-right',
  offset,
  inline,
  border = '2px solid rgba(255, 255, 255, 0.9)',
  borderRadius = 2,
  resizable = true,
  size,
  onSizeChange,
  closable = true,
  open,
  defaultOpen,
  onOpenChange,
  collapsed,
  ...rest
}: MinimapProps) => {
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
  return (
    <Panel
      anchor={anchor ?? origin}
      order={order}
      id={id}
      origin={origin}
      offset={offset}
      inline={inline}
      width={width}
      height={height}
      resizable={resizable === true ? RESIZE_LIMITS : resizable}
      size={size}
      onSizeChange={onSizeChange}
      closable={closable}
      closeButton={false}
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange}
      collapsed={{ icon: <GeoMapIcon />, title: 'Show the map', ...collapsed }}
      background="none"
      border={border}
      borderRadius={borderRadius}
      padding={0}
    >
      <MinimapBody
        {...rest}
        closable={closable}
        zoom={activeZoom}
        requestZoom={requestZoom}
        orientation={activeOrientation}
        toggleOrientation={toggleOrientation}
        center={activeCenter}
        toggleCenter={toggleCenter}
      />
    </Panel>
  );
};

type MinimapBodyProps = Omit<
  MinimapProps,
  'zoom' | 'orientation' | 'center'
> & {
  zoom: MinimapZoom;
  requestZoom: (zoom: MinimapZoom) => void;
  orientation: MapOrientation;
  toggleOrientation: () => void;
  center: MinimapCenter;
  toggleCenter: () => void;
};

// The height of what the map is centred on, as plain text like the extent: a display.
const AltitudeReadout = ({ center }: { center: MinimapCenter }) => {
  const label = useRef<HTMLSpanElement>(null);
  useGeoMapFrame(({ camera }) => {
    if (!camera) return;
    setHudText(
      label.current,
      formatHudAltitude(
        center === 'target' ? camera.targetAltitude : camera.altitude,
      ),
    );
  });
  return (
    <div
      title={`Height of the ${center} over the sea`}
      style={{
        ...HUD_LABEL,
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 4px',
      }}
    >
      <GeoMapMarkerIcon marker={center} box={12} size={10} />
      <span ref={label} />
    </div>
  );
};

// The map: following the camera, zoomed by level or with its height, its buttons the
// minimap's.
const MinimapBody = ({
  zooms = MINIMAP_DEFAULT_ZOOMS,
  zoom,
  requestZoom,
  orientation,
  toggleOrientation,
  center,
  toggleCenter,
  autoZoomFactor = 4,
  autoZoomSmoothing = 0.3,
  level = 0,
  wheelZoom = true,
  controls = true,
  dragControls = true,
  onMarkerDrop,
  altitude = true,
  layout,
  home,
  pan = true,
  closable = true,
  children,
  ...map
}: MinimapBodyProps) => {
  const panel = usePanel();
  const mapRef = useRef<GeoMapHandle>(null);
  const cameraRef = useRef<GeoMapCameraHandle>(null);
  const zoomsKey = JSON.stringify(zooms);
  const levels = useMemo(() => {
    const sorted = [...(JSON.parse(zoomsKey) as number[])].sort(
      (a, b) => a - b,
    );
    return sorted.length ? sorted : MINIMAP_DEFAULT_ZOOMS;
  }, [zoomsKey]);
  const levelAt = (index: number) =>
    levels[Math.min(Math.max(Math.round(index), 0), levels.length - 1)];
  const extent = zoom === 'auto' ? ('auto' as const) : levelAt(zoom);

  // A step in or out from where the map is: from its level when it has one (so a second click
  // before the first has eased in goes on a level), else from the adaptive extent now.
  const latest = useRef({ zoom, levels });
  useEffect(() => {
    latest.current = { zoom, levels };
  });
  const stepZoom = useCallback(
    (direction: 1 | -1) => {
      const { zoom: now, levels: list } = latest.current;
      const from =
        now === 'auto'
          ? (mapRef.current?.getView()?.extent ?? list[0])
          : list[Math.min(Math.max(Math.round(now), 0), list.length - 1)];
      requestZoom(stepMapZoom(list, from, direction));
    },
    [requestZoom],
  );
  const zoomIn = useCallback(() => stepZoom(1), [stepZoom]);
  const zoomOut = useCallback(() => stepZoom(-1), [stepZoom]);
  const zoomAuto = useCallback(() => requestZoom('auto'), [requestZoom]);
  const goHome = useCallback(() => cameraRef.current?.home(), []);

  const shown = controls === true ? MINIMAP_CONTROLS : controls || [];
  const onTarget = center === 'target';
  const auto = zoom === 'auto';
  const buttons = shown.map(control => {
    switch (control) {
      case 'zoom-in':
      case 'zoom-out': {
        const inward = control === 'zoom-in';
        const title = inward ? 'Zoom in' : 'Zoom out';
        return (
          <button
            key={control}
            type="button"
            style={HUD_BUTTON}
            title={title}
            aria-label={title}
            onClick={inward ? zoomIn : zoomOut}
          >
            {inward ? '+' : '−'}
          </button>
        );
      }
      case 'zoom-auto':
        return (
          <button
            key={control}
            type="button"
            style={{
              ...HUD_BUTTON,
              fontSize: 11,
              borderColor: auto ? HUD_ACTIVE : HUD_IDLE,
              color: auto ? HUD_ACTIVE : '#fff',
            }}
            title="Zoom with the camera's height"
            aria-label="Automatic zoom"
            aria-pressed={auto}
            onClick={zoomAuto}
          >
            A
          </button>
        );
      case 'center':
        return (
          <button
            key={control}
            type="button"
            style={HUD_BUTTON}
            title={
              (onTarget
                ? 'Centred on what the camera looks at: click to centre on the camera'
                : 'Centred on the camera: click to centre on what it looks at') +
              '. Double-click to send the camera home.'
            }
            aria-label={onTarget ? 'Centred on target' : 'Centred on camera'}
            aria-pressed={onTarget}
            onClick={toggleCenter}
            onDoubleClick={goHome}
          >
            <GeoMapMarkerIcon marker={center} box={22} size={16} />
          </button>
        );
      default:
        return closable && panel ? (
          <button
            key={control}
            type="button"
            style={HUD_BUTTON}
            title="Hide the map"
            aria-label="Hide the map"
            onClick={panel.close}
          >
            ×
          </button>
        ) : null;
    }
  });

  return (
    <GeoMap
      ref={mapRef}
      {...map}
      controls={false}
      buttons={buttons}
      items={
        altitude
          ? [
              {
                id: 'altitude',
                node: <AltitudeReadout center={center} />,
                placement: {
                  anchor: 'top-center',
                  direction: 'column',
                  order: 0,
                },
              },
            ]
          : undefined
      }
      layout={layout}
      wheel={wheelZoom ? 'steps' : 'none'}
      onStepZoom={stepZoom}
      pan={pan}
      doubleClickZoom={false}
      keyboard={false}
      minExtent={levels[0]}
      maxExtent={levels[levels.length - 1]}
      smoothing={autoZoomSmoothing}
      heightPerExtent={autoZoomFactor}
      compassTitle={
        orientation === 'north-up'
          ? 'North up: click to point the map where the camera looks'
          : 'Heading up: click to point the map north'
      }
      onCompassClick={toggleOrientation}
    >
      <GeoMapCamera
        ref={cameraRef}
        follow={center}
        extent={extent}
        autoZoomFactor={autoZoomFactor}
        autoZoomRange={[levels[0], levels[levels.length - 1]]}
        headingUp={orientation === 'heading-up'}
        level={level}
        dragControls={dragControls}
        onMarkerDrop={onMarkerDrop}
        home={home}
      >
        {children}
      </GeoMapCamera>
    </GeoMap>
  );
};
