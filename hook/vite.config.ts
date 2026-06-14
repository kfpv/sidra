import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: 'hook/musicKitHook.ts',
      name: 'SidraMusicKitHook',
      formats: ['iife'],
      fileName: () => 'musicKitHook.js',
    },
    outDir: 'assets',
    emptyOutDir: false,
    minify: false,
  },
});
