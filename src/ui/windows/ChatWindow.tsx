import { type FormEvent, useEffect, useRef, useState } from 'react'
import { CHAT_MAX_TEXT, type ChatMessage } from '../../../shared/room'
import { locale, t } from '../../i18n'
import { useOnline } from '../../runtime/presence'
import { useChat } from './chat/store'

const POLL_MS = 3000
const SENT = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' })
/** An @ and the start of a name, being typed at the end of the draft. */
const HALF_MENTION = /(^|\s)@(\w*)$/

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
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null)
  const list = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
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

  // Names to offer while an @ is being typed: whoever has written lately, newest first.
  const half = HALF_MENTION.exec(draft)
  const offered = half
    ? [...new Set(messages.map((message) => message.name).reverse())]
        .filter((other) => other !== name && other.toLowerCase().startsWith(half[2].toLowerCase()))
        .slice(0, 5)
    : []

  function mention(other: string) {
    setDraft((text) => (HALF_MENTION.test(text) ? text.replace(HALF_MENTION, `$1@${other} `) : `${text}${text && !text.endsWith(' ') ? ' ' : ''}@${other} `))
    input.current?.focus()
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    const text = draft.trim()
    if (!text) return
    pinned.current = true
    if (!(await send(text, replyTo?.seq))) return
    setDraft('')
    setReplyTo(null)
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
        className="min-h-0 flex-1 overflow-y-auto py-2"
      >
        <p className="mb-2 px-3 text-[10px] text-fg-mute">{t('A public room with no login. Anyone can read it, and messages are not kept.')}</p>
        <ul aria-live="polite" className="grid gap-0.5">
          {messages.map((message) => {
            const mine = message.name === name
            // Answers to this reader and messages that name them stand out.
            const forMe = name !== null && (message.to?.includes(name) ?? false)
            return (
              <li key={message.seq} className={`group border-l-2 px-3 py-1 ${forMe ? 'border-accent bg-accent/15' : 'border-transparent'}`}>
                {message.reply && (
                  <p className="truncate text-[10px] text-fg-mute">
                    ↳ {message.reply.name}: {message.reply.text}
                  </p>
                )}
                <p className="flex items-baseline gap-2 text-[9.5px] tracking-[0.12em] uppercase">
                  {mine ? (
                    <span className={message.owner ? 'chromatic font-semibold' : 'text-accent'}>{message.name}</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => mention(message.name)}
                      title={t('Mention {name}', { name: message.name })}
                      className={`tracking-[0.12em] uppercase ${message.owner ? 'chromatic font-semibold' : 'text-fg-dim hover:text-accent'}`}
                    >
                      {message.name}
                    </button>
                  )}
                  <time dateTime={new Date(message.at).toISOString()} className="shrink-0 text-fg-mute tabular-nums">
                    {SENT.format(message.at)}
                  </time>
                  <button
                    type="button"
                    onClick={() => {
                      setReplyTo(message)
                      input.current?.focus()
                    }}
                    className="ml-auto tracking-[0.12em] text-fg-mute uppercase opacity-0 group-hover:opacity-100 hover:text-accent focus:opacity-100"
                  >
                    {t('Reply')}
                  </button>
                </p>
                <p dir="auto" className="font-sans text-xs break-words text-fg">
                  {message.text}
                </p>
              </li>
            )
          })}
        </ul>
      </div>
      <form onSubmit={(event) => void submit(event)} className="shrink-0 border-t border-line p-2">
        {replyTo && (
          <p className="mb-1 flex items-baseline gap-2 text-[10px] text-fg-mute">
            <span className="min-w-0 flex-1 truncate">
              <span className="text-accent">{t('Replying to {name}', { name: replyTo.name })}</span> {replyTo.text}
            </span>
            <button type="button" onClick={() => setReplyTo(null)} aria-label={t('Cancel the reply')} title={t('Cancel the reply')} className="shrink-0 px-1 hover:text-fg">
              ×
            </button>
          </p>
        )}
        {offered.length > 0 && (
          <p className="mb-1 flex flex-wrap gap-1">
            {offered.map((other) => (
              <button key={other} type="button" onClick={() => mention(other)} className="border border-line px-1.5 py-px text-[10px] text-fg-dim hover:border-accent hover:text-accent">
                @{other}
              </button>
            ))}
          </p>
        )}
        <div className="flex gap-1.5">
          <input
            ref={input}
            type="text"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              // Tab takes the first name on offer, as it would in any chat.
              if (event.key === 'Tab' && offered.length > 0) {
                event.preventDefault()
                mention(offered[0])
              }
            }}
            maxLength={CHAT_MAX_TEXT}
            placeholder={t('Write a message')}
            aria-label={t('Write a message. Type @ to call on someone')}
            title={t('Write a message. Type @ to call on someone')}
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
