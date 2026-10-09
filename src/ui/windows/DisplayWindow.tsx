import { useState } from 'react'
import { t } from '../../i18n'
import { BASE_MODES, RECENT_REACH_DAYS, recentDays, recentEnd, zoomCeiling } from '../../map/basemaps'
import { THEMES, VISION_MODES, useRecent, useUi } from '../../state/ui'
import { SectionTitle, Segmented } from '../kit'
import { IdentitySettings } from './chat/IdentitySettings'

/** What the map is drawn on, and the filter it is seen through. */
export function DisplayWindow() {
  const base = useUi((s) => s.base)
  const vision = useUi((s) => s.vision)
  const setBase = useUi((s) => s.setBase)
  const setVision = useUi((s) => s.setVision)
  const theme = useUi((s) => s.theme)
  const setTheme = useUi((s) => s.setTheme)
  const back = useRecent((s) => s.back)
  const setBack = useRecent((s) => s.setBack)
  // The day the window was opened: the slider counts back from there.
  const [today] = useState(() => new Date())
  const days = recentDays(recentEnd(today, back))

  return (
    <div className="p-3">
      <SectionTitle>{t('Base')}</SectionTitle>
      <Segmented label={t('Basemap')} value={base} options={BASE_MODES} onChange={setBase} />
      {/* Zooming past what a base can resolve only enlarges its pixels, so say where that is. */}
      <p className="mt-2 text-[10px] text-fg-mute">
        {base === 'recent' && <span className="mr-1.5 border border-warn/60 px-1 text-[9px] tracking-[0.16em] text-warn uppercase">{t('Experimental')}</span>}
        {BASE_MODES.find((mode) => mode.id === base)?.detail} {t('Zoom limit {zoom}.', { zoom: zoomCeiling(base) })}
      </p>
      {base === 'recent' && (
        <label className="mt-2 block text-[10px] text-fg-dim">
          <span className="flex justify-between gap-2 tabular-nums">
            <span className="text-fg-mute">{t('Passes')}</span>
            <span>{t('{from} to {to}', { from: days[0], to: days[days.length - 1] })}</span>
          </span>
          {/* Left is the past, as on a timeline. */}
          <input
            type="range"
            aria-label={t('Imagery date')}
            min={-RECENT_REACH_DAYS}
            max={0}
            value={-back}
            onChange={(event) => setBack(-Number(event.target.value))}
            className="mt-1 h-1 w-full cursor-pointer accent-accent"
          />
        </label>
      )}
      <div className="h-3" />
      <SectionTitle>{t('Vision')}</SectionTitle>
      <Segmented label={t('Vision mode')} value={vision} options={VISION_MODES} onChange={setVision} />
      <div className="h-3" />
      <SectionTitle>{t('Theme')}</SectionTitle>
      <Segmented label={t('Theme')} value={theme} options={THEMES} onChange={setTheme} />
      <div className="h-3" />
      <SectionTitle>{t('Identity')}</SectionTitle>
      <IdentitySettings />
    </div>
  )
}
