import { MapView } from './map/MapView'
import { Attribution } from './ui/Attribution'
import { Hud } from './ui/Hud'
import { LeftRail } from './ui/LeftRail'
import { MapButtons } from './ui/MapButtons'
import { TopBar } from './ui/TopBar'

export default function App() {
  return (
    <div className="relative h-full w-full overflow-hidden">
      <MapView />
      <TopBar />
      <LeftRail />
      <MapButtons />
      <Hud />
      <Attribution />
    </div>
  )
}
