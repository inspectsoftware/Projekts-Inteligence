import { serve } from '@hono/node-server'
import { createApp } from './app'

// Hostinger starts this process on demand and stops it when traffic goes quiet,
// so start-up has to be quick: listen first, load everything else lazily.
const port = Number(process.env.PORT) || 8787

const server = serve({ fetch: createApp().fetch, port, hostname: '0.0.0.0' }, (info) => {
  console.log(`[pwh] listening on :${info.port} (node ${process.version})`)
})

// A rejected background refresh must never take the process (and its caches) down.
process.on('unhandledRejection', (reason) => {
  console.error('[pwh] unhandled rejection:', reason)
})

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 3000).unref()
  })
}
