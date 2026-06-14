import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: 'hook/pluginManager.ts',
      name: 'SidraPluginManager',
      formats: ['iife'],
      fileName: () => 'pluginManager.js',
    },
    outDir: 'assets',
    emptyOutDir: false,
    minify: false,
  },
});
