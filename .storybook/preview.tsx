import type { Preview } from '@storybook/react-vite';
import { guardReactRefresh } from '../src/storybook/debug/react-refresh-guard';

if (import.meta.env.DEV) guardReactRefresh();

const preview: Preview = {
  parameters: {
    docs: {
      story: {
        height: '600px',
      },
    },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
  },
  tags: ['autodocs'],
};

export default preview;
