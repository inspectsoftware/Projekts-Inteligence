import { useEffect, useMemo, useRef, useState } from 'react'
import type { Train } from '../../shared/adapters/trains'
import { ROLE_LABEL } from '../../shared/data/aircraftRoles'
import { type Aircraft, Flag } from '../../shared/entity'
import { TV_CHANNELS } from '../../shared/media/tv'
import { LAYERS } from '../layers/registry'
import { type SearchItem, rank } from '../lib/search'
import { VIEWS, flyHome, flyToView } from '../map/camera'
import { goToEntity } from '../map/goToEntity'
import { getMap } from '../map/instance'
import { getEntities } from '../runtime/entityStore'
import { isLayerOn, useLayers } from '../state/layers'
import { usePalette } from '../state/palette'
import { useWindows } from '../state/windows'
import { WINDOWS, shownWindows, toggleWindow } from './windows/registry'
import { watchChannel } from './windows/tv/store'

interface Place {
  name: string
  kind: 'city' | 'town' | 'village'
  lon: number
  lat: number
  population: number
}

const PLACE_ZOOM = { city: 11, town: 12, village: 13 } as const
const PLACE_LABEL = { city: 'City', town: 'Town', village: 'Village' } as const

let placesRequest: Promise<Place[]> | null = null

/** The gazetteer is only fetched the first time someone searches. */
function loadPlaces(): Promise<Place[]> {
  placesRequest ??= fetch('/data/lv-places.json')
    .then((res) => (res.ok ? (res.json() as Promise<Place[]>) : []))
    .catch(() => {
      placesRequest = null
      return []
    })
  return placesRequest
}

/** Everything searchable right now: live objects, places, layers, windows, television channels and saved views. */
function buildIndex(places: readonly Place[]): SearchItem[] {
  const items: SearchItem[] = []

  for (const a of getEntities('aircraft') as Aircraft[]) {
    // "tanker" or "awacs" finds every one that is up, "military" all of them.
    const role = a.props.role ? ROLE_LABEL[a.props.role] : null
    items.push({
      id: a.id,
      group: 'Aircraft',
      title: a.label ?? a.props.hex,
      subtitle: [a.props.registration, a.props.type, role].filter(Boolean).join(' · ') || undefined,
      keywords: `${a.props.registration ?? ''} ${a.props.hex} ${a.props.type ?? ''} ${role ?? ''} ${a.flags & Flag.MIL ? 'military' : ''}`,
      weight: 50,
      run: () => goToEntity(a),
    })
  }
  for (const train of getEntities('trains') as Train[]) {
    items.push({
      id: train.id,
      group: 'Train',
      title: `Train ${train.props.number}`,
      subtitle: train.props.route ?? undefined,
      keywords: `${train.props.number} ${train.props.route ?? ''} ${train.props.nextStop ?? ''}`,
      weight: 40,
      run: () => goToEntity(train),
    })
  }
  for (const [slot, group] of [
    ['satellites', 'Satellite'],
    ['stations', 'Weather station'],
  ] as const) {
    for (const entity of getEntities(slot)) {
      const name = (entity.props as { name?: string }).name ?? entity.label ?? entity.id
      items.push({ id: entity.id, group, title: name, weight: 30, run: () => goToEntity(entity) })
    }
  }

  for (const place of places) {
    items.push({
      id: `place:${place.name}:${place.lon}`,
      group: PLACE_LABEL[place.kind],
      title: place.name,
      // A city or town outranks a weather station or view of the same name; among places, bigger first.
      weight: (place.kind === 'city' ? 60 : place.kind === 'town' ? 45 : 0) + Math.min(29, Math.log10(place.population + 10) * 4),
      run: () => getMap()?.flyTo({ center: [place.lon, place.lat], zoom: PLACE_ZOOM[place.kind], duration: 1800 }),
    })
  }

  const { visible, toggle } = useLayers.getState()
  for (const layer of LAYERS) {
    const on = isLayerOn(visible, layer.id, layer.defaultOn)
    items.push({
      id: `layer:${layer.id}`,
      group: 'Layer',
      title: layer.label,
      subtitle: on ? 'Shown: hide it' : 'Hidden: show it',
      keywords: `layer toggle ${layer.group}`,
      weight: 20,
      run: () => toggle(layer.id, layer.defaultOn),
    })
  }

  const shown = shownWindows()
  for (const def of WINDOWS) {
    // Mode windows come and go with what they show; there is nothing to open by hand.
    if (def.mode) continue
    items.push({
      id: `window:${def.id}`,
      group: 'Window',
      title: def.title,
      subtitle: shown.includes(def) ? 'Open: close it' : 'Closed: open it',
      keywords: 'window panel open close',
      weight: 20,
      run: () => toggleWindow(def),
    })
  }
  items.push({
    id: 'window:reset',
    group: 'Window',
    title: 'Reset window layout',
    keywords: 'windows panels default arrange',
    weight: 15,
    run: () => useWindows.getState().resetLayout(),
  })

  for (const channel of TV_CHANNELS) {
    // A channel that may not be embedded is still found here, and opens where its broadcaster shows it.
    const away = channel.kind === 'link'
    items.push({
      id: `tv:${channel.id}`,
      group: 'Live TV',
      title: channel.name,
      subtitle: away ? 'Opens the broadcaster’s own site' : channel.schedule,
      keywords: `tv television live watch channel ${channel.credit}`,
      weight: 18,
      run: () => (away ? void window.open(channel.link, '_blank', 'noopener,noreferrer') : watchChannel(channel.id)),
    })
  }

  items.push({
    id: 'view:latvia',
    group: 'View',
    title: 'Latvia overview',
    keywords: 'home country',
    weight: 25,
    run: () => {
      const map = getMap()
      if (map) flyHome(map)
    },
  })
  for (const view of VIEWS) {
    items.push({
      id: `view:${view.id}`,
      group: 'View',
      title: view.label,
      keywords: 'view go to',
      weight: 10,
      run: () => {
        const map = getMap()
        if (map) flyToView(map, view)
      },
    })
  }
  return items
}

