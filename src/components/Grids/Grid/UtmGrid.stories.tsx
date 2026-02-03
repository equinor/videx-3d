import type { Meta, StoryObj } from '@storybook/react-vite'

import { Vec2 } from '../../../sdk/types/common'
import { Canvas3dWebGLDecorator } from '../../../storybook/decorators/canvas-3d-webgl-decorator'
import storyArgs from '../../../storybook/story-args.json'
import { UtmArea } from '../../UtmArea'
import { UtmGrid } from './UtmGrid'

const utmZone = storyArgs.utmZone
const origin = storyArgs.origin as Vec2

const meta = {
  title: 'Components/Grids/UtmGrid',
  component: UtmGrid,
} satisfies Meta<typeof UtmGrid>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {
    size: [10000, 10000],
    cellSize: 100,
    plane: 'xz',
    relativeValues: false,
    dynamicCellSize: true,
  },
  argTypes: {
    relativeValues: {
      type: 'boolean'
    },
    dynamicCellSize: {
      type: 'boolean'
    }
  },
  decorators: [
    Canvas3dWebGLDecorator,
  ],
  parameters: {
    autoClear: true,
    scale: 1000,
    cameraPosition: [0, 1000, 500],
    cameraTarget: [0, 0, 0],
  },
  render: (args) => {

    return (
      <group>
        <UtmArea utmZone={utmZone} origin={origin}>
          <UtmGrid
            size={args.size}
            cellSize={args.cellSize}
            plane={args.plane}
            relativeValues={args.relativeValues}
            dynamicCellSize={args.dynamicCellSize}
          />
        </UtmArea>
        <axesHelper args={[args.cellSize]} />
      </group>
    )
  }
}
