import { useEffect, useState } from 'react'
import type { Entity } from '../../shared/entity'
import { t } from '../i18n'
import { layerFor } from '../layers/registry'
import type { Tone } from '../layers/types'
import { useMap } from '../map/instance'
import { positionAt } from '../map/motion'
import { serverNow } from '../runtime/clock'
import { useEntity } from '../runtime/entityStore'
import { useSelection } from '../state/selection'

const BADGE: Record<Tone, string> = {
  info: 'border-accent/50 text-accent',
  ok: 'border-ok/50 text-ok',
  warn: 'border-warn/60 text-warn',
  danger: 'border-danger/70 bg-danger/15 text-danger',
  mil: 'border-mil/60 text-mil',
}

/** Remembers the last entity seen, so the panel can say "lost" instead of vanishing mid-read. */
function useLastKnown(id: string | null, live: Entity | undefined): Entity | undefined {
  const [last, setLast] = useState<Entity | undefined>(live)
  if (live && live !== last) setLast(live)
  if (!id && last) setLast(undefined)
  return id ? (live ?? (last?.id === id ? last : undefined)) : undefined
}

/**
 * Dossier for the selected object: the body of the Inspector window, which is shown for as long
 * as something is selected. Re-renders once per snapshot, not per animation frame.
 */
export function Inspector() {
  const map = useMap()
  const selectedId = useSelection((s) => s.selectedId)
  const feature = useSelection((s) => s.feature)
  const followId = useSelection((s) => s.followId)
  const select = useSelection((s) => s.select)
  const follow = useSelection((s) => s.follow)
  const live = useEntity(selectedId)
  const entity = useLastKnown(selectedId, live)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') select(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [select])

  // Either a fixed map feature, which describes itself, or a live entity described by its layer.
  const describe = entity ? layerFor(entity)?.describe : undefined
  const model = feature ? feature.model : entity && describe ? describe(entity, serverNow()) : null
  if (!model) return <p className="p-3 text-[11px] text-fg-mute">{t('Nothing known about this object')}</p>

  const lost = !feature && !live
  const following = entity !== undefined && followId === entity.id
  const centreOn = (): [number, number] | null =>
    feature ? [feature.lon, feature.lat] : entity ? positionAt(entity, serverNow()) : null

  return (
    <>
      <header className="shrink-0 border-b border-line p-3">
        <p className="text-[10px] tracking-[0.22em] text-fg-mute uppercase">{model.kicker}</p>
        <h2 className="mt-0.5 text-xl font-semibold tracking-[0.08em] text-white">{model.title}</h2>
        {model.subtitle && <p className="text-[11px] tracking-[0.1em] text-fg-dim">{model.subtitle}</p>}
        {(model.badges.length > 0 || lost) && (
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {lost && (
              <li className={`border px-1.5 py-px text-[9.5px] tracking-[0.16em] uppercase ${BADGE.danger}`}>
                {t('No longer tracked')}
              </li>
            )}
            {model.badges.map((badge) => (
              <li
                key={badge.text}
                className={`border px-1.5 py-px text-[9.5px] tracking-[0.16em] uppercase ${BADGE[badge.tone]}`}
              >
                {badge.text}
              </li>
            ))}
          </ul>
        )}
      </header>

      {model.image && (
        <img src={model.image.src} alt={model.image.alt} className="block w-full shrink-0 border-b border-line bg-ink-850" />
      )}

      <dl className="min-h-0 overflow-y-auto px-3 py-2 text-[11px]">
        {model.rows.map((row) => (
          <div key={row.label} className="flex justify-between gap-3 border-b border-line/50 py-1 last:border-0">
            <dt className="shrink-0 tracking-[0.1em] text-fg-mute uppercase">{row.label}</dt>
            <dd className="text-right text-fg tabular-nums">{row.value}</dd>
          </div>
        ))}
      </dl>

      <footer className="grid shrink-0 gap-2 border-t border-line p-3">
        <div className={`grid gap-px bg-line p-px ${entity ? 'grid-cols-2' : ''}`}>
          <button
            type="button"
            disabled={!map || lost}
            onClick={() => {
              const center = centreOn()
              if (map && center) map.flyTo({ center, zoom: Math.max(map.getZoom(), 9), duration: 1200 })
            }}
            className="bg-ink-850 py-1.5 text-[10px] tracking-[0.16em] text-fg-dim uppercase transition-colors hover:bg-ink-700 hover:text-accent disabled:opacity-40"
          >
            {t('Centre')}
          </button>
          {entity && (
            <button
              type="button"
              aria-pressed={following}
              disabled={!map || lost}
              onClick={() => follow(following ? null : entity.id)}
              className={`py-1.5 text-[10px] tracking-[0.16em] uppercase transition-colors disabled:opacity-40 ${
                following ? 'bg-accent/15 text-accent' : 'bg-ink-850 text-fg-dim hover:bg-ink-700 hover:text-accent'
              }`}
            >
              {following ? t('Following') : t('Follow')}
            </button>
          )}
        </div>
        {model.links.length > 0 && (
          <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] tracking-[0.08em]">
            {model.links.map((link) => (
              <li key={link.href}>
                <a href={link.href} target="_blank" rel="noreferrer noopener" className="text-fg-dim underline decoration-line-strong underline-offset-2 hover:text-accent">
                  {link.label} ↗
                </a>
              </li>
            ))}
          </ul>
        )}
      </footer>
    </>
  )
}
