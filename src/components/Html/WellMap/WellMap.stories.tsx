import type { Meta, StoryObj } from '@storybook/react'
import { DataProviderDecorator } from '../../../storybook/decorators/data-provider-decorator'
import { WellMap } from './WellMap'
import { ComponentProps, useMemo, useState } from 'react'
import { WellMapTvd } from './addons/WellMapTvd'
import { WellMapCompletionIntervals } from './addons/WellMapCompletionIntervals'
import { scaleOrdinal } from 'd3-scale'
import { WellMapFormations } from './addons/WellMapFormations'
import { WellMapCasingShoes } from './addons/WellMapCasingShoes'
import storyArgs from '../../../storybook/story-args.json'


const meta = {
  title: 'Components/Html/WellMap',
  component: WellMap,
  args: {
    wellIdentifier: storyArgs.defaultWell
  },
  decorators: [
    (Story, { args }: any) => {
      const [depth, setDepth] = useState<number>(1)
      const [selected, setSelected] = useState<string | undefined>()

      return (
      <div style={{
        padding: '10px',
        boxSizing: 'border-box',
        minHeight: '1000px',
        height: '100%',
        width: '100%',
        maxWidth: '600px',
        display: 'inline-flex',
        flexDirection: 'column',
        flexWrap: 'wrap',
        color: 'white',
        background: '#333',
      }}>
        <Story args={{ ...args, depth, onDepthChanged: setDepth, selected, onSelect: setSelected }} />
      </div>
    )},
    DataProviderDecorator,
  ]
} satisfies Meta<typeof WellMap>

export default meta
type Story = StoryObj<typeof meta>

const colorScale = scaleOrdinal(["#4e79a7", "#f28e2c", "#76b7b2", "#59a14f", "#edc949", "#af7aa1", "#ff9da7", "#9c755f", "#bab0ab", "darkgreen", "purple", "#24ca85"])

export const Default: Story = {
  tags: ['autodocs'],

  render: (args: ComponentProps<typeof WellMap>) => {
    return (
      <WellMap {...args} colors={w => colorScale(w.id)} />
    )
  }
}

export const WithCasingAndCompletionIntervals: Story = {
  render: (args: ComponentProps<typeof WellMap>) => {
    return (
      <WellMap {...args} colors={w => colorScale(w.id)}>
        <WellMapCompletionIntervals />
        <WellMapCasingShoes />
      </WellMap>
    )
  }
}

export const WithAllAddons: Story = {
  render: (args: ComponentProps<typeof WellMap>) => {
    const formations = useMemo(() => ['NORDLAND GP.', 'HORDALAND GP.', 'ROGALAND GP.', 'SHETLAND GP.', 'CROMER KNOLL GP.', 'VIKING GP.'], [])
    return (
      <WellMap {...args} colors={w => colorScale(w.id)}>
        <WellMapFormations formations={formations} />
        <WellMapCompletionIntervals />
        <WellMapCasingShoes />
        <WellMapTvd />
      </WellMap>
    )
  }
}

export const NonInteractive: Story = {
  tags: ['autodocs'],

  render: (args: ComponentProps<typeof WellMap>) => {
    return (
      <WellMap {...args} colors={w => colorScale(w.id)} interactive={false}>
        <WellMapCompletionIntervals />
        <WellMapCasingShoes />
      </WellMap>
    )
  }
}

export const Headless: Story = {
  tags: ['autodocs'],

  render: (args: ComponentProps<typeof WellMap>) => {
    return (
      <WellMap {...args} colors={w => colorScale(w.id)} headless depthCursor={false}>
        <WellMapCompletionIntervals />
        <WellMapCasingShoes />
      </WellMap>
    )
  }
}


