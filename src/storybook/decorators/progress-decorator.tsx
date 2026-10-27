import type { ArgTypes, Decorator } from '@storybook/react-vite';
import { useEffect, useState } from 'react';
import { Progress } from '../../components/Progress/Progress';
import {
  ProgressPopup,
  ProgressPosition,
  ProgressSplit,
} from '../../components/Progress/ProgressPopup';
import {
  createProgressStore,
  describeProgress,
  ProgressStore,
  ProgressView,
} from '../../components/Progress/progress-store';
import { useProgress } from '../../components/Progress/useProgress';
import '../styles/progress.css';

/**
 * The stories' progress, held OUTSIDE the canvas as a host would: a `Sky` reports into it
 * as `sky` (through `skyPropsFromArgs`), a chunk stack as `model`. Each source goes away
 * when what reports it unmounts, so a story never shows another's.
 */
export const storyProgress = createProgressStore();

export type ProgressDisplay = 'popup' | 'inline' | 'custom' | 'off';

/** The story args {@link progressDecorator} reads. */
export type ProgressArgs = {
  progressDisplay: ProgressDisplay;
  progressPosition: ProgressPosition;
  progressSplit: ProgressSplit;
  progressDelay: number;
  progressStage: boolean;
  progressRows: boolean;
  progressExpandable: boolean;
  progressDismissible: boolean;
  progressStayOpen: boolean;
  progressSummary: boolean;
  progressInlineIdle: 'show' | 'hide';
};

export const progressArgs: ProgressArgs = {
  progressDisplay: 'popup',
  progressPosition: 'center',
  progressSplit: 'none',
  progressDelay: 0,
  progressStage: true,
  progressRows: true,
  progressExpandable: true,
  progressDismissible: true,
  progressStayOpen: false,
  progressSummary: true,
  progressInlineIdle: 'show',
};

const PROGRESS = { category: 'Progress' };

export const progressArgTypes: ArgTypes<ProgressArgs> = {
  progressDisplay: {
    control: { type: 'inline-radio' },
    options: ['popup', 'inline', 'custom', 'off'],
    description:
      'How progress is shown, OUTSIDE the canvas, from one `ProgressStore` the sky (`sky`) and a chunk stack (`model`) report into: `popup` = `ProgressPopup` (shows while working), `inline` = `Progress` docked bottom-right (stays, showing the last outcome), `custom` = a hairline along the top built on `useProgress` + `describeProgress` alone. The look is the stories’ own CSS; the library ships none.',
    table: PROGRESS,
  },
  progressPosition: {
    control: { type: 'select' },
    options: [
      'center',
      'top',
      'bottom',
      'left',
      'right',
      'top-left',
      'top-right',
      'bottom-left',
      'bottom-right',
    ],
    if: { arg: 'progressDisplay', eq: 'popup' },
    table: PROGRESS,
  },
  progressSplit: {
    control: { type: 'inline-radio' },
    options: ['none', 'source', 'group'],
    description:
      '`none`: one popup for every source, a row each. `source`: a popup per source, stacked, each coming and going with its own runs. `group`: a popup per group (`ProgressSourceOptions.group`; here each source is its own).',
    if: { arg: 'progressDisplay', eq: 'popup' },
    table: PROGRESS,
  },
  progressDelay: {
    control: { type: 'range', min: 0, max: 2000, step: 100 },
    description:
      'How long, in ms, a run must last before the popup shows, so a quick one — a few relief tiles as the camera moves — does not flash it.',
    if: { arg: 'progressDisplay', eq: 'popup' },
    table: PROGRESS,
  },
  progressStage: {
    description: 'Show the step being worked on.',
    table: PROGRESS,
  },
  progressRows: {
    description:
      'One row per item — per chunk, or the sky’s shaders and relief — or per source when the display shows several.',
    table: PROGRESS,
  },
  progressExpandable: {
    description: 'Put the details behind a toggle.',
    table: PROGRESS,
  },
  progressDismissible: {
    description: 'A `×` that hides a popup until its next run starts.',
    if: { arg: 'progressDisplay', eq: 'popup' },
    table: PROGRESS,
  },
  progressStayOpen: {
    description:
      'Keep a popup up once its run is done (`data-state="done"`), until dismissed or the next run starts.',
    if: { arg: 'progressDisplay', eq: 'popup' },
    table: PROGRESS,
  },
  progressSummary: {
    description:
      'Once a run is done, show its time, and a chunk stack’s tiles and triangles — a `footer` on `popup`/`inline`, the strip’s text for a few seconds on `custom`. Tiles need `tileCells`.',
    table: PROGRESS,
  },
  progressInlineIdle: {
    control: { type: 'inline-radio' },
    options: ['show', 'hide'],
    description:
      '`hide` fades the inline display out once the run is done — with CSS alone, on its `data-state="idle"`.',
    if: { arg: 'progressDisplay', eq: 'inline' },
    table: PROGRESS,
  },
};

