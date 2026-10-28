import {
  useContext,
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  mapViewFromPixel,
  mapViewToPixel,
  type MapView,
} from '../../../sdk/projection/map-view';
import type { Vec2 } from '../../../sdk/types/common';
import {
  MinimapContext,
  useMinimapFrame,
  type MinimapState,
} from './minimap-context';

// The pixels round a marker's centre that grab it, at most; and at least, where the other marker is nearer.
export const HANDLE_RADIUS = 12;
const HANDLE_MIN_RADIUS = 5;

// How long a dropped marker stays where it was dropped while the camera flies there, in ms.
const HOLD_MS = 1500;
// How close to where it was dropped, in pixels, the marker has to be to follow the camera again.
const HOLD_PIXELS = 3;
// A marker's opacity while the pointer is outside the map: a drop there is cancelled.
const CANCEL_OPACITY = '0.35';

/**
 * A marker on a {@link Minimap} at a scene position that the user can drag and drop: the
 * camera's or its target's. It keeps itself in place as the map changes. Drag it and it
 * follows the pointer, the map held still; drop it on the map and the controls move there
 * (`Minimap`'s `dragControls`, `onMarkerDrop`); drop it outside the map, or press Escape,
 * and nothing happens. While the camera flies to the drop the marker stays where it was
 * dropped.
 *
 * @param kind which marker it is, for what a drop does
 * @param where its scene X/Z in the minimap's state
 * @param draggable whether it can be dragged at all
 * @returns a ref for the SVG group it places (translated to its pixel; draw about 0, 0), and
 *   the props, and a ref, for the circle that is its handle (its radius is kept to the room
 *   the other marker leaves)
 */
export function useDraggableMarker(
  kind: 'camera' | 'target',
  where: (state: MinimapState) => Vec2,
  draggable: boolean,
) {
  const store = useContext(MinimapContext);
  if (!store) throw new Error('useDraggableMarker: not inside a <Minimap>');
  const group = useRef<SVGGElement>(null);
  const handleCircle = useRef<SVGCircleElement>(null);
  const dragging = useRef(false);
  const held = useRef<{ at: Vec2; until: number } | null>(null);
  const latest = useRef(where);
  useEffect(() => {
    latest.current = where;
  });

  useMinimapFrame(state => {
    // The camera's and its target's handles share the map: each reaches no further than half
    // way to the other, so neither covers the other where they are close.
    if (handleCircle.current) {
      const [ox, oy] = mapViewToPixel(
        state.view,
        ...(kind === 'camera' ? state.target : state.camera),
      );
      const [mx, my] = mapViewToPixel(state.view, ...latest.current(state));
      const reach = Math.hypot(ox - mx, oy - my) / 2;
      handleCircle.current.setAttribute(
        'r',
        String(Math.min(HANDLE_RADIUS, Math.max(reach, HANDLE_MIN_RADIUS))),
      );
    }
    const el = group.current;
    if (!el || dragging.current) return;
    let at = latest.current(state);
    const hold = held.current;
    if (hold) {
      const [hx, hy] = mapViewToPixel(state.view, hold.at[0], hold.at[1]);
      const [x, y] = mapViewToPixel(state.view, at[0], at[1]);
      if (
        performance.now() > hold.until ||
        Math.hypot(hx - x, hy - y) < HOLD_PIXELS
      )
        held.current = null;
      else at = hold.at;
    }
    const [x, y] = mapViewToPixel(state.view, at[0], at[1]);
    el.setAttribute('transform', `translate(${x} ${y})`);
    el.removeAttribute('opacity');
  });

  // Where the pointer is on the map, in its pixels; and whether that is on it.
  const pointer = (event: { clientX: number; clientY: number }) => {
    const rect = store.host.element?.getBoundingClientRect();
    if (!rect) return null;
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    return {
      x,
      y,
      width: rect.width,
      height: rect.height,
      inside: x >= 0 && y >= 0 && x <= rect.width && y <= rect.height,
    };
  };

  const stop = useRef<(() => void) | null>(null);
  useEffect(() => () => stop.current?.(), []);
  // The drag in progress: its pointer, and how to end it.
  const drag = useRef<{
    finish: (drop: Vec2 | null) => void;
    id: number;
  } | null>(null);

  const onPointerDown = (event: ReactPointerEvent<SVGElement>) => {
    if (!draggable || !store.host.canDrag() || event.button !== 0) return;
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    event.stopPropagation();
    dragging.current = true;
    held.current = null;
    store.host.freeze(true);
    handle.style.cursor = 'grabbing';

    const finish = (drop: Vec2 | null) => {
      stop.current = null;
      drag.current = null;
      window.removeEventListener('keydown', onKey);
      dragging.current = false;
      store.host.freeze(false);
      handle.style.cursor = 'grab';
      if (drop) {
        held.current = { at: drop, until: performance.now() + HOLD_MS };
        store.host.drop(kind, drop);
      }
      // Back where it belongs: the camera's or target's place, or where it was dropped.
      const el = group.current;
      if (el && !drop) {
        const [x, y] = mapViewToPixel(
          store.state.view,
          ...latest.current(store.state),
        );
        el.setAttribute('transform', `translate(${x} ${y})`);
        el.removeAttribute('opacity');
      }
    };
    const onKey = (key: KeyboardEvent) => {
      if (key.key !== 'Escape') return;
      handle.releasePointerCapture(event.pointerId);
      finish(null);
    };
    window.addEventListener('keydown', onKey);
    stop.current = () => finish(null);
    drag.current = { finish, id: event.pointerId };
  };

  const onPointerMove = (event: ReactPointerEvent<SVGElement>) => {
    if (!dragging.current || event.pointerId !== drag.current?.id) return;
    const at = pointer(event);
    if (!at) return;
    // Outside the map the marker waits dimmed at its edge: a drop there is cancelled.
    const x = Math.min(Math.max(at.x, 0), at.width);
    const y = Math.min(Math.max(at.y, 0), at.height);
    group.current?.setAttribute('transform', `translate(${x} ${y})`);
    if (at.inside) group.current?.removeAttribute('opacity');
    else group.current?.setAttribute('opacity', CANCEL_OPACITY);
    event.currentTarget.style.cursor = at.inside ? 'grabbing' : 'not-allowed';
  };

  const end = (event: ReactPointerEvent<SVGElement>, cancelled: boolean) => {
    if (!dragging.current || event.pointerId !== drag.current?.id) return;
    const at = pointer(event);
    const view: MapView = store.state.view;
    drag.current.finish(
      !cancelled && at?.inside ? mapViewFromPixel(view, at.x, at.y) : null,
    );
  };

  return {
    group,
    handleCircle,
    handle: {
      onPointerDown,
      onPointerMove,
      onPointerUp: (event: ReactPointerEvent<SVGElement>) => end(event, false),
      onPointerCancel: (event: ReactPointerEvent<SVGElement>) =>
        end(event, true),
      onPointerEnter: (event: ReactPointerEvent<SVGElement>) => {
        if (!dragging.current)
          event.currentTarget.style.cursor =
            draggable && store.host.canDrag() ? 'grab' : 'default';
      },
    },
  };
}
