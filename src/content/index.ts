import { matchHotkey } from '../shared/hotkeys'
export { matchHotkey } from '../shared/hotkeys'
// 内容脚本入口：配置装载与热同步、快捷键、消息监听、各子系统装配。
import { PageTranslator } from './page'
import { initSelection, setSelectionConfig } from './selection'
import { initHover, setHoverConfig } from './hover'
import { initInput, setInputConfig } from './input'
import { toggleFloatingBall, updateBallState } from './floatingBall'
import { initCompareWindow, toggleCompareWindow } from './compareWindow'
import { isTrustedInteraction } from '../shared/trustedEvents'
import { applyHighlights } from './highlight'
import { detectPageLang } from '../core/detect'
import { DEFAULT_CONFIG, normalizeConfig, type Config } from '../shared/config'
import type { BgRequest, BgResponse, ContentRequest, PageStateResult } from '../shared/protocol'
import { setContentUiLang } from './uiLang'
import { initFoxmoriAccountBridge } from './foxmoriAccount'

initFoxmoriAccountBridge()

const w = window as unknown as { __TV_CONTENT_INJECTED__?: boolean }
if (!w.__TV_CONTENT_INJECTED__) {
  w.__TV_CONTENT_INJECTED__ = true
  void main()
}

let currentConfig: Config = DEFAULT_CONFIG
const pageTranslator = new PageTranslator(() => currentConfig)

/** 整页翻译状态 → 扩展图标角标（绿 ✓ = 开启）。失败静默（页面卸载中 / SW 未就绪等）。 */
function reportBadge(active: boolean) {
  const req: BgRequest = { kind: 'setBadge', active }
  void chrome.runtime.sendMessage(req).catch(() => {})
}

/**
 * pageTranslator.toggle() 唯一入口：悬浮球 / 快捷键 / popup 命令 / 自动翻译全部走这里，
 * 状态变化后同步悬浮球与扩展图标角标。返回切换后状态。
 */
async function togglePageTranslation(): Promise<boolean> {
  const active = await pageTranslator.toggle()
  updateBallState(active)
  reportBadge(active)
  return active
}

async function main() {
  try {
    const resp = (await chrome.runtime.sendMessage({ kind: 'getConfig' })) as BgResponse<Config>
    currentConfig = resp.ok ? resp.data : DEFAULT_CONFIG
  } catch {
    currentConfig = DEFAULT_CONFIG
  }
  applyConfig(currentConfig, true)
}

function applyConfig(config: Config, first = false) {
  const previous = currentConfig
  currentConfig = config
  setContentUiLang(config)
  setSelectionConfig(config)
  setHoverConfig(config)
  setInputConfig(config)
  if (first) {
    initSelection(config)
    initHover(config)
    initInput(config)
    initCompareWindow()
    void maybeAutoTranslate()
  }
  // 悬浮球运行时开关（关闭即移除，开启即创建，无需刷新）
  toggleFloatingBall(config.floatingBall.enabled, {
    isActive: () => pageTranslator.isActive(),
    onToggle: () => void togglePageTranslation(),
  })
  if (first || previous.learning.enabled !== config.learning.enabled || previous.learning.highlightOnPage !== config.learning.highlightOnPage) {
    void applyHighlights(config.learning.enabled && config.learning.highlightOnPage)
  }
}

async function maybeAutoTranslate() {
  try {
    const host = location.hostname
    const match = (s: string) => host === s || host.endsWith('.' + s)
    if (currentConfig.general.neverTranslateSites.some(match)) return
    if (currentConfig.general.autoTranslateSites.some(match)) {
      await togglePageTranslation()
      return
    }
    if (currentConfig.general.autoTranslateLangs.length) {
      const pageLang = detectPageLang(document)
      if (pageLang && currentConfig.general.autoTranslateLangs.includes(pageLang)) {
        await togglePageTranslation()
      }
    }
  } catch {
    /* 自动翻译失败静默 */
  }
}

// 快捷键：按 config.hotkeys 解析匹配（与 manifest command 双保险）。
// 处理器每次按键时读 currentConfig.hotkeys，configChanged 热同步后新配置即时生效。
document.addEventListener('keydown', (e) => {
  if (!isTrustedInteraction(e)) return
  const hk = currentConfig.hotkeys ?? DEFAULT_CONFIG.hotkeys
  if (matchHotkey(e, hk.togglePage)) {
    e.preventDefault()
    void togglePageTranslation()
    return
  }
  if (matchHotkey(e, hk.compare)) {
    e.preventDefault()
    // 对比窗由后续模块监听该事件
    toggleCompareWindow()
    return
  }
  if (matchHotkey(e, hk.openOptions)) {
    e.preventDefault()
    const req: BgRequest = { kind: 'command', cmd: 'openOptions' }
    void chrome.runtime.sendMessage(req)
  }
})

// 配置热同步
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return
  if (changes['tv:config_v1']) applyConfig(normalizeConfig(changes['tv:config_v1'].newValue))
  if (changes['tv:words_v1'] && currentConfig.learning.enabled && currentConfig.learning.highlightOnPage) void applyHighlights(true)
})

// 消息：popup / background 命令
chrome.runtime.onMessage.addListener((msg: ContentRequest, _sender, sendResponse) => {
  if (msg.kind === 'togglePage') {
    void togglePageTranslation().then((active) => {
      sendResponse({ active })
    })
    return true
  }
  if (msg.kind === 'pageState') {
    const counts = pageTranslator.counts()
    const result: PageStateResult = { active: pageTranslator.isActive(), ...counts, host: location.hostname }
    sendResponse(result)
    return false
  }
  if (msg.kind === 'configChanged') {
    applyConfig(msg.config)
    sendResponse(null)
    return false
  }
  return false
})

// 页面卸载/导航：尽力清角标（后台 tabs.onUpdated/onRemoved 还有兜底）
window.addEventListener('pagehide', () => reportBadge(false))
