import { type FormEvent, useEffect, useState } from 'react'
import { t } from '../../../i18n'
import { useChat } from './store'

const BUTTON = 'shrink-0 border border-line px-2 py-1 text-[10px] tracking-[0.12em] text-fg-dim uppercase transition-colors hover:border-line-strong hover:text-fg disabled:opacity-40'

function refusal(code: string): string {
  if (code === 'bad_name') return t('Use 3 to 20 letters, digits or underscores')
  if (code === 'taken') return t('That name is taken')
  if (code === 'too_fast' || code === 'rate_limited') return t('Slow down a little')
  return t('The name could not be changed')
}

/** Who the reader is to everyone else: the id that stays theirs, and the name they can change. */
export function IdentitySettings() {
  const id = useChat((s) => s.id)
  const name = useChat((s) => s.name)
  const nameRefused = useChat((s) => s.nameRefused)
  const identify = useChat((s) => s.identify)
  const rename = useChat((s) => s.rename)
  // null until the reader types: the box then shows the name as it stands, a drawn one included.
  const [draft, setDraft] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => void identify(), [identify])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (draft?.trim() && (await rename(draft.trim()))) setDraft(null)
  }

  async function copy() {
    if (!id) return
    try {
      await navigator.clipboard.writeText(id)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // The id is on screen to be read or selected by hand.
    }
  }

  return (
    <div className="grid gap-1.5 text-[11px]">
      <p className="flex items-center gap-2">
        <span className="text-[10px] text-fg-mute">{t('Your ID')}</span>
        <code className="min-w-0 flex-1 truncate font-mono text-fg select-all">{id ? `#${id}` : '…'}</code>
        <button type="button" onClick={() => void copy()} disabled={!id} className={BUTTON}>
          <span role="status">{copied ? t('Copied') : t('Copy')}</span>
        </button>
      </p>
      <form onSubmit={(event) => void submit(event)} className="flex gap-1.5">
        <input
          type="text"
          value={draft ?? name ?? ''}
          onChange={(event) => setDraft(event.target.value)}
          maxLength={20}
          aria-label={t('Your name')}
          title={t('Use 3 to 20 letters, digits or underscores')}
          autoComplete="off"
          spellCheck={false}
          className="min-w-0 flex-1 border border-line bg-ink-850 px-2 py-1 text-[11px] text-fg placeholder:text-fg-mute focus:border-accent focus:outline-none"
        />
        <button type="submit" disabled={!draft?.trim() || draft.trim() === name} className={BUTTON}>
          {t('Save')}
        </button>
        <button
          type="button"
          onClick={() => {
            setDraft(null)
            void rename()
          }}
          disabled={!name}
          title={t('Draw a new random name')}
          className={BUTTON}
        >
          {t('Random')}
        </button>
      </form>
      {nameRefused && (
        <p role="alert" className="text-[10px] text-warn">
          {refusal(nameRefused)}
        </p>
      )}
      <p className="text-[10px] text-fg-mute">{t('Your ID was given to this browser on its first visit and never changes, whatever name you pick. It is shown beside your chat messages.')}</p>
    </div>
  )
}
