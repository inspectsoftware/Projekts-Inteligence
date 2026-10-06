import { defineConfig } from 'vite'

// Server build: bundles server/ and shared/ into dist/server/index.js, the entry
// file Hostinger runs. Packages stay external and resolve from node_modules.
export default defineConfig({
  publicDir: false,
  build: {
    ssr: 'server/index.ts',
    outDir: 'dist/server',
    emptyOutDir: true,
    target: 'node22',
    minify: false,
    rolldownOptions: {
      output: { entryFileNames: 'index.js' },
    },
  },
})
