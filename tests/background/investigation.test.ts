import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { clearAll } from '../../src/background/cache'
import { resetBatchQueues } from '../../src/background/batch'
import { setFetchImpl, syncCustomEngines } from '../../src/background/engines'
import { aiAssist, aiChat, detectLang, translate } from '../../src/background/translate'
import { extractTermsWithAI, resolveEffectiveGlossary, resetGlossaryLibCaches } from '../../src/background/glossaryLibs'
import { DEFAULT_CONFIG } from '../../src/shared/config'

const contains = vi.fn(async (_permissions: chrome.permissions.Permissions) => true)
beforeEach(async () => {
  await clearAll()
  resetBatchQueues()
  resetGlossaryLibCaches()
  contains.mockReset().mockResolvedValue(true)
  vi.stubGlobal('chrome', { permissions: { contains } })
})
afterEach(() => { setFetchImpl(null); vi.unstubAllGlobals() })

const chat = (content: string) => Response.json({ choices: [{ message: { content } }] })

it('does not reuse cached translations when distinct term lists shared the old signature', async () => {
  setFetchImpl(async (url, init) => {
    const text = (init?.body ? new URLSearchParams(String(init.body)) : new URL(url).searchParams).get('q')!
    return Response.json([[[text, text]], null, 'en'])
  })
  const first = structuredClone(DEFAULT_CONFIG)
  first.glossary = [{ src: 'a', dst: 'b;c=d' }]
  const second = { ...first, glossary: [{ src: 'a', dst: 'b' }, { src: 'c', dst: 'd' }] }
  expect((await translate('a c', { targetLang: 'zh-CN' }, first)).text).toBe('b;c=d c')
  expect((await translate('a c', { targetLang: 'zh-CN' }, second)).text).toBe('b d')
})

it('reuses loaded term tables across storage snapshots and refreshes them on edits', async () => {
  const config = structuredClone(DEFAULT_CONFIG)
  config.glossaryLibs.enabled = { bundled: true }
  const fetch = vi.fn(async (url: string) => url.endsWith('index.json')
    ? Response.json({ libraries: [{ id: 'bundled', name: 'Bundled', zhName: '内置', file: 'bundled.csv' }] })
    : new Response('source,target,tgt_lng\nTransformer,变压器,zh-CN\n'))
  setFetchImpl(fetch)
  const results = await Promise.all(Array.from({ length: 5 }, () => resolveEffectiveGlossary(structuredClone(config))))
  expect(fetch).toHaveBeenCalledTimes(2)
  expect(results.every(terms => terms === results[0])).toBe(true)
  config.glossary = [{ src: 'Transformer', dst: '变换器' }]
  expect(await resolveEffectiveGlossary(config)).toEqual([{ src: 'Transformer', dst: '变换器' }])
})

it('uses the selected request snapshot when another translation updates the custom engine registry', async () => {
  const a = structuredClone(DEFAULT_CONFIG)
  a.engine.provider = 'custom:fixture'
  a.engine.customEngines = [{ id: 'fixture', name: 'Fixture', apiKey: 'fixture-a', endpoint: 'https://first.invalid/v1', model: 'first', headersJson: '' }]
  a.batch.enabled = false
  const b = structuredClone(a)
  Object.assign(b.engine.customEngines[0], { apiKey: 'fixture-b', endpoint: 'https://second.invalid/v1', model: 'second' })
  const fetch = vi.fn(async (_url: string, init?: RequestInit) => chat(JSON.parse(String(init?.body)).model))
  setFetchImpl(fetch)
  syncCustomEngines(a)
  const first = translate('first snapshot', { targetLang: 'zh-CN' }, a)
  syncCustomEngines(b)
  const second = translate('second snapshot', { targetLang: 'zh-CN' }, b)
  expect((await Promise.all([first, second])).map(result => result.text)).toEqual(['first', 'second'])
  expect(fetch.mock.calls.map(([url]) => url).sort()).toEqual(['https://first.invalid/v1/chat/completions', 'https://second.invalid/v1/chat/completions'])
})

it('masks both source and context across translation, detection and AI request paths', async () => {
  const c = structuredClone(DEFAULT_CONFIG)
  c.engine.provider = 'openai'
  c.engine.keys.openai = 'fixture-api-key'
  c.batch.enabled = false
  c.mask.enabled = true
  const key = 'hf_' + 'x'.repeat(32)
  const email = 'audit-context@example.invalid'
  const calls: string[] = []
  setFetchImpl(async (url, init) => {
    const body = String(init?.body ?? url)
    calls.push(body)
    expect(decodeURIComponent(body)).not.toContain(key)
    expect(decodeURIComponent(body)).not.toContain(email)
    if (url.includes('googleapis.com')) return Response.json([[[ 'fixture', 'fixture' ]], null, 'en'])
    return chat(body.includes('JSON array') ? '[]' : '__PII_KEY_1__ and __PII_KEY_1__')
  })
  const result = await translate(`Credential: ${key}`, { targetLang: 'zh-CN', context: `Private address: ${email}` }, c)
  expect(result.text).toBe(key + ' and __PII_KEY_1__')
  await detectLang(`Check ${key} ${email}`, c)
  await aiAssist('meaning', key, 'zh-CN', c, email)
  await aiChat([{ role: 'user', content: email + ' ' + key }], c)
  await extractTermsWithAI(key + ' ' + email, 'zh-CN', c)
  expect(calls).toHaveLength(5)
})

it('does not expand a placeholder supplied as a glossary replacement into a secret', async () => {
  const c = structuredClone(DEFAULT_CONFIG)
  c.engine.provider = 'openai'
  c.engine.keys.openai = 'fixture-api-key'
  c.batch.enabled = false
  c.mask.enabled = true
  c.glossary = [{ src: 'term', dst: '__PII_KEY_1__' }]
  setFetchImpl(async () => chat('__GLOSSARY_1__ only'))
  const result = await translate('term and sk-' + 'v'.repeat(32), { targetLang: 'zh-CN' }, c)
  expect(result.text).toBe('__PII_KEY_1__ only')
})

it('refuses malformed or unauthorized destinations and preserves explicitly granted local endpoints', async () => {
  const c = structuredClone(DEFAULT_CONFIG)
  c.engine.provider = 'openai'
  c.engine.keys.openai = 'fixture-key'
  c.batch.enabled = false
  const fetch = vi.fn(async () => chat('local translated'))
  setFetchImpl(fetch)
  for (const url of ['file:///tmp/test', 'data:text/plain,fixture', 'javascript:alert(1)', 'http://user:pass@localhost:11434/v1', 'http://localhost/v1?query=x']) {
    c.engine.openai.endpoint = url
    await expect(translate('fixture', { targetLang: 'zh-CN' }, c)).rejects.toThrow('HTTP(S)')
  }
  expect(fetch).not.toHaveBeenCalled()
  c.engine.openai.endpoint = 'http://127.0.0.1:11434/v1'
  contains.mockResolvedValueOnce(false)
  await expect(translate('fixture', { targetLang: 'zh-CN' }, c)).rejects.toThrow('缺少对')
  expect(fetch).not.toHaveBeenCalled()
  expect((await translate('fixture', { targetLang: 'zh-CN' }, c)).text).toBe('local translated')
  expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:11434/v1/chat/completions', expect.objectContaining({ redirect: 'error', credentials: 'omit' }))
})
