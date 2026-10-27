import { useThree } from '@react-three/fiber';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useMemo } from 'react';
import {
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  PlaneGeometry,
  Ray,
  Vector3,
} from 'three';
import { Pass } from '../../rendering/Pass';
import { OITRenderPass } from '../../rendering/passes/OITRenderPass';
import { OutputPass } from '../../rendering/passes/OutputPass';
import { RenderingPipeline } from '../../rendering/RenderingPipeline';
import { Vec3 } from '../../sdk/types/common';
import { Canvas3dDecorator } from '../../storybook/decorators/canvas-3d-decorator';
import { LabelLayer } from './LabelLayer';
import { Labels } from './Labels';
import { Label, LabelAlign, LabelBaseline, LabelsProvider } from './types';

// A hill, its contours, and a grid on the ground round it.
const HILL_HEIGHT = 60;
const HILL_SPREAD = 50;
const GRID_SIZE = 400;
const GRID_STEP = 20;

const hillHeight = (x: number, z: number) =>
  HILL_HEIGHT * Math.exp(-(x * x + z * z) / (2 * HILL_SPREAD * HILL_SPREAD));
const hillNormal = (x: number, z: number): Vec3 => {
  const k = hillHeight(x, z) / (HILL_SPREAD * HILL_SPREAD);
  const n = new Vector3(k * x, 1, k * z).normalize();
  return [n.x, n.y, n.z];
};
const contourRadius = (level: number) =>
  HILL_SPREAD * Math.sqrt(-2 * Math.log(level / HILL_HEIGHT));

const createHill = () => {
  const geometry = new PlaneGeometry(GRID_SIZE, GRID_SIZE, 160, 160);
  geometry.rotateX(-Math.PI / 2);
  const position = geometry.getAttribute('position');
  for (let i = 0; i < position.count; i++)
    position.setY(i, hillHeight(position.getX(i), position.getZ(i)));
  geometry.computeVertexNormals();
  return geometry;
};

const createContour = (level: number) => {
  const radius = contourRadius(level);
  const points: number[] = [];
  for (let i = 0; i < 128; i++) {
    const a = (i / 128) * Math.PI * 2;
    points.push(radius * Math.cos(a), level + 0.2, radius * Math.sin(a));
  }
  return new BufferGeometry().setAttribute(
    'position',
    new Float32BufferAttribute(points, 3),
  );
};

// Painted on the slope: level, so along the contour.
const contourLabels = (levels: number[], perContour: number) =>
  levels.flatMap(level => {
    const radius = contourRadius(level);
    return Array.from({ length: perContour }, (_, i): Label => {
      const a = ((i + 0.5) / perContour) * Math.PI * 2;
      const x = radius * Math.cos(a);
      const z = radius * Math.sin(a);
      return {
        text: `${level} m`,
        position: [x, level, z],
        normal: hillNormal(x, z),
      };
    });
  });

// How far a grid line's label lies beside it.
const BESIDE = 4;

// Labels for the grid lines at fixed crossings, every 100 m, or every 200 m from afar:
// they come and go with the view, but never move.
const ray = new Ray();
const foot = new Vector3();
const gridLabels: LabelsProvider = ({ camera }) => {
  camera.getWorldDirection(ray.direction);
  ray.origin.copy(camera.position);
  if (ray.direction.y > -0.05)
    foot.set(camera.position.x, 0, camera.position.z);
  else ray.at(-camera.position.y / ray.direction.y, foot);
  const every = camera.position.distanceTo(foot) < 600 ? 100 : 200;
  const half = GRID_SIZE / 2;
  const labels: Label[] = [];
  for (let v = -half; v <= half; v += GRID_STEP) {
    for (let w = -half; w <= half; w += every) {
      // Along each line on the hill, beside it, toward the top of its text.
      const x = v + BESIDE;
      const z = v - BESIDE;
      labels.push(
        {
          text: `X ${v}`,
          position: [x, hillHeight(x, w), w],
          direction: [0, 0, 1],
          normal: hillNormal(x, w),
        },
        {
          text: `Z ${v}`,
          position: [w, hillHeight(w, z), z],
          direction: [1, 0, 0],
          normal: hillNormal(w, z),
        },
      );
    }
  }
  return labels;
};

