// Foxmori（foxmori.com）内置引擎：OpenAI 兼容协议，端点固定，无需用户填 endpoint。
// key 走 config.engine.keys.foxmori，model 走 config.engine.foxmori.model；
// system prompt / 批协议 / stripThinking 全部复用 openaiCompat 工厂，与其他 AI 引擎行为一致。
import { createOpenAICompatEngine } from './openaiCompat'
import { FOXMORI_API } from '../../shared/foxmori'

/** Foxmori固定端点（endpointUrlOf 与引擎共用此常量，避免两处漂移）。 */
export const FOXMORI_ENDPOINT = FOXMORI_API

export const foxmoriEngine = createOpenAICompatEngine({
  id: 'foxmori',
  name: 'Foxmori',
  getEndpoint: () => FOXMORI_ENDPOINT,
  getApiKey: (ctx) => ctx.config.engine.keys.foxmori,
  getModel: (ctx) => ctx.config.engine.foxmori.model.trim(),
})
