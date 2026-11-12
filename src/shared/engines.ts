/**
 * 内置翻译引擎显示名（单一数据源）：popup / options / onboarding 三处下拉共用。
 * 品牌名（foxmori / DeepL / Claude …）各语言不译；"免费/兼容"本地化。
 * 各页按需取 name（nameKey 查表）；options 引擎 tab 额外取 desc。
 */
import { t } from './i18n'
import type { UiLangCode } from './i18n'
import type { Config } from './config'

export const FREE_ENGINE_IDS: readonly string[] = ['google', 'bing', 'mymemory']

const BYOK_HINT: Record<string, string> = {
  deepl: 'deepl: missing API key. Open the Foxtranslate options page to set it.',
  openai: 'openai: missing API key. Open the Foxtranslate options page and fill in the OpenAI-compatible key field.',
  deepseek: 'deepseek: missing API key (shared with the OpenAI-compatible key field). Open the Foxtranslate options page to set it.',
  claude: 'claude: missing API key. Open the Foxtranslate options page to set it.',
  gemini: 'gemini: missing API key. Open the Foxtranslate options page to set it.',
  foxmori: 'foxmori: missing API key. Open the Foxtranslate options page to set it.',
  custom: 'custom: missing endpoint URL. Open the Foxtranslate options page to configure it.',
}

/** Required local settings for a built-in engine. The background still validates connectivity and permissions. */
export function builtinEngineSetupError(id: string, { keys, foxmori, custom }: Config['engine']): string | undefined {
  if (id === 'deepl' && !keys.deepl) return BYOK_HINT.deepl
  if ((id === 'openai' || id === 'deepseek') && !keys.openai) return BYOK_HINT[id]
  if (id === 'claude' && !keys.claude) return BYOK_HINT.claude
  if (id === 'gemini' && !keys.gemini) return BYOK_HINT.gemini
  if (id === 'foxmori') {
    if (!keys.foxmori.trim()) return BYOK_HINT.foxmori
    if (!foxmori.model.trim()) return 'Foxmori: choose a model on the options page.'
  }
  if (id === 'custom' && !custom.url.trim()) return BYOK_HINT.custom
}

/** These providers use the AI translation prompts, including the selected expert. */
export function isAiProvider(provider: string): boolean {
  return ['foxmori', 'openai', 'deepseek', 'claude', 'gemini'].includes(provider) || provider.startsWith('custom:')
}

export interface BuiltinEngine {
  id: string
  nameKey: string
  zh: string
  descKey?: string
  descZh?: string
}

export const BUILTIN_ENGINES: ReadonlyArray<BuiltinEngine> = [
  { id: 'foxmori', nameKey: 'engine.foxmori', zh: 'Foxmori', descKey: 'engine.foxmoriDesc', descZh: '连接狐森账户，创建密钥并选择账户可用的模型。' },
  { id: 'google', nameKey: 'engine.google', zh: '谷歌（免费）', descKey: 'engine.googleDesc', descZh: '谷歌 gtx 免费端点，开箱即用，无需密钥。' },
  { id: 'bing', nameKey: 'engine.bing', zh: '微软（免费）', descKey: 'engine.bingDesc', descZh: '微软 Edge 翻译端点，免费引擎链备选。' },
  { id: 'mymemory', nameKey: 'engine.mymemory', zh: 'MyMemory（免费）', descKey: 'engine.mymemoryDesc', descZh: 'MyMemory 免费接口，免费引擎链兜底。' },
  { id: 'deepl', nameKey: 'engine.deepl', zh: 'DeepL', descKey: 'engine.deeplDesc', descZh: 'DeepL 官方 API，需自备 API Key，翻译质量高。' },
  { id: 'openai', nameKey: 'engine.openai', zh: 'OpenAI 兼容', descKey: 'engine.openaiDesc', descZh: 'OpenAI / 硅基流动 / Ollama 等一切 OpenAI 兼容端点，需 API Key。' },
  { id: 'deepseek', nameKey: 'engine.deepseek', zh: 'DeepSeek', descKey: 'engine.deepseekDesc', descZh: 'DeepSeek 官方 API（OpenAI 兼容协议），需 API Key。' },
  { id: 'claude', nameKey: 'engine.claude', zh: 'Claude (Anthropic)', descKey: 'engine.claudeDesc', descZh: 'Anthropic Claude 官方 API，需自备 API Key，翻译质量高。' },
  { id: 'gemini', nameKey: 'engine.gemini', zh: 'Gemini (Google)', descKey: 'engine.geminiDesc', descZh: 'Google Gemini 官方 API，需自备 API Key，速度快、免费额度慷慨。' },
  { id: 'libretranslate', nameKey: 'engine.libretranslate', zh: 'LibreTranslate', descKey: 'engine.libretranslateDesc', descZh: '开源可自托管的翻译服务，填写实例地址即可。' },
]

/** 引擎显示名（按界面语言）。 */
export function engineName(e: BuiltinEngine, uiLang: UiLangCode | string): string {
  return t(e.nameKey, uiLang, e.zh)
}

/** 引擎说明（仅 options 引擎 tab 用）。 */
export function engineDesc(e: BuiltinEngine, uiLang: UiLangCode | string): string {
  if (!e.descKey || !e.descZh) return ''
  return t(e.descKey, uiLang, e.descZh)
}
