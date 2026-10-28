import { useRef, type ReactNode } from 'react';
import type { Vec2 } from '../../../sdk/types/common';
import { useMinimapFrame, type MinimapState } from './minimap-context';
import { mapViewToPixel } from '../../../sdk/projection/map-view';
import { MinimapCameraIcon, MinimapTargetIcon } from './MinimapIcons';
import { HANDLE_RADIUS, useDraggableMarker } from './minimap-drag';

/**
 * How far a minimap marker's shape reaches: metres on the ground, or `{ fraction }` of the
 * map's extent (the ground across its shorter side), so it keeps its size on the map at
 * every zoom.
 *
 * @group Components
 */
export type MinimapShapeRadius = number | { fraction: number };

/**
 * MinimapCameraMarker props
 * @expand
 */
export type MinimapCameraMarkerProps = {
  /** the arrow's colour. Default white */
  color?: string;
  /** the cone's or the circle's colour. Default white */
  shapeColor?: string;
  /** the arrow's length in pixels. Default 14 */
  size?: number;
  /**
   * what is drawn round the arrow: `'cone'`, the camera's horizontal field of view; `'circle'`,
   * all round it; or `'none'`. Default `'cone'`
   */
  shape?: 'cone' | 'circle' | 'none';
  /** how far the cone reaches, or the circle's radius. Default `{ fraction: 0.45 }` */
  radius?: MinimapShapeRadius;
  /**
   * whether the arrow can be dragged and dropped on the map to move the camera there: it
   * and its target move together, at the heights they have. Drop it outside the map, or press
   * Escape, to cancel. Needs controls (see `Minimap`'s `dragControls`). Default `true`
   */
  draggable?: boolean;
};

// The shape's reach in pixels: its metres at the map's scale, or its share of the map's shorter side.
function shapeReach(radius: MinimapShapeRadius, { view }: MinimapState) {
  return typeof radius === 'number'
    ? radius / view.metresPerPixel
    : radius.fraction * Math.min(view.size[0], view.size[1]);
}

/**
 * Where the camera is on a {@link Minimap}, and which way it looks: an arrow, turning with
 * its heading on a north-up map, and, round it, either its horizontal field of view as a cone,
 * or a circle of a set radius. The arrow is in the middle of the map unless the map is centred
 * on the camera's target. Drag it and drop it on the map to fly the camera there.
 *
 * @group Components
 */
export const MinimapCameraMarker = ({
  color = '#ffffff',
  shapeColor = '#ffffff',
  size = 14,
  shape = 'cone',
  radius = DEFAULT_RADIUS,
  draggable = true,
}: MinimapCameraMarkerProps) => {
  const turned = useRef<SVGGElement>(null);
  const wedge = useRef<SVGPathElement>(null);
  const ring = useRef<SVGCircleElement>(null);
  const { group, handleCircle, handle } = useDraggableMarker(
    'camera',
    state => state.camera,
    draggable,
  );
  useMinimapFrame(state => {
    const { heading, fov } = state;
    turned.current?.setAttribute(
      'transform',
      `rotate(${(heading * 180) / Math.PI})`,
    );
    const reach = shapeReach(radius, state);
    if (wedge.current) {
      const half = Math.min(fov, Math.PI * 0.95) / 2;
      const dx = reach * Math.sin(half);
      const dy = -reach * Math.cos(half);
      wedge.current.setAttribute(
        'd',
        `M0 0 L${-dx} ${dy} A${reach} ${reach} 0 0 1 ${dx} ${dy} Z`,
      );
    }
    ring.current?.setAttribute('r', String(reach));
  });
  return (
    <g ref={group}>
      {shape === 'circle' && (
        <circle
          ref={ring}
          fill={shapeColor}
          fillOpacity={0.1}
          stroke={shapeColor}
          strokeOpacity={0.85}
          strokeWidth={1.5}
        />
      )}
      <g ref={turned}>
        {shape === 'cone' && (
          <path ref={wedge} fill={shapeColor} fillOpacity={0.25} />
        )}
        <MinimapCameraIcon size={size} color={color} />
      </g>
      {draggable && (
        <circle
          ref={handleCircle}
          r={HANDLE_RADIUS}
          fill="transparent"
          pointerEvents="all"
          {...handle}
        >
          <title>Drag to move the camera</title>
        </circle>
      )}
    </g>
  );
};

const DEFAULT_RADIUS: MinimapShapeRadius = { fraction: 0.45 };

/**
 * MinimapTargetMarker props
 * @expand
 */
export type MinimapTargetMarkerProps = {
  /** Default white */
  color?: string;
  /** its width in pixels. Default 16 */
  size?: number;
  /**
   * whether it can be dragged and dropped on the map to aim the camera at the new place: the
   * camera stays, and the target keeps its height. Drop it outside the map, or press Escape,
   * to cancel. Needs controls (see `Minimap`'s `dragControls`). Default `true`
   */
  draggable?: boolean;
};

/**
 * What the camera looks at on a {@link Minimap}: the controls' target, dropped to the sea's
 * level (`MinimapState.target`). It is in the middle of the map when the map is centred on it.
 * Drag it and drop it on the map to look somewhere else.
 *
 * @group Components
 */
