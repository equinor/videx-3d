import type { Meta, StoryObj } from '@storybook/react-vite'
import { Canvas3dWebGLDecorator } from '../../storybook/decorators/canvas-3d-webgl-decorator'
import { GlyphsDecorator } from '../../storybook/decorators/glyphs-decorator'
import { SDFTest } from './SDFTest'

const meta = {
  title: 'Components/Misc/SDFTest',
  component: SDFTest,
  decorators: [
    GlyphsDecorator,
    Canvas3dWebGLDecorator,
  ],
  parameters: {
    autoClear: true,
    scale: 1000,
    cameraPosition: [0, 0, 2000],
    cameraTarget: [0, 0, 0],
    //pixelRatio: 1
  },
  tags: ['autodocs']
} satisfies Meta<typeof SDFTest>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {
    text: 'AaBbCcDdEeFfGgHhIiJjKkLlMmNnOoPpQqRrSsTtUuVvWwXxYyZz\n0123456789\nHello glyphs!',
    inBias: 0,
    outBias: 0,
    fontSize: 32,
    rotation: 0,
    spacing: 0,
    verticalAlign: 0,
    horizontalAlign: 0
  },
  argTypes: {
    inBias: {
      control: {
        type: 'range',
        min: -0.5,
        max: 0.5,
        step: 0.01,
      }
    },
    outBias: {
      control: {
        type: 'range',
        min: -0.5,
        max: 0.5,
        step: 0.01,
      }
    },
    fontSize: {
      control: {
        type: 'range',
        min: 1,
        max: 200,
        step: 1,
      },
    },
    rotation: {
      control: {
        type: 'range',
        min: -3.14,
        max: 3.14,
        step: 0.01,
      },
    },
    spacing: {
      control: {
        type: 'range',
        min: 0,
        max: 100,
        step: 1,
      }
    },
    verticalAlign: {
      control: {
        type: 'range',
        min: -1,
        max: 1,
        step: 0.01,
      }
    },
    horizontalAlign: {
      control: {
        type: 'range',
        min: 0,
        max: 1,
        step: 0.5,
      }
    },
  }
}
