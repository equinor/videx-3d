import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useMemo,
  useRef,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type PropsWithChildren,
  type ReactNode,
} from 'react';
import { anchorGrowth } from '../../../common/anchor';
import { Corner, cornerStyle } from '../../../common/corner-style';
import { useControllable } from '../../../hooks/useControllable';
import { OverlayButton } from '../Overlay/OverlayButton';
import { OverlayItem } from '../Overlay/OverlayItem';
import {
  isOverlayDock,
  useOverlay,
  useOverlayItem,
  type OverlayAnchor,
  type OverlayItemState,
  type OverlayState,
} from '../Overlay/overlay-context';
import {
  panelHandleCursor,
  panelHandles,
  resizePanel,
  type PanelAnchor,
  type PanelHandle,
  type PanelResizeLimits,
} from './panel-resize';

export type { PanelResizeLimits } from './panel-resize';

/**
 * The button a closed `Panel` becomes, which opens it again.
 *
 * @group Components
 */
export type PanelCollapsed = {
  /** its face. Default a small window */
  icon?: ReactNode;
  /** what it says on hover. Default `'Show'` */
  title?: string;
  /** in an `Overlay`, where it sits. Default where the panel sits */
  anchor?: OverlayAnchor;
  /** in an `Overlay`, its order there. Default the panel's */
  order?: number;
};

/**
 * Panel props
 * @expand
 */
export type PanelProps = {
  /** in CSS pixels; for a resizable panel, the width it starts at. Default 400 */
  width?: number;
  /**
   * Max height in px. Omit to let the panel size to its content, which is also
   * the only way to keep it click-through: a clamped panel may need to scroll, and
   * a scrollbar is unusable without pointer events. For a resizable panel, the height it
   * starts at (default 300).
   */
  height?: number;
  /** outside an `Overlay`: pixels in from its corner. Default `[10, 10]` */
  offset?: [number, number];
  opacity?: number;
  padding?: number;
  /** Root font size in px. Everything inside is sized in `em`, so this scales it all. */
  fontSize?: number;
  /**
   * outside an `Overlay`: the corner of its container it sits in, unless `inline`; either way,
   * the resize handles face away from it. Default `'bottom-left'`
   */
  origin?: Corner;
  /**
   * outside an `Overlay`: in the flow of its container, where a layout of your own puts it,
   * rather than at a corner of it. Default false
   */
  inline?: boolean;
  /**
   * in an `Overlay`: where it sits — a corner or the middle of an edge, `'fill'`, or a dock
   * (`'left'`, `'right'`), where it is a sidebar: the dock's full height (less its other
   * items), resized by its inner edge. Omitted, it sits at `origin`
   */
  anchor?: OverlayAnchor;
  /** in an `Overlay`: its order among the items at its anchor. Default 0 */
  order?: number;
  /** in an `Overlay`: names it in the overlay's `layout` */
  id?: string;
  /** CSS background. Default black at `opacity` */
  background?: string;
  /** CSS border. Default none */
  border?: string;
  /** Default 8 */
  borderRadius?: number;
  /**
   * resized by dragging its edges and corners — those away from where it is anchored, so the
   * anchored side stays; a sidebar, its inner edge — within the limits given (`true`: 120 x
   * 80 pixels at least, at most what the view leaves it). Default false
   */
  resizable?: boolean | PanelResizeLimits;
  /** a resizable panel's size, `[width, height]` in CSS pixels, when the host controls it */
  size?: [number, number];
  /** the size it starts at, when not controlled. Default `[width, height]` */
  defaultSize?: [number, number];
  /** told once a resize ends */
  onSizeChange?: (size: [number, number]) => void;
  /**
   * it can be closed into a button ({@link PanelCollapsed}), which opens it again: closed,
   * its children are unmounted (see `keepMounted`), so it costs nothing, and it keeps its
   * size. Default false
   */
  closable?: boolean;
  /** whether it is open, when the host controls it */
  open?: boolean;
  /** whether it starts open, when not controlled. Default true */
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** a closable panel's close button, top right. `false` for a close of your own (see `usePanel`). Default true */
  closeButton?: boolean;
  /** the button a closed panel becomes */
  collapsed?: PanelCollapsed;
  /** keep the children mounted while closed, hidden. Default false */
  keepMounted?: boolean;
  className?: string;
  /** styles over its own */
  style?: CSSProperties;
};

