import { useEffect, useState } from 'react'
import { APP } from '../../shared/meta'
import { usePalette } from '../state/palette'
import { LANGS, LANG_NAMES, isLang } from '../../shared/i18n'
import { lang, setLang, t } from '../i18n'
import { useOnline } from '../runtime/presence'
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
  const online = useOnline()
  const openSearch = usePalette((s) => s.setOpen)

  return (
    <header className="pointer-events-auto absolute inset-x-0 top-0 z-20 flex h-10 items-center gap-3 border-b border-line bg-ink-900/90 px-3 font-mono text-[11px] tracking-[0.14em] text-fg-dim uppercase backdrop-blur-md">
      <span className="grid h-3 w-6 shrink-0 grid-rows-[2fr_1fr_2fr]" aria-hidden="true">
        <i className="bg-carmine" />
        <i className="bg-white" />
        <i className="bg-carmine" />
      </span>
      <h1 className="font-semibold tracking-[0.3em] whitespace-nowrap text-fg-strong">{APP.codename}</h1>
      <span className="hidden whitespace-nowrap text-fg-mute lg:inline">{t('Latvia // Intelligence Panel')}</span>
      <span className="hidden border border-ok/40 px-1.5 py-px text-[9px] tracking-[0.2em] text-ok xl:inline">
        {t('Public sources only')}
      </span>

      <button
        type="button"
        onClick={() => openSearch(true)}
        title={t('Search places, callsigns, trains, satellites and layers')}
        className="ml-2 flex items-center gap-2 border border-line px-2 py-0.5 text-[10px] tracking-[0.16em] text-fg-mute transition-colors hover:border-line-strong hover:text-fg max-sm:hidden"
      >
        {t('Search')}
        <kbd className="font-mono text-[9px] text-fg-mute">Ctrl K</kbd>
      </button>

      <div className="ml-auto flex items-center gap-4">
        <select
          aria-label={t('Language')}
          title={t('Language')}
          value={lang}
          onChange={(event) => isLang(event.target.value) && setLang(event.target.value)}
          className="cursor-pointer border border-line bg-ink-900 px-1 py-0.5 text-[10px] tracking-[0.12em] text-fg-dim uppercase hover:border-line-strong hover:text-fg"
        >
          {LANGS.map((code) => (
            <option key={code} value={code} title={LANG_NAMES[code]}>
              {code}
            </option>
          ))}
        </select>
        <Clock />
        {online !== null && (
          <span className="hidden whitespace-nowrap tabular-nums sm:inline" title={t('Visitors on the site right now')}>
            {t('{n} online', { n: online })}
          </span>
        )}
        <span
          className="flex items-center gap-1.5"
          title={uplink.state === 'up' ? t('Server build {commit}', { commit: uplink.commit }) : undefined}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              uplink.state === 'up' ? 'bg-ok' : uplink.state === 'down' ? 'bg-danger' : 'animate-pulse bg-warn'
            }`}
          />
          <span className="hidden sm:inline">
            {uplink.state === 'up' ? t('Uplink') : uplink.state === 'down' ? t('Uplink down') : t('Linking')}
          </span>
        </span>
      </div>
    </header>
  )
}
