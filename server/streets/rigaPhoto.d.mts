/** A top-down photo of a bbox: RGBA, north row first, pixels even in Web Mercator; alpha 0 where no mesh has a face. */
export interface RigaPhoto {
  width: number
  height: number
  data: Uint8Array
  bbox: [number, number, number, number]
  cmPerPixel: number
  /** Mesh nodes drawn. */
  nodes: number
}

/**
 * Rīga's photographed 3D surfaces (GEO RĪGA's centre, LĢIA's elsewhere) laid flat over a bbox, as seen
 * from above ('low': the lowest surface, under bridge decks); null outside Rīga.
 */
export function rigaPhotoNear(bbox: [number, number, number, number], cmPerPixel?: number, options?: { surface?: 'low' | 'top' }): Promise<RigaPhoto | null>
