import { afterEach, expect, it, vi } from 'vitest'
import { DEFAULT_CONFIG } from '../../src/shared/config'

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

it('migrates legacy statistics, merges concurrent increments, and writes only the separate stats key', async () => {
  vi.resetModules()
  vi.useFakeTimers()
  const saved: Record<string, unknown> = { 'tv:config_v1': { ...structuredClone(DEFAULT_CONFIG), stats: { translatedChars: 100 } } }
  const set = vi.fn((values: Record<string, unknown>, cb: () => void) => { Object.assign(saved, structuredClone(values)); cb() })
  vi.stubGlobal('chrome', { runtime: {}, storage: { local: { get: (_key: string, cb: (value: unknown) => void) => cb(saved), set } } })
  const store = await import('../../src/shared/store')
  await Promise.all(Array.from({ length: 20 }, () => store.incrementTranslatedChars(10)))
  expect((await store.getConfig()).stats.translatedChars).toBe(300)
  expect(set).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(2000)
  expect(set).toHaveBeenCalledTimes(1)
  expect(set.mock.calls[0][0]).toEqual({ 'tv:stats_v1': { translatedChars: 300 } })
  expect((saved['tv:config_v1'] as typeof DEFAULT_CONFIG).stats.translatedChars).toBe(100)

  vi.resetModules()
  const restarted = await import('../../src/shared/store')
  expect((await restarted.getConfig()).stats.translatedChars).toBe(300)
})
