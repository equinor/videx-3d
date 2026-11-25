import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  CSSProperties,
  ReactNode,
  useCallback,
  useEffect,
  useState,
} from 'react';
import '../../storybook/styles/progress.css';
import { Progress } from './Progress';
import {
  ProgressPopup,
  ProgressPosition,
  ProgressSplit,
} from './ProgressPopup';
import {
  createProgressStore,
  ProgressItem,
  ProgressReport,
  ProgressSourceOptions,
  ProgressView,
} from './progress-store';

// Progress shown in the host's DOM from a `ProgressStore` (`createProgressStore`), with no
// canvas: two made-up sources report into it as a zone stack and a relief would, a model of
// three zones each working through its steps, and the relief's tiles. `ProgressPopup` shows
// while a run lasts; `Progress` stays where it is placed. The library ships no CSS: the look
// is the stories' own stylesheet (`src/storybook/styles/progress.css`).

// A unit of work a made-up source does: its steps in turn, from `from` to `to` of the run.
type Job = {
  key: string;
  name: string;
  from: number;
  to: number;
  weight?: number;
  steps: { label: string; total: number }[];
  stats: Record<string, number>;
};

type Source = {
  key: string;
  options: ProgressSourceOptions;
  jobs: Job[];
};

const ZONE_STEPS = [
  { label: 'Fetching surfaces', total: 3 },
  { label: 'Triangulating', total: 1 },
  { label: 'Building mesh', total: 16 },
];

const SOURCES: Source[] = [
  {
    key: 'model',
    options: { name: 'Model', title: 'Building the model' },
    jobs: [
      {
        key: 'overburden',
        name: 'Overburden',
        from: 0,
        to: 0.45,
        steps: ZONE_STEPS,
        stats: { triangles: 420000 },
      },
      {
        key: 'reservoir',
        name: 'Reservoir',
        from: 0.15,
        to: 0.85,
        weight: 2,
        steps: ZONE_STEPS,
        stats: { triangles: 860000 },
      },
      {
        key: 'basement',
        name: 'Basement',
        from: 0.5,
        to: 1,
        steps: ZONE_STEPS,
        stats: { triangles: 150000 },
      },
    ],
  },
  {
    key: 'relief',
    options: { name: 'Relief', title: 'Loading the relief' },
    jobs: [
      {
        key: 'tiles',
        name: 'Tiles',
        from: 0,
        to: 0.6,
        steps: [{ label: 'Loading tiles', total: 48 }],
        stats: { tiles: 48 },
      },
    ],
  },
];

// The job that fails, when the run is to end with errors.
const FAILING = 'reservoir';
// How often the sources report, ms.
const TICK = 100;

/** What a source is doing at `t` (0 to 1) of a run that started at `start` and lasts `duration` ms. */
function reportAt(
  jobs: Job[],
  t: number,
  start: number,
  duration: number,
  fail: boolean,
): ProgressReport {
  return {
    items: jobs.map(({ key, name, weight, from, to, steps, stats }) => {
      const item: ProgressItem = {
        key,
        name,
        weight,
        state: 'working',
        estimate: 0,
      };
      const share = (t - from) / (to - from);
      // Not started: working, with no step yet ("Preparing").
      if (share <= 0) return item;
      item.startedAt = start + from * duration;
      if (share >= 1) {
        const failed = fail && key === FAILING;
        item.state = failed ? 'failed' : 'ready';
        item.estimate = 1;
        item.finishedAt = start + to * duration;
        if (!failed) item.stats = stats;
        return item;
      }
      item.estimate = share;
      // The step it is on, and how many of that step's units are done.
      const along = share * steps.length;
      const index = Math.min(Math.floor(along), steps.length - 1);
      const { label, total } = steps[index];
      item.step = { label, total, done: Math.floor((along - index) * total) };
      return item;
    }),
  };
}

