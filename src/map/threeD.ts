/**
 * When vehicles stand on the map in 3D (map/vehicles3d.ts) rather than lie on it as icons: close in,
 * with the map tilted. Seen straight down an icon says as much and costs less.
 */
export const VEHICLES_3D_ZOOM = 15.5
export const VEHICLES_3D_PITCH = 15

export const vehiclesIn3d = (zoom: number, pitch: number): boolean => zoom >= VEHICLES_3D_ZOOM && pitch >= VEHICLES_3D_PITCH
