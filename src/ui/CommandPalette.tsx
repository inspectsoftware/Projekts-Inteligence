import { useEffect, useMemo, useRef, useState } from 'react'
import type { Train } from '../../shared/adapters/trains'
import type { TransitVehicle } from '../../shared/adapters/transit'
import { haversine } from '../../shared/geo/sphere'
import { ROLE_LABEL } from '../../shared/data/aircraftRoles'
import { type Aircraft, Flag } from '../../shared/entity'
import { TV_CHANNELS } from '../../shared/media/tv'
import { t } from '../i18n'
import { LAYERS } from '../layers/registry'
import { MODE_LABEL } from '../layers/transit'
import { formatLat, formatLon, parseCoords } from '../lib/coords'
import { type SearchItem, rank } from '../lib/search'
import { VIEWS, flyHome, flyThere, flyToView } from '../map/camera'
import { goToEntity } from '../map/goToEntity'
import { getMap } from '../map/instance'
import { goToCoords } from '../map/pin'
import { getEntities } from '../runtime/entityStore'
import { searchWorld } from '../runtime/place'
import { isLayerOn, useLayers } from '../state/layers'
import { usePalette } from '../state/palette'
import { useUi } from '../state/ui'
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
const PLACE_LABEL = { city: t('City'), town: t('Town'), village: t('Village') } as const

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
    const role = a.props.role ? t(ROLE_LABEL[a.props.role]) : null
    items.push({
      id: a.id,
      group: t('Aircraft'),
      title: a.label ?? a.props.hex,
      subtitle: [a.props.registration, a.props.type, role].filter(Boolean).join(' · ') || undefined,
      keywords: `${a.props.registration ?? ''} ${a.props.hex} ${a.props.type ?? ''} ${role ?? ''} ${a.flags & Flag.MIL ? 'military' : ''}`,
      weight: 50,
      run: () => goToEntity(a),
    })
  }
  // Buses, trams and trolleybuses by route, as a city map finds them: "3" finds route 3 in every town
  // that runs one, the nearest first, and going to it picks the one of its vehicles nearest the view.
  const centre = getMap()?.getCenter()
  const routes = new Map<string, TransitVehicle[]>()
  for (const vehicle of getEntities('transit') as TransitVehicle[]) {
    const { route, mode, network } = vehicle.props
    if (!route) continue
    const key = `${network}|${mode}|${route}`
    const list = routes.get(key)
    if (list) list.push(vehicle)
    else routes.set(key, [vehicle])
  }
  for (const [key, vehicles] of routes) {
    const { route, mode, network } = vehicles[0].props
    const away = (vehicle: TransitVehicle) => (centre ? haversine(centre.lng, centre.lat, vehicle.lon, vehicle.lat) : 0)
    const nearest = vehicles.reduce((best, vehicle) => (away(vehicle) < away(best) ? vehicle : best))
    items.push({
      id: `route:${key}`,
      group: MODE_LABEL[mode],
      title: route!,
      subtitle: `${MODE_LABEL[mode]} · ${network} · ${t('{n} on the road', { n: vehicles.length })}`,
      keywords: `${MODE_LABEL[mode]} ${route} ${network} ${route} ${MODE_LABEL[mode]}`,
      // Nearer towns first: 55 next door, down to 25 across the region.
      weight: 55 - Math.min(30, away(nearest) / 10_000),
      run: () => goToEntity(nearest),
    })
  }
  for (const train of getEntities('trains') as Train[]) {
    items.push({
      id: train.id,
      group: t('Train'),
      title: t('Train {number}', { number: train.props.number }),
      subtitle: train.props.route ?? undefined,
      keywords: `${train.props.number} ${train.props.route ?? ''} ${train.props.nextStop ?? ''}`,
      weight: 40,
      run: () => goToEntity(train),
    })
  }
  for (const [slot, group] of [
    ['satellites', t('Satellite')],
    ['stations', t('Weather station')],
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
      run: () => {
        const map = getMap()
        if (map) flyThere(map, [place.lon, place.lat], PLACE_ZOOM[place.kind])
      },
    })
  }

  const { visible, toggle } = useLayers.getState()
  for (const layer of LAYERS) {
    const on = isLayerOn(visible, layer.id, layer.defaultOn)
    items.push({
      id: `layer:${layer.id}`,
      group: t('Layer'),
      title: layer.label,
      subtitle: on ? t('Shown: hide it') : t('Hidden: show it'),
      keywords: `layer toggle ${layer.group}`,
      weight: 20,
      run: () => toggle(layer.id, layer.defaultOn),
    })
  }

  const shown = shownWindows()
  const developer = useUi.getState().developer
  for (const def of WINDOWS) {
    // Mode windows come and go with what they show; there is nothing to open by hand. Developer
    // windows are found only in developer mode, as they are on the taskbar.
    if (def.mode || (def.developer && !developer)) continue
    items.push({
      id: `window:${def.id}`,
      group: t('Window'),
      title: def.title,
      subtitle: shown.includes(def) ? t('Open: close it') : t('Closed: open it'),
      keywords: 'window panel open close',
      weight: 20,
      run: () => toggleWindow(def),
    })
  }
  items.push({
    id: 'window:reset',
    group: t('Window'),
    title: t('Reset window layout'),
    keywords: 'windows panels default arrange',
    weight: 15,
    run: () => useWindows.getState().resetLayout(),
  })

  for (const channel of TV_CHANNELS) {
    // A channel that may not be embedded is still found here, and opens where its broadcaster shows it.
    const away = channel.kind === 'link'
    items.push({
      id: `tv:${channel.id}`,
      group: t('Live TV'),
      title: channel.name,
      subtitle: away ? t('Opens the broadcaster’s own site') : channel.schedule && t(channel.schedule),
      keywords: `tv television live watch channel ${channel.credit}`,
      weight: 18,
      run: () => (away ? void window.open(channel.link, '_blank', 'noopener,noreferrer') : watchChannel(channel.id)),
    })
  }

  items.push({
    id: 'view:latvia',
    group: t('View'),
    title: t('Baltic overview'),
    keywords: 'home country baltic latvia lithuania estonia',
    weight: 25,
    run: () => {
      const map = getMap()
      if (map) flyHome(map)
    },
  })
  for (const view of VIEWS) {
    items.push({
      id: `view:${view.id}`,
      group: t('View'),
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

/** A typed position is not looked up in the index: it is an answer already, and goes first. */
function coordsItem(query: string): SearchItem[] {
  const hit = parseCoords(query)
  if (!hit) return []
  const [lon, lat] = hit
  return [
    {
      id: 'coords',
      group: t('Coordinates'),
      title: `${formatLat(lat)}  ${formatLon(lon)}`,
      subtitle: t('Go to this position'),
      run: () => {
        const map = getMap()
        if (map) goToCoords(map, lon, lat)
      },
    },
  ]
}

/**
 * The gazetteer here is Latvia's. Anywhere else is looked up on request, one question per Enter:
 * the service that answers allows no search-as-you-type.
 */
function worldItem(query: string): SearchItem[] {
  const words = query.trim()
  if (words.length < 3 || parseCoords(words)) return []
  return [
    {
      id: 'world',
      group: t('World'),
      title: t('Search the world for “{query}”', { query: words }),
      subtitle: 'OpenStreetMap',
      run: () => {
        const map = getMap()
        if (map) searchWorld(map, words)
      },
    },
  ]
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
  const results = useMemo(() => (open ? [...coordsItem(query), ...rank(query, buildIndex(places)), ...worldItem(query)] : []), [open, query, places])
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
    // On a wide screen the search box opens where its button sits, top left, results dropping under
    // it and the map left as it is; on a phone it is a sheet over a dimmed map.
    <div
      className="absolute inset-0 z-40 flex items-start justify-center bg-ink-950/55 px-3 pt-[12vh] max-md:backdrop-blur-[2px] md:block md:bg-transparent md:p-0"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close()
      }}
    >
      <div
        role="dialog"
        aria-label={t('Search')}
        className="w-[min(34rem,100%)] overflow-hidden rounded-2xl border border-line bg-ink-900 font-sans shadow-[0_8px_30px_rgb(0_0_0/0.2)] md:absolute md:top-2 md:left-3 md:w-[min(440px,calc(100vw-24px))]"
      >
        <div className="flex h-11 items-center gap-2.5 border-b border-line px-3.5">
          <svg viewBox="0 0 16 16" className="h-[18px] w-[18px] shrink-0 text-fg-mute" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true">
            <path d="M7 12A5 5 0 107 2a5 5 0 000 10zM10.6 10.6L14 14" />
          </svg>
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
          placeholder={t('Search places, coordinates, callsigns, trains, layers…')}
          aria-label={t('Search')}
          autoComplete="off"
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent text-sm text-fg-strong placeholder:text-fg-mute focus:outline-none"
          />
          <kbd className="rounded-full border border-line px-2 py-0.5 text-[11px] text-fg-mute max-md:hidden">Esc</kbd>
        </div>
        {results.length > 0 ? (
          <ul role="listbox" className="max-h-[60vh] overflow-y-auto p-1.5">
            {results.map((item, index) => (
              <li key={item.id} role="option" aria-selected={index === active}>
                <button
                  type="button"
                  onMouseEnter={() => setCursor(index)}
                  onClick={() => choose(item)}
                  className={`flex w-full flex-col rounded-xl px-3 py-2 text-left transition-colors ${index === active ? 'bg-ink-700' : ''}`}
                >
                  <span className="flex min-w-0 items-baseline gap-2">
                    <span className="truncate text-sm font-medium text-fg-strong">{item.title}</span>
                    <span className="ml-auto shrink-0 text-[11px] text-fg-mute">{item.group}</span>
                  </span>
                  {item.subtitle && <span className="truncate text-xs text-fg-dim">{item.subtitle}</span>}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-4 py-3 text-xs text-fg-mute">{query.trim() ? t('Nothing matches.') : t('Type to search. ↑ ↓ to move, Enter to go, Esc to close.')}</p>
        )}
      </div>
    </div>
  )
}
