// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { initSelection } from '../../src/content/selection'
import { DEFAULT_CONFIG } from '../../src/shared/config'
import type { BgRequest, BgResponse, TranslateResult } from '../../src/shared/protocol'

afterEach(() => {
  document.body.replaceChildren()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

it('keeps the latest translation when a previous request finishes later', async () => {
  vi.useFakeTimers()
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  })
  const pending = new Map<string, (response: BgResponse<TranslateResult>) => void>()
  vi.stubGlobal('chrome', {
    runtime: {
      sendMessage: (request: BgRequest) => new Promise<BgResponse<TranslateResult>>(resolve => {
        if (request.kind !== 'translate') throw new Error('Unexpected request')
        pending.set(request.targetLang, resolve)
      }),
    },
  })
  const paragraph = document.createElement('p')
  paragraph.textContent = 'Selected text'
  document.body.append(paragraph)
  const range = document.createRange()
  range.selectNodeContents(paragraph)
  range.getBoundingClientRect = () => new DOMRect(40, 40, 60, 20)
  initSelection(structuredClone(DEFAULT_CONFIG))
  window.getSelection()!.addRange(range)
  document.dispatchEvent(new Event('selectionchange'))
  await vi.advanceTimersByTimeAsync(220)

  const target = document.querySelector<HTMLSelectElement>('.tv-sel-target')!
  target.value = 'ja'
  target.dispatchEvent(new Event('change', { bubbles: true }))
  pending.get('ja')!({ ok: true, data: { text: '最新の翻訳' } })
  await vi.advanceTimersByTimeAsync(0)

  pending.get('zh-CN')!({ ok: true, data: { text: '先前的翻译' } })
  await vi.advanceTimersByTimeAsync(0)
  expect(document.querySelector('.tv-sel-translation')?.textContent).toBe('最新の翻訳')
  document.querySelector<HTMLButtonElement>('.tv-sel-head .tv-sel-icon')!.click()
})
