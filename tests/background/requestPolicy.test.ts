import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_CONFIG, type Config } from '../../src/shared/config'
import { setFetchImpl, syncCustomEngines } from '../../src/background/engines'
import { translate, translateTexts, aiAssist } from '../../src/background/translate'
import { resetBatchQueues } from '../../src/background/batch'
import { clearAll } from '../../src/background/cache'
import { httpError } from '../../src/background/engines/fetch'
import { scheduleRequest, translationIdentity } from '../../src/background/requestPolicy'

function config(): Config {
  const c = structuredClone(DEFAULT_CONFIG)
  c.engine.provider = 'openai'
  c.engine.keys.openai = 'fixture-key'
  c.batch.intervalMs = 1
  return c
}
function chat(content: string) { return Response.json({ choices: [{ message: { content } }] }) }

beforeEach(async () => {
  vi.stubGlobal('chrome', { permissions: { contains: async () => true } })
  resetBatchQueues()
  await clearAll()
})
afterEach(() => { setFetchImpl(null); vi.unstubAllGlobals(); vi.useRealTimers() })

describe('provider configuration isolation', () => {
  it.each(['openai', 'deepseek', 'custom:fixture'])('rotates %s queues and caches after endpoint/key/model changes', async provider => {
    const calls: Array<{ url: string; key: string | null; model: string }> = []
    setFetchImpl(async (url, init) => {
      const body = JSON.parse(String(init?.body))
      calls.push({ url, key: new Headers(init?.headers).get('Authorization'), model: body.model })
      return chat(JSON.stringify({ translations: [{ id: 1, text: body.model }] }))
    })
    const c = config()
    c.engine.provider = provider
    c.engine.openai = c.engine.deepseek = { endpoint: 'https://old.invalid/v1', model: 'old-model' }
    c.engine.customEngines = [{ id: 'fixture', name: 'Fixture', endpoint: 'https://old.invalid/v1', apiKey: 'fixture-key', model: 'old-model', headersJson: '' }]
    syncCustomEngines(c)
    const options = { targetLang: 'zh-CN' }
    expect((await translate('same source', options, c)).text).toBe('old-model')
    const updated = structuredClone(c)
    updated.engine.keys.openai = 'new-fixture-key'
    updated.engine.openai = updated.engine.deepseek = { endpoint: 'https://new.invalid/v1', model: 'new-model' }
    Object.assign(updated.engine.customEngines[0], { endpoint: 'https://new.invalid/v1', model: 'new-model', apiKey: 'new-fixture-key' })
    syncCustomEngines(updated)
    expect((await translate('same source', options, updated)).text).toBe('new-model')
    expect((await translate('uncached source', options, updated)).text).toBe('new-model')
    expect(calls).toHaveLength(3)
    expect(calls.slice(1)).toEqual(Array(2).fill({ url: 'https://new.invalid/v1/chat/completions', key: 'Bearer new-fixture-key', model: 'new-model' }))
  })

  it('isolates prompt edits and does not expose keys in cache identities', async () => {
    const c = config()
    const first = await translationIdentity(c)
    c.experts.list[0].systemPrompt += ' new instruction'
    expect(await translationIdentity(c)).not.toBe(first)
    expect(first).toMatch(/^[0-9a-f]{64}$/)
    expect(first).not.toContain(c.engine.keys.openai)
  })
})

