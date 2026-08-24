import { useStore, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import { generatorStatsKey } from '../../components/Chunks/chunk-defs';
import { chunkResourceStats } from '../../components/Chunks/chunk-resources';
import { useOutputPanelState } from '../../components/Html/OutputPanel/output-panel-state';
import type { GeneratorStats } from '../../generators/generator-stats';
import { useGenerator } from '../../hooks/useGenerator';

type ChromeMemory = {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
};

const mb = (bytes: number) => `${Math.round(bytes / 1e5) / 10} MB`;

const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);

/**
 * {@link ResourceMonitor} props.
 * @expand
 */
export type ResourceMonitorProps = {
  /** sampling period in milliseconds (default 1000) */
  interval?: number;
};

/**
 * Report memory and GPU resource usage into the OutputPanel, so a leak is visible
 * without a task manager or a heap snapshot.
 *
 * ⭐ The numbers worth watching are the DELTAS. `geometries` and the main heap
 * should return to roughly the same level after each rebuild; a staircase across
 * builds is a retained chunk. `column` is what the generator keeps between builds
 * and is the single largest allocation the library makes.
 *
 * ⚠️ Must be rendered INSIDE the canvas (it reads `renderer.info`) and inside the
 * generators provider. ⚠️ `performance.memory` is a non-standard Chrome API; the
 * heap rows read `-` where it is unavailable. ⚠️ The generator row is answered by
 * the worker, so it stops updating while the worker is inside a long synchronous
 * build phase — a frozen row means "busy", not "dead".
 *
 * Storybook-only: it writes to the panel's global store.
 */
export const ResourceMonitor = ({ interval = 1000 }: ResourceMonitorProps) => {
  const renderer = useThree(state => state.gl);
  const store = useStore();
  const stats = useGenerator<GeneratorStats>(generatorStatsKey);

  const baseline = useRef<{ heap: number; geometries: number } | null>(null);
  const peakHeap = useRef(0);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const sample = async () => {
      const memory = (performance as Performance & { memory?: ChromeMemory })
        .memory;
      const info = renderer.info;
      const heap = memory?.usedJSHeapSize ?? 0;
      const geometries = info.memory.geometries;
      if (!baseline.current) baseline.current = { heap, geometries };
      const start = baseline.current;
      peakHeap.current = Math.max(peakHeap.current, heap);

      // The worker answers when it next yields, so this deliberately awaits
      // rather than sampling on a frame.
      const worker = await stats().catch(() => null);
      if (stopped) return;
      const held = chunkResourceStats();
      // ⭐ A `useFrame` subscription that outlives its component pins the callback,
      // its fiber and everything that fiber's props reach — a whole chunk. A count
      // that climbs per rebuild is that leak; `frameSubscribers` names the worst
      // offender in the console.
      const subscribers = store.getState().internal.subscribers;

      useOutputPanelState.getState().set(state => ({
        groups: {
          ...state.groups,
          memory: {
            label: 'Memory',
            value: memory ? mb(heap) : '-',
            color: '#4e79a7',
            order: 10,
            details: {
              peak: {
                label: 'peak',
                value: memory ? mb(peakHeap.current) : '-',
              },
              limit: {
                label: 'limit',
                value: memory ? mb(memory.jsHeapSizeLimit) : '-',
              },
              growth: {
                label: 'Δ start',
                value: memory ? mb(heap - start.heap) : '-',
              },
            },
          },
          chunks: {
            label: 'Chunks',
            value: mb(held.bytes),
            color: '#af7aa1',
            order: 11,
            details: {
              live: { label: 'live', value: held.chunks },
              stranded: {
                label: 'stranded',
                value: `${held.stranded} / ${held.builds}`,
              },
              peak: { label: 'peak', value: mb(held.peakBytes) },
              vertices: { label: 'vertices', value: held.vertices },
              triangles: { label: 'triangles', value: held.triangles },
              section: { label: 'cut faces', value: mb(held.sectionBytes) },
            },
          },
          gpu: {
            label: 'GPU',
            value: `${geometries} geo`,
            color: '#59a14f',
            order: 12,
            details: {
              geoDelta: {
                label: 'Δ start',
                value: signed(geometries - start.geometries),
              },
              textures: { label: 'textures', value: info.memory.textures },
              programs: {
                label: 'programs',
                value: info.programs?.length ?? -1,
              },
              calls: { label: 'draw calls', value: info.render.calls },
              triangles: { label: 'triangles', value: info.render.triangles },
              subscribers: { label: 'useFrame', value: subscribers.length },
            },
          },
          generator: {
            label: 'Generator',
            value: worker ? mb(worker.columnBytes) : '-',
            color: '#f28e2c',
            order: 13,
            details: {
              candidates: {
                label: 'candidates',
                value: worker ? mb(worker.candidateBytes) : '-',
              },
              heap: {
                label: 'worker heap',
                value:
                  worker?.heapUsed !== undefined ? mb(worker.heapUsed) : '-',
              },
              columns: {
                label: 'columns built',
                value: worker?.columnsBuilt ?? '-',
              },
              inFlight: {
                label: 'building',
                value: worker?.columnsInFlight ?? '-',
              },
              pool: { label: 'pool', value: worker?.poolSize ?? '-' },
              // A scope id that changes (or an uptime that resets) means the
              // worker was recreated, and the old one was orphaned.
              scope: {
                label: 'scope',
                value: worker
                  ? `${worker.scopeId} ${Math.round(worker.uptimeMs / 1000)}s`
                  : '-',
              },
            },
          },
        },
      }));

      timer = setTimeout(sample, interval);
    };

    sample();
    return () => {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
      useOutputPanelState.getState().set(state => {
        const groups = { ...state.groups };
        delete groups.memory;
        delete groups.chunks;
        delete groups.gpu;
        delete groups.generator;
        return { groups };
      });
    };
  }, [renderer, store, stats, interval]);

  return null;
};
