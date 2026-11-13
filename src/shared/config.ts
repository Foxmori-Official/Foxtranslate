// Config 契约：单一对象 + 读时归一化（normalizeConfig 白名单逐 key 拷贝，等价于隐式 schema 迁移）
import { BUILTIN_EXPERTS, type ExpertPreset } from '../core/experts'
import { normalizeUiLang, type UiLangCode } from './i18n'

export type { ExpertPreset }
export interface GlossaryTerm { src: string; dst: string }

/** 自定义术语库 */
/** 自定义翻译引擎（OpenAI 兼容协议，可多实例） */
export interface CustomEngine {
  id: string
  name: string
  endpoint: string
  apiKey: string
  model: string
  headersJson: string
}

export interface CustomGlossaryLibrary {
  id: string
  name: string
  terms: GlossaryTerm[]
}

export interface SubtitleTextStyle {
  size: number
  color: string
  font: string
  weight: number
}

export interface SubtitlePreferences {
  enabled: boolean
  youtube: boolean
  meet: boolean
  showShortcut: boolean
  displayMode: 'bilingual' | 'translationOnly'
  translationPosition: 'above' | 'below'
  backgroundColor: string
  backgroundOpacity: number
  edgeStyle: 'shadow' | 'outline' | 'none'
  original: SubtitleTextStyle
  translation: SubtitleTextStyle
}

export type SubtitlePatch = Partial<Omit<SubtitlePreferences, 'original' | 'translation'>> & {
  original?: Partial<SubtitleTextStyle>
  translation?: Partial<SubtitleTextStyle>
}

export function mergeSubtitlePreferences(current: SubtitlePreferences, patch: SubtitlePatch): SubtitlePreferences {
  return {
    ...current, ...patch,
    original: { ...current.original, ...patch.original },
    translation: { ...current.translation, ...patch.translation },
  }
}

export interface Config {
  version: 1
  general: {
    targetLang: string
    sourceLang: string
    displayMode: 'bilingual' | 'translationOnly'
    autoTranslateSites: string[]
    autoTranslateLangs: string[]
    neverTranslateSites: string[]
  }
  engine: {
    /** 内置引擎 id 或自定义引擎 id（custom:<entryId>） */
    provider: string
    keys: {
      deepl: string
      openai: string
      claude: string
      gemini: string
      libreUrl: string
      customHeadersJson: string
      foxmori: string
    }
    openai: { endpoint: string; model: string }
    deepseek: { endpoint: string; model: string }
    claude: { model: string }
    gemini: { model: string }
    foxmori: { model: string }
    customEngines: CustomEngine[]
    custom: { url: string; bodyJson: string }
    timeoutMs: number
  }
  batch: {
    enabled: boolean
    maxTexts: number
    maxChars: number
    intervalMs: number
    concurrency: number
  }
  style: { styleId: string }
  selection: { enabled: boolean; mode: 'bilingual' | 'translationOnly'; maxChars: number }
  hover: { enabled: boolean; key: 'alt' | 'ctrl' | 'shift' | 'none' }
  input: { enabled: boolean; trigger: 'altEnter' | 'tripleSpace'; targetLang: string }
  mask: { enabled: boolean }
  glossary: GlossaryTerm[]
  /** AI 专家（prompt 策略），仅 AI 引擎生效 */
  experts: { activeId: string; list: ExpertPreset[] }
  /** 术语库：内置库开关（id→enabled，库数据打包在 public/glossary/）+ 自定义库 */
  glossaryLibs: { enabled: Record<string, boolean>; custom: CustomGlossaryLibrary[] }
  subtitles: SubtitlePreferences
  learning: { enabled: boolean; highlightOnPage: boolean }
  floatingBall: { enabled: boolean }
  /** TTS 朗读参数 */
  tts: { rate: number; pitch: number; volume: number }
  /** 全页摘要上下文感知（仅 AI 引擎生效） */
  contextAware: { enabled: boolean }
  /** Alt+D 对比窗要同时调用的引擎 id 列表 */
  compareEngines: string[]
  /** 可自定义快捷键（如 'Alt+T'；空串=禁用） */
  hotkeys: { togglePage: string; compare: string; openOptions: string; toggleSubtitles: string }
  /** 界面显示语言（与翻译目标语言无关）；auto=跟随系统 */
  uiLang: UiLangCode
  /** 首次安装引导是否已完成 */
  onboardingCompleted: boolean
  stats: { translatedChars: number }
}

