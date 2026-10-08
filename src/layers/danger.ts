import type { Color } from '@deck.gl/core'
import type { Feature, FeatureCollection, Geometry } from 'geojson'
import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl'
import type { Entity } from '../../shared/entity'
import type { Advisory, AdvisoryLevel, ConflictProps } from '../../shared/feeds'
import { locale, t } from '../i18n'
import { formatLat, formatLon } from '../lib/coords'
import { formatInt } from '../lib/format'
import { fold } from '../lib/search'
import { getEntities, getPayload } from '../runtime/entityStore'
import { dots } from './common'
import type { LayerDef, StaticSelection } from './types'

export const ADVISORY_LABEL: Record<AdvisoryLevel, string> = {
  0: t('No travel warning'),
  1: t('Avoid non-essential travel to parts'),
  2: t('Avoid all travel to parts'),
  3: t('Avoid non-essential travel'),
  4: t('Avoid all travel'),
}

const LEVEL_COLOR = ['rgba(0,0,0,0)', '#e8d27a', '#ffb347', '#ff7a3d', '#ff3d55'] as const
export const ADVISORY_TONE = ['text-fg-mute', 'text-fg-dim', 'text-warn', 'text-danger', 'text-danger'] as const

interface CountryProps {
  name: string
  long: string
  lon: number
  lat: number
  level?: AdvisoryLevel
  note?: string
  href?: string
  updatedAt?: number
}
type World = FeatureCollection<Geometry, CountryProps>

/** The same country under the name each side uses for it; the rest agree once accents and spaces are gone. */
const ALIASES: Record<string, string> = { myanmarburma: 'myanmar', usa: 'unitedstatesofamerica', falklandislands: 'falklandis' }
const key = (name: string) => {
  const plain = fold(name).replace(/[^a-z]/g, '')
  return ALIASES[plain] ?? plain
}

let worldRequest: Promise<World> | null = null
/** Country outlines, fetched the first time anything needs them. */
export function loadWorld(): Promise<World> {
  worldRequest ??= fetch('/data/world-countries.json')
    .then((res) => res.json() as Promise<World>)
    .catch((err) => {
      worldRequest = null
      throw err
    })
  return worldRequest
}

/** Where on the map a country's advisory can be flown to: its outline's label point. */
export function countryPoint(world: World, name: string): Feature<Geometry, CountryProps> | undefined {
  return world.features.find((feature) => key(feature.properties.name) === key(name) || key(feature.properties.long) === key(name))
}

const SOURCE = 'danger'
const FILL = 'danger-fill'
const DAY = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' })

let shownOn: MapLibreMap | null = null
let world: World | null = null
let applied: readonly Advisory[] | null = null

function describe(properties: Record<string, unknown>, lon: number, lat: number): StaticSelection | null {
  const level = properties.level as AdvisoryLevel | undefined
  if (level === undefined) return null
  const rows = [{ label: t('Advice'), value: ADVISORY_LABEL[level] }]
  if (typeof properties.note === 'string' && properties.note) rows.push({ label: t('Last change'), value: properties.note })
  if (typeof properties.updatedAt === 'number') rows.push({ label: t('Updated'), value: DAY.format(properties.updatedAt) })
  return {
    lon,
    lat,
    model: {
      kicker: t('Travel advice'),
      title: String(properties.name),
      badges: level > 0 ? [{ text: ADVISORY_LABEL[level], tone: level >= 3 ? 'danger' : 'warn' }] : [],
      rows,
      links: typeof properties.href === 'string' ? [{ label: t('Full advice (gov.uk)'), href: properties.href }] : [],
    },
  }
}

