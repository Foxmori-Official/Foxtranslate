import { FOXMORI_SITE, isFoxmoriSite, type FoxmoriAccount, type FoxmoriBridgeRequest, type FoxmoriGroup } from '../shared/foxmori'
import { ok, err } from '../shared/protocol'

type RecordValue = Record<string, unknown>
function record(value: unknown): RecordValue { return value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {} }
function list(value: unknown): unknown[] { return Array.isArray(value) ? value : Array.isArray(record(value).items) ? record(value).items as unknown[] : [] }

/** Runs only in a first-party tab; HttpOnly authentication stays with the website. */
export async function foxmoriAccountRequest(msg: FoxmoriBridgeRequest, fetcher: typeof fetch = fetch): Promise<FoxmoriAccount | { apiKey: string }> {
  async function api(path: string, body?: unknown): Promise<unknown> {
    const response = await fetcher(FOXMORI_SITE + '/api/console/' + path, {
      method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
      headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20_000),
    })
    if (response.status === 401) {
      throw new Error(path === 'foxtranslate/key'
        ? '请在 Foxmori 主站重新登录，再返回扩展连接账户。'
        : '请先在 Foxmori 主站登录，再返回扩展连接账户。')
    }
    if (response.status === 409 && path === 'foxtranslate/key') {
      throw new Error('Foxmori 登录账户已切换，请重新连接后再创建密钥。')
    }
    const payload = record(await response.json().catch(() => ({})))
    if (!response.ok || payload.code !== 0) throw new Error(typeof payload.message === 'string' ? payload.message : 'Foxmori 服务暂不可用，请稍后重试。')
    return payload.data
  }
  if (msg.action === 'createKey') {
    const { accountId, groupId } = msg
    if (!Number.isSafeInteger(accountId) || accountId < 1 || !Number.isSafeInteger(groupId) || groupId < 1) {
      throw new Error('请选择有效的 Foxmori 账户和套餐分组。')
    }
    // The server checks the expected account and issues the key using the same session.
    const { key } = record(await api('foxtranslate/key', { account_id: accountId, group_id: groupId }))
    if (typeof key !== 'string' || !key.trim() || /[•*]/.test(key)) {
      throw new Error('Foxmori 未返回有效密钥，请检查主站的 API 密钥页。')
    }
    return { apiKey: key }
  }
  const profile = record(await api('user/profile'))
  if (!Number.isSafeInteger(profile.id) || Number(profile.id) < 1) throw new Error('账户信息不完整，请重新登录 Foxmori。')
  const groups: FoxmoriGroup[] = list(await api('groups/available')).map(record)
    .filter(g => Number.isSafeInteger(g.id) && Number(g.id) > 0)
    .map(g => ({ id: Number(g.id), name: typeof g.name === 'string' ? g.name : String(g.id) }))
  return {
    authenticated: true,
    user: { id: Number(profile.id), email: String(profile.email ?? ''), username: String(profile.username ?? '') }, groups,
  }
}

export function initFoxmoriAccountBridge(): void {
  if (!isFoxmoriSite(location.href)) return
  chrome.runtime.onMessage.addListener((msg: FoxmoriBridgeRequest, sender, respond) => {
    if (msg?.kind !== 'foxmoriBridge' || sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('background.js') || sender.tab) return
    if (msg.action !== 'account' && msg.action !== 'createKey') return
    void foxmoriAccountRequest(msg).then(data => respond(ok(data))).catch(error => respond(err(error)))
    return true
  })
}
