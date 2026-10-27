/**
 * A unit of work a progress source reports: a chunk being built, the sky's shaders, the
 * relief's tiles.
 *
 * @group Components
 */
export type ProgressState = 'working' | 'ready' | 'empty' | 'failed';

/**
 * What an item is doing: `done` of `total` units of it, shown as `label` and, with
 * several units, the count (`Building mesh 3/16`).
 *
 * @group Components
 */
export type ProgressStep = {
  label: string;
  done: number;
  total: number;
};

/**
 * One unit of work in a {@link ProgressReport}.
 *
 * @group Components
 */
export type ProgressItem = {
  /** stable while the item is there */
  key: string;
  name?: string;
  state: ProgressState;
  /** how far it has come, 0 to 1; taken as 1 once it is no longer `working` */
  estimate: number;
  /** its share of the source's estimate, relative to the other items'. Default 1 */
  weight?: number;
  /** the step it is on, while working */
  step?: ProgressStep;
  /** `performance.now()` when its latest run started */
  startedAt?: number;
  /** `performance.now()` when its latest run ended */
  finishedAt?: number;
  /** numbers a display sums once a run is done, e.g. `{ tiles: 48, triangles: 1.2e6 }` */
  stats?: Record<string, number>;
};

/**
 * Everything a progress source is doing, reported whole each time anything changes. No
 * items means the source has gone away.
 *
 * @group Components
 */
export type ProgressReport = {
  items: ProgressItem[];
  /** the item whose step heads a display; default the first working item with a step */
  current?: string;
};

/** @group Components */
export type ProgressOutcome = 'ready' | 'failed';

/**
 * One run of work, from the first report that is working to the first that is not.
 *
 * @group Components
 */
export type ProgressSession = {
  building: boolean;
  /**
   * 0 to 100, whole numbers. Never moves backwards within a run, and stays below 100
   * until it ends.
   */
  percent: number;
  /** increments each time a run starts, 0 before the first */
  session: number;
  /** `performance.now()` when the current or last run started */
  startedAt: number | null;
  /** `performance.now()` when the last run ended, `null` while building */
  finishedAt: number | null;
  /**
   * How the last run ended: `null` while building, before the first, and when what
   * reported went away mid-run.
   */
  outcome: ProgressOutcome | null;
};

/**
 * How a source appears in a display (see {@link ProgressStore.source}).
 *
 * @group Components
 */
export type ProgressSourceOptions = {
  /** its name, as a row when a display shows several sources */
  name?: string;
  /** a display's title while it shows only this source building; default `name` */
  title?: string;
  /** sources in the same group share a display with `split: 'group'`. Default its key */
  group?: string;
};

/**
 * One source in a {@link ProgressSnapshot}, and its own run.
 *
 * @group Components
 */
export type ProgressSourceSnapshot = ProgressSession & {
  key: string;
  name?: string;
  title?: string;
  group: string;
  /** its latest report */
  report: ProgressReport;
};

/**
 * Several sources' runs taken as one: from when the first starts to when the last of those
 * that took part ends.
 *
 * @group Components
 */
export type ProgressLevelSnapshot = ProgressSession & {
  /** the sources that took part in the current or last run, in order */
  sources: string[];
  /** the building source that reported last, whose step heads a display */
  current: string | null;
};

/**
 * What a {@link ProgressStore} holds.
 *
 * @group Components
 */
export type ProgressSnapshot = {
  /** the sources there, in the order they first reported */
  sources: ProgressSourceSnapshot[];
  /** every source, as one */
  all: ProgressLevelSnapshot;
  /** each group of the sources there, as one */
  groups: Record<string, ProgressLevelSnapshot>;
  /**
   * Whether the details are expanded, as last toggled in any display reading this store;
   * `null` until then. Survives runs, so a display that comes back opens the way it was
   * left.
   */
  expanded: boolean | null;
};

/**
 * Holds progress outside the R3F canvas, from any number of sources: a `ChunkStack`, a
 * `Sky`, your own loaders. Each reports through {@link ProgressStore.source}; read it
 * with `useProgress`, `Progress` or `ProgressPopup` anywhere in the host's DOM.
 *
 * @group Components
 */
export type ProgressStore = {
  /**
   * The report function of the source `key`: the same function for the same key, so it
   * can be passed in render. The options are taken from the latest call.
   */
  source: (
    key: string,
    options?: ProgressSourceOptions,
  ) => (report: ProgressReport) => void;
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => ProgressSnapshot;
  /** Expand or collapse the details of every display reading this store. */
  setExpanded: (expanded: boolean) => void;
};

/**
 * Which sources a display shows: one `source`, one `group`, or every source.
 *
 * @group Components
 */
export type ProgressSelection = { source?: string; group?: string };

