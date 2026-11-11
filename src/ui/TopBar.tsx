import { useEffect, useState } from 'react'
import { APP } from '../../shared/meta'
import { usePalette } from '../state/palette'
import { LANGS, LANG_NAMES, isLang } from '../../shared/i18n'
import { lang, setLang, t } from '../i18n'
import { useOnline } from '../runtime/presence'
import { THEMES, useTheme, useUi } from '../state/ui'
import { Clock } from './Clock'
import { FLOAT_SHADOW } from './NavBar'

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

function LanguageSelect({ className }: { className: string }) {
  return (
    <select
      aria-label={t('Language')}
      title={t('Language')}
      value={lang}
      onChange={(event) => isLang(event.target.value) && setLang(event.target.value)}
      className={`cursor-pointer uppercase ${className}`}
    >
      {LANGS.map((code) => (
        <option key={code} value={code} title={LANG_NAMES[code]}>
          {code}
        </option>
      ))}
    </select>
  )
}

const SUN = 'M8 10.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1'
const MOON = 'M13.5 9.5A5.5 5.5 0 016.5 2.5a5.5 5.5 0 107 7z'

/** One click between light and dark; "Auto" stays in the View window. */
function ThemeButton() {
  const theme = useTheme()
  const choice = useUi((s) => s.theme)
  const setTheme = useUi((s) => s.setTheme)
  const label = THEMES.find((option) => option.id === choice)?.label ?? ''
  return (
    <button
      type="button"
      title={`${t('Theme')}: ${label}`}
      aria-label={`${t('Theme')}: ${label}`}
      onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      className="grid h-9 w-9 place-items-center rounded-full text-fg-dim transition-colors hover:bg-ink-700 hover:text-fg-strong"
    >
      <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d={theme === 'dark' ? MOON : SUN} />
      </svg>
    </button>
  )
}

const FLOAT = `pointer-events-auto absolute top-2 z-20 flex h-11 items-center rounded-full border border-line bg-ink-900 p-1 ${FLOAT_SHADOW}`

/**
 * The corners of a wide screen's top edge, either side of the NavBar: on the left the name and
 * search, on the right the language, the theme and whether the server answers (the time and the
 * visitor count too where there is room). Phones keep the full-width TopBar.
 */
export function DesktopBar() {
  const uplink = useUplink()
  const online = useOnline()
  const openSearch = usePalette((s) => s.setOpen)
  const status = uplink.state === 'up' ? t('Server build {commit}', { commit: uplink.commit }) : uplink.state === 'down' ? t('Uplink down') : t('Linking')

  return (
    <div className="max-md:hidden">
      <div className={`${FLOAT} left-3 gap-1`}>
        <a href="/" title={APP.name} className="flex h-9 items-center gap-2 rounded-full pr-1 pl-1 hover:bg-ink-700 lg:pr-3">
          <img src="/favicon.svg" alt="" className="h-7 w-7" />
          <span className="text-sm font-semibold whitespace-nowrap text-fg-strong max-lg:hidden">{APP.name}</span>
        </a>
        <button
          type="button"
          onClick={() => openSearch(true)}
          title={t('Search places, callsigns, trains, satellites and layers')}
          aria-label={t('Search')}
          className="flex h-9 items-center gap-2 rounded-full px-2.5 text-sm text-fg-dim transition-colors hover:bg-ink-700 hover:text-fg-strong max-xl:w-9 max-xl:justify-center max-xl:px-0 xl:bg-ink-800 xl:pr-2"
        >
          <svg viewBox="0 0 16 16" className="h-[18px] w-[18px] shrink-0" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true">
            <path d="M7 12A5 5 0 107 2a5 5 0 000 10zM10.6 10.6L14 14" />
          </svg>
          <span className="w-40 text-left max-xl:hidden">{t('Search')}</span>
          <kbd className="rounded-full border border-line px-2 py-0.5 text-[11px] text-fg-mute max-xl:hidden">Ctrl K</kbd>
        </button>
      </div>

      <div className={`${FLOAT} right-3 gap-0.5 text-sm text-fg-dim`}>
        <span className="px-2.5 tabular-nums max-xl:hidden">
          <Clock compact />
        </span>
        {online !== null && (
          <span className="px-2 whitespace-nowrap tabular-nums max-xl:hidden" title={t('Visitors on the site right now')}>
            {t('{n} online', { n: online })}
          </span>
        )}
        <LanguageSelect className="h-9 rounded-full bg-transparent px-2.5 text-sm font-medium text-fg-dim hover:bg-ink-700 hover:text-fg-strong" />
        <ThemeButton />
        <span className="grid h-9 w-9 place-items-center" title={status} aria-label={status}>
          <span className={`h-2 w-2 rounded-full ${uplink.state === 'up' ? 'bg-ok' : uplink.state === 'down' ? 'bg-danger' : 'animate-pulse bg-warn'}`} />
        </span>
      </div>
    </div>
  )
}

export function TopBar() {
  const uplink = useUplink()
  const online = useOnline()
  const openSearch = usePalette((s) => s.setOpen)

  return (
    <header className="pointer-events-auto absolute inset-x-0 top-0 z-20 flex h-10 md:hidden items-center gap-3 border-b border-line bg-ink-900/90 px-3 font-mono text-[11px] tracking-[0.14em] text-fg-dim uppercase backdrop-blur-md">
      <img src="/favicon.svg" alt="" aria-hidden="true" className="h-6 w-6 shrink-0" />
      <h1 className="font-semibold tracking-[0.3em] whitespace-nowrap text-fg-strong">{APP.codename}</h1>

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