export const MinimapTargetMarker = ({
  color = '#ffffff',
  size = 16,
  draggable = true,
}: MinimapTargetMarkerProps) => {
  const { group, handleCircle, handle } = useDraggableMarker(
    'target',
    state => state.target,
    draggable,
  );
  return (
    <g ref={group}>
      <MinimapTargetIcon size={size} color={color} />
      {draggable && (
        <circle
          ref={handleCircle}
          r={HANDLE_RADIUS}
          fill="transparent"
          pointerEvents="all"
          {...handle}
        >
          <title>Drag to look somewhere else</title>
        </circle>
      )}
    </g>
  );
};

/** One point of a {@link MinimapPoints} layer. */
export type MinimapPoint = {
  /** scene X/Z */
  at: Vec2;
  color?: string;
  /** pixels. Default the layer's */
  radius?: number;
  label?: string;
};

/**
 * MinimapPoints props
 * @expand
 */
export type MinimapPointsProps = {
  points: MinimapPoint[];
  /** default colour. Default `'#ff5a36'` */
  color?: string;
  /** default radius in pixels. Default 3.5 */
  radius?: number;
  /** the labels' font size in pixels. Default 10 */
  fontSize?: number;
};

/**
 * Points on a {@link Minimap}, at scene X/Z, each with an optional label, kept in place as
 * the camera moves without a React render: a field's wellheads, say. A point off the map is
 * hidden.
 *
 * @group Components
 */
export const MinimapPoints = ({
  points,
  color = '#ff5a36',
  radius = 3.5,
  fontSize = 10,
}: MinimapPointsProps) => {
  const nodes = useRef<(SVGGElement | null)[]>([]);
  useMinimapFrame(({ view }) => {
    points.forEach(({ at, radius: r = radius }, i) => {
      const node = nodes.current[i];
      if (!node) return;
      const [x, y] = mapViewToPixel(view, at[0], at[1]);
      const reach = r + 60;
      const inside =
        x > -reach &&
        y > -reach &&
        x < view.size[0] + reach &&
        y < view.size[1] + reach;
      node.setAttribute('visibility', inside ? 'visible' : 'hidden');
      if (inside) node.setAttribute('transform', `translate(${x} ${y})`);
    });
  });
  return (
    <>
      {points.map(({ color: c = color, radius: r = radius, label }, i) => (
        <g
          key={i}
          ref={node => {
            nodes.current[i] = node;
          }}
        >
          <circle
            r={r}
            fill={c}
            stroke="#000"
            strokeOpacity={0.7}
            strokeWidth={1}
          />
          {label && (
            <text
              x={r + 3}
              y={fontSize * 0.35}
              fill="#fff"
              fontSize={fontSize}
              fontFamily="verdana, sans-serif"
              stroke="#000"
              strokeOpacity={0.8}
              strokeWidth={2.5}
              paintOrder="stroke"
            >
              {label}
            </text>
          )}
        </g>
      ))}
    </>
  );
};

/**
 * MinimapPolyline props
 * @expand
 */
export type MinimapPolylineProps = {
  /** scene X/Z */
  points: Vec2[];
  /** close it into a polygon, which `fill` then fills. Default `false` */
  closed?: boolean;
  /** Default `'#ffffff'` */
  stroke?: string;
  /** pixels. Default 1.5 */
  strokeWidth?: number;
  /** Default none */
  fill?: string;
  fillOpacity?: number;
  /** an SVG dash pattern, `'4 3'` say */
  dash?: string;
};

/**
 * A line or an outline on a {@link Minimap}, through points at scene X/Z: a wellbore's
 * trajectory, a licence's boundary. Redrawn as the camera moves without a React render,
 * and per point: for many thousands of points, simplify them first.
 *
 * @group Components
 */
export const MinimapPolyline = ({
  points,
  closed = false,
  stroke = '#ffffff',
  strokeWidth = 1.5,
  fill = 'none',
  fillOpacity = 0.2,
  dash,
}: MinimapPolylineProps) => {
  const path = useRef<SVGPathElement>(null);
  useMinimapFrame(({ view }) => {
    let d = '';
    for (let i = 0; i < points.length; i++) {
      const [x, y] = mapViewToPixel(view, points[i][0], points[i][1]);
      d += `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
    }
    path.current?.setAttribute('d', closed && d ? `${d}Z` : d);
  });
  return (
    <path
      ref={path}
      fill={fill}
      fillOpacity={fillOpacity}
      stroke={stroke}
      strokeWidth={strokeWidth}
      strokeDasharray={dash}
      strokeLinejoin="round"
    />
  );
};

/**
 * MinimapLayer props
 * @expand
 */
export type MinimapLayerProps = {
  /**
   * Called with the layer's `<g>` and the minimap's state now, and each time it changes:
   * draw into it however you like (move what you made, redraw it).
   */
  onFrame: (group: SVGGElement, state: MinimapState) => void;
  children?: ReactNode;
};

/**
 * A layer of your own on a {@link Minimap}: an SVG `<g>` (with its `children`, if any) handed
 * to `onFrame` as the minimap changes. For anything the ready-made layers do not draw; see
 * also {@link useMinimap}.
 *
 * @group Components
 */
export const MinimapLayer = ({ onFrame, children }: MinimapLayerProps) => {
  const group = useRef<SVGGElement>(null);
  useMinimapFrame(state => {
    if (group.current) onFrame(group.current, state);
  });
  return <g ref={group}>{children}</g>;
};
