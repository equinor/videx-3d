import type { Decorator, Meta, StoryObj } from '@storybook/react-vite';
import { scaleOrdinal } from 'd3-scale';
import { ComponentProps, CSSProperties, useState } from 'react';
import { DataProviderDecorator } from '../../../storybook/decorators/data-provider-decorator';
import storyArgs from '../../../storybook/story-args.json';
import { WellMapCasingShoes } from './addons/WellMapCasingShoes';
import { WellMapCompletionIntervals } from './addons/WellMapCompletionIntervals';
import { WellMapFormations } from './addons/WellMapFormations';
import { WellMapTvd } from './addons/WellMapTvd';
import { LightTheme } from './themes';
import { WellMap } from './WellMap';

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
};

const darkThemeDecorator: Decorator = (Story: any, { args }: any) => {
  const [depth, setDepth] = useState<number>(1);
  const [selected, setSelected] = useState<string | undefined>();

  return (
    <div
      style={{
        ...commonStyles,
        background: '#333',
      }}
    >
      <Story
        args={{
          ...args,
          depth,
          onDepthChanged: setDepth,
          selected,
          onSelect: setSelected,
        }}
      />
    </div>
  );
};

const lightThemeDecorator: Decorator = (Story: any, { args }: any) => {
  const [depth, setDepth] = useState<number>(1);
  const [selected, setSelected] = useState<string | undefined>();

  return (
    <div
      style={{
        ...commonStyles,
        background: '#fff',
      }}
    >
      <Story
        args={{
          ...args,
          depth,
          onDepthChanged: setDepth,
          selected,
          onSelect: setSelected,
        }}
      />
    </div>
  );
};

const meta = {
  title: 'Components/Html/WellMap',
  component: WellMap,
  args: {
    wellIdentifier: storyArgs.defaultWell,
  },
  tags: ['autodocs'],
  decorators: [DataProviderDecorator],
} satisfies Meta<typeof WellMap>;

export default meta;
type Story = StoryObj<typeof meta>;

const colorScale = scaleOrdinal([
  '#4e79a7',
  '#f28e2c',
  '#76b7b2',
  '#59a14f',
  '#edc949',
  '#af7aa1',
  '#ff9da7',
  '#9c755f',
  '#bab0ab',
  'darkgreen',
  'purple',
  '#24ca85',
]);

/**
 * The wellbores of the demo field's default well (`wellIdentifier`), a colour each from
 * `colors`, with a header over the depth axis (`axisHeader`; hover it for its description).
 * Click a wellbore to select it, and drag the depth cursor on the left, or focus it and use the
 * arrow keys, to move the depth.
 */
export const Default: Story = {
  // HTML and SVG, no WebGL: shown live on the Docs page.
  tags: ['docs-preview'],
  decorators: [darkThemeDecorator],
  render: (args: ComponentProps<typeof WellMap>) => {
    return (
      <WellMap
        {...args}
        colors={w => colorScale(w.id)}
        axisHeader={{ label: 'KOP', description: 'Kickoff Point' }}
      />
    );
  },
};

/**
 * Two addons along the tracks: `WellMapCompletionIntervals` draws the screens (grey) and the
 * open perforations (orange), `WellMapCasingShoes` marks the casing shoes.
 */
export const WithCasingAndCompletionIntervals: Story = {
  decorators: [darkThemeDecorator],
  render: (args: ComponentProps<typeof WellMap>) => {
    return (
      <WellMap {...args} colors={w => colorScale(w.id)}>
        <WellMapCompletionIntervals />
        <WellMapCasingShoes />
      </WellMap>
    );
  },
};

/**
 * The formations each wellbore passes through, from the demo field's stratigraphic column
 * (`WellMapFormations`; hover one for its name), and along the bottom each wellbore's true
 * vertical depth below mean sea level at the cursor's depth (`WellMapTvd`). Drag the depth
 * cursor to see the depths change.
 */
export const WithFormationsAndTvdDepths: Story = {
  decorators: [darkThemeDecorator],
  render: (args: ComponentProps<typeof WellMap>) => {
    return (
      <WellMap {...args} colors={w => colorScale(w.id)}>
        <WellMapFormations stratColumnId={storyArgs.defaultStratColumn} />
        <WellMapTvd />
      </WellMap>
    );
  },
};

/**
 * For display only (`interactive={false}`): no selection, no depth cursor or readout, and every
 * track drawn at full strength, here with the completion intervals and casing shoes.
 */
export const NonInteractive: Story = {
  decorators: [darkThemeDecorator],
  render: (args: ComponentProps<typeof WellMap>) => {
    return (
      <WellMap {...args} colors={w => colorScale(w.id)} interactive={false}>
        <WellMapCompletionIntervals />
        <WellMapCasingShoes />
      </WellMap>
    );
  },
};

/**
 * No header (`headless`: the title, the well's name and the depth readout) and no depth
 * cursor (`depthCursor={false}`), for a host that shows these itself. Clicking a wellbore still
 * selects it.
 */
export const Headless: Story = {
  decorators: [darkThemeDecorator],
  render: (args: ComponentProps<typeof WellMap>) => {
    return (
      <WellMap
        {...args}
        colors={w => colorScale(w.id)}
        headless
        depthCursor={false}
      >
        <WellMapCompletionIntervals />
        <WellMapCasingShoes />
      </WellMap>
    );
  },
};

/**
 * The `LightTheme` on a white page (`theme`), with the formations, the casing shoes in black
 * and the axis header.
 */
export const LightThemed: Story = {
  args: {
    theme: LightTheme,
    axisHeader: { label: 'KOP', description: 'Kickoff Point' },
  },
  decorators: [lightThemeDecorator],
  render: (args: ComponentProps<typeof WellMap>) => {
    return (
      <WellMap {...args} colors={w => colorScale(w.id)}>
        <WellMapFormations stratColumnId={storyArgs.defaultStratColumn} />
        <WellMapCasingShoes color="black" />
      </WellMap>
    );
  },
};
