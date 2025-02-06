import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { defineConfig } from 'vite'
import cssInjectedByJsPlugin from "vite-plugin-css-injected-by-js"
import dts from 'vite-plugin-dts'
import glsl from 'vite-plugin-glsl'
import { viteStaticCopy } from 'vite-plugin-static-copy'
import pkg from './package.json' with { type: 'json' }


const externalDependencies = Object.keys({
  ...pkg.peerDependencies,
  ...pkg.dependencies,
})

// https://vitejs.dev/config/
export default defineConfig({
  css: {
    preprocessorOptions: {
      scss: {
        api: "modern-compiler"
      }
    }
  },
  plugins: [
    react(),
    glsl(),
    cssInjectedByJsPlugin({
      jsAssetsFilterFunction: chunk => chunk.name === 'main'
    }),
    dts({
      outDir: ['dist/types'],
      exclude: ['**/*.stories.tsx', 'src/storybook'],
    }),
    viteStaticCopy({
      targets: [
        {
          src: 'public/normal_map.jpg',
          dest: './textures'
        },
        {
          src: 'src/sdk/materials/shaderLib',
          dest: '.'
        },
      ]
    })
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
      external: ['@babel/runtime', 'react/jsx-runtime', ...externalDependencies],
      treeshake: 'recommended'
    },
  }
})
