import { describe, expect, it } from 'vitest'
import { bearing, haversine } from '../../shared/geo/sphere'
import { EYE_HEIGHT, minWalkPitch, stepEye } from '../../src/map/walk'

const RIGA = [24.105, 56.949] as const

describe('walking at street level', () => {
  it('steps the eye forward along its bearing and sideways to its right', () => {
    const [lon, lat] = stepEye(RIGA[0], RIGA[1], 30, 100, 0)
    expect(haversine(RIGA[0], RIGA[1], lon, lat)).toBeCloseTo(100, 1)
    expect(bearing(RIGA[0], RIGA[1], lon, lat)).toBeCloseTo(30, 1)

    const [rightLon, rightLat] = stepEye(RIGA[0], RIGA[1], 30, 0, 10)
    expect(haversine(RIGA[0], RIGA[1], rightLon, rightLat)).toBeCloseTo(10, 2)
    expect(bearing(RIGA[0], RIGA[1], rightLon, rightLat)).toBeCloseTo(120, 1)

    const [backLon, backLat] = stepEye(RIGA[0], RIGA[1], 30, -3, -4)
    expect(haversine(RIGA[0], RIGA[1], backLon, backLat)).toBeCloseTo(5, 3)
    expect(stepEye(RIGA[0], RIGA[1], 30, 0, 0)).toEqual([RIGA[0], RIGA[1]])
  })

  it('looks no lower than MapLibre can zoom to, and lower the higher the eye', () => {
    // 900 px tall at Rīga, zoom 24 puts the point looked at 3.43 m from the eye: from 1.7 m up,
    // that is a look of about 60° from straight down.
    expect(minWalkPitch(EYE_HEIGHT, RIGA[1], 900)).toBeCloseTo(60.3, 1)
    // Check it the way MapLibre would: the zoom for the lowest look is the limit itself.
    const pitch = minWalkPitch(EYE_HEIGHT, RIGA[1], 900) * (Math.PI / 180)
    const distance = EYE_HEIGHT / Math.cos(pitch)
    const metresPerPixel = (2 * Math.PI * 6_371_008.8 * Math.cos(RIGA[1] * (Math.PI / 180))) / (512 * 2 ** 24)
    expect((1.5 * 900 * metresPerPixel) / distance).toBeCloseTo(1, 6)

    expect(minWalkPitch(10, RIGA[1], 900)).toBeLessThan(minWalkPitch(EYE_HEIGHT, RIGA[1], 900))
    expect(minWalkPitch(400, RIGA[1], 900)).toBe(0)
    // A taller map puts the camera further back, so the walker must look further up.
    expect(minWalkPitch(EYE_HEIGHT, RIGA[1], 1400)).toBeGreaterThan(minWalkPitch(EYE_HEIGHT, RIGA[1], 900))
    // Never past where MapLibre loses the point it looks at.
    expect(minWalkPitch(0.01, RIGA[1], 4000)).toBe(88)
  })
})
