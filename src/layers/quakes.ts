import type { Color } from '@deck.gl/core'
import { ScatterplotLayer } from '@deck.gl/layers'
import type { Entity } from '../../shared/entity'
import type { QuakeProps } from '../../shared/feeds'
import { t } from '../i18n'
import { formatLat, formatLon } from '../lib/coords'
import { formatAge, formatInt } from '../lib/format'
import { getEntities } from '../runtime/entityStore'
import { OUTLINE, SELECTED, iconScale, selectionRing } from './common'
import type { LayerDef } from './types'

type Quake = Entity<QuakeProps>

/** Felt widely from about 5, damaging from about 6. */
const colorOf = (quake: Quake): Color => (quake.props.magnitude >= 6 ? [255, 61, 85] : quake.props.magnitude >= 4.5 ? [255, 160, 60] : [240, 214, 110])
/** Each whole magnitude is ten times the shaking, so the dot grows quickly with it. */
const radiusOf = (quake: Quake) => 2 + (quake.props.magnitude - 2) ** 1.6

export const quakesLayer: LayerDef = {
  id: 'quakes',
  group: 'environment',
  label: t('Earthquakes'),
  hint: t('Earthquakes of magnitude 2.5 and up anywhere on Earth in the last 24 hours (US Geological Survey)'),
  defaultOn: false,
  swatch: '#ffa03c',
  feeds: ['quakes'],
  describes: ['quake'],

  describe(entity, now) {
    const { props, lat, lon, ts } = entity as Quake
    return {
      kicker: t('Earthquake'),
      title: `M ${props.magnitude.toFixed(1)}`,
      subtitle: props.place,
      badges: props.tsunami ? [{ text: t('Tsunami message issued'), tone: 'danger' }] : [],
      rows: [
        { label: t('When'), value: formatAge(now - ts) },
        { label: t('Depth'), value: props.depthKm === null ? '–' : `${formatInt(props.depthKm)} km` },
        { label: t('Position'), value: `${formatLat(lat)}  ${formatLon(lon)}` },
      ],
      links: [{ label: 'USGS', href: props.url }],
    }
  },

  stats(entities) {
    return [{ label: t('of magnitude 5 or more'), value: (entities as Quake[]).filter((quake) => quake.props.magnitude >= 5).length, tone: 'warn' }]
  },

  build({ now, zoom, selectedId, hoveredId }) {
    const data = getEntities('quakes') as Quake[]
    const highlight = `${selectedId}|${hoveredId}`
    return [
      new ScatterplotLayer<Quake>({
        id: 'quakes',
        data,
        pickable: true,
        getPosition: (quake) => [quake.lon, quake.lat],
        getRadius: radiusOf,
        radiusUnits: 'pixels',
        getFillColor: (quake) => {
          if (quake.id === selectedId || quake.id === hoveredId) return SELECTED
          const [r, g, b] = colorOf(quake)
          return [r, g, b, 170]
        },
        getLineColor: OUTLINE,
        getLineWidth: 1,
        lineWidthUnits: 'pixels',
        stroked: true,
        updateTriggers: { getFillColor: highlight },
      }),
      selectionRing(
        'quakes-selection',
        data.filter((quake) => quake.id === selectedId),
        now,
        14,
        iconScale(zoom),
      ),
    ]
  },
}
