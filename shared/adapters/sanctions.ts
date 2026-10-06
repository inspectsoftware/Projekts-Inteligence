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

/**
 * Reads OpenSanctions' maritime list and returns the identifiers of vessels that are
 * under sanctions. The list also carries port-state detentions and regulatory
 * warnings; those are not sanctions and are left out.
 */
export function parseSanctionedVessels(csv: string): { imo: number[]; mmsi: number[] } {
  const lines = csv.split(/\r?\n/)
  const header = splitCsvLine(lines[0] ?? '')
  const [iRisk, iImo, iMmsi] = ['risk', 'imo', 'mmsi'].map((name) => header.indexOf(name))
  const imo = new Set<number>()
  const mmsi = new Set<number>()
  if (iRisk < 0 || iImo < 0 || iMmsi < 0) return { imo: [], mmsi: [] }

  for (const line of lines.slice(1)) {
    if (!line) continue
    const cells = splitCsvLine(line)
    if (!cells[iRisk]?.split(';').some((tag) => tag.trim() === 'sanction')) continue
    // Written as "IMO9427366"; a vessel may list several numbers over its lifetime.
    for (const value of (cells[iImo] ?? '').split(';')) {
      const parsed = Number(value.replace(/\D/g, ''))
      if (parsed > 0) imo.add(parsed)
    }
    for (const value of (cells[iMmsi] ?? '').split(';')) {
      const parsed = Number(value.trim())
      if (Number.isInteger(parsed) && parsed > 0) mmsi.add(parsed)
    }
  }
  return { imo: [...imo], mmsi: [...mmsi] }
}
