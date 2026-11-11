/**
 * One vehicle where the feeds show two: a bus whose timetable stand-in is still drawn beside the
 * real one reporting, two trackers in one bus, a pair queued nose to tail at their terminus. Two of
 * the same kind on the same route, under the same number, within 40 m of each other and going the
 * same way (or standing) are one; the one kept is a live one over the timetable's, then the one heard
 * from last. Different routes, kinds or ways are never merged: two buses of a line passing each
 * other in the street are two buses.
 */

/** Closer than this, two of a route are one. */
const TWIN_M = 40
/** Headings closer than this are the same way. */
const SAME_WAY_DEG = 45
/** Slower than this a vehicle's heading says little: it may be standing. */
const MOVING_KMH = 3

interface Vehicle {
  id: string
  lon: number
  lat: number
  ts: number
  trk?: number
  spd?: number
  label?: string
  props: { mode: string; route?: string | null; scheduled?: boolean }
}

function metres(a: Vehicle, b: Vehicle): number {
  const k = Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180)
  return Math.hypot((b.lon - a.lon) * 111_320 * k, (b.lat - a.lat) * 110_540)
}

function sameWay(a: Vehicle, b: Vehicle): boolean {
  const standing = (v: Vehicle) => v.trk === undefined || (v.spd ?? 0) < MOVING_KMH
  if (standing(a) || standing(b)) return true
  const d = Math.abs((((a.trk! - b.trk!) % 360) + 540) % 360 - 180)
  return d < SAME_WAY_DEG
}

/** Which of two twins to keep: live over the timetable's, then the last heard from. */
const better = (a: Vehicle, b: Vehicle): boolean => (!!a.props.scheduled !== !!b.props.scheduled ? !a.props.scheduled : a.ts >= b.ts)

/** The vehicles with each one's twins left out. */
export function withoutTwins<T extends Vehicle>(vehicles: readonly T[]): T[] {
  // Only vehicles of one route under one number can be twins: compared within those groups.
  const groups = new Map<string, T[]>()
  for (const vehicle of vehicles) {
    if (!vehicle.label || !vehicle.props.route) continue
    const key = `${vehicle.props.mode}|${vehicle.props.route}|${vehicle.label}`
    const group = groups.get(key)
    if (group) group.push(vehicle)
    else groups.set(key, [vehicle])
  }
  const dropped = new Set<T>()
  for (const group of groups.values()) {
    if (group.length < 2) continue
    // Best first, so each kept vehicle swallows the twins worse than it.
    group.sort((a, b) => (better(a, b) ? -1 : 1))
    for (let i = 0; i < group.length; i++) {
      if (dropped.has(group[i])) continue
      for (let j = i + 1; j < group.length; j++) {
        if (!dropped.has(group[j]) && metres(group[i], group[j]) < TWIN_M && sameWay(group[i], group[j])) dropped.add(group[j])
      }
    }
  }
  return dropped.size ? vehicles.filter((vehicle) => !dropped.has(vehicle)) : [...vehicles]
}
