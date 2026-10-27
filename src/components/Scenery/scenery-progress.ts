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
  /** the relief's tiles, as an item */
  relief: string;
  /** what they are doing while they load */
  loading: string;
};

/**
 * The default {@link SceneryProgressLabels}.
 *
 * @group Components
 */
export const SCENERY_PROGRESS_LABELS: SceneryProgressLabels = {
  shaders: 'Shaders',
  compiling: 'Compiling shaders',
  relief: 'Relief',
  loading: 'Loading relief tiles',
};

/**
 * A stage's relief tiles as they load: those that came back since it began, with a
 * tile or none, and those loading and waiting.
 *
 * @group Components
 */
export type SceneryReliefLoading = {
  settled: number;
  loading: number;
  queued: number;
};

type Stage = SceneryReliefLoading & { base: number };

/**
 * @internal
 * What a sky reports: its shaders as its `precompile` calls go (`compiles.track()` for
 * each), and its stages' relief tiles as they load (`relief`), a run of loading from
 * when one is waited for to when none is. Reports only when something it shows changed.
 */
export function createSceneryProgress(
  report: (report: ProgressReport) => void,
  getLabels: () => SceneryProgressLabels = () => SCENERY_PROGRESS_LABELS,
) {
  const stages = new Map<object, Stage>();
  let loadingBefore = false;
  let last = '';

  const emit = () => {
    const labels = getLabels();
    const items: ProgressItem[] = [];
    const { done, total } = compiles.count();
    items.push({
      key: 'shaders',
      name: labels.shaders,
      state: done < total ? 'working' : 'ready',
      estimate: total > 0 ? done / total : 1,
      step: { label: labels.compiling, done, total },
    });
    if (stages.size > 0) {
      let settled = 0;
      let waiting = 0;
      for (const stage of stages.values()) {
        settled += Math.max(0, stage.settled - stage.base);
        waiting += stage.loading + stage.queued;
      }
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

  const compiles = createPrecompileCount(emit);

  return {
    compiles,
    /** a stage's tiles, keyed by anything it keeps; `null` once it is gone */
    relief: (key: object, loading: SceneryReliefLoading | null) => {
      if (loading === null) stages.delete(key);
      else
        stages.set(key, {
          ...loading,
          base: stages.get(key)?.base ?? loading.settled,
        });
      let waiting = false;
      for (const stage of stages.values())
        if (stage.loading + stage.queued > 0) waiting = true;
      // A new run: counted from what has come in so far.
      if (waiting && !loadingBefore)
        for (const stage of stages.values()) stage.base = stage.settled;
      loadingBefore = waiting;
      emit();
    },
    emit,
    /** the sky is gone */
    close: () => {
      last = '';
      report({ items: [] });
    },
  };
}
