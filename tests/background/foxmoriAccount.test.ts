import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { getFoxmoriAccount, createFoxmoriKey, openFoxmoriLogin } from '../../src/background/foxmoriAccount'
import type { FoxmoriBridgeRequest } from '../../src/shared/foxmori'

const saved = vi.hoisted(() => ({ save: vi.fn(), getConfig: vi.fn(), updateConfig: vi.fn() }))
vi.mock('../../src/shared/store', () => ({
  getConfig: saved.getConfig,
  saveFoxmoriAccount: saved.save,
  updateConfig: saved.updateConfig,
  getSavedFoxmoriAccount: vi.fn(),
}))
const account = { authenticated: true, user: { id: 12, email: 'fixture@example.test', username: 'Fixture' }, groups: [{ id: 7, name: 'Fixture plan' }] }
let ready: boolean
let tabs: ReturnType<typeof vi.fn>
let getTab: ReturnType<typeof vi.fn>
let reload: ReturnType<typeof vi.fn>
let sendMessage: ReturnType<typeof vi.fn>
let create: ReturnType<typeof vi.fn>
let update: ReturnType<typeof vi.fn>
let focus: ReturnType<typeof vi.fn>
let listWindows: ReturnType<typeof vi.fn>
const tab = { id: 4, windowId: 9, url: 'https://foxmori.com/#models', active: true, status: 'complete', incognito: false }
const privateTab = { ...tab, id: 5, windowId: 16, incognito: true }
type KeyConfig = { engine: { keys: { foxmori: string }; foxmori: { model: string } } }
let config: KeyConfig

beforeEach(() => {
  ready = true
  vi.clearAllMocks()
  config = { engine: { keys: { foxmori: 'sk-previous-fixture' }, foxmori: { model: 'fixture-model' } } }
  saved.getConfig.mockImplementation(async () => config)
  saved.updateConfig.mockImplementation(async (patch: (state: KeyConfig) => KeyConfig) => {
    config = patch(config)
    return config
  })
  tabs = vi.fn(async () => [tab])
  getTab = vi.fn(async () => tab)
  reload = vi.fn(async () => { ready = true })
  sendMessage = vi.fn(async (_id: number, request: FoxmoriBridgeRequest) => {
    if (!ready) throw new Error('Could not establish connection. Receiving end does not exist.')
    return { ok: true, data: request.action === 'ready' ? { ready: true } : request.action === 'account' ? account : { apiKey: 'sk-fixture' } }
  })
  create = vi.fn(async () => tab)
  update = vi.fn(async () => tab)
  focus = vi.fn(async () => ({}))
  listWindows = vi.fn(async () => [{ id: tab.windowId, incognito: false, focused: true }])
  vi.stubGlobal('chrome', {
    tabs: { query: tabs, get: getTab, reload, sendMessage, create, update },
    windows: { getAll: listWindows, update: focus, create: vi.fn(async () => ({ tabs: [tab] })) },
  })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

it('repairs a tab left open across extension reload before connecting, without changing the API key', async () => {
  ready = false
  expect(await getFoxmoriAccount()).toEqual(account)
  expect(reload).toHaveBeenCalledExactlyOnceWith(tab.id)
  expect(saved.save).toHaveBeenCalledExactlyOnceWith(account)
  expect(saved.updateConfig).not.toHaveBeenCalled()
  expect(sendMessage.mock.calls.filter(call => call[1].action === 'account')).toHaveLength(1)
  expect(sendMessage.mock.calls.every(call => JSON.stringify(call[2]) === '{"frameId":0}')).toBe(true)
})

it('shares the page bridge readiness probe across simultaneous manual connections', async () => {
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  sendMessage.mockImplementation(async (_id: number, request: FoxmoriBridgeRequest) => {
    if (request.action === 'ready') { await gate; return { ok: true, data: { ready: true } } }
    return { ok: true, data: account }
  })
  const first = getFoxmoriAccount()
  const second = getFoxmoriAccount()
  await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1))
  release()
  expect(await Promise.all([first, second])).toEqual([account, account])
  expect(sendMessage.mock.calls.filter(call => call[1].action === 'ready')).toHaveLength(1)
  expect(reload).not.toHaveBeenCalled()
})

it('brings an existing login tab in another window to the foreground and repairs its connection', async () => {
  ready = false
  await openFoxmoriLogin()
  expect(update).toHaveBeenCalledWith(tab.id, { active: true })
  expect(focus).toHaveBeenCalledWith(tab.windowId, { focused: true })
  expect(reload).toHaveBeenCalledTimes(1)
  expect(create).not.toHaveBeenCalled()
  expect(saved.updateConfig).not.toHaveBeenCalled()
})

it('opens the website for a manual connection when no Foxmori tab exists', async () => {
  tabs.mockResolvedValue([])
  expect(await getFoxmoriAccount()).toEqual(account)
  expect(create).toHaveBeenCalledExactlyOnceWith({ windowId: tab.windowId, url: 'https://foxmori.com/#models', active: true })
  expect(focus).toHaveBeenCalledWith(tab.windowId, { focused: true })
})

it('uses the regular session even when the active Foxmori tab is in an incognito window', async () => {
  tabs.mockResolvedValue([privateTab, { ...tab, active: false }])
  expect(await getFoxmoriAccount()).toEqual(account)
  expect(sendMessage.mock.calls.map(call => call[0])).toEqual([tab.id, tab.id])
  expect(saved.save).toHaveBeenCalledExactlyOnceWith(account)
})