/**
 * A store, and the made-up sources reporting into it for `seconds`; `again` starts a new run.
 * Each source goes away (a report with no items) when its run is replaced or the story
 * unmounts.
 */
function useSimulatedProgress(seconds: number, fail: boolean) {
  // Held outside any canvas, as a host would: one store, any number of sources.
  const [store] = useState(createProgressStore);
  const [run, setRun] = useState(0);
  const again = useCallback(() => setRun(count => count + 1), []);
  useEffect(() => {
    const duration = seconds * 1000;
    const start = performance.now();
    const reporters = SOURCES.map(({ key, options, jobs }) => ({
      report: store.source(key, options),
      jobs,
    }));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      const t = (performance.now() - start) / duration;
      for (const { report, jobs } of reporters)
        report(reportAt(jobs, t, start, duration, fail));
      if (t < 1) timer = setTimeout(tick, TICK);
    };
    tick();
    return () => {
      clearTimeout(timer);
      for (const { report } of reporters) report({ items: [] });
    };
  }, [store, seconds, fail, run]);
  return { store, again };
}

/** "6.0 s · 48 tiles · 1.4 M triangles": once a run is done, whichever parts are known. */
function summarize(view: ProgressView): string | null {
  if (view.building) return null;
  const parts: string[] = [];
  if (view.durationMs !== null)
    parts.push(`${(view.durationMs / 1000).toFixed(1)} s`);
  if (view.stats.tiles !== undefined) parts.push(`${view.stats.tiles} tiles`);
  if (view.stats.triangles !== undefined)
    parts.push(`${(view.stats.triangles / 1e6).toFixed(1)} M triangles`);
  return parts.length > 0 ? parts.join(' \u00b7 ') : null;
}

const STAGE_STYLE: CSSProperties = {
  position: 'absolute',
  inset: 0,
  overflow: 'hidden',
  background: 'linear-gradient(#24394d, #0d1a26)',
};

const BUTTON_STYLE: CSSProperties = {
  position: 'absolute',
  left: 10,
  bottom: 10,
  padding: '6px 12px',
  border: 'none',
  borderRadius: 4,
  background: '#f28e2c',
  color: '#000',
  font: '12px verdana, sans-serif',
  cursor: 'pointer',
};

/** Where a canvas would be: the positioned element a popup covers, and a button to run again. */
const Stage = ({
  onRun,
  children,
}: {
  onRun: () => void;
  children: ReactNode;
}) => (
  <div style={STAGE_STYLE}>
    {children}
    <button type="button" style={BUTTON_STYLE} onClick={onRun}>
      Run again
    </button>
  </div>
);

type SimulationArgs = {
  duration: number;
  fail: boolean;
};

const POPUP_DETAILS = { stage: true, rows: true };

type PopupArgs = SimulationArgs & {
  position: ProgressPosition;
  split: ProgressSplit;
  delay: number;
  dismissible: boolean;
  stayOpen: boolean;
};

const PopupStory = ({
  duration,
  fail,
  position,
  split,
  delay,
  dismissible,
  stayOpen,
}: PopupArgs) => {
  const { store, again } = useSimulatedProgress(duration, fail);
  return (
    <Stage onRun={again}>
      <ProgressPopup
        store={store}
        position={position}
        split={split}
        delay={delay}
        dismissible={dismissible}
        stayOpen={stayOpen}
        details={POPUP_DETAILS}
        footer={summarize}
        exitDuration={400}
        className="story-progress"
        popupClassName="story-progress-popup"
      />
    </Stage>
  );
};

type InlineArgs = SimulationArgs & {
  stage: boolean;
  rows: boolean;
  expandable: boolean;
  summary: boolean;
  hideIdle: boolean;
};

