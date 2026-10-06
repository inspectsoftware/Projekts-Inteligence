/** Splits one CSV line, honouring double-quoted fields (which may contain commas and doubled quotes). */
export function splitCsvLine(line: string): string[] {
  const cells: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') {
        cell += '"'
        i++
      } else if (char === '"') quoted = false
      else cell += char
    } else if (char === '"') quoted = true
    else if (char === ',') {
      cells.push(cell)
      cell = ''
    } else cell += char
  }
  cells.push(cell)
  return cells
}

export interface VesselRisks {
  /** Vessels under sanctions, by IMO number and by MMSI. */
  imo: number[]
  mmsi: number[]
  /** Vessels listed as shadow fleet: tankers moving sanctioned oil under opaque ownership. */
  shadowImo: number[]
  shadowMmsi: number[]
}

/**
 * Reads OpenSanctions' maritime list and returns the identifiers of vessels that are under
 * sanctions or listed as shadow fleet. The list also carries port-state detentions and
 * regulatory warnings; those say little about a ship passing by and are left out.
 */
export function parseVesselRisks(csv: string): VesselRisks {
  const lines = csv.split(/\r?\n/)
  const header = splitCsvLine(lines[0] ?? '')
  const [iType, iRisk, iImo, iMmsi] = ['type', 'risk', 'imo', 'mmsi'].map((name) => header.indexOf(name))
  const lists = {
    sanction: { imo: new Set<number>(), mmsi: new Set<number>() },
    'mare.shadow': { imo: new Set<number>(), mmsi: new Set<number>() },
  }

  if (iType >= 0 && iRisk >= 0 && iImo >= 0 && iMmsi >= 0) {
    for (const line of lines.slice(1)) {
      if (!line) continue
      const cells = splitCsvLine(line)
      // Companies are listed too, under company IMO numbers, which can equal a ship's.
      if (cells[iType]?.toUpperCase() !== 'VESSEL') continue
      const tags = (cells[iRisk] ?? '').split(';').map((tag) => tag.trim())
      for (const [tag, list] of Object.entries(lists)) {
        if (!tags.includes(tag)) continue
        // Written as "IMO9427366"; a vessel may list several numbers over its lifetime.
        for (const value of (cells[iImo] ?? '').split(';')) {
          const parsed = Number(value.replace(/\D/g, ''))
          if (parsed > 0) list.imo.add(parsed)
        }
        for (const value of (cells[iMmsi] ?? '').split(';')) {
          const parsed = Number(value.trim())
          if (Number.isInteger(parsed) && parsed > 0) list.mmsi.add(parsed)
        }
      }
    }
  }
  return {
    imo: [...lists.sanction.imo],
    mmsi: [...lists.sanction.mmsi],
    shadowImo: [...lists['mare.shadow'].imo],
    shadowMmsi: [...lists['mare.shadow'].mmsi],
  }
}
