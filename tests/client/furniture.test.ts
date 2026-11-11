import { describe, expect, it } from 'vitest'
import { armsAt, furnitureMesh, halfWidth, nearest, placeFurniture } from '../../src/map/furniture'

// A street drawn from west to east along y = 0, two lanes each way: 6.8 m from its middle to a kerb.
const street = [{ ax: -100, ay: 0, bx: 100, by: 0, half: halfWidth({ class: 'primary' }) }]

describe('street furniture', () => {
  it('takes a road half its lanes wide', () => {
    expect(halfWidth({ class: 'primary' })).toBeCloseTo(6.8)
    expect(halfWidth({ class: 'residential', oneway: 'yes' })).toBeCloseTo(2)
    expect(halfWidth({ class: 'secondary', lanes: '3' })).toBeCloseTo(5.2)
  })

  it('finds the nearest point of a street', () => {
    const near = nearest(street, 10, 5)!
    expect([near.px, near.py, near.distance].map((v) => Math.round(v * 1000) / 1000)).toEqual([10, 0, 5])
  })

  it('stands a two-way light on each kerb, facing the traffic it is for', () => {
    const [right, left] = placeFurniture([{ x: 0, y: 0, kind: 'road', direction: '' }], [], street)
    // Eastbound traffic keeps right, to the south: its light there faces west, back at it.
    expect(right.y).toBeCloseTo(-7.5)
    expect(Math.cos(right.facing)).toBeCloseTo(-1)
    expect(left.y).toBeCloseTo(7.5)
    expect(Math.cos(left.facing)).toBeCloseTo(1)
  })

  it('stands a one-way light on the right kerb only', () => {
    const placed = placeFurniture([{ x: 0, y: 0, kind: 'road', direction: '' }], [], [{ ...street[0], oneway: true }])
    expect(placed).toHaveLength(1)
    expect(placed[0].y).toBeLessThan(0)
  })

  it('stands a light at a crossroads for each street coming in, at its right-hand kerb, back from the corner', () => {
    // Two streets crossing at the origin, each drawn in two halves from it, and each half twice (two tiles).
    const half = halfWidth({ class: 'secondary' })
    const arm = (bx: number, by: number) => ({ ax: 0, ay: 0, bx, by, half })
    const cross = [arm(80, 0), arm(-80, 0), arm(0, 80), arm(0, -80), arm(80, 0)]
    expect(armsAt(cross, 0, 0)).toHaveLength(4)
    const placed = placeFurniture([{ x: 0, y: 0, kind: 'road', direction: '' }], [], cross)
    expect(placed).toHaveLength(4)
    // The eastern arm: cars come in heading west, their right is the north; the light faces east, at them.
    const east = placed.find((p) => p.x > half)!
    expect(east.y).toBeCloseTo(half + 0.7)
    expect(east.x).toBeCloseTo(half + 1)
    expect(Math.cos(east.facing)).toBeCloseTo(1)
    // None stands on a road: each is beyond both streets' kerbs.
    for (const p of placed) expect(Math.min(Math.abs(p.x), Math.abs(p.y))).toBeGreaterThan(half)
  })

  it('stands no light where a one-way street only leaves the junction', () => {
    const half = halfWidth({ class: 'secondary' })
    const cross = [
      { ax: 0, ay: 0, bx: 80, by: 0, half, oneway: true },
      { ax: -80, ay: 0, bx: 0, by: 0, half, oneway: true },
      { ax: 0, ay: 0, bx: 0, by: 80, half },
    ]
    expect(placeFurniture([{ x: 0, y: 0, kind: 'road', direction: '' }], [], cross)).toHaveLength(2)
  })

  it('turns a crossing light on each kerb across the road', () => {
    const placed = placeFurniture([{ x: 0, y: 0, kind: 'crossing', direction: '' }], [], street)
    expect(placed.map((p) => Math.round(p.y * 10) / 10).sort()).toEqual([-7.5, 7.5])
    for (const p of placed) expect(Math.abs(Math.cos(p.facing))).toBeCloseTo(0)
  })

  it('sets a stop off the road, its back away from it', () => {
    // Mapped north of the street but on its tarmac: moved to the kerb's far side.
    const [stop] = placeFurniture([], [{ x: 0, y: 3, mode: 'bus', shelter: 'yes' }], street)
    expect(stop.y).toBeGreaterThan(street[0].half)
    // The shelter's +y, its back, is the frame's left: north here, away from the road.
    expect(Math.sin(stop.facing + Math.PI / 2)).toBeCloseTo(1)
  })

  it('leaves out what is far from any street', () => {
    expect(placeFurniture([{ x: 0, y: 60, kind: 'road', direction: '' }], [{ x: 0, y: 90, mode: 'bus', shelter: '' }], street)).toEqual([])
  })

  it('puts the glass after everything solid', () => {
    const mesh = furnitureMesh(placeFurniture([], [{ x: 0, y: 10, mode: 'tram', shelter: 'yes' }], street))
    expect(mesh.count).toBeGreaterThan(mesh.opaque)
    expect(mesh.colors[(mesh.opaque - 1) * 4 + 3]).toBe(255)
    expect(mesh.colors[mesh.opaque * 4 + 3]).toBeLessThan(255)
  })
})

