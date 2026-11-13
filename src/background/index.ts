// background 入口：消息总线、快捷键命令、右键菜单、生词本 FSRS 评分。
import { FSRS } from 'ts-fsrs'
import { getFoxmoriAccount, createFoxmoriKey, openFoxmoriLogin } from './foxmoriAccount'
import { assertMessageAccess, isExtensionPage } from './messagePolicy'
import { fetchProviderModels } from './models'
import { mergeSubtitlePreferences, normalizeConfig } from '../shared/config'
import { toPageConfig } from '../shared/pageConfig'
import { translate, translateTexts, detectLang, aiAssist, aiChat } from './translate'
import { compareTranslate } from './compare'
import { extractTermsWithAI } from './glossaryLibs'
import { ENGINES, syncCustomEngines } from './engines'
import { getConfig, setConfig, updateConfig, invalidateConfigSnapshot, incrementTranslatedChars, getWords, addWord, deleteWord, updateWord, toFsrsCard, toWordCard } from '../shared/store'
import { ok, err, type BgRequest, type BgResponse, type ContentRequest, type StatsResult, type TestEngineResult, type WordItem } from '../shared/protocol'

const fsrs = new FSRS({})

// Website content scripts get a safe projection via messages, never raw storage or credentials.
const storageReady = chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })
void storageReady.catch(error => console.error('Could not restrict extension storage', error))

let notifications = Promise.resolve()
function broadcast(message: ContentRequest): void {
  notifications = notifications.catch(() => {}).then(async () => {
    const tabs = await chrome.tabs.query({})
    await Promise.allSettled(tabs.flatMap(tab => tab.id == null ? [] : [chrome.tabs.sendMessage(tab.id, message, { frameId: 0 })]))
  })
  void notifications.catch(() => {})
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return
  if (changes['tv:config_v1']) {
    invalidateConfigSnapshot()
    broadcast({ kind: 'configChanged', config: toPageConfig(normalizeConfig(changes['tv:config_v1'].newValue)) })
  }
  if (changes['tv:words_v1']) broadcast({ kind: 'wordsChanged' })
})

async function handle(msg: BgRequest, sender?: chrome.runtime.MessageSender, signal?: AbortSignal): Promise<unknown> {
  assertMessageAccess(msg, sender)
  await storageReady
  const config = await getConfig()
  syncCustomEngines(config)
  switch (msg.kind) {
    case 'foxmoriLogin':
      await openFoxmoriLogin()
      return null
    case 'foxmoriAccount':
      return getFoxmoriAccount()
    case 'foxmoriCreateKey':
      return createFoxmoriKey(msg.groupId, msg.accountId)
    case 'fetchModels':
      return fetchProviderModels(config, msg.provider)
    case 'translate': {
      const { targetLang, sourceLang, context, immediate, scope, provider } = msg
      if (provider !== undefined && (typeof provider !== 'string' || !Object.hasOwn(ENGINES, provider))) {
        throw new Error('The selected translation engine is unavailable.')
      }
      const requestConfig = provider === undefined ? config : { ...config, engine: { ...config.engine, provider } }
      const result = await translate(msg.text, {
        targetLang, sourceLang, context, immediate, scope, exactProvider: provider !== undefined, signal,
      }, requestConfig)
      await incrementTranslatedChars(msg.text.length)
      return result
    }
    case 'translateBatch': {
      const results = await translateTexts(msg.texts, { targetLang: msg.targetLang, sourceLang: msg.sourceLang }, config)
      const total = msg.texts.reduce((s, t) => s + t.length, 0)
      await incrementTranslatedChars(total)
      return results
    }
    case 'detectLang':
      return { lang: await detectLang(msg.text, config) }
    case 'compareTranslate': {
      const results = await compareTranslate(msg.text, msg.targetLang, msg.engineIds, config)
      await incrementTranslatedChars(msg.text.length)
      return results
    }
    case 'aiAssist':
      return { text: await aiAssist(msg.action, msg.text, msg.targetLang, config, msg.context) }
    case 'aiChat':
      return { text: await aiChat(msg.messages, config) }
    case 'extractTerms':
      return { terms: await extractTermsWithAI(msg.text, msg.targetLang, config) }
    case 'getConfig':
      return config
    case 'getPageConfig':
      return toPageConfig(config)
    case 'setConfig': {
      const next = await setConfig(msg.patch)
      return next
    }
    case 'setSubtitlePreferences': {
      const next = await updateConfig(current => ({
        subtitles: mergeSubtitlePreferences(current.subtitles, msg.patch),
      }))
      return next.subtitles
    }
    case 'saveWord': {
      const word = await addWord(msg)
      return isExtensionPage(sender) ? word : null
    }
    case 'deleteWord':
      await deleteWord(msg.id)
      return null
    case 'getWords':
      return getWords()
    case 'getHighlights':
      return config.learning.enabled && config.learning.highlightOnPage
        ? (await getWords()).map(({ word, translation }) => ({ word, translation })) : []
    case 'reviewGrade': {
      const words = await getWords()
      const word = words.find((w) => w.id === msg.wordId)
      if (!word) throw new Error('单词不存在')
      const scheduling = fsrs.repeat(toFsrsCard(word.card), new Date())
      const next = scheduling[msg.rating]
      if (!next) throw new Error('无效的评分')
      await updateWord(msg.wordId, (w) => ({ ...w, card: toWordCard(next.card) }))
      return { due: next.card.due.getTime() }
    }
    case 'getStats': {
      const words = await getWords()
      const now = Date.now()
      const dueCount = words.filter((w) => w.card.due <= now).length
      const newCount = words.filter((w) => w.card.state === 0).length
      const stats: StatsResult = {
        dueCount,
        newCount,
        totalWords: words.length,
        translatedChars: config.stats.translatedChars,
      }
      return stats
    }
    case 'testEngine': {
      const engine = msg.provider ?? config.engine.provider
      const testConfig = { ...config, engine: { ...config.engine, provider: engine } }
      const started = Date.now()
      try {
        const result = await translate('Hello', { targetLang: config.general.targetLang, bypassCache: true, exactProvider: true }, testConfig)
        const out: TestEngineResult = {
          ok: true,
          text: result.text,
          engine,
          elapsedMs: Date.now() - started,
        }
        return out
      } catch (e) {
        const out: TestEngineResult = {
          ok: false,
          engine,
          elapsedMs: Date.now() - started,
          error: e instanceof Error ? e.message : String(e),
        }
        return out
      }
    }
    case 'setBadge': {
      // 整页翻译开关角标：绿底 ✓ = 该标签页翻译中。无 tab 上下文（popup/options 发来）忽略
      const tabId = sender?.tab?.id
      if (tabId == null) return null
      if (msg.active) {
        await chrome.action.setBadgeBackgroundColor({ color: '#67c23a', tabId })
        await chrome.action.setBadgeText({ text: '✓', tabId })
      } else {
        await chrome.action.setBadgeText({ text: '', tabId })
      }
      return null
    }
    case 'command': {
      if (msg.cmd === 'togglePage') {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
        if (tab?.id != null) await chrome.tabs.sendMessage(tab.id, { kind: 'togglePage' })
        return null
      }
      if (msg.cmd === 'openOptions') {
        await chrome.runtime.openOptionsPage()
        return null
      }
      if (msg.cmd === 'openVideoOptions') {
        await chrome.tabs.create({ url: chrome.runtime.getURL('options.html#video') })
        return null
      }
      const page = msg.cmd === 'openFiles' ? 'files.html' : 'review.html'
      const url = chrome.runtime.getURL(page)
      await chrome.tabs.create({ url })
      return null
    }
    default:
      throw new Error(`未知消息类型`)
  }
}

