import type { ExpressionSpecification, LayerSpecification, Map as MapLibreMap } from 'maplibre-gl'
import { lang, t } from '../i18n'
import { formatLat, formatLon } from '../lib/coords'
import { MAP_EXTRAS, type MapTheme } from '../map/style'
import { currentMapTheme } from '../state/ui'
import type { InspectorModel, LayerDef } from './types'

/**
 * The places a visitor has heard of, as a city map marks its sights: a round badge in the colour
 * of its kind with a white pictogram, and its name beside it. Baked from Wikidata by
 * scripts/bake-landmarks.mjs; the best known come out first as the camera comes down, and the
 * map's own collision keeps them apart.
 */
const SOURCE = 'landmarks'
/** Also named in map/style.ts, which repaints its lettering with the theme. */
const ICONS = 'landmarks-icon'

export type LandmarkKind =
  | 'castle' | 'palace' | 'cathedral' | 'church' | 'museum' | 'theatre' | 'tower' | 'monument' | 'park'
  | 'stadium' | 'station' | 'lighthouse' | 'bridge' | 'university' | 'square' | 'market' | 'townhall'

/** Colour, pictogram (white, in a 24-unit box) and name of each kind. */
const KINDS: Record<LandmarkKind, { color: string; glyph: string; label: string }> = {
  castle: { color: '#8a5a44', label: t('Castle'), glyph: 'M5 20V8h2.5v2.5H10V8h4v2.5h2.5V8H19v12h-5v-4a2 2 0 0 0-4 0v4z' },
  palace: { color: '#b07f22', label: t('Palace or manor'), glyph: 'M3.5 20.5h17V19h-17zM5.5 18H8v-6H5.5zm5.25 0h2.5v-6h-2.5zM16 18h2.5v-6H16zM3.5 11h17L12 4.5z' },
  cathedral: { color: '#5257c4', label: t('Cathedral'), glyph: 'M11 1.5h2v2h2v2h-2V8l5.5 4.5V21H14v-4a2 2 0 0 0-4 0v4H5.5v-8.5L11 8V5.5H9v-2h2z' },
  church: { color: '#7a6fc6', label: t('Church'), glyph: 'M11 2h2v2h2v2h-2v3l4 4v8h-3.5v-3.5a1.5 1.5 0 0 0-3 0V21H7v-8l4-4V6H9V4h2z' },
  museum: { color: '#d0562c', label: t('Museum'), glyph: 'M12 3l9 5v1.5H3V8zM5 11h2.5v6H5zm5.75 0h2.5v6h-2.5zM16.5 11H19v6h-2.5zM3 18.5h18V21H3z' },
  theatre: { color: '#c43c6e', label: t('Theatre or concert hall'), glyph: 'M5 4h14v7a7 7 0 0 1-14 0zM7.5 8v1.6h3.5V8zm5.5 0v1.6h3.5V8zm-4.5 5a3.5 3.5 0 0 0 7 0z' },
  tower: { color: '#3f7cb0', label: t('Tower'), glyph: 'M11 2h2v6h2l-1 3h-.8l1.3 10h-5l1.3-10H10L9 8h2z' },
  monument: { color: '#776a5c', label: t('Monument'), glyph: 'M10.6 4.5L12 2l1.4 2.5 1.1 12.5h-5zM7 18h10v3H7z' },
  park: { color: '#3c9a48', label: t('Park or nature'), glyph: 'M12 2a5 5 0 0 1 4.7 6.8A4.6 4.6 0 0 1 14 17h-1v4h-2v-4h-1a4.6 4.6 0 0 1-2.7-8.2A5 5 0 0 1 12 2z' },
  stadium: { color: '#24908a', label: t('Stadium or arena'), glyph: 'M12 5c5.5 0 9 2.7 9 7s-3.5 7-9 7-9-2.7-9-7 3.5-7 9-7zm0 3c-3.6 0-6 1.6-6 4s2.4 4 6 4 6-1.6 6-4-2.4-4-6-4z' },
  station: { color: '#3a6fd4', label: t('Railway station'), glyph: 'M7.5 3h9A2.5 2.5 0 0 1 19 5.5V15a3 3 0 0 1-2.4 2.9l2 3.1h-2.4l-1.9-3h-4.6l-1.9 3H5.4l2-3.1A3 3 0 0 1 5 15V5.5A2.5 2.5 0 0 1 7.5 3zM7 6v5h10V6zm.6 8.6a1.4 1.4 0 1 0 2.8 0 1.4 1.4 0 1 0-2.8 0zm6 0a1.4 1.4 0 1 0 2.8 0 1.4 1.4 0 1 0-2.8 0z' },
  lighthouse: { color: '#d4473a', label: t('Lighthouse'), glyph: 'M10 2h4v2h1v2h-.8l1.3 13H17v2H7v-2h1.5L9.8 6H9V4h1z' },
  bridge: { color: '#5d7381', label: t('Bridge'), glyph: 'M2 7.5h20v2.5h-1V19h-3v-2a6 6 0 0 0-12 0v2H3v-9H2z' },
  university: { color: '#6a4fae', label: t('University'), glyph: 'M12 4l11 5-11 5L1 9zM5.5 12.3v4.2c0 1.8 2.9 3.2 6.5 3.2s6.5-1.4 6.5-3.2v-4.2L12 15.2zM20.5 10.2V16h1.4v-6.5z' },
  square: { color: '#98783a', label: t('Square'), glyph: 'M11 3h1.6v.6L17.5 5l-4.9 1.6V11H11zM3.5 20l3-7.5h11l3 7.5z' },
  market: { color: '#dd861b', label: t('Market'), glyph: 'M3.5 4h17l1.5 5a2.6 2.6 0 0 1-4.9 1.2 2.6 2.6 0 0 1-5.1 0 2.6 2.6 0 0 1-5.1 0A2.6 2.6 0 0 1 2 9zM4 12.6V21h6.5v-5h3v5H20v-8.4a4 4 0 0 1-2.9-.4 4 4 0 0 1-5.1.4 4 4 0 0 1-5.1-.4 4 4 0 0 1-2.9.4z' },
  townhall: { color: '#8b568d', label: t('Town hall'), glyph: 'M10.5 2h3v3H15v4h5v12H4V9h5V5h1.5zM10.6 7.4a1.4 1.4 0 1 0 2.8 0 1.4 1.4 0 1 0-2.8 0z' },
}

