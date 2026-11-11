import { describe, expect, it } from 'vitest'
import { treeHeight } from '../../src/map/osmTrees'

describe('trees from OpenStreetMap', () => {
  it('stands as tall as mapped, else between 8 and 14 m, the same tree the same each time', () => {
    expect(treeHeight('17', 24.1, 56.95)).toBe(17)
    expect(treeHeight('12.5 m', 24.1, 56.95)).toBe(12.5)
    const unmapped = treeHeight(undefined, 24.1234, 56.9512)
    expect(unmapped).toBeGreaterThanOrEqual(8)
    expect(unmapped).toBeLessThanOrEqual(14)
    expect(treeHeight(null, 24.1234, 56.9512)).toBe(unmapped)
    // Nonsense heights are not believed.
    expect(treeHeight('400', 24.1, 56.95)).toBeLessThanOrEqual(14)
  })
})
