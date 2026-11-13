import type { Config } from '../shared/config'
import { getExpert } from '../core/experts'

/** Only hashes leave this module; credentials never become storage keys or log messages. */
async function digest(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('')
}

function service(config: Config) {
  const e = config.engine
  const custom = e.customEngines.find(item => `custom:${item.id}` === e.provider)
  if (custom) return { endpoint: custom.endpoint, credential: custom.apiKey, headers: custom.headersJson, model: custom.model }
  switch (e.provider) {
    case 'openai': return { ...e.openai, endpoint: e.openai.endpoint || 'https://api.openai.com/v1', credential: e.keys.openai }
    case 'deepseek': return { ...e.deepseek, endpoint: e.deepseek.endpoint || 'https://api.deepseek.com/v1', credential: e.keys.openai }
    case 'foxmori': return { endpoint: 'https://api.foxmori.com/v1', credential: e.keys.foxmori, model: e.foxmori.model }
    case 'claude': return { endpoint: 'https://api.anthropic.com', credential: e.keys.claude, model: e.claude.model }
    case 'gemini': return { endpoint: 'https://generativelanguage.googleapis.com', credential: e.keys.gemini, model: e.gemini.model }
    case 'deepl': return { endpoint: 'deepl', credential: e.keys.deepl }
    case 'libretranslate': return { endpoint: e.keys.libreUrl || 'https://libretranslate.com' }
    case 'custom': return { endpoint: e.custom.url, headers: e.keys.customHeadersJson, template: e.custom.bodyJson }
    default: return { endpoint: e.provider }
  }
}

export function translationIdentity(config: Config): Promise<string> {
  return digest({
    version: 3, provider: config.engine.provider, service: service(config),
    expert: getExpert(config.experts.list, config.experts.activeId), mask: config.mask.enabled,
  })
}

async function accountIdentity(config: Config): Promise<string> {
  const { endpoint, credential, headers } = service(config) as { endpoint: string; credential?: string; headers?: string }
  let origin = endpoint
  try { origin = new URL(endpoint).origin } catch { /* built-in engine id */ }
  // Different models and custom instances using the same origin/key share the same budget.
  return digest({ origin, credential: credential || headers || '' })
}

interface Task {
  run: () => Promise<unknown>
  resolve: (value: unknown) => void
  reject: (error: unknown) => void
  priority: boolean
}
interface Limiter {
  active: number
  limit: number
  pending: Task[]
  blockedUntil: number
  timer?: ReturnType<typeof setTimeout>
}
const accounts = new Map<string, Limiter>()
const MAX_PENDING = 256

function pump(key: string, state: Limiter) {
  if (state.timer) return
  const wait = state.blockedUntil - Date.now()
  if (wait > 0 && state.pending.length) {
    state.timer = setTimeout(() => { state.timer = undefined; pump(key, state) }, wait)
    return
  }
  while (state.active < state.limit && state.pending.length) {
    const priority = state.pending.findIndex(task => task.priority)
    const task = state.pending.splice(priority < 0 ? 0 : priority, 1)[0]
    state.active++
    void Promise.resolve().then(task.run).then(task.resolve, error => {
      const failure = error as { statusCode?: number; retryAfterMs?: number }
      if (failure?.statusCode === 429) {
        const delay = Number.isFinite(failure.retryAfterMs) ? failure.retryAfterMs! : 1000
        state.blockedUntil = Math.max(state.blockedUntil, Date.now() + Math.max(1000, Math.min(delay, 300_000)))
      }
      task.reject(error)
    }).finally(() => {
      state.active--
      pump(key, state)
    })
  }
  if (!state.active && !state.pending.length && state.blockedUntil <= Date.now()) accounts.delete(key)
}

/** All translation paths, including fallback and AI assistance, share actual request slots. */
export async function scheduleRequest<T>(config: Config, run: () => Promise<T>, priority = false): Promise<T> {
  const key = await accountIdentity(config)
  let state = accounts.get(key)
  if (!state) {
    // Expired cooldown entries do not accumulate across endpoints/accounts.
    for (const [id, item] of accounts) {
      if (!item.active && !item.pending.length && item.blockedUntil <= Date.now()) accounts.delete(id)
    }
    if (accounts.size >= 64) throw new Error('Too many active translation services. Please try again later.')
    state = { active: 0, limit: 1, pending: [], blockedUntil: 0 }
    accounts.set(key, state)
  }
  const concurrency = config.batch.concurrency
  state.limit = Number.isFinite(concurrency) ? Math.max(1, Math.min(8, Math.floor(concurrency))) : 3
  if (state.pending.length >= MAX_PENDING) throw new Error('Translation queue is full. Please try again later.')
  return new Promise<T>((resolve, reject) => {
    state.pending.push({ run, resolve: resolve as (value: unknown) => void, reject, priority })
    pump(key, state)
  })
}

/** A successful HTTP response with an unusable batch format may be retried individually. */
export class BatchFormatError extends Error {}
