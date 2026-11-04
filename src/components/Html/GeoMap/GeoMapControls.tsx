import { useCallback, useLayoutEffect, useRef, type ReactNode } from 'react';
import {
  anchorStack,
  anchorStyle,
  resolveAnchorLayout,
  type AnchorPlacement,
} from '../../../common/anchor';
import { mapScaleBar } from '../../../sdk/projection/map-view';
import type { Rect2 } from '../../../sdk/utils/clip-2d';
import { formatHudDistance, HUD_BUTTON, HUD_LABEL, setHudText } from '../hud';
import { useGeoMap, useGeoMapFrame } from './geo-map-context';

/**
 * A button a {@link GeoMap} can show: `'zoom-in'` and `'zoom-out'`.
 *
 * @group Components
 */
export type GeoMapControl = 'zoom-in' | 'zoom-out';

/** Every {@link GeoMapControl}, in the order they are shown by default. */
export const GEO_MAP_CONTROLS: GeoMapControl[] = ['zoom-in', 'zoom-out'];

/**
 * The parts of a {@link GeoMap} that can be placed: the compass, the buttons, the extent (the
 * ground across the map) and the distance (the scale bar).
 *
 * @group Components
 */
export type GeoMapItem = 'compass' | 'controls' | 'extent' | 'distance';

/**
 * Where a {@link GeoMap}'s items go — `compass`, `controls`, `extent`, `distance`, and any
 * of its own `items` by id — over the defaults: the compass top left, the buttons top right,
 * the extent bottom left, the distance bottom right.
 *
 * @group Components
 */
export type GeoMapLayout = Partial<
  Record<GeoMapItem | string, AnchorPlacement>
>;

/** Where each of a map's items goes unless its layout says. */
export const GEO_MAP_DEFAULT_LAYOUT: Record<
  GeoMapItem,
  Required<AnchorPlacement>
> = {
  compass: { anchor: 'top-left', direction: 'column', order: 0 },
  controls: { anchor: 'top-right', direction: 'column', order: 0 },
  extent: { anchor: 'bottom-left', direction: 'column', order: 0 },
  distance: { anchor: 'bottom-right', direction: 'column', order: 0 },
};

/**
 * An item of a map's own besides its compass, buttons and labels (a minimap's altitude
 * readout, say), placed with them.
 *
 * @group Components
 */
export type GeoMapExtraItem = {
  /** names it in the map's `layout` */
  id: string;
  node: ReactNode;
  /** where it goes unless the layout says */
  placement: Required<AnchorPlacement>;
};

// Pixels in from the map's edges.
const INSET = 6;

type CompassProps = {
  title: string;
  onClick: () => void;
};

// A compass turning with the map; a click does what the map says (north up, or a toggle).
const Compass = ({ title, onClick }: CompassProps) => {
  const needle = useRef<SVGGElement>(null);
  const angle = useRef(NaN);
  useGeoMapFrame(({ northAngle }) => {
    if (northAngle === angle.current) return;
    angle.current = northAngle;
    needle.current?.setAttribute(
      'transform',
      `rotate(${(northAngle * 180) / Math.PI} 14 14)`,
    );
  });
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      style={{
        width: 28,
        height: 28,
        padding: 0,
        border: 'none',
        background: 'none',
        cursor: 'pointer',
        pointerEvents: 'auto',
      }}
    >
      <svg width={28} height={28} style={{ display: 'block' }}>
        <circle cx={14} cy={14} r={13} fill="rgba(0, 0, 0, 0.45)" />
        <g ref={needle}>
          <path d="M14 3.5 L18 14 L10 14 Z" fill="#ff5a36" />
          <path d="M14 24.5 L18 14 L10 14 Z" fill="#dddddd" />
        </g>
      </svg>
    </button>
  );
};

// The ground across the map's shorter side.
const Extent = () => {
  const extent = useRef<HTMLDivElement>(null);
  useGeoMapFrame(({ extent: across }) =>
    setHudText(extent.current, formatHudDistance(across)),
  );
  return <div ref={extent} style={HUD_LABEL} />;
};

// A bar of a round length with its own inside it: what a stretch of the map measures.
const Distance = () => {
  const bar = useRef<HTMLDivElement>(null);
  const label = useRef<HTMLSpanElement>(null);
  const width = useRef('');
  useGeoMapFrame(({ view }) => {
    const { metres, pixels } = mapScaleBar(view);
    const next = `${pixels.toFixed(1)}px`;
    if (bar.current && next !== width.current) {
      width.current = next;
      bar.current.style.width = next;
    }
    setHudText(label.current, formatHudDistance(metres));
  });
  return (
    <div
      ref={bar}
      style={{
        ...HUD_LABEL,
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        boxSizing: 'border-box',
        borderLeft: '1.5px solid #fff',
        borderRight: '1.5px solid #fff',
        borderBottom: '1.5px solid #fff',
        // The label sits on the bottom line.
        paddingBottom: 1,
        filter: 'drop-shadow(0 0 1px #000)',
        minHeight: 13,
      }}
    >
      <span ref={label} />
    </div>
  );
};

