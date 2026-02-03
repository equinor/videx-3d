import type { Meta, StoryObj } from '@storybook/react-vite'
import { Canvas3dDecorator } from '../../storybook/decorators/canvas-3d-decorator'
import { CameraTargetMarker } from './CameraTargetMarker'

const meta = {
  title: 'Components/Misc/CameraTargetMarker',
  decorators: [
    //PerformanceDecorator,
    Canvas3dDecorator,
  ],
  component: CameraTargetMarker,
} satisfies Meta<typeof CameraTargetMarker>

type StoryArgs = React.ComponentProps<typeof CameraTargetMarker>

export default meta
type Story = StoryObj<StoryArgs>

export const Default: Story = {
  args: {
    color: 'red',
    fixedX: undefined,
    fixedY: undefined,
    fixedZ: undefined,
    opacity: 0.25,
    radius: 0.5,
  },
  render: args => {
    return (
      <>
        <mesh rotation-x={-Math.PI / 2}>
          <planeGeometry args={[50, 50]} />
          <meshBasicNodeMaterial color="#050533" />
        </mesh>
        <mesh position={[0, 0.5, 0]}>
          <boxGeometry />
          <meshNormalNodeMaterial />
        </mesh>
        <mesh position={[10, 2.5, -5]}>
          <boxGeometry args={[2, 5, 1]} />
          <meshNormalNodeMaterial />
        </mesh>
        <CameraTargetMarker {...args} />
      </>
    )
  },
  parameters: {
    autoClear: true,
    scale: 100,
    cameraPosition: [0, 25, 50],
  }
}