describe('street furniture, kept tidy', () => {
  const half = halfWidth({ class: 'primary' })
  const street = [{ ax: -100, ay: 0, bx: 100, by: 0, half }]

  it('moves a light off a crossing street, towards the traffic it faces', () => {
    // A side street running north from x = 3: the eastbound light's kerb spot (0, -7.5) is clear,
    // but its westbound twin's (0, 7.5) is on the side street, so it moves east, towards the
    // westbound cars, until clear.
    const side = { ax: 3, ay: 0, bx: 3, by: 100, half: 4 }
    const placed = placeFurniture([{ x: 0, y: 0, kind: 'road', direction: '' }], [], [...street, side])
    const north = placed.find((p) => p.y > 0)!
    expect(north.x).toBeGreaterThan(3 + 4)
  })

  it('makes one shelter of a stop mapped twice', () => {
    const placed = placeFurniture([], [
      { x: 0, y: 12, mode: 'bus', shelter: 'yes', name: 'Centrs' },
      { x: 9, y: 14, mode: 'bus', shelter: '', name: 'Centrs' },
      { x: 9, y: -14, mode: 'bus', shelter: '', name: 'Centrs' },
    ], street)
    // The pair on the north side are one; the south side's own stop stays.
    expect(placed).toHaveLength(2)
  })
})

describe('zebra crossings', () => {
  const half = halfWidth({ class: 'secondary' })
  const street = [{ ax: -100, ay: 0, bx: 100, by: 0, half }]

  it('paints stripes along the street from kerb to kerb where a crossing is on it', () => {
    const [zebra] = placeFurniture([], [], street, [{ x: 10, y: 0.5 }])
    expect(zebra.x).toBeCloseTo(10)
    expect(zebra.y).toBeCloseTo(0)
    // Every stripe within the road, half a metre wide, a metre apart, 3 m long along it.
    for (const [x0, x1, y0, y1] of zebra.boxes) {
      expect([x0, x1]).toEqual([-1.5, 1.5])
      expect(y1 - y0).toBeCloseTo(0.5)
      expect(Math.abs(y0)).toBeLessThan(half)
      expect(Math.abs(y1)).toBeLessThan(half)
    }
    expect(zebra.boxes.length).toBe(Math.floor((2 * (half - 0.3) - 0.5) / 1) + 1)
  })

  it('paints none off the road, and one for a crossing mapped twice', () => {
    expect(placeFurniture([], [], street, [{ x: 0, y: 9 }])).toEqual([])
    expect(placeFurniture([], [], street, [{ x: 0, y: 0 }, { x: 2, y: 0 }])).toHaveLength(1)
  })
})
