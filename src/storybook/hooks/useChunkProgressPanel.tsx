import { useCallback, useRef } from 'react';
import { ChunkStackProgress } from '../../components/Chunks/chunk-defs';
import { useOutputPanelState } from '../../components/Html/OutputPanel/output-panel-state';

function formatDuration(ms: number) {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/**
 * Report a `ChunkStack`'s build progress into the OutputPanel's global store.
 *
 * A chunk story runs INSIDE the R3F canvas, so it cannot render DOM itself; the
 * panel is added as the outermost decorator and reads the store. Cold loads are
 * dominated by fetching one grid per surface, which reads as a hang without this.
 *
 * ⭐ The REBUILD COUNT is the part worth having: a rebuild that finishes quickly
 * flashes past the 'building' state, so the counter is what answers "did changing
 * that control actually rebuild anything?".
 *
 * ⚠️ The TIME spans the stack's first progress report to its last, so it excludes
 * mounting and the story's own data hooks, but includes the column fetch and
 * resample that the first chunk of a shared stack pays for. It updates on
 * completion only — there is no report to tick a running clock from.
 *
 * @returns a stable `onProgress` callback for {@link ChunkStack}
 */
export function useChunkProgressPanel() {
  const builds = useRef(0);
  const busy = useRef(false);
  const startedAt = useRef(0);
  const elapsed = useRef<number | null>(null);

  return useCallback((p: ChunkStackProgress) => {
    const done = p.building === 0 && p.total > 0;
    if (!done) {
      if (!busy.current) startedAt.current = performance.now();
      busy.current = true;
    } else if (busy.current) {
      busy.current = false;
      builds.current += 1;
      elapsed.current = performance.now() - startedAt.current;
    }
    useOutputPanelState.getState().set(state => ({
      groups: {
        ...state.groups,
        build: {
          label: done ? 'Chunks built' : 'Building chunks',
          value: done
            ? `${p.total}`
            : `${p.completed}/${p.total}  ${Math.round(100 * p.fraction)}%`,
          color: done ? '#59a14f' : '#f28e2c',
          order: 0,
        },
        rebuilds: {
          label: 'Rebuilds',
          value: `${builds.current}`,
          order: 1,
        },
        time: {
          label: 'Build time',
          value:
            elapsed.current === null ? '–' : formatDuration(elapsed.current),
          order: 2,
        },
      },
    }));
  }, []);
}
