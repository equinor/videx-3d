import glsl from 'vite-plugin-glsl';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // The OIT material utility imports a `.glsl` shader chunk; register the same
  // plugin used by the app build so those imports resolve under Vitest too.
  plugins: [glsl()],
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      reporter: ['text', 'json', 'html'],
      include: ['src'],
      exclude: ['src/storybook', '**/*.tsx'],
    },
  },
});
