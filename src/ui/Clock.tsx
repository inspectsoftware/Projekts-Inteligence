import { useEffect, useState } from 'react'

const time = (timeZone: string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })

const RIGA_TIME = time('Europe/Riga')
const UTC_TIME = time('UTC')
const RIGA_DATE = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Riga',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
})

/** Local (Rīga) and Zulu time, ticking once a second. */
export function Clock() {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  return (
    <div className="flex items-center gap-4 tabular-nums">
      <span className="hidden text-fg-mute lg:inline">{RIGA_DATE.format(now)}</span>
      <span>
        <span className="mr-1.5 text-fg-mute">Rīga</span>
        <span className="text-fg">{RIGA_TIME.format(now)}</span>
      </span>
      <span className="max-sm:hidden">
        <span className="mr-1.5 text-fg-mute">UTC</span>
        <span className="text-fg">{UTC_TIME.format(now)}Z</span>
      </span>
    </div>
  )
}
