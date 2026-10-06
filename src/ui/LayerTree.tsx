import type { FeedStatus } from '../../shared/feeds'
import { t } from '../i18n'
import { GROUP_ORDER, LAYERS } from '../layers/registry'
import { GROUP_LABELS, type LayerDef } from '../layers/types'
import { type FeedView, useFeeds } from '../state/feeds'
import { isLayerOn, useLayers } from '../state/layers'
import { SectionTitle } from './kit'

const STATUS_DOT: Record<FeedStatus, string> = {
  ok: 'bg-ok',
  stale: 'bg-warn',
  error: 'bg-danger',
  idle: 'bg-fg-mute',
  'needs-key': 'bg-fg-mute',
}

const STATUS_TEXT: Record<FeedStatus, string> = {
  ok: t('Live'),
  stale: t('Delayed: showing the last good data'),
  error: t('Feed unavailable'),
  idle: t('Waiting for data'),
  'needs-key': t('Needs an API key'),
}

const TONE_TEXT = { info: 'text-accent', warn: 'text-warn', danger: 'text-danger', mil: 'text-mil' } as const

function LayerRow({ layer, on, feed, onToggle }: { layer: LayerDef; on: boolean; feed?: FeedView; onToggle(): void }) {
  const status: FeedStatus = feed?.status ?? 'idle'
  const stats = on ? (feed?.stats.filter((stat) => stat.value > 0) ?? []) : []

  return (
    <li>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        title={layer.hint}
        onClick={onToggle}
        className="group flex w-full items-center gap-2 px-1 py-1 text-left text-[11px] tracking-[0.12em] uppercase transition-colors hover:bg-ink-700"
      >
        <span
          className="h-2.5 w-2.5 shrink-0 border"
          style={{ borderColor: layer.swatch, background: on ? layer.swatch : 'transparent' }}
        />
        <span className={on ? 'text-fg' : 'text-fg-mute group-hover:text-fg-dim'}>{layer.label}</span>
        {on && layer.feeds.length > 0 && (
          <span className="ml-auto flex items-center gap-2">
            <span className="text-fg tabular-nums">{feed?.count ?? '–'}</span>
            <span
              className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[status]} ${status === 'idle' ? 'animate-pulse' : ''}`}
              title={feed?.error ?? STATUS_TEXT[status]}
            />
          </span>
        )}
      </button>
      {stats.length > 0 && (
        <p className="flex flex-wrap gap-x-3 pb-1 pl-[1.4rem] text-[9.5px] tracking-[0.14em] uppercase">
          {stats.map((stat) => (
            <span key={stat.label} className={TONE_TEXT[stat.tone]}>
              {stat.value} {stat.label}
            </span>
          ))}
        </p>
      )}
    </li>
  )
}

/** Every toggleable layer, grouped, with its live count and feed health. */
export function LayerTree() {
  const visible = useLayers((s) => s.visible)
  const toggle = useLayers((s) => s.toggle)
  const feeds = useFeeds((s) => s.feeds)

  return (
    <div className="grid gap-2.5 p-3">
      {GROUP_ORDER.map((group) => {
        const layers = LAYERS.filter((layer) => layer.group === group)
        if (layers.length === 0) return null
        return (
          <section key={group}>
            <SectionTitle>{GROUP_LABELS[group]}</SectionTitle>
            <ul>
              {layers.map((layer) => (
                <LayerRow
                  key={layer.id}
                  layer={layer}
                  on={isLayerOn(visible, layer.id, layer.defaultOn)}
                  feed={feeds[layer.feeds[0]]}
                  onToggle={() => toggle(layer.id, layer.defaultOn)}
                />
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}
