import type { Meta, StoryObj } from '@storybook/react-vite';
import { Canvas3dDecorator } from '../../storybook/decorators/canvas-3d-decorator';
import { Grid } from '../Grids/Grid/Grid';
import { CameraNavigation } from './CameraNavigation';

// Towers on a 20 km grid, to have something to move between: [x, z, height, colour].
const TOWERS: [number, number, number, string][] = [
  [0, 0, 400, '#4fc3f7'],
  [3000, -2000, 900, '#ffb74d'],
  [-4000, -5000, 600, '#81c784'],
  [6000, 4000, 1500, '#e57373'],
  [-7000, 3000, 300, '#ba68c8'],
];

/**
 * Keyboard and mouse navigation on top of the camera's orbit controls (drei's
 * `CameraControls`): move with W/A/S/D, the arrows and PgUp/PgDn, turn the view with the
 * mouse in fly mode (F), place a new target (T), jump home and back (Home, Backspace), keep
 * views on number keys (Alt+0–9, then 0–9), level the horizon (L) and face north (N). Over a
 * `World`, Alt+click goes to the ground or the sea, and Home shows the whole Earth. Every key
 * can be changed (`bindings`).
 *
 * Every story here has it already: the canvas decorator sets one up. This page turns that off
 * and shows the component on its own, its keys listed (`help`). Click in the view first, so the
 * keys reach it. See [Camera navigation](/videx-3d/docs/documents/camera-navigation.html).
 */
const meta = {
  title: 'Components/Misc/CameraNavigation',
  component: CameraNavigation,
  decorators: [Canvas3dDecorator],
  parameters: {
    autoClear: true,
    scale: 1000,
    cameraPosition: [-6000, 3000, 9000],
    cameraTarget: [0, 0, 0],
    // This story's own, below.
    cameraNavigation: false,
  },
} satisfies Meta<typeof CameraNavigation>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * A 20 km grid with five towers. Click in the view, then move with W/A/S/D (Shift faster, +
 * and - to change the speed), press F and move the mouse to look around, or T and the arrows
 * to place a new target. Set the base `speed`, the `sprint` factor, how far ahead the target
 * is kept (`distance`) and how fast the mouse turns the view (`lookSpeed`).
 */
export const Default: Story = {
  args: {
    speed: 200,
    sprint: 4,
    distance: 1000,
    lookSpeed: 0.15,
    help: true,
    enabled: true,
  },
  argTypes: {
    speed: { control: { type: 'range', min: 10, max: 2000, step: 10 } },
    sprint: { control: { type: 'range', min: 1, max: 20, step: 1 } },
    distance: { control: { type: 'range', min: 50, max: 5000, step: 50 } },
    lookSpeed: { control: { type: 'range', min: 0.02, max: 0.5, step: 0.01 } },
  },
  render: args => (
    <>
      <Grid
        plane="xz"
        size={[20000, 20000]}
        cellSize={1000}
        subDivisions={4}
        showAxes
      />
      {TOWERS.map(([x, z, height, color]) => (
        <mesh key={`${x},${z}`} position={[x, height / 2, z]}>
          <boxGeometry args={[200, height, 200]} />
          <meshStandardMaterial color={color} />
        </mesh>
      ))}
      <CameraNavigation {...args} />
    </>
  ),
};
