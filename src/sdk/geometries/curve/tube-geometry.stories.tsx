import { Helper, useTexture } from '@react-three/drei';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useMemo } from 'react';

import { Canvas3dDecorator } from '../../../storybook/decorators/canvas-3d-decorator';
import { VertexNormalsHelper } from 'three-stdlib';
import { Vec3 } from '../../types/common';
import { getSplineCurve } from './curve-3d';
import { TubeGeometryOptions, createTubeGeometry } from './tube-geometry';

const points = [
  [0, 0, 0],
  [1, -1, 1],
  [1, -2, 2],
  [1.2, -3, 1],
  [2, -5, 5],
  [10, -5, 4.5],
  [12, -5, 7.5],
  [10, -4.8, 10],
];

type Props = {
  radius: number;
  innerRadius: number;
  thickness: number;
  showWireframe: boolean;
  showNormals: boolean;
  showUvMap: boolean;
  closed: boolean;
  radiusModificationType: 'none' | 'linear' | 'stepped';
  segmentsPerMeter: number;
  radialSegments: number;
  simplificationThreshold: number;
  from: number;
  to: number;
};

const DemoComponent = ({
  radius,
  innerRadius,
  thickness,
  showWireframe,
  showNormals,
  showUvMap,
  closed,
  radiusModificationType,
  segmentsPerMeter,
  radialSegments,
  simplificationThreshold,
  to,
  from,
}: Props) => {
  const geometry = useMemo(() => {
    const curve = getSplineCurve(points as Vec3[], closed);
    if (curve) {
      const options: TubeGeometryOptions = {
        from,
        to,
        radius,
        segmentsPerMeter,
        radialSegments,
        computeNormals: true,
        computeLengths: true,
        computeUvs: true,
        computeCurveNormals: false,
        computeCurveTangents: false,
        computeCurveBinormals: false,
        startCap: true,
        endCap: true,
        thickness,
        innerRadius,
        simplificationThreshold,
        addGroups: false,
      };

      if (radiusModificationType !== 'none') {
        options.radiusModifier = {
          type: radiusModificationType,
          steps: [
            [0, radius * 2],
            [0.05, radius * 2],
            [0.1, radius],
            [0.9, radius],
            [0.95, radius * 2],
            [1, radius * 2],
          ],
        };
      }

      return createTubeGeometry(curve, options);
    }
  }, [
    radius,
    closed,
    radiusModificationType,
    simplificationThreshold,
    segmentsPerMeter,
    radialSegments,
    to,
    from,
    innerRadius,
    thickness,
  ]);

  const uvMap = useTexture('uv_grid.jpg');

  if (!geometry) return null;

  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial
        key={showUvMap ? 'uv' : 'plain'}
        wireframe={showWireframe}
        color={showUvMap ? '#fff' : '#999'}
        metalness={0.75}
        roughness={0.25}
        map={showUvMap ? uvMap : null}
      />
      {showNormals && (
        <Helper type={VertexNormalsHelper} args={[0.2 * radius, 0xcc0000]} />
      )}
    </mesh>
  );
};

/**
 * `createTubeGeometry` builds a tube along a 3D curve (`Curve3D`), the geometry behind
 * `TubeTrajectory`, `Casings`, `CompletionTools`, `Perimeter` and `WellboreFormationColumn`. Its
 * options set the tube's radius, how finely it follows the curve, how its radius changes along
 * the curve, whether it is hollow, which part of the curve it covers and whether its ends are
 * capped. Here the curve is a spline through eight points (`getSplineCurve`), capped at both
 * ends.
 */
const meta = {
  title: 'SDK/tube-geometry',
  component: DemoComponent,
} satisfies Meta<typeof DemoComponent>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Set the `radius`, how finely the tube follows the curve (`segmentsPerMeter`, `radialSegments`,
 * `simplificationThreshold`) and the stretch of the curve it covers (`from`, `to`, 0 to 1).
 * `radiusModificationType` doubles the radius at both ends, tapering (`linear`) or in steps
 * (`stepped`); `innerRadius` or `thickness` makes the tube hollow, and `closed` joins the curve
 * into a loop. `showWireframe` and `showNormals` show how it is built, and `showUvMap` its
 * texture coordinates (`computeUvs`), with a test grid as its texture.
 */
export const Default: Story = {
  args: {
    radius: 0.25,
    segmentsPerMeter: 10,
    radialSegments: 16,
    simplificationThreshold: 0,
    radiusModificationType: 'none',
    innerRadius: 0,
    thickness: 0,
    from: 0,
    to: 1,
    closed: false,
    showNormals: false,
    showWireframe: false,
    showUvMap: false,
  },
  argTypes: {
    radius: {
      control: { type: 'range', min: 0.01, max: 1, step: 0.001 },
    },
    segmentsPerMeter: {
      control: { type: 'range', min: 1, max: 50, step: 1 },
    },
    radialSegments: {
      control: { type: 'range', min: 4, max: 64, step: 1 },
    },
    radiusModificationType: {
      options: ['none', 'linear', 'stepped'],
      control: { type: 'select' },
    },
    simplificationThreshold: {
      control: { type: 'range', min: 0, max: 0.001, step: 0.000001 },
    },
    from: {
      control: { type: 'range', min: 0, max: 1, step: 0.000001 },
    },
    to: {
      control: { type: 'range', min: 0, max: 1, step: 0.000001 },
    },
    innerRadius: {
      control: { type: 'range', min: 0, max: 1, step: 0.001 },
    },
    thickness: {
      control: { type: 'range', min: 0, max: 1, step: 0.001 },
    },
  },
  decorators: [Canvas3dDecorator],
  parameters: {
    scale: 2,
    autoClear: true,
  },
};
