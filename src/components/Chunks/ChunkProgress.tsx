import { CSSProperties, ReactNode, useCallback, useMemo } from 'react';
import {
  CHUNK_PROGRESS_LABELS,
  ChunkProgressLabelOverrides,
  ChunkProgressSnapshot,
  ChunkProgressStore,
  ChunkProgressView,
  describeChunkProgress,
} from './chunk-progress';
import { useChunkProgress } from './useChunkProgress';

/**
 * What a {@link ChunkProgress} shows besides its title, percentage and bar.
 *
 * @group Components
 */
export type ChunkProgressDetails = {
  /** the step being worked on */
  stage?: boolean;
  /** one row per chunk, when the stack has more than one */
  chunks?: boolean;
};

/**
 * {@link ChunkProgress} props.
 * @expand
 * @group Components
 */
export type ChunkProgressProps = {
  store: ChunkProgressStore;
  /** Default: none — the title, percentage and bar only. */
  details?: ChunkProgressDetails;
  /** Put the details behind a toggle button. Default false. */
  expandable?: boolean;
  /**
   * Whether an expandable display starts expanded, until the details are first
   * toggled: from then on the store remembers it. Default false.
   */
  defaultExpanded?: boolean;
  /** Shows a dismiss button (`×`) at the end of the header, which calls this. */
  onDismiss?: () => void;
  /**
   * Extra content rendered last, e.g. the build time and size once it is done
   * (`view.durationMs`, `view.tiles`, `view.triangles`). Return nothing to leave
   * it out.
   */
  footer?: (
    view: ChunkProgressView,
    snapshot: ChunkProgressSnapshot,
  ) => ReactNode;
  labels?: ChunkProgressLabelOverrides;
  className?: string;
  style?: CSSProperties;
};

const CLASS = 'videx-chunk-progress';

/**
 * A chunk stack's build progress as plain HTML, rendered where it is placed.
 * Render it in the host's DOM, OUTSIDE the R3F canvas, fed by a
 * {@link ChunkProgressStore}.
 *
 * Unstyled: the only inline styles are the fill's width and a
 * `--videx-chunk-progress` custom property (0 to 1) on the root. Style it through
 * the `videx-chunk-progress` classes (`__header`, `__title`, `__percent`,
 * `__dismiss`, `__bar`, `__fill`, `__toggle`, `__details`, `__stage`, `__chunks`,
 * `__chunk`, `__chunk-name`, `__chunk-stage`, `__chunk-percent`, `__footer`) and the root's
 * `data-state` (`building` | `idle`), `data-outcome` (`ready` | `failed`) and
 * `data-expanded` attributes; a chunk row carries its own `data-state`.
 *
 * Renders nothing before the stack's first report, and the finished state
 * afterwards. See {@link ChunkProgressPopup} for one that shows only while
 * building.
 *
 * @example
 * <ChunkProgress store={progress} details={{ stage: true, chunks: true }} expandable />
 *
 * @group Components
 */
export const ChunkProgress = ({
  store,
  details,
  expandable = false,
  defaultExpanded = false,
  onDismiss,
  footer,
  labels,
  className,
  style,
}: ChunkProgressProps) => {
  const snapshot = useChunkProgress(store);
  const expanded = snapshot.expanded ?? defaultExpanded;
  const toggle = useCallback(
    () => store.setExpanded(!expanded),
    [store, expanded],
  );
  const view = useMemo(
    () => describeChunkProgress(snapshot, labels),
    [snapshot, labels],
  );
  if (!snapshot.progress) return null;

  const stage = details?.stage ? view.stage : null;
  const chunks = details?.chunks && view.chunks.length > 1 ? view.chunks : null;
  const hasDetails = stage !== null || chunks !== null;
  const open = !expandable || expanded;
  const dismissLabel = labels?.dismiss ?? CHUNK_PROGRESS_LABELS.dismiss;
  const extra = footer?.(view, snapshot);

  return (
    <div
      className={className ? `${CLASS} ${className}` : CLASS}
      style={
        {
          ...style,
          '--videx-chunk-progress': view.percent / 100,
        } as CSSProperties
      }
      data-state={view.building ? 'building' : 'idle'}
      data-outcome={view.outcome ?? undefined}
      data-expanded={expandable ? String(expanded) : undefined}
    >
      <div className={`${CLASS}__header`}>
        <span className={`${CLASS}__title`}>{view.title}</span>
        <span className={`${CLASS}__percent`}>{view.percent}%</span>
        {onDismiss && (
          <button
            type="button"
            className={`${CLASS}__dismiss`}
            aria-label={dismissLabel}
            title={dismissLabel}
            onClick={onDismiss}
          >
            <span aria-hidden="true">×</span>
          </button>
        )}
      </div>
      <div className={`${CLASS}__bar`} aria-hidden="true">
        <div
          className={`${CLASS}__fill`}
          style={{ width: `${view.percent}%` }}
        />
      </div>
      {expandable && hasDetails && (
        <button
          type="button"
          className={`${CLASS}__toggle`}
          aria-expanded={expanded}
          onClick={toggle}
        >
          {expanded
            ? (labels?.hideDetails ?? CHUNK_PROGRESS_LABELS.hideDetails)
            : (labels?.showDetails ?? CHUNK_PROGRESS_LABELS.showDetails)}
        </button>
      )}
      {open && hasDetails && (
        <div className={`${CLASS}__details`}>
          {stage !== null && (
            <div className={`${CLASS}__stage`} title={stage}>
              {stage}
            </div>
          )}
          {chunks && (
            <ul className={`${CLASS}__chunks`}>
              {chunks.map(row => (
                <li
                  key={row.key}
                  className={`${CLASS}__chunk`}
                  data-state={row.state}
                >
                  <span className={`${CLASS}__chunk-name`}>{row.name}</span>
                  <span className={`${CLASS}__chunk-stage`} title={row.stage}>
                    {row.stage}
                  </span>
                  <span className={`${CLASS}__chunk-percent`}>
                    {row.percent}%
                  </span>
                  <div className={`${CLASS}__bar`} aria-hidden="true">
                    <div
                      className={`${CLASS}__fill`}
                      style={{ width: `${row.percent}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {extra != null && extra !== false && (
        <div className={`${CLASS}__footer`}>{extra}</div>
      )}
    </div>
  );
};
