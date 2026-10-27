import { CSSProperties, ReactNode, useCallback, useMemo } from 'react';
import {
  describeProgress,
  PROGRESS_LABELS,
  ProgressLabelOverrides,
  ProgressSnapshot,
  ProgressStore,
  ProgressView,
} from './progress-store';
import { useProgress } from './useProgress';

/**
 * What a {@link Progress} shows besides its title, percentage and bar.
 *
 * @group Components
 */
export type ProgressDetails = {
  /** the step being worked on */
  stage?: boolean;
  /** one row per item of the source shown, or per source when it shows several */
  rows?: boolean;
};

/**
 * {@link Progress} props.
 * @expand
 * @group Components
 */
export type ProgressProps = {
  store: ProgressStore;
  /** Show only this source. */
  source?: string;
  /** Show only the sources of this group (see `ProgressSourceOptions.group`). */
  group?: string;
  /** Default: none — the title, percentage and bar only. */
  details?: ProgressDetails;
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
   * Extra content rendered last, e.g. the time and size once a run is done
   * (`view.durationMs`, `view.stats`). Return nothing to leave it out.
   */
  footer?: (view: ProgressView, snapshot: ProgressSnapshot) => ReactNode;
  labels?: ProgressLabelOverrides;
  className?: string;
  style?: CSSProperties;
};

const CLASS = 'videx-progress';

/**
 * Progress from a {@link ProgressStore} as plain HTML, rendered where it is placed: all
 * its sources as one, or one `source` or `group` of them. Render it in the host's DOM,
 * OUTSIDE the R3F canvas.
 *
 * Unstyled: the only inline styles are the fill's width and a `--videx-progress` custom
 * property (0 to 1) on the root. Style it through the `videx-progress` classes
 * (`__header`, `__title`, `__percent`, `__dismiss`, `__bar`, `__fill`, `__toggle`,
 * `__details`, `__stage`, `__rows`, `__row`, `__row-name`, `__row-stage`,
 * `__row-percent`, `__footer`) and the root's `data-state` (`building` | `idle`),
 * `data-outcome` (`ready` | `failed`) and `data-expanded` attributes; a row carries its
 * own `data-state`.
 *
 * Renders nothing while none of its sources is there, and the finished state afterwards.
 * See {@link ProgressPopup} for one that shows only while building.
 *
 * @example
 * <Progress store={progress} details={{ stage: true, rows: true }} expandable />
 *
 * @group Components
 */
export const Progress = ({
  store,
  source,
  group,
  details,
  expandable = false,
  defaultExpanded = false,
  onDismiss,
  footer,
  labels,
  className,
  style,
}: ProgressProps) => {
  const snapshot = useProgress(store);
  const expanded = snapshot.expanded ?? defaultExpanded;
  const toggle = useCallback(
    () => store.setExpanded(!expanded),
    [store, expanded],
  );
  const view = useMemo(
    () => describeProgress(snapshot, { source, group, labels }),
    [snapshot, source, group, labels],
  );
  if (!view) return null;

  const stage = details?.stage ? view.stage : null;
  const rows = details?.rows && view.rows.length > 1 ? view.rows : null;
  const hasDetails = stage !== null || rows !== null;
  const open = !expandable || expanded;
  const dismissLabel = labels?.dismiss ?? PROGRESS_LABELS.dismiss;
  const extra = footer?.(view, snapshot);

  return (
    <div
      className={className ? `${CLASS} ${className}` : CLASS}
      style={
        {
          ...style,
          '--videx-progress': view.percent / 100,
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
            ? (labels?.hideDetails ?? PROGRESS_LABELS.hideDetails)
            : (labels?.showDetails ?? PROGRESS_LABELS.showDetails)}
        </button>
      )}
      {open && hasDetails && (
        <div className={`${CLASS}__details`}>
          {stage !== null && (
            <div className={`${CLASS}__stage`} title={stage}>
              {stage}
            </div>
          )}
          {rows && (
            <ul className={`${CLASS}__rows`}>
              {rows.map(row => (
                <li
                  key={row.key}
                  className={`${CLASS}__row`}
                  data-state={row.state}
                >
                  <span className={`${CLASS}__row-name`}>{row.name}</span>
                  <span className={`${CLASS}__row-stage`} title={row.stage}>
                    {row.stage}
                  </span>
                  <span className={`${CLASS}__row-percent`}>
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