const IDLE_SESSION: ProgressSession = {
  building: false,
  percent: 0,
  session: 0,
  startedAt: null,
  finishedAt: null,
  outcome: null,
};

const IDLE_LEVEL: ProgressLevelSnapshot = {
  ...IDLE_SESSION,
  sources: [],
  current: null,
};

type SessionInput = {
  building: boolean;
  /** 0 to 1 */
  estimate: number;
  failed: boolean;
  gone: boolean;
};

function nextSession<T extends ProgressSession>(
  previous: T,
  input: SessionInput,
  now: number,
): T {
  const raw = Math.max(0, Math.floor(input.estimate * 100));
  if (input.building) {
    const starting = !previous.building;
    return {
      ...previous,
      building: true,
      percent: Math.min(99, starting ? raw : Math.max(previous.percent, raw)),
      session: starting ? previous.session + 1 : previous.session,
      startedAt: starting ? now : previous.startedAt,
      finishedAt: null,
      outcome: null,
    };
  }
  const ended = previous.building;
  return {
    ...previous,
    building: false,
    percent: input.gone ? previous.percent : 100,
    finishedAt: ended ? now : previous.finishedAt,
    outcome: input.gone
      ? ended
        ? null
        : previous.outcome
      : input.failed
        ? 'failed'
        : 'ready',
  };
}

function reportInput(report: ProgressReport): SessionInput {
  let sum = 0;
  let weights = 0;
  for (const item of report.items) {
    const weight = item.weight ?? 1;
    sum +=
      weight *
      (item.state === 'working' ? Math.min(Math.max(item.estimate, 0), 1) : 1);
    weights += weight;
  }
  return {
    building: report.items.some(item => item.state === 'working'),
    estimate: weights > 0 ? sum / weights : 1,
    failed: report.items.some(item => item.state === 'failed'),
    gone: report.items.length === 0,
  };
}

// A run over several sources; `taking` are those that took part in it.
type Level = { snapshot: ProgressLevelSnapshot; taking: Set<string> };

/**
 * Create a {@link ProgressStore}. Listeners hear at most one notification per animation
 * frame, however often the sources report.
 *
 * @example
 * const progress = useMemo(createProgressStore, []);
 * // inside the canvas
 * <Sky onProgress={progress.source('sky', { name: 'Sky' })} />
 * // anywhere in the host's DOM
 * <ProgressPopup store={progress} position="top" />
 *
 * @group Components
 */
export function createProgressStore(): ProgressStore {
  const reporters = new Map<
    string,
    {
      report: (report: ProgressReport) => void;
      options: ProgressSourceOptions;
    }
  >();
  const sources = new Map<string, ProgressSourceSnapshot>();
  const reportedAt = new Map<string, number>();
  let reports = 0;
  const all: Level = { snapshot: IDLE_LEVEL, taking: new Set() };
  const groups = new Map<string, Level>();
  let snapshot: ProgressSnapshot = {
    sources: [],
    all: IDLE_LEVEL,
    groups: {},
    expanded: null,
  };

  const listeners = new Set<() => void>();
  let scheduled = false;
  const notify = () => {
    scheduled = false;
    listeners.forEach(listener => listener());
  };

  const updateLevel = (
    level: Level,
    members: ProgressSourceSnapshot[],
    now: number,
  ) => {
    const building = members.filter(source => source.building);
    if (building.length > 0 && !level.snapshot.building) level.taking.clear();
    for (const source of building) level.taking.add(source.key);
    const taking = members.filter(source => level.taking.has(source.key));
    const estimate =
      taking.length > 0
        ? taking.reduce((sum, source) => sum + source.percent / 100, 0) /
          taking.length
        : 1;
    let current: string | null = null;
    for (const source of building) {
      if (
        current === null ||
        (reportedAt.get(source.key) ?? 0) > (reportedAt.get(current) ?? 0)
      )
        current = source.key;
    }
    level.snapshot = {
      ...nextSession(
        level.snapshot,
        {
          building: building.length > 0,
          estimate,
          failed: taking.some(source => source.outcome === 'failed'),
          gone: members.length === 0,
        },
        now,
      ),
      sources: taking.map(source => source.key),
      current,
    };
  };

  const report = (key: string, next: ProgressReport) => {
    const now = performance.now();
    const options = reporters.get(key)?.options ?? {};
    const previous = sources.get(key);
    const group = options.group ?? key;
    const input = reportInput(next);
    const source = nextSession<ProgressSourceSnapshot>(
      previous ?? { ...IDLE_SESSION, key, group, report: next },
      input,
      now,
    );
    source.name = options.name;
    source.title = options.title;
    source.group = group;
    source.report = next;
    reportedAt.set(key, ++reports);
    if (input.gone) sources.delete(key);
    else sources.set(key, source);

    const present = [...sources.values()];
    updateLevel(all, present, now);
    for (const name of new Set([group, previous?.group ?? group])) {
      let level = groups.get(name);
      if (!level) {
        level = { snapshot: IDLE_LEVEL, taking: new Set() };
        groups.set(name, level);
      }
      updateLevel(
        level,
        present.filter(s => s.group === name),
        now,
      );
    }
    const shown: Record<string, ProgressLevelSnapshot> = {};
    for (const s of present) {
      const level = groups.get(s.group);
      if (level) shown[s.group] = level.snapshot;
    }
    snapshot = {
      sources: present,
      all: all.snapshot,
      groups: shown,
      expanded: snapshot.expanded,
    };

    if (typeof requestAnimationFrame !== 'function') return notify();
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(notify);
  };

  return {
    source: (key, options = {}) => {
      let entry = reporters.get(key);
      if (!entry) {
        entry = { report: next => report(key, next), options };
        reporters.set(key, entry);
      }
      entry.options = options;
      return entry.report;
    },
    subscribe: listener => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    setExpanded: expanded => {
      if (snapshot.expanded === expanded) return;
      snapshot = { ...snapshot, expanded };
      // At once: a click should not wait for the next frame.
      listeners.forEach(listener => listener());
    },
  };
}

