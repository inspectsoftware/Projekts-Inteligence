import { useEffect } from 'react'
import { useWindows } from '../../state/windows'
import { Window } from './Window'
import { WINDOWS, useNarrow, useShownWindows } from './registry'

/**
 * Every window on screen, above the map and under the top bar. Windows are always rendered in
 * registry order and stacked with z-index, never by moving them in the DOM: that would reload
 * a video frame inside one.
 */
export function WindowLayer() {
  const shown = useShownWindows()
  const sheet = useNarrow()

  // A mode window comes to the front, opened out, whenever it has something new to show: the way
  // a window opened from the dock does. Not on every change, since the selection also changes on hover.
  useEffect(() => {
    const stops = WINDOWS.flatMap((def) => {
      const mode = def.mode
      if (!mode) return []
      // What is already showing when the page loads is left where it was.
      let last = mode.subject()
      const check = () => {
        const subject = mode.subject()
        if (subject !== null && subject !== last) {
          const { windows, focus, setCollapsed } = useWindows.getState()
          focus(def.id)
          if (windows[def.id]?.collapsed) setCollapsed(def.id, false)
        }
        last = subject
      }
      return [mode.subscribe(check)]
    })
    return () => {
      for (const stop of stops) stop()
    }
  }, [])

  return (
    <div className="window-layer pointer-events-none absolute inset-0 z-10">
      {shown.map((def) => (
        <Window key={def.id} def={def} sheet={sheet} />
      ))}
      {/* The magnet lines. A drag moves and shows them straight in the DOM. */}
      <i className="window-guide inset-y-0 w-px" data-guide="x" hidden />
      <i className="window-guide inset-x-0 h-px" data-guide="y" hidden />
    </div>
  )
}
