import { t } from '../i18n'

const CREDITS = 'https://github.com/inspectsoftware/Projekts-Inteligence#data-sources'

/**
 * One line in the bottom right corner. OpenStreetMap's licence asks for its credit on the map
 * itself; every other source is credited, with its terms, in the public README the second link leads
 * to. On a phone, where the HUD fills the bottom row, it moves up under the top bar.
 */
export function Attribution() {
  const link = 'hover:text-fg'
  return (
    <p data-snap="credits" className="pointer-events-auto absolute right-3 bottom-2 z-10 rounded-md bg-ink-900/70 px-1.5 py-0.5 text-[9px] text-fg-mute max-md:top-12 max-md:right-auto max-md:bottom-auto max-md:left-3">
      <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer noopener" className={link}>
        © OpenStreetMap
      </a>
      {' · '}
      {/* The 3D buildings near the camera come from Overture, under the same licence as the map data. */}
      <a href="https://docs.overturemaps.org/attribution/" target="_blank" rel="noreferrer noopener" className={link}>
        © Overture Maps
      </a>
      {' · '}
      <a href={CREDITS} target="_blank" rel="noreferrer noopener" className={link}>
        {t('Credits')}
      </a>
    </p>
  )
}
