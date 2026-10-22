import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: '.',
  build: {
    outDir:       'dist',
    emptyOutDir:  true,
    target:       'es2022',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
      },
    },
  },
  resolve: {
    alias: {
      '../../shared/protocol-browser.js': resolve(__dirname, '../shared/protocol-browser.js'),
    },
  },
  server: {
    port: 5173,
    host: true,
  },
  optimizeDeps: {
    exclude: ['opusscript'],  // native WASM, handle separately
  },
});
