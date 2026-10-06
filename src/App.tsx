import { MapView } from './map/MapView'
import { AlertStack } from './ui/AlertStack'
import { Attribution } from './ui/Attribution'
import { CommandPalette } from './ui/CommandPalette'
import { Hud } from './ui/Hud'
import { Inspector } from './ui/Inspector'
import { LeftRail } from './ui/LeftRail'
import { MapButtons } from './ui/MapButtons'
import { RadarControl } from './ui/RadarControl'
import { TopBar } from './ui/TopBar'

export default function App() {
  return (
    <div className="relative h-full w-full overflow-hidden">
      <MapView />
      <TopBar />
      <LeftRail />
      <MapButtons />
      <AlertStack />
      <Inspector />
      <RadarControl />
      <Hud />
      <Attribution />
      <CommandPalette />
    </div>
  )
}
