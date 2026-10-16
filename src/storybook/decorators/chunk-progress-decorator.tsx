import { useEffect, useState } from 'react';
import { ChunkProgress } from '../../components/Chunks/ChunkProgress';
import {
  ChunkProgressPopup,
  ChunkProgressPosition,
} from '../../components/Chunks/ChunkProgressPopup';
import {
  ChunkProgressStore,
  ChunkProgressView,
  describeChunkProgress,
} from '../../components/Chunks/chunk-progress';
import { useChunkProgress } from '../../components/Chunks/useChunkProgress';
import '../styles/chunk-progress.css';

export type ChunkProgressDisplay = 'popup' | 'inline' | 'custom' | 'off';

/** The story args {@link createChunkProgressDecorator} reads. */
export type ChunkProgressArgs = {
  progressDisplay: ChunkProgressDisplay;
  progressPosition: ChunkProgressPosition;
  progressStage: boolean;
  progressChunks: boolean;
  progressExpandable: boolean;
  progressDismissible: boolean;
  progressStayOpen: boolean;
  progressSummary: boolean;
  progressInlineIdle: 'show' | 'hide';
};

const EXIT_MS = 400;
// How long the custom strip shows its summary once a build is done.
const STRIP_SUMMARY_MS = 3000;

function formatDuration(ms: number) {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

function formatCount(n: number) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} M`;
  if (n >= 1e4) return `${Math.round(n / 1e3)} k`;
  return `${n}`;
}

/** "12.3 s · 48 tiles · 1.2 M triangles", whichever parts are known once done. */
function summarize(view: ChunkProgressView): string | null {
  if (view.building) return null;
  const parts: string[] = [];
  if (view.durationMs !== null) parts.push(formatDuration(view.durationMs));
  if (view.tiles !== null) parts.push(`${view.tiles} tiles`);
  if (view.triangles !== null) {
    parts.push(`${formatCount(view.triangles)} triangles`);
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

/** Tier 1: built on the store, the hook and the view model alone. */
const ProgressStrip = ({
  store,
  summary,
}: {
  store: ChunkProgressStore;
  summary: boolean;
}) => {
  const snapshot = useChunkProgress(store);
  const { building, session } = snapshot;
  // The session whose summary has been shown long enough.
  const [expired, setExpired] = useState(-1);
  useEffect(() => {
    if (building || session === 0) return;
    const timer = setTimeout(() => setExpired(session), STRIP_SUMMARY_MS);
    return () => clearTimeout(timer);
  }, [building, session]);

  const view = describeChunkProgress(snapshot);
  const text = building
    ? `${view.stage} · ${view.percent}%`
    : summary && session > 0 && expired !== session
      ? [view.title, summarize(view)].filter(Boolean).join(' · ')
      : null;
  if (text === null) return null;
  return (
    <div
      className="field-column-progress-strip"
      data-state={view.building ? 'building' : 'idle'}
    >
      <div
        className="field-column-progress-strip__fill"
        style={{ width: `${view.percent}%` }}
      />
      <span className="field-column-progress-strip__text">{text}</span>
    </div>
  );
};

/**
 * Show a chunk stack's progress OUTSIDE the canvas, the way a host would: the
 * story passes `store.report` to `ChunkStack.onProgress`. Put it after
 * `Canvas3dDecorator` in the array, so it wraps the canvas.
 */
export const createChunkProgressDecorator =
  (store: ChunkProgressStore) =>
  (Story: any, { args }: { args: Partial<ChunkProgressArgs> }) => {
    const display = args.progressDisplay ?? 'popup';
    const details = { stage: args.progressStage, chunks: args.progressChunks };
    const footer = args.progressSummary ? summarize : undefined;
    return (
      <>
        <Story />
        {display === 'popup' && (
          <ChunkProgressPopup
            store={store}
            position={args.progressPosition}
            details={details}
            expandable={args.progressExpandable}
            dismissible={args.progressDismissible}
            stayOpen={args.progressStayOpen}
            footer={footer}
            exitDuration={EXIT_MS}
            className="field-column-progress"
            popupClassName="field-column-progress-popup"
          />
        )}
        {display === 'inline' && (
          <div className="field-column-progress-dock">
            <ChunkProgress
              store={store}
              details={details}
              expandable={args.progressExpandable}
              footer={footer}
              className={
                args.progressInlineIdle === 'hide'
                  ? 'field-column-progress field-column-progress--hide-idle'
                  : 'field-column-progress'
              }
            />
          </div>
        )}
        {display === 'custom' && (
          <ProgressStrip store={store} summary={!!args.progressSummary} />
        )}
      </>
    );
  };