/** Ctrl+K: find a place, a live object, a layer, a window or a view and go straight to it. */
export function CommandPalette() {
  const open = usePalette((s) => s.open)
  const setOpen = usePalette((s) => s.setOpen)
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const [places, setPlaces] = useState<Place[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement
      if ((event.key === 'k' && (event.ctrlKey || event.metaKey)) || (event.key === '/' && !typing)) {
        event.preventDefault()
        setOpen(!usePalette.getState().open)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setOpen])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    void loadPlaces().then((loaded) => {
      if (!cancelled) setPlaces(loaded)
    })
    inputRef.current?.focus()
    return () => {
      cancelled = true
    }
  }, [open])

  // The live part of the index is rebuilt per keystroke: it is a few hundred items and always current.
  const results = useMemo(() => (open ? rank(query, buildIndex(places)) : []), [open, query, places])
  const active = Math.min(cursor, Math.max(0, results.length - 1))

  if (!open) return null

  const close = () => {
    setOpen(false)
    setQuery('')
    setCursor(0)
  }
  const choose = (item: SearchItem | undefined) => {
    if (!item) return
    item.run()
    close()
  }

  return (
    <div
      className="absolute inset-0 z-40 flex items-start justify-center bg-ink-950/55 px-3 pt-[12vh] backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close()
      }}
    >
      <div role="dialog" aria-label="Search" className="w-[min(34rem,100%)] border border-line-strong bg-ink-900 font-mono shadow-2xl">
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setCursor(0)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') close()
            else if (event.key === 'ArrowDown') {
              event.preventDefault()
              setCursor(Math.min(active + 1, results.length - 1))
            } else if (event.key === 'ArrowUp') {
              event.preventDefault()
              setCursor(Math.max(active - 1, 0))
            } else if (event.key === 'Enter') choose(results[active])
          }}
          placeholder="Search places, callsigns, trains, satellites, layers…"
          aria-label="Search"
          autoComplete="off"
          spellCheck={false}
          className="w-full border-b border-line bg-transparent px-4 py-3 text-sm text-fg placeholder:text-fg-mute focus:outline-none"
        />
        {results.length > 0 ? (
          <ul role="listbox" className="max-h-[50vh] overflow-y-auto py-1">
            {results.map((item, index) => (
              <li key={item.id} role="option" aria-selected={index === active}>
                <button
                  type="button"
                  onMouseEnter={() => setCursor(index)}
                  onClick={() => choose(item)}
                  className={`flex w-full items-baseline gap-3 px-4 py-1.5 text-left ${index === active ? 'bg-accent/12' : ''}`}
                >
                  <span className="w-28 shrink-0 text-[9.5px] tracking-[0.18em] text-fg-mute uppercase">{item.group}</span>
                  <span className={`truncate text-[12.5px] ${index === active ? 'text-accent' : 'text-fg'}`}>{item.title}</span>
                  {item.subtitle && <span className="truncate text-[11px] text-fg-mute">{item.subtitle}</span>}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-4 py-3 text-[11px] tracking-[0.1em] text-fg-mute">
            {query.trim() ? 'Nothing matches.' : 'Type to search. ↑ ↓ to move, Enter to go, Esc to close.'}
          </p>
        )}
      </div>
    </div>
  )
}
