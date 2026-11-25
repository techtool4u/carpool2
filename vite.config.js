import { defineConfig } from 'vite';

// base './' makes the same build work on GitHub Pages (/carpool2/) and inside the Android app.
export default defineConfig({
  base: './',
  build: { outDir: 'dist', assetsInlineLimit: 0 }
});
