import type Anthropic from '@anthropic-ai/sdk'
import { type DiskStore, createDiskStore } from '../core/disk'

/** Cheap and quick: the briefs are short summaries over a few thousand tokens, written many times a day. */
const DEFAULT_MODEL = 'claude-haiku-4-5'
const DEFAULT_CEILING = 120
/** Room for the model's thinking as well as its answer; the answers themselves are a few hundred tokens. */
const MAX_TOKENS = 16_000
/**
 * Briefs are refreshed behind the copy being served, so a slow answer holds nobody up.
 * One that never comes must still let go of the refresh.
 */
const TIMEOUT_MS = 90_000
const COUNTER = 'ai-calls'

/** The one SDK call this module makes. Tests hand in a stand-in, so they never touch the network. */
export type Send = (
  body: Anthropic.Beta.Messages.MessageCreateParamsNonStreaming,
) => Promise<Pick<Anthropic.Beta.Messages.BetaMessage, 'content' | 'model' | 'stop_reason' | 'usage'>>

export interface Question {
  /** Names the call in the log ("brief", "country LV"). Never anything read from a feed. */
  label: string
  system: string
  user: string
  /** JSON Schema the answer has to follow. */
  schema: Record<string, unknown>
  effort: 'low' | 'medium' | 'high'
}

export type Unavailable = 'no-key' | 'ceiling' | 'refusal' | 'truncated' | 'timeout' | 'bad-json' | 'api'

/**
 * Parsed JSON in the shape that was asked for, or the reason there is none. Failing never
 * throws: a caller that gets no answer writes its text from rules instead.
 */
export type Answer = { ok: true; value: unknown } | { ok: false; reason: Unavailable }

export interface Model {
  ask(question: Question): Promise<Answer>
}

export interface ModelDeps {
  env?: NodeJS.ProcessEnv
  send?: Send
  disk?: DiskStore<{ calls: number }>
  now?(): number
  log?(message: string): void
}

type Sdk = typeof Anthropic

let sdk: Promise<Sdk> | undefined

/**
 * The SDK takes about a tenth of a second to load, and this process is started cold for most
 * of its visitors. So only a process that has a key, and a brief to write, ever loads it.
 */
const loadSdk = () => (sdk ??= import('@anthropic-ai/sdk').then((module) => module.default))

function viaSdk(Anthropic: Sdk, apiKey: string): Send {
  // No retries inside the SDK: every request sent counts against the ceiling, and a call
  // that fails only means rule-based text until the next refresh.
  const client = new Anthropic({ apiKey, maxRetries: 0, timeout: TIMEOUT_MS })
  return (body) => client.beta.messages.create(body)
}

/** Most specific class first: a timeout is a connection error, and both are API errors. */
function failure(Anthropic: Sdk, err: unknown): { reason: Unavailable; detail: string } {
  if (err instanceof Anthropic.APIConnectionTimeoutError) return { reason: 'timeout', detail: 'no answer in time' }
  if (err instanceof Anthropic.APIConnectionError) return { reason: 'api', detail: 'the API could not be reached' }
  if (err instanceof Anthropic.AuthenticationError) return { reason: 'api', detail: 'the key was rejected' }
  if (err instanceof Anthropic.RateLimitError) return { reason: 'api', detail: 'rate limited' }
  // Status and error type only: the message of a rejected request can quote what was sent.
  if (err instanceof Anthropic.APIError) return { reason: 'api', detail: `HTTP ${err.status} ${err.type ?? ''}`.trim() }
  return { reason: 'api', detail: 'unexpected error' }
}

const utcDay = (at: number) => new Date(at).toISOString().slice(0, 10)

/**
 * The language model behind the briefs. Everything optional about it lives here: without a
 * key no client is ever built, and a hard ceiling on calls per UTC day keeps a busy day (or
 * a bug) from running up a bill. The count is mirrored to disk so that a restart does
 * not hand out a fresh allowance, for as long as the host keeps its temp folder.
 */
export function createModel(deps: ModelDeps = {}): Model {
  const env = deps.env ?? process.env
  const now = deps.now ?? Date.now
  const log = deps.log ?? ((message) => console.log(message))
  const disk = deps.disk ?? createDiskStore<{ calls: number }>()
  const asked = Number(env.AI_MAX_CALLS_PER_DAY)
  const ceiling = env.AI_MAX_CALLS_PER_DAY && asked >= 0 ? asked : DEFAULT_CEILING

  let send = deps.send
  let day = ''
  let calls = 0
  let restored: Promise<void> | undefined

  /** Counts one call against today's allowance. False when it is spent. */
  async function spend(): Promise<boolean> {
    // One read for the whole process, shared by calls that start together.
    restored ??= disk.read(COUNTER).then((stored) => {
      if (!stored || utcDay(stored.updatedAt) !== utcDay(now())) return
      day = utcDay(stored.updatedAt)
      calls = Math.max(calls, Number(stored.payload.calls) || 0)
    })
    await restored

    const at = now()
    if (day !== utcDay(at)) {
      day = utcDay(at)
      calls = 0
    }
    if (calls >= ceiling) return false
    calls += 1
    void disk.write(COUNTER, { updatedAt: at, payload: { calls } })
    return true
  }

  return {
    async ask({ label, system, user, schema, effort }) {
      const apiKey = env.ANTHROPIC_API_KEY
      if (!apiKey) return { ok: false, reason: 'no-key' }

      const unavailable = (reason: Unavailable, detail: string): Answer => {
        log(`[ai] ${label}: no answer (${detail})`)
        return { ok: false, reason }
      }

      const Anthropic = await loadSdk().catch(() => null)
      if (!Anthropic) return unavailable('api', 'the SDK is not installed')
      if (!(await spend())) return unavailable('ceiling', `the ceiling of ${ceiling} calls a day is reached`)

      let message
      try {
        send ??= viaSdk(Anthropic, apiKey)
        const model = env.ANTHROPIC_MODEL || DEFAULT_MODEL
        const format = { type: 'json_schema' as const, schema }
        message = await send({
          model,
          max_tokens: MAX_TOKENS,
          // Haiku answers without thinking and rejects both an effort level and the refusal
          // fallback; the larger models take them. With the fallback, a request the safety
          // classifiers decline is retried on the model Anthropic recommends, in the same call.
          ...(model.includes('haiku')
            ? { output_config: { format } }
            : { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const, output_config: { effort, format } }),
          system,
          messages: [{ role: 'user', content: user }],
        })
      } catch (err) {
        const { reason, detail } = failure(Anthropic, err)
        return unavailable(reason, detail)
      }

      // Usage only. Prompts, headlines and the key never reach the log.
      const { input_tokens, output_tokens } = message.usage
      log(`[ai] ${label}: ${message.model} ${message.stop_reason}, ${input_tokens} in / ${output_tokens} out, call ${calls} of ${ceiling} today`)

      if (message.stop_reason === 'refusal') return unavailable('refusal', 'declined')
      // Cut off mid-answer: what arrived is not the JSON that was asked for.
      if (message.stop_reason === 'max_tokens') return unavailable('truncated', 'ran out of tokens')
      // Thinking blocks come first and carry no text; the answer is in the text blocks.
      const text = message.content.map((block) => (block.type === 'text' ? block.text : '')).join('')
      try {
        return { ok: true, value: JSON.parse(text) }
      } catch {
        return unavailable('bad-json', 'not valid JSON')
      }
    },
  }
}

let shared: Model | undefined

/** The process's one model, so that every brief draws on the same daily allowance. */
export function modelFor(env: NodeJS.ProcessEnv): Model {
  return (shared ??= createModel({ env }))
}
