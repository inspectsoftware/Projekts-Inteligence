import { getMap } from './map/instance'
import { useAlerts } from './state/alerts'
import { useFeeds } from './state/feeds'
import { useLayers } from './state/layers'
import { useSelection } from './state/selection'
import { useWindows } from './state/windows'

/**
 * Development only (never imported in production builds): puts the stores on
 * `window.__pwh` so states that are rare in real data, such as an emergency squawk,
 * can be staged from the browser console.
 */
Object.assign(window, {
  __pwh: { alerts: useAlerts, feeds: useFeeds, layers: useLayers, selection: useSelection, windows: useWindows, map: getMap },
})
