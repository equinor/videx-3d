import glsl from 'vite-plugin-glsl';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // The OIT material utility imports a `.glsl` shader chunk; register the same
  // plugin used by the app build so those imports resolve under Vitest too.
  plugins: [glsl()],
  test: {
    globals: true,
    environment: 'node',
    reporter: ['default', 'junit'],
    outputFile: {
      junit: 'test-results/junit.xml',
    },
    coverage: {
      provider: 'v8',
      reporter: [['cobertura', { file: 'Cobertura.xml' }]],
      reportsDirectory: 'coverage',
      include: ['src'],
      exclude: ['src/storybook', '**/*.tsx'],
    },
  },
});
