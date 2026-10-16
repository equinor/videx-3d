import { describe, expect, it } from 'vitest';
import { ChunkBuildProgress } from '../src/components/Chunks/chunk-defs';
import {
  aggregateChunkProgress,
  CHUNK_PROGRESS_LABELS,
  createChunkProgressStore,
  describeChunkProgress,
  formatChunkStep,
} from '../src/components/Chunks/chunk-progress';
import { SurfaceChunkMetrics } from '../src/sdk';

const metrics = (triangles: number) => ({ triangles }) as SurfaceChunkMetrics;

const step = (
  phase: ChunkBuildProgress['phase'],
  done: number,
  total: number,
  estimate: number,
): ChunkBuildProgress => ({ phase, done, total, estimate });

describe('aggregateChunkProgress', () => {
  it('counts states, failures and the mean estimate in mount order', () => {
    const p = aggregateChunkProgress([
      { key: 'a', name: 'Top', state: 'ready' },
      { key: 'b', state: 'building', step: step('fetch', 2, 4, 0.2) },
      { key: 'c' },
      { key: 'd', state: 'failed' },
    ]);
    expect(p.total).toBe(4);
    expect(p.completed).toBe(2);
    expect(p.building).toBe(2);
    expect(p.failed).toBe(1);
    expect(p.fraction).toBe(0.5);
    expect(p.estimate).toBeCloseTo((1 + 0.2 + 0 + 1) / 4);
    expect(p.chunks.map(c => [c.key, c.index, c.state, c.estimate])).toEqual([
      ['a', 0, 'ready', 1],
      ['b', 1, 'building', 0.2],
      ['c', 2, 'building', 0],
      ['d', 3, 'failed', 1],
    ]);
    expect(p.chunks[0].name).toBe('Top');
  });

  it('takes the latest reported step of a chunk still building as current', () => {
    const early = step('fetch', 1, 4, 0.1);
    const late = step('plan', 0, 1, 0.5);
    const p = aggregateChunkProgress([
      { key: 'a', state: 'building', step: late, reported: 1 },
      { key: 'b', state: 'building', step: early, reported: 0 },
      { key: 'c', state: 'ready', step: step('caps', 3, 3, 1), reported: 2 },
    ]);
    expect(p.current).toBe(late);
    expect(p.chunks[2].step).toBeUndefined();
  });

  it('reports an empty stack as idle', () => {
    const p = aggregateChunkProgress([]);
    expect(p).toMatchObject({ total: 0, building: 0, fraction: 1, chunks: [] });
    expect(p.current).toBeUndefined();
  });

  it('keeps counts and times, but a rebuild shows no stale metrics or finish', () => {
    const record = {
      counts: { tessellate: 16, caps: 12 },
      metrics: metrics(5000),
      startedAt: 100,
      finishedAt: 350,
    };
    const [ready, rebuilding, empty] = aggregateChunkProgress([
      { key: 'a', state: 'ready', ...record },
      { key: 'b', state: 'building', ...record },
      { key: 'c', state: 'empty', ...record },
    ]).chunks;
    expect(ready).toMatchObject(record);
    expect(rebuilding).toMatchObject({ counts: record.counts, startedAt: 100 });
    expect(rebuilding.metrics).toBeUndefined();
    expect(rebuilding.finishedAt).toBeUndefined();
    expect(empty.metrics).toBeUndefined();
    expect(empty.finishedAt).toBe(350);
  });
});

describe('createChunkProgressStore', () => {
  const building = (estimate: number) =>
    aggregateChunkProgress([
      { key: 'a', state: 'building', step: step('refine', 1, 2, estimate) },
    ]);
  const finished = (state: 'ready' | 'failed') =>
    aggregateChunkProgress([{ key: 'a', state }]);

  it('starts a session per build and never moves the percentage backwards', () => {
    const store = createChunkProgressStore();
    expect(store.getSnapshot()).toMatchObject({
      progress: null,
      building: false,
      session: 0,
    });

    store.report(building(0.4));
    expect(store.getSnapshot()).toMatchObject({
      building: true,
      session: 1,
      percent: 40,
      outcome: null,
    });
    store.report(building(0.2));
    expect(store.getSnapshot().percent).toBe(40);
    store.report(building(1));
    expect(store.getSnapshot().percent).toBe(99);

    store.report(finished('ready'));
    const done = store.getSnapshot();
    expect(done).toMatchObject({
      building: false,
      percent: 100,
      outcome: 'ready',
    });
    expect(done.finishedAt).not.toBeNull();

    store.report(building(0.1));
    expect(store.getSnapshot()).toMatchObject({
      session: 2,
      percent: 10,
      finishedAt: null,
    });
    store.report(finished('failed'));
    expect(store.getSnapshot().outcome).toBe('failed');
  });

  it('ends a build with no outcome when the stack goes away mid-build', () => {
    const store = createChunkProgressStore();
    store.report(building(0.3));
    store.report(aggregateChunkProgress([]));
    expect(store.getSnapshot()).toMatchObject({
      building: false,
      percent: 30,
      outcome: null,
    });
  });

  it('notifies subscribers until they unsubscribe', () => {
    const store = createChunkProgressStore();
    let heard = 0;
    const unsubscribe = store.subscribe(() => heard++);
    store.report(building(0.5));
    unsubscribe();
    store.report(finished('ready'));
    expect(heard).toBe(1);
  });

  it('remembers the expanded details across reports and builds', () => {
    const store = createChunkProgressStore();
    expect(store.getSnapshot().expanded).toBeNull();
    let heard = 0;
    store.subscribe(() => heard++);
    store.setExpanded(true);
    expect(heard).toBe(1);
    store.setExpanded(true);
    expect(heard).toBe(1);

    store.report(building(0.5));
    store.report(finished('ready'));
    store.report(building(0.1));
    expect(store.getSnapshot()).toMatchObject({ session: 2, expanded: true });
    store.setExpanded(false);
    expect(store.getSnapshot().expanded).toBe(false);
  });
});