describe('actual request budgets', () => {
  it('bounds 50 document fallback singles and simultaneous AI requests to the account limit', async () => {
    const c = config()
    let active = 0, maximum = 0, calls = 0
    setFetchImpl(async (_url, init) => {
      active++; maximum = Math.max(active, maximum); calls++
      await new Promise(resolve => setTimeout(resolve, 2))
      active--
      const body = JSON.parse(String(init?.body))
      return chat(body.messages[0].content.includes('single JSON object') ? 'malformed batch output' : 'single translation')
    })
    const output = await Promise.all([
      translateTexts(Array.from({ length: 50 }, (_, n) => `document ${n}`), { targetLang: 'zh-CN' }, c),
      ...(['meaning', 'grammar', 'usage', 'practice'] as const).map(action => aiAssist(action, 'sentence', 'zh-CN', c)),
    ])
    expect(output[0]).toEqual(Array(50).fill('single translation'))
    expect(calls).toBe(55)
    expect(maximum).toBeLessThanOrEqual(3)
  })

  it.each([401, 403, 429, 500])('does not multiply a failed HTTP %s batch into singles', async status => {
    const c = config()
    c.engine.keys.openai += status
    const fetch = vi.fn(async () => new Response('', { status }))
    setFetchImpl(fetch)
    await expect(translateTexts(['a', 'b', 'c'], { targetLang: 'zh-CN' }, c)).rejects.toThrow(`HTTP ${status}`)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it.each(['document', 'page'])('stops %s format fallbacks when the service rejects a single request', async path => {
    const c = config()
    c.engine.keys.openai = 'fallback-auth-' + path
    c.batch.maxTexts = 8
    c.batch.intervalMs = 1000
    let calls = 0
    setFetchImpl(async (_url, init) => {
      calls++
      const body = JSON.parse(String(init?.body))
      return body.messages[0].content.includes('single JSON object') ? chat('invalid batch JSON') : new Response('', { status: 401 })
    })
    const texts = Array.from({ length: 8 }, (_, n) => `authentication fallback ${n}`)
    if (path === 'document') {
      await expect(translateTexts(texts, { targetLang: 'zh-CN' }, c)).rejects.toThrow('HTTP 401')
      expect(calls).toBeLessThanOrEqual(4)
    } else {
      const result = await Promise.allSettled(texts.map(text => translate(text, { targetLang: 'zh-CN' }, c)))
      expect(result.every(item => item.status === 'rejected')).toBe(true)
      expect(calls).toBe(2)
    }
  })

  it('shares a budget between an OpenAI provider and a custom instance of the same account', async () => {
    const c = config()
    c.batch.concurrency = 1
    const custom = structuredClone(c)
    custom.engine.provider = 'custom:shared'
    custom.engine.customEngines = [{ id: 'shared', name: 'Shared', endpoint: c.engine.openai.endpoint, model: 'other-model', apiKey: c.engine.keys.openai, headersJson: '' }]
    let release!: () => void
    const calls: string[] = []
    const first = scheduleRequest(c, async () => { calls.push('first'); await new Promise<void>(resolve => { release = resolve }) })
    await vi.waitFor(() => expect(calls).toEqual(['first']))
    const later = scheduleRequest(custom, async () => { calls.push('later') })
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(calls).toEqual(['first'])
    release()
    await Promise.all([first, later])
    expect(calls).toEqual(['first', 'later'])
  })

  it('prioritizes the current subtitle over queued background requests without exceeding the limit', async () => {
    const c = config()
    c.batch.concurrency = 1
    let release!: () => void
    const calls: string[] = []
    const first = scheduleRequest(c, async () => { calls.push('first'); await new Promise<void>(resolve => { release = resolve }) })
    await vi.waitFor(() => expect(calls).toEqual(['first']))
    const later = scheduleRequest(c, async () => { calls.push('prefetch') })
    const current = scheduleRequest(c, async () => { calls.push('current') }, true)
    await new Promise(resolve => setTimeout(resolve, 10))
    release()
    await Promise.all([first, later, current])
    expect(calls).toEqual(['first', 'current', 'prefetch'])
  })

  it('honors Retry-After for other requests to the same account', async () => {
    const c = config()
    c.engine.keys.openai = 'cooldown-fixture'
    await expect(scheduleRequest(c, async () => { throw httpError('test', new Response('', { status: 429, headers: { 'Retry-After': '1' } })) })).rejects.toThrow('HTTP 429')
    const started = Date.now()
    await scheduleRequest(c, async () => undefined)
    expect(Date.now() - started).toBeGreaterThanOrEqual(900)
  })
})
