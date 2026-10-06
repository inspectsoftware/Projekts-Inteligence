import { t } from '../i18n'
import { showRadar } from '../map/radar'
import type { LayerDef } from './types'

let remove: (() => void) | null = null

export const radarLayer: LayerDef = {
  id: 'radar',
  group: 'environment',
  label: t('Rain radar'),
  hint: t('Precipitation radar, the last two hours in ten-minute scans (RainViewer). Use the timeline to replay'),
  defaultOn: false,
  swatch: '#5aa9ff',
  feeds: [],
  attribution: [{ label: 'RainViewer', href: 'https://www.rainviewer.com' }],

  native: {
    show(map) {
      remove ??= showRadar(map)
    },
    hide() {
      remove?.()
      remove = null
    },
  },

  build: () => [],
}
