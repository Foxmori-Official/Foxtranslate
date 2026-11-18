import { FOXMORI_SITE, isFoxmoriSite, type FoxmoriAccount, type FoxmoriBridgeRequest, type FoxmoriGroup } from '../shared/foxmori'
import { ok, err } from '../shared/protocol'

type RecordValue = Record<string, unknown>
function record(value: unknown): RecordValue { return value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {} }
function list(value: unknown): unknown[] { return Array.isArray(value) ? value : Array.isArray(record(value).items) ? record(value).items as unknown[] : [] }
const pendingKeys = new Set<string>()
const validKey = (key: unknown): key is string => typeof key === 'string' && Boolean(key.trim()) && !/[•*]/.test(key)

/** Runs only in a first-party tab; HttpOnly authentication stays with the website. */
export async function foxmoriAccountRequest(msg: FoxmoriBridgeRequest, fetcher: typeof fetch = fetch): Promise<FoxmoriAccount | { apiKey: string } | { ready: true }> {
  if (msg.action === 'ready') return { ready: true }
  // Bound the session lock and request; uncertain writes get a separate bounded read.
  let signal = AbortSignal.timeout(20_000)
  async function api(path: string, body?: unknown): Promise<unknown> {
    const response = await fetcher(FOXMORI_SITE + '/api/console/' + path, {
      method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
      headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body), signal,
    })
    const payload = record(await response.json().catch(() => ({})))
    if (!response.ok || payload.code !== 0) throw Object.assign(new Error(
      typeof payload.message === 'string' ? payload.message : 'Foxmori 服务暂不可用，请稍后重试。'), { status: response.ok ? undefined : response.status })
    return payload.data
  }
  async function request() {
    signal.throwIfAborted()
    if (msg.action === 'createKey') {
      const { accountId, groupId } = msg
      if (!Number.isSafeInteger(accountId) || accountId < 1 || !Number.isSafeInteger(groupId) || groupId < 1) {
        throw new Error('请选择有效的 Foxmori 账户和套餐分组。')
      }
      const operation = `${accountId}:${groupId}`
      if (!msg.reconcile && !pendingKeys.has(operation)) {
        pendingKeys.add(operation)
        try {
          const { key } = record(await api('keys', { name: 'Foxtranslate', group_id: groupId, account_id: accountId }))
          if (validKey(key)) {
            pendingKeys.delete(operation)
            return { apiKey: key }
          }
        } catch (error) {
          const status = (error as { status?: number }).status
          if (status && status < 500 && status !== 408) {
            pendingKeys.delete(operation)
            throw error
          }
        }
      }
      // An uncertain POST is reconciled with a read, never automatically replayed.
      pendingKeys.add(operation)
      signal = AbortSignal.timeout(5_000)
      const key = list(await api('keys?page=1&page_size=100')).map(record).find(key =>
        key.user_id === accountId && (key.group_id ?? record(key.group).id) === groupId &&
        key.name === 'Foxtranslate' && key.status === 'active' && validKey(key.key))
      if (!key) throw new Error('密钥创建结果尚未确认，请在主站密钥列表核对并复制密钥，避免重复创建。')
      pendingKeys.delete(operation)
      return { apiKey: key.key as string }
    }
    const profile = record(await api('user/profile'))
    if (!Number.isSafeInteger(profile.id) || Number(profile.id) < 1) throw new Error('账户信息不完整，请重新登录 Foxmori。')
    const groups: FoxmoriGroup[] = list(await api('groups/available')).map(record)
      .filter(g => Number.isSafeInteger(g.id) && Number(g.id) > 0)
      .map(g => ({ id: Number(g.id), name: typeof g.name === 'string' ? g.name : String(g.id) }))
    return {
      authenticated: true,
      user: {
        id: Number(profile.id),
        email: typeof profile.email === 'string' ? profile.email : '',
        username: typeof profile.username === 'string' ? profile.username : '',
      },
      groups,
    }
  }
  try {
    // Use the same origin-scoped lock as the website console to serialize cookie refreshes.
    return await navigator.locks.request('foxmori-console-session', { signal }, request)
  } catch (error) {
    if (signal.aborted) throw new Error('Foxmori 账户请求超时，请稍后重试。')
    throw error
  }
}

export function initFoxmoriAccountBridge(): void {
  if (!isFoxmoriSite(location.href)) return
  chrome.runtime.onMessage.addListener((msg: FoxmoriBridgeRequest, sender, respond) => {
    if (msg?.kind !== 'foxmoriBridge' || sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('background.js') || sender.tab) return
    if (msg.action !== 'ready' && msg.action !== 'account' && msg.action !== 'createKey') return
    void foxmoriAccountRequest(msg).then(data => respond(ok(data))).catch(error => respond(err(error)))
    return true
  })
}
