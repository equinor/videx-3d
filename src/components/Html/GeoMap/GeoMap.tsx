import {
  forwardRef,
  useContext,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { GeneratorsContext } from '../../../contexts/GeneratorsContext';
import { useGenerator } from '../../../hooks/useGenerator';
import {
  RELIEF_TILE_CELLS,
  type ReliefLayer,
  type ReliefLayersSource,
} from '../../../sdk/geometries/relief-tiles';
import {
  geoFrameLonLat,
  geoFrameUtmZone,
  geoFrameXZ,
  utmZoneBounds,
  type GeoFrame,
} from '../../../sdk/projection/geo-frame';
import type { MapProjection } from '../../../sdk/projection/map-projections';
import {
  sceneryReliefTile,
  type SceneryReliefTileResponse,
} from '../../Scenery/scenery-defs';
import type {
  ReliefColor,
  ReliefLookProps,
} from '../../Scenery/scenery-relief-look';
import { useReliefLooks } from '../../Scenery/useReliefLooks';
import { useWorld } from '../../World/world-context';
import { GeoMapContext } from './geo-map-context';
import { GeoMapController, type GeoMapOptions } from './geo-map-controller';
import type { GeoMapMode, GeoMapTileSource } from './geo-map-renderer';
import type { GeoMapProjection, GeoMapView } from './geo-map-view';
import {
  GEO_MAP_CONTROLS,
  GeoMapItems,
  type GeoMapControl,
  type GeoMapExtraItem,
  type GeoMapLayout,
} from './GeoMapControls';
import { GeoMapZoneOutline } from './layers/GeoMapZoneOutline';

/**
 * The relief a {@link GeoMap} draws, as a `GeoRelief` takes it: give one object to both and
 * the map shows the scene's ground, as the scene colours it.
 *
 * @group Components
 */
export type ReliefSourceProps = {
  /**
   * The reliefs in the store (`relief-meta` and `relief-values`), coarse to fine: later ones
   * win where they have data. Merged onto the relief's tiles by the `sceneryReliefTile`
   * generator, so it needs a `GeneratorsProvider`. Any number, of any size: only the tiles in
   * view are read
   */
  layers?: ReliefLayer[];
  /** the flat seabed where no layer has data, metres below the sea */
  depth?: number;
};

/**
 * GeoMap props
 * @expand
 */
export type GeoMapProps = ReliefSourceProps &
  ReliefLookProps & {
    /**
     * how detailed the relief is: the most device pixels a cell of its tiles spans (32 cells
     * to a tile). Lower is sharper, for more tiles: about four times as many at half.
     * Default 2
     */
    cellPixels?: number;
    /** where the scene lies on the Earth. Default the enclosing `World`'s */
    frame?: GeoFrame;
    /**
     * What the map is drawn in:
     * - `'scene'`: the scene's own map (the `frame`'s projection, a transverse Mercator such
     *   as UTM): what the 3D view shows, true to scale for a few hundred kilometres about it;
     * - `'web-mercator'`: conformal, shapes and bearings true, areas growing toward the poles;
     * - `'equal-earth'`: equal-area, the whole world fairly;
     * - `'lambert-conformal-conic'`: conformal, and nearly true to scale between its two
     *   standard parallels. Its parallels follow the view unless given as
     *   `lambertParallels`;
     * - `'auto'`: the scene's map up to `globalFrom`, `globalProjection` past it.
     *
     * A projection is centred on the meridian under the map's middle, so the antimeridian is
     * its edge. A change cross-fades. Default `'auto'`
     */
    projection?: GeoMapProjection;
    /** `'auto'`: the projection past `globalFrom`. Default `'web-mercator'` */
    globalProjection?: MapProjection['name'];
    /** `'auto'`: the extent, metres across, from which `globalProjection` draws it. Default 2 000 000 */
    globalFrom?: number;
    /** `'lambert-conformal-conic'`: its two standard parallels, degrees, fixed. Default following the view */
    lambertParallels?: [number, number];
    /**
     * The bounds of the zone the scene's map is laid out for, `[west, south, east, north]` in
     * degrees, drawn dashed while the map is in the scene's map, or `false` for none. Default
     * the `frame`'s UTM zone
     */
    zoneBounds?: [number, number, number, number] | false;
    /** the zone's outline's colour. Default `'#ffffff'` */
    zoneColor?: string;
    /** `'shaded'`: coloured by height and lit by its slope; `'outline'`: the coast and contours as lines. Default `'shaded'` */
    mode?: GeoMapMode;
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

    /** the view, when the host controls it: changes to it are eased into */
    view?: GeoMapView;
    /** the view it starts at, when not controlled. Default 50 km across the frame's origin */
    defaultView?: GeoMapView;
    /** told the view once a pan or a zoom by the user has settled */
    onViewChange?: (view: Required<GeoMapView>) => void;
    /** the least metres across it zooms in to. Default 100 */
    minExtent?: number;
    /** the most metres across it zooms out to. Default 40 000 000 */
    maxExtent?: number;
    /** seconds a zoom takes to close all but 1/e of the way; 0 for none. Default 0.2 */
    smoothing?: number;
    /** drag the map (one finger) to pan it. Default true */
    pan?: boolean;
    /**
     * the wheel zooms `'smooth'`ly about the pointer, by `'steps'` (`onStepZoom`, or half
     * and double), or not at all (`'none'`). Pinching zooms smoothly. Default `'smooth'`
     */
    wheel?: 'smooth' | 'steps' | 'none';
    /** a double click zooms in about the pointer, with Shift out. Default true */
    doubleClickZoom?: boolean;
    /** focused, the arrow keys pan the map, + and − zoom it. Default true */
    keyboard?: boolean;
    /** asked for a step in (`1`) or out (`-1`) by the buttons, the keys or a `'steps'` wheel: zoom levels of the host's. Default half or double */
    onStepZoom?: (direction: 1 | -1) => void;

    /** which zoom buttons to show: `true` for both, `false` for none, or a list. Default `true` */
    controls?: boolean | GeoMapControl[];
    /** buttons of your own, after the map's own */
    buttons?: ReactNode;
    /** a compass turning with the map. Default `true` */
    compass?: boolean;
    /** what a click on the compass does. Default it turns the map north up */
    onCompassClick?: () => void;
    /** what the compass says on hover. Default `'North up'` */
    compassTitle?: string;
    /** the ground across the map, bottom left. Default `true` */
    extentLabel?: boolean;
    /** a scale bar of a round length, bottom right. Default `true` */
    scaleBar?: boolean;
    /** items of your own, placed with the map's */
    items?: GeoMapExtraItem[];
    /** where the compass, the buttons, the labels and your own items go */
    layout?: GeoMapLayout;

    /**
     * metres of map across per metre of a camera's height: how the layers' bands of heights
     * (`minHeight`, `maxHeight`, as in the scene) turn into bands of extents. Default 4
     */
    heightPerExtent?: number;
    /**
     * the most device pixels the relief is drawn with: a larger map is drawn at a lower pixel
     * ratio, so a full-screen map costs what a laptop can give. Default 4 000 000
     */
    maxPixels?: number;
    /** behind the relief, and where it has no data. Default a translucent dark */
    background?: string;
    /** the relief's opacity, 0 to 1. Default 1 */
    opacity?: number;
    /** what it is called, to a screen reader. Default `'Map'` */
    ariaLabel?: string;
    className?: string;
    /** styles over its own (it fills its container by default) */
    style?: CSSProperties;
    /**
     * Its layers: drawn on its canvas (`GeoMapPoints`, `GeoMapPolyline`, `GeoMapPolygons`,
     * `GeoMapLines`, …, `GeoMapCanvasLayer`), or in an SVG over it (`GeoMapSvgLayer`, a
     * `GeoMapCamera`'s markers)
     */
    children?: ReactNode;
  };

/**
 * What a {@link GeoMap}'s ref holds: its view, to read and set.
 *
 * @group Components
 */
export type GeoMapHandle = {
  /** the map's view now */
  getView: () => Required<GeoMapView> | null;
  /** set the view: at once, or eased into */
  setView: (view: GeoMapView, animate?: boolean) => void;
  /** zoom by `factor` (its extent times it) about its middle */
  zoomBy: (factor: number) => void;
};

const defaultColor: ReliefColor = {
  ramp: 'terrain',
  seabed: { ramp: 'bathymetry' },
};

const NO_LAYERS: ReliefLayer[] = [];

// The relief's tiles from the `sceneryReliefTile` generator, by the layers' content (layers
// written inline are new objects each render); null without layers or a generator.
function useGeoMapTileSource(
  layers: readonly ReliefLayer[],
  base: number,
): GeoMapTileSource | null {
  const provided = useContext(GeneratorsContext) !== null;
  const generate = useGenerator<SceneryReliefTileResponse>(sceneryReliefTile);
  const layerKey = JSON.stringify(
    layers.map(({ id, feather }) => [id, feather ?? 0]),
  );
  return useMemo<GeoMapTileSource | null>(() => {
    const specs = JSON.parse(layerKey) as [string, number][];
    if (!specs.length || !provided) return null;
    const plain: ReliefLayersSource = {
      layers: specs.map(([id, feather]) =>
        feather ? { id, feather } : { id },
      ),
      base,
    };
    return { base, load: key => generate(plain, key, RELIEF_TILE_CELLS) };
    // Without a provider the generator is new each render, and there are no tiles: null.
  }, [provided, generate, layerKey, base]);
}

/**
 * A map of the Earth: the relief, drawn top-down from the same tiles as a `GeoRelief` (its
 * layers merged in longitude and latitude, loaded only where and as finely as the map shows
 * them), in the scene's own map or a projection of the whole world, with layers over it —
 * drawn on a canvas as it moves, without a React render. Panned by dragging (one finger),
 * zoomed by the wheel, a pinch, a double click, its buttons or the keys, smoothly about the
 * pointer; north up, or turned.
 *
 * It fills its container — a page, a `Panel`, an `Overlay` item — and draws on a canvas and a
 * WebGL context of its own, only when its view changes or tiles come in. It needs no 3D view:
 * outside one, give it a `frame` (in a `World`, it takes the World's) and a
 * `GeneratorsProvider` with the `sceneryReliefTile` generator. A `GeoMapCamera` in it shows,
 * follows and moves the 3D view's camera; a `Minimap` is one in a panel.
 *
 * @see `documents/geo-map.md`
 *
 * @example
 * <GeneratorsProvider registry={registry}>
 *   <div style={{ width: '100vw', height: '100vh' }}>
 *     <GeoMap frame={frame} layers={reliefLayers} defaultView={{ center: [2, 58], extent: 300000 }}>
 *       <GeoMapPolygons data={licences} style={{ fill: '#2fbf4a' }} />
 *     </GeoMap>
 *   </div>
 * </GeneratorsProvider>
 *
 * @group Components
 */
export const GeoMap = forwardRef<GeoMapHandle, GeoMapProps>(
  (
    {
      layers = NO_LAYERS,
      depth = 100,
      cellPixels = 2,
      frame,
      projection = 'auto',
      globalProjection = 'web-mercator',
      globalFrom = 2000000,
      lambertParallels,
      zoneBounds,
      zoneColor = '#ffffff',
      mode = 'shaded',
      color = defaultColor,
      contours,
      layerLooks,
      shading,
      seaColor = '#1c4a66',
      outline,
      view,
      defaultView,
      onViewChange,
      minExtent = 100,
      maxExtent = 40000000,
      smoothing = 0.2,
      pan = true,
      wheel = 'smooth',
      doubleClickZoom = true,
      keyboard = true,
      onStepZoom,
      controls = true,
      buttons,
      compass = true,
      onCompassClick,
      compassTitle = 'North up',
      extentLabel = true,
      scaleBar = true,
      items,
      layout,
      heightPerExtent = 4,
      maxPixels = 4000000,
      background = 'rgba(8, 16, 24, 0.6)',
      opacity = 1,
      ariaLabel = 'Map',
      className,
      style,
      children,
    },
    ref,
  ) => {
    const world = useWorld();
    const mapFrame = frame ?? world?.frame ?? null;
    const container = useRef<HTMLDivElement>(null);
    const host = useRef<HTMLDivElement>(null);
    const [controller, setController] = useState<GeoMapController | null>(null);
    useLayoutEffect(() => {
      const made = new GeoMapController(container.current!, host.current!);
      setController(made);
      return () => {
        setController(null);
        made.dispose();
      };
    }, []);

    const frameKey = JSON.stringify(mapFrame);
    const toLonLat = useMemo(
      () => (mapFrame ? geoFrameLonLat(mapFrame) : null),
      // The frame by value.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [frameKey],
    );
    const toXZ = useMemo(
      () => (mapFrame ? geoFrameXZ(mapFrame) : null),
      // The frame by value.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [frameKey],
    );
    useEffect(() => {
      if (!mapFrame && import.meta.env.DEV)
        console.warn('GeoMap: give it a `frame`, or place it in a <World>');
    }, [mapFrame]);
    // The zone's bounds by value: a tuple written inline is a new array each render.
    const zoneKey =
      zoneBounds === false
        ? 'none'
        : zoneBounds
          ? JSON.stringify(zoneBounds)
          : '';
    const zone = useMemo(() => {
      if (zoneKey === 'none') return null;
      if (zoneKey)
        return JSON.parse(zoneKey) as [number, number, number, number];
      const utm = mapFrame ? geoFrameUtmZone(mapFrame) : null;
      return utm ? utmZoneBounds(utm.zone, utm.south) : null;
      // The frame by value.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [zoneKey, frameKey]);

    // The relief: its tiles and its looks, as a `GeoRelief`'s.
    const source = useGeoMapTileSource(layers, -depth);
    const idsKey = JSON.stringify(layers.map(layer => layer.id));
    const layerIds = useMemo(() => JSON.parse(idsKey) as string[], [idsKey]);
    const { looks, version } = useReliefLooks(
      { color, contours, layerLooks },
      layerIds,
    );
    useLayoutEffect(() => {
      controller?.setRelief(
        source ? { source, cellPixels, looks: looks.texture } : null,
      );
    }, [controller, source, cellPixels, looks]);
    // Written in place: the relief has to be drawn again to show it.
    useEffect(() => controller?.invalidateRelief(), [controller, version]);

    const parallelsKey = lambertParallels
      ? JSON.stringify(lambertParallels)
      : '';
    const options = useMemo<GeoMapOptions>(
      () => ({
        toLonLat,
        toXZ,
        projection,
        globalProjection,
        globalFrom,
        lambertParallels: parallelsKey
          ? (JSON.parse(parallelsKey) as [number, number])
          : null,
        appearance: {
          mode,
          exaggeration: shading?.exaggeration ?? 2,
          strength: shading?.strength ?? 0.8,
          seaColor,
          outlineColor: outline?.color ?? '#ffffff',
          outlineFill: outline?.fill ?? '#ffffff',
          outlineFillOpacity: outline?.fillOpacity ?? 0.15,
        },
        minExtent,
        maxExtent: Math.max(maxExtent, minExtent),
        smoothing,
        pan,
        wheel,
        doubleClickZoom,
        keyboard,
        maxPixels,
        heightPerExtent,
        opacity,
      }),
      [
        toLonLat,
        toXZ,
        projection,
        globalProjection,
        globalFrom,
        parallelsKey,
        mode,
        shading?.exaggeration,
        shading?.strength,
        seaColor,
        outline?.color,
        outline?.fill,
        outline?.fillOpacity,
        minExtent,
        maxExtent,
        smoothing,
        pan,
        wheel,
        doubleClickZoom,
        keyboard,
        maxPixels,
        heightPerExtent,
        opacity,
      ],
    );
    useLayoutEffect(() => {
      controller?.setOptions(options);
    }, [controller, options]);

    // The view: the host's, eased into as it changes; else where it starts, once a frame says
    // where the origin is.
    const viewKey = view ? JSON.stringify(view) : '';
    const placed = useRef(false);
    useLayoutEffect(() => {
      if (!controller || !toLonLat) return;
      if (viewKey) {
        controller.setView(JSON.parse(viewKey) as GeoMapView, placed.current);
        placed.current = true;
        return;
      }
      if (placed.current) return;
      placed.current = true;
      controller.setView(
        defaultView ?? { center: toLonLat(0, 0), extent: 50000 },
      );
      // Where it starts: once.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [controller, toLonLat, viewKey]);

    const latest = useRef({ onViewChange, onStepZoom });
    useEffect(() => {
      latest.current = { onViewChange, onStepZoom };
    });
    const stepped = !!onStepZoom;
    useEffect(() => {
      if (!controller) return;
      controller.onViewChange = next => latest.current.onViewChange?.(next);
      controller.onStepZoom = stepped
        ? direction => latest.current.onStepZoom?.(direction)
        : null;
    }, [controller, stepped]);

    useImperativeHandle(
      ref,
      () => ({
        getView: () => controller?.getView() ?? null,
        setView: (next, animate = true) => controller?.setView(next, animate),
        zoomBy: factor => controller?.zoomBy(factor),
      }),
      [controller],
    );

    const buttonsShown = useMemo(
      () => (controls === true ? GEO_MAP_CONTROLS : controls || []),
      [controls],
    );

    // Its gestures, handed to the controller: the same handlers each render.
    const handlers = useMemo(
      () => ({
        onPointerDown: (event: ReactPointerEvent) =>
          controller?.pointerDown(event.nativeEvent),
        onPointerMove: (event: ReactPointerEvent) =>
          controller?.pointerMove(event.nativeEvent),
        onPointerUp: (event: ReactPointerEvent) =>
          controller?.pointerUp(event.nativeEvent),
        onDoubleClick: (event: ReactMouseEvent) =>
          controller?.doubleClick(event.nativeEvent),
        onKeyDown: (event: ReactKeyboardEvent) =>
          controller?.keyDown(event.nativeEvent),
      }),
      [controller],
    );
    const compassShown = useMemo(
      () =>
        compass
          ? {
              title: compassTitle,
              onClick: () =>
                onCompassClick ? onCompassClick() : controller?.resetRotation(),
            }
          : null,
      [compass, compassTitle, onCompassClick, controller],
    );

    return (
      // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- a map is an `application`: panned and zoomed by the pointer and the keys (documents/linting.md)
      <div
        ref={container}
        className={className}
        role="application"
        aria-roledescription="map"
        aria-label={ariaLabel}
        // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- focused for its keys, as an `application` is (documents/linting.md)
        tabIndex={keyboard ? 0 : -1}
        onPointerDown={handlers.onPointerDown}
        onPointerMove={handlers.onPointerMove}
        onPointerUp={handlers.onPointerUp}
        onPointerCancel={handlers.onPointerUp}
        onDoubleClick={handlers.onDoubleClick}
        onKeyDown={handlers.onKeyDown}
        style={{
          position: 'relative',
          flex: '1 1 auto',
          width: '100%',
          height: '100%',
          minWidth: 0,
          minHeight: 0,
          overflow: 'hidden',
          boxSizing: 'border-box',
          userSelect: 'none',
          touchAction: 'none',
          outline: 'none',
          background,
          fontFamily: 'verdana, sans-serif',
          color: '#fff',
          cursor: pan ? 'grab' : undefined,
          ...style,
        }}
      >
        <div
          ref={host}
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
          }}
        />
        {controller && (
          <GeoMapContext.Provider value={controller}>
            {zone && toXZ && (
              <GeoMapZoneOutline bounds={zone} toXZ={toXZ} color={zoneColor} />
            )}
            <svg
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                width: '100%',
                height: '100%',
                pointerEvents: 'none',
                overflow: 'hidden',
              }}
            >
              {children}
            </svg>
            <GeoMapItems
              compass={compassShown}
              controls={buttonsShown}
              buttons={buttons}
              extent={extentLabel}
              distance={scaleBar}
              items={items}
              layout={layout}
            />
          </GeoMapContext.Provider>
        )}
      </div>
    );
  },
);
GeoMap.displayName = 'GeoMap';
