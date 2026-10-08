import { useEffect } from 'react'
import { MapView } from './map/MapView'
import { useTheme } from './state/ui'
import { Attribution } from './ui/Attribution'
import { CommandPalette } from './ui/CommandPalette'
import { Dock } from './ui/Dock'
import { Hud } from './ui/Hud'
import { MapButtons } from './ui/MapButtons'
import { PoliticsPage } from './ui/PoliticsPage'
import { onPoliticsPage } from './ui/politics'
import { TopBar } from './ui/TopBar'
import { WindowLayer } from './ui/windows/WindowLayer'

export default function App() {
  const theme = useTheme()
  // On the root element, so the palette in index.css changes for every page and panel at once.
  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  // A page of its own, without the map: light enough to leave open all day.
  if (onPoliticsPage()) return <PoliticsPage />
  return (
    <div className="relative h-full w-full overflow-hidden">
      <MapView />
      <TopBar />
      <Dock />
      <MapButtons />
      <Hud />
      <WindowLayer />
      {/* After the windows, so the credits the licences ask for are never covered by one. */}
      <Attribution />
      <CommandPalette />
    </div>
  )
}
