/** paint(lon, lat) -> true where the LĢIA orthophoto shows white paint, over the boxes; null with no photo there. */
export function paintNear(boxes: [number, number, number, number][]): Promise<((lon: number, lat: number) => boolean) | null>