/** Badge side in CSS pixels, drawn this many times finer for sharp screens. */
const SIDE = 26
const RATIO = 3

function badge(kind: LandmarkKind): ImageData {
  const px = SIDE * RATIO
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = px
  const ctx = canvas.getContext('2d')!
  ctx.scale(RATIO, RATIO)
  const c = SIDE / 2
  // A soft shadow under a white rim, so the badge stands off any map or photo.
  ctx.shadowColor = 'rgba(0,0,0,0.35)'
  ctx.shadowBlur = 2
  ctx.shadowOffsetY = 0.6
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.arc(c, c, c - 1.6, 0, Math.PI * 2)
  ctx.fill()
  ctx.shadowColor = 'transparent'
  ctx.fillStyle = KINDS[kind].color
  ctx.beginPath()
  ctx.arc(c, c, c - 3, 0, Math.PI * 2)
  ctx.fill()
  // The 24-unit pictogram at 0.6 of the badge, centred.
  const scale = (SIDE * 0.58) / 24
  ctx.translate(c - 12 * scale, c - 12 * scale)
  ctx.scale(scale, scale)
  ctx.fillStyle = '#ffffff'
  ctx.fill(new Path2D(KINDS[kind].glyph), 'evenodd')
  return ctx.getImageData(0, 0, px, px)
}

