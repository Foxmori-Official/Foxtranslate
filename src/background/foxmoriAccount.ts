import { FOXMORI_SITE, isFoxmoriSite, type FoxmoriAccount, type FoxmoriBridgeRequest } from '../shared/foxmori'
import { updateConfig } from '../shared/store'
import type { BgResponse } from '../shared/protocol'

export function assertExtensionPage(sender?: chrome.runtime.MessageSender): void {
  if (!sender?.url?.startsWith(chrome.runtime.getURL(''))) throw new Error('此操作只能由扩展界面发起。')
}

async function accountTab(): Promise<number | null> {
  const tabs = await chrome.tabs.query({ url: FOXMORI_SITE + '/*' })
  const tab = tabs.find(tab => tab.active && isFoxmoriSite(tab.url ?? '')) ?? tabs.find(tab => isFoxmoriSite(tab.url ?? ''))
  return tab?.id ?? null
}

async function bridge<T>(request: FoxmoriBridgeRequest): Promise<T> {
  const tabId = await accountTab()
  if (tabId === null) throw new Error('请先打开 Foxmori 主站登录，再返回扩展连接账户。')
  let result: BgResponse<T>
  try { result = await chrome.tabs.sendMessage(tabId, request) }
  catch { throw new Error('请刷新 Foxmori 主站页面后再连接账户。') }
  if (!result?.ok) throw new Error(result && !result.ok ? result.error : 'Foxmori 页面未响应，请刷新后重试。')
  return result.data
}

export function getFoxmoriAccount(): Promise<FoxmoriAccount> { return bridge({ kind: 'foxmoriBridge', action: 'account' }) }

let creating = false
export async function createFoxmoriKey(groupId: number, accountId: number): Promise<void> {
  if (creating) throw new Error('正在创建 Foxmori 密钥，请稍候。')
  creating = true
  try {
    const { apiKey } = await bridge<{ apiKey: string }>({ kind: 'foxmoriBridge', action: 'createKey', groupId, accountId })
    if (!apiKey?.trim()) throw new Error('Foxmori 未返回有效密钥。')
    await updateConfig(({ engine }) => ({
      engine: {
        ...engine,
        keys: { ...engine.keys, foxmori: apiKey },
        foxmori: { model: apiKey === engine.keys.foxmori ? engine.foxmori.model : '' },
      },
    }))
  } finally {
    creating = false
  }
}

export async function openFoxmoriLogin(): Promise<void> {
  const id = await accountTab()
  if (id !== null) {
    const tab = await chrome.tabs.get(id)
    if (!isFoxmoriSite(tab.url ?? '')) throw new Error('Foxmori 主站页面已关闭，请重新打开。')
    const url = new URL(tab.url!)
    if (url.pathname === '/' && url.hash === '#models') await chrome.tabs.update(id, { active: true })
    else await chrome.tabs.update(id, { url: FOXMORI_SITE + '/#models', active: true })
    return
  }
  await chrome.tabs.create({ url: FOXMORI_SITE + '/#models', active: true })
}
