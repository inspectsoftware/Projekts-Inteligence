/**
 * What a military aircraft is for, read off its ICAO type designator. Only applied to aircraft
 * the aggregators' database marks as military: a civil A332 is an airliner, a military one a
 * tanker. Each designator was checked against the tar1090 aircraft database (October 2026).
 *
 * To extend it, add the designator to a list. Roles are in order of interest: the lists of
 * military aircraft sort by it. A type that is not here stays "role unknown" rather than guessed;
 * E6 is left out on purpose, because most airframes under it are not the E-6 command post.
 */
export const ROLE_TYPES = {
  isr: ['R135', 'U2', 'C135'],
  aew: ['E3TF', 'E3CF', 'E737', 'E767', 'E2', 'SF34', 'A50'],
  tanker: ['K35R', 'K35E', 'B762', 'A332', 'A310', 'DC10', 'IL78'],
  mpa: ['P8', 'P3', 'P1', 'ATLA', 'TU95', 'IL38'],
  uav: ['Q4', 'Q9', 'Q1', 'HRON', 'BTB2', 'DRON'],
  bomber: ['B52', 'B1', 'B2', 'T160', 'T22M'],
  fighter: [
    'F16', 'F15', 'F18H', 'F18S', 'F35', 'EUFI', 'RFAL', 'SB39', 'TOR', 'MIR2', 'A10', 'MG29', 'MG31',
    'SU24', 'SU25', 'SU27', 'SU30', 'SU34', 'SU35',
  ],
  // CN35 and C295 have maritime patrol versions under the same designator, but the ones seen
  // here (French, Polish, Finnish) are transports, so that is what they are called.
  transport: [
    'C130', 'C30J', 'C17', 'A400', 'IL76', 'Y20', 'AN32', 'C27J', 'CN35', 'C295', 'DHC6', 'C5M', 'AN12', 'L410',
    'M28', 'A124', 'KC2', 'E390', 'C160', 'AN26', 'AN22', 'AN28',
  ],
  helicopter: [
    'H60', 'H64', 'H47', 'EC45', 'V22', 'NH90', 'EC35', 'A139', 'AS65', 'H53S', 'EH10', 'TIGR', 'SUCO', 'EC25',
    'UH1', 'MI8', 'AS32', 'GAZL', 'LYNX', 'A169', 'PUMA', 'UH1Y', 'H53', 'MI24',
  ],
  trainer: [
    'TEX2', 'T38', 'HAWK', 'PC21', 'BE40', 'G115', 'E314', 'PC7', 'AJET', 'G120', 'M346', 'TUCA', 'L39', 'PC9',
    'M339', 'PZ3T',
  ],
  vip: ['GLF5', 'GLF6', 'B737', 'B752', 'B742', 'E35L', 'F900', 'FA7X', 'IL96', 'IL62', 'T204', 'T154', 'T134', 'A148'],
} as const satisfies Record<string, readonly string[]>

export type AircraftRole = keyof typeof ROLE_TYPES

/** Airframes whose type says nothing but whose role is known: Sweden's three S102B Korpen (Gulfstream IV). */
const ROLE_BY_HEX = new Map<string, AircraftRole>([
  ['4a8199', 'isr'],
  ['4a81f8', 'isr'],
  ['4a81f9', 'isr'],
])

/**
 * A military King Air, Challenger or Global is usually a liaison or VIP aircraft; a few of each
 * are fitted out for reconnaissance under the same designator. Only the airframe description
 * tells them apart, so these are ISR when it names such a variant, and role unknown otherwise.
 */
const ISR_IF_NAMED: ReadonlySet<string> = new Set(['BE20', 'B350', 'CL60', 'GLEX'])
const ISR_VARIANT = /Shadow|RC-12|MC-12|Guardrail|ATHENA|ARTEMIS|E-11|PEGASUS/i

export const ROLE_LABEL: Record<AircraftRole, string> = {
  isr: 'ISR / SIGINT',
  aew: 'AWACS / early warning',
  tanker: 'Tanker',
  mpa: 'Maritime patrol',
  uav: 'UAV',
  bomber: 'Bomber',
  fighter: 'Fighter / attack',
  transport: 'Transport',
  helicopter: 'Helicopter',
  trainer: 'Trainer',
  vip: 'VIP / command',
}

export const ROLE_ORDER = Object.keys(ROLE_TYPES) as AircraftRole[]

/** The roles that say something about posture when they turn up: they are listed first and counted separately. */
export const KEY_ROLES: ReadonlySet<AircraftRole> = new Set(['isr', 'aew', 'tanker', 'mpa', 'uav', 'bomber'])

const BY_TYPE = new Map<string, AircraftRole>(
  ROLE_ORDER.flatMap((role) => ROLE_TYPES[role].map((type): [string, AircraftRole] => [type, role])),
)

/** The role of a MILITARY aircraft, or null when its type does not settle it. */
export function roleOf(aircraft: {
  hex: string
  type: string | null
  category: string | null
  description: string | null
}): AircraftRole | null {
  const { type, description } = aircraft
  const known = ROLE_BY_HEX.get(aircraft.hex) ?? (type ? BY_TYPE.get(type) : undefined)
  if (known) return known
  if (type && ISR_IF_NAMED.has(type) && description && ISR_VARIANT.test(description)) return 'isr'
  // What the transponder itself declares: A7 is a rotorcraft, B6 an unmanned aircraft.
  if (aircraft.category === 'A7') return 'helicopter'
  if (aircraft.category === 'B6') return 'uav'
  return null
}
