import type { Entity } from '../../../../shared/entity'
import type { FeedId } from '../../../../shared/feeds'
import type { LayerDef } from '../../../layers/types'
import { goToEntity } from '../../../map/goToEntity'
import { useFeeds } from '../../../state/feeds'
import { isLayerOn, useLayers } from '../../../state/layers'

const KIND_TONE = { mil: 'text-mil', danger: 'text-danger', warn: 'text-warn', plain: 'text-fg-mute' } as const

interface TrackRowProps {
  entity: Entity
  /** The layer that draws it. Switched on when the row is opened: the list is live even while the layer is hidden. */
  layer: LayerDef
  title: string
  /** What it is, in a few words: a type and a role, a service and a flag. */
  kind: string
  tone: keyof typeof KIND_TONE
  detail: string
  where: string
  /** Inside Latvia's border or waters, which is drawn as a warning. */
  inside: boolean
}

/** One aircraft or vessel in a list. Opening it selects it and flies there. */
export function TrackRow({ entity, layer, title, kind, tone, detail, where, inside }: TrackRowProps) {
  const open = () => {
    const { visible, toggle } = useLayers.getState()
    if (!isLayerOn(visible, layer.id, layer.defaultOn)) toggle(layer.id, layer.defaultOn)
    goToEntity(entity)
  }
  return (
    <li>
      <button
        type="button"
        onClick={open}
        title="Show on the map"
        className="grid w-full grid-cols-[minmax(0,1fr)_auto] gap-x-3 px-1 py-1 text-left transition-colors hover:bg-ink-700"
      >
        <span className="truncate text-fg">
          {title}
          <span className={`ml-2 text-[9.5px] tracking-[0.12em] uppercase ${KIND_TONE[tone]}`}>{kind}</span>
        </span>
        <span className={`text-right text-[10px] whitespace-nowrap ${inside ? 'text-warn' : 'text-fg-dim'}`}>{where}</span>
        <span className="col-span-2 truncate text-[10px] text-fg-dim">{detail}</span>
      </button>
    </li>
  )
}

/** The feed's sources, with the links their licences ask for. The map's own credits only cover layers that are on. */
export function Credits({ feed }: { feed: FeedId }) {
  const credits = useFeeds((s) => s.feeds[feed]?.attribution)
  if (!credits?.length) return null
  return (
    <p className="mt-2 text-[9.5px] text-fg-mute">
      Data:{' '}
      {credits.map((credit, index) => (
        <span key={credit.href}>
          {index > 0 && ' · '}
          <a href={credit.href} target="_blank" rel="noreferrer noopener" className="hover:text-fg">
            {credit.label}
          </a>
        </span>
      ))}
    </p>
  )
}
