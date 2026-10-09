import { useState } from 'react'
import { APP } from '../../../shared/meta'
import { locale, t } from '../../i18n'
import { clearLog, reportText, useLog } from '../../runtime/log'

const AT = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' })

const ACTION = 'border border-line px-2 py-0.5 text-[10px] tracking-[0.12em] text-fg-dim uppercase transition-colors hover:border-line-strong hover:text-fg'

async function serverCommit(): Promise<string> {
  try {
    const res = await fetch('/api/health')
    return res.ok ? ((await res.json()) as { commit: string }).commit : 'unknown'
  } catch {
    return 'unknown'
  }
}

/** Copy the log, and go to where it can be reported. Shared with the page shown when the app itself has broken. */
export function ReportActions() {
  const [copied, setCopied] = useState<'no' | 'yes' | 'failed'>('no')

  async function copy() {
    try {
      await navigator.clipboard.writeText(reportText(await serverCommit()))
      setCopied('yes')
    } catch {
      setCopied('failed')
    }
    setTimeout(() => setCopied('no'), 2000)
  }

  return (
    <>
      <button type="button" onClick={() => void copy()} title={t('Copy the log with the build and browser details')} className={ACTION}>
        <span role="status">{copied === 'yes' ? t('Copied') : copied === 'failed' ? t('Could not copy') : t('Copy')}</span>
      </button>
      <a href={APP.reportUrl} target="_blank" rel="noreferrer noopener" title={t('Opens the report page in a new tab. Paste the copied log there')} className={ACTION}>
        {t('Report')}
      </a>
    </>
  )
}

/** Faults the page has run into, newest first, for a reader to copy and send in. */
export function ConsoleWindow() {
  const log = useLog()

  return (
    <div className="flex min-h-0 flex-1 flex-col text-[11px]">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-line p-2">
        <ReportActions />
        <button type="button" onClick={clearLog} className={`${ACTION} ml-auto`}>
          {t('Clear')}
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {log.length === 0 && <p className="text-fg-mute">{t('Nothing has gone wrong so far.')}</p>}
        <ul className="divide-y divide-line/50">
          {[...log].reverse().map((entry) => (
            <li key={`${entry.at}:${entry.level}:${entry.text}`} className="py-1.5">
              <p className="flex items-baseline gap-2 text-[9.5px] tracking-[0.12em] uppercase">
                <span className={entry.level === 'error' ? 'text-danger' : 'text-warn'}>{entry.level}</span>
                {entry.count > 1 && <span className="text-fg-dim tabular-nums">x{entry.count}</span>}
                <time dateTime={new Date(entry.at).toISOString()} className="ml-auto shrink-0 text-fg-mute tabular-nums">
                  {AT.format(entry.at)}
                </time>
              </p>
              <pre className="mt-0.5 font-mono text-[10.5px] break-words whitespace-pre-wrap text-fg">{entry.text}</pre>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
