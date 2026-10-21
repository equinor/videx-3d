// The element taking the pointer over a cutaway's grip (the Sky's `cutaway.handle`), which the
// shader draws on the rim. Over the canvas, it takes its own pointer events, so camera controls
// on the canvas or its container never see the drag.

const WIDTH = 44;
const HEIGHT = 32;
const DOUBLE_TAP_MS = 300;

/** What a {@link SkyCutawayHandle} reports. */
export type SkyCutawayHandleEvents = {
  /** dragged: the rim belongs under client point `x`, `y` */
  drag: (x: number, y: number) => void;
  /** let go */
  release: () => void;
  /** a double click or tap */
  reset: () => void;
};

/** The invisible target over a cutaway's grip. Internal to `Sky`. */
export class SkyCutawayHandle {
  readonly element = document.createElement('div');
  /** being dragged */
  active = false;
  /** under the pointer */
  hover = false;
  private grabX = 0;
  private grabY = 0;
  private lastDown = -Infinity;
  private shown = false;
  private readonly listeners: [string, (event: PointerEvent) => void][];

  constructor(
    parent: HTMLElement,
    private readonly events: SkyCutawayHandleEvents,
  ) {
    const element = this.element;
    Object.assign(element.style, {
      position: 'absolute',
      left: '0',
      top: '0',
      width: `${WIDTH}px`,
      height: `${HEIGHT}px`,
      display: 'none',
      cursor: 'ns-resize',
      touchAction: 'none',
      userSelect: 'none',
      pointerEvents: 'auto',
      zIndex: '10',
    } as Partial<CSSStyleDeclaration>);

    const end = (event: PointerEvent) => {
      if (!this.active) return;
      event.stopPropagation();
      this.active = false;
      if (element.hasPointerCapture(event.pointerId))
        element.releasePointerCapture(event.pointerId);
      this.events.release();
    };
    this.listeners = [
      [
        'pointerdown',
        event => {
          event.stopPropagation();
          event.preventDefault();
          const now = performance.now();
          if (now - this.lastDown < DOUBLE_TAP_MS) {
            this.lastDown = -Infinity;
            this.events.reset();
            return;
          }
          this.lastDown = now;
          // Held where it was taken, so the rim does not jump to the pointer.
          const box = element.getBoundingClientRect();
          this.grabX = event.clientX - (box.left + box.width / 2);
          this.grabY = event.clientY - (box.top + box.height / 2);
          element.setPointerCapture(event.pointerId);
          this.active = true;
        },
      ],
      [
        'pointermove',
        event => {
          if (!this.active) return;
          event.stopPropagation();
          this.events.drag(
            event.clientX - this.grabX,
            event.clientY - this.grabY,
          );
        },
      ],
      ['pointerup', end],
      ['pointercancel', end],
      // A click after the drag must not reach the scene's own pointer events.
      ['click', event => event.stopPropagation()],
      ['pointerenter', () => (this.hover = true)],
      ['pointerleave', () => (this.hover = false)],
    ];
    for (const [type, listener] of this.listeners)
      element.addEventListener(type, listener as EventListener);
    parent.appendChild(element);
  }

  /** Over the grip at `x`, `y` (pixels in the canvas), along the rim at `angle` (radians). */
  place(x: number, y: number, angle: number) {
    if (!this.shown) {
      this.shown = true;
      this.element.style.display = 'block';
    }
    this.element.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) rotate(${angle}rad)`;
  }

  hide() {
    if (!this.shown) return;
    this.shown = false;
    this.hover = false;
    this.element.style.display = 'none';
  }

  dispose() {
    for (const [type, listener] of this.listeners)
      this.element.removeEventListener(type, listener as EventListener);
    this.element.remove();
  }
}