// Many labels, lying level at random, for measuring.
const stressLabels = (count: number) => {
  let seed = 1;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  return Array.from({ length: count }, (_, i): Label => {
    const a = random() * Math.PI * 2;
    return {
      text: `Label ${i}`,
      position: [
        (random() - 0.5) * GRID_SIZE,
        random() * 100,
        (random() - 0.5) * GRID_SIZE,
      ],
      direction: [Math.cos(a), 0, Math.sin(a)],
    };
  });
};

// Order-independent transparency, its overlay step drawing the labels, then the output.
const OitPipeline = () => {
  const scene = useThree(s => s.scene);
  const camera = useThree(s => s.camera);
  const passes = useMemo<Pass[]>(() => {
    const base = new OITRenderPass(scene, camera);
    base.antialias = 'smaa';
    return [base, new OutputPass()];
  }, [scene, camera]);
  return <RenderingPipeline passes={passes} />;
};

type LabelsStoryArgs = {
  pipeline: 'default' | 'oit';
  contours: boolean;
  contourCount: number;
  labelsPerContour: number;
  grid: boolean;
  stressLabels: number;
  glass: boolean;
  markers: boolean;
  color: string;
  gridColor: string;
  size: number;
  fontWeight: number;
  fontStyle: string;
  letterSpacing: number;
  align: LabelAlign;
  baseline: LabelBaseline;
  offsetAlong: number;
  offsetUp: number;
  opacity: number;
  minPixels: number;
  fullPixels: number;
  minFacing: number;
  fullFacing: number;
  minDistance: number;
  maxDistance: number;
  fadeDistance: number;
  haloWidth: number;
  depthTest: boolean;
  lift: number;
};

