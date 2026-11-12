import type { Config } from '../../shared/config'
import { FREE_ENGINE_IDS, builtinEngineSetupError } from '../../shared/engines'
import type { Engine, EngineContext } from './types'
import { googleEngine } from './google'
import { bingEngine } from './bing'
import { mymemoryEngine } from './mymemory'
import { deeplEngine } from './deepl'
import { libreEngine } from './libre'
import { createOpenAICompatEngine, openaiEngine, deepseekEngine } from './openaiCompat'
import { claudeEngine } from './claude'
import { geminiEngine } from './gemini'
import { foxmoriEngine } from './foxmori'
import { customEngine } from './custom'

/** 全部引擎注册表。key 与 Config.engine.provider 对齐（'libretranslate' 而非 'libre'）。
 * custom:<id> 条目由 syncCustomEngines 按配置动态增删，勿在此静态登记。 */
export const ENGINES: Record<string, Engine> = {
  google: googleEngine,
  bing: bingEngine,
  mymemory: mymemoryEngine,
  deepl: deeplEngine,
  openai: openaiEngine,
  deepseek: deepseekEngine,
  claude: claudeEngine,
  gemini: geminiEngine,
  foxmori: foxmoriEngine,
  libretranslate: libreEngine,
  custom: customEngine,
}

/** 免费引擎失败链顺序（契约 §7）：单引擎失败冷却 60s 沉底由管线层实现，此处只给顺序。 */
export const FREE_CHAIN = FREE_ENGINE_IDS

/**
 * 解析引擎并做静态可用性校验：BYOK 缺 key 在路由阶段就抛（错误信息引导去设置页），
 * 而不是等请求 401。BYOK 不进免费链（契约 §7：配置错误不该被静默掩盖）。
 * custom:<id> 动态实例经 syncCustomEngines 同步后在此正常解析；
 * 未同步（无此配置）时落入 unknown engine 兜底报错。
 */
export function resolveEngine(id: string, ctx: EngineContext): Engine {
  const engine = ENGINES[id]
  if (!engine) throw new Error(`resolveEngine: unknown engine "${id}"`)
  const setupError = builtinEngineSetupError(id, ctx.config.engine)
  if (setupError) throw new Error(setupError)
  return engine
}

// ── 多实例自定义引擎（OpenAI 兼容，id 前缀 custom:）─────────────────────────

/** 动态自定义引擎条目的 id 前缀（Config.engine.provider 形如 'custom:<entryId>'）。 */
export const CUSTOM_ENGINE_PREFIX = 'custom:'

/** 解析 entry.headersJson：空串/非法 JSON/非对象/非字符串值一律容错为空头表——
 * 脏配置不该拖垮整个注册表同步（设置页另有表单校验把关）。 */
function parseCustomHeaders(headersJson: string): Record<string, string> {
  const raw = headersJson.trim()
  if (!raw) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return {}
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof v === 'string') out[k] = v
  }
  return out
}

/**
 * 按 config.engine.customEngines 全量重建 ENGINES 里的 custom:<id> 条目：
 * 先删除全部旧 custom:* 再按当前配置插入——增/删/改统一收敛为一次重建，
 * 内置引擎条目不受影响。entry 字段（endpoint/apiKey/model/headers）被闭包捕获，
 * 配置变更后再次调用即整体换新，无陈旧闭包问题。
 */
export function syncCustomEngines(config: Config): void {
  for (const key of Object.keys(ENGINES)) {
    if (key.startsWith(CUSTOM_ENGINE_PREFIX)) delete ENGINES[key]
  }
  for (const entry of config.engine.customEngines) {
    if (!entry.id) continue
    const headers = parseCustomHeaders(entry.headersJson)
    ENGINES[CUSTOM_ENGINE_PREFIX + entry.id] = createOpenAICompatEngine({
      id: CUSTOM_ENGINE_PREFIX + entry.id,
      name: entry.name || entry.id,
      getEndpoint: () => entry.endpoint,
      getApiKey: () => entry.apiKey,
      getModel: () => entry.model,
      getHeaders: () => headers,
    })
  }
}

export type { Engine, EngineContext, EngineResult } from './types'
export { setFetchImpl } from './fetch'
export { FOXMORI_ENDPOINT } from './foxmori'