const InlineStory = ({
  duration,
  fail,
  stage,
  rows,
  expandable,
  summary,
  hideIdle,
}: InlineArgs) => {
  const { store, again } = useSimulatedProgress(duration, fail);
  return (
    <Stage onRun={again}>
      <div className="story-progress-dock">
        <Progress
          store={store}
          details={{ stage, rows }}
          expandable={expandable}
          footer={summary ? summarize : undefined}
          className={
            hideIdle
              ? 'story-progress story-progress--hide-idle'
              : 'story-progress'
          }
        />
      </div>
    </Stage>
  );
};

const DISPLAY = 'Display';
const SOURCE = 'Source';

const simulationArgs: SimulationArgs = { duration: 6, fail: false };

const simulationArgTypes = {
  duration: {
    control: { type: 'range', min: 1, max: 20, step: 1 },
    description:
      'Seconds the made-up run takes. Changing it starts a new run, as does the button.',
    table: { category: SOURCE },
  },
  fail: {
    control: { type: 'boolean' },
    description:
      'The reservoir zone ends `failed`: the run ends with errors (`outcome`), the title says so.',
    table: { category: SOURCE },
  },
} as const;

const meta = {
  title: 'Components/Html/Progress',
} satisfies Meta;

export default meta;

/**
 * `ProgressPopup`: a card over the view while a run lasts, entering and leaving with the
 * stories' CSS, one for every source or one per source (`split`).
 */
export const Default: StoryObj<PopupArgs> = {
  args: {
    ...simulationArgs,
    position: 'center',
    split: 'none',
    delay: 0,
    dismissible: true,
    stayOpen: false,
  },
  argTypes: {
    position: {
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
      control: { type: 'select' },
      description:
        'Where the cards sit in the positioned element holding the canvas (`position`).',
      table: { category: DISPLAY },
    },
    split: {
      options: ['none', 'source'],
      control: { type: 'inline-radio' },
      description:
        'NONE: one card for every source, a row each. SOURCE: a card per source, stacked, each coming and going with its own run (`split`).',
      table: { category: DISPLAY },
    },
    delay: {
      control: { type: 'range', min: 0, max: 2000, step: 100 },
      description:
        'How long, in ms, a run must last before its card shows (`delay`), so a quick one does not flash it.',
      table: { category: DISPLAY },
    },
    dismissible: {
      control: { type: 'boolean' },
      description:
        'A \u00d7 that hides a card until its next run starts (`dismissible`).',
      table: { category: DISPLAY },
    },
    stayOpen: {
      control: { type: 'boolean' },
      description:
        'Keep a card up once its run is done, with its time and size, until dismissed or the next run starts (`stayOpen`).',
      table: { category: DISPLAY },
    },
    ...simulationArgTypes,
  },
  render: args => <PopupStory {...args} />,
};

/**
 * `Progress`: plain HTML where it is placed, here docked bottom right. It stays once the run
 * is done, showing how it ended.
 */
export const Inline: StoryObj<InlineArgs> = {
  args: {
    ...simulationArgs,
    stage: true,
    rows: true,
    expandable: true,
    summary: true,
    hideIdle: false,
  },
  argTypes: {
    stage: {
      control: { type: 'boolean' },
      description: 'Show the step being worked on (`details.stage`).',
      table: { category: DISPLAY },
    },
    rows: {
      control: { type: 'boolean' },
      description:
        'A row per source, or per item where only one source is shown (`details.rows`).',
      table: { category: DISPLAY },
    },
    expandable: {
      control: { type: 'boolean' },
      description:
        'Put the details behind a toggle (`expandable`); the store remembers whether they are open.',
      table: { category: DISPLAY },
    },
    summary: {
      control: { type: 'boolean' },
      description:
        'Once a run is done, its time, tiles and triangles in a `footer`, from the view\u2019s `durationMs` and summed `stats`.',
      table: { category: DISPLAY },
    },
    hideIdle: {
      control: { type: 'boolean' },
      description:
        'Fade the display out once the run is done, with CSS alone, on its `data-state="idle"`.',
      table: { category: DISPLAY },
    },
    ...simulationArgTypes,
  },
  render: args => <InlineStory {...args} />,
};
