import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'plugin-manager',
  base: './',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: '../assets/plugin-manager',
    emptyOutDir: true,
  },
});
