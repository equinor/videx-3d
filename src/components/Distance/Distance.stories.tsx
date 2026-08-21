import type { Meta, StoryObj } from '@storybook/react-vite';
import { Canvas3dDecorator } from '../../storybook/decorators/canvas-3d-decorator';
import { Tanker } from '../Tanker/Tanker';
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
 * `Distance` conditionally renders (or, with `onDemand`, mounts/unmounts) its children
 * based on the camera's distance to a bounds published by a parent — the generic
 * `Bounds` (used in these stories) or `WellboreBounds`. It is the building block for
 * distance-based level-of-detail. Drag to orbit and scroll to zoom, and watch the
 * geometry swap.
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
 * The simplest case: one `Bounds` sphere and two `Distance` bands that swap a torus knot
 * (within `distance`) for a box (beyond it). Toggle `onDemand` to mount/unmount the near
 * geometry instead of just hiding it.
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
 * A composition of three `Distance` bands sharing one `Bounds`, giving multiple swaps as
 * the camera moves: torus knot (near) → icosahedron (mid) → wireframe box (far). The
 * bands are contiguous (`[0, near) [near, far) [far, ∞)`) so exactly one shows at a time.
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
 * A real-world use case: swap a full-detail `Tanker` for a low-poly version by camera
 * distance. Both share one `Bounds` sized to the hull; the high-detail hull +
 * superstructure shows within `lodDistance`, the cheap low-poly hull beyond it. Zoom out
 * to see the swap (rendered without an `<Ocean>`, so the vessel is static).
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
