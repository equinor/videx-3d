import { useThree } from '@react-three/fiber';
import { FiberProvider, useContextBridge } from 'its-fine';
import { useLayoutEffect, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * CanvasHtml props
 * @expand
 */
export type CanvasHtmlProps = {
  /** the HTML to render: it sees every context the `Canvas` sees */
  children?: ReactNode;
  /**
   * an element of the host's page to render into — a sidebar beside the canvas, say — whose
   * layout then places the children (they are rendered in an element of their own inside it,
   * `display: contents`). Keep it empty of anything React renders. Default a layer of its own
   * over the canvas (see `parent`)
   */
  container?: HTMLElement | null;
  /**
   * without `container`: the element its own layer is laid over, filling it. Default the
   * renderer canvas's parent, falling back to `document.body`
   */
  parent?: HTMLElement | null;
  /**
   * keep a press, the wheel, a click, a double click and the context menu on what it renders
   * from the scene's controls and R3F's events, which listen on the canvas's parent. Moves and
   * releases go on, so a drag of the scene passing over it is not cut off. Default true
   */
  isolate?: boolean;
  /** without `container`: its own layer's z-index over the canvas. Default 10 */
  zIndex?: number;
  /** a class for the element it renders into, for styles of your own */
  className?: string;
};

// What would reach the scene's controls and R3F's events from what the children render.
const STOPPED = [
  'pointerdown',
  'wheel',
  'click',
  'dblclick',
  'contextmenu',
  'touchstart',
] as const;
const stop = (event: Event) => event.stopPropagation();

/**
 * HTML rendered from inside the `<Canvas>`: into a layer of its own over the canvas, or into
 * an element of the host's page (`container`), in a React root of its own that sees every
 * context the `Canvas` sees, bridged (`its-fine`) — R3F's `useThree` and `useFrame`, a
 * `World`, the data, the host's own. What it renders does not reach the scene's controls
 * (`isolate`). Its layer lets the pointer through where nothing is drawn: give what you place
 * on it `pointer-events: auto`.
 *
 * The building block an `Overlay` is made of, for a layout of your own: a `Minimap`, an
 * `AltitudeControl`, a `Panel` or a `GeoMap` with a `GeoMapCamera` render wherever you put them
 * in it.
 *
 * @example
 * // Over the view, in a layout of your own.
 * <Canvas>
 *   <CanvasHtml>
 *     <div style={{ position: 'absolute', ...anchorStyle('bottom-left', 10), display: 'flex', gap: 8 }}>
 *       <Minimap inline layers={layers}><GeoMapCameraMarker /></Minimap>
 *       <AltitudeControl />
 *     </div>
 *   </CanvasHtml>
 * </Canvas>
 *
 * // In a sidebar of the page, beside the canvas.
 * <CanvasHtml container={sidebar}>
 *   <Minimap inline layers={layers} />
 * </CanvasHtml>
 *
 * @see `documents/overlay.md`
 * @group Components
 */
export const CanvasHtml = (props: CanvasHtmlProps) => (
  // A fiber root of our own in R3F's tree, for the bridge to find the contexts above it.
  <FiberProvider>
    <CanvasHtmlHost {...props} />
  </FiberProvider>
);

const CanvasHtmlHost = ({
  children,
  container,
  parent,
  isolate = true,
  zIndex = 10,
  className,
}: CanvasHtmlProps) => {
  const gl = useThree(state => state.gl);
  const Bridge = useContextBridge();
  const [host, setHost] = useState<{
    root: Root;
    element: HTMLDivElement;
  } | null>(null);

  useLayoutEffect(() => {
    const element = document.createElement('div');
    if (container) {
      // Its children laid out by the container, as if they were its own.
      element.style.display = 'contents';
      container.appendChild(element);
    } else {
      Object.assign(element.style, {
        position: 'absolute',
        left: '0',
        top: '0',
        right: '0',
        bottom: '0',
        pointerEvents: 'none',
      });
      (parent ?? gl.domElement.parentElement ?? document.body).appendChild(
        element,
      );
    }
    const root = createRoot(element);
    setHost({ root, element });
    return () => {
      setHost(null);
      // Not while React is rendering: it warns of unmounting a root from inside one.
      setTimeout(() => {
        root.unmount();
        element.remove();
      });
    };
  }, [gl, container, parent]);

  useLayoutEffect(() => {
    if (host) host.element.style.zIndex = container ? '' : String(zIndex);
  }, [host, container, zIndex]);

  useLayoutEffect(() => {
    const element = host?.element;
    if (!element || !isolate) return;
    for (const type of STOPPED)
      element.addEventListener(type, stop, { passive: true });
    return () => {
      for (const type of STOPPED) element.removeEventListener(type, stop);
    };
  }, [host, isolate]);

  useLayoutEffect(() => {
    if (host) host.element.className = className ?? '';
  }, [host, className]);

  // Every render: the bridge carries the contexts' values as they are now.
  useLayoutEffect(() => {
    host?.root.render(<Bridge>{children}</Bridge>);
  });

  return null;
};
