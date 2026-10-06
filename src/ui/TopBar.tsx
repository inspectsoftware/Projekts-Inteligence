import { useEffect, useState } from 'react'
import { APP } from '../../shared/meta'
import { usePalette } from '../state/palette'
import { Clock } from './Clock'

type Uplink = { state: 'connecting' } | { state: 'up'; commit: string } | { state: 'down' }

function useUplink(): Uplink {
  const [uplink, setUplink] = useState<Uplink>({ state: 'connecting' })

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/health', { signal: controller.signal })
      .then((res) => (res.ok ? (res.json() as Promise<{ commit: string }>) : Promise.reject(new Error(String(res.status)))))
      .then((health) => setUplink({ state: 'up', commit: health.commit }))
      .catch(() => {
        if (!controller.signal.aborted) setUplink({ state: 'down' })
      })
    return () => controller.abort()
  }, [])

  return uplink
}

export function TopBar() {
  const uplink = useUplink()
  const openSearch = usePalette((s) => s.setOpen)

  return (
    <header className="pointer-events-auto absolute inset-x-0 top-0 z-20 flex h-10 items-center gap-3 border-b border-line bg-ink-900/90 px-3 font-mono text-[11px] tracking-[0.14em] text-fg-dim uppercase backdrop-blur-md">
      <span className="grid h-3 w-6 shrink-0 grid-rows-[2fr_1fr_2fr]" aria-hidden="true">
        <i className="bg-carmine" />
        <i className="bg-white" />
        <i className="bg-carmine" />
      </span>
      <h1 className="font-semibold tracking-[0.3em] whitespace-nowrap text-white">{APP.codename}</h1>
      <span className="hidden text-fg-mute md:inline">Latvia // OSINT</span>
      <span className="hidden border border-ok/40 px-1.5 py-px text-[9px] tracking-[0.2em] text-ok xl:inline">
        Public sources only
      </span>

      <button
        type="button"
        onClick={() => openSearch(true)}
        title="Search places, callsigns, trains, satellites and layers"
        className="ml-2 flex items-center gap-2 border border-line px-2 py-0.5 text-[10px] tracking-[0.16em] text-fg-mute transition-colors hover:border-line-strong hover:text-fg max-sm:hidden"
      >
        Search
        <kbd className="font-mono text-[9px] text-fg-mute">Ctrl K</kbd>
      </button>

      <div className="ml-auto flex items-center gap-4">
        <Clock />
        <span
          className="flex items-center gap-1.5"
          title={uplink.state === 'up' ? `Server build ${uplink.commit}` : undefined}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              uplink.state === 'up' ? 'bg-ok' : uplink.state === 'down' ? 'bg-danger' : 'animate-pulse bg-warn'
            }`}
          />
          <span className="hidden sm:inline">
            {uplink.state === 'up' ? 'Uplink' : uplink.state === 'down' ? 'Uplink down' : 'Linking'}
          </span>
        </span>
      </div>
    </header>
  )
}
