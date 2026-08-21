import type { Meta, StoryObj } from '@storybook/react-vite';
import { BoxGeometry, Color, Matrix4, MeshStandardMaterial } from 'three';
import { SymbolsType } from '../../sdk/data/types/Symbol';
import { Canvas3dDecorator } from '../../storybook/decorators/canvas-3d-decorator';
import { Symbols } from './Symbol';

const count = 20;

const transformations = new Float32Array(count * 16);
const colors = new Float32Array(count * 3);

const matrix = new Matrix4();
const color = new Color();

for (let i = 0; i < count; i++) {
  const x = (i - count / 2) * 3;
  matrix.makeTranslation(x, 0, 0);
  matrix.toArray(transformations, i * 16);

  color.setHSL(i / count, 0.8, 0.5);
  colors[i * 3] = color.r;
  colors[i * 3 + 1] = color.g;
  colors[i * 3 + 2] = color.b;
}

const data: SymbolsType = { transformations, colors };

const geometry = new BoxGeometry(1, 16, 16);
const material = new MeshStandardMaterial();

const meta = {
  title: 'Components/Misc/Symbols',
  component: Symbols,
} satisfies Meta<typeof Symbols>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    data,
    geometry,
    material,
  },
  decorators: [Canvas3dDecorator],
};
