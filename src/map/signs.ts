/**
 * Road signs for road events, drawn on a canvas at start-up in their own colours (not tintable
 * masks, unlike map/icons.ts): roadworks, road closed, an accident or a hazard, as a driver knows
 * them from the roadside.
 */
const CELL = 64
/** Drawn this many times finer than the 64-unit outlines, so a sign stays sharp when drawn large. */
const RES = 3

export type SignName = 'roadworks' | 'closure' | 'accident' | 'hazard'

const RED = '#d0202a'
const INK = '#1a1a1a'

/** The warning triangle every sign but "no entry" stands on: red rim, white face. */
function triangle(ctx: CanvasRenderingContext2D): void {
  const outer = new Path2D('M32 5C34 5 35.2 6 36.2 7.8L60 50C61.6 53 60 57 56.5 57H7.5C4 57 2.4 53 4 50L27.8 7.8C28.8 6 30 5 32 5Z')
  ctx.fillStyle = '#ffffff'
  ctx.fill(outer)
  ctx.strokeStyle = 'rgba(0,0,0,0.35)'
  ctx.lineWidth = 1.5
  ctx.stroke(outer)
  ctx.fillStyle = RED
  ctx.fill(new Path2D('M32 9.5L57.2 52.5H6.8ZM32 19.5L15.2 47.5H48.8Z'), 'evenodd')
}

const DRAW: Record<SignName, (ctx: CanvasRenderingContext2D) => void> = {
  // A man digging, on the warning triangle.
  roadworks(ctx) {
    triangle(ctx)
    ctx.fillStyle = INK
    ctx.fill(new Path2D('M33.5 25.2a2.6 2.6 0 1 0 0.01 0Z'))
    ctx.fill(new Path2D('M29.6 30.5L34.6 29.6L36.4 37.2L40.6 42.6L38.4 44.2L34.2 39L31.2 40.6L29.2 45H26.4L28.8 38.6L31.4 36.4Z'))
    ctx.fill(new Path2D('M22 44.6H31V46.2H22ZM36.8 31.4L43.6 41.4L42.2 42.4L35.4 32.4Z'))
  },
  // No entry: the red disc with its white bar.
  closure(ctx) {
    ctx.fillStyle = '#ffffff'
    ctx.fill(new Path2D('M32 4a28 28 0 1 0 0.01 0Z'))
    ctx.fillStyle = RED
    ctx.fill(new Path2D('M32 6.5a25.5 25.5 0 1 0 0.01 0Z'))
    ctx.fillStyle = '#ffffff'
    ctx.fill(new Path2D('M14 28.5H50V35.5H14Z'))
  },
  // Two cars meeting, on the warning triangle.
  accident(ctx) {
    triangle(ctx)
    ctx.fillStyle = INK
    ctx.fill(new Path2D('M20 33.5L27.5 31.5L30.5 36L31 43.5L21.5 46L19.5 41.5ZM44 33.5L36.5 31.5L33.5 36L33 43.5L42.5 46L44.5 41.5Z'))
  },
  // The exclamation mark: some other danger on the road.
  hazard(ctx) {
    triangle(ctx)
    ctx.fillStyle = INK
    ctx.fill(new Path2D('M29.8 25H34.2L33.4 40H30.6ZM32 42.2a2.4 2.4 0 1 0 0.01 0Z'))
  },
}

export interface SignAtlas {
  canvas: HTMLCanvasElement
  mapping: Record<SignName, { x: number; y: number; width: number; height: number; mask: false }>
}

let atlas: SignAtlas | null = null

export function getSignAtlas(): SignAtlas {
  if (atlas) return atlas
  const names = Object.keys(DRAW) as SignName[]
  const side = CELL * RES
  const canvas = document.createElement('canvas')
  canvas.width = side * names.length
  canvas.height = side
  const ctx = canvas.getContext('2d')!
  const mapping = {} as SignAtlas['mapping']
  names.forEach((name, index) => {
    ctx.save()
    ctx.translate(index * side, 0)
    ctx.scale(RES, RES)
    DRAW[name](ctx)
    ctx.restore()
    mapping[name] = { x: index * side, y: 0, width: side, height: side, mask: false }
  })
  atlas = { canvas, mapping }
  return atlas
}
