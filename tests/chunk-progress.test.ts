import { describe, expect, it } from 'vitest';
import { ChunkBuildProgress } from '../src/components/Chunks/chunk-defs';
import {
  aggregateChunkProgress,
  chunkProgressReport,
  formatChunkStep,
} from '../src/components/Chunks/chunk-progress';
import {
  createProgressStore,
  describeProgress,
} from '../src/components/Progress/progress-store';
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

describe('chunkProgressReport', () => {
  // A stack's report through a store and back out as a display would show it.
  const show = (progress: ReturnType<typeof aggregateChunkProgress>) => {
    const store = createProgressStore();
    store.source('model', { title: 'Building model' })(
      chunkProgressReport(progress),
    );
    return { store, view: describeProgress(store.getSnapshot())! };
  };

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
    const current = step('caps', 2, 5, 0.9);
    const progress = aggregateChunkProgress([
      { key: 'a', name: 'Overburden', state: 'building', step: current },
      { key: 'b' },
      { key: 'c', state: 'empty' },
    ]);
    const { view } = show(progress);
    expect(view.title).toBe('Building model');
    expect(view.stage).toBe('Overburden: Adding layers 2/5');
    expect(view.rows.map(c => [c.name, c.stage, c.percent])).toEqual([
      ['Overburden', 'Adding layers 2/5', 90],
      ['Chunk 2', 'Preparing', 0],
      ['Chunk 3', 'Nothing to show', 100],
    ]);

    const relabelled = chunkProgressReport(progress, {
      chunk: n => `Del ${n}`,
      phases: { caps: 'Legger til lag' },
    });
    expect(relabelled.items.map(item => item.name)).toEqual([
      'Overburden',
      'Del 2',
      'Del 3',
    ]);
    expect(relabelled.items[0].step?.label).toBe('Legger til lag');
    expect(relabelled.current).toBe('a');
  });

  it('leaves the stage unnamed for a single chunk, and empty once idle', () => {
    const { store, view } = show(
      aggregateChunkProgress([
        {
          key: 'a',
          name: 'All',
          state: 'building',
          step: step('plan', 0, 1, 0.3),
        },
      ]),
    );
    expect(view.stage).toBe('Planning mesh');
    store.source('model')(
      chunkProgressReport(
        aggregateChunkProgress([{ key: 'a', state: 'failed' }]),
      ),
    );
    const done = describeProgress(store.getSnapshot())!;
    expect(done.stage).toBeNull();
    expect(done.title).toBe('Finished with errors');
  });

  it('sums time, tiles and triangles once the build is done, absent where unknown', () => {
    const store = createProgressStore();
    const model = store.source('model');
    model(
      chunkProgressReport(
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
      ),
    );
    const building = describeProgress(store.getSnapshot())!;
    expect(building).toMatchObject({ durationMs: null, stats: {} });
    expect(building.rows[0]).toMatchObject({
      stats: { tiles: 9 },
      durationMs: null,
    });

    model(
      chunkProgressReport(
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
      ),
    );
    const snapshot = store.getSnapshot();
    const done = describeProgress(snapshot)!;
    expect(done.stats).toEqual({ tiles: 13, triangles: 1500 });
    expect(done.durationMs).toBe(
      snapshot.all.finishedAt! - snapshot.all.startedAt!,
    );
    expect(done.rows.map(row => row.durationMs)).toEqual([50, 70]);

    model(
      chunkProgressReport(
        aggregateChunkProgress([{ key: 'a', state: 'empty' }]),
      ),
    );
    expect(describeProgress(store.getSnapshot())!.stats).toEqual({});
  });

  it('ends the run with no outcome when the stack goes away mid-build', () => {
    const store = createProgressStore();
    const model = store.source('model');
    model(
      chunkProgressReport(
        aggregateChunkProgress([
          { key: 'a', state: 'building', step: step('refine', 1, 2, 0.3) },
        ]),
      ),
    );
    model(chunkProgressReport(aggregateChunkProgress([])));
    const { all, sources } = store.getSnapshot();
    expect(sources).toEqual([]);
    expect(all).toMatchObject({ building: false, percent: 30, outcome: null });
  });
});