/**
 * The run a display of `selection` shows, and the sources in it; `null` while none of
 * them is there.
 *
 * @group Components
 */
export function selectProgress(
  snapshot: ProgressSnapshot,
  selection: ProgressSelection = {},
): { level: ProgressLevelSnapshot; sources: ProgressSourceSnapshot[] } | null {
  if (selection.source !== undefined) {
    const source = snapshot.sources.find(s => s.key === selection.source);
    if (!source) return null;
    return {
      level: {
        ...source,
        sources: [source.key],
        current: source.building ? source.key : null,
      },
      sources: [source],
    };
  }
  const sources =
    selection.group !== undefined
      ? snapshot.sources.filter(s => s.group === selection.group)
      : snapshot.sources;
  if (sources.length === 0) return null;
  const level =
    selection.group !== undefined
      ? snapshot.groups[selection.group]
      : snapshot.all;
  return level ? { level, sources } : null;
}

/**
 * Every text a progress display shows besides what its sources report. See
 * {@link PROGRESS_LABELS} for the defaults, and override any part of them with
 * {@link ProgressLabelOverrides}.
 *
 * @group Components
 */
export type ProgressLabels = {
  /** headline while building (a lone source shows its own title), and how the last run ended */
  title: { building: string; ready: string; failed: string };
  /** an item that is working but reports no step yet, or is done */
  states: {
    preparing: string;
    ready: string;
    empty: string;
    failed: string;
  };
  showDetails: string;
  hideDetails: string;
  /** the dismiss button's accessible name and tooltip */
  dismiss: string;
  /** the name of an item given none, from its 1-based position */
  item: (position: number) => string;
};

/** @group Components */
export type ProgressLabelOverrides = Partial<
  Omit<ProgressLabels, 'title' | 'states'>
> & {
  title?: Partial<ProgressLabels['title']>;
  states?: Partial<ProgressLabels['states']>;
};

/**
 * The default progress texts.
 *
 * @group Components
 */
export const PROGRESS_LABELS: ProgressLabels = {
  title: {
    building: 'Loading',
    ready: 'Done',
    failed: 'Finished with errors',
  },
  states: {
    preparing: 'Preparing',
    ready: 'Ready',
    empty: 'Nothing to show',
    failed: 'Failed',
  },
  showDetails: 'Show details',
  hideDetails: 'Hide details',
  dismiss: 'Hide',
  item: position => `Item ${position}`,
};

function resolveLabels(overrides?: ProgressLabelOverrides): ProgressLabels {
  if (!overrides) return PROGRESS_LABELS;
  const defaults = PROGRESS_LABELS;
  return {
    ...defaults,
    ...overrides,
    title: { ...defaults.title, ...overrides.title },
    states: { ...defaults.states, ...overrides.states },
  };
}

/**
 * The text for a step: its label, and its count when it has several units
 * (`Building mesh 3/16`).
 *
 * @group Components
 */
export function formatProgressStep(step: ProgressStep): string {
  return step.total > 1
    ? `${step.label} ${step.done}/${step.total}`
    : step.label;
}

/**
 * One row of a {@link ProgressView}: an item of the source shown, or a source when the
 * display shows several.
 *
 * @group Components
 */
export type ProgressRow = {
  key: string;
  name: string;
  state: ProgressState;
  /** the step it is on, or how it ended */
  stage: string;
  /** 0 to 100, whole numbers */
  percent: number;
  /** how long its latest run took, in ms; `null` while working */
  durationMs: number | null;
  /** its stats; a source's summed over its items */
  stats: Record<string, number>;
};

