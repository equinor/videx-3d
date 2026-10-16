import { SurfaceChunkPhase } from '../../sdk';
import {
  ChunkBuildProgress,
  ChunkBuildState,
  ChunkProgressEntry,
  ChunkStackProgress,
} from './chunk-defs';

/**
 * What a {@link ChunkStack} holds for one chunk when it aggregates progress.
 *
 * @group Components
 */
export type ChunkProgressInput = Pick<
  ChunkProgressEntry,
  'key' | 'name' | 'counts' | 'metrics' | 'startedAt' | 'finishedAt'
> & {
  /** absent until the chunk reports: a registered chunk that has not is building */
  state?: ChunkBuildState;
  step?: ChunkBuildProgress;
  /** when its step was reported, in any increasing unit; the latest is `current` */
  reported?: number;
};

/**
 * Aggregate the chunks of a stack, given in mount order, into a
 * {@link ChunkStackProgress}. A chunk's `metrics` pass only once it is `ready`,
 * and its `finishedAt` only once it is done, so a rebuild never shows the last
 * build's numbers.
 *
 * @group Components
 */
export function aggregateChunkProgress(
  chunks: ChunkProgressInput[],
): ChunkStackProgress {
  let completed = 0;
  let failed = 0;
  let estimate = 0;
  let current: ChunkBuildProgress | undefined;
  let latest = -Infinity;
  const entries = chunks.map((chunk, index): ChunkProgressEntry => {
    const state = chunk.state ?? 'building';
    const done = state !== 'building';
    if (done) completed++;
    if (state === 'failed') failed++;
    const step = done ? undefined : chunk.step;
    const own = done ? 1 : (step?.estimate ?? 0);
    estimate += own;
    if (step && (chunk.reported ?? 0) >= latest) {
      latest = chunk.reported ?? 0;
      current = step;
    }
    return {
      key: chunk.key,
      index,
      name: chunk.name,
      state,
      step,
      estimate: own,
      counts: chunk.counts,
      metrics: state === 'ready' ? chunk.metrics : undefined,
      startedAt: chunk.startedAt,
      finishedAt: done ? chunk.finishedAt : undefined,
    };
  });
  const total = chunks.length;
  return {
    total,
    building: total - completed,
    completed,
    failed,
    fraction: total === 0 ? 1 : completed / total,
    estimate: total === 0 ? 1 : estimate / total,
    current,
    chunks: entries,
  };
}

/** @group Components */
export type ChunkProgressOutcome = 'ready' | 'failed';

/**
 * What a {@link ChunkProgressStore} holds: the latest report plus what it takes
 * to show it as one build at a time.
 *
 * @group Components
 */
export type ChunkProgressSnapshot = {
  /** the latest report, or `null` before the first */
  progress: ChunkStackProgress | null;
  building: boolean;
  /**
   * 0 to 100, whole numbers. Never moves backwards within a build (the stack's
   * estimate drops whenever a chunk mounts), stays below 100 until it finishes.
   */
  percent: number;
  /** increments each time a build starts, 0 before the first */
  session: number;
  /** `performance.now()` when the current or last build started */
  startedAt: number | null;
  /** `performance.now()` when the last build finished, `null` while building */
  finishedAt: number | null;
  /**
   * How the last build ended: `null` while building, before the first, and when
   * the stack went away mid-build.
   */
  outcome: ChunkProgressOutcome | null;
  /**
   * Whether the details are expanded, as last toggled in any display reading this
   * store; `null` until then. Survives builds, so a display that comes back opens
   * the way it was left.
   */
  expanded: boolean | null;
};

/**
 * Holds a stack's build progress outside the R3F canvas: pass `report` to
 * `ChunkStack.onProgress`, and read it with `useChunkProgress`, `ChunkProgress`
 * or `ChunkProgressPopup` anywhere in the host's own DOM.
 *
 * @group Components
 */
export type ChunkProgressStore = {
  report: (progress: ChunkStackProgress) => void;
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => ChunkProgressSnapshot;
  /** Expand or collapse the details of every display reading this store. */
  setExpanded: (expanded: boolean) => void;
};

const IDLE: ChunkProgressSnapshot = {
  progress: null,
  building: false,
  percent: 0,
  session: 0,
  startedAt: null,
  finishedAt: null,
  outcome: null,
  expanded: null,
};

