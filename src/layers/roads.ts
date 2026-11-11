import type { Color } from '@deck.gl/core'
import { IconLayer, TextLayer } from '@deck.gl/layers'
import { type Camera, type RoadEvent, type RoadEventCategory, type RoadSource, plainWords } from '../../shared/adapters/roads'
import { locale, t } from '../i18n'
import { formatLat, formatLon } from '../lib/coords'
import { formatAge } from '../lib/format'
import { getEntities } from '../runtime/entityStore'
import { getSignAtlas } from '../map/signs'
import { LABEL_FONT, OUTLINE, dots, iconScale, memoLast, selectionRing } from './common'
import type { InspectorModel, LayerDef } from './types'

/** Two layers so that the few urgent signs are never buried under the many roadworks. */
const splitRoads = memoLast((data: RoadEvent[]) => ({
  urgent: data.filter((event) => event.props.category !== 'roadworks'),
  works: data.filter((event) => event.props.category === 'roadworks'),
}))

/** The events drawn at this zoom, worked out again only when the events, the selection or which kinds show change. */
const shownOnly = (events: RoadEvent[], zoom: number, selectedId: string | null) => events.filter((event) => event.id === selectedId || zoom >= fromZoom(event))
// One for each list: a single one, asked for the two in turn, would make both again every frame.
const shownWorks = memoLast(shownOnly)
const shownUrgent = memoLast(shownOnly)

const SOURCE_LINK = [{ label: 'transportdata.gov.lv', href: 'https://map.transportdata.gov.lv/' }]

/** Where each country's reports come from, to read more. */
const REPORTED_BY: Record<RoadSource, { label: string; href: string }[]> = {
  lv: SOURCE_LINK,
  lt: [{ label: 'eismoinfo.lt', href: 'https://eismoinfo.lt/' }],
  ee: [{ label: 'tarktee.ee', href: 'https://tarktee.ee/' }],
  tallinn: [{ label: 'tallinn.ee', href: 'https://www.tallinn.ee/' }],
}

const CAMERA: Color = [120, 220, 255]

export const camerasLayer: LayerDef = {
  id: 'cameras',
  group: 'land',
  label: t('Road cameras'),
  hint: t("The road authority's roadside cameras on the main roads around Rīga: a still every few minutes"),
  defaultOn: false,
  swatch: '#78dcff',
  feeds: ['cameras'],
  describes: ['camera'],

  describe(entity, now) {
    const camera = entity as Camera
    return {
      kicker: t('Road camera'),
      title: camera.props.road,
      // The frame's address changes with every snapshot, so the browser never shows an old one.
      image: { src: `${camera.props.image}?t=${camera.ts}`, alt: t('Road camera view at {road}', { road: camera.props.road }) },
      badges: [],
      rows: [
        { label: t('Fetched'), value: formatAge(now - camera.ts) },
        { label: t('Position'), value: `${formatLat(camera.lat)}  ${formatLon(camera.lon)}` },
      ],
      links: SOURCE_LINK,
    }
  },

  build(ctx) {
    const data = getEntities('cameras') as Camera[]
    return [
      ...dots('cameras', data, () => CAMERA, 5, ctx),
      new TextLayer<Camera>({
        id: 'cameras-labels',
        data,
        visible: ctx.fontsReady && ctx.zoom >= 8.5,
        getText: (camera) => camera.props.road,
        getPosition: (camera) => [camera.lon, camera.lat],
        getSize: 10.5,
        getColor: [...CAMERA, 235] as Color,
        getPixelOffset: [9, 0],
        getTextAnchor: 'start',
        getAlignmentBaseline: 'center',
        fontFamily: LABEL_FONT,
        fontWeight: 500,
        fontSettings: { sdf: true },
        outlineWidth: 2.5,
        outlineColor: OUTLINE,
        characterSet: 'auto',
      }),
    ]
  },
}

const CATEGORY: Record<RoadEventCategory, { label: string; color: Color; radius: number }> = {
  accident: { label: t('Accident'), color: [255, 77, 94], radius: 6 },
  hazard: { label: t('Hazard on the road'), color: [255, 190, 80], radius: 5 },
  closure: { label: t('Road closed'), color: [255, 122, 110], radius: 5 },
  roadworks: { label: t('Roadworks'), color: [255, 204, 102], radius: 3.5 },
}

/**
 * From these zooms in each kind of sign is drawn: none with the whole Baltic on screen, closures and
 * accidents once a region is, hazards a little closer, the many roadworks only in town.
 */
