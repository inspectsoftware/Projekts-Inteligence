/**
 * Icon atlas drawn on a canvas at start-up: no image files to ship or license.
 * Every icon is an alpha mask pointing north, so layers can tint and rotate it.
 */
const CELL = 64

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
  // Bus or tram seen from above: a box with a pointed front.
  bus: 'M32 3L45 14V51C45 54.5 42.5 57 39 57H25C21.5 57 19 54.5 19 51V14Z',
  // Train seen from above, rounded nose forward.
  train: 'M32 4C38 4 41 9 41 15L41 54C41 57.5 38.5 60 35 60L29 60C25.5 60 23 57.5 23 54L23 15C23 9 26 4 32 4Z',
} as const

export type IconName = keyof typeof SHAPES

export interface IconAtlas {
  canvas: HTMLCanvasElement
  mapping: Record<IconName, { x: number; y: number; width: number; height: number; mask: true }>
}

let atlas: IconAtlas | null = null

export function getIconAtlas(): IconAtlas {
  if (atlas) return atlas

  const names = Object.keys(SHAPES) as IconName[]
  const canvas = document.createElement('canvas')
  canvas.width = CELL * names.length
  canvas.height = CELL
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#fff'

  const mapping = {} as IconAtlas['mapping']
  names.forEach((name, index) => {
    ctx.save()
    ctx.translate(index * CELL, 0)
    ctx.fill(new Path2D(SHAPES[name]))
    ctx.restore()
    mapping[name] = { x: index * CELL, y: 0, width: CELL, height: CELL, mask: true }
  })

  atlas = { canvas, mapping }
  return atlas
}
