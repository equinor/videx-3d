import { describe, expect, it } from 'vitest';
import {
  createProgressStore,
  describeProgress,
  ProgressItem,
  ProgressReport,
  selectProgress,
} from '../src/components/Progress/progress-store';

const working = (
  key: string,
  estimate: number,
  label?: string,
  extra: Partial<ProgressItem> = {},
): ProgressItem => ({
  key,
  state: 'working',
  estimate,
  step: label ? { label, done: 1, total: 4 } : undefined,
  ...extra,
});

const done = (
  key: string,
  state: ProgressItem['state'] = 'ready',
): ProgressItem => ({ key, state, estimate: 1 });

const report = (...items: ProgressItem[]): ProgressReport => ({ items });

describe('createProgressStore', () => {
  it('starts a run per source, never moves its percentage backwards, and ends it', () => {
    const store = createProgressStore();
    const sky = store.source('sky');
    expect(store.getSnapshot()).toMatchObject({ sources: [], expanded: null });

    sky(report(working('shaders', 0.4)));
    expect(store.getSnapshot().sources[0]).toMatchObject({
      key: 'sky',
      building: true,
      session: 1,
      percent: 40,
      outcome: null,
    });
    sky(report(working('shaders', 0.2)));
    expect(store.getSnapshot().sources[0].percent).toBe(40);
    sky(report(working('shaders', 1)));
    expect(store.getSnapshot().sources[0].percent).toBe(99);

    sky(report(done('shaders')));
    const ended = store.getSnapshot().sources[0];
    expect(ended).toMatchObject({
      building: false,
      percent: 100,
      outcome: 'ready',
    });
    expect(ended.finishedAt).not.toBeNull();

    sky(report(working('shaders', 0.1)));
    expect(store.getSnapshot().sources[0]).toMatchObject({
      session: 2,
      percent: 10,
      finishedAt: null,
    });
    sky(report(done('shaders', 'failed')));
    expect(store.getSnapshot().sources[0].outcome).toBe('failed');
  });

  it('weighs items by their weight, and counts one not working as done', () => {
    const store = createProgressStore();
    store.source('a')(
      report(
        working('big', 0.5, undefined, { weight: 3 }),
        done('small', 'empty'),
      ),
    );
    expect(store.getSnapshot().sources[0].percent).toBe(62);
  });

  it('hands out the same report function for a key, with the latest options', () => {
    const store = createProgressStore();
    const first = store.source('sky', { name: 'Scenery' });
    const again = store.source('sky', { name: 'Himmel', group: 'scene' });
    expect(again).toBe(first);
    first(report(working('x', 0)));
    expect(store.getSnapshot().sources[0]).toMatchObject({
      name: 'Himmel',
      group: 'scene',
    });
  });

  it('drops a source that reports nothing, ending its run without an outcome', () => {
    const store = createProgressStore();
    const sky = store.source('sky');
    sky(report(working('shaders', 0.3)));
    sky(report());
    const snapshot = store.getSnapshot();
    expect(snapshot.sources).toEqual([]);
    expect(snapshot.all).toMatchObject({
      building: false,
      percent: 30,
      outcome: null,
    });
  });

  it('notifies subscribers until they unsubscribe, and expands every display at once', () => {
    const store = createProgressStore();
    let heard = 0;
    const unsubscribe = store.subscribe(() => heard++);
    store.source('a')(report(working('x', 0.5)));
    expect(heard).toBe(1);
    store.setExpanded(true);
    store.setExpanded(true);
    expect(heard).toBe(2);
    unsubscribe();
    store.source('a')(report(done('x')));
    expect(heard).toBe(2);
    expect(store.getSnapshot().expanded).toBe(true);
  });
});