const URGENT_ZOOM = 8.5
const HAZARD_ZOOM = 9.5
const WORKS_ZOOM = 10.5
const fromZoom = (event: RoadEvent) => (event.props.category === 'roadworks' ? WORKS_ZOOM : event.props.category === 'hazard' ? HAZARD_ZOOM : URGENT_ZOOM)

const DAY = new Intl.DateTimeFormat(locale, { timeZone: 'Europe/Riga', day: 'numeric', month: 'short', year: 'numeric' })

export const roadEventsLayer: LayerDef = {
  id: 'road-events',
  group: 'land',
  label: t('Roadworks and incidents'),
  hint: t('Accidents, hazards, closures and roadworks on the roads of Estonia, Latvia and Lithuania and on the streets of Tallinn, as their road authorities report them'),
  defaultOn: true,
  swatch: '#ffcc66',
  feeds: ['roads'],
  describes: ['road-event'],

  describe(entity, now) {
    const { props, ts, lat, lon } = entity as RoadEvent
    const rows: InspectorModel['rows'] = [{ label: t('Kind'), value: plainWords(props.type) }]
    if (props.restrictions.length > 0) rows.push({ label: t('Traffic'), value: props.restrictions.map(plainWords).join(', ') })
    if (props.speedLimit !== null) rows.push({ label: t('Speed limit'), value: `${props.speedLimit} km/h` })
    if (props.from !== null) rows.push({ label: t('Since'), value: DAY.format(props.from) })
    if (props.until !== null) rows.push({ label: t('Until'), value: DAY.format(props.until) })
    if (props.contractor) rows.push({ label: t('Contractor'), value: props.contractor })
    // In Latvian, as written by the road authority.
    if (props.notes) rows.push({ label: t('Notes'), value: props.notes })
    if (props.detour) rows.push({ label: t('Detour'), value: props.detour })
    rows.push({ label: t('Updated'), value: formatAge(now - ts) })
    rows.push({ label: t('Position'), value: `${formatLat(lat)}  ${formatLon(lon)}` })
    return {
      kicker: CATEGORY[props.category].label,
      title: props.road,
      subtitle: props.place ?? undefined,
      badges: props.category === 'accident' ? [{ text: t('Accident'), tone: 'danger' }] : [],
      rows,
      // Tallinn's permit page where there is one, else the authority's map.
      links: props.url ? [{ label: 'opinfo.tallinn.ee', href: props.url }] : REPORTED_BY[props.source ?? 'lv'],
    }
  },

  stats(entities) {
    const count = (category: RoadEventCategory) => (entities as RoadEvent[]).filter((event) => event.props.category === category).length
    return [
      { label: t('accidents'), value: count('accident'), tone: 'danger' },
      { label: t('closed'), value: count('closure'), tone: 'warn' },
    ]
  },

  build(ctx) {
    const { urgent, works } = splitRoads(getEntities('roads') as RoadEvent[])
    const { canvas, mapping } = getSignAtlas()
    const scale = iconScale(ctx.zoom)
    // Which kinds show, as the zoom reaches each one's: a step, so the lists are not made again every frame. The one picked stays.
    const step = ctx.zoom >= WORKS_ZOOM ? WORKS_ZOOM : ctx.zoom >= HAZARD_ZOOM ? HAZARD_ZOOM : ctx.zoom >= URGENT_ZOOM ? URGENT_ZOOM : 0
    // Each event as the sign a driver would see: the roadworks sign smaller, being so many.
    const signs = (id: string, data: RoadEvent[], size: number) =>
      new IconLayer<RoadEvent>({
        id,
        data,
        pickable: true,
        iconAtlas: canvas as unknown as string,
        iconMapping: mapping,
        getIcon: (event) => event.props.category,
        getPosition: (event) => [event.lon, event.lat],
        getSize: (event) => (event.id === ctx.selectedId || event.id === ctx.hoveredId ? size * 1.3 : size),
        sizeUnits: 'pixels',
        sizeScale: scale,
        updateTriggers: { getSize: `${ctx.selectedId}|${ctx.hoveredId}` },
      })
    return [
      signs('road-works', ctx.zoom >= WORKS_ZOOM ? works : shownWorks(works, step, ctx.selectedId), 15),
      signs('road-incidents', ctx.zoom >= HAZARD_ZOOM ? urgent : shownUrgent(urgent, step, ctx.selectedId), 20),
      selectionRing('road-selection', [...works, ...urgent].filter((event) => event.id === ctx.selectedId), ctx.now, 14, scale),
    ]
  },
}
