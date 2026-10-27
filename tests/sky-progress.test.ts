import { describe, expect, it } from 'vitest';
import type { ProgressReport } from '../src/components/Progress/progress-store';
import {
  createSkyProgress,
  SKY_PROGRESS_LABELS,
} from '../src/components/Sky/sky-progress';

function listen() {
  const reports: ProgressReport[] = [];
  const progress = createSkyProgress(r => reports.push(r));
  const last = () => reports[reports.length - 1];
  const item = (key: string) => last()?.items.find(i => i.key === key);
  return { reports, progress, item };
}

describe('createSkyProgress', () => {
  it('counts the shaders over every compile it tracks, a new count once all are done', () => {
    const { progress, item } = listen();
    const a = progress.compiles.track();
    const b = progress.compiles.track();
    a(0, 3);
    b(1, 2);
    expect(item('shaders')).toMatchObject({
      name: SKY_PROGRESS_LABELS.shaders,
      state: 'working',
      step: { label: SKY_PROGRESS_LABELS.compiling, done: 1, total: 5 },
    });
    expect(item('shaders')?.estimate).toBeCloseTo(0.2);
    a(3, 3);
    b(2, 2);
    expect(item('shaders')).toMatchObject({ state: 'ready', estimate: 1 });

    const c = progress.compiles.track();
    c(0, 4);
    expect(item('shaders')?.step).toMatchObject({ done: 0, total: 4 });
  });

  it('reports the relief only once a stage has tiles, counting a run from when it waits', () => {
    const { progress, item } = listen();
    progress.compiles.track()(0, 0);
    expect(item('relief')).toBeUndefined();

    const stage = {};
    // Tiles in before the run do not count toward it.
    progress.relief(stage, { settled: 10, loading: 0, queued: 0 });
    expect(item('relief')).toMatchObject({ state: 'ready', estimate: 1 });
    progress.relief(stage, { settled: 10, loading: 4, queued: 6 });
    expect(item('relief')).toMatchObject({
      name: SKY_PROGRESS_LABELS.relief,
      state: 'working',
      step: { label: SKY_PROGRESS_LABELS.loading, done: 0, total: 10 },
    });
    progress.relief(stage, { settled: 15, loading: 4, queued: 1 });
    expect(item('relief')?.step).toMatchObject({ done: 5, total: 10 });
    progress.relief(stage, { settled: 20, loading: 0, queued: 0 });
    expect(item('relief')).toMatchObject({ state: 'ready', estimate: 1 });

    // The next run starts from what is in by then.
    progress.relief(stage, { settled: 20, loading: 2, queued: 0 });
    expect(item('relief')?.step).toMatchObject({ done: 0, total: 2 });
  });

  it('counts a stage that comes along mid-run from its own start', () => {
    const { progress, item } = listen();
    const first = {};
    const second = {};
    progress.relief(first, { settled: 5, loading: 2, queued: 0 });
    progress.relief(second, { settled: 3, loading: 1, queued: 0 });
    expect(item('relief')?.step).toMatchObject({ done: 0, total: 3 });
    progress.relief(second, { settled: 4, loading: 0, queued: 0 });
    expect(item('relief')?.step).toMatchObject({ done: 1, total: 3 });
    progress.relief(first, null);
    expect(item('relief')).toMatchObject({ state: 'ready' });
    progress.relief(second, null);
    expect(item('relief')).toBeUndefined();
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
});