describe('progress text', () => {
  it('counts a step only when it has several units', () => {
    expect(formatChunkStep(step('tessellate', 3, 16, 0))).toBe(
      'Building mesh 3/16',
    );
    expect(formatChunkStep(step('plan', 0, 1, 0))).toBe('Planning mesh');
    expect(
      formatChunkStep(step('fetch', 1, 2, 0), {
        phases: { fetch: 'Henter flater' },
      }),
    ).toBe('Henter flater 1/2');
  });

  it('names chunks, falls back to their position, and labels the stage by chunk', () => {
    const store = createChunkProgressStore();
    const current = step('caps', 2, 5, 0.9);
    store.report(
      aggregateChunkProgress([
        { key: 'a', name: 'Overburden', state: 'building', step: current },
        { key: 'b' },
        { key: 'c', state: 'empty' },
      ]),
    );
    const view = describeChunkProgress(store.getSnapshot());
    expect(view.title).toBe(CHUNK_PROGRESS_LABELS.title.building);
    expect(view.stage).toBe('Overburden: Adding layers 2/5');
    expect(view.chunks.map(c => [c.name, c.stage, c.percent])).toEqual([
      ['Overburden', 'Adding layers 2/5', 90],
      ['Chunk 2', 'Preparing', 0],
      ['Chunk 3', 'Nothing to show', 100],
    ]);

    const relabelled = describeChunkProgress(store.getSnapshot(), {
      chunk: n => `Del ${n}`,
      states: { preparing: 'Forbereder' },
    });
    expect(relabelled.chunks[1]).toMatchObject({
      name: 'Del 2',
      stage: 'Forbereder',
    });
    expect(relabelled.title).toBe(CHUNK_PROGRESS_LABELS.title.building);
  });

  it('leaves the stage unnamed for a single chunk, and empty once idle', () => {
    const store = createChunkProgressStore();
    store.report(
      aggregateChunkProgress([
        {
          key: 'a',
          name: 'All',
          state: 'building',
          step: step('plan', 0, 1, 0.3),
        },
      ]),
    );
    expect(describeChunkProgress(store.getSnapshot()).stage).toBe(
      'Planning mesh',
    );
    store.report(aggregateChunkProgress([{ key: 'a', state: 'failed' }]));
    const view = describeChunkProgress(store.getSnapshot());
    expect(view.stage).toBeNull();
    expect(view.title).toBe(CHUNK_PROGRESS_LABELS.title.failed);
  });

  it('sums time, tiles and triangles once the build is done, null where unknown', () => {
    const store = createChunkProgressStore();
    store.report(
      aggregateChunkProgress([
        {
          key: 'a',
          state: 'building',
          step: step('tessellate', 2, 9, 0.5),
          counts: { tessellate: 9 },
          startedAt: 10,
        },
        { key: 'b' },
      ]),
    );
    const building = describeChunkProgress(store.getSnapshot());
    expect(building).toMatchObject({
      durationMs: null,
      tiles: null,
      triangles: null,
    });
    expect(building.chunks[0]).toMatchObject({
      tiles: 9,
      triangles: null,
      durationMs: null,
    });

    store.report(
      aggregateChunkProgress([
        {
          key: 'a',
          state: 'ready',
          counts: { tessellate: 9 },
          metrics: metrics(1000),
          startedAt: 10,
          finishedAt: 60,
        },
        {
          key: 'b',
          state: 'ready',
          counts: { tessellate: 4 },
          metrics: metrics(500),
          startedAt: 20,
          finishedAt: 90,
        },
      ]),
    );
    const snapshot = store.getSnapshot();
    const done = describeChunkProgress(snapshot);
    expect(done.tiles).toBe(13);
    expect(done.triangles).toBe(1500);
    expect(done.durationMs).toBe(snapshot.finishedAt! - snapshot.startedAt!);
    expect(done.chunks.map(row => row.durationMs)).toEqual([50, 70]);

    store.report(aggregateChunkProgress([{ key: 'a', state: 'empty' }]));
    expect(describeChunkProgress(store.getSnapshot())).toMatchObject({
      tiles: null,
      triangles: null,
    });
  });
});
