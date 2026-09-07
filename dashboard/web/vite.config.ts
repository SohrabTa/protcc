import { defineConfig } from 'vite';

// The data tree is not copied into the build. It is 6.5 GB at full size, and the
// site loads it by relative path, so a deployment drops `data/` next to index.html.
// In development Vite serves it from the repo through the alias below.
export default defineConfig({
  base: './',
  publicDir: false,
  server: {
    fs: { allow: ['..', '../..'] },
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    target: 'es2022',
  },
});