describe('several sources', () => {
  it('runs as one from the first start to the last end, over those that took part', () => {
    const store = createProgressStore();
    const sky = store.source('sky');
    const model = store.source('model');
    // Ready before the run: not part of it.
    model(report(done('chunk')));
    sky(report(working('shaders', 0.5)));
    expect(store.getSnapshot().all).toMatchObject({
      building: true,
      session: 1,
      percent: 50,
      sources: ['sky'],
      current: 'sky',
    });

    model(report(working('chunk', 0)));
    const both = store.getSnapshot().all;
    // Never backwards: the model joining at 0 does not pull it down.
    expect(both).toMatchObject({ session: 1, percent: 50, current: 'model' });
    // In the order the sources first reported.
    expect(both.sources).toEqual(['model', 'sky']);

    sky(report(done('shaders')));
    expect(store.getSnapshot().all).toMatchObject({
      building: true,
      percent: 50,
    });
    model(report(done('chunk', 'failed')));
    expect(store.getSnapshot().all).toMatchObject({
      building: false,
      percent: 100,
      outcome: 'failed',
      session: 1,
    });
  });

  it('keeps a run per group, of its own sources', () => {
    const store = createProgressStore();
    store.source('sky', { group: 'scene' })(report(working('shaders', 0.2)));
    store.source('relief', { group: 'scene' })(report(done('tiles')));
    store.source('model', { group: 'data' })(report(working('chunk', 0.6)));
    const { groups, all } = store.getSnapshot();
    expect(Object.keys(groups)).toEqual(['scene', 'data']);
    expect(groups.scene).toMatchObject({ percent: 20, sources: ['sky'] });
    expect(groups.data).toMatchObject({ percent: 60, sources: ['model'] });
    expect(all).toMatchObject({ percent: 40, sources: ['sky', 'model'] });
  });

  it('selects one source, one group, or every source', () => {
    const store = createProgressStore();
    store.source('sky', { group: 'scene' })(report(working('shaders', 0.2)));
    store.source('model')(report(working('chunk', 0.6)));
    const snapshot = store.getSnapshot();
    expect(selectProgress(snapshot)?.sources.map(s => s.key)).toEqual([
      'sky',
      'model',
    ]);
    expect(
      selectProgress(snapshot, { group: 'scene' })?.sources.map(s => s.key),
    ).toEqual(['sky']);
    expect(selectProgress(snapshot, { source: 'model' })?.level).toMatchObject({
      percent: 60,
      sources: ['model'],
      current: 'model',
    });
    expect(selectProgress(snapshot, { source: 'gone' })).toBeNull();
    expect(selectProgress(snapshot, { group: 'gone' })).toBeNull();
  });
});

describe('describeProgress', () => {
  it('shows a lone source by its title and items, and several by a row each', () => {
    const store = createProgressStore();
    store.source('sky', { name: 'Scenery', title: 'Preparing the sky' })(
      report(
        working('shaders', 0.5, 'Compiling shaders', { name: 'Shaders' }),
        working('relief', 0, undefined, { name: 'Relief' }),
      ),
    );
    const lone = describeProgress(store.getSnapshot())!;
    expect(lone.title).toBe('Preparing the sky');
    expect(lone.stage).toBe('Shaders: Compiling shaders 1/4');
    expect(lone.rows.map(r => [r.name, r.stage, r.percent])).toEqual([
      ['Shaders', 'Compiling shaders 1/4', 50],
      ['Relief', 'Preparing', 0],
    ]);

    store.source('model', { name: 'Model' })(
      report(working('a', 0.2, 'Building mesh')),
    );
    const both = describeProgress(store.getSnapshot())!;
    expect(both.title).toBe('Loading');
    expect(both.stage).toBe('Model: Building mesh 1/4');
    expect(both.rows.map(r => [r.key, r.name, r.stage, r.percent])).toEqual([
      ['sky', 'Scenery', 'Compiling shaders 1/4', 25],
      ['model', 'Model', 'Building mesh 1/4', 20],
    ]);

    const relabelled = describeProgress(store.getSnapshot(), {
      labels: { title: { building: 'Laster' } },
    })!;
    expect(relabelled.title).toBe('Laster');
    expect(
      describeProgress(store.getSnapshot(), { source: 'sky' })!.title,
    ).toBe('Preparing the sky');
  });

  it('heads a run with the one source that took part, and sums only its stats', () => {
    const store = createProgressStore();
    store.source('model', { name: 'Model' })(
      report({ ...done('chunk'), stats: { tiles: 4 } }),
    );
    const sky = store.source('sky', {
      name: 'Scenery',
      title: 'Preparing the sky',
    });
    sky(report(working('shaders', 0.5, 'Compiling shaders')));
    expect(describeProgress(store.getSnapshot())!).toMatchObject({
      title: 'Preparing the sky',
      stage: 'Scenery: Compiling shaders 1/4',
    });
    sky(report({ ...done('shaders'), stats: { programs: 9 } }));
    expect(describeProgress(store.getSnapshot())!.stats).toEqual({
      programs: 9,
    });
  });

  it('says how the run ended, with its stats summed and no stage', () => {
    const store = createProgressStore();
    const a = store.source('a', { name: 'A' });
    a(report(working('x', 0.5, 'Working')));
    a(
      report(
        { ...done('x'), stats: { tiles: 2 } },
        { ...done('y', 'failed'), stats: { tiles: 3, triangles: 10 } },
      ),
    );
    const view = describeProgress(store.getSnapshot())!;
    expect(view).toMatchObject({
      building: false,
      outcome: 'failed',
      title: 'Finished with errors',
      stage: null,
      percent: 100,
      stats: { tiles: 5, triangles: 10 },
    });
    expect(view.durationMs).not.toBeNull();
  });

  it('is null while none of the sources selected is there', () => {
    const store = createProgressStore();
    expect(describeProgress(store.getSnapshot())).toBeNull();
    store.source('a')(report(working('x', 0)));
    expect(describeProgress(store.getSnapshot(), { source: 'b' })).toBeNull();
  });
});