/**
 * What a {@link Panel} offers what is inside it.
 *
 * @group Components
 */
export type PanelState = {
  /** whether it is open */
  open: boolean;
  /** close it into its button (a closable panel; does nothing for another) */
  close: () => void;
  /** a resizable panel's size, `[width, height]`; null for one sized by its content */
  size: [number, number] | null;
};

const PanelContext = createContext<PanelState | null>(null);

/**
 * The enclosing {@link Panel}, or `null`: to close it from a button of your own.
 *
 * @group Hooks
 */
export function usePanel() {
  return useContext(PanelContext);
}

const defaultOffset: [number, number] = [10, 10];

// The thickness of a resize handle's grip, in pixels.
const GRIP = 6;
// The least a sidebar leaves between the docks, in pixels.
const SIDEBAR_ROOM = 200;

/** A small window: the face of a closed panel's button. */
export const PanelIcon = () => (
  <svg width={14} height={14} viewBox="0 0 14 14" style={{ display: 'block' }}>
    <rect
      x={1.5}
      y={2.5}
      width={11}
      height={9}
      rx={1.5}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
    />
    <path d="M1.5 5.5 H12.5" stroke="currentColor" strokeWidth={1.4} />
  </svg>
);

/**
 * A simple HTML panel that can be used as an overlay on the 3d canvas: in a corner of its
 * container (`origin`, `offset`), in the flow of a layout of your own (`inline`), or in an
 * `Overlay` at an `anchor` among its other items. Optionally resizable by dragging its edges,
 * and closable into a button that opens it again.
 * @see {@link OutputPanel}
 * @group Components
 */
export const Panel = forwardRef<HTMLDivElement, PropsWithChildren<PanelProps>>(
  (props, fref) => {
    const {
      anchor,
      order = 0,
      id,
      width = 400,
      height,
      origin = 'bottom-left',
      offset = defaultOffset,
      inline = false,
      resizable = false,
      size,
      defaultSize,
      onSizeChange,
      closable = false,
      open,
      defaultOpen = true,
      onOpenChange,
      collapsed,
      keepMounted = false,
    } = props;
    const overlay = useOverlay();
    const item = useOverlayItem();
    // Placed by an overlay — at its own anchor, or by the item it is inside — or in the flow
    // of a layout of the host's.
    const own = !item && !!overlay && anchor !== undefined;
    const docked = !!item || own || inline;

    const [shownSize, requestSize] = useControllable<[number, number]>(
      size,
      defaultSize ?? [width, height ?? 300],
      onSizeChange,
    );
    const [isOpen, requestOpen] = useControllable(
      open,
      defaultOpen,
      onOpenChange,
    );
    const close = useCallback(() => {
      if (closable) requestOpen(false);
    }, [closable, requestOpen]);
    const show = useCallback(() => requestOpen(true), [requestOpen]);
    const state = useMemo<PanelState>(
      () => ({ open: isOpen, close, size: resizable ? shownSize : null }),
      [isOpen, close, resizable, shownSize],
    );

    const showing = isOpen || !closable;
    const body =
      showing || keepMounted ? (
        <PanelBody
          {...props}
          ref={fref}
          docked={docked}
          hidden={!showing}
          size={shownSize}
          onResized={requestSize}
          state={state}
        />
      ) : null;

    const button = showing ? null : (
      <OverlayButton title={collapsed?.title ?? 'Show'} onClick={show}>
        {collapsed?.icon ?? <PanelIcon />}
      </OverlayButton>
    );
    // The button where the panel was, or where it is asked to be.
    let placedButton: ReactNode = null;
    if (button) {
      if (overlay && (own || collapsed?.anchor !== undefined))
        placedButton = (
          <OverlayItem
            anchor={collapsed?.anchor ?? anchor}
            order={collapsed?.order ?? order}
            id={id}
          >
            {button}
          </OverlayItem>
        );
      else if (docked) placedButton = button;
      else
        placedButton = (
          <div
            style={{
              position: 'absolute',
              ...cornerStyle(origin, offset),
              zIndex: 10,
            }}
          >
            {button}
          </div>
        );
    }

    return (
      <>
        {body &&
          (own ? (
            <OverlayItem
              anchor={anchor}
              order={order}
              id={id}
              stretch={isOverlayDock(anchor)}
            >
              {body}
            </OverlayItem>
          ) : (
            body
          ))}
        {placedButton}
      </>
    );
  },
);
Panel.displayName = 'Panel';

