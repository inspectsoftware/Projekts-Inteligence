import type { Color } from '@deck.gl/core'
import { ScatterplotLayer, TextLayer } from '@deck.gl/layers'
import { type Camera, type RoadEvent, type RoadEventCategory, plainWords } from '../../shared/adapters/roads'
import type { Entity } from '../../shared/entity'
import { formatLat, formatLon } from '../lib/coords'
import { formatAge } from '../lib/format'
import { getEntities } from '../runtime/entityStore'
import { LABEL_FONT, OUTLINE, SELECTED, iconScale, selectionRing } from './common'
import type { InspectorModel, LayerContext, LayerDef } from './types'

const SOURCE_LINK = [{ label: 'transportdata.gov.lv', href: 'https://map.transportdata.gov.lv/' }]

/** Dots with a ring around the selected one: all either road layer needs. */
function dots<T extends Entity>(id: string, data: T[], colorOf: (entity: T) => Color, radius: number, ctx: LayerContext) {
  const highlight = `${ctx.selectedId}|${ctx.hoveredId}`
  return [
    new ScatterplotLayer<T>({
      id,
      data,
      pickable: true,
      getPosition: (entity) => [entity.lon, entity.lat],
      getRadius: radius,
      radiusUnits: 'pixels',
      getFillColor: (entity) => (entity.id === ctx.selectedId || entity.id === ctx.hoveredId ? SELECTED : colorOf(entity)),
      getLineColor: OUTLINE,
      getLineWidth: 1.5,
      lineWidthUnits: 'pixels',
      stroked: true,
      updateTriggers: { getFillColor: highlight },
    }),
    selectionRing(
      `${id}-selection`,
      data.filter((entity) => entity.id === ctx.selectedId),
      ctx.now,
      12,
      iconScale(ctx.zoom),
    ),
  ]
}

const CAMERA: Color = [120, 220, 255]

export const camerasLayer: LayerDef = {
  id: 'cameras',
  group: 'land',
  label: 'Road cameras',
  hint: "The road authority's roadside cameras on the main roads around Rīga: a still every few minutes",
  defaultOn: true,
  swatch: '#78dcff',
  feeds: ['cameras'],
  describes: ['camera'],

  describe(entity, now) {
    const camera = entity as Camera
    return {
      kicker: 'Road camera',
      title: camera.props.road,
      // The frame's address changes with every snapshot, so the browser never shows an old one.
      image: { src: `${camera.props.image}?t=${camera.ts}`, alt: `Road camera view at ${camera.props.road}` },
      badges: [],
      rows: [
        { label: 'Fetched', value: formatAge(now - camera.ts) },
        { label: 'Position', value: `${formatLat(camera.lat)}  ${formatLon(camera.lon)}` },
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
  accident: { label: 'Accident', color: [255, 77, 94], radius: 6 },
  hazard: { label: 'Hazard on the road', color: [255, 190, 80], radius: 5 },
  closure: { label: 'Road closed', color: [255, 122, 110], radius: 5 },
  roadworks: { label: 'Roadworks', color: [255, 204, 102], radius: 3.5 },
}

const DAY = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Riga', day: 'numeric', month: 'short', year: 'numeric' })

export const roadEventsLayer: LayerDef = {
  id: 'road-events',
  group: 'land',
  label: 'Roadworks and incidents',
  hint: 'Accidents, hazards, closures and roadworks on the state roads, as the road authority reports them',
  defaultOn: true,
  swatch: '#ffcc66',
  feeds: ['roads'],
  describes: ['road-event'],

  describe(entity, now) {
    const { props, ts, lat, lon } = entity as RoadEvent
    const rows: InspectorModel['rows'] = [{ label: 'Kind', value: plainWords(props.type) }]
    if (props.restrictions.length > 0) rows.push({ label: 'Traffic', value: props.restrictions.map(plainWords).join(', ') })
    if (props.speedLimit !== null) rows.push({ label: 'Speed limit', value: `${props.speedLimit} km/h` })
    if (props.from !== null) rows.push({ label: 'Since', value: DAY.format(props.from) })
    if (props.until !== null) rows.push({ label: 'Until', value: DAY.format(props.until) })
    if (props.contractor) rows.push({ label: 'Contractor', value: props.contractor })
    // In Latvian, as written by the road authority.
    if (props.notes) rows.push({ label: 'Notes', value: props.notes })
    if (props.detour) rows.push({ label: 'Detour', value: props.detour })
    rows.push({ label: 'Updated', value: formatAge(now - ts) })
    rows.push({ label: 'Position', value: `${formatLat(lat)}  ${formatLon(lon)}` })
    return {
      kicker: CATEGORY[props.category].label,
      title: props.road,
      subtitle: props.place ?? undefined,
      badges: props.category === 'accident' ? [{ text: 'Accident', tone: 'danger' }] : [],
      rows,
      links: SOURCE_LINK,
    }
  },

  stats(entities) {
    const count = (category: RoadEventCategory) => (entities as RoadEvent[]).filter((event) => event.props.category === category).length
    return [
      { label: 'accidents', value: count('accident'), tone: 'danger' },
      { label: 'closed', value: count('closure'), tone: 'warn' },
    ]
  },

  build(ctx) {
    const data = getEntities('roads') as RoadEvent[]
    // Two layers so that the few urgent dots are never buried under the many roadworks.
    const urgent = data.filter((event) => event.props.category !== 'roadworks')
    const works = data.filter((event) => event.props.category === 'roadworks')
    return [
      ...dots('road-works', works, () => CATEGORY.roadworks.color, CATEGORY.roadworks.radius, ctx),
      ...dots('road-incidents', urgent, (event) => CATEGORY[event.props.category].color, 5.5, ctx),
    ]
  },
}
