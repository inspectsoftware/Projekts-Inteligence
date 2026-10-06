import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    server: {
      deps: {
        // Published as CommonJS for Node but as ES modules for bundlers; use the same build the client gets.
        inline: ['mgrs'],
      },
    },
  },
})
