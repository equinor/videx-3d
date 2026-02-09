import { useCallback, useEffect, useRef, useState } from 'react';
import { useData } from '../../hooks/useData';
import { WellMap } from '../../components/Html/WellMap/WellMap';
import {
  WellboreSelectedEvent,
  wellboreSelectedEventType,
} from '../../events/wellbore-events';
import { WellboreHeader } from '../../sdk/data/types/WellboreHeader';
import { PositionLog } from '../../sdk/data/types/PositionLog';
import { ScaleOrdinal } from 'd3-scale';
import { WellMapCasingShoes } from '../../components/Html/WellMap/addons/WellMapCasingShoes';
import { WellMapCompletionIntervals } from '../../components/Html/WellMap/addons/WellMapCompletionIntervals';
import { Vec3 } from '../../sdk/types/common';
import { WellboreManager } from '../../sdk/managers/WellboreManager';
import {
  CameraFocusAtPointEvent,
  CameraSetPositionEvent,
} from '../../events/camera-events';
import { getTrajectory, Trajectory } from '../../sdk/utils/trajectory';

const style: any = {
  display: 'flex',
  flexDirection: 'row',
  position: 'absolute',
  height: 'auto',
  bottom: 0,
  top: 0,
  left: 0,
  right: 0,
};

type Props = {
  colorScale?: ScaleOrdinal<string, string>;
};

const wellboreManager = new WellboreManager();

const WellMapSelector = ({ colorScale }: Props) => {
  const offsetPosition = useRef<Vec3>([0, 0, 0]);

  const [depth, setDepth] = useState<number | undefined>();
  const [selected, setSelected] = useState<string | undefined>();
  const [wellIdentifier, setWellIdentifier] = useState<string | null>(null);

  const wellboreState = useRef<Trajectory | null>(null);

  const store = useData();

  const onDepthChange = useCallback((depth: number, flyTo = false) => {
    setDepth(depth);
    if (wellboreState.current) {
      const point = wellboreState.current.getPointAtDepth(depth, true) as Vec3;
      point[0] += offsetPosition.current[0];
      point[1] += offsetPosition.current[1];
      point[2] += offsetPosition.current[2];
      if (flyTo) {
        dispatchEvent(new CameraFocusAtPointEvent({ point }));
      } else {
        dispatchEvent(new CameraSetPositionEvent(point));
      }
    }
  }, []);

  useEffect(() => {
    async function onWellboreSelect(event: WellboreSelectedEvent) {
      if (!store) return;
      if (event.detail.id !== selected) {
        offsetPosition.current = wellboreManager.getInfo(event.detail.id)
          ?.position || [0, 0, 0];
        setSelected(event.detail.id);

        const poslog = await store.get<PositionLog>(
          'position-logs',
          event.detail.id,
        );

        if (poslog) {
          const trajectory = getTrajectory(event.detail.id, poslog);

          if (trajectory) {
            wellboreState.current = trajectory;
          } else {
            wellboreState.current = null;
          }

          const wellbore = await store.get<WellboreHeader>(
            'wellbore-headers',
            event.detail.id,
          );
          if (wellbore) {
            if (wellbore.well !== wellIdentifier) {
              setWellIdentifier(wellbore.well);
            }
          }
        }
      }
      if (wellboreState.current !== null) {
        if (event.detail.position) {
          const point = event.detail.position;
          const localPosition: Vec3 = [
            point[0] - offsetPosition.current[0],
            point[1] - offsetPosition.current[1],
            point[2] - offsetPosition.current[2],
          ];
          const nearestPosition =
            wellboreState.current.curve.nearest(localPosition);
          if (nearestPosition) {
            const destination: Vec3 = [
              nearestPosition.point[0] + offsetPosition.current[0],
              nearestPosition.point[1] + offsetPosition.current[1],
              nearestPosition.point[2]! + offsetPosition.current[2],
            ];

            setDepth(
              wellboreState.current.measuredTop +
                nearestPosition.position * wellboreState.current.measuredLength,
            );

            if (event.detail.flyTo) {
              dispatchEvent(
                new CameraFocusAtPointEvent({
                  point: destination,
                }),
              );
            } else {
              dispatchEvent(new CameraSetPositionEvent(event.detail.position));
            }
          }
        } else if (event.detail.depth) {
          onDepthChange(event.detail.depth, event.detail.flyTo);
        } else {
          onDepthChange(wellboreState.current.measuredTop);
        }
      }
    }

    addEventListener(wellboreSelectedEventType, onWellboreSelect);

    return () => {
      removeEventListener(wellboreSelectedEventType, onWellboreSelect);
    };
  }, [store, selected, wellIdentifier, onDepthChange]);

  const onSelect = useCallback((id: string, depth: number) => {
    if (wellboreState.current) {
      dispatchEvent(
        new WellboreSelectedEvent({
          id,
          depth,
          flyTo: true,
        }),
      );
    }
  }, []);

  return (
    <div
      style={{
        padding: '0.5em 0 0.5em 2px',
        background: '#222222a0',
        zIndex: 10,
        pointerEvents: 'all',
      }}
    >
      {wellIdentifier && (
        <WellMap
          colors={
            colorScale
              ? wellbore =>
                  colorScale(wellbore.name.replace(wellbore.well, '') || 'Main')
              : undefined
          }
          depth={depth}
          onDepthChanged={onDepthChange}
          wellIdentifier={wellIdentifier}
          selected={selected}
          onSelect={onSelect}
        >
          {/* <WellMapFormations formations={formations} /> */}
          <WellMapCasingShoes />
          <WellMapCompletionIntervals />
          {/* <WellMapTvd /> */}
        </WellMap>
      )}
    </div>
  );
};

export const WellMapDecorator = (Story: any, { parameters }: any) => {
  return (
    <div style={style}>
      <WellMapSelector colorScale={parameters.colorScale} />
      <Story />
    </div>
  );
};