function nextSnapshot(
  previous: ChunkProgressSnapshot,
  progress: ChunkStackProgress,
  now: number,
): ChunkProgressSnapshot {
  const raw = Math.max(0, Math.floor(progress.estimate * 100));
  if (progress.building > 0) {
    const starting = !previous.building;
    return {
      progress,
      building: true,
      percent: Math.min(99, starting ? raw : Math.max(previous.percent, raw)),
      session: starting ? previous.session + 1 : previous.session,
      startedAt: starting ? now : previous.startedAt,
      finishedAt: null,
      outcome: null,
      expanded: previous.expanded,
    };
  }
  const ended = previous.building;
  // An empty report is the stack going away, which finishes nothing.
  const gone = progress.total === 0;
  return {
    progress,
    building: false,
    percent: gone ? previous.percent : 100,
    session: previous.session,
    startedAt: previous.startedAt,
    finishedAt: ended ? now : previous.finishedAt,
    outcome: gone
      ? ended
        ? null
        : previous.outcome
      : progress.failed > 0
        ? 'failed'
        : 'ready',
    expanded: previous.expanded,
  };
}

/**
 * Create a {@link ChunkProgressStore}. Listeners hear at most one notification
 * per animation frame, however often the stack reports.
 *
 * @example
 * const progress = useMemo(createChunkProgressStore, []);
 * // inside the canvas
 * <ChunkStack onProgress={progress.report}>…</ChunkStack>
 * // anywhere in the host's DOM
 * <ChunkProgressPopup store={progress} position="center" />
 *
 * @group Components
 */
