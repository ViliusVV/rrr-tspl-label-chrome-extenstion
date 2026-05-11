import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'popup.html'),
        connect: resolve(__dirname, 'connect.html'),
      },
    },
  },
  test: {
    environment: 'happy-dom',
    globals: true,
  },
});
