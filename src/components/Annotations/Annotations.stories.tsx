import type { Meta, StoryObj } from '@storybook/react-vite';
import { ComponentProps, useEffect } from 'react';
import { Canvas3dDecorator } from '../../storybook/decorators/canvas-3d-decorator';
import { Annotations } from './Annotations';
import { useAnnotations } from './annotations-state';
import { AnnotationsLayer } from './AnnotationsLayer';
import { AnnotationProps } from './types';

const count = 1000;
const annotations = new Array<AnnotationProps>(count);
for (let i = 0; i < annotations.length; i++) {
  annotations[i] = {
    id: i.toString(),
    name: 'Annotation #' + i,
    position: [
      (Math.random() - 0.5) * 100,
      (Math.random() - 0.5) * 100,
      (Math.random() - 0.5) * 100,
    ],
  };
}

const meta = {
  title: 'Components/Misc/Annotations',
  component: Annotations,
} satisfies Meta<typeof Annotations>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    maxVisible: count,
  },
  render: (args: ComponentProps<typeof Annotations>) => {
    const { addAnnotations } = useAnnotations('layer1', 'scope1');

    useEffect(() => addAnnotations(annotations), [addAnnotations]);
    return (
      <Annotations {...args}>
        <AnnotationsLayer
          id="layer1"
          name="Test"
          anchorSize={2}
          labelOffset={15}
          //labelComponent={({ name }) => (<div style={{ color: 'lime'}}>{name}</div>)}
        />
      </Annotations>
    );
  },
  decorators: [Canvas3dDecorator],
};
