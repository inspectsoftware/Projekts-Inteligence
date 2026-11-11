/**
 * Icon atlas drawn on a canvas at start-up: no image files to ship or license.
 * Every icon is an alpha mask pointing north, so layers can tint and rotate it.
 */
const CELL = 64
/** Drawn this many times finer than the 64-unit outlines, so a vehicle shown large close in stays sharp. */
const RES = 4
const COLUMNS = 8

/** SVG path data in a 64x64 box, nose up. */
const SHAPES = {
  // Swept-wing airliner.
  jet: 'M32 3C35 3 36.5 8 36.5 14L36.5 24L60 41L60 46L36.5 39L36 52L44 58L44 61L32 58L20 61L20 58L28 52L27.5 39L4 46L4 41L27.5 24L27.5 14C27.5 8 29 3 32 3Z',
  // Straight-wing propeller aircraft.
  prop: 'M32 5C34.5 5 35.5 9 35.5 13L35.5 22L58 24L58 30L35.5 31L34.5 50L42 53L42 57L32 56L22 57L22 53L29.5 50L28.5 31L6 30L6 24L28.5 22L28.5 13C28.5 9 29.5 5 32 5Z',
  // Delta wing, for high-performance aircraft.
  fast: 'M32 3L36 20L58 48L58 53L38 49L37 56L42 60L22 60L27 56L26 49L6 53L6 48L28 20Z',
  // Helicopter: body, tail boom, tail rotor and a rotor cross.
  heli: 'M32 13C36.5 13 39 18 39 25C39 32 36.5 38 33.5 38L33.5 54L38 54L38 57L26 57L26 54L30.5 54L30.5 38C27.5 38 25 32 25 25C25 18 27.5 13 32 13ZM11.5 6.5L13.5 4.5L52.5 43.5L50.5 45.5ZM50.5 4.5L52.5 6.5L13.5 45.5L11.5 43.5Z',
  // Anything on the ground or of unknown shape.
  dot: 'M32 20L44 32L32 44L20 32Z',
  // Satellite: a bus with a solar panel on each side.
  sat: 'M26 24H38V40H26ZM4 27H22V37H4ZM42 27H60V37H42ZM22 30.5H26V33.5H22ZM38 30.5H42V33.5H38Z',
  // Ship seen from above: a hull with a pointed bow.
  ship: 'M32 3C38 11 42 20 42 29V54C42 57 40 59 37 59H27C24 59 22 57 22 54V29C22 20 26 11 32 3Z',
} as const

/**
 * Public transport seen from above, nose up: a body, and details cut out of it (windscreens, roof
 * hatches, trolley poles, the joints of an articulated tram) through which the dark halo drawn
 * beneath shows. Each also has a plain silhouette, `<name>-halo`, for that halo. `length` is how much
 * of the 64-unit cell the vehicle's own body spans nose to tail, for drawing it to scale.
 */
const VEHICLES = {
  bus: {
    body: 'M26 4H38Q43 4 43 9V55Q43 60 38 60H26Q21 60 21 55V9Q21 4 26 4Z',
    cut: 'M24.5 8.5H39.5V13.5H24.5ZM25.5 54H38.5V56.5H25.5ZM28 21H36V26H28ZM28 37H36V42H28Z',
    length: 56,
  },
  // Shorter, its two poles running back over the roof and past the tail.
  trolleybus: {
    body: 'M26 6H38Q43 6 43 11V47Q43 52 38 52H26Q21 52 21 47V11Q21 6 26 6ZM28 28H30V62H28ZM34 28H36V62H34Z',
    cut: 'M24.5 10.5H39.5V15.5H24.5Z',
    length: 46,
  },
  // Long and narrow, in three sections joined by two bellows.
  tram: {
    body: 'M28 2H36Q40 2 40 6V58Q40 62 36 62H28Q24 62 24 58V6Q24 2 28 2Z',
    cut: 'M26.5 5.5H37.5V9.5H26.5ZM24 22H40V23.5H24ZM24 41H40V42.5H24Z',
    length: 60,
  },
  // A van: short, with a deep windscreen.
  minibus: {
    body: 'M27 12H37Q41 12 41 16V50Q41 54 37 54H27Q23 54 23 50V16Q23 12 27 12Z',
    cut: 'M25.5 15.5H38.5V22H25.5Z',
    length: 42,
  },
  // Three narrow cars, rounded nose forward.
  train: {
    body: 'M32 2C37 2 39.5 6 39.5 11V58Q39.5 62 35.5 62H28.5Q24.5 62 24.5 58V11C24.5 6 27 2 32 2Z',
    cut: 'M27.5 7H36.5V10.5H27.5ZM24.5 22H39.5V23.5H24.5ZM24.5 42H39.5V43.5H24.5Z',
    length: 60,
  },
} as const

export type VehicleIcon = keyof typeof VEHICLES
export type IconName = keyof typeof SHAPES | VehicleIcon | `${VehicleIcon}-halo`

/** How much of its icon a vehicle's body fills, nose to tail: what drawing it to scale divides by. */
export function vehicleFill(icon: VehicleIcon): number {
  return VEHICLES[icon].length / CELL
}

export interface IconAtlas {
  canvas: HTMLCanvasElement
  mapping: Record<IconName, { x: number; y: number; width: number; height: number; mask: true }>
}

let atlas: IconAtlas | null = null

export function getIconAtlas(): IconAtlas {
  if (atlas) return atlas

  // Each icon as what to fill: plain shapes whole, vehicles with their details cut out (even-odd),
  // and each vehicle's silhouette once more for its halo.
  const draws: [IconName, (ctx: CanvasRenderingContext2D) => void][] = [
    ...(Object.keys(SHAPES) as (keyof typeof SHAPES)[]).map((name): [IconName, (ctx: CanvasRenderingContext2D) => void] => [name, (ctx) => ctx.fill(new Path2D(SHAPES[name]))]),
    ...(Object.keys(VEHICLES) as VehicleIcon[]).flatMap((name): [IconName, (ctx: CanvasRenderingContext2D) => void][] => [
      [name, (ctx) => ctx.fill(new Path2D(`${VEHICLES[name].body}${VEHICLES[name].cut}`), 'evenodd')],
      [`${name}-halo`, (ctx) => ctx.fill(new Path2D(VEHICLES[name].body), 'nonzero')],
    ]),
  ]
  // In rows of eight: one long row would pass the 4096 px some phones' graphics take as a texture.
  const side = CELL * RES
  const canvas = document.createElement('canvas')
  canvas.width = side * Math.min(COLUMNS, draws.length)
  canvas.height = side * Math.ceil(draws.length / COLUMNS)
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#fff'

  const mapping = {} as IconAtlas['mapping']
  draws.forEach(([name, draw], index) => {
    const [x, y] = [(index % COLUMNS) * side, Math.floor(index / COLUMNS) * side]
    ctx.save()
    ctx.translate(x, y)
    ctx.scale(RES, RES)
    draw(ctx)
    ctx.restore()
    mapping[name] = { x, y, width: side, height: side, mask: true }
  })

  atlas = { canvas, mapping }
  return atlas
}
