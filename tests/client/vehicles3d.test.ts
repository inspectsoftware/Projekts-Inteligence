import { describe, expect, it } from 'vitest'
import { PARTS, alongPath } from '../../src/map/vehicles3d'

describe('articulated vehicles in 3D', () => {
  it('lays a tram section by section along a straight line', () => {
    // Come from the west, at the origin now, going on east.
    const behind: [number, number][] = [[-50, 0], [0, 0]]
    const ahead: [number, number][] = [[0, 0], [50, 0]]
    for (const { at } of PARTS.tram) {
      const [x, y, angle] = alongPath(behind, ahead, at)
      expect(x).toBeCloseTo(at)
      expect(y).toBeCloseTo(0)
      expect(angle).toBeCloseTo(0)
    }
  })

  it('bends round a corner: the front section on the new street, the back one still on the old', () => {
    // Come from the south up x = 0, turning east at the origin.
    const behind: [number, number][] = [[0, -40], [0, 0]]
    const ahead: [number, number][] = [[0, 0], [40, 0]]
    const [fx, fy, front] = alongPath(behind, ahead, 10.1)
    const [bx, by, back] = alongPath(behind, ahead, -10.1)
    expect([fx, fy]).toEqual([expect.closeTo(10.1), expect.closeTo(0)])
    expect(front).toBeCloseTo(0)
    expect([bx, by]).toEqual([expect.closeTo(0), expect.closeTo(-10.1)])
    expect(back).toBeCloseTo(Math.PI / 2)
  })

  it('carries straight on past the ends of what it knows', () => {
    const [x, y] = alongPath([[-1, 0], [0, 0]], [[0, 0], [1, 0]], 25.3)
    expect(x).toBeCloseTo(25.3)
    expect(y).toBeCloseTo(0)
  })
})
