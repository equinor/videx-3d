import { createPrecompileCount } from '../../rendering/precompile';
import type { ProgressItem, ProgressReport } from '../Progress/progress-store';

/**
 * The texts a {@link Scenery} reports its progress in (`Scenery.progressLabels`).
 *
 * @group Components
 */
export type SceneryProgressLabels = {
  /** the shaders, as an item */
  shaders: string;
  /** what they are doing while they compile */
  compiling: string;
};

/**
 * The default {@link SceneryProgressLabels}.
 *
 * @group Components
 */
export const SCENERY_PROGRESS_LABELS: SceneryProgressLabels = {
  shaders: 'Shaders',
  compiling: 'Compiling shaders',
};

/**
 * The texts a `GeoRelief` reports its progress in (`GeoRelief.progressLabels`).
 *
 * @group Components
 */
export type ReliefProgressLabels = {
  /** the relief's tiles, as an item */
  relief: string;
  /** what they are doing while they load */
  loading: string;
};

/**
 * The default {@link ReliefProgressLabels}.
 *
 * @group Components
 */
export const RELIEF_PROGRESS_LABELS: ReliefProgressLabels = {
  relief: 'Relief',
  loading: 'Loading relief tiles',
};

/**
 * A relief's tiles as they load: those that came back since it began, with a tile or none,
 * and those loading and waiting.
 *
 * @group Components
 */
export type SceneryReliefLoading = {
  settled: number;
  loading: number;
  queued: number;
};

/**
 * @internal
 * What a sky reports: its shaders as its `precompile` calls go (`compiles.track()` for
 * each). Reports only when something it shows changed.
 */
export function createSceneryProgress(
  report: (report: ProgressReport) => void,
  getLabels: () => SceneryProgressLabels = () => SCENERY_PROGRESS_LABELS,
) {
  let last = '';

  const emit = () => {
    const labels = getLabels();
    const { done, total } = compiles.count();
    const items: ProgressItem[] = [
      {
        key: 'shaders',
        name: labels.shaders,
        state: done < total ? 'working' : 'ready',
        estimate: total > 0 ? done / total : 1,
        step: { label: labels.compiling, done, total },
      },
    ];
    const key = JSON.stringify(items);
    if (key === last) return;
    last = key;
    report({ items });
  };

  const compiles = createPrecompileCount(emit);

  return {
    compiles,
    emit,
    /** the sky is gone */
    close: () => {
      last = '';
      report({ items: [] });
    },
  };
}

/**
 * @internal
 * What a relief reports: its tiles as they load (`loading`), a run of loading from when one
 * is waited for to when none is, counted from what had come in when it began. Reports only
 * when something it shows changed; no items while nothing is known yet.
 */
export function createReliefProgress(
  report: (report: ProgressReport) => void,
  getLabels: () => ReliefProgressLabels = () => RELIEF_PROGRESS_LABELS,
) {
  let current: SceneryReliefLoading | null = null;
  let base = 0;
  let last = '';

  const emit = () => {
    const items: ProgressItem[] = [];
    if (current) {
      const labels = getLabels();
      const settled = Math.max(0, current.settled - base);
      const waiting = current.loading + current.queued;
      const all = settled + waiting;
      items.push({
        key: 'relief',
        name: labels.relief,
        state: waiting > 0 ? 'working' : 'ready',
        estimate: all > 0 ? settled / all : 1,
        step: { label: labels.loading, done: settled, total: all },
      });
    }
    const key = JSON.stringify(items);
    if (key === last) return;
    last = key;
    report({ items });
  };

  return {
    /** how the tiles load now; `null` once the relief is gone */
    loading: (loading: SceneryReliefLoading | null) => {
      const before = current;
      const wasWaiting = !!before && before.loading + before.queued > 0;
      const waiting = !!loading && loading.loading + loading.queued > 0;
      current = loading;
      // The first report, and a new run: counted from what has come in so far.
      if (loading && (!before || (waiting && !wasWaiting)))
        base = loading.settled;
      emit();
    },
    emit,
    /** the relief is gone */
    close: () => {
      current = null;
      last = '';
      report({ items: [] });
    },
  };
}
