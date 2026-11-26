import type { Meta, StoryObj } from '@storybook/react-vite';
import { Canvas3dDecorator } from '../../storybook/decorators/canvas-3d-decorator';
import { Tanker } from '../../storybook/components/Tanker/Tanker';
import { Bounds } from './Bounds';
import { Distance } from './Distance';

type StoryArgs = {
  /** Default: single swap threshold (m). */
  distance: number;
  /** MultipleBands: near threshold (m). */
  near: number;
  /** MultipleBands: far threshold (m). */
  far: number;
  /** TankerLOD: high/low detail swap distance (m). */
  lodDistance: number;
  /** Mount/unmount instead of toggling visibility. */
  onDemand: boolean;
};

/**
 * Level of detail by distance: a `Distance` shows its children only while the camera is
 * between `min` and `max` metres from the bounds a parent gives, the generic `Bounds` (a
 * sphere, a box or a point, as here) or `WellboreBounds` for a wellbore. Give several their
 * own ranges to swap one version of an object for another as the camera moves; with
 * `onDemand` the children are mounted only while in range, instead of hidden.
 */
const meta = {
  title: 'Components/Misc/Distance',
  decorators: [Canvas3dDecorator],
  parameters: {
    autoClear: true,
    controls: { expanded: true },
    cameraTarget: [0, 0, 0],
  },
} satisfies Meta<StoryArgs>;

export default meta;
type Story = StoryObj<StoryArgs>;

/**
 * One `Bounds` sphere and two ranges: a torus knot within `distance` of it, a box beyond.
 * Zoom in and out to watch them swap; turn on `onDemand` to mount and unmount the torus knot
 * instead of hiding it.
 */
export const Default: Story = {
  args: { distance: 20, onDemand: false },
  argTypes: {
    distance: {
      control: { type: 'range', min: 1, max: 100, step: 1 },
      description: 'Camera distance (m) at which the geometry swaps.',
      table: { category: 'Distance' },
    },
    onDemand: {
      control: 'boolean',
      description:
        'Mount/unmount the near child on entering/leaving range (vs. toggling visibility).',
      table: { category: 'Distance' },
    },
  },
  parameters: { scale: 10, cameraPosition: [12, 12, 12] },
  render: ({ distance, onDemand }) => (
    <Bounds sphere={{ center: [0, 0, 0], radius: 2 }}>
      <Distance min={0} max={distance} onDemand={onDemand}>
        <mesh>
          <torusKnotGeometry args={[1.2, 0.4, 128, 16]} />
          <meshStandardMaterial color="tomato" />
        </mesh>
      </Distance>
      <Distance min={distance} max={Infinity}>
        <mesh>
          <boxGeometry args={[3.2, 3.2, 3.2]} />
          <meshStandardMaterial color="#4e79a7" flatShading />
        </mesh>
      </Distance>
    </Bounds>
  ),
};

/**
 * Three ranges under one `Bounds`, back to back so one shows at a time: a torus knot nearer
 * than `near`, an icosahedron up to `far`, and a wireframe box beyond.
 */
export const MultipleBands: Story = {
  args: { near: 12, far: 32 },
  argTypes: {
    near: {
      control: { type: 'range', min: 1, max: 100, step: 1 },
      description: 'Below this distance (m): torus knot; above: icosahedron.',
      table: { category: 'Thresholds' },
    },
    far: {
      control: { type: 'range', min: 1, max: 200, step: 1 },
      description: 'Above this distance (m): wireframe box.',
      table: { category: 'Thresholds' },
    },
  },
  parameters: { scale: 10, cameraPosition: [16, 16, 16] },
  render: ({ near, far }) => (
    <Bounds sphere={{ center: [0, 0, 0], radius: 2 }}>
      <Distance min={0} max={near}>
        <mesh>
          <torusKnotGeometry args={[1.2, 0.4, 128, 16]} />
          <meshStandardMaterial color="tomato" />
        </mesh>
      </Distance>
      <Distance min={near} max={far}>
        <mesh>
          <icosahedronGeometry args={[2, 0]} />
          <meshStandardMaterial color="#59a14f" flatShading />
        </mesh>
      </Distance>
      <Distance min={far} max={Infinity}>
        <mesh>
          <boxGeometry args={[3.2, 3.2, 3.2]} />
          <meshStandardMaterial color="#4e79a7" wireframe />
        </mesh>
      </Distance>
    </Bounds>
  ),
};

/**
 * A tanker in two versions under one `Bounds` the size of its hull: the detailed hull and
 * superstructure within `lodDistance`, a low-poly hull beyond. Zoom out to see the swap (there
 * is no sea here, so the vessel lies still).
 */
export const TankerLOD: Story = {
  name: 'Tanker LOD (real-world)',
  args: { lodDistance: 200 },
  argTypes: {
    lodDistance: {
      control: { type: 'range', min: 50, max: 800, step: 10 },
      description:
        'Camera distance (m) at which the tanker swaps between high- and low-detail geometry.',
      table: { category: 'LOD' },
    },
  },
  parameters: { scale: 10, cameraPosition: [120, 120, 220] },
  render: ({ lodDistance }) => (
    <Bounds sphere={{ center: [0, 0, 0], radius: 130 }}>
      <Distance min={0} max={lodDistance}>
        <Tanker
          lengthSegments={128}
          profileSegments={16}
          details="high"
          buoyancy={false}
          contactFoam={false}
        />
      </Distance>
      <Distance min={lodDistance} max={Infinity}>
        <Tanker
          lengthSegments={12}
          profileSegments={4}
          details="low"
          buoyancy={false}
          contactFoam={false}
        />
      </Distance>
    </Bounds>
  ),
};
