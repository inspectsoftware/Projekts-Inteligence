import { describe, expect, it } from 'vitest'
import { buildRoads } from '../../server/streets/prototype/lanes-photo.mjs'

describe('the photo-aware street builder prototype (STREETS_BUILDER=photo)', () => {
  it('draws streets by its rules alone where it has no photo', () => {
    const fc = buildRoads(
      [
        { id: 1, nodes: [1, 2, 3], coords: [[24.098, 56.95], [24.1, 56.95], [24.102, 56.95]], tags: { highway: 'primary', lanes: '4' } },
        { id: 2, nodes: [4, 2, 5], coords: [[24.1, 56.9488], [24.1, 56.95], [24.1, 56.9512]], tags: { highway: 'residential' } },
      ],
      [{ node: 2, tags: { highway: 'traffic_signals' } }],
      [24.09, 56.94, 24.13, 56.96],
    )
    const kinds = new Set(fc.features.map((f) => f.properties?.kind))
    expect(kinds).toContain('carriageway')
    expect(kinds).toContain('junction')
    expect(kinds).toContain('lane-line')
  })
})
