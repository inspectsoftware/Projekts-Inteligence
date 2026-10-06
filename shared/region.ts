/** Geography shared by the server (query windows) and the client (camera). */

/** [west, south, east, north] */
export type BBox = readonly [number, number, number, number]

export const LATVIA_BBOX: BBox = [20.95, 55.67, 28.25, 58.09]

/** Centre for radius queries: every corner of the bounding box is within about 142 nm of it. */
export const LATVIA_CENTER = { lon: 24.6, lat: 56.88 } as const

export const RIGA = { lon: 24.1052, lat: 56.9496 } as const

/** Wider area of interest (the Baltic approaches). The camera cannot leave it. */
export const AOI_BBOX: BBox = [9.0, 50.5, 39.0, 63.5]

export function inBBox(lon: number, lat: number, [w, s, e, n]: BBox): boolean {
  return lon >= w && lon <= e && lat >= s && lat <= n
}
