import { describe, expect, it } from 'vitest';
import type { ProgressReport } from '../src/components/Progress/progress-store';
import {
  createReliefProgress,
  createSceneryProgress,
  RELIEF_PROGRESS_LABELS,
  SCENERY_PROGRESS_LABELS,
} from '../src/components/Scenery/scenery-progress';

function listen() {
  const reports: ProgressReport[] = [];
  const progress = createSceneryProgress(r => reports.push(r));
  const last = () => reports[reports.length - 1];
  const item = (key: string) => last()?.items.find(i => i.key === key);
  return { reports, progress, item };
}

function listenRelief() {
  const reports: ProgressReport[] = [];
  const progress = createReliefProgress(r => reports.push(r));
  const last = () => reports[reports.length - 1];
  const item = () => last()?.items.find(i => i.key === 'relief');
  return { reports, progress, item };
}

describe('createSceneryProgress', () => {
  it('counts the shaders over every compile it tracks, a new count once all are done', () => {
    const { progress, item } = listen();
    const a = progress.compiles.track();
    const b = progress.compiles.track();
    a(0, 3);
    b(1, 2);
    expect(item('shaders')).toMatchObject({
      name: SCENERY_PROGRESS_LABELS.shaders,
      state: 'working',
      step: { label: SCENERY_PROGRESS_LABELS.compiling, done: 1, total: 5 },
    });
    expect(item('shaders')?.estimate).toBeCloseTo(0.2);
    a(3, 3);
    b(2, 2);
    expect(item('shaders')).toMatchObject({ state: 'ready', estimate: 1 });

    const c = progress.compiles.track();
    c(0, 4);
    expect(item('shaders')?.step).toMatchObject({ done: 0, total: 4 });
  });

  it('reports only what changed, and no items once closed', () => {
    const { reports, progress } = listen();
    const a = progress.compiles.track();
    a(0, 2);
    a(0, 2);
    expect(reports).toHaveLength(1);
    progress.close();
    expect(reports[reports.length - 1]).toEqual({ items: [] });
  });

  it('reports no relief: a GeoRelief reports its own', () => {
    const { progress, item } = listen();
    progress.compiles.track()(0, 0);
    expect(item('relief')).toBeUndefined();
  });
});

describe('createReliefProgress', () => {
  it('reports the relief only once it has tiles, counting a run from when it waits', () => {
    const { reports, progress, item } = listenRelief();
    progress.emit();
    expect(reports[reports.length - 1]).toEqual({ items: [] });

    // Tiles in before the run do not count toward it.
    progress.loading({ settled: 10, loading: 0, queued: 0 });
    expect(item()).toMatchObject({ state: 'ready', estimate: 1 });
    progress.loading({ settled: 10, loading: 4, queued: 6 });
    expect(item()).toMatchObject({
      name: RELIEF_PROGRESS_LABELS.relief,
      state: 'working',
      step: { label: RELIEF_PROGRESS_LABELS.loading, done: 0, total: 10 },
    });
    progress.loading({ settled: 15, loading: 4, queued: 1 });
    expect(item()?.step).toMatchObject({ done: 5, total: 10 });
    progress.loading({ settled: 20, loading: 0, queued: 0 });
    expect(item()).toMatchObject({ state: 'ready', estimate: 1 });

    // The next run starts from what is in by then.
    progress.loading({ settled: 20, loading: 2, queued: 0 });
    expect(item()?.step).toMatchObject({ done: 0, total: 2 });
  });

  it('counts its first report, mid-run, from its own start', () => {
    const { progress, item } = listenRelief();
    progress.loading({ settled: 5, loading: 2, queued: 0 });
    expect(item()?.step).toMatchObject({ done: 0, total: 2 });
    progress.loading({ settled: 6, loading: 1, queued: 0 });
    expect(item()?.step).toMatchObject({ done: 1, total: 2 });
  });

  it('reports no items once gone, or closed', () => {
    const { reports, progress } = listenRelief();
    progress.loading({ settled: 1, loading: 1, queued: 0 });
    progress.loading(null);
    expect(reports[reports.length - 1]).toEqual({ items: [] });
    progress.loading({ settled: 1, loading: 1, queued: 0 });
    progress.close();
    expect(reports[reports.length - 1]).toEqual({ items: [] });
  });
});
