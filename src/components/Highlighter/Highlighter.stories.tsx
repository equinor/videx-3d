import { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useRef } from 'react';
import { Mesh } from 'three';
import { LAYERS } from '../../main';
import { Canvas3dDecorator } from '../../storybook/decorators/canvas-3d-decorator';
import { Highlighter } from './Highlighter';
import { useHighlighter } from './highlight-state';

const meta = {
  title: 'Components/Misc/Highlighter',
  decorators: [Canvas3dDecorator],
  component: Highlighter,
} satisfies Meta<typeof Highlighter>;

type StoryArgs = React.ComponentProps<typeof Highlighter>;
export default meta;
type Story = StoryObj<StoryArgs>;

const boxRotation = Math.random();

type Props = {
  position?: [number, number, number];
  color?: string;
};
const HighlightBox = ({ position = [0, 0, 0], color = '#4f7b95' }: Props) => {
  const meshRef = useRef<Mesh>(null);
  const highlighter = useHighlighter();

  useEffect(() => {
    meshRef.current?.layers.enable(LAYERS.EMITTER);
  }, []);

  return (
    <mesh
      position={position}
      rotation-y={boxRotation}
      ref={meshRef}
      onPointerEnter={e => {
        highlighter.highlight(e.object);
      }}
      onPointerLeave={() => {
        highlighter.removeAll();
      }}
    >
      <boxGeometry />
      <meshStandardMaterial color={color} />
    </mesh>
  );
};

export const Default: Story = {
  args: {
    color: '#9797e3',
    blending: undefined,
    renderOrder: 1,
  },
  render: args => {
    return (
      <>
        <Highlighter {...args} />
        <mesh rotation-x={-Math.PI / 2}>
          <planeGeometry args={[50, 50]} />
          <meshBasicMaterial color="#050533" />
        </mesh>
        <HighlightBox position={[-6, 0.5, 2]} />
        <HighlightBox position={[-3, 0.5, 1]} />
        <HighlightBox position={[0, 0.5, 0]} />
        <HighlightBox position={[3, 0.5, 1]} />
        <HighlightBox position={[6, 0.5, 2]} />
      </>
    );
  },
  parameters: {
    autoClear: true,
    scale: 100,
    cameraPosition: [0, 10, 20],
  },
};
