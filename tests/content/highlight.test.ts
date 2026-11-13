// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { applyHighlights } from '../../src/content/highlight'

afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals() })

it('does not reapply an old asynchronous highlight refresh after disabling highlights', async () => {
  document.body.textContent = 'A language learning page.'
  let finish!: (result: unknown) => void
  vi.stubGlobal('chrome', { runtime: { sendMessage: () => new Promise(resolve => { finish = resolve }) } })
  const pending = applyHighlights(true)
  await applyHighlights(false)
  finish({ ok: true, data: [{ word: 'language' }] })
  await pending
  expect(document.querySelector('mark.tv-hl')).toBeNull()
})
