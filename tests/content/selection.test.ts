// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { initSelection } from '../../src/content/selection'
import { DEFAULT_PAGE_CONFIG } from '../../src/shared/pageConfig'
import type { BgRequest, BgResponse, TranslateResult } from '../../src/shared/protocol'
import * as trusted from '../../src/shared/trustedEvents'

afterEach(() => {
  document.body.replaceChildren()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

it('keeps the latest translation when a previous request finishes later', async () => {
  // jsdom cannot create trusted input. Browser regression tests exercise the actual security boundary.
  vi.spyOn(trusted, 'isTrustedInteraction').mockReturnValue(true)
  vi.spyOn(trusted, 'protectExtensionUi').mockImplementation(() => {})
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
  Range.prototype.getBoundingClientRect = () => new DOMRect(40, 40, 60, 20)
  initSelection(structuredClone(DEFAULT_PAGE_CONFIG))
  window.getSelection()!.addRange(range)
  paragraph.dispatchEvent(new MouseEvent('pointerup', { button: 0, bubbles: true }))
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
