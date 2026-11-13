import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { assertMessageAccess } from '../../src/background/messagePolicy'
import { DEFAULT_CONFIG } from '../../src/shared/config'
import { toPageConfig } from '../../src/shared/pageConfig'
import type { BgRequest } from '../../src/shared/protocol'

const id = 'fixture-extension'
const origin = 'chrome-extension://' + id
const tab: chrome.tabs.Tab = { id: 5, index: 0, pinned: false, highlighted: false, windowId: 1, active: true, incognito: false, selected: true, groupId: -1, frozen: false, discarded: false, autoDiscardable: true }
const web = { id, url: 'https://fixture.invalid/page', origin: 'https://fixture.invalid', frameId: 0, tab }

beforeEach(() => vi.stubGlobal('chrome', { runtime: { id, getURL: (p: string) => origin + '/' + p } }))
afterEach(() => vi.unstubAllGlobals())

it.each<BgRequest>([
  { kind: 'getConfig' }, { kind: 'setConfig', patch: { uiLang: 'en' } }, { kind: 'getWords' },
  { kind: 'deleteWord', id: 'word' }, { kind: 'testEngine' }, { kind: 'foxmoriAccount' },
  { kind: 'foxmoriCreateKey', groupId: 1, accountId: 1 }, { kind: 'fetchModels', provider: 'foxmori' },
])('keeps $kind in an extension page, including options opened in a normal tab', action => {
  expect(() => assertMessageAccess(action, web)).toThrow()
  expect(() => assertMessageAccess(action, { ...web, url: origin + '/options.html#engine', origin })).not.toThrow()
})

it('allows regular content actions and rejects impersonated, opaque or nested senders', () => {
  const action = { kind: 'getPageConfig' } as const
  expect(() => assertMessageAccess(action, web)).not.toThrow()
  expect(() => assertMessageAccess(action, { ...web, id: 'other-extension' })).toThrow()
  expect(() => assertMessageAccess(action, { ...web, frameId: 1 })).toThrow()
  expect(() => assertMessageAccess(action, { ...web, origin: 'null' })).toThrow()
  expect(() => assertMessageAccess(action, { ...web, url: origin + '/background.js', origin })).toThrow()
})

it('only allows the top-level YouTube content script to modify caption preferences', () => {
  const action = { kind: 'setSubtitlePreferences', patch: { youtube: false } } as const
  expect(() => assertMessageAccess(action, { ...web, url: 'https://www.youtube.com/watch?v=fixture', origin: 'https://www.youtube.com' })).not.toThrow()
  for (const site of ['https://www.youtube.com.evil.invalid', 'https://www.youtube.com:444', 'http://www.youtube.com']) {
    expect(() => assertMessageAccess(action, { ...web, url: site + '/watch', origin: site })).toThrow()
  }
})

it('projects engine availability without copying endpoints, keys, request templates or user glossaries', () => {
  const config = structuredClone(DEFAULT_CONFIG)
  config.engine.keys.foxmori = 'fixture-foxmori-key'
  config.engine.foxmori.model = 'fixture-model'
  config.engine.keys.customHeadersJson = 'fixture-private-headers'
  config.engine.customEngines = [{ id: 'ready', name: 'Local service', endpoint: 'http://127.0.0.1:11434/v1', apiKey: 'fixture-local-key', headersJson: 'fixture-headers', model: 'fixture-model' }]
  config.glossary = [{ src: 'fixture-private-term', dst: '私人术语' }]
  const data = toPageConfig(config)
  expect(data.engine.choices).toContainEqual({ id: 'foxmori' })
  expect(data.engine.choices).toContainEqual({ id: 'custom:ready', name: 'Local service' })
  expect(JSON.stringify(data)).not.toMatch(/fixture-(?:\w+-)?(?:key|model|headers|term)|127\.0\.0\.1/)
  expect(data).not.toHaveProperty('glossary')
  expect(data.engine).not.toHaveProperty('keys')
})
