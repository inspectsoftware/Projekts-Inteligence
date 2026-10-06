import type { Feature, FeatureCollection, Point } from 'geojson'
import { useEffect, useState } from 'react'
import { t } from '../../../i18n'
import { COUNTRY_NAMES, SITES_URL, SITE_KINDS, type SiteProperties, militarySitesLayer, showSite } from '../../../layers/military'
import { SectionTitle } from '../../kit'

type Site = Feature<Point, SiteProperties>

const KIND_ORDER = Object.keys(SITE_KINDS)

/** Everything a visitor might type to find a site: its name, what it is, whose it is, where. */
const haystack = ({ properties: p }: Site) =>
  [p.name, SITE_KINDS[p.kind], p.operator, COUNTRY_NAMES[p.country], p.note].join(' ').toLowerCase()

/** Bases, training areas and radar sites around the Baltic, by country. Opening one flies there and shows its source. */
export function SitesTab() {
  const [sites, setSites] = useState<Site[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [query, setQuery] = useState('')

  // A small baked file, asked for when the tab is shown. The browser's cache answers the next time.
  useEffect(() => {
    const controller = new AbortController()
    fetch(SITES_URL, { signal: controller.signal })
      .then((res) => (res.ok ? (res.json() as Promise<FeatureCollection<Point, SiteProperties>>) : Promise.reject(new Error('not found'))))
      .then((file) => setSites(file.features))
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true)
      })
    return () => controller.abort()
  }, [])

  if (failed) return <p className="text-fg-mute">{t('The list of sites could not be loaded.')}</p>
  if (!sites) return <p className="text-fg-mute">{t('Loading…')}</p>

  const wanted = query.trim().toLowerCase()
  const shown = sites
    .filter((site) => haystack(site).includes(wanted))
    .sort(
      (a, b) =>
        KIND_ORDER.indexOf(a.properties.kind) - KIND_ORDER.indexOf(b.properties.kind) || a.properties.name.localeCompare(b.properties.name),
    )

  return (
    <>
      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={t('Filter by name, kind, operator or country')}
        aria-label={t('Filter the sites')}
        className="mb-2 w-full border border-line bg-ink-850 px-2 py-1 text-[11px] text-fg placeholder:text-fg-mute focus:border-accent focus:outline-none"
      />
      {shown.length === 0 && <p className="text-fg-mute">{t('No site matches.')}</p>}
      {Object.entries(COUNTRY_NAMES).map(([code, country]) => {
        const here = shown.filter((site) => site.properties.country === code)
        if (here.length === 0) return null
        return (
          <section key={code} className="mb-3">
            <SectionTitle>{country}</SectionTitle>
            <ul className="divide-y divide-line/50">
              {here.map(({ properties, geometry }) => (
                <li key={properties.name}>
                  <button
                    type="button"
                    onClick={() => showSite(properties, geometry.coordinates[0], geometry.coordinates[1])}
                    title={t('Show on the map')}
                    className="grid w-full gap-x-3 px-1 py-1 text-left transition-colors hover:bg-ink-700"
                  >
                    <span className="truncate text-fg">
                      {properties.name}
                      <span className="ml-2 text-[9.5px] tracking-[0.12em] text-mil uppercase">{SITE_KINDS[properties.kind]}</span>
                    </span>
                    <span className="truncate text-[10px] text-fg-dim">{properties.operator ?? properties.note}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )
      })}
      <p className="text-[10px] text-fg-mute">
        {t('A reference list, not an inventory. Each entry says only what the public page it links to says, and a hollow marker stands on a town or an area rather than on the site itself.')}
      </p>
      <p className="mt-2 text-[9.5px] text-fg-mute">
        {t('Data:')}{' '}
        {militarySitesLayer.attribution!.map((credit, index) => (
          <span key={credit.href}>
            {index > 0 && ' · '}
            <a href={credit.href} target="_blank" rel="noreferrer noopener" className="hover:text-fg">
              {credit.label}
            </a>
          </span>
        ))}
      </p>
      <p className="mt-2 text-[10px] text-fg-mute">
        <a
          href="https://www.submarinecablemap.com"
          target="_blank"
          rel="noreferrer noopener"
          className="text-fg-dim underline decoration-line-strong underline-offset-2 hover:text-accent"
        >
          submarinecablemap.com ↗
        </a>{' '}
        {t('TeleGeography’s map of undersea cables, which may be looked at but not copied')}
      </p>
    </>
  )
}
