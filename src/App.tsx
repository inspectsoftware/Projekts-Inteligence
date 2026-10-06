import { useEffect, useState } from 'react'
import { APP } from '../shared/meta'

interface Health {
  commit: string
  node: string
  uptimeS: number
}

type Link = { state: 'connecting' } | { state: 'up'; health: Health } | { state: 'down' }

export default function App() {
  const [link, setLink] = useState<Link>({ state: 'connecting' })

  useEffect(() => {
    const boot = document.getElementById('boot')
    boot?.classList.add('done')
    const timer = setTimeout(() => boot?.remove(), 700)
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/health', { signal: controller.signal })
      .then((res) => (res.ok ? (res.json() as Promise<Health>) : Promise.reject(new Error(String(res.status)))))
      .then((health) => setLink({ state: 'up', health }))
      .catch(() => {
        if (!controller.signal.aborted) setLink({ state: 'down' })
      })
    return () => controller.abort()
  }, [])

  return (
    <div className="flex h-full flex-col font-mono text-[11px] tracking-[0.14em] text-fg-dim uppercase">
      <header className="flex items-center gap-3 border-b border-line bg-ink-900 px-4 py-2">
        <span className="grid h-3 w-6 grid-rows-[2fr_1fr_2fr]" aria-hidden="true">
          <i className="bg-carmine" />
          <i className="bg-white" />
          <i className="bg-carmine" />
        </span>
        <span className="font-semibold tracking-[0.3em] text-white">{APP.codename}</span>
        <span className="text-fg-mute">{APP.tagline}</span>
        <span className="ml-auto">
          {link.state === 'up' && <span className="text-ok">uplink ok // {link.health.commit}</span>}
          {link.state === 'connecting' && <span>uplink ...</span>}
          {link.state === 'down' && <span className="text-danger">uplink down</span>}
        </span>
      </header>
      <main className="grid flex-1 place-items-center">
        <p className="text-fg-mute">map subsystem offline // coming online in M1</p>
      </main>
    </div>
  )
}
