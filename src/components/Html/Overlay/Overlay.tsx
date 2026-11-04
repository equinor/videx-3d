import {
  useCallback,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { ANCHORS, anchorStack, type Anchor } from '../../../common/anchor';
import { CanvasHtml } from '../CanvasHtml/CanvasHtml';
import {
  OverlayContext,
  type OverlayAnchor,
  type OverlayDock,
  type OverlayPlacement,
  type OverlayState,
} from './overlay-context';
import {
  OVERLAY_GRID_TRACKS,
  overlayCell,
  type OverlayCell,
} from './overlay-layout';

/**
 * Overlay props
 * @expand
 */
export type OverlayProps = {
  /**
   * What it shows over the 3D view: HTML, placed by {@link OverlayItem} (or the `anchor` and
   * `order` of a `Panel`, a `Minimap`, an `AltitudeControl`), and seeing every context the
   * `Canvas` sees — R3F's `useThree` and `useFrame`, a `World`, the data.
   */
  children?: ReactNode;
  /** pixels between the view's edges and the items. Default 10 */
  inset?: number;
  /** pixels between the items at one anchor, and between the docks and what lies between them. Default 8 */
  gap?: number;
  /**
   * how the items at each of the eight anchors between the docks stack: in a column, or a
   * row. Default a column, a row in the middle of the top and the bottom edges. A dock's
   * items stack in a column
   */
  directions?: Partial<Record<Anchor, 'row' | 'column'>>;
  /**
   * where items go by their `id`, over what they ask for: to move an item to another anchor or
   * order without changing it (a layout the user arranged and the host kept, say)
   */
  layout?: Record<string, OverlayPlacement>;
  /** the overlay's z-index over the canvas. Default 10 */
  zIndex?: number;
  /** a class for the overlay's element, for styles of your own */
  className?: string;
  /** DOM element it is laid over. Default the renderer canvas's parent, falling back to `document.body` */
  parent?: HTMLElement | null;
};

/**
 * A layer of HTML over the 3D view, where gadgets, panels, buttons and maps are organised:
 * in a dock the full height of the view along its left or right edge (`'left'`, `'right'`: a
 * sidebar, a toolbar); at the corners and the middles of the edges of the space between the
 * docks, each in a cell of its own so no two overlap, stacked by their order; or filling the
 * space between the docks (`'fill'`).
 * Place it inside the `<Canvas>` (inside a `World` too, for what is placed on it): its
 * children render as HTML in a React root of their own, appended to the canvas's parent, and
 * see every context the `Canvas` sees, bridged (`its-fine`) — `useThree`, `useFrame`, the
 * `World` and the data. A press, a wheel or a click on an item does not reach the scene.
 *
 * Optional: it is a {@link CanvasHtml} with a layout. For a layout of your own, use a
 * `CanvasHtml` and its building blocks — `anchorStyle`, `anchorStack`, `overlayCell`, a
 * `Panel`'s `inline` — the gadgets render wherever you put them.
 *
 * @example
 * <Canvas>
 *   <World frame={frame}>
 *     <Overlay>
 *       <Panel anchor="left" resizable width={260}>
 *         <WellMap wellIdentifier={well} />
 *       </Panel>
 *       <Minimap anchor="bottom-right" layers={layers}>
 *         <GeoMapCameraMarker />
 *       </Minimap>
 *       <AltitudeControl anchor="left-center" />
 *       <OverlayItem anchor="top-right">
 *         <OverlayButton title="Home" onClick={goHome}>⌂</OverlayButton>
 *       </OverlayItem>
 *     </Overlay>
 *   </World>
 * </Canvas>
 *
 * @see `documents/overlay.md`
 * @group Components
 */
export const Overlay = ({
  parent,
  zIndex,
  children,
  ...layout
}: OverlayProps) => (
  <CanvasHtml parent={parent} zIndex={zIndex}>
    <OverlayLayer {...layout}>{children}</OverlayLayer>
  </CanvasHtml>
);

const NO_LAYOUT: Record<string, OverlayPlacement> = {};

// The overlay as HTML: a dock down each side, and between them the space the eight anchors
// share — three columns, each with its stacks at its top, middle and bottom — over the layer
// that fills it.
const OverlayLayer = ({
  children,
  inset = 10,
  gap = 8,
  directions,
  layout = NO_LAYOUT,
  className,
}: Omit<OverlayProps, 'parent' | 'zIndex'>) => {
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const [anchors, setAnchors] = useState<
    Partial<Record<OverlayAnchor, HTMLElement>>
  >({});
  const anchorRef = useCallback(
    (anchor: OverlayAnchor) => (node: HTMLElement | null) => {
      setAnchors(was =>
        was[anchor] === (node ?? undefined)
          ? was
          : { ...was, [anchor]: node ?? undefined },
      );
    },
    [],
  );
  // One ref callback per anchor, kept: a new one each render would detach and attach again.
  const refs = useMemo(
    () =>
      Object.fromEntries(
        [...ANCHORS, ...DOCKS, 'fill' as const].map(anchor => [
          anchor,
          anchorRef(anchor),
        ]),
      ) as Record<OverlayAnchor, (node: HTMLElement | null) => void>,
    [anchorRef],
  );

  const layoutKey = JSON.stringify(layout);
  const state = useMemo<OverlayState>(() => {
    const placed = JSON.parse(layoutKey) as Record<string, OverlayPlacement>;
    return {
      anchors,
      inset,
      gap,
      element,
      placement: (id, asked) =>
        id && placed[id] ? { ...asked, ...placed[id] } : asked,
    };
  }, [anchors, inset, gap, element, layoutKey]);

  // A dock: the full height, as wide as its widest item (its items keep `gap` from the space
  // between the docks), nothing when empty.
  const dock = (side: OverlayDock): CSSProperties => ({
    flex: '0 0 auto',
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: side === 'left' ? 'flex-start' : 'flex-end',
    gap,
    pointerEvents: 'none',
  });

  return (
    <div
      ref={setElement}
      className={className}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
        boxSizing: 'border-box',
        padding: inset,
        display: 'flex',
        pointerEvents: 'none',
        fontFamily: 'verdana, sans-serif',
        color: '#fff',
      }}
    >
      <div ref={refs.left} style={dock('left')} />
      <div
        style={{
          position: 'relative',
          flex: '1 1 auto',
          minWidth: 0,
          pointerEvents: 'none',
        }}
      >
        <div
          ref={refs.fill}
          style={{ ...FILL, display: 'grid', pointerEvents: 'none' }}
        />
        <div
          style={{
            ...FILL,
            display: 'grid',
            gridTemplateColumns: OVERLAY_GRID_TRACKS,
            // One row, the full height: each column shares it out among its own stacks.
            gridTemplateRows: 'minmax(0, 1fr)',
            columnGap: gap,
            pointerEvents: 'none',
          }}
        >
          {COLUMNS.map(column => (
            <div
              key={column}
              style={{
                display: 'grid',
                gridTemplateRows: OVERLAY_GRID_TRACKS,
                rowGap: gap,
                minHeight: 0,
                pointerEvents: 'none',
              }}
            >
              {ANCHORS.filter(anchor => CELLS[anchor].column === column).map(
                anchor => {
                  const { gridRow, justifySelf, alignSelf } = CELLS[anchor];
                  const direction =
                    directions?.[anchor] ??
                    (anchor === 'top-center' || anchor === 'bottom-center'
                      ? 'row'
                      : 'column');
                  const style: CSSProperties = {
                    gridRow,
                    justifySelf,
                    alignSelf,
                    display: 'flex',
                    ...anchorStack(anchor, direction),
                    gap,
                    pointerEvents: 'none',
                  };
                  return <div key={anchor} ref={refs[anchor]} style={style} />;
                },
              )}
            </div>
          ))}
        </div>
      </div>
      <div ref={refs.right} style={dock('right')} />
      {/* What is not placed by an item lies here, out of the layout's way. */}
      <div style={{ position: 'absolute', left: 0, top: 0 }}>
        <OverlayContext.Provider value={state}>
          {children}
        </OverlayContext.Provider>
      </div>
    </div>
  );
};

const DOCKS: readonly OverlayDock[] = ['left', 'right'];
const COLUMNS = [1, 2, 3] as const;
const CELLS = Object.fromEntries(
  ANCHORS.map(anchor => [anchor, overlayCell(anchor)]),
) as Record<Anchor, OverlayCell>;

// A box filling its positioned parent.
const FILL: CSSProperties = {
  position: 'absolute',
  left: 0,
  top: 0,
  right: 0,
  bottom: 0,
};