const LabelsStory = ({
  pipeline,
  contours,
  contourCount,
  labelsPerContour,
  grid,
  stressLabels: stressCount,
  glass,
  markers,
  color,
  gridColor,
  offsetAlong,
  offsetUp,
  fullPixels,
  fullFacing,
  ...rest
}: LabelsStoryArgs) => {
  // 0: the defaults (1.5 and 2 times the least).
  const style = {
    ...rest,
    offset: [offsetAlong, offsetUp] as [number, number],
    fullPixels: fullPixels || undefined,
    fullFacing: fullFacing || undefined,
  };
  const hill = useMemo(createHill, []);
  const levels = useMemo(
    () =>
      Array.from({ length: contourCount }, (_, i) =>
        Math.round(((i + 1) * HILL_HEIGHT) / (contourCount + 1)),
      ),
    [contourCount],
  );
  const contourGeometries = useMemo(() => levels.map(createContour), [levels]);
  const labels = useMemo(
    () => contourLabels(levels, labelsPerContour),
    [levels, labelsPerContour],
  );
  const stress = useMemo(() => stressLabels(stressCount), [stressCount]);
  // Where each contour label is placed from, to see its alignment and offset.
  const anchors = useMemo(
    () =>
      new BufferGeometry().setAttribute(
        'position',
        new Float32BufferAttribute(
          labels.flatMap(label => label.position),
          3,
        ),
      ),
    [labels],
  );

  return (
    <>
      <mesh geometry={hill}>
        <meshStandardMaterial color="#5b7a4a" side={DoubleSide} />
      </mesh>
      <gridHelper
        args={[GRID_SIZE, GRID_SIZE / GRID_STEP, '#888888', '#444444']}
        position={[0, 0.05, 0]}
        visible={grid}
      />
      {contours &&
        contourGeometries.map((geometry, i) => (
          <lineLoop key={levels[i]} geometry={geometry}>
            <lineBasicMaterial color={color} />
          </lineLoop>
        ))}
      {contours && markers && (
        <points geometry={anchors} renderOrder={1001}>
          <pointsMaterial
            color="#ff3d3d"
            size={6}
            sizeAttenuation={false}
            depthTest={false}
          />
        </points>
      )}
      {/* A pane of glass over the hill: an OIT surface the labels are drawn over. */}
      {glass && (
        <mesh position={[0, 40, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[160, 160]} />
          <meshStandardMaterial
            color="#6fb7ff"
            transparent
            opacity={0.35}
            side={DoubleSide}
            depthWrite={false}
          />
        </mesh>
      )}
      {pipeline === 'oit' && <OitPipeline />}
      <Labels>
        <LabelLayer
          visible={contours}
          labels={labels}
          color={color}
          {...style}
        />
        <LabelLayer
          visible={grid}
          provider={gridLabels}
          color={gridColor}
          {...style}
        />
        <LabelLayer
          visible={stressCount > 0}
          labels={stress}
          color="#9ad0ff"
          {...style}
        />
      </Labels>
    </>
  );
};

const meta = {
  title: 'Components/Misc/Labels',
  component: LabelsStory,
  argTypes: {
    color: { control: 'color' },
    gridColor: { control: 'color' },
    contourCount: { control: { type: 'range', min: 1, max: 12, step: 1 } },
    labelsPerContour: { control: { type: 'range', min: 1, max: 16, step: 1 } },
    stressLabels: { control: { type: 'range', min: 0, max: 20000, step: 500 } },
    size: { control: { type: 'range', min: 1, max: 30, step: 0.5 } },
    fontWeight: { control: { type: 'range', min: 100, max: 900, step: 100 } },
    fontStyle: { control: 'inline-radio', options: ['normal', 'italic'] },
    letterSpacing: {
      control: { type: 'range', min: -0.1, max: 0.5, step: 0.01 },
    },
    align: { control: 'inline-radio', options: ['left', 'center', 'right'] },
    baseline: { control: 'inline-radio', options: ['top', 'middle', 'bottom'] },
    offsetAlong: { control: { type: 'range', min: -3, max: 3, step: 0.1 } },
    offsetUp: { control: { type: 'range', min: -3, max: 3, step: 0.1 } },
    opacity: { control: { type: 'range', min: 0, max: 1, step: 0.05 } },
    minPixels: { control: { type: 'range', min: 0, max: 30, step: 1 } },
    fullPixels: { control: { type: 'range', min: 0, max: 60, step: 1 } },
    minFacing: { control: { type: 'range', min: 0, max: 0.9, step: 0.05 } },
    fullFacing: { control: { type: 'range', min: 0, max: 1, step: 0.05 } },
    minDistance: { control: { type: 'range', min: 0, max: 500, step: 10 } },
    maxDistance: { control: { type: 'range', min: 50, max: 5000, step: 50 } },
    fadeDistance: { control: { type: 'range', min: 0, max: 1000, step: 10 } },
    haloWidth: { control: { type: 'range', min: 0, max: 0.4, step: 0.01 } },
    lift: { control: { type: 'range', min: 0, max: 10, step: 0.1 } },
    pipeline: { control: 'inline-radio', options: ['default', 'oit'] },
  },
} satisfies Meta<typeof LabelsStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    pipeline: 'default',
    contours: true,
    contourCount: 6,
    labelsPerContour: 6,
    grid: true,
    stressLabels: 0,
    glass: false,
    markers: false,
    color: '#ffd23f',
    gridColor: '#ffffff',
    size: 5,
    fontWeight: 600,
    fontStyle: 'normal',
    letterSpacing: 0,
    align: 'center',
    baseline: 'middle',
    offsetAlong: 0,
    offsetUp: 0,
    opacity: 1,
    minPixels: 6,
    fullPixels: 0,
    minFacing: 0.2,
    fullFacing: 0,
    minDistance: 0,
    maxDistance: 5000,
    fadeDistance: 0,
    haloWidth: 0.15,
    depthTest: true,
    lift: 1,
  },
  parameters: {
    scale: 150,
  },
  render: args => <LabelsStory {...args} />,
  decorators: [Canvas3dDecorator],
};
