/**
 * Where OpenStreetMap is wrong about a road and we know better (seen on the ground or on the
 * photos), its tags as they should be, by way id. Applied as the roads are read (roads.ts). Worth
 * fixing in OSM itself too; once it is, the entry here can go.
 */
export const ROAD_FIXES: Record<number, Record<string, string>> = {
  // The slip road joining Kārļa Ulmaņa gatve north-west of Jūrkalnes iela: its right lane ends into
  // the left one before the slip road joins; OSM has it the other way round (merge_to_right|through).
  1117665606: { 'turn:lanes': 'through|merge_to_left' },
}

/** Changes when the fixes do, so tiles built before them are built again. */
export const FIXES_STAMP = (() => {
  let h = 5381
  for (const ch of JSON.stringify(ROAD_FIXES)) h = ((h * 33) ^ ch.charCodeAt(0)) >>> 0
  return h.toString(36)
})()
