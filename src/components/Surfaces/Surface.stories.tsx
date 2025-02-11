import type { Meta, StoryObj } from '@storybook/react'
import { useMemo } from 'react'
import { SurfaceMeta, Vec2 } from '../../sdk'
import { Canvas3dDecorator } from '../../storybook/decorators/canvas-3d-decorator'
import { DataProviderDecorator } from '../../storybook/decorators/data-provider-decorator'
import { GeneratorsProviderDecorator } from '../../storybook/decorators/generators-provider-decorator'
import { useSurfaceMeta } from '../../storybook/hooks/useSurfaceMeta'
import storyArgs from '../../storybook/story-args.json'
import { UtmArea, UtmPosition } from '../UtmArea'
import { Surface, SurfaceProps } from './Surface'
import { ContourColorMode } from './SurfaceMaterial'

// const loader = new TextureLoader()
// const normalMap = loader.load('normal_map.jpg')
// normalMap.anisotropy = 4

const utmZone = storyArgs.utmZone
const origin = storyArgs.origin as Vec2

type SurfaceStoryProps = Omit<SurfaceProps, 'meta'> & {
  surfaceId: string
}

const SurfaceStory = (props: SurfaceStoryProps) => {
  const surfaceHeaders = useSurfaceMeta()

  const meta = useMemo<SurfaceMeta | null>(() => {
    return (surfaceHeaders.find(d => d.id === props.surfaceId) || null)
  }, [props.surfaceId, surfaceHeaders])


  return (
    <UtmArea origin={origin} utmZone={utmZone}>
      {(props.surfaceId && meta) && (
        <UtmPosition easting={meta.header.xori} northing={meta.header.yori} altitude={meta.max}>
          <Surface
            {...props}
            meta={meta}
            rampMin={meta.displayMin + (props.rampMin || 0)}
            rampMax={meta.displayMax + (props.rampMax || 0)}
          />
        </UtmPosition>
      )}
    </UtmArea>

  )
}

const meta = {
  title: 'Components/Surfaces/Surface',
  component: SurfaceStory,
} satisfies Meta<typeof SurfaceStory>

type StoryArgs = React.ComponentProps<typeof SurfaceStory>

export default meta
type Story = StoryObj<StoryArgs>

export const Default: Story = {
  args: {
    surfaceId: Object.keys(storyArgs.surfaceOptions)[0],
    useColorRamp: true,
    reverseRamp: false,
    color: 'white',
    colorRamp: 0,
    opacity: 1,
    maxError: 2.5,
    wireframe: false,
    showContours: true,
    contoursColorMode: ContourColorMode.darken,
    contoursColorModeFactor: 0.5,
    contoursInterval: 10,
    contoursThickness: 0.8,
    contoursColor: '#000000',
    rampMin: 0,
    rampMax: 0,
  },
  argTypes: {
    surfaceId: {
      options: Object.keys(storyArgs.surfaceOptions),
      control: {
        type: 'select',
        labels: storyArgs.surfaceOptions,
      },
    },
    colorRamp: {
      options: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
      control: {
        type: 'select',
        labels: {
          '0': 'rainbow',
          '1': 'jet',
          '2': 'portland',
          '3': 'earth',
          '4': 'plasma',
          '5': 'salinity',
          '6': 'seismic',
          '7': 'seismic2',
          '8': 'spectrum',
          '9': 'gray',
        }
      }
    },
    color: {
      control: {
        type: 'color',
      }
    },
    opacity: {
      control: {
        type: 'range',
        min: 0,
        max: 1,
        step: 0.01,
      }
    },
    maxError: {
      control: {
        type: 'range',
        min: 0.1,
        max: 10,
        step: 0.01,
      }
    },
    contoursInterval: {
      options: [1, 2, 5, 10, 25, 50, 100, 250, 500],
      control: {
        type: 'select'
      }
    },
    contoursColorMode: {
      options: [0, 1, 2],
      control: {
        type: 'radio',
        labels: { '0': 'darken', '1': 'lighten', '2': 'mixed' },
      },
    },
    contoursThickness: {
      control: {
        type: 'range',
        min: 0.5,
        max: 5,
        step: 0.1,
      }
    },
    contoursColor: {
      control: {
        type: 'color',
      }
    },
    normalMap: {
      control: {
        disable: true
      }
    },
    rampMin: {
      control: {
        type: 'range',
        min: -100,
        max: 100,
        step: 1,
      }
    },
    rampMax: {
      control: {
        type: 'range',
        min: -100,
        max: 100,
        step: 1,
      }
    }
  },
  decorators: [
    Canvas3dDecorator,
    GeneratorsProviderDecorator,
    DataProviderDecorator,
  ],
  parameters: {
    autoClear: true,
    scale: 1000,
    cameraPosition: [-10000, 10000, 5000]
  },
  render: (args) => (
    <SurfaceStory {...args} />
  )
}
