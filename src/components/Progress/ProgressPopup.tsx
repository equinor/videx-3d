import { CSSProperties, useCallback, useEffect, useState } from 'react';
import { Progress, ProgressProps } from './Progress';
import {
  ProgressSelection,
  ProgressSnapshot,
  selectProgress,
} from './progress-store';
import { useProgress } from './useProgress';

/** @group Components */
export type ProgressPosition =
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
 * How a {@link ProgressPopup} shows its sources: all in one display (`none`), one
 * display per source (`source`) or per group (`group`), stacked.
 *
 * @group Components
 */
export type ProgressSplit = 'none' | 'source' | 'group';

/**
 * {@link ProgressPopup} props.
 * @expand
 * @group Components
 */
export type ProgressPopupProps = Omit<ProgressProps, 'onDismiss'> & {
  /** One display for all its sources, or one per source or per group, stacked. Default `'none'`. */
  split?: ProgressSplit;
  /** Where it sits in its positioned container. Default `'center'`. */
  position?: ProgressPosition;
  /** Distance in px from the edges it is anchored to, `[x, y]`. Default `[10, 10]`. */
  offset?: [number, number];
  /** How long, in ms, a run must last before it shows, so a quick one does not flash it. Default 0. */
  delay?: number;
  /** How long, in ms, a display stays after its run ends, with `data-state="closing"` — the time an exit transition gets. Default 0. */
  exitDuration?: number;
  /** Show a dismiss button that hides a display until its next run starts. Default false. */
  dismissible?: boolean;
  /**
   * Stay up once a run ends, with `data-state="done"`, until dismissed or the next run
   * starts. Default false.
   */
  stayOpen?: boolean;
  /** Called with the dismissed display's key (a source, a group or `all`) and its run's `session`. */
  onDismiss?: (key: string, session: number) => void;
  popupClassName?: string;
  popupStyle?: CSSProperties;
};

const CLASS = 'videx-progress-popup';

const DEFAULT_OFFSET: [number, number] = [10, 10];

const ALIGN = { start: 'flex-start', center: 'center', end: 'flex-end' };

const alongX = (position: ProgressPosition) =>
  position.endsWith('left')
    ? ALIGN.start
    : position.endsWith('right')
      ? ALIGN.end
      : ALIGN.center;

function layerStyle(
  position: ProgressPosition,
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
    justifyContent: alongX(position),
    padding: `${y}px ${x}px`,
    boxSizing: 'border-box',
    pointerEvents: 'none',
  };
}

// The displays a split asks for, each with its selection.
function displaysOf(
  snapshot: ProgressSnapshot,
  split: ProgressSplit,
  { source, group }: ProgressSelection,
): { key: string; selection: ProgressSelection }[] {
  if (source !== undefined) return [{ key: source, selection: { source } }];
  const sources =
    group !== undefined
      ? snapshot.sources.filter(s => s.group === group)
      : snapshot.sources;
  if (split === 'source')
    return sources.map(s => ({ key: s.key, selection: { source: s.key } }));
  if (split === 'group')
    return [...new Set(sources.map(s => s.group))].map(g => ({
      key: g,
      selection: { group: g },
    }));
  return [
    {
      key: group ?? 'all',
      selection: group !== undefined ? { group } : {},
    },
  ];
}

type CardProps = Omit<
  ProgressPopupProps,
  | 'split'
  | 'source'
  | 'group'
  | 'position'
  | 'offset'
  | 'popupClassName'
  | 'popupStyle'
> & {
  name: string;
  selection: ProgressSelection;
};

// One display, shown while its run lasts.
const Card = ({
  name,
  selection,
  delay = 0,
  exitDuration = 0,
  dismissible = false,
  stayOpen = false,
  onDismiss,
  ...content
}: CardProps) => {
  const { store } = content;
  const snapshot = useProgress(store);
  const level = selectProgress(snapshot, selection)?.level;
  const building = level?.building ?? false;
  const session = level?.session ?? 0;
  const idleRun = () => {
    const now = selectProgress(store.getSnapshot(), selection)?.level;
    return now?.building ? -1 : (now?.session ?? 0);
  };
  // The run whose delay has run out, the one dismissed, and the one whose exit has.
  const [armed, setArmed] = useState(-1);
  // A run that ended before this mounted has nothing to show or close.
  const [dismissed, setDismissed] = useState(idleRun);
  const [expired, setExpired] = useState(idleRun);
  const leaving = dismissed === session || (!building && !stayOpen);

  const dismiss = useCallback(() => {
    setDismissed(session);
    onDismiss?.(name, session);
  }, [name, session, onDismiss]);

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

  if (!level) return null;
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
    <div className={`${CLASS}__card`} data-state={state} data-key={name}>
      <Progress
        {...content}
        {...selection}
        onDismiss={dismissible ? dismiss : undefined}
        style={{ pointerEvents: 'auto', ...content.style }}
      />
    </div>
  );
};

/**
 * {@link Progress} displays in a container that shows each when its run starts and takes
 * it away when it ends (with `stayOpen`, once dismissed): all the store's sources as one,
 * or one display per source or per group (`split`), stacked. Render it in the host's
 * DOM, OUTSIDE the R3F canvas, inside the positioned element that holds the canvas.
 *
 * The container is a click-through layer covering that element; it only places the
 * displays (`position` / `offset`), in a `__stack` column. Its `videx-progress-popup`
 * class carries `data-position`; each display sits in a `__card` with `data-key` and
 * `data-state` (`open` | `done` | `closing`): enter with a CSS animation (it mounts when
 * a run starts), leave with a transition on `[data-state='closing']` lasting
 * `exitDuration` — the same when it is dismissed. Everything else is styled as for
 * {@link Progress}.
 *
 * @example
 * <div style={{ position: 'relative' }}>
 *   <Canvas>…<Sky onProgress={progress.source('sky', { name: 'Sky' })} />…</Canvas>
 *   <ProgressPopup store={progress} position="top" split="source" exitDuration={300} />
 * </div>
 *
 * @group Components
 */
export const ProgressPopup = ({
  split = 'none',
  source,
  group,
  position = 'center',
  offset = DEFAULT_OFFSET,
  popupClassName,
  popupStyle,
  ...rest
}: ProgressPopupProps) => {
  const snapshot = useProgress(rest.store);
  const displays = displaysOf(snapshot, split, { source, group });
  return (
    <div
      className={popupClassName ? `${CLASS} ${popupClassName}` : CLASS}
      style={{ ...layerStyle(position, offset), ...popupStyle }}
      data-position={position}
    >
      <div
        className={`${CLASS}__stack`}
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: alongX(position),
        }}
      >
        {displays.map(({ key, selection }) => (
          <Card key={key} name={key} selection={selection} {...rest} />
        ))}
      </div>
    </div>
  );
};
