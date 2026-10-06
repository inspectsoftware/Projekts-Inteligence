import { type ChartSeries, type IodaSignals, normaliseEnergy, normaliseInternet } from '../../shared/adapters/panels'
import { type EurdepFeatures, type RawGauge, normaliseGauges, normaliseRadiation } from '../../shared/adapters/sensors'
import type { FeedDef } from './types'

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE

const CHARTS = 'https://api.energy-charts.info'

/**
 * Load, generation by source, exchange with the neighbours and the day-ahead price.
 * The transmission operator's own live figures sit behind bot protection, so these come
 * from Fraunhofer's energy-charts, which republishes ENTSO-E data a few hours behind.
 */
export const energyFeed: FeedDef = {
  id: 'energy',
  title: 'Power system',
  origins: [CHARTS],
  ttlMs: 10 * MINUTE,
  staleMs: 6 * HOUR,
  timeoutMs: 25_000,
  persist: true,
  attribution: [{ label: 'energy-charts.info / Fraunhofer ISE, ENTSO-E (CC BY 4.0)', href: 'https://www.energy-charts.info' }],
  async load({ http, now }) {
    const [power, flows, prices] = await Promise.allSettled(
      ['public_power?country=lv', 'cbpf?country=lv', 'price?bzn=LV'].map((path) =>
        http.json<ChartSeries>(`${CHARTS}/${path}`, { timeoutMs: 12_000 }),
      ),
    )
    // Half a picture is still worth showing; nothing at all is a failure.
    if (power.status === 'rejected' && prices.status === 'rejected') throw power.reason
    const got = (result: PromiseSettledResult<ChartSeries>) => (result.status === 'fulfilled' ? result.value : null)
    return { shape: 'energy', ...normaliseEnergy(got(power), got(flows), got(prices), now) }
  },
}

/** How much of Latvia's internet is reachable, from IODA's outage detection. */
export const internetFeed: FeedDef = {
  id: 'internet',
  title: 'Internet reachability',
  origins: ['https://api.ioda.inetintel.cc.gatech.edu'],
  ttlMs: 10 * MINUTE,
  staleMs: 3 * HOUR,
  timeoutMs: 25_000,
  attribution: [{ label: 'IODA, Georgia Tech', href: 'https://ioda.inetintel.cc.gatech.edu/country/LV' }],
  async load({ http, now }) {
    const until = Math.floor(now / 1000)
    const ioda = await http.json<IodaSignals>(
      `https://api.ioda.inetintel.cc.gatech.edu/v2/signals/raw/country/LV?from=${until - 24 * 3600}&until=${until}`,
    )
    return { shape: 'internet', signals: normaliseInternet(ioda) }
  },
}

/** Hourly gamma dose rate at Latvia's monitoring stations, as shared through the European EURDEP network. */
export const radiationFeed: FeedDef = {
  id: 'radiation',
  title: 'Radiation',
  origins: ['https://www.imis.bfs.de'],
  ttlMs: 30 * MINUTE,
  staleMs: 12 * HOUR,
  timeoutMs: 25_000,
  persist: true,
  attribution: [{ label: 'EURDEP via BfS (Germany)', href: 'https://odlinfo.bfs.de' }],
  async load({ http }) {
    const query = new URLSearchParams({
      service: 'WFS',
      version: '1.1.0',
      request: 'GetFeature',
      typeName: 'opendata:eurdep_latestValue',
      outputFormat: 'application/json',
      maxFeatures: '100',
      CQL_FILTER: "id LIKE 'LV%' AND analyzed_range_in_h=6",
    })
    return {
      shape: 'entities',
      entities: normaliseRadiation(await http.json<EurdepFeatures>(`https://www.imis.bfs.de/ogc/opendata/ows?${query}`)),
    }
  },
}

/** Water level and temperature at the national river, lake and coastal gauges. */
export const riversFeed: FeedDef = {
  id: 'rivers',
  title: 'River gauges',
  origins: ['https://videscentrs.lvgmc.lv'],
  ttlMs: 15 * MINUTE,
  staleMs: 6 * HOUR,
  timeoutMs: 25_000,
  persist: true,
  attribution: [{ label: 'LVĢMC', href: 'https://videscentrs.lvgmc.lv' }],
  async load({ http, now }) {
    const stations = await http.json<RawGauge[]>('https://videscentrs.lvgmc.lv/data/hymer_overview')
    return { shape: 'entities', entities: normaliseGauges(stations, now) }
  },
}
