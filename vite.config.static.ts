import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import glsl from 'vite-plugin-glsl';

export default defineConfig({
  plugins: [react(), glsl()],
  worker: {
    format: 'es',
    rollupOptions: {
      treeshake: 'smallest',
    },
    plugins: () => [glsl()],
  },
});