/**
 * A selection of a {@link ProgressSnapshot} as text, ready to render.
 *
 * @group Components
 */
export type ProgressView = {
  building: boolean;
  outcome: ProgressOutcome | null;
  title: string;
  /** 0 to 100, whole numbers */
  percent: number;
  /** the latest step, named by its item and source where there are several; `null` once idle */
  stage: string | null;
  /** how long the last run took, in ms; `null` while building */
  durationMs: number | null;
  /** the rows' stats summed once the run is done; empty while building */
  stats: Record<string, number>;
  /** the items of the source shown, or one per source when there are several */
  rows: ProgressRow[];
};

/**
 * What {@link describeProgress} shows, and in which words.
 *
 * @group Components
 */
export type DescribeProgressOptions = ProgressSelection & {
  labels?: ProgressLabelOverrides;
};

/**
 * Turn a snapshot into the texts and numbers a progress display shows — the building
 * block for a fully custom one. `null` while none of the sources selected is there.
 *
 * @group Components
 */
export function describeProgress(
  snapshot: ProgressSnapshot,
  options: DescribeProgressOptions = {},
): ProgressView | null {
  const selected = selectProgress(snapshot, options);
  if (!selected) return null;
  const { level, sources } = selected;
  const labels = resolveLabels(options.labels);
  const single = sources.length === 1 ? sources[0] : null;
  // Those that took part in the run; a lone one heads it with its own title.
  const taking = sources.filter(s => level.sources.includes(s.key));
  const lead = single ?? (taking.length === 1 ? taking[0] : null);

  const itemRows = (source: ProgressSourceSnapshot) =>
    source.report.items.map(
      (item, index): ProgressRow => ({
        key: item.key,
        name: item.name ?? labels.item(index + 1),
        state: item.state,
        stage:
          item.state === 'working'
            ? item.step
              ? formatProgressStep(item.step)
              : labels.states.preparing
            : labels.states[item.state],
        percent:
          item.state === 'working'
            ? Math.min(99, Math.floor(item.estimate * 100))
            : 100,
        durationMs:
          item.state === 'working'
            ? null
            : elapsed(item.startedAt, item.finishedAt),
        stats: item.stats ?? {},
      }),
    );

  const rows: ProgressRow[] = single
    ? itemRows(single)
    : sources.map(source => ({
        key: source.key,
        name: source.name ?? source.key,
        state: source.building
          ? 'working'
          : source.outcome === 'failed'
            ? 'failed'
            : 'ready',
        stage: source.building
          ? (stepOf(source, false) ?? labels.states.preparing)
          : source.outcome === 'failed'
            ? labels.states.failed
            : labels.states.ready,
        percent: source.percent,
        durationMs: source.building
          ? null
          : elapsed(source.startedAt, source.finishedAt),
        stats: sumStats(itemRows(source)),
      }));

  let stage: string | null = null;
  if (level.building) {
    const current = sources.find(s => s.key === level.current);
    const text = current ? stepOf(current, true) : null;
    stage = !text
      ? labels.states.preparing
      : sources.length > 1 && current
        ? `${current.name ?? current.key}: ${text}`
        : text;
  }

  return {
    building: level.building,
    outcome: level.outcome,
    title: level.building
      ? (lead?.title ?? lead?.name ?? labels.title.building)
      : level.outcome === 'failed'
        ? labels.title.failed
        : labels.title.ready,
    percent: level.percent,
    stage,
    durationMs: level.building
      ? null
      : elapsed(level.startedAt, level.finishedAt),
    stats: level.building
      ? {}
      : sumStats(
          single ? rows : rows.filter(r => level.sources.includes(r.key)),
        ),
    rows,
  };
}

// The step a source's current item is on, named by the item when there are several.
function stepOf(source: ProgressSourceSnapshot, named: boolean): string | null {
  const { items, current } = source.report;
  const item =
    items.find(i => i.key === current && i.state === 'working' && i.step) ??
    items.find(i => i.state === 'working' && i.step);
  if (!item?.step) return null;
  const text = formatProgressStep(item.step);
  return named && items.length > 1 && item.name
    ? `${item.name}: ${text}`
    : text;
}

function elapsed(
  startedAt: number | null | undefined,
  finishedAt: number | null | undefined,
): number | null {
  return startedAt == null || finishedAt == null
    ? null
    : finishedAt - startedAt;
}

function sumStats(rows: { stats: Record<string, number> }[]) {
  const sum: Record<string, number> = {};
  for (const row of rows) {
    for (const [name, value] of Object.entries(row.stats))
      sum[name] = (sum[name] ?? 0) + value;
  }
  return sum;
}