it('does not connect to a private tab and opens manual login in a regular window', async () => {
  tabs.mockResolvedValue([privateTab])
  listWindows.mockResolvedValue([
    { id: privateTab.windowId, incognito: true, focused: true },
    { id: tab.windowId, incognito: false, focused: false },
  ])
  await openFoxmoriLogin()
  expect(create).toHaveBeenCalledExactlyOnceWith({ windowId: tab.windowId, url: tab.url, active: true })
  expect(focus).toHaveBeenCalledExactlyOnceWith(tab.windowId, { focused: true })
  expect(sendMessage.mock.calls.map(call => call[0])).toEqual([tab.id])
})

it('does not navigate or reload unrelated pages if the selected tab changes its origin', async () => {
  getTab.mockResolvedValue({ ...tab, url: 'https://unrelated.invalid' })
  await expect(getFoxmoriAccount()).rejects.toThrow('关闭或跳转')
  expect(reload).not.toHaveBeenCalled()
  expect(sendMessage).not.toHaveBeenCalled()
})

it('checks for navigation again before reloading a tab with a stale receiver', async () => {
  ready = false
  sendMessage.mockImplementationOnce(async () => { throw new Error('No receiver') })
  sendMessage.mockImplementationOnce(async () => { throw new Error('No receiver') })
  sendMessage.mockImplementationOnce(async () => {
    getTab.mockResolvedValue({ ...tab, pendingUrl: 'https://unrelated.invalid', status: 'loading' })
    throw new Error('No receiver')
  })
  await expect(getFoxmoriAccount()).rejects.toThrow('关闭或跳转')
  expect(reload).not.toHaveBeenCalled()
  expect(saved.save).not.toHaveBeenCalled()
})

it('does not send an account operation to a tab that left Foxmori after the handshake', async () => {
  sendMessage.mockImplementationOnce(async () => {
    getTab.mockResolvedValue({ ...tab, url: 'blob:https://foxmori.com/fixture' })
    return { ok: true, data: { ready: true } }
  })
  await expect(createFoxmoriKey(7, 12)).rejects.toThrow('关闭或跳转')
  expect(sendMessage.mock.calls.map(call => call[1].action)).toEqual(['ready'])
  expect(saved.updateConfig).not.toHaveBeenCalled()
})

it.each(['Foxmori 登录账户已切换，请重新连接。', '请重新登录', '套餐不可用'])('preserves a server rejection without replacing the key or replaying creation: %s', async error => {
  sendMessage.mockImplementation(async (_id: number, request: FoxmoriBridgeRequest) => {
    return request.action === 'ready' ? { ok: true, data: { ready: true } } : { ok: false, error }
  })
  await expect(createFoxmoriKey(7, 12)).rejects.toThrow(error)
  expect(sendMessage.mock.calls.filter(call => call[1].action === 'createKey')).toHaveLength(1)
  expect(reload).not.toHaveBeenCalled()
  expect(saved.updateConfig).not.toHaveBeenCalled()
})

it('reconciles a closed creation channel with a read-only bridge request', async () => {
  sendMessage.mockImplementation(async (_id: number, request: FoxmoriBridgeRequest) => {
    if (request.action === 'ready') return { ok: true, data: { ready: true } }
    throw new Error('The message port closed before a response was received.')
  })
  await expect(createFoxmoriKey(7, 12)).rejects.toThrow('连接已中断')
  expect(sendMessage.mock.calls.filter(call => call[1].action === 'createKey').map(call => call[1].reconcile)).toEqual([undefined, true])
  expect(saved.updateConfig).not.toHaveBeenCalled()
})

it('times out creation once and ignores a late reply without writing the key', async () => {
  vi.useFakeTimers()
  let reply: (value: unknown) => void = () => {}
  const pending = new Promise(resolve => { reply = resolve })
  sendMessage.mockImplementation(async (_id: number, request: FoxmoriBridgeRequest) => {
    return request.action === 'ready' ? { ok: true, data: { ready: true } } : pending
  })
  const creating = expect(createFoxmoriKey(7, 12)).rejects.toThrow('响应超时')
  await vi.advanceTimersByTimeAsync(60_000)
  await creating
  reply({ ok: true, data: { apiKey: 'sk-late-fixture' } })
  await vi.advanceTimersByTimeAsync(0)
  expect(sendMessage.mock.calls.map(call => call[1].action)).toEqual(['ready', 'createKey', 'createKey'])
  expect(sendMessage.mock.calls.at(-1)?.[1]).toMatchObject({ reconcile: true })
  expect(saved.updateConfig).not.toHaveBeenCalled()
  expect(config.engine.keys.foxmori).toBe('sk-previous-fixture')
})

it('keeps a manually saved key when an older successful creation reply returns', async () => {
  sendMessage.mockImplementation(async (_id: number, request: FoxmoriBridgeRequest) => {
    if (request.action === 'ready') return { ok: true, data: { ready: true } }
    config = {
      engine: { keys: { foxmori: 'sk-manual-fixture' }, foxmori: { model: 'manual-model' } },
    }
    return { ok: true, data: { apiKey: 'sk-created-fixture' } }
  })
  await expect(createFoxmoriKey(7, 12)).rejects.toThrow('已保留当前配置')
  expect(config.engine).toEqual({
    keys: { foxmori: 'sk-manual-fixture' },
    foxmori: { model: 'manual-model' },
  })
})
