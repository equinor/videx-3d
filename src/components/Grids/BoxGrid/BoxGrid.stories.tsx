import type { Meta, StoryObj } from '@storybook/react-vite';

import { useEffect, useMemo } from 'react';
import { WellboreSelectedEvent } from '../../../events/wellbore-events';
import { Canvas3dDecorator } from '../../../storybook/decorators/canvas-3d-decorator';
import { DataProviderDecorator } from '../../../storybook/decorators/data-provider-decorator';
import { DepthSelectorDecorator } from '../../../storybook/decorators/depth-selector-decorator';
import { GeneratorsProviderDecorator } from '../../../storybook/decorators/generators-provider-decorator';
import { useWellboreHeaders } from '../../../storybook/hooks/useWellboreHeaders';
import storyArgs from '../../../storybook/story-args.json';
import { BasicTrajectory } from '../../Wellbores/BasicTrajectory/BasicTrajectory';
import { Casings } from '../../Wellbores/Casings/Casings';
import { CompletionTools } from '../../Wellbores/CompletionTools/CompletionTools';
import { Wellbore } from '../../Wellbores/Wellbore/Wellbore';
import { BoxGrid } from './BoxGrid';

const wellboreId = storyArgs.defaultWellbore;

const meta = {
  title: 'Components/Grids/BoxGrid',
  component: BoxGrid,
  decorators: [
    //PerformanceDecorator,
    Canvas3dDecorator,
    GeneratorsProviderDecorator,
    DepthSelectorDecorator,
    DataProviderDecorator,
  ],
  parameters: {
    scale: 100,
    cameraPosition: [150, 2000, 1500],
    cameraTarget: [0, 0, 0],
    autoClear: true,
  },
  render: args => {
    const wellbores = useWellboreHeaders();
    const wellbore = useMemo(
      () => wellbores.find(d => d.id === wellboreId),
      [wellbores],
    );

    useEffect(() => {
      if (wellbore) {
        dispatchEvent(new WellboreSelectedEvent({ id: wellbore.id }));
      }
    }, [wellbore]);

    if (!wellbore) return <>No wellbore found!</>;

    return (
      <group>
        <group position={[50, 100, -50]}>
          <BoxGrid {...args} projectionRefreshRate={1000}>
            <Wellbore id={wellbore.id}>
              <BasicTrajectory />
              <Casings shoeFactor={1.5} opacity={0.5} sizeMultiplier={20} />
              <CompletionTools sizeMultiplier={20} />
            </Wellbore>
          </BoxGrid>
        </group>
        <axesHelper args={[100]} />
      </group>
    );
  },
} satisfies Meta<typeof BoxGrid>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    size: [0, 0, 0],
    gridOrigin: [0, 0, 0],
    cellSize: 250,
    enableProjection: true,
    projectionColor: '#abc',
    showRulers: true,
    autoSize: true,
    autoSizePadding: {
      x0: 1000,
      x1: 1000,
      z0: 1000,
      z1: 1000,
      y0: 500,
      y1: 0,
    },
    autoSizeUpdateRate: 100,
  },
  tags: ['autodocs'],
};

export const Light: Story = {
  args: {
    size: [0, 0, 0],
    gridOrigin: [0, 0, 0],
    cellSize: 250,
    gridColorMajor: '#ddd',
    gridColorMinor: '#eee',
    background: '#fff',
    axesColor: '#555',
    enableProjection: true,
    projectionColor: '#ddd',
    showRulers: false,
    autoSize: true,
    autoSizePadding: {
      x0: 1000,
      x1: 1000,
      z0: 1000,
      z1: 1000,
      y0: 500,
      y1: 0,
    },
    autoSizeUpdateRate: 100,
  },
  parameters: {
    scale: 100,
    cameraPosition: [150, 2000, 1500],
    cameraTarget: [0, 0, 0],
    autoClear: true,
    background: '#eee',
  },
  tags: ['autodocs'],
};
