// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { PageTranslator } from '../../src/content/page'
import { DEFAULT_PAGE_CONFIG } from '../../src/shared/pageConfig'

let config = structuredClone(DEFAULT_PAGE_CONFIG)
let translator: PageTranslator
let observer: TestObserver
let releases: Array<() => void>
let requests: number

class TestObserver {
  elements = new Set<Element>()
  constructor(private callback: IntersectionObserverCallback) { observer = this }
  observe(el: Element) { this.elements.add(el) }
  unobserve(el: Element) { this.elements.delete(el) }
  disconnect() { this.elements.clear() }
  intersect() {
    this.callback([...this.elements].map(target => ({ target, isIntersecting: true }) as IntersectionObserverEntry), this as unknown as IntersectionObserver)
  }
}

beforeEach(() => {
  config = structuredClone(DEFAULT_PAGE_CONFIG)
  releases = []
  requests = 0
  document.body.innerHTML = '<main>' + Array.from({ length: 40 }, (_, n) => `<p>This paragraph contains useful information about language learning, example ${n}.</p>`).join('') + '</main>'
  vi.stubGlobal('IntersectionObserver', TestObserver)
  vi.stubGlobal('requestIdleCallback', (fn: IdleRequestCallback) => setTimeout(() => fn({ didTimeout: false, timeRemaining: () => 50 }), 0))
  vi.stubGlobal('cancelIdleCallback', clearTimeout)
  vi.stubGlobal('chrome', { runtime: { sendMessage: vi.fn((msg: { kind: string }) => {
    if (msg.kind !== 'translate') return Promise.resolve({ ok: true, data: null })
    requests++
    return new Promise(resolve => releases.push(() => resolve({ ok: true, data: { text: '这是翻译结果。', engine: 'fixture' } })))
  }) } })
  translator = new PageTranslator(() => config)
})

afterEach(async () => {
  if (translator.isActive()) await translator.toggle()
  for (const resolve of releases) resolve()
  await Promise.resolve()
  vi.unstubAllGlobals()
})

async function start() {
  await translator.toggle()
  await vi.waitFor(() => expect(observer.elements.size).toBe(40))
  observer.intersect()
}

it.each([1, 5, 8])('admits %s single requests and refills after each result', async concurrency => {
  config.batch.concurrency = concurrency
  await start()
  expect(requests).toBe(concurrency)
  releases[0]()
  await vi.waitFor(() => expect(requests).toBe(concurrency + 1))
})

it('supplies enough paragraphs for multiple full AI batches instead of stopping at four', async () => {
  config.engine.provider = 'foxmori'
  config.batch.concurrency = 3
  config.batch.maxTexts = 8
  await start()
  expect(requests).toBe(24)
})

it('uses single request admission when AI batching is disabled', async () => {
  config.engine.provider = 'openai'
  config.batch.enabled = false
  config.batch.concurrency = 5
  await start()
  expect(requests).toBe(5)
})

it('applies changed limits without cancelling active work or admitting extra work after a decrease', async () => {
  config.batch.concurrency = 2
  await start()
  expect(requests).toBe(2)
  config.batch.concurrency = 5
  translator.refreshConcurrency()
  expect(requests).toBe(5)
  config.batch.concurrency = 1
  translator.refreshConcurrency()
  for (const resolve of releases.slice(0, 4)) resolve()
  await vi.waitFor(() => expect(translator.translatedCount).toBe(4))
  expect(requests).toBe(5)
  releases[4]()
  await vi.waitFor(() => expect(requests).toBe(6))
})
