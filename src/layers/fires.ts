import { ScatterplotLayer } from '@deck.gl/layers'
import type { Fire } from '../../shared/adapters/fires'
import type { Entity } from '../../shared/entity'
import { t } from '../i18n'
import { formatLat, formatLon, formatMgrs } from '../lib/coords'
import { formatAge } from '../lib/format'
import { getEntities } from '../runtime/entityStore'
import { iconScale, selectionRing } from './common'
import type { InspectorModel, LayerDef } from './types'

const CONFIDENCE_TEXT = { low: t('Low'), nominal: t('Nominal'), high: t('High') } as const

function describe(entity: Entity, now: number): InspectorModel {
  const fire = entity as Fire
  const { props } = fire
  const badges: InspectorModel['badges'] = []
  if (props.confidence === 'high') badges.push({ text: t('High confidence'), tone: 'danger' })
  if (props.confidence === 'low') badges.push({ text: t('Low confidence'), tone: 'info' })

  return {
    kicker: t('Heat source seen from orbit'),
    title: props.frpMw === null ? t('Fire detection') : `${props.frpMw.toFixed(1)} MW`,
    subtitle: t('Fire radiative power'),
    badges,
    rows: [
      { label: t('Detected'), value: formatAge(now - fire.ts) },
      { label: t('Pass'), value: props.night ? t('Night') : t('Day') },
      { label: t('Brightness'), value: props.brightnessK === null ? '–' : `${props.brightnessK.toFixed(0)} K` },
      { label: t('Confidence'), value: props.confidence ? CONFIDENCE_TEXT[props.confidence] : '–' },
      { label: t('Satellite'), value: props.satellite ?? '–' },
      { label: t('Position'), value: `${formatLat(fire.lat)}  ${formatLon(fire.lon)}` },
      { label: 'MGRS', value: formatMgrs(fire.lon, fire.lat) },
    ],
    links: [{ label: t('NASA FIRMS map'), href: `https://firms.modaps.eosdis.nasa.gov/map/#d:24hrs;@${fire.lon.toFixed(2)},${fire.lat.toFixed(2)},10z` }],
  }
}

export const firesLayer: LayerDef = {
  id: 'fires',
  group: 'environment',
  label: t('Fires'),
  hint: t('Heat sources detected by the VIIRS satellite sensor in the last 24 hours (NASA FIRMS): all of them around the Baltic, the strongest elsewhere'),
  defaultOn: true,
  swatch: '#ff7a3d',
  feeds: ['fires'],
  describes: ['fire'],
  describe,

  build({ now, zoom, selectedId, hoveredId }) {
    const data = getEntities('fires') as Fire[]
    const highlight = `${selectedId}|${hoveredId}`
    const base = {
      data,
      getPosition: (fire: Fire) => [fire.lon, fire.lat] as [number, number],
      radiusUnits: 'pixels' as const,
    }
    // Stronger fires draw bigger, on a square-root scale so one large fire does not hide the rest.
    const radius = (fire: Fire) => 4 + Math.min(10, Math.sqrt(fire.props.frpMw ?? 1))

    return [
      new ScatterplotLayer<Fire>({
        ...base,
        id: 'fires-glow',
        getRadius: (fire) => radius(fire) * 2.2,
        getFillColor: [255, 96, 40, 55],
      }),
      new ScatterplotLayer<Fire>({
        ...base,
        id: 'fires',
        pickable: true,
        getRadius: radius,
        getFillColor: (fire) =>
          fire.id === selectedId || fire.id === hoveredId ? [255, 255, 255] : [255, 122, 61, 235],
        getLineColor: [255, 220, 150, 255],
        getLineWidth: 1,
        lineWidthUnits: 'pixels',
        stroked: true,
        updateTriggers: { getFillColor: highlight },
      }),
      selectionRing(
        'fires-selection',
        data.filter((fire) => fire.id === selectedId),
        now,
        16,
        iconScale(zoom),
      ),
    ]
  },
}