export const DEFAULT_CONFIG: Config = {
  version: 1,
  general: {
    targetLang: 'zh-CN',
    sourceLang: 'auto',
    displayMode: 'bilingual',
    autoTranslateSites: [],
    autoTranslateLangs: [],
    neverTranslateSites: [],
  },
  engine: {
    provider: 'google',
    keys: { deepl: '', openai: '', claude: '', gemini: '', libreUrl: '', customHeadersJson: '', foxmori: '' },
    openai: { endpoint: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
    deepseek: { endpoint: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
    claude: { model: 'claude-haiku-4-5-20251001' },
    gemini: { model: 'gemini-2.5-flash' },
    foxmori: { model: '' },
    customEngines: [],
    custom: { url: '', bodyJson: '{"text":"{{text}}","from":"{{from}}","to":"{{to}}"}' },
    timeoutMs: 20000,
  },
  batch: { enabled: true, maxTexts: 8, maxChars: 1200, intervalMs: 120, concurrency: 3 },
  style: { styleId: 'soft-gray' },
  selection: { enabled: true, mode: 'bilingual', maxChars: 2000 },
  hover: { enabled: true, key: 'alt' },
  input: { enabled: true, trigger: 'altEnter', targetLang: 'en' },
  mask: { enabled: false },
  glossary: [],
  experts: { activeId: 'general', list: BUILTIN_EXPERTS },
  glossaryLibs: { enabled: {}, custom: [] },
  subtitles: {
    enabled: true, youtube: true, meet: true, showShortcut: true,
    displayMode: 'bilingual', translationPosition: 'below',
    backgroundColor: '#000000', backgroundOpacity: 75, edgeStyle: 'shadow',
    original: { size: 100, color: '#ffffff', font: 'default', weight: 400 },
    translation: { size: 100, color: '#ffffff', font: 'default', weight: 400 },
  },
  learning: { enabled: true, highlightOnPage: false },
  floatingBall: { enabled: true },
  tts: { rate: 1, pitch: 1, volume: 1 },
  contextAware: { enabled: false },
  compareEngines: ['google', 'bing'],
  hotkeys: { togglePage: 'Alt+T', compare: 'Alt+D', openOptions: 'Alt+O', toggleSubtitles: 'Alt+S' },
  uiLang: 'auto',
  onboardingCompleted: false,
  stats: { translatedChars: 0 },
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function merge<T>(defaults: T, raw: unknown): T {
  if (Array.isArray(defaults)) {
    return (Array.isArray(raw) ? raw : defaults) as unknown as T
  }
  if (isObj(defaults)) {
    const out: Record<string, unknown> = { ...defaults }
    if (isObj(raw)) {
      for (const k of Object.keys(defaults)) {
        if (raw[k] !== undefined) out[k] = merge(defaults[k], raw[k])
      }
    }
    return out as T
  }
  return (raw !== undefined && typeof raw === typeof defaults ? raw : defaults) as T
}

/** 读时归一化：脏 key 丢弃、缺失 key 补默认、类型不符回退默认。 */
export function normalizeConfig(raw: unknown): Config {
  const stored = isObj(raw) ? raw : {}
  const config = merge(DEFAULT_CONFIG, stored)
  config.uiLang = normalizeUiLang(config.uiLang)
  const storedLibraries = stored.glossaryLibs
  // Library IDs are dynamic, so the default shape cannot enumerate their switches.
  if (isObj(storedLibraries) && isObj(storedLibraries.enabled)) {
    const enabled = Object.entries(storedLibraries.enabled).filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean')
    config.glossaryLibs.enabled = Object.fromEntries(enabled)
  }
  // A removed provider's credentials must never be sent to the replacement service.
  if (config.engine.provider === 'aimao') config.engine.provider = 'foxmori'
  config.compareEngines = config.compareEngines.filter(id => id !== 'aimao')
  const sub = config.subtitles
  sub.displayMode = sub.displayMode === 'translationOnly' ? 'translationOnly' : 'bilingual'
  sub.translationPosition = sub.translationPosition === 'above' ? 'above' : 'below'
  sub.edgeStyle = ['shadow', 'outline', 'none'].includes(sub.edgeStyle) ? sub.edgeStyle : 'shadow'
  const bounded = (n: number, min: number, max: number, fallback: number) => Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
  const color = (s: string, fallback: string) => /^#[0-9a-f]{6}$/i.test(s) ? s : fallback
  sub.backgroundOpacity = bounded(sub.backgroundOpacity, 0, 100, 75)
  sub.backgroundColor = color(sub.backgroundColor, '#000000')
  for (const text of [sub.original, sub.translation]) {
    text.size = bounded(text.size, 50, 200, 100)
    text.weight = bounded(text.weight, 300, 800, 400)
    text.color = color(text.color, '#ffffff')
    if (!['default', 'sans-serif', 'serif', 'monospace'].includes(text.font)) text.font = 'default'
  }
  return config
}
