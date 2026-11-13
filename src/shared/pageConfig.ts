import { DEFAULT_CONFIG, type Config } from './config'
import { BUILTIN_ENGINES, builtinEngineSetupError } from './engines'
import type { BgResponse } from './protocol'

/** Explicit allowlist of the settings needed to render controls on websites. */
export type PageConfig = Pick<Config,
  'general' | 'style' | 'selection' | 'hover' | 'input' | 'learning' | 'floatingBall' | 'tts' |
  'contextAware' | 'compareEngines' | 'hotkeys' | 'uiLang' | 'subtitles'
> & {
  engine: { provider: string; choices: { id: string; name?: string }[] }
  batch: Pick<Config['batch'], 'enabled' | 'maxTexts' | 'concurrency'>
}

export function toPageConfig(c: Config): PageConfig {
  const choices: PageConfig['engine']['choices'] = [...BUILTIN_ENGINES.map(e => e.id), 'custom']
    .filter(id => !builtinEngineSetupError(id, c.engine)).map(id => ({ id }))
  for (const entry of c.engine.customEngines) {
    if (entry?.id && entry.endpoint && entry.apiKey) choices.push({ id: `custom:${entry.id}`, name: entry.name || entry.id })
  }
  return {
    general: c.general, style: c.style, selection: c.selection, hover: c.hover, input: c.input,
    learning: c.learning, floatingBall: c.floatingBall, tts: c.tts, contextAware: c.contextAware,
    compareEngines: c.compareEngines, hotkeys: c.hotkeys, uiLang: c.uiLang, subtitles: c.subtitles,
    engine: { provider: c.engine.provider, choices },
    batch: { enabled: c.batch.enabled, maxTexts: c.batch.maxTexts, concurrency: c.batch.concurrency },
  }
}

export const DEFAULT_PAGE_CONFIG = toPageConfig(DEFAULT_CONFIG)

export async function getPageConfig(): Promise<PageConfig> {
  const response = await chrome.runtime.sendMessage({ kind: 'getPageConfig' }) as BgResponse<PageConfig>
  if (!response.ok) throw new Error(response.error)
  return response.data
}

/** Receive only notifications from the extension worker, not peer content scripts. */
export function isBackgroundSender(sender: chrome.runtime.MessageSender): boolean {
  return sender.id === chrome.runtime.id && !sender.tab && sender.url === chrome.runtime.getURL('background.js')
}

export function watchPageConfig(apply: (config: PageConfig) => void): void {
  chrome.runtime.onMessage.addListener((msg, sender) => {
    if (msg?.kind === 'configChanged' && msg.config && isBackgroundSender(sender)) apply(msg.config)
  })
}
