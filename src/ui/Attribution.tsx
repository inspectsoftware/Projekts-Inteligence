import { t } from '../i18n'

const CREDITS = 'https://github.com/inspectsoftware/Projekts-Inteligence#data-sources'

/**
 * One line in the corner. OpenStreetMap's licence asks for its credit on the map itself; every
 * other source is credited, with its terms, in the public README the second link leads to.
 */
export function Attribution() {
  const link = 'hover:text-fg'
  return (
    <p data-snap="credits" className="pointer-events-auto absolute right-3 bottom-3 z-10 bg-ink-900/70 px-1.5 py-0.5 text-[9px] text-fg-mute">
      <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer noopener" className={link}>
        © OpenStreetMap
      </a>
      {' · '}
      <a href={CREDITS} target="_blank" rel="noreferrer noopener" className={link}>
        {t('Credits')}
      </a>
    </p>
  )
}
