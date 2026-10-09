import { Component, type ReactNode } from 'react'
import { t } from '../i18n'
import { reportText } from '../runtime/log'
import { ReportActions } from './windows/ConsoleWindow'

/** What is left when the app itself cannot draw: the log, and the way to send it in. React has already logged the fault. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { broken: boolean }> {
  state = { broken: false }

  static getDerivedStateFromError() {
    return { broken: true }
  }

  render() {
    if (!this.state.broken) return this.props.children
    return (
      <main className="flex h-full flex-col gap-3 bg-ink-950 p-4 font-mono text-[11px] text-fg">
        <h1 className="tracking-[0.3em] text-danger uppercase">{t('Something broke')}</h1>
        <p className="font-sans text-xs text-fg-dim">{t('The page ran into a fault it could not recover from. Copy the log, report it, then reload.')}</p>
        <div className="flex gap-1.5">
          <ReportActions />
          <button type="button" onClick={() => window.location.reload()} className="border border-accent px-2 py-0.5 text-[10px] tracking-[0.12em] text-accent uppercase">
            {t('Reload')}
          </button>
        </div>
        <pre className="min-h-0 flex-1 overflow-auto border border-line bg-ink-900 p-2 text-[10.5px] break-words whitespace-pre-wrap">{reportText('(filled in on copy)')}</pre>
      </main>
    )
  }
}
