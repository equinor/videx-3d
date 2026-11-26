import type { StorybookConfig } from '@storybook/react-vite';
import { fileURLToPath } from 'node:url';
import { addons } from 'storybook/manager-api';
import { mergeConfig } from 'vite';

// Never imported by a story: coverage reports, raw data imports, probes and build output.
const root = fileURLToPath(new URL('..', import.meta.url)).replace(/\\/g, '/');
const unwatched = ['coverage', 'import', 'private', 'static'].map(
  dir => `${root}${dir}/**`,
);

// Debug stories (benches, harnesses: any `debug/` folder) and experiments (any `experiments/`
// folder) are for development: `npm run storybook` lists them, the published build does not.
const isBuild = process.argv.includes('build');

const config: StorybookConfig = {
  stories: isBuild
    ? ['../src/**/!(debug|experiments)/*.stories.@(js|jsx|mjs|ts|tsx)']
    : ['../src/**/*.stories.@(js|jsx|mjs|ts|tsx)'],
  addons: ['@chromatic-com/storybook', '@storybook/addon-docs'],

  framework: {
    name: '@storybook/react-vite',
    options: {
      builder: {
        viteConfigPath: 'vite.config.static.ts',
      },
    },
  },

  // Storybook replaces the Vite config file's `server` block, so the watcher is set here.
  viteFinal: config =>
    mergeConfig(config, { server: { watch: { ignored: unwatched } } }),

  docs: {},

  typescript: {
    reactDocgen: 'react-docgen-typescript',
    reactDocgenTypescriptOptions: {
      tsconfigPath: './tsconfig.json',
      exclude: ['**/*.stories.tsx', '.storybook/**'],
    },
  },
};

addons.setConfig({
  enableShortcuts: false,
});

export default config;
