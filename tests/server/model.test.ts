import Anthropic from '@anthropic-ai/sdk'
import { describe, expect, it, vi } from 'vitest'
import { type Send, createModel } from '../../server/ai/model'
import type { DiskStore, StoredSnapshot } from '../../server/core/disk'
import { NOW, fakeModel, reply } from './fakeModel'

const question = { label: 'test', system: 'SYSTEM-PROMPT', user: 'USER-PROMPT', schema: { type: 'object' }, effort: 'low' as const }

describe('model', () => {
  it('asks nothing without a key', async () => {
    const send = vi.fn<Send>()
    const { model, log } = fakeModel(send, {})
    expect(await model.ask(question)).toEqual({ ok: false, reason: 'no-key' })
    expect(send).not.toHaveBeenCalled()
    expect(log).toEqual([])
  })

  it('asks the default model for schema-bound JSON, without the settings Haiku rejects', async () => {
    const send = vi.fn<Send>(async () => reply({ fine: true }))
    const { model } = fakeModel(send)
    expect(await model.ask(question)).toEqual({ ok: true, value: { fine: true } })
    const body = send.mock.calls[0][0]
    expect(body).toMatchObject({
      model: 'claude-haiku-4-5',
      output_config: { format: { type: 'json_schema', schema: { type: 'object' } } },
      system: 'SYSTEM-PROMPT',
      messages: [{ role: 'user', content: 'USER-PROMPT' }],
    })
    expect(body.output_config?.effort).toBeUndefined()
    expect(body.fallbacks).toBeUndefined()
    expect(body.betas).toBeUndefined()
  })

  it('gives a larger model named in the environment its effort and a fallback', async () => {
    const send = vi.fn<Send>(async () => reply({}))
    await fakeModel(send, { ANTHROPIC_API_KEY: 'test-key', ANTHROPIC_MODEL: 'claude-sonnet-5-5' }).model.ask(question)
    expect(send.mock.calls[0][0]).toMatchObject({ model: 'claude-sonnet-5-5', fallbacks: 'default', output_config: { effort: 'low' } })
  })

  it('logs token usage and nothing that was sent', async () => {
    const { model, log } = fakeModel(async () => reply({}))
    await model.ask(question)
    expect(log).toEqual(['[ai] test: test-model end_turn, 100 in / 50 out, call 1 of 120 today'])
  })

  it.each([
    ['a refusal', async () => reply('', 'refusal'), 'refusal'],
    ['an answer cut off', async () => reply('{"half":', 'max_tokens'), 'truncated'],
    ['text that is not JSON', async () => reply('Sorry, here you go: {'), 'bad-json'],
    ['a timeout', async () => Promise.reject(new Anthropic.APIConnectionTimeoutError()), 'timeout'],
    ['a rejected key', async () => Promise.reject(Anthropic.APIError.generate(401, undefined, 'USER-PROMPT test-key', new Headers())), 'api'],
    ['anything else thrown', async () => Promise.reject(new Error('USER-PROMPT')), 'api'],
  ] as const)('turns %s into an unavailable answer', async (_name, send, reason) => {
    const { model, log } = fakeModel(send)
    expect(await model.ask(question)).toEqual({ ok: false, reason })
    expect(log.join('\n')).not.toMatch(/USER-PROMPT|SYSTEM-PROMPT|test-key/)
  })

  it('stops at the daily ceiling and starts again on the next UTC day', async () => {
    let now = NOW
    const send = vi.fn<Send>(async () => reply({}))
    const model = createModel({
      env: { ANTHROPIC_API_KEY: 'test-key', AI_MAX_CALLS_PER_DAY: '2' },
      send,
      now: () => now,
      disk: { read: async () => null, write: async () => {} },
      log: () => {},
    })
    expect((await model.ask(question)).ok).toBe(true)
    // A failed call was still a request, so it counts.
    send.mockRejectedValueOnce(new Error('down'))
    expect(await model.ask(question)).toEqual({ ok: false, reason: 'api' })
    expect(await model.ask(question)).toEqual({ ok: false, reason: 'ceiling' })
    expect(send).toHaveBeenCalledTimes(2)

    now = Date.parse('2026-10-07T00:00:01Z')
    expect((await model.ask(question)).ok).toBe(true)
    expect(send).toHaveBeenCalledTimes(3)
  })

  it('keeps the count across a restart, as long as the disk does', async () => {
    const files = new Map<string, StoredSnapshot<{ calls: number }>>()
    const disk: DiskStore<{ calls: number }> = {
      read: async (id) => files.get(id) ?? null,
      write: async (id, snapshot) => void files.set(id, snapshot),
    }
    const send = vi.fn<Send>(async () => reply({}))
    const start = () => createModel({ env: { ANTHROPIC_API_KEY: 'test-key', AI_MAX_CALLS_PER_DAY: '3' }, send, now: () => NOW, disk, log: () => {} })

    const first = start()
    // Two briefs can ask at the same moment; neither may lose the other's call.
    await Promise.all([first.ask(question), first.ask(question)])
    expect(files.get('ai-calls')?.payload).toEqual({ calls: 2 })

    const second = start()
    expect((await second.ask(question)).ok).toBe(true)
    expect(await second.ask(question)).toEqual({ ok: false, reason: 'ceiling' })
    expect(send).toHaveBeenCalledTimes(3)
  })
})