type PanelBodyProps = PropsWithChildren<PanelProps> & {
  docked: boolean;
  hidden: boolean;
  size: [number, number];
  onResized: (size: [number, number]) => void;
  state: PanelState;
};

const PanelBody = forwardRef<HTMLDivElement, PanelBodyProps>(
  (
    {
      origin = 'bottom-left',
      width = 400,
      height,
      offset = defaultOffset,
      inline = false,
      opacity = 0.8,
      padding = 0,
      fontSize = 16,
      background,
      border,
      borderRadius = 8,
      resizable = false,
      closable = false,
      closeButton = true,
      className,
      style,
      docked,
      hidden,
      size,
      onResized,
      state,
      children = null,
    },
    fref,
  ) => {
    const overlay = useOverlay();
    const item = useOverlayItem();
    const box = useRef<HTMLDivElement | null>(null);
    const setBox = useCallback(
      (node: HTMLDivElement | null) => {
        box.current = node;
        if (typeof fref === 'function') fref(node);
        else if (fref) fref.current = node;
      },
      [fref],
    );
    const { left, bottom, right, top } = useMemo(
      () => cornerStyle(origin, offset),
      [origin, offset],
    );
    // The handles face away from where it is anchored; a sidebar's from its dock; none filling
    // the view.
    const at = panelAnchor(item, origin);
    const sidebar = at === 'left' || at === 'right';
    const handles = useMemo(
      () => (resizable && at !== 'fill' ? panelHandles(at) : []),
      [resizable, at],
    );

    const onHandleDown =
      (handle: PanelHandle) => (event: ReactPointerEvent<HTMLDivElement>) => {
        const el = box.current;
        if (event.button !== 0 || !el || at === 'fill') return;
        event.preventDefault();
        event.stopPropagation();
        const grip = event.currentTarget;
        grip.setPointerCapture(event.pointerId);
        const start: [number, number] = [el.offsetWidth, el.offsetHeight];
        const growth = sidebar ? null : anchorGrowth(at);
        const limits = typeof resizable === 'object' ? resizable : {};
        const room = roomFor(el, at, overlay, inline && !item);
        const bounded: PanelResizeLimits = {
          ...limits,
          maxWidth: Math.min(limits.maxWidth ?? Infinity, room.maxWidth),
          maxHeight: Math.min(limits.maxHeight ?? Infinity, room.maxHeight),
        };
        const x0 = event.clientX;
        const y0 = event.clientY;
        let next = start;
        // Set on the element as it is dragged, not through React: no render per move.
        const move = (e: PointerEvent) => {
          next = resizePanel(
            start,
            [e.clientX - x0, e.clientY - y0],
            handle,
            [growth?.x === 'both', growth?.y === 'both'],
            bounded,
          );
          el.style.width = `${next[0]}px`;
          // A sidebar's height is its dock's.
          if (!sidebar) el.style.height = `${next[1]}px`;
        };
        const end = () => {
          grip.removeEventListener('pointermove', move);
          grip.removeEventListener('pointerup', end);
          grip.removeEventListener('pointercancel', end);
          if (sidebar) next = [next[0], size[1]];
          if (next[0] !== size[0] || next[1] !== size[1]) onResized(next);
        };
        grip.addEventListener('pointermove', move);
        grip.addEventListener('pointerup', end);
        grip.addEventListener('pointercancel', end);
      };

    let sizing: CSSProperties;
    if (item?.anchor === 'fill')
      sizing = { flex: '1 1 auto', minWidth: 0, minHeight: 0 };
    else if (sidebar)
      sizing = {
        width: `${resizable ? size[0] : width}px`,
        flex: '1 1 auto',
        minHeight: 0,
      };
    else if (resizable)
      sizing = { width: `${size[0]}px`, height: `${size[1]}px` };
    else
      sizing = {
        width: `${width}px`,
        maxHeight: height ? `${height}px` : undefined,
      };
    const interactive = !!height || !!resizable || closable || sidebar;
    return (
      <div
        ref={setBox}
        className={className}
        style={{
          borderRadius,
          position: docked ? 'relative' : 'absolute',
          // Column flex + owning the overflow so `maxHeight` actually bounds the
          // content: without it a child paints past the dimmed background.
          display: hidden ? 'none' : 'flex',
          flexDirection: 'column',
          overflow: resizable
            ? 'hidden'
            : height || sidebar
              ? 'auto'
              : 'hidden',
          boxSizing: 'border-box',
          ...(docked ? {} : { left, bottom, right, top, zIndex: 10 }),
          padding,
          color: 'white',
          fontFamily: 'verdana',
          fontSize: `${fontSize}px`,
          lineHeight: 1.3,
          ...sizing,
          pointerEvents: interactive ? 'auto' : 'none',
          background:
            background ??
            `#000000${Math.round(opacity * 255)
              .toString(16)
              .padStart(2, '0')}`,
          border,
          ...style,
        }}
      >
        {/* A stacking context of its own: nothing the content raises (a z-index) covers the
            panel's own close button and resize handles. */}
        <div
          style={{
            position: 'relative',
            zIndex: 0,
            flex: '1 1 auto',
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <PanelContext.Provider value={state}>
            {children}
          </PanelContext.Provider>
        </div>
        {closable && closeButton && (
          <button
            type="button"
            title="Close"
            aria-label="Close"
            onClick={state.close}
            style={{
              position: 'absolute',
              top: 4,
              right: 4,
              width: 18,
              height: 18,
              padding: 0,
              font: '13px/1 verdana, sans-serif',
              color: '#fff',
              background: 'rgba(0, 0, 0, 0.45)',
              border: 'none',
              borderRadius: 3,
              cursor: 'pointer',
              zIndex: 3,
            }}
          >
            ×
          </button>
        )}
        {handles.map(handle => (
          <div
            key={`${handle.x} ${handle.y}`}
            onPointerDown={onHandleDown(handle)}
            style={handleStyle(handle)}
          />
        ))}
      </div>
    );
  },
);
PanelBody.displayName = 'PanelBody';

// Where a panel's handles face from: its overlay item's anchor — a sidebar's dock; a panel
// stacked in a dock without stretching, from the dock's top corner — or its own corner.
function panelAnchor(
  item: OverlayItemState | null,
  origin: Corner,
): PanelAnchor | 'fill' {
  if (!item) return origin;
  if (!isOverlayDock(item.anchor)) return item.anchor;
  if (item.stretch) return item.anchor;
  return item.anchor === 'left' ? 'top-left' : 'top-right';
}

// The most a panel may grow to: a sidebar, as wide as the view leaves it beside the other
// dock and the room kept between them; in an overlay, the space between the docks; inline in
// a layout of the host's, whose container grows with it, the window; else its container, less
// the offsets.
function roomFor(
  el: HTMLElement,
  at: PanelAnchor,
  overlay: OverlayState | null,
  inline: boolean,
): { maxWidth: number; maxHeight: number } {
  if (overlay && (at === 'left' || at === 'right')) {
    const whole = overlay.element;
    const other = overlay.anchors[at === 'left' ? 'right' : 'left'];
    return {
      maxWidth: whole
        ? whole.clientWidth -
          2 * overlay.inset -
          (other?.offsetWidth ?? 0) -
          SIDEBAR_ROOM
        : Infinity,
      maxHeight: Infinity,
    };
  }
  if (overlay?.anchors.fill) {
    const fill = overlay.anchors.fill;
    return { maxWidth: fill.clientWidth, maxHeight: fill.clientHeight };
  }
  if (inline)
    return { maxWidth: window.innerWidth, maxHeight: window.innerHeight };
  const room = el.parentElement;
  const margin = 2 * defaultOffset[0];
  return {
    maxWidth: room ? room.clientWidth - margin : Infinity,
    maxHeight: room ? room.clientHeight - margin : Infinity,
  };
}

// Where a handle's grip lies: along its edge, inside the panel; a corner's, a square there.
function handleStyle(handle: PanelHandle): CSSProperties {
  const style: CSSProperties = {
    position: 'absolute',
    zIndex: 2,
    cursor: panelHandleCursor(handle),
    touchAction: 'none',
  };
  const corner = handle.x !== 0 && handle.y !== 0;
  const grip = corner ? GRIP * 2 : GRIP;
  if (handle.x !== 0) {
    style[handle.x < 0 ? 'left' : 'right'] = 0;
    style.width = grip;
  } else {
    style.left = GRIP;
    style.right = GRIP;
  }
  if (handle.y !== 0) {
    style[handle.y < 0 ? 'top' : 'bottom'] = 0;
    style.height = grip;
  } else {
    style.top = GRIP;
    style.bottom = GRIP;
  }
  if (corner) style.zIndex = 3;
  return style;
}