export function createChunkProgressStore(): ChunkProgressStore {
  let snapshot = IDLE;
  const listeners = new Set<() => void>();
  let scheduled = false;
  const notify = () => {
    scheduled = false;
    listeners.forEach(listener => listener());
  };
  return {
    report: progress => {
      snapshot = nextSnapshot(snapshot, progress, performance.now());
      if (typeof requestAnimationFrame !== 'function') return notify();
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(notify);
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
 * Every text a progress display shows. See {@link CHUNK_PROGRESS_LABELS} for the
 * defaults, and override any part of them with {@link ChunkProgressLabelOverrides}.
 *
 * @group Components
 */
export type ChunkProgressLabels = {
  /** headline while building, and how the last build ended */
  title: { building: string; ready: string; failed: string };
  /** a chunk that is building but has reported no step yet, or is done */
  states: {
    preparing: string;
    ready: string;
    empty: string;
    failed: string;
  };
  /** one per build step; a count (`3/16`) is appended when it has several units */
  phases: Record<SurfaceChunkPhase, string>;
  showDetails: string;
  hideDetails: string;
  /** the dismiss button's accessible name and tooltip */
  dismiss: string;
  /** the name of a chunk given none, from its 1-based position */
  chunk: (position: number) => string;
};

/** @group Components */
export type ChunkProgressLabelOverrides = Partial<
  Omit<ChunkProgressLabels, 'title' | 'states' | 'phases'>
> & {
  title?: Partial<ChunkProgressLabels['title']>;
  states?: Partial<ChunkProgressLabels['states']>;
  phases?: Partial<ChunkProgressLabels['phases']>;
};

/**
 * The default progress texts.
 *
 * @group Components
 */
export const CHUNK_PROGRESS_LABELS: ChunkProgressLabels = {
  title: {
    building: 'Building model',
    ready: 'Done',
    failed: 'Finished with errors',
  },
  states: {
    preparing: 'Preparing',
    ready: 'Ready',
    empty: 'Nothing to show',
    failed: 'Failed',
  },
  phases: {
    fetch: 'Loading surfaces',
    resolve: 'Resolving layer order',
    refine: 'Refining surfaces',
    terminations: 'Tracing pinch-outs',
    plan: 'Planning mesh',
    tessellate: 'Building mesh',
    assemble: 'Assembling geometry',
    caps: 'Adding layers',
  },
  showDetails: 'Show details',
  hideDetails: 'Hide details',
  dismiss: 'Hide',
  chunk: position => `Chunk ${position}`,
};

function resolveLabels(
  overrides?: ChunkProgressLabelOverrides,
): ChunkProgressLabels {
  if (!overrides) return CHUNK_PROGRESS_LABELS;
  const defaults = CHUNK_PROGRESS_LABELS;
  return {
    ...defaults,
    ...overrides,
    title: { ...defaults.title, ...overrides.title },
    states: { ...defaults.states, ...overrides.states },
    phases: { ...defaults.phases, ...overrides.phases },
  };
}

function formatStep(step: ChunkBuildProgress, labels: ChunkProgressLabels) {
  const label = labels.phases[step.phase];
  return step.total > 1 ? `${label} ${step.done}/${step.total}` : label;
}

/**
 * The text for a build step, e.g. `Building mesh 3/16`.
 *
 * @group Components
 */
export function formatChunkStep(
  step: ChunkBuildProgress,
  labels?: ChunkProgressLabelOverrides,
): string {
  return formatStep(step, resolveLabels(labels));
}

/**
 * One chunk of a {@link ChunkProgressView}.
 *
 * @group Components
 */
export type ChunkProgressRow = {
  key: string;
  name: string;
  state: ChunkBuildState;
  /** the step it is on, or how it ended */
  stage: string;
  /** 0 to 100, whole numbers */
  percent: number;
  /** how long its latest build took, in ms; `null` while building */
  durationMs: number | null;
  /** tiles its tessellation was split into, once it has reported them */
  tiles: number | null;
  /** triangles it draws, once it is `ready` */
  triangles: number | null;
};

/**
 * A {@link ChunkProgressSnapshot} as text, ready to render.
 *
 * @group Components
 */
export type ChunkProgressView = {
  building: boolean;
  outcome: ChunkProgressOutcome | null;
  title: string;
  /** 0 to 100, whole numbers */
  percent: number;
  /** the latest step, named by its chunk when there are several; `null` once idle */
  stage: string | null;
  /** how long the last build took, in ms; `null` while building */
  durationMs: number | null;
  /** the rows' `tiles` summed once the build is done; `null` if none reported */
  tiles: number | null;
  /** the rows' `triangles` summed once the build is done; `null` if none reported */
  triangles: number | null;
  /** every chunk, in mount order */
  chunks: ChunkProgressRow[];
};

/**
 * Turn a snapshot into the texts and numbers a progress display shows — the
 * building block for a fully custom one.
 *
 * @group Components
 */
export function describeChunkProgress(
  snapshot: ChunkProgressSnapshot,
  overrides?: ChunkProgressLabelOverrides,
): ChunkProgressView {
  const labels = resolveLabels(overrides);
  const entries = snapshot.progress?.chunks ?? [];
  const nameOf = (entry: ChunkProgressEntry) =>
    entry.name ?? labels.chunk(entry.index + 1);

  const chunks = entries.map(
    (entry): ChunkProgressRow => ({
      key: entry.key,
      name: nameOf(entry),
      state: entry.state,
      stage:
        entry.state === 'building'
          ? entry.step
            ? formatStep(entry.step, labels)
            : labels.states.preparing
          : labels.states[entry.state],
      percent:
        entry.state === 'building'
          ? Math.min(99, Math.floor(entry.estimate * 100))
          : 100,
      durationMs: elapsed(entry.startedAt, entry.finishedAt),
      tiles: entry.counts?.tessellate ?? null,
      triangles: entry.metrics?.triangles ?? null,
    }),
  );

  let stage: string | null = null;
  if (snapshot.building) {
    const current = snapshot.progress?.current;
    if (!current) {
      stage = labels.states.preparing;
    } else {
      const owner =
        entries.length > 1
          ? entries.find(entry => entry.step === current)
          : undefined;
      const text = formatStep(current, labels);
      stage = owner ? `${nameOf(owner)}: ${text}` : text;
    }
  }

  return {
    building: snapshot.building,
    outcome: snapshot.outcome,
    title: snapshot.building
      ? labels.title.building
      : snapshot.outcome === 'failed'
        ? labels.title.failed
        : labels.title.ready,
    percent: snapshot.percent,
    stage,
    durationMs: snapshot.building
      ? null
      : elapsed(snapshot.startedAt, snapshot.finishedAt),
    tiles: snapshot.building ? null : sumOf(chunks, row => row.tiles),
    triangles: snapshot.building ? null : sumOf(chunks, row => row.triangles),
    chunks,
  };
}

function elapsed(
  startedAt: number | null | undefined,
  finishedAt: number | null | undefined,
): number | null {
  return startedAt == null || finishedAt == null
    ? null
    : finishedAt - startedAt;
}

function sumOf(
  rows: ChunkProgressRow[],
  value: (row: ChunkProgressRow) => number | null,
): number | null {
  let sum: number | null = null;
  for (const row of rows) {
    const v = value(row);
    if (v !== null) sum = (sum ?? 0) + v;
  }
  return sum;
}
