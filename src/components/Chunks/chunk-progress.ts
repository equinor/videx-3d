import { SurfaceChunkPhase } from '../../sdk';
import {
  formatProgressStep,
  ProgressItem,
  ProgressReport,
  ProgressStep,
} from '../Progress/progress-store';
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

/**
 * The texts a chunk stack's progress is reported in (see {@link chunkProgressReport}).
 *
 * @group Components
 */
export type ChunkProgressLabels = {
  /** one per build step; a count (`3/16`) is shown when it has several units */
  phases: Record<SurfaceChunkPhase, string>;
  /** the name of a chunk given none, from its 1-based position */
  chunk: (position: number) => string;
};

/** @group Components */
export type ChunkProgressLabelOverrides = {
  phases?: Partial<ChunkProgressLabels['phases']>;
  chunk?: ChunkProgressLabels['chunk'];
};

/**
 * The default chunk progress texts.
 *
 * @group Components
 */
export const CHUNK_PROGRESS_LABELS: ChunkProgressLabels = {
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
  chunk: position => `Chunk ${position}`,
};

function resolveLabels(
  overrides?: ChunkProgressLabelOverrides,
): ChunkProgressLabels {
  if (!overrides) return CHUNK_PROGRESS_LABELS;
  return {
    phases: { ...CHUNK_PROGRESS_LABELS.phases, ...overrides.phases },
    chunk: overrides.chunk ?? CHUNK_PROGRESS_LABELS.chunk,
  };
}

function stepOf(
  step: ChunkBuildProgress,
  labels: ChunkProgressLabels,
): ProgressStep {
  return {
    label: labels.phases[step.phase],
    done: step.done,
    total: step.total,
  };
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
  return formatProgressStep(stepOf(step, resolveLabels(labels)));
}

/**
 * A chunk stack's progress as a {@link ProgressReport}, for a `ProgressStore` source:
 * one item per chunk, its step in words, and `tiles` (once tessellated) and `triangles`
 * (once ready) as stats.
 *
 * @example
 * const model = progress.source('model', { name: 'Model', title: 'Building model' });
 * const onProgress = useCallback(
 *   (p: ChunkStackProgress) => model(chunkProgressReport(p)),
 *   [model],
 * );
 * <ChunkStack onProgress={onProgress}>…</ChunkStack>
 *
 * @group Components
 */
export function chunkProgressReport(
  progress: ChunkStackProgress,
  overrides?: ChunkProgressLabelOverrides,
): ProgressReport {
  const labels = resolveLabels(overrides);
  const owner = progress.current
    ? progress.chunks.find(entry => entry.step === progress.current)
    : undefined;
  return {
    items: progress.chunks.map((entry): ProgressItem => {
      const stats: Record<string, number> = {};
      if (entry.counts?.tessellate !== undefined)
        stats.tiles = entry.counts.tessellate;
      if (entry.metrics?.triangles !== undefined)
        stats.triangles = entry.metrics.triangles;
      return {
        key: entry.key,
        name: entry.name ?? labels.chunk(entry.index + 1),
        state: entry.state === 'building' ? 'working' : entry.state,
        estimate: entry.estimate,
        step: entry.step ? stepOf(entry.step, labels) : undefined,
        startedAt: entry.startedAt,
        finishedAt: entry.finishedAt,
        stats,
      };
    }),
    current: owner?.key,
  };
}
