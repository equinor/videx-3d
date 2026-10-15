import { useCallback, useEffect, useRef } from 'react';
import {
  ChunkBuildProgress,
  ChunkStackProgress,
} from '../../components/Chunks/chunk-defs';
import { useOutputPanelState } from '../../components/Html/OutputPanel/output-panel-state';

function formatDuration(ms: number) {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

const STEP_LABELS: Record<ChunkBuildProgress['phase'], string> = {
  fetch: 'loading',
  resolve: 'resolving',
  refine: 'refining',
  terminations: 'pinch-outs',
  plan: 'planning',
  tessellate: 'tessellating',
  assemble: 'assembling',
  caps: 'caps',
};

function formatStep({ phase, done, total }: ChunkBuildProgress) {
  if (phase === 'tessellate') {
    return total > 1
      ? `${STEP_LABELS[phase]} tile ${done}/${total}`
      : STEP_LABELS[phase];
  }
  const counted = !(done === 0 && total === 1);
  return `${STEP_LABELS[phase]}${counted ? ` ${done}/${total}` : ''}`;
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

  // Remove ONLY our own groups when the story unmounts, so the next one does not
  // inherit a stale count. Deliberately NOT a `loaders` clear: that runs on every
  // args change and would wipe a live panel when a control rebuilds nothing (e.g.
  // a surface count already at the dataset's max, which resolves to the same
  // column and emits no new progress to repopulate it).
  useEffect(
    () => () =>
      useOutputPanelState.getState().set(state => {
        const groups = { ...state.groups };
        delete groups.build;
        delete groups.rebuilds;
        delete groups.time;
        return { groups };
      }),
    [],
  );

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
          label: done
            ? 'Chunks built'
            : `Building chunks ${Math.round(100 * p.estimate)}%`,
          value: done
            ? `${p.total}`
            : p.current
              ? `${p.completed}/${p.total}  ${formatStep(p.current)}`
              : `${p.completed}/${p.total}`,
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