/** The name in the reader's language when Wikidata has one, else as it is written there. */
const NAME: ExpressionSpecification = ['coalesce', ['get', `name_${lang}`], ['get', 'name']]

/** Which places come out at a zoom: by how many Wikipedias write about them. */
const FAMOUS_ENOUGH: ExpressionSpecification = ['>=', ['get', 'links'], ['step', ['zoom'], 40, 7, 25, 8.5, 15, 10, 9, 11.5, 0]]

const SPECS = [
  {
    id: ICONS,
    type: 'symbol',
    minzoom: 6,
    filter: FAMOUS_ENOUGH,
    layout: {
      'icon-image': ['concat', 'landmark-', ['get', 'kind']],
      'icon-size': ['interpolate', ['linear'], ['zoom'], 6, 0.7, 13, 1],
      'icon-padding': 3,
      // The best known first, so a crowded square keeps its cathedral and drops the chapel.
      'symbol-sort-key': ['-', 0, ['get', 'links']],
      'text-field': ['step', ['zoom'], '', 9, NAME],
      'text-font': ['Noto Sans Bold'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 9, 10.5, 15, 12.5],
      'text-max-width': 9,
      'text-variable-anchor': ['left', 'right', 'top', 'bottom'],
      'text-radial-offset': 1.05,
      'text-justify': 'auto',
      'text-optional': true,
    },
    paint: { 'text-halo-width': 1.4, 'text-halo-blur': 0.3 },
  },
] as const

let shownOn: MapLibreMap | null = null

function paintFor(map: MapLibreMap): void {
  const theme: MapTheme = currentMapTheme()
  for (const [id, key, value] of MAP_EXTRAS[theme]) {
    if (id === ICONS) map.setPaintProperty(ICONS, key as 'text-color', value)
  }
}

export const landmarksLayer: LayerDef = {
  id: 'landmarks',
  group: 'reference',
  label: t('Landmarks'),
  hint: t('Castles, cathedrals, museums, parks and other well-known places of Estonia, Latvia and Lithuania'),
  defaultOn: true,
  swatch: '#d0562c',
  feeds: [],
  attribution: [{ label: 'Wikidata (CC0)', href: 'https://www.wikidata.org/' }],
  build: () => [],
  native: {
    interactive: [ICONS],
    show(map) {
      shownOn = map
      for (const kind of Object.keys(KINDS) as LandmarkKind[]) {
        if (!map.hasImage(`landmark-${kind}`)) map.addImage(`landmark-${kind}`, badge(kind), { pixelRatio: RATIO })
      }
      if (!map.getSource(SOURCE)) map.addSource(SOURCE, { type: 'geojson', data: '/data/landmarks.json' })
      for (const spec of SPECS) {
        if (!map.getLayer(spec.id)) map.addLayer({ ...spec, source: SOURCE } as unknown as LayerSpecification)
      }
      paintFor(map)
    },
    hide() {
      for (const spec of SPECS) if (shownOn?.getLayer(spec.id)) shownOn.removeLayer(spec.id)
      shownOn = null
    },
    pick(p, lon, lat) {
      const kind = KINDS[p.kind as LandmarkKind] ?? KINDS.monument
      const name = String(p[`name_${lang}`] ?? p.name)
      const local = String(p.name)
      const id = String(p.id)
      const model: InspectorModel = {
        kicker: kind.label,
        title: name,
        subtitle: local !== name ? local : undefined,
        badges: [],
        rows: [{ label: t('Position'), value: `${formatLat(lat)}  ${formatLon(lon)}` }],
        links: /^Q\d+$/.test(id)
          ? [
              // Wikidata sends the reader on to the article in their own language, where there is one.
              { label: 'Wikipedia', href: `https://www.wikidata.org/wiki/Special:GoToLinkedPage/${lang}wiki/${id}` },
              { label: 'Wikidata', href: `https://www.wikidata.org/wiki/${id}` },
            ]
          : [],
      }
      return { lon, lat, model }
    },
  },
}
