import { Fragment, useMemo } from 'react';
import { useOutputPanelState } from './output-panel-state';
import { Panel, PanelProps } from '../Panel/Panel';

/**
 * The `OutputPanel` is mainly intended as an example of the `Panel` component.
 * It is used in storybooks as a debug/info panel. Not recommended to use for production.
 * @see {@link useOutputPanel}
 * @see {@link Panel}
 * @internal
 * @group Components
 */
export const OutputPanel = (panelProps: PanelProps) => {
  const groups = useOutputPanelState(state => state.groups);

  const sortedGroups = useMemo(() => {
    return Object.values(groups).sort(
      (a, b) => (a.order || 0) - (b.order || 0),
    );
  }, [groups]);

  return (
    <Panel {...panelProps}>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          padding: '0.5em 1em',
          overflow: 'auto',
        }}
      >
        {sortedGroups.map(group => (
          <div
            key={group.label}
            style={{
              display: 'flex',
              flexDirection: 'column',
              marginTop: '0.5em',
              marginBottom: '0.5em',
            }}
          >
            <div
              style={{
                fontSize: '16px',
                fontWeight: 'bold',
                paddingBottom: '0.2em',
                borderBottom: '1px solid gray',
                marginBottom: '0.25em',
                color: group.color || 'white',
              }}
            >
              {group.label}
            </div>
            {group.value && (
              <div
                style={{
                  fontSize: '14px',
                }}
              >
                {group.value}
              </div>
            )}
            {group.details && (
              <div
                style={{
                  display: 'grid',
                  color: '#ccc',
                  gridTemplateColumns: 'auto auto',
                  fontSize: '12px',
                  padding: '0.25em',
                  marginTop: '0.25em',
                }}
              >
                {group.details &&
                  Object.keys(group.details).map(key => (
                    <Fragment key={key}>
                      <div>{group.details![key].label}</div>
                      <div style={{ textAlign: 'right' }}>
                        {group.details![key].value}
                      </div>
                    </Fragment>
                  ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </Panel>
  );
};
