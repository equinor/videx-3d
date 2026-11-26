import type { Preview } from '@storybook/react-vite';
import { guardReactRefresh } from '../src/storybook/debug/react-refresh-guard';
import { chainedControlsDecorator } from '../src/storybook/decorators/chained-controls-decorator';
import { storyStoreLoader } from '../src/storybook/dependencies/story-store';
import { DocsPage } from '../src/storybook/docs/docs-page';

if (import.meta.env.DEV) guardReactRefresh();

const preview: Preview = {
  // The data store's init step: what it holds for each story (`parameters.store`).
  loaders: [storyStoreLoader],
  // A control hidden by its condition hides the controls that hang on it, too.
  decorators: [chainedControlsDecorator],
  parameters: {
    docs: {
      // Written docs and props, no story rendered unless it opts in (`docs-preview`).
      page: DocsPage,
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
    // The sidebar's sections; within them, the stories as they are found. The examples first,
    // the lightest of them opening Storybook; Debug and Experiments (dev only) last.
    options: {
      storySort: {
        order: [
          'Examples',
          ['Getting Started', '*'],
          'Components',
          'SDK',
          'Debug',
          'Experiments',
        ],
      },
    },
  },
  tags: ['autodocs'],
};

export default preview;
