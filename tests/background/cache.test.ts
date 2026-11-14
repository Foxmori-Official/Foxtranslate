import { afterEach, beforeEach, expect, it, vi } from 'vitest'

let disk: Record<string, unknown>
let pendingWrites: Array<() => void>
let cache: typeof import('../../src/background/cache')

beforeEach(async () => {
  vi.resetModules()
  disk = { 'tv:cache_v1': { previous: 'cached translation' }, 'tv:config_v1': { key: 'fixture' } }
  pendingWrites = []
  vi.stubGlobal('chrome', {
    runtime: {},
    storage: { local: {
      get: (key: string, callback: (value: unknown) => void) => callback({ [key]: disk[key] }),
      set: (value: Record<string, unknown>, callback: () => void) => {
        pendingWrites.push(() => { Object.assign(disk, value); callback() })
      },
    } },
  })
  cache = await import('../../src/background/cache')
})
afterEach(() => vi.unstubAllGlobals())

it('clears loaded memory and persistent cache while preserving other storage', async () => {
  expect(await cache.get('previous')).toBe('cached translation')
  const clearing = cache.clearAll()
  await vi.waitFor(() => expect(pendingWrites.length).toBe(1))
  pendingWrites.shift()!()
  await clearing
  expect(await cache.get('previous')).toBeUndefined()
  expect(disk['tv:cache_v1']).toEqual({})
  expect(disk['tv:config_v1']).toEqual({ key: 'fixture' })
})

it('finishes clearing after a preceding disk write without restoring the old snapshot', async () => {
  await cache.set('new', 'translation')
  const saving = cache.flushCache()
  await vi.waitFor(() => expect(pendingWrites.length).toBe(1))
  const clearing = cache.clearAll()
  await Promise.resolve()
  expect(pendingWrites.length).toBe(1)
  pendingWrites.shift()!()
  await saving
  await vi.waitFor(() => expect(pendingWrites.length).toBe(1))
  pendingWrites.shift()!()
  await clearing
  expect(disk['tv:cache_v1']).toEqual({})
  expect(await cache.get('new')).toBeUndefined()
})

it('reports a persistent-storage failure instead of claiming that clearing succeeded', async () => {
  chrome.storage.local.set = ((_value: unknown, callback: () => void) => {
    Object.assign(chrome.runtime, { lastError: { message: 'fixture storage failure' } })
    callback()
    delete chrome.runtime.lastError
  }) as typeof chrome.storage.local.set
  await expect(cache.clearAll()).rejects.toThrow('fixture storage failure')
})
