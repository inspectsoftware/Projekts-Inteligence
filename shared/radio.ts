/** What a radio search looks in: a station's name, its country's English name, or its genre tags. */
export const RADIO_BY = ['name', 'country', 'tag'] as const
export type RadioBy = (typeof RADIO_BY)[number]

export const isRadioBy = (value: unknown): value is RadioBy => (RADIO_BY as readonly unknown[]).includes(value)

export interface RadioStation {
  id: string
  name: string
  /** The stream itself, always https, played by the browser straight from the broadcaster. */
  url: string
  country: string
  tags: string[]
  codec: string
  /** kbit/s, or 0 when the directory does not know. */
  bitrate: number
  homepage: string | null
}

export interface RadioResponse {
  stations: RadioStation[]
}

export const RADIO_CREDIT = { label: 'Radio Browser', href: 'https://www.radio-browser.info' } as const