const pageRequests = new Map<string, AbortController>()
async function dispatch(msg: BgRequest, sender: chrome.runtime.MessageSender): Promise<unknown> {
  assertMessageAccess(msg, sender)
  const id = msg.kind === 'translate' || msg.kind === 'cancelTranslation' ? msg.requestId : undefined
  if (id === undefined) return handle(msg, sender)
  if (typeof id !== 'string' || !/^[a-z0-9-]{1,64}$/i.test(id)) throw new Error('Invalid translation request')
  const key = `${sender.tab?.id ?? 'extension'}:${sender.documentId ?? sender.url}:${id}`
  if (msg.kind === 'cancelTranslation') { pageRequests.get(key)?.abort(); return null }
  if (pageRequests.has(key) || pageRequests.size >= 512) throw new Error('Translation queue is full')
  const controller = new AbortController()
  pageRequests.set(key, controller)
  try { return await handle(msg, sender, controller.signal) }
  finally { if (pageRequests.get(key) === controller) pageRequests.delete(key) }
}

chrome.runtime.onMessage.addListener((msg: BgRequest, sender, sendResponse) => {
  dispatch(msg, sender)
    .then((data) => sendResponse(ok(data)))
    .catch((e) => sendResponse(err(e)))
  return true // 保持异步通道
})

// 角标兜底清理：content 的 pagehide 上报是尽力而为，
// 导航（status=loading，文档重建后旧 content 已销毁）与关标签在此兜底。
function clearTabBadge(tabId: number) {
  // tab 可能已销毁，setBadgeText 会 reject，静默吞掉
  void chrome.action.setBadgeText({ text: '', tabId }).catch(() => {})
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') clearTabBadge(tabId)
})

chrome.tabs.onRemoved.addListener((tabId) => clearTabBadge(tabId))

chrome.commands.onCommand.addListener((command) => {
  if (command === 'toggle-translation') {
    void chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      if (tab?.id != null) void chrome.tabs.sendMessage(tab.id, { kind: 'togglePage' })
    })
  }
})

chrome.runtime.onInstalled.addListener((details) => {
  chrome.contextMenus.create({
    id: 'tv-toggle-page',
    title: chrome.i18n.getMessage('menuTogglePage') || '切换整页翻译 (Foxtranslate)',
    contexts: ['page'],
  })
  chrome.contextMenus.create({
    id: 'tv-open-options',
    title: chrome.i18n.getMessage('menuOptions') || 'Foxtranslate 设置',
    contexts: ['page'],
  })
  // 仅首次安装弹出引导页；update/chrome_update 一律不打扰
  if (details.reason === 'install') {
    void chrome.tabs.create({ url: chrome.runtime.getURL('onboarding.html'), active: true })
  }
})

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'tv-toggle-page' && tab?.id != null) {
    void chrome.tabs.sendMessage(tab.id, { kind: 'togglePage' })
  } else if (info.menuItemId === 'tv-open-options') {
    void chrome.runtime.openOptionsPage()
  }
})

// 类型锚定：避免 WordItem/BgResponse 未使用告警的同时保留导出形状
export type { WordItem, BgResponse }
