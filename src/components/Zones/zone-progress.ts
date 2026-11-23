import { SurfaceZonePhase } from '../../sdk/geometries/surface-zone-streaming';
import {
  formatProgressStep,
  ProgressItem,
  ProgressReport,
  ProgressStep,
} from '../Progress/progress-store';
import {
  ZoneBuildProgress,
  ZoneBuildState,
  ZoneProgressEntry,
  ZoneStackProgress,
} from './zone-defs';

/**
 * What a {@link ZoneStack} holds for one zone when it aggregates progress.
 *
 * @group Components
 */
export type ZoneProgressInput = Pick<
  ZoneProgressEntry,
  'key' | 'name' | 'counts' | 'metrics' | 'startedAt' | 'finishedAt'
> & {
  /** absent until the zone reports: a registered zone that has not is building */
  state?: ZoneBuildState;
  step?: ZoneBuildProgress;
  /** when its step was reported, in any increasing unit; the latest is `current` */
  reported?: number;
};

/**
 * Aggregate the zones of a stack, given in mount order, into a
 * {@link ZoneStackProgress}. A zone's `metrics` pass only once it is `ready`,
 * and its `finishedAt` only once it is done, so a rebuild never shows the last
 * build's numbers.
 *
 * @group Components
 */
export function aggregateZoneProgress(
  zones: ZoneProgressInput[],
): ZoneStackProgress {
  let completed = 0;
  let failed = 0;
  let estimate = 0;
  let current: ZoneBuildProgress | undefined;
  let latest = -Infinity;
  const entries = zones.map((zone, index): ZoneProgressEntry => {
    const state = zone.state ?? 'building';
    const done = state !== 'building';
    if (done) completed++;
    if (state === 'failed') failed++;
    const step = done ? undefined : zone.step;
    const own = done ? 1 : (step?.estimate ?? 0);
    estimate += own;
    if (step && (zone.reported ?? 0) >= latest) {
      latest = zone.reported ?? 0;
      current = step;
    }
    return {
      key: zone.key,
      index,
      name: zone.name,
      state,
      step,
      estimate: own,
      counts: zone.counts,
      metrics: state === 'ready' ? zone.metrics : undefined,
      startedAt: zone.startedAt,
      finishedAt: done ? zone.finishedAt : undefined,
    };
  });
  const total = zones.length;
  return {
    total,
    building: total - completed,
    completed,
    failed,
    fraction: total === 0 ? 1 : completed / total,
    estimate: total === 0 ? 1 : estimate / total,
    current,
    zones: entries,
  };
}

/**
 * The texts a zone stack's progress is reported in (see {@link zoneProgressReport}).
 *
 * @group Components
 */
export type ZoneProgressLabels = {
  /** one per build step; a count (`3/16`) is shown when it has several units */
  phases: Record<SurfaceZonePhase, string>;
  /** the name of a zone given none, from its 1-based position */
  zone: (position: number) => string;
};

/** @group Components */
export type ZoneProgressLabelOverrides = {
  phases?: Partial<ZoneProgressLabels['phases']>;
  zone?: ZoneProgressLabels['zone'];
};

/**
 * The default zone progress texts.
 *
 * @group Components
 */
export const ZONE_PROGRESS_LABELS: ZoneProgressLabels = {
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
  zone: position => `Zone ${position}`,
};

function resolveLabels(
  overrides?: ZoneProgressLabelOverrides,
): ZoneProgressLabels {
  if (!overrides) return ZONE_PROGRESS_LABELS;
  return {
    phases: { ...ZONE_PROGRESS_LABELS.phases, ...overrides.phases },
    zone: overrides.zone ?? ZONE_PROGRESS_LABELS.zone,
  };
}

function stepOf(
  step: ZoneBuildProgress,
  labels: ZoneProgressLabels,
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
export function formatZoneStep(
  step: ZoneBuildProgress,
  labels?: ZoneProgressLabelOverrides,
): string {
  return formatProgressStep(stepOf(step, resolveLabels(labels)));
}

/**
 * A zone stack's progress as a {@link ProgressReport}, for a `ProgressStore` source:
 * one item per zone, its step in words, and `tiles` (once tessellated) and `triangles`
 * (once ready) as stats.
 *
 * @example
 * const model = progress.source('model', { name: 'Model', title: 'Building model' });
 * const onProgress = useCallback(
 *   (p: ZoneStackProgress) => model(zoneProgressReport(p)),
 *   [model],
 * );
 * <ZoneStack onProgress={onProgress}>…</ZoneStack>
 *
 * @group Components
 */
export function zoneProgressReport(
  progress: ZoneStackProgress,
  overrides?: ZoneProgressLabelOverrides,
): ProgressReport {
  const labels = resolveLabels(overrides);
  const owner = progress.current
    ? progress.zones.find(entry => entry.step === progress.current)
    : undefined;
  return {
    items: progress.zones.map((entry): ProgressItem => {
      const stats: Record<string, number> = {};
      if (entry.counts?.tessellate !== undefined)
        stats.tiles = entry.counts.tessellate;
      if (entry.metrics?.triangles !== undefined)
        stats.triangles = entry.metrics.triangles;
      return {
        key: entry.key,
        name: entry.name ?? labels.zone(entry.index + 1),
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