const EXIT_MS = 400;
// How long the custom strip shows its summary once a run is done.
const STRIP_SUMMARY_MS = 3000;

function formatDuration(ms: number) {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

function formatCount(n: number) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} M`;
  if (n >= 1e4) return `${Math.round(n / 1e3)} k`;
  return `${n}`;
}

/** "12.3 s · 48 tiles · 1.2 M triangles", whichever parts are known once done. */
function summarize(view: ProgressView): string | null {
  if (view.building) return null;
  const parts: string[] = [];
  if (view.durationMs !== null) parts.push(formatDuration(view.durationMs));
  if (view.stats.tiles !== undefined) parts.push(`${view.stats.tiles} tiles`);
  if (view.stats.triangles !== undefined)
    parts.push(`${formatCount(view.stats.triangles)} triangles`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

/** Tier 1: built on the store, the hook and the view model alone. */
const ProgressStrip = ({
  store,
  summary,
}: {
  store: ProgressStore;
  summary: boolean;
}) => {
  const snapshot = useProgress(store);
  const { building, session } = snapshot.all;
  // The run whose summary has been shown long enough.
  const [expired, setExpired] = useState(-1);
  useEffect(() => {
    if (building || session === 0) return;
    const timer = setTimeout(() => setExpired(session), STRIP_SUMMARY_MS);
    return () => clearTimeout(timer);
  }, [building, session]);

  const view = describeProgress(snapshot);
  if (!view) return null;
  const text = building
    ? `${view.stage} · ${view.percent}%`
    : summary && session > 0 && expired !== session
      ? [view.title, summarize(view)].filter(Boolean).join(' · ')
      : null;
  if (text === null) return null;
  return (
    <div
      className="story-progress-strip"
      data-state={view.building ? 'building' : 'idle'}
    >
      <div
        className="story-progress-strip__fill"
        style={{ width: `${view.percent}%` }}
      />
      <span className="story-progress-strip__text">{text}</span>
    </div>
  );
};

/**
 * Show {@link storyProgress} OUTSIDE the canvas, the way a host would. Put it after
 * `Canvas3dDecorator` in the array, so it wraps the canvas; `skyDecorators` include it.
 */
export const progressDecorator: Decorator = (Story, { args }) => {
  const a = { ...progressArgs, ...(args as Partial<ProgressArgs>) };
  const details = { stage: a.progressStage, rows: a.progressRows };
  const footer = a.progressSummary ? summarize : undefined;
  return (
    <>
      <Story />
      {a.progressDisplay === 'popup' && (
        <ProgressPopup
          store={storyProgress}
          split={a.progressSplit}
          position={a.progressPosition}
          delay={a.progressDelay}
          details={details}
          expandable={a.progressExpandable}
          dismissible={a.progressDismissible}
          stayOpen={a.progressStayOpen}
          footer={footer}
          exitDuration={EXIT_MS}
          className="story-progress"
          popupClassName="story-progress-popup"
        />
      )}
      {a.progressDisplay === 'inline' && (
        <div className="story-progress-dock">
          <Progress
            store={storyProgress}
            details={details}
            expandable={a.progressExpandable}
            footer={footer}
            className={
              a.progressInlineIdle === 'hide'
                ? 'story-progress story-progress--hide-idle'
                : 'story-progress'
            }
          />
        </div>
      )}
      {a.progressDisplay === 'custom' && (
        <ProgressStrip store={storyProgress} summary={a.progressSummary} />
      )}
    </>
  );
};
