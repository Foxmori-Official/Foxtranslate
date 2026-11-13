import type { BgRequest } from '../shared/protocol'

const PAGES = new Set(['/options.html', '/popup.html', '/onboarding.html', '/files.html', '/review.html', '/privacy.html'])
const CONTENT_ACTIONS = new Set<BgRequest['kind']>([
  'translate', 'cancelTranslation', 'detectLang', 'compareTranslate', 'aiAssist', 'aiChat',
  'getPageConfig', 'getHighlights', 'saveWord', 'setBadge',
])

export function isExtensionPage(sender?: chrome.runtime.MessageSender): boolean {
  if (sender?.id !== chrome.runtime.id || !sender?.url || (sender.frameId != null && sender.frameId !== 0)) return false
  try {
    const url = new URL(sender.url)
    const base = new URL(chrome.runtime.getURL(''))
    return url.protocol === base.protocol && url.host === base.host && PAGES.has(url.pathname) &&
      (sender.origin === undefined || sender.origin === `${base.protocol}//${base.host}`)
  } catch { return false }
}

/** The browser supplies sender; a tab ID is present for both web and extension tabs. */
export function assertMessageAccess(message: BgRequest, sender?: chrome.runtime.MessageSender): void {
  if (isExtensionPage(sender)) return
  if (sender?.id === chrome.runtime.id && sender?.tab?.id != null && sender.frameId === 0 && sender.url) {
    let url: URL
    try { url = new URL(sender.url) } catch { throw new Error('无效的消息来源。') }
    if ((url.protocol === 'https:' || url.protocol === 'http:') && (sender.origin === undefined || sender.origin === url.origin)) {
      if (CONTENT_ACTIONS.has(message.kind)) return
      if (message.kind === 'command' && message.cmd === 'openOptions') return
      if (url.origin === 'https://www.youtube.com' && (
        message.kind === 'setSubtitlePreferences' || (message.kind === 'command' && message.cmd === 'openVideoOptions')
      )) return
    }
  }
  throw new Error('此操作只能由扩展界面发起。')
}
