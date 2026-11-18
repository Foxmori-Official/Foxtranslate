import { FOXMORI_SITE, isFoxmoriSite, type FoxmoriAccount, type FoxmoriBridgeRequest } from '../shared/foxmori'
import { getConfig, updateConfig, getSavedFoxmoriAccount, saveFoxmoriAccount } from '../shared/store'
import type { BgResponse } from '../shared/protocol'

export { getSavedFoxmoriAccount }

const LOGIN_URL = FOXMORI_SITE + '/#models'
const SITE_UNAVAILABLE = 'Foxmori 主站页面已关闭或跳转，请重新打开。'
const BRIDGE_UNAVAILABLE = '无法连接 Foxmori 主站，请检查扩展是否允许访问 foxmori.com 后重试。'
const replyTimeoutMs = { ready: 500, account: 25_000, createKey: 30_000 }

function isRegularSiteTab(tab: chrome.tabs.Tab): boolean {
  return !tab.incognito && isFoxmoriSite(tab.url ?? '') &&
    (!tab.pendingUrl || isFoxmoriSite(tab.pendingUrl))
}

async function accountTab(): Promise<chrome.tabs.Tab | undefined> {
  const tabs = await chrome.tabs.query({ url: FOXMORI_SITE + '/*' })
  // Account settings live in the regular profile; never persist a private-window identity.
  const regular = tabs.filter(isRegularSiteTab)
  return regular.find(tab => tab.active) ?? regular[0]
}

const pause = () => new Promise(resolve => setTimeout(resolve, 100))

async function sendBridge<T>(tabId: number, request: FoxmoriBridgeRequest): Promise<BgResponse<T>> {
  const response = chrome.tabs.sendMessage(tabId, request, { frameId: 0 }).catch(() => {
    throw new Error('Foxmori 页面连接已中断，请重新连接账户。')
  })
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([response, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Foxmori 页面响应超时，请重新连接。')), replyTimeoutMs[request.action])
    })])
  } finally { clearTimeout(timer) }
}

async function regularSiteTab(tabId: number, allowLoading = false): Promise<chrome.tabs.Tab> {
  const tab = await chrome.tabs.get(tabId).catch(() => undefined)
  if (!tab) throw new Error(SITE_UNAVAILABLE)
  // A new tab can still be committing its initial HTTPS navigation. Wait without touching it.
  const opening = allowLoading && !tab.incognito && tab.status === 'loading' && isFoxmoriSite(tab.pendingUrl ?? '')
  if (!opening && !isRegularSiteTab(tab)) throw new Error(SITE_UNAVAILABLE)
  return tab
}

async function waitForDocument(tabId: number, deadline: number): Promise<void> {
  while (Date.now() < deadline) {
    const tab = await regularSiteTab(tabId, true)
    if (tab.status !== 'loading') return
    await pause()
  }
  throw new Error('Foxmori 主站加载超时，请检查网络后重试。')
}

async function bridgeResponds(tabId: number, attempts: number): Promise<boolean> {
  const deadline = Date.now() + 15_000
  for (let attempt = 0; attempt < attempts; attempt++) {
    await waitForDocument(tabId, deadline)
    try {
      const response = await sendBridge<{ ready: boolean }>(tabId, { kind: 'foxmoriBridge', action: 'ready' })
      if (response?.ok && response.data?.ready === true) return true
    } catch { /* The extension may have been reloaded while the tab stayed open. */ }
    if (attempt + 1 < attempts) await pause()
  }
  return false
}

const repairing = new Map<number, Promise<void>>()

async function ensureBridge(tabId: number): Promise<void> {
  const existing = repairing.get(tabId)
  if (existing) return existing
  const recovery = (async () => {
    if (await bridgeResponds(tabId, 3)) return
    await regularSiteTab(tabId)
    await chrome.tabs.reload(tabId)
    if (!await bridgeResponds(tabId, 20)) throw new Error(BRIDGE_UNAVAILABLE)
  })()
  repairing.set(tabId, recovery)
  try { return await recovery }
  finally { if (repairing.get(tabId) === recovery) repairing.delete(tabId) }
}

async function showLoginTab(): Promise<chrome.tabs.Tab> {
  const existing = await accountTab()
  let tab: chrome.tabs.Tab
  if (existing?.id != null) {
    const current = await regularSiteTab(existing.id)
    const updated = await chrome.tabs.update(existing.id, {
      active: true,
      ...(current.url === LOGIN_URL ? {} : { url: LOGIN_URL }),
    })
    tab = updated ?? await chrome.tabs.get(existing.id)
  } else {
    const windows = await chrome.windows.getAll({ windowTypes: ['normal'] })
    const regular = windows.find(window => !window.incognito && window.focused) ?? windows.find(window => !window.incognito)
    if (regular?.id != null) {
      tab = await chrome.tabs.create({ windowId: regular.id, url: LOGIN_URL, active: true })
    } else {
      const window = await chrome.windows.create({ url: LOGIN_URL, incognito: false, focused: true })
      if (!window.tabs?.[0]) throw new Error('无法打开 Foxmori 主站，请重试。')
      tab = window.tabs[0]
    }
  }
  await chrome.windows.update(tab.windowId, { focused: true })
  return tab
}

async function bridge<T>(request: FoxmoriBridgeRequest): Promise<T> {
  let tab = await accountTab()
  if (tab?.id == null && request.action === 'account') tab = await showLoginTab()
  if (tab?.id == null) throw new Error('请先打开 Foxmori 主站登录，再返回扩展连接账户。')
  await ensureBridge(tab.id)
  await regularSiteTab(tab.id)
  const result = await sendBridge<T>(tab.id, request).catch(async error => {
    if (request.action !== 'createKey') throw error
    await regularSiteTab(tab.id!)
    return sendBridge<T>(tab.id!, { ...request, reconcile: true })
  })
  if (!result?.ok) throw new Error(result && !result.ok ? result.error : 'Foxmori 页面未响应，请刷新后重试。')
  return result.data
}

export async function getFoxmoriAccount(): Promise<FoxmoriAccount> {
  const account = await bridge<FoxmoriAccount>({ kind: 'foxmoriBridge', action: 'account' })
  await saveFoxmoriAccount(account)
  return account
}

let creating = false
export async function createFoxmoriKey(groupId: number, accountId: number): Promise<void> {
  if (creating) throw new Error('正在创建 Foxmori 密钥，请稍候。')
  creating = true
  try {
    const previousKey = (await getConfig()).engine.keys.foxmori
    const { apiKey } = await bridge<{ apiKey: string }>({ kind: 'foxmoriBridge', action: 'createKey', groupId, accountId })
    if (typeof apiKey !== 'string' || !apiKey.trim() || /[•*]/.test(apiKey)) {
      throw new Error('Foxmori 未返回有效密钥。')
    }
    await updateConfig(({ engine }) => {
      // A response from an older request must not replace a later manual edit.
      if (engine.keys.foxmori !== previousKey) throw new Error('API Key 已在等待期间更改，已保留当前配置。请按需重新创建密钥。')
      return {
        engine: {
          ...engine,
          keys: { ...engine.keys, foxmori: apiKey },
          foxmori: { model: apiKey === previousKey ? engine.foxmori.model : '' },
        },
      }
    })
  } finally {
    creating = false
  }
}

export async function openFoxmoriLogin(): Promise<void> {
  const tab = await showLoginTab()
  if (tab.id != null) await ensureBridge(tab.id)
}
