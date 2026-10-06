/**
 * Publishers' own one-paragraph descriptions of their stories, by item link. They stay on the
 * server: the news feed uses them for scoring and the brief hands them to the language model
 * where a publisher's terms allow it, but they are never sent to the browser.
 */
const blurbs = new Map<string, string>()

/** Replaces everything held, so stories that left the feeds do not pile up. */
export function setBlurbs(entries: Iterable<readonly [link: string, blurb: string]>): void {
  blurbs.clear()
  for (const [link, blurb] of entries) blurbs.set(link, blurb)
}

export function blurbOf(link: string): string | undefined {
  return blurbs.get(link)
}
