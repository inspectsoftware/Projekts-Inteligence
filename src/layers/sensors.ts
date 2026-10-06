import type { Color } from '@deck.gl/core'
import type { Gauge, RadiationStation } from '../../shared/adapters/sensors'
import { RADIATION_ALERT_USVH } from '../../shared/alerts/rules'
import { t } from '../i18n'
import { formatLat, formatLon } from '../lib/coords'
import { formatAge } from '../lib/format'
import { getEntities } from '../runtime/entityStore'
import { dots } from './common'
import type { InspectorModel, LayerDef } from './types'

const position = (entity: { lat: number; lon: number }) => ({ label: t('Position'), value: `${formatLat(entity.lat)}  ${formatLon(entity.lon)}` })

const NORMAL: Color = [126, 214, 170]
const RAISED: Color = [255, 190, 80]
const HIGH: Color = [255, 77, 94]

/** Natural background sits around 0.05 to 0.2 µSv/h. */
const doseColor = (usvh: number): Color => (usvh >= RADIATION_ALERT_USVH ? HIGH : usvh >= 0.2 ? RAISED : NORMAL)

export const radiationLayer: LayerDef = {
  id: 'radiation',
  group: 'environment',
  label: t('Radiation'),
  hint: t('Hourly gamma dose rate at the national monitoring stations, as shared through the European EURDEP network'),
  defaultOn: false,
  swatch: '#7ed6aa',
  feeds: ['radiation'],
  describes: ['radiation'],

  describe(entity, now) {
    const station = entity as RadiationStation
    const { usvh } = station.props
    return {
      kicker: t('Radiation monitor'),
      title: station.props.name,
      badges: usvh >= RADIATION_ALERT_USVH ? [{ text: t('Above normal background'), tone: 'danger' }] : [{ text: t('Normal background'), tone: 'ok' }],
      rows: [
        { label: t('Gamma dose rate'), value: `${usvh.toFixed(3)} µSv/h` },
        { label: t('Measured'), value: formatAge(now - station.ts) },
        position(station),
      ],
      links: [{ label: t('EURDEP map'), href: 'https://remap.jrc.ec.europa.eu/Advanced.aspx' }],
    }
  },

  stats(entities) {
    const raised = (entities as RadiationStation[]).filter((station) => station.props.usvh >= RADIATION_ALERT_USVH).length
    return [{ label: t('above normal'), value: raised, tone: 'danger' }]
  },

  build: (ctx) =>
    dots(
      'radiation',
      getEntities('radiation') as RadiationStation[],
      (station) => doseColor(station.props.usvh),
      4.5,
      ctx,
    ),
}

const RIVER: Color = [95, 176, 255]
const COAST: Color = [130, 225, 235]

export const gaugesLayer: LayerDef = {
  id: 'rivers',
  group: 'environment',
  label: t('River gauges'),
  hint: t('Water level and temperature at the national river, lake and coastal gauges (LVĢMC)'),
  defaultOn: false,
  swatch: '#5fb0ff',
  feeds: ['rivers'],
  describes: ['gauge'],

  describe(entity, now) {
    const gauge = entity as Gauge
    const { props } = gauge
    const rows: InspectorModel['rows'] = []
    if (props.levelM !== null) rows.push({ label: t('Water level'), value: `${props.levelM.toFixed(2)} m` })
    if (props.tempC !== null) rows.push({ label: t('Water temperature'), value: `${props.tempC.toFixed(1)} °C` })
    if (props.dischargeM3s !== null) rows.push({ label: t('Flow'), value: `${props.dischargeM3s.toFixed(1)} m³/s` })
    rows.push({ label: t('Measured'), value: formatAge(now - gauge.ts) }, position(gauge))
    return {
      kicker: props.coastal ? t('Coastal gauge') : t('River gauge'),
      title: props.name,
      // The level is measured from each gauge's own zero, so it only compares with that gauge's past.
      subtitle: props.levelM !== null ? t("Level above the gauge's own zero") : undefined,
      badges: [],
      rows,
      links: [{ label: t('LVĢMC hydrology'), href: 'https://videscentrs.lvgmc.lv/' }],
    }
  },

  build: (ctx) => dots('gauges', getEntities('rivers') as Gauge[], (gauge) => (gauge.props.coastal ? COAST : RIVER), 3.5, ctx),
}
