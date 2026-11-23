import { useCallback, useEffect, useRef } from 'react';
import { ZoneStackProgress } from '../../components/Zones/zone-defs';
import { useOutputPanelState } from '../../components/Html/OutputPanel/output-panel-state';

function formatDuration(ms: number) {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/**
 * Report a `ZoneStack`'s build status into the OutputPanel's global store: a
 * `Building zones` / `Zones built` / `Error` label, the rebuild count and the
 * last build's time. The step-by-step progress is the progress displays' job
 * (`Progress` / `ProgressPopup`, fed through `zoneProgressReport`).
 *
 * A zone story runs INSIDE the R3F canvas, so it cannot render DOM itself; the
 * panel is added as the outermost decorator and reads the store.
 *
 * ⭐ The REBUILD COUNT is the part worth having: a rebuild that finishes quickly
 * flashes past the 'building' state, so the counter is what answers "did changing
 * that control actually rebuild anything?".
 *
 * ⚠️ The TIME spans the stack's first progress report to its last, so it excludes
 * mounting and the story's own data hooks, but includes the column fetch and
 * resample that the first zone of a shared stack pays for. It updates on
 * completion only — there is no report to tick a running clock from.
 *
 * @returns a stable `onProgress` callback for {@link ZoneStack}
 */
export function useZoneProgressPanel() {
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

  return useCallback((p: ZoneStackProgress) => {
    // An empty report is the stack mounting or going away, not a build.
    if (p.total === 0 && !busy.current) return;
    const done = p.building === 0;
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
          label: !done
            ? 'Building zones'
            : p.failed > 0
              ? 'Error'
              : 'Zones built',
          color: !done ? '#f28e2c' : p.failed > 0 ? '#e15759' : '#59a14f',
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
