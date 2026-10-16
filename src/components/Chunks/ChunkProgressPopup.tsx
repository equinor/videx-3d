import { CSSProperties, useCallback, useEffect, useState } from 'react';
import { ChunkProgress, ChunkProgressProps } from './ChunkProgress';
import { useChunkProgress } from './useChunkProgress';

/** @group Components */
export type ChunkProgressPosition =
  | 'center'
  | 'top'
  | 'bottom'
  | 'left'
  | 'right'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right';

/**
 * {@link ChunkProgressPopup} props.
 * @expand
 * @group Components
 */
export type ChunkProgressPopupProps = Omit<ChunkProgressProps, 'onDismiss'> & {
  /** Where it sits in its positioned container. Default `'center'`. */
  position?: ChunkProgressPosition;
  /** Distance in px from the edges it is anchored to, `[x, y]`. Default `[10, 10]`. */
  offset?: [number, number];
  /** How long, in ms, a build must run before it shows, so a quick rebuild does not flash it. Default 0. */
  delay?: number;
  /** How long, in ms, it stays after a build finishes, with `data-state="closing"` — the time an exit transition gets. Default 0. */
  exitDuration?: number;
  /** Show a dismiss button that hides it until the next build starts. Default false. */
  dismissible?: boolean;
  /**
   * Stay up once a build finishes, with `data-state="done"`, until dismissed or the
   * next build starts. Default false.
   */
  stayOpen?: boolean;
  /** Called with the dismissed build's `session`. */
  onDismiss?: (session: number) => void;
  popupClassName?: string;
  popupStyle?: CSSProperties;
};

const CLASS = 'videx-chunk-progress-popup';

const DEFAULT_OFFSET: [number, number] = [10, 10];

const ALIGN = { start: 'flex-start', center: 'center', end: 'flex-end' };

function layerStyle(
  position: ChunkProgressPosition,
  [x, y]: [number, number],
): CSSProperties {
  return {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: position.startsWith('top')
      ? ALIGN.start
      : position.startsWith('bottom')
        ? ALIGN.end
        : ALIGN.center,
    justifyContent: position.endsWith('left')
      ? ALIGN.start
      : position.endsWith('right')
        ? ALIGN.end
        : ALIGN.center,
    padding: `${y}px ${x}px`,
    boxSizing: 'border-box',
    pointerEvents: 'none',
  };
}

/**
 * A {@link ChunkProgress} in a container that shows itself when a build starts
 * and goes away when it finishes (with `stayOpen`, once dismissed). Render it in
 * the host's DOM, OUTSIDE the R3F canvas, inside the positioned element that
 * holds the canvas.
 *
 * The container is a click-through layer covering that element; it only places
 * the display (`position` / `offset`). Its `videx-chunk-progress-popup` class
 * carries `data-position` and `data-state` (`open` | `done` | `closing`): enter with a CSS
 * animation (it mounts when a build starts), leave with a transition on
 * `[data-state='closing']` lasting `exitDuration` — the same when it is
 * dismissed. Everything else is styled as for {@link ChunkProgress}.
 *
 * @example
 * <div style={{ position: 'relative' }}>
 *   <Canvas>…<ChunkStack onProgress={progress.report}>…</ChunkStack>…</Canvas>
 *   <ChunkProgressPopup store={progress} position="top" exitDuration={300} />
 * </div>
 *
 * @group Components
 */
export const ChunkProgressPopup = ({
  position = 'center',
  offset = DEFAULT_OFFSET,
  delay = 0,
  exitDuration = 0,
  dismissible = false,
  stayOpen = false,
  onDismiss,
  popupClassName,
  popupStyle,
  ...content
}: ChunkProgressPopupProps) => {
  const { store } = content;
  const { building, session } = useChunkProgress(store);
  // The session whose delay has run out, the one dismissed, and the one whose exit has.
  const [armed, setArmed] = useState(-1);
  // A build that finished before this mounted has nothing to show or close.
  const [dismissed, setDismissed] = useState(() => {
    const snapshot = store.getSnapshot();
    return snapshot.building ? -1 : snapshot.session;
  });
  const [expired, setExpired] = useState(() => {
    const snapshot = store.getSnapshot();
    return snapshot.building ? -1 : snapshot.session;
  });
  const leaving = dismissed === session || (!building && !stayOpen);

  const dismiss = useCallback(() => {
    setDismissed(session);
    onDismiss?.(session);
  }, [session, onDismiss]);

  useEffect(() => {
    if (!building || delay <= 0) return;
    const timer = setTimeout(() => setArmed(session), delay);
    return () => clearTimeout(timer);
  }, [building, session, delay]);

  useEffect(() => {
    if (!leaving || exitDuration <= 0) return;
    const timer = setTimeout(() => setExpired(session), exitDuration);
    return () => clearTimeout(timer);
  }, [leaving, session, exitDuration]);

  const shown = delay <= 0 || armed === session;
  const state = !shown
    ? null
    : !leaving
      ? building
        ? 'open'
        : 'done'
      : exitDuration > 0 && expired !== session
        ? 'closing'
        : null;
  if (!state) return null;

  return (
    <div
      className={popupClassName ? `${CLASS} ${popupClassName}` : CLASS}
      style={{ ...layerStyle(position, offset), ...popupStyle }}
      data-state={state}
      data-position={position}
    >
      <ChunkProgress
        {...content}
        onDismiss={dismissible ? dismiss : undefined}
        style={{ pointerEvents: 'auto', ...content.style }}
      />
    </div>
  );
};
