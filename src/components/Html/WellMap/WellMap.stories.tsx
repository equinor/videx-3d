import type { Decorator, Meta, StoryObj } from '@storybook/react'
import { scaleOrdinal } from 'd3-scale'
import { ComponentProps, CSSProperties, useMemo, useState } from 'react'
import { DataProviderDecorator } from '../../../storybook/decorators/data-provider-decorator'
import storyArgs from '../../../storybook/story-args.json'
import { WellMapCasingShoes } from './addons/WellMapCasingShoes'
import { WellMapCompletionIntervals } from './addons/WellMapCompletionIntervals'
import { WellMapFormations } from './addons/WellMapFormations'
import { WellMapTvd } from './addons/WellMapTvd'
import { LightTheme } from './themes'
import { WellMap } from './WellMap'

const commonStyles: CSSProperties = {
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
}

const darkThemeDecorator: Decorator = (Story: any, { args }: any) => {
  const [depth, setDepth] = useState<number>(1)
  const [selected, setSelected] = useState<string | undefined>()

  return (
    <div style={{
      ...commonStyles,
      background: '#333',
    }}>
      <Story args={{ ...args, depth, onDepthChanged: setDepth, selected, onSelect: setSelected }} />
    </div>
  )
}

const lightThemeDecorator: Decorator = (Story: any, { args }: any) => {
  const [depth, setDepth] = useState<number>(1)
  const [selected, setSelected] = useState<string | undefined>()

  return (
    <div style={{
      ...commonStyles,
      background: '#fff',
    }}>
      <Story args={{ ...args, depth, onDepthChanged: setDepth, selected, onSelect: setSelected }} />
    </div>
  )
}

const meta = {
  title: 'Components/Html/WellMap',
  component: WellMap,
  args: {
    wellIdentifier: storyArgs.defaultWell,
  },
  tags: ['autodocs'],
  decorators: [
    DataProviderDecorator,
  ]
} satisfies Meta<typeof WellMap>

export default meta
type Story = StoryObj<typeof meta>

const colorScale = scaleOrdinal(["#4e79a7", "#f28e2c", "#76b7b2", "#59a14f", "#edc949", "#af7aa1", "#ff9da7", "#9c755f", "#bab0ab", "darkgreen", "purple", "#24ca85"])

export const Default: Story = {
  decorators: [darkThemeDecorator],
  render: (args: ComponentProps<typeof WellMap>) => {
    return (
      <WellMap {...args} colors={w => colorScale(w.id)} />
    )
  }
}

export const WithCasingAndCompletionIntervals: Story = {
  decorators: [darkThemeDecorator],
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
  decorators: [darkThemeDecorator],
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
  decorators: [darkThemeDecorator],
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
  decorators: [darkThemeDecorator],
  render: (args: ComponentProps<typeof WellMap>) => {
    return (
      <WellMap {...args} colors={w => colorScale(w.id)} headless depthCursor={false}>
        <WellMapCompletionIntervals />
        <WellMapCasingShoes />
      </WellMap>
    )
  }
}

export const LightThemed: Story = {
  args: {
    theme: LightTheme
  },
  decorators: [lightThemeDecorator],
  render: (args: ComponentProps<typeof WellMap>) => {
    return (
      <WellMap {...args} colors={w => colorScale(w.id)} />
    )
  }
}

