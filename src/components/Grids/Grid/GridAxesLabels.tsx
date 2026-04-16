import { Text } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useMemo, useState } from 'react';
import { Color, Vector3 } from 'three';
import { clamp } from '../../../sdk';
import { Vec2 } from '../../../sdk/types/common';

export type GridAxesLabelsProps = {
  scale: Vec2;
  units: number;
  start: Vec2;
  originOffset: Vec2;
  size: Vec2;
  axesTickSize: number;
  plane: 'xz' | 'xy' | 'zy';
  color?: string | number | Color;
  side?: 'front' | 'back' | 'both';
  axesOffset: Vec2;
  trimAxesLabels: boolean;
  renderOrder?: number;
};

type Tick = {
  pos: Vec2;
  value: number;
  index: string;
};

type Ticks = {
  xAxis: Tick[];
  yAxis: Tick[];
};

const cameraDirection = new Vector3();

/**
 * Adds grid axes and labels to a `Grid` component. Used internally by the `Grid` component.
 *
 * @internal
 *
 * @group Components
 */
export const GridAxesLabels = ({
  scale,
  start,
  size,
  units,
  originOffset,
  axesOffset,
  axesTickSize,
  plane,
  color,
  side,
  trimAxesLabels = false,
  renderOrder,
}: GridAxesLabelsProps) => {
  const [rotations, setRotations] = useState({ x: 0, y: 0, flipped: false });

  useFrame(({ camera }) => {
    camera.getWorldDirection(cameraDirection);
    const rot = {
      x: 0,
      y: 0,
      flipped: false,
    };

    if (plane === 'xz') {
      rot.flipped = cameraDirection.y > 0;
      if (rot.flipped) {
        rot.x = cameraDirection.z < 0 ? Math.PI : 0;
        rot.y = cameraDirection.x < 0 ? Math.PI : 0;
      } else {
        rot.x = cameraDirection.z > 0 ? Math.PI : 0;
        rot.y = cameraDirection.x > 0 ? Math.PI : 0;
      }
    } else if (plane === 'xy') {
      rot.flipped = cameraDirection.z > 0;
      rot.x = 0;
      rot.y = cameraDirection.x > 0 ? Math.PI : 0;
    } else if (plane === 'zy') {
      rot.flipped = cameraDirection.x > 0;
      rot.x = 0;
      rot.y = cameraDirection.z < 0 ? Math.PI : 0;
    }

    if (
      rotations.x !== rot.x ||
      rotations.y !== rot.y ||
      rotations.flipped !== rot.flipped
    ) {
      setRotations(rot);
    }
  });

  const fontSize = useMemo<number>(() => units / 7.5, [units]);
  const textColor = useMemo(() => new Color(color || '#fff'), [color]);

  const ticks = useMemo<Ticks>(() => {
    const halfSize = [size[0] * 0.5, size[1] * 0.5];
    const distanceToOrigin = [
      halfSize[0] + originOffset[0],
      halfSize[1] + originOffset[1],
    ];

    const distanceToAxis = [
      distanceToOrigin[0] + clamp(axesOffset[0], -halfSize[0], halfSize[0]),
      distanceToOrigin[1] + clamp(axesOffset[1], -halfSize[1], halfSize[1]),
    ];
    const ticksToOrigin = [
      Math.floor((distanceToOrigin[0] - (distanceToOrigin[0] % units)) / units),
      Math.floor((distanceToOrigin[1] - (distanceToOrigin[1] % units)) / units),
    ];

    const offset: Vec2 = [
      -halfSize[0] + (distanceToOrigin[0] % units),
      -halfSize[1] + (distanceToOrigin[1] % units),
    ];

    // TODO: Determine required ticks based on view
    const nTicks: Vec2 = [
      Math.min(
        1000,
        Math.floor((size[0] - (distanceToOrigin[0] % units)) / units) + 1,
      ),
      Math.min(
        1000,
        Math.floor((size[1] - (distanceToOrigin[1] % units)) / units) + 1,
      ),
    ];

    const xAxis: Tick[] = [];
    const yAxis: Tick[] = [];

    const fontSizeOffset = axesTickSize * units + fontSize * 0.6;

    const clampedOffset = [
      clamp(axesOffset[1] + originOffset[1], -halfSize[1], +halfSize[1]),
      clamp(axesOffset[0] + originOffset[0], -halfSize[0], +halfSize[0]),
    ];

    for (
      let x = trimAxesLabels ? 1 : 0;
      x < nTicks[0] - (trimAxesLabels ? 1 : 0);
      x++
    ) {
      const pos: Vec2 = [
        offset[0] + x * units,
        clampedOffset[0] + fontSizeOffset,
      ];

      const value =
        Math.round(
          10 * (start[0] + (x - ticksToOrigin[0]) * units * scale[0]),
        ) / 10;
      if (Math.abs(distanceToAxis[0] - (pos[0] + halfSize[0])) > units / 4) {
        xAxis.push({
          pos,
          value,
          index: `x${x}`,
        });
      }
    }

    for (
      let y = trimAxesLabels ? 1 : 0;
      y < nTicks[1] - (trimAxesLabels ? 1 : 0);
      y++
    ) {
      const pos: Vec2 = [
        clampedOffset[1] - fontSizeOffset,
        offset[1] + y * units,
      ];
      const value =
        Math.round(
          10 * (start[1] + (y - ticksToOrigin[1]) * units * scale[1]),
        ) / 10;
      if (Math.abs(distanceToAxis[1] - (pos[1] + halfSize[1])) > units / 4) {
        yAxis.push({
          pos,
          value,
          index: `y${y}`,
        });
      }
    }

    return { xAxis, yAxis };
  }, [
    size,
    units,
    originOffset,
    axesOffset,
    axesTickSize,
    fontSize,
    scale,
    start,
    trimAxesLabels,
  ]);

  return (
    <group
      renderOrder={renderOrder}
      position={[0, 0, (rotations.flipped ? -1 : 1) * (units / 1000)]}
      visible={
        side === 'both' ||
        (side === 'front' && !rotations.flipped) ||
        (side === 'back' && rotations.flipped)
      }
    >
      {ticks.xAxis.map(tick => (
        <Text
          key={tick.index}
          renderOrder={renderOrder}
          characters="123456789,.0"
          position={[...tick.pos, 0]}
          fontSize={fontSize}
          textAlign="center"
          anchorX="center"
          anchorY="middle"
          rotation-z={rotations.x}
          rotation-y={rotations.flipped ? Math.PI : 0}
          color={textColor}
          material-depthWrite={true}
        >
          {tick.value}
        </Text>
      ))}
      {ticks.yAxis.map(tick => (
        <Text
          key={tick.index}
          renderOrder={renderOrder}
          characters="123456789,.0"
          position={[...tick.pos, 0]}
          fontSize={fontSize}
          textAlign="center"
          anchorX="center"
          anchorY="middle"
          rotation-z={rotations.y + Math.PI / 2}
          rotation-x={rotations.flipped ? Math.PI : 0}
          color={textColor}
          material-depthWrite={true}
        >
          {tick.value}
        </Text>
      ))}
    </group>
  );
};
