import { type Send, createModel } from '../../server/ai/model'
import type { NewsItem } from '../../shared/feeds'

type Reply = Awaited<ReturnType<Send>>

export const NOW = Date.parse('2026-10-06T12:00:00Z')
export const HOUR = 3600_000

/** An answer as the SDK hands it back: an empty thinking block first, then the text. */
export function reply(answer: unknown, stop: Reply['stop_reason'] = 'end_turn'): Reply {
  return {
    model: 'test-model',
    stop_reason: stop,
    content: [
      { type: 'thinking', thinking: '', signature: '' },
      { type: 'text', text: typeof answer === 'string' ? answer : JSON.stringify(answer), citations: null },
    ],
    usage: { input_tokens: 100, output_tokens: 50 },
  } as unknown as Reply
}

/** A model whose network is `send`. The key is a dummy: nothing here reaches the API or the disk. */
export function fakeModel(send: Send, env: NodeJS.ProcessEnv = { ANTHROPIC_API_KEY: 'test-key' }) {
  const log: string[] = []
  const model = createModel({ env, send, now: () => NOW, disk: { read: async () => null, write: async () => {} }, log: (line) => log.push(line) })
  return { model, log }
}

/** What the model was asked, as text. */
export const asked = (body: Parameters<Send>[0]) => `${String(body.system)}\n${String(body.messages[0].content)}`

let serial = 0

/** A headline an hour old from a publisher of its own, scored routine, that a model may summarise. */
export function headline(over: Partial<NewsItem> = {}): NewsItem {
  serial += 1
  return {
    title: `Headline ${serial}`,
    link: `https://news.example/${serial}`,
    at: NOW - HOUR,
    source: 'test',
    publisher: `Publisher ${serial}`,
    lang: 'en',
    countries: ['LV'],
    importance: 10,
    escalation: 0,
    tags: [],
    corroboration: 0,
    ai: 'summary',
    ...over,
  }
}
