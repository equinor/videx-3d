import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import dts from 'unplugin-dts/vite';
import { defineConfig } from 'vite';
import cssInjectedByJsPlugin from 'vite-plugin-css-injected-by-js';
import { externalizeDeps } from 'vite-plugin-externalize-deps';
import glsl from 'vite-plugin-glsl';
import { viteStaticCopy } from 'vite-plugin-static-copy';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    externalizeDeps(),
    react(),
    glsl(),
    cssInjectedByJsPlugin({
      jsAssetsFilterFunction: chunk => chunk.name === 'main',
    }),
    dts({
      outDirs: ['dist/types'],
      exclude: ['**/*.stories.tsx', 'src/storybook', 'tests'],
    }),
    viteStaticCopy({
      targets: [
        {
          src: 'public/normal_map.jpg',
          dest: './textures',
        },
        {
          src: 'src/sdk/materials/shaderLib',
          dest: '.',
        },
      ],
    }),
  ],
  build: {
    lib: {
      entry: {
        main: resolve(__dirname, 'src/main.ts'),
        sdk: resolve(__dirname, 'src/sdk'),
        generators: resolve(__dirname, 'src/generators'),
      },
      formats: ['es'],
    },
    emptyOutDir: true,
    copyPublicDir: false,
    rollupOptions: {
      output: {
        chunkFileNames: 'chunk-[hash].js',
      },
      treeshake: 'recommended',
    },
  },
});
