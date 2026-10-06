/** One thing the command palette can find and act on. */
export interface SearchItem {
  id: string
  /** Shown as a small tag: "Place", "Aircraft", "Layer"... */
  group: string
  title: string
  subtitle?: string
  /** Extra text to match on besides the title (registration, route, ICAO code). */
  keywords?: string
  /** Breaks ties between equally good matches; larger first. */
  weight?: number
  run(): void
}

/** Lower-case and without diacritics, so "riga" finds "Rīga" and "liepaja" finds "Liepāja". */
export function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
}

/** 3: the title starts with the query. 2: some word in it does. 1: it appears anywhere, keywords included. 0: no match. */
function score(query: string, item: SearchItem): number {
  const title = fold(item.title)
  if (title.startsWith(query)) return 3
  if (title.split(/[\s\-/()]+/).some((word) => word.startsWith(query))) return 2
  if (title.includes(query) || (item.keywords && fold(item.keywords).includes(query))) return 1
  return 0
}

/** The best matches for a query, best first. An empty query returns nothing. */
export function rank(query: string, items: readonly SearchItem[], limit = 12): SearchItem[] {
  const folded = fold(query.trim())
  if (!folded) return []
  const scored: { item: SearchItem; score: number }[] = []
  for (const item of items) {
    const s = score(folded, item)
    if (s > 0) scored.push({ item, score: s })
  }
  return scored
    .sort((a, b) => b.score - a.score || (b.item.weight ?? 0) - (a.item.weight ?? 0) || a.item.title.localeCompare(b.item.title))
    .slice(0, limit)
    .map((entry) => entry.item)
}
