import { useCallback, useEffect, useMemo, useState } from 'react';
import { useData } from '../../../../hooks/useData';
import { path } from 'd3-path';
import { scaleLinear } from 'd3-scale';
import { CompletionTool } from '../../../../sdk/data/types/CompletionTool';
import { toSegments } from '../../../../sdk/utils/segments';
import { nanoid } from 'nanoid';
import { PerforationInterval } from '../../../../sdk/data/types/PerforationInterval';
import { useWellMapState } from '../well-map-context';

type Interval = {
  id: string;
  type: 'screen' | 'perforation';
  x: number;
  y1: number;
  y2: number;
};

/**
 * WellMapCompletionIntervals props
 * @expand
 */
export type WellMapCompletionIntervalsProps = {
  colorScreen?: string;
  colorPerforation?: string;
};

/**
 * Completion intervals display addon for `WellMap`
 * @group Components
 *
 * @see {@link WellMap}
 */
export const WellMapCompletionIntervals = ({
  colorScreen = 'gray',
  colorPerforation = 'orange',
}: WellMapCompletionIntervalsProps) => {
  const store = useData();

  const [screenData, setScreenData] = useState<Record<
    string,
    CompletionTool[]
  > | null>(null);
  const [perforationData, setPerforationData] = useState<Record<
    string,
    PerforationInterval[]
  > | null>(null);

  const wellMapState = useWellMapState();
  const wellboreIds = wellMapState(state => state.wellboreIds);
  const wellboresById = wellMapState(state => state.wellboresById);
  const domain = wellMapState(state => state.domain);
  const range = wellMapState(state => state.measures.range);
  const ratio = wellMapState(state => state.measures.ratio);
  const slotsById = wellMapState(state => state.slotsById);
  const styles = wellMapState(state => state.styles);
  const getSlotPosition = wellMapState(state => state.measures.getSlotPosition);

  const depthScale = useMemo(
    () => scaleLinear().domain(domain).range(range),
    [domain, range],
  );

  useEffect(() => {
    if (store) {
      const screenDataPromises = wellboreIds.map(id =>
        store.get<CompletionTool[]>('completion-tools', id),
      );
      const perforationDataPromises = wellboreIds.map(id =>
        store.get<PerforationInterval[]>('perforations', id),
      );

      Promise.all(screenDataPromises).then(response => {
        if (response) {
          const data = response.reduce(
            (acc, d, i) => ({
              ...acc,
              [wellboreIds[i]]:
                d !== null ? d.filter(t => t.category === 'screen') : [],
            }),
            {},
          );
          setScreenData(data);
        }
      });

      Promise.all(perforationDataPromises).then(response => {
        const data = response.reduce(
          (acc, d, i) => ({
            ...acc,
            [wellboreIds[i]]: d || [],
          }),
          {},
        );
        setPerforationData(data);
      });
    }
  }, [wellboreIds, store]);

  const intervals = useMemo(() => {
    const output: Interval[] = [];

    if (screenData && perforationData) {
      wellboreIds.forEach(id => {
        const wellbore = wellboresById[id];

        const fromMsl =
          wellbore.kickoffDepthMsl !== null
            ? wellbore.kickoffDepthMsl
            : wellbore.depthReferenceElevation;
        const slot = slotsById[id];
        const position = getSlotPosition(slot);

        const screenSegments = screenData[id]
          ? toSegments(
              screenData[id].filter(
                d => fromMsl === undefined || d.mdBottomMsl > fromMsl,
              ),
              d => d.mdTopMsl,
              d => d.mdBottomMsl,
            )
          : [];

        screenSegments.forEach(d => {
          output.push({
            id: nanoid(),
            type: 'screen',
            x: position,
            y1: depthScale(d.start),
            y2: depthScale(d.end),
          });
        });

        const perforationSegments = perforationData[id]
          ? toSegments(
              perforationData[id].filter(
                d =>
                  d.status === 'Open' &&
                  (fromMsl === undefined || d.mdBottomMsl > fromMsl),
              ),
              d => d.mdTopMsl,
              d => d.mdBottomMsl,
            )
          : [];

        perforationSegments.forEach(d => {
          output.push({
            id: nanoid(),
            type: 'perforation',
            x: position,
            y1: depthScale(d.start),
            y2: depthScale(d.end),
          });
        });
      });
    }
    return output;
  }, [
    screenData,
    perforationData,
    depthScale,
    getSlotPosition,
    slotsById,
    wellboreIds,
    wellboresById,
  ]);

  const getPathString = useCallback(
    (interval: Interval) => {
      if (ratio) {
        const innerHalfWidth = 10 * ratio;
        const outerHalfWidth = 18 * ratio;

        const pathFunc = path();
        pathFunc.moveTo(interval.x - outerHalfWidth, interval.y1);
        pathFunc.lineTo(interval.x - innerHalfWidth, interval.y1);
        pathFunc.lineTo(interval.x - innerHalfWidth, interval.y2);
        pathFunc.lineTo(interval.x - outerHalfWidth, interval.y2);
        pathFunc.moveTo(interval.x + outerHalfWidth, interval.y1);
        pathFunc.lineTo(interval.x + innerHalfWidth, interval.y1);
        pathFunc.lineTo(interval.x + innerHalfWidth, interval.y2);
        pathFunc.lineTo(interval.x + outerHalfWidth, interval.y2);
        return pathFunc.toString();
      }
      return '';
    },
    [ratio],
  );

  const filterColor = useMemo(() => {
    const v = styles.darkMode ? 0 : 240;
    return `rgba(${v}, ${v}, ${v}, .9)`;
  }, [styles.darkMode]);

  if (!intervals) return null;

  return (
    <g>
      {intervals.map(interval => (
        <g
          key={interval.id}
          style={{
            cursor: 'help',
            filter: `drop-shadow( 1px 1px 2px ${filterColor})`,
            // @ts-expect-error bounding-box is valid on svg elements
            pointerEvents: 'bounding-box',
          }}
        >
          <title>{interval.type}</title>
          <path
            d={getPathString(interval)}
            stroke={
              interval.type === 'perforation' ? colorPerforation : colorScreen
            }
            strokeWidth={1.5}
            fill={'none'}
          />
        </g>
      ))}
    </g>
  );
};
