import { useCallback, useMemo } from 'react';
import { scaleLinear } from 'd3-scale';
import { path } from 'd3-path';
import { WellboreHeader } from '../../../sdk/data/types/WellboreHeader';
import { useWellMapState } from './well-map-context';

type Props = {
  wellboreId: string;
  color?: string;
  opacity?: number;
  width?: number;
  dashed?: boolean;
};

export const ActiveTrack = ({
  wellboreId,
  opacity = 0.75,
  width = 3,
  dashed = false,
}: Props) => {
  const wellMapState = useWellMapState();
  const wellboresById = wellMapState(state => state.wellboresById);
  const wellboresByName = wellMapState(state => state.wellboresByName);
  const ratio = wellMapState(state => state.measures.ratio);
  const domain = wellMapState(state => state.domain);
  const range = wellMapState(state => state.measures.range);
  const slotsById = wellMapState(state => state.slotsById);
  const styles = wellMapState(state => state.styles);
  const getSlotPosition = wellMapState(state => state.measures.getSlotPosition);

  const wellbore = useMemo(
    () => wellboresById[wellboreId] || null,
    [wellboreId, wellboresById],
  );

  const depthScale = useMemo(
    () => scaleLinear().domain(domain).range(range),
    [domain, range],
  );

  const strokeWidth = useMemo(() => (ratio > 0 ? ratio * 10 : 0), [ratio]);

  const segments = useMemo(() => {
    const segments: [number, number][] = [];
    if (wellbore) {
      let fromSlot = slotsById[wellbore.id];
      let current: WellboreHeader | undefined = wellbore;

      const x = getSlotPosition(fromSlot);
      const y = depthScale(wellbore.depthMdMsl);
      segments.push([x, y]);

      while (current) {
        const parent: WellboreHeader | undefined = current.parent
          ? wellboresByName[current.parent]
          : undefined;
        const toDepth =
          current.kickoffDepthMsl !== null
            ? current.kickoffDepthMsl
            : -current.depthReferenceElevation;
        const toSlot = parent ? slotsById[parent.id] : fromSlot;

        const x = getSlotPosition(toSlot);
        const y = depthScale(toDepth);

        segments.push([x, y]);

        fromSlot = toSlot;
        current = parent;
      }
    }
    return segments.reverse();
  }, [wellbore, depthScale, getSlotPosition, slotsById, wellboresByName]);

  const kickoff = useMemo(() => {
    if (wellbore) {
      const depth =
        wellbore.kickoffDepthMsl !== null
          ? wellbore.kickoffDepthMsl
          : -wellbore.depthReferenceElevation;
      return depthScale(depth);
    }
    return null;
  }, [wellbore, depthScale]);

  const pathStr = useCallback(
    (segments: [number, number][]) => {
      const pathFunc = path();
      if (segments.length < 2) return '';

      let x1 = segments[0][0];
      let y1 = segments[0][1];

      pathFunc.moveTo(x1, y1);

      for (let i = 1; i < segments.length; i++) {
        const x2 = segments[i][0];
        const y2 = segments[i][1];

        pathFunc.lineTo(x1, y1);
        if (x1 !== x2) {
          if (y2 - y1 > strokeWidth) {
            const y3 = y1 + strokeWidth;
            pathFunc.arcTo(x2, y1, x2, y3, strokeWidth);
          } else {
            pathFunc.lineTo(x2, y1);
          }
        }
        pathFunc.lineTo(x2, y2);

        x1 = x2;
        y1 = y2;
      }

      return pathFunc.toString();
    },
    [strokeWidth],
  );

  const dash = strokeWidth / 2;
  const dashArr = `${dash},${dash / 2}`;

  if (segments.length < 2) return null;
  return (
    <g
      style={{
        filter: `drop-shadow( 0px 0px 1px rgba(0,0,0,0.7))`,
        pointerEvents: 'none',
      }}
    >
      <path
        d={pathStr(segments)}
        stroke={styles.activeTrackColor}
        strokeWidth={ratio * width}
        fill={'none'}
        strokeDasharray={dashed ? dashArr : ''}
        strokeOpacity={opacity}
      />
      <line
        x1={segments[segments.length - 1][0] - strokeWidth * 0.5}
        x2={segments[segments.length - 1][0] + strokeWidth * 0.5}
        y1={segments[segments.length - 1][1]}
        y2={segments[segments.length - 1][1]}
        stroke={styles.activeTrackColor}
        strokeWidth={ratio * width * 0.75}
        strokeOpacity={opacity}
      />
      {kickoff !== null && (
        <circle
          cx={segments[segments.length - 2][0]}
          cy={segments[segments.length - 2][1]}
          r={strokeWidth * 1}
          fill={'none'}
          stroke={styles.activeTrackColor}
          strokeWidth={ratio}
          strokeOpacity={opacity}
        />
      )}
      <line
        x1={segments[0][0] - strokeWidth * 0.5}
        x2={segments[0][0] + strokeWidth * 0.5}
        y1={segments[0][1]}
        y2={segments[0][1]}
        stroke={styles.activeTrackColor}
        strokeWidth={ratio * width * 0.75}
        strokeOpacity={opacity}
      />
    </g>
  );
};
