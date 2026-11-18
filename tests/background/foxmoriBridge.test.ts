import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { foxmoriAccountRequest } from '../../src/content/foxmoriAccount'

const request = { kind: 'foxmoriBridge', action: 'createKey', accountId: 12, groupId: 7 } as const
const key = { id: 10, user_id: 12, group_id: 7, name: 'Foxtranslate', status: 'active', key: 'sk-created-fixture' }
const ok = (data: unknown) => Response.json({ code: 0, data })

beforeEach(() => vi.stubGlobal('navigator', { locks: { request: async (_name: string, _options: unknown, run: () => unknown) => run() } }))
afterEach(() => vi.unstubAllGlobals())

it('creates through the generic endpoint with the connected account and no client preflight', async () => {
  const fetcher = vi.fn(async () => ok(key))
  expect(await foxmoriAccountRequest(request, fetcher)).toEqual({ apiKey: key.key })
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(fetcher.mock.calls[0]).toEqual(['https://foxmori.com/api/console/keys', expect.objectContaining({
    method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Foxtranslate', group_id: 7, account_id: 12 }),
  })])
})

it.each([false, true])('reconciles a lost POST with the full generic list (paginated %s)', async paginated => {
  const items = [{ ...key, user_id: 13 }, { ...key, group_id: 8 }, { ...key, key: '••••' }, key]
  const fetcher = vi.fn().mockRejectedValueOnce(new TypeError('Network response lost'))
    .mockResolvedValueOnce(ok(paginated ? { items } : items))
  expect(await foxmoriAccountRequest(request, fetcher)).toEqual({ apiKey: key.key })
  expect(fetcher.mock.calls.map(([url, options]) => [new URL(url).pathname, options.method])).toEqual([
    ['/api/console/keys', 'POST'], ['/api/console/keys', 'GET'],
  ])
})

it('keeps uncertain creation read-only on retry until the matching key is found', async () => {
  const msg = { ...request, groupId: 9 }
  const fetcher = vi.fn().mockResolvedValueOnce(new Response('', { status: 502 }))
    .mockResolvedValueOnce(ok([])).mockResolvedValueOnce(ok({ items: [{ ...key, group_id: 9 }] }))
  await expect(foxmoriAccountRequest(msg, fetcher)).rejects.toThrow('结果尚未确认')
  expect(await foxmoriAccountRequest(msg, fetcher)).toEqual({ apiKey: key.key })
  expect(fetcher.mock.calls.map(([, options]) => options.method)).toEqual(['POST', 'GET', 'GET'])
})

it.each([401, 403, 409, 429])('keeps an explicit HTTP %s rejection without listing or creating again', async status => {
  const fetcher = vi.fn(async () => Response.json({ message: '服务端拒绝' }, { status }))
  await expect(foxmoriAccountRequest(request, fetcher)).rejects.toThrow('服务端拒绝')
  expect(fetcher).toHaveBeenCalledTimes(1)
})

it('uses a read-only reconciliation when the extension loses the creation reply', async () => {
  const fetcher = vi.fn(async () => ok([key]))
  expect(await foxmoriAccountRequest({ ...request, reconcile: true }, fetcher)).toEqual({ apiKey: key.key })
  expect(fetcher).toHaveBeenCalledExactlyOnceWith('https://foxmori.com/api/console/keys?page=1&page_size=100', expect.objectContaining({ method: 'GET' }))
})
