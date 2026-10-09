import { type FormEvent, useEffect, useRef, useState } from 'react'
import { CHAT_MAX_TEXT } from '../../../shared/room'
import { locale, t } from '../../i18n'
import { useOnline } from '../../runtime/presence'
import { useChat } from './chat/store'

const POLL_MS = 3000
const SENT = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' })

function refusal(code: string): string {
  if (code === 'too_fast' || code === 'rate_limited') return t('Slow down a little')
  if (code === 'too_long') return t('The message is too long')
  return t('The message could not be sent')
}

/** One public room for everyone on the site. No login: the server hands each browser a name. */
export function ChatWindow() {
  const { name, messages, down, refused, poll, send } = useChat()
  const online = useOnline()
  const [draft, setDraft] = useState('')
  const list = useRef<HTMLDivElement>(null)
  // Follows new messages until the reader scrolls up to read older ones.
  const pinned = useRef(true)

  // Asks only while the window is open and the tab is in view.
  useEffect(() => {
    void poll()
    const timer = setInterval(() => {
      if (!document.hidden) void poll()
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [poll])

  useEffect(() => {
    if (pinned.current && list.current) list.current.scrollTop = list.current.scrollHeight
  }, [messages])

  async function submit(event: FormEvent) {
    event.preventDefault()
    const text = draft.trim()
    if (!text) return
    pinned.current = true
    if (await send(text)) setDraft('')
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col text-[11px]">
      <p className="flex shrink-0 items-baseline gap-2 border-b border-line px-3 py-1.5 text-[10px] tracking-[0.12em] text-fg-mute uppercase">
        <span>{name ? t('You are {name}', { name }) : t('Joining…')}</span>
        {online !== null && <span className="ml-auto shrink-0 tabular-nums">{t('{n} online', { n: online })}</span>}
      </p>
      <div
        ref={list}
        onScroll={(event) => {
          const el = event.currentTarget
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
        }}
        className="min-h-0 flex-1 overflow-y-auto px-3 py-2"
      >
        <p className="mb-2 text-[10px] text-fg-mute">{t('A public room with no login. Anyone can read it, and messages are not kept.')}</p>
        <ul aria-live="polite" className="grid gap-1.5">
          {messages.map((message) => (
            <li key={message.seq}>
              <p className="flex items-baseline gap-2 text-[9.5px] tracking-[0.12em] uppercase">
                <span className={message.name === name ? 'text-accent' : 'text-fg-dim'}>{message.name}</span>
                <time dateTime={new Date(message.at).toISOString()} className="shrink-0 text-fg-mute tabular-nums">
                  {SENT.format(message.at)}
                </time>
              </p>
              <p dir="auto" className="font-sans text-xs break-words text-fg">
                {message.text}
              </p>
            </li>
          ))}
        </ul>
      </div>
      <form onSubmit={(event) => void submit(event)} className="shrink-0 border-t border-line p-2">
        <div className="flex gap-1.5">
          <input
            type="text"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            maxLength={CHAT_MAX_TEXT}
            placeholder={t('Write a message')}
            aria-label={t('Write a message')}
            autoComplete="off"
            className="min-w-0 flex-1 border border-line bg-ink-850 px-2 py-1 text-[11px] text-fg placeholder:text-fg-mute focus:border-accent focus:outline-none"
          />
          <button type="submit" disabled={!name || !draft.trim()} className="border border-line px-2 text-[10px] tracking-[0.12em] text-fg-dim uppercase hover:border-line-strong hover:text-fg disabled:opacity-40">
            {t('Send')}
          </button>
        </div>
        {(refused || down) && (
          <p role="alert" className="mt-1 text-[10px] text-warn">
            {refused ? refusal(refused) : t('The chat cannot be reached right now')}
          </p>
        )}
      </form>
    </div>
  )
}