/** Countries coloured by how strongly a foreign ministry warns against going there. */
export const dangerLayer: LayerDef = {
  id: 'danger',
  group: 'reference',
  label: t('Danger by country'),
  hint: t('Countries coloured by the UK Foreign Office’s travel advice: the darker, the stronger the warning. One government’s view, by country, not a map of fighting'),
  defaultOn: false,
  swatch: '#ff7a3d',
  feeds: ['advisories'],
  build: () => [],

  native: {
    interactive: [FILL],
    show(map) {
      shownOn = map
      applied = null
      void loadWorld().then((loaded) => {
        world = loaded
        if (shownOn !== map || map.getLayer(FILL)) return
        if (!map.getSource(SOURCE)) map.addSource(SOURCE, { type: 'geojson', data: loaded })
        map.addLayer(
          {
            id: FILL,
            type: 'fill',
            source: SOURCE,
            paint: {
              'fill-color': ['match', ['coalesce', ['get', 'level'], 0], 1, LEVEL_COLOR[1], 2, LEVEL_COLOR[2], 3, LEVEL_COLOR[3], 4, LEVEL_COLOR[4], LEVEL_COLOR[0]],
              'fill-opacity': ['interpolate', ['linear'], ['zoom'], 2, 0.42, 8, 0.2],
            },
          },
          // Under the borders and labels, over land, water and any imagery.
          'boundary-country',
        )
      })
    },
    hide() {
      if (shownOn?.getLayer(FILL)) shownOn.removeLayer(FILL)
      shownOn = null
    },
    pick: describe,
  },

  // The advice arrives after the outlines or before them: whichever is second colours the map.
  update() {
    const countries = getPayload('advisories', 'advisories')?.countries
    const source = shownOn?.getSource(SOURCE) as GeoJSONSource | undefined
    if (!countries || !world || !source || applied === countries) return
    applied = countries
    const byKey = new Map(countries.map((advisory) => [key(advisory.name), advisory]))
    for (const feature of world.features) {
      const advisory = byKey.get(key(feature.properties.name)) ?? byKey.get(key(feature.properties.long))
      if (advisory) Object.assign(feature.properties, { level: advisory.level, note: advisory.note, href: advisory.href, updatedAt: advisory.updatedAt })
    }
    source.setData(world)
  },
}

type ConflictEvent = Entity<ConflictProps>
const KIND_LABEL: Record<ConflictProps['kind'], string> = {
  'state-based': t('Fighting involving a state'),
  'non-state': t('Fighting between armed groups'),
  'one-sided': t('Violence against civilians'),
}
const KIND_COLOR: Record<ConflictProps['kind'], Color> = { 'state-based': [255, 61, 85], 'non-state': [255, 150, 70], 'one-sided': [214, 120, 255] }

/** Recorded events of armed violence worldwide, a month behind. Off until the server has a UCDP token. */
export const conflictsLayer: LayerDef = {
  id: 'conflicts',
  group: 'reference',
  label: t('Armed conflict events'),
  hint: t('Battles and attacks recorded by the Uppsala Conflict Data Program in its latest monthly release. About a month behind, and only shown once the server has been given a UCDP access token'),
  defaultOn: false,
  swatch: '#ff3d55',
  feeds: ['conflicts'],
  describes: ['conflict'],

  describe(entity) {
    const { props, lat, lon } = entity as ConflictEvent
    return {
      kicker: KIND_LABEL[props.kind],
      title: props.conflict,
      subtitle: props.where || props.country,
      badges: props.deaths > 0 ? [{ text: t('{n} deaths (best estimate)', { n: formatInt(props.deaths) }), tone: 'danger' }] : [],
      rows: [
        { label: t('Sides'), value: props.sides.filter(Boolean).join(' – ') },
        { label: t('Country'), value: props.country },
        { label: t('From'), value: DAY.format(props.from) },
        { label: t('To'), value: DAY.format(props.to) },
        { label: t('Position'), value: `${formatLat(lat)}  ${formatLon(lon)}` },
      ],
      links: [{ label: 'UCDP', href: 'https://ucdp.uu.se' }],
    }
  },

  stats(entities) {
    return [{ label: t('deaths'), value: (entities as ConflictEvent[]).reduce((sum, event) => sum + event.props.deaths, 0), tone: 'danger' }]
  },

  build(ctx) {
    return dots('conflicts', getEntities('conflicts') as ConflictEvent[], (event) => KIND_COLOR[event.props.kind], 4, ctx)
  },
}
