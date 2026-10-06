import { VIEWS, flyHome, flyToView } from '../../map/camera'
import { useMap } from '../../map/instance'

/** Camera bookmarks: the whole country, and the places worth a closer look. */
export function ViewsWindow() {
  const map = useMap()

  return (
    <ul className="m-3 grid grid-cols-2 gap-px bg-line p-px">
      <li className="col-span-2">
        <button
          type="button"
          disabled={!map}
          onClick={() => map && flyHome(map)}
          className="w-full bg-ink-850 px-2 py-1.5 text-left text-[10px] tracking-[0.16em] text-fg uppercase transition-colors hover:bg-ink-700 hover:text-accent disabled:opacity-40"
        >
          Latvia overview
        </button>
      </li>
      {VIEWS.map((view) => (
        <li key={view.id}>
          <button
            type="button"
            disabled={!map}
            onClick={() => map && flyToView(map, view)}
            className="w-full truncate bg-ink-850 px-2 py-1.5 text-left text-[10px] tracking-[0.12em] text-fg-dim uppercase transition-colors hover:bg-ink-700 hover:text-accent disabled:opacity-40"
          >
            {view.label}
          </button>
        </li>
      ))}
    </ul>
  )
}