// The map's own zoom buttons: a step in or out, by the host's levels where it has them.
const ZoomButton = ({ direction }: { direction: 1 | -1 }) => {
  const { controller } = useGeoMap();
  const title = direction > 0 ? 'Zoom in' : 'Zoom out';
  const onClick = useCallback(
    () => controller.stepZoom(direction),
    [controller, direction],
  );
  return (
    <button
      type="button"
      style={HUD_BUTTON}
      title={title}
      aria-label={title}
      onClick={onClick}
    >
      {direction > 0 ? '+' : '−'}
    </button>
  );
};

/** What a map shows over its layers, as {@link GeoMapItems} lays them out. */
export type GeoMapItemsProps = {
  /** the compass, and what a click on it does; null for none */
  compass: CompassProps | null;
  /** the map's own buttons, in order */
  controls: readonly GeoMapControl[];
  /** buttons of the host's, after the map's own */
  buttons?: ReactNode;
  /** the extent's label */
  extent: boolean;
  /** the scale bar */
  distance: boolean;
  /** items of the host's own */
  items?: readonly GeoMapExtraItem[];
  layout?: GeoMapLayout;
};

const NO_ITEMS: readonly GeoMapExtraItem[] = [];

/**
 * A map's items — its compass, buttons, extent and distance, and the host's own — each at
 * its anchor, those at one anchor stacked by their order, nearest the edge first.
 */
export const GeoMapItems = ({
  compass,
  controls,
  buttons,
  extent,
  distance,
  items = NO_ITEMS,
  layout,
}: GeoMapItemsProps) => {
  const shown: string[] = [];
  if (compass) shown.push('compass');
  if (controls.length > 0 || buttons) shown.push('controls');
  if (extent) shown.push('extent');
  if (distance) shown.push('distance');
  const defaults: Record<string, Required<AnchorPlacement>> = {
    ...GEO_MAP_DEFAULT_LAYOUT,
  };
  for (const item of items) {
    shown.push(item.id);
    defaults[item.id] = item.placement;
  }
  const groups = resolveAnchorLayout(shown, defaults, layout);

  const render = (name: string, direction: 'row' | 'column') => {
    switch (name) {
      case 'compass':
        return compass && <Compass key={name} {...compass} />;
      case 'controls':
        return (
          <div
            key={name}
            style={{
              display: 'flex',
              flexDirection: direction,
              gap: 3,
              pointerEvents: 'auto',
            }}
          >
            {controls.map(control => (
              <ZoomButton
                key={control}
                direction={control === 'zoom-in' ? 1 : -1}
              />
            ))}
            {buttons}
          </div>
        );
      case 'extent':
        return <Extent key={name} />;
      case 'distance':
        return <Distance key={name} />;
      default: {
        const item = items.find(entry => entry.id === name);
        return item ? <div key={name}>{item.node}</div> : null;
      }
    }
  };

  const { controller } = useGeoMap();
  const box = useRef<HTMLDivElement>(null);
  const told = useRef('');
  // The boxes the items take, told to the map whenever their sizes change (a scale bar's
  // width, a readout's text): the layers' labels keep off them.
  useLayoutEffect(() => {
    const element = box.current;
    if (!element) return;
    const measure = () => {
      const origin = element.getBoundingClientRect();
      const boxes: Rect2[] = [];
      for (const child of element.children) {
        const rect = child.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0)
          boxes.push([
            rect.left - origin.left,
            rect.top - origin.top,
            rect.right - origin.left,
            rect.bottom - origin.top,
          ]);
      }
      const key = boxes.map(b => b.map(Math.round).join(',')).join(';');
      if (key === told.current) return;
      told.current = key;
      controller.setReserved(boxes);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    for (const child of element.children) observer.observe(child);
    measure();
    return () => observer.disconnect();
  });
  useLayoutEffect(
    () => () => {
      told.current = '';
      controller.setReserved([]);
    },
    [controller],
  );

  return (
    <div
      ref={box}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
      }}
    >
      {[...groups].map(([anchor, entries]) => (
        <div
          key={anchor}
          style={{
            position: 'absolute',
            ...anchorStyle(anchor, INSET),
            display: 'flex',
            ...anchorStack(anchor, 'column'),
            gap: 4,
            pointerEvents: 'none',
          }}
        >
          {entries.map(({ item, direction }) => render(item, direction))}
        </div>
      ))}
    </div>
  );
};
