import type { Meta, StoryObj } from '@storybook/react-vite';

import { Float } from '@react-three/drei';
import { TextureLoader } from 'three';
import { Canvas3dDecorator } from '../../../storybook/decorators/canvas-3d-decorator';
import { Grid, GridProps } from './Grid';

const GridObjects = ({ units = 1 }: { units?: number }) => (
  <>
    <axesHelper args={[units]} />
    <mesh position={[350, 0, -500]} visible={true}>
      <sphereGeometry args={[10]} />
      <meshStandardMaterial />
    </mesh>
    <mesh position={[-200, 50, 250]} visible={true}>
      <boxGeometry args={[100, 100, 100]} />
      <meshStandardMaterial />
    </mesh>
  </>
);

const meta = {
  title: 'Components/Grids/Grid',
  component: Grid,
  decorators: [Canvas3dDecorator],
  parameters: {
    autoClear: true,
    scale: 100,
    cameraPosition: [150, 1000, 500],
    cameraTarget: [0, 0, 0],
  },
  argTypes: {
    cellSize: {
      control: 'select',
      options: [1, 10, 50, 100, 250, 1000],
    },
    subDivisions: {
      control: { type: 'range', min: 0, max: 10, step: 1 },
    },
    rulerLineWidth: {
      control: { type: 'range', min: 0, max: 5, step: 0.1 },
    },
    gridLineWidth: {
      control: { type: 'range', min: 0, max: 0.5, step: 0.001 },
    },
    planeOffset: {
      control: { type: 'range', min: -100, max: 100, step: 1 },
    },
    rulerOpacity: {
      control: { type: 'range', min: 0, max: 1, step: 0.001 },
    },
    opacity: {
      control: { type: 'range', min: 0, max: 1, step: 0.001 },
    },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof Grid>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * A 1 km square grid on the ground (`plane` `'xz'`): 50 m cells (`cellSize`) of ten minor lines
 * each (`subDivisions`), with a box, a sphere and the scene's axes for scale. Try the line
 * widths (`gridLineWidth`, `axesLineWidth`), the colours, `opacity`, and another `plane`.
 */
export const Default: Story = {
  args: {
    plane: 'xz',
    size: [1000, 1000],
    cellSize: 50,
    subDivisions: 10,
    gridLineWidth: 0.01,
  },
  render: (args: GridProps) => (
    <group>
      <group position={[0, 0, 0]}>
        <Grid {...args} />
      </group>
      <GridObjects units={args.cellSize} />
    </group>
  ),
};

/**
 * The axes cross, and count from zero, at `gridOrigin` (X -250, Z 300) instead of at the
 * grid's centre.
 */
export const OriginOffset: Story = {
  args: {
    plane: 'xz',
    gridOrigin: [-250, 300],
    size: [1000, 1000],
    cellSize: 50,
    subDivisions: 10,
    gridLineWidth: 0.01,
  },
  render: (args: GridProps) => (
    <group>
      <group position={[0, 0, 0]}>
        <Grid {...args} />
      </group>
      <GridObjects units={args.cellSize} />
    </group>
  ),
};

// export const AxesOffset: Story = {
//   args: {
//     plane: 'xz',
//     size: [1000, 1000],
//     cellSize: 50,
//     subDivisions: 10,
//     gridLineWidth: 0.01,
//     axesOffset: [-500, -500]
//   },
//   render: (args: GridProps) => (
//     <group>
//       <group position={[0, 0, 0]}>
//         <Grid {...args} />
//       </group>
//       <GridObjects units={args.cellSize} />
//     </group>
//   )
// }

/**
 * The axes' values scaled (`gridScale`): X labelled 20 times its distance, Z counting the other
 * way.
 */
export const ScaledAxes: Story = {
  args: {
    plane: 'xz',
    size: [1000, 1000],
    cellSize: 50,
    subDivisions: 10,
    gridLineWidth: 0.01,
    gridScale: [20, -1],
  },
  render: (args: GridProps) => (
    <group>
      <group position={[0, 0, 0]}>
        <Grid {...args} />
      </group>
      <GridObjects units={args.cellSize} />
    </group>
  ),
};

/**
 * Cells that grow and shrink with the camera's distance to the grid (`dynamicCellSize`): at each
 * distance, counted in cells, a factor on `cellSize` (`cellSizeDistanceFactors`). Zoom in and
 * out to watch the cells and their labels change.
 */
export const Dynamic: Story = {
  args: {
    plane: 'xz',
    size: [1000, 1000],
    cellSize: 10,
    subDivisions: 10,
    gridLineWidth: 0.01,
    dynamicCellSize: true,
    cellSizeDistanceFactors: [
      [0, 0.1],
      [2.5, 0.25],
      [5, 0.5],
      [10, 1],
      [25, 2.5],
      [50, 5],
      [100, 10],
      [250, 25],
    ],
  },
  render: (args: GridProps) => (
    <group>
      <group position={[0, 0, 0]}>
        <Grid {...args} />
      </group>
      <GridObjects units={args.cellSize} />
    </group>
  ),
};

/**
 * Rulers through the pointer along both axes while it is over the grid (`showRulers`); set
 * their `rulerColor`, `rulerLineWidth` and `rulerOpacity`.
 */
export const Rulers: Story = {
  args: {
    plane: 'xz',
    size: [1000, 1000],
    cellSize: 50,
    subDivisions: 10,
    gridLineWidth: 0.01,
    showRulers: true,
  },
  render: (args: GridProps) => (
    <group>
      <group position={[0, 0, 0]}>
        <Grid {...args} />
      </group>
      <GridObjects units={args.cellSize} />
    </group>
  ),
};

/**
 * A radial grid (`radial`): rings every `cellSize` and sixteen spokes, with minor rings and
 * spokes between them (`subDivisions`), centred on the scene's origin.
 */
export const Radial: Story = {
  args: {
    plane: 'xz',
    size: [1000, 1000],
    background: '#05080a',
    cellSize: 50,
    dynamicCellSize: false,
    subDivisions: 5,
    gridColorMajor: '#abc',
    gridColorMinor: '#789',
    gridLineWidth: 0.01,
    gridOrigin: [0, 0],
    showAxes: true,
    axesColor: '#fff',
    axesLineWidth: undefined,
    radial: true,
    dynamicSegments: false,
    gridScale: [1, 1],
    showRulers: false,
    rulerLineWidth: 1,
    planeOffset: 0,
    opacity: 1,
    onRulerUpdate: null,
  },
  render: (args: GridProps) => (
    <group>
      <group position={[0, 0, 0]}>
        <Grid {...args} />
      </group>
      <mesh position={[350, 0, -500]} visible={true}>
        <sphereGeometry args={[10]} />
        <meshStandardMaterial />
      </mesh>
      <mesh position={[-200, 50, 250]} visible={true}>
        <boxGeometry args={[100, 100, 100]} />
        <meshStandardMaterial />
      </mesh>
    </group>
  ),
};

/**
 * The radial grid centred on the sphere (`gridOrigin`) instead of the scene's origin.
 */
export const RadialOffset: Story = {
  args: {
    plane: 'xz',
    size: [1000, 1000],
    background: '#05080a',
    cellSize: 50,
    dynamicCellSize: false,
    subDivisions: 5,
    gridColorMajor: '#abc',
    gridColorMinor: '#789',
    gridLineWidth: 0.01,
    gridOrigin: [350, -500],
    showAxes: true,
    axesColor: '#fff',
    axesLineWidth: undefined,
    radial: true,
    dynamicSegments: false,
    gridScale: [1, 1],
    showRulers: false,
    rulerLineWidth: 1,
    planeOffset: 0,
    opacity: 1,
    onRulerUpdate: null,
  },
  render: (args: GridProps) => (
    <group>
      <group position={[0, 0, 0]}>
        <Grid {...args} />
      </group>
      <mesh position={[350, 0, -500]} visible={true}>
        <sphereGeometry args={[10]} />
        <meshStandardMaterial />
      </mesh>
      <mesh position={[-200, 50, 250]} visible={true}>
        <boxGeometry args={[100, 100, 100]} />
        <meshStandardMaterial />
      </mesh>
    </group>
  ),
};

/**
 * The radial grid with more spokes further out (`dynamicSegments`): their number doubles as the
 * distance from the centre does, so they stay about as far apart.
 */
export const RadialDynamicSegments: Story = {
  args: {
    plane: 'xz',
    size: [1000, 1000],
    background: '#05080a',
    cellSize: 50,
    dynamicCellSize: false,
    subDivisions: 5,
    gridColorMajor: '#abc',
    gridColorMinor: '#789',
    gridLineWidth: 0.01,
    gridOrigin: [0, 0],
    showAxes: true,
    axesColor: '#fff',
    axesLineWidth: undefined,
    radial: true,
    dynamicSegments: true,
    gridScale: [1, 1],
    showRulers: false,
    rulerLineWidth: 1,
    planeOffset: 0,
    opacity: 1,
    onRulerUpdate: null,
  },
  render: (args: GridProps) => (
    <group>
      <group position={[0, 0, 0]}>
        <Grid {...args} />
      </group>
      <mesh position={[350, 0, -500]} visible={true}>
        <sphereGeometry args={[10]} />
        <meshStandardMaterial />
      </mesh>
      <mesh position={[-200, 50, 250]} visible={true}>
        <boxGeometry args={[100, 100, 100]} />
        <meshStandardMaterial />
      </mesh>
    </group>
  ),
};

/**
 * The grid on old paper: a `texture` under its lines (`textureMix`), brown lines
 * (`gridColorMajor`, `gridColorMinor`), black axes and longer ticks (`axesTickSize`).
 */
export const Customized: Story = {
  args: {
    plane: 'xz',
    texture: new TextureLoader().load('old-paper.jpg'),
    size: [1000, 1000],
    cellSize: 50,
    subDivisions: 10,
    gridLineWidth: 0.01,
    gridColorMajor: '#5e3b0a',
    gridColorMinor: '#4d3008',
    axesColor: '#000000',
    axesTickSize: 0.2,
    textureMix: 0.8,
  },
  render: (args: GridProps) => (
    <group>
      <group position={[0, 0, 0]}>
        <Grid {...args} />
      </group>
      <GridObjects units={args.cellSize} />
    </group>
  ),
};

/**
 * A shade of what lies over the grid, cast straight down onto it (`enableProjection`, in
 * `projectionColor`) and redrawn every `projectionRefreshRate` milliseconds: watch the box's
 * shade follow it as it floats.
 */
export const Projections: Story = {
  args: {
    plane: 'xz',
    size: [1000, 1000],
    cellSize: 50,
    subDivisions: 10,
    gridLineWidth: 0.01,
    enableProjection: true,
    projectionColor: '#789',
    projectionRefreshRate: 100,
  },
  render: (args: GridProps) => (
    <group>
      <group position={[0, 0, 0]}>
        <Grid {...args} />
      </group>
      <axesHelper args={[args.cellSize]} />
      <mesh position={[250, 50, -400]} visible={true}>
        <sphereGeometry args={[10]} />
        <meshStandardMaterial />
      </mesh>
      <Float floatingRange={[0, 1000]}>
        <mesh position={[-200, 50, 250]} visible={true}>
          <boxGeometry args={[100, 100, 100]} />
          <meshStandardMaterial />
        </mesh>
      </Float>
    </group>
  ),
};
