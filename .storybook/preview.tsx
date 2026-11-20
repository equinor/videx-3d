import type { Preview } from '@storybook/react-vite';
import { guardReactRefresh } from '../src/storybook/debug/react-refresh-guard';
import { storyStoreLoader } from '../src/storybook/dependencies/story-store';

if (import.meta.env.DEV) guardReactRefresh();

const preview: Preview = {
  // The data store's init step: what it holds for each story (`parameters.store`).
  loaders: [storyStoreLoader],
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
