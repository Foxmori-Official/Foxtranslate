// 划词翻译：选区气泡（翻译 / AI 解析 / 收藏生词 / 朗读 / 复制）。
import { DEFAULT_CONFIG, type Config } from '../shared/config'
import { ct } from './uiLang'
import { fmt } from '../shared/i18n'
import type { AiAssistAction, AiChatMessage, BgRequest, BgResponse, TranslateResult } from '../shared/protocol'
import { COMMON_LANG_CODES, LANGS, langName, langNative } from '../core/langs'
import { BUILTIN_ENGINES, builtinEngineSetupError } from '../shared/engines'
import { outlineIcon } from '../shared/ui/icon'
import { TtsPlayer } from './tts'

let popup: HTMLElement | null = null
let popupSize: ResizeObserver | null = null
let hideTimer: ReturnType<typeof setTimeout> | null = null
let currentConfig: Config | null = null

// 朗读播放器单例：跨气泡共享，重复朗读自动中断旧播放
const ttsPlayer = new TtsPlayer()
const SPEAK = 'M3 9h4l5-4v14l-5-4H3zM15 9a4 4 0 0 1 0 6m3-9a8 8 0 0 1 0 12'
const STOP = 'M7 7h10v10H7z'
const COPY = 'M8 8h12v12H8zM16 4H4v12'
const CLOSE = 'M6 6l12 12M18 6 6 18'

function setActionIcon(button: HTMLButtonElement, label: string, path: string): void {
  button.title = label
  button.setAttribute('aria-label', label)
  button.replaceChildren(outlineIcon(path))
}

export function setSelectionConfig(config: Config) {
  currentConfig = config
}

async function bg<T>(msg: BgRequest): Promise<T> {
  const resp = (await chrome.runtime.sendMessage(msg)) as BgResponse<T> | undefined
  if (!resp) throw new Error(ct('pop.s1', '翻译服务未响应'))
  if (!resp.ok) throw new Error(resp.error)
  return resp.data
}

function toast(text: string) {
  document.querySelectorAll('.tv-sel-toast').forEach((n) => n.remove())
  const t = document.createElement('div')
  t.className = 'tv-sel-toast'
  t.setAttribute('data-tv-owned', '1')
  t.textContent = text
  document.body.appendChild(t)
  setTimeout(() => t.remove(), 1600)
}

function removePopup() {
  if (hideTimer) clearTimeout(hideTimer)
  hideTimer = null
  popupSize?.disconnect()
  popupSize = null
  popup?.remove()
  popup = null
}

function getSelectionText(): string {
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed) return ''
  // 排除我们注入的译文元素：整页翻译后选区可能包含 tv-translation 子树，其文本会混入选区
  let text = ''
  for (let i = 0; i < sel.rangeCount; i++) {
    const range = sel.getRangeAt(i)
    const frag = range.cloneContents()
    // 克隆的 DocumentFragment 中移除扩展注入节点后再取文本
    frag.querySelectorAll?.('tv-translation, [data-tv-owned]').forEach((n) => n.remove())
    text += frag.textContent ?? ''
  }
  return text.replace(/\s+/g, ' ').trim()
}

function contextAroundSelection(text: string): string {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return text.slice(0, 160)
  const node = sel.anchorNode
  const block = node?.parentElement?.closest('p, li, h1, h2, h3, h4, h5, h6, td, blockquote, div')
  const blockText = block?.textContent ?? text
  const idx = blockText.indexOf(text)
  if (idx < 0) return blockText.slice(0, 160)
  return blockText.slice(Math.max(0, idx - 60), idx + text.length + 60)
}

/** 朗读/停止切换：参数取 config.tts，长文本由 TtsPlayer 按句切分连播。 */
function toggleSpeak(text: string, config: Config): void {
  if (ttsPlayer.isPlaying()) {
    ttsPlayer.stop()
    return
  }
  try {
    ttsPlayer.speak(text, {
      rate: config.tts.rate,
      pitch: config.tts.pitch,
      volume: config.tts.volume,
    })
    if (!ttsPlayer.isPlaying()) toast(ct('sel.ttsUnavailable', '朗读不可用'))
  } catch {
    toast(ct('sel.ttsUnavailable', '朗读不可用'))
  }
}

function buildTargetPicker(targetLang: string): HTMLSelectElement {
  const select = document.createElement('select')
  select.className = 'tv-sel-select tv-sel-target'
  select.setAttribute('aria-label', ct('popup.targetLang', '目标语言'))

  const common = document.createElement('optgroup')
  common.label = ct('lang.commonGroup', '常用语言')
  const other = document.createElement('optgroup')
  other.label = ct('lang.allGroup', '全部语言')
  for (const { code } of LANGS) {
    if (code === 'auto') continue
    const group = COMMON_LANG_CODES.includes(code) ? common : other
    group.append(new Option(langNative(code), code))
  }
  select.append(common, other)
  const initial = targetLang && targetLang !== 'auto' ? targetLang : DEFAULT_CONFIG.general.targetLang
  select.value = initial
  if (!select.value) {
    other.append(new Option(langNative(initial), initial))
    select.value = initial
  }
  return select
}

function providerName(id: string, engine: Config['engine']): string {
  const builtin = BUILTIN_ENGINES.find(item => item.id === id)
  if (builtin) return ct(builtin.nameKey, builtin.zh)
  if (id === 'custom') return ct('cmp.engine.custom', '自定义')
  return engine.customEngines.find(item => `custom:${item.id}` === id)?.name || id
}

function buildEnginePicker(engine: Config['engine']): HTMLSelectElement {
  const select = document.createElement('select')
  select.className = 'tv-sel-select tv-sel-engine'
  select.setAttribute('aria-label', ct('popup.engine', '翻译引擎'))
  select.add(new Option('', ''))
  for (const builtin of BUILTIN_ENGINES) {
    if (!builtinEngineSetupError(builtin.id, engine)) {
      select.add(new Option(ct(builtin.nameKey, builtin.zh), builtin.id))
    }
  }
  if (!builtinEngineSetupError('custom', engine)) {
    select.add(new Option(providerName('custom', engine), 'custom'))
  }
  for (const entry of engine.customEngines) {
    if (entry.id && entry.endpoint && entry.apiKey) {
      select.add(new Option(entry.name || entry.id, `custom:${entry.id}`))
    }
  }
  return select
}

function positionPopup(card: HTMLElement, rect: DOMRect): void {
  const margin = 8
  const width = card.offsetWidth
  const height = card.offsetHeight
  const below = window.innerHeight - rect.bottom
  const top = height + margin <= below || below >= rect.top
    ? rect.bottom + margin
    : rect.top - height - margin
  card.style.top = `${window.scrollY + Math.max(margin, Math.min(top, window.innerHeight - height - margin))}px`
  card.style.left = `${window.scrollX + Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin))}px`
}

function buildPopup(text: string, rect: DOMRect) {
  removePopup()
  const config = currentConfig!
  const pageContext = contextAroundSelection(text)
  const card = document.createElement('div')
  popup = card
  card.className = 'tv-sel-popup'
  card.setAttribute('data-tv-owned', '1')
  card.setAttribute('translate', 'no')
  card.setAttribute('role', 'dialog')
  const title = document.createElement('span')
  title.className = 'tv-sel-title'
  title.textContent = ct('sel.title', '翻译')
  card.setAttribute('aria-label', title.textContent)

  const header = document.createElement('div')
  header.className = 'tv-sel-head'
  const target = buildTargetPicker(config.general.targetLang)
  header.append(title, target)

  const body = document.createElement('div')
  body.className = 'tv-sel-body'
  const sourceRow = document.createElement('div')
  sourceRow.className = 'tv-sel-source-row'
  const source = document.createElement('div')
  source.className = 'tv-sel-source'
  source.textContent = text.length > 120 ? text.slice(0, 120) + '…' : text
  const utilities = document.createElement('div')
  utilities.className = 'tv-sel-utilities'
  sourceRow.append(source, utilities)

  const translation = document.createElement('div')
  translation.className = 'tv-sel-translation'
  translation.setAttribute('role', 'status')

  const aiBox = document.createElement('div')
  aiBox.className = 'tv-sel-ai'
  aiBox.style.display = 'none'
  body.append(sourceRow, translation, aiBox)

  const actions = document.createElement('div')
  actions.className = 'tv-sel-actions'
  const engine = buildEnginePicker(config.engine)
  actions.append(engine)
  card.append(header, body, actions)
  card.addEventListener('click', event => event.stopPropagation())

  const addBtn = (container: HTMLElement, label: string, onClick: () => void, style: 'primary' | 'secondary' | 'icon', path = '') => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'tv-sel-btn tv-sel-' + style
    if (style === 'icon') setActionIcon(b, label, path)
    else b.textContent = label
    b.addEventListener('click', (e) => {
      e.stopPropagation()
      onClick()
    })
    container.append(b)
    return b
  }

  let requestNumber = 0
  const translateSelection = async () => {
    const request = ++requestNumber
    const engineConfig = (currentConfig ?? config).engine
    engine.options[0].text = fmt(ct('sel.defaultEngine', '默认 · {engine}'), {
      engine: providerName(engineConfig.provider, engineConfig),
    })
    translation.textContent = ct('sel.translating', '翻译中…')
    const isCurrent = () => popup === card && request === requestNumber
    try {
      const result = await bg<TranslateResult>({
        kind: 'translate', text, targetLang: target.value, provider: engine.value || undefined,
      })
      if (isCurrent()) translation.textContent = result.text
    } catch (err) {
      if (isCurrent()) translation.textContent = ct('sel.translateFailed', '翻译失败：') + (err as Error).message
    }
  }
  for (const picker of [target, engine]) {
    picker.addEventListener('change', event => {
      event.stopPropagation()
      void translateSelection()
    })
  }

  // ===== AI 阅读卡片（四动作解析 + 多轮追问，重灾区 #5） =====
  let aiPanelBuilt = false

  const buildAiPanel = () => {
    if (aiPanelBuilt) return
    aiPanelBuilt = true

    const resultBox = document.createElement('div')
    resultBox.className = 'tv-sel-ai-result'
    resultBox.setAttribute('role', 'status')
    resultBox.style.cssText = 'white-space:pre-wrap;word-break:break-word;'
    resultBox.textContent = ct('sel.aiThinking', '思考中…')

    const chatList = document.createElement('div')
    chatList.style.cssText = 'display:flex;flex-direction:column;gap:6px;margin-top:6px;'

    const inputRow = document.createElement('div')
    inputRow.style.cssText = 'display:flex;gap:4px;margin-top:8px;'
    const followInput = document.createElement('input')
    followInput.type = 'text'
    followInput.placeholder = ct('sel.aiFollowPh', '追问：用法 / 近义词 / 更多例句…')
    followInput.style.cssText =
      'flex:1;min-width:0;font:12px var(--tv-font);padding:4px 6px;border:1px solid #cbd5e1;border-radius:6px;'
    const sendBtn = document.createElement('button')
    sendBtn.className = 'tv-sel-btn tv-sel-primary'
    sendBtn.textContent = ct('sel.aiSend', '发送')
    inputRow.append(followInput, sendBtn)
    aiBox.append(resultBox, chatList, inputRow)

    // 对话历史：首条 user = 选中内容+上下文+初始问题，assistant = 首轮回答，之后交替
    const history: AiChatMessage[] = []
    let ready = false
    let sending = false

    const appendBubble = (role: 'user' | 'assistant', content: string) => {
      const b = document.createElement('div')
      b.style.cssText =
        'white-space:pre-wrap;word-break:break-word;font-size:12px;padding:6px 8px;border-radius:8px;max-width:92%;' +
        (role === 'user'
          ? 'align-self:flex-end;background:#2563eb;color:#fff;'
          : 'align-self:flex-start;background:#e2e8f0;color:#1e293b;')
      b.textContent = content
      chatList.appendChild(b)
      b.scrollIntoView({ block: 'nearest' })
    }

    const sendFollowUp = () => {
      const q = followInput.value.trim()
      if (!q || sending) return
      if (!ready) {
        toast(ct('sel.aiBusy', '首轮解析进行中，请稍候'))
        return
      }
      followInput.value = ''
      appendBubble('user', q)
      history.push({ role: 'user', content: q })
      sending = true
      sendBtn.disabled = true
      bg<{ text: string }>({ kind: 'aiChat', messages: history })
        .then(({ text: reply }) => {
          history.push({ role: 'assistant', content: reply })
          appendBubble('assistant', reply)
        })
        .catch((e: Error) => {
          appendBubble('assistant', fmt(ct('sel.aiRequestFailed', '（请求失败：{msg}）'), { msg: e.message }))
        })
        .finally(() => {
          sending = false
          sendBtn.disabled = false
          followInput.focus()
        })
    }
    followInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        sendFollowUp()
      }
    })
    followInput.addEventListener('click', (e) => e.stopPropagation())
    sendBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      sendFollowUp()
    })

    // 首轮：四动作并行解析（带页面上下文注入）
    const actions4: AiAssistAction[] = ['meaning', 'grammar', 'usage', 'practice']
    Promise.all(
      actions4.map((a) =>
        bg<{ text: string }>({
          kind: 'aiAssist',
          action: a,
          text,
          context: pageContext,
          targetLang: config.general.targetLang,
        }).then(result => result.text).catch((e: Error) => fmt(ct('sel.aiUnavailable', '（{action} 不可用：{msg}）'), { action: a, msg: e.message })),
      ),
    ).then((parts) => {
      const combined = parts.join('\n\n')
      resultBox.textContent = combined
      history.push({
        role: 'user',
        content:
          `选中内容：${text}\n` +
          `页面上下文：${pageContext}\n` +
          `初始问题：请给出以上选中内容的释义、语法分析、用法讲解与随堂练习，` +
          `并始终用${langName(config.general.targetLang, 'zh')}回答。`,
      })
      history.push({ role: 'assistant', content: combined })
      ready = true
    })
  }

  addBtn(actions, ct('sel.ai', 'AI 解析'), () => {
    aiBox.style.display = aiBox.style.display === 'none' ? 'block' : 'none'
    if (aiBox.style.display === 'block') buildAiPanel()
  }, 'secondary')
  if (config.learning.enabled) {
    addBtn(actions, ct('sel.save', '☆ 收藏'), async () => {
      try {
        await bg({
          kind: 'saveWord',
          word: text,
          context: pageContext,
          pageUrl: location.href,
          pageTitle: document.title,
        })
        toast(ct('sel.savedWord', '已加入生词本'))
      } catch (e) {
        toast(ct('sel.saveFailed', '收藏失败：') + (e as Error).message)
      }
    }, 'primary')
  }
  // 朗读：播放中按钮变「停止」，再点停止；自然播完自动还原
  const speaking = ttsPlayer.isPlaying()
  const speakBtn = addBtn(utilities, speaking ? ct('sel.stop', '停止') : ct('sel.speak', '朗读'), () => toggleSpeak(text, config), 'icon', speaking ? STOP : SPEAK)
  ttsPlayer.onStateChange = (playing) => {
    setActionIcon(speakBtn, playing ? ct('sel.stop', '停止') : ct('sel.speak', '朗读'), playing ? STOP : SPEAK)
  }
  addBtn(utilities, ct('sel.copy', '复制'), async () => {
    try {
      await navigator.clipboard.writeText(text)
      toast(ct('sel.copied', '已复制'))
    } catch {
      toast(ct('sel.copyFailed', '复制失败'))
    }
  }, 'icon', COPY)
  addBtn(header, ct('sel.close', '关闭'), removePopup, 'icon', CLOSE)

  void translateSelection()
  document.body.appendChild(card)
  positionPopup(card, rect)
  popupSize = new ResizeObserver(() => {
    if (popup === card) positionPopup(card, rect)
  })
  popupSize.observe(card)
}

export function initSelection(config: Config) {
  currentConfig = config
  let timer: ReturnType<typeof setTimeout> | null = null
  document.addEventListener('selectionchange', () => {
    if (!currentConfig?.selection.enabled) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      if (!currentConfig?.selection.enabled) return
      if (popup?.contains(document.activeElement) || popup?.matches(':hover')) return
      const text = getSelectionText()
      const minLen = 1
      if (text.length < minLen || text.length > currentConfig.selection.maxChars) return
      const sel = window.getSelection()
      if (!sel || sel.rangeCount === 0) return
      const node = sel.anchorNode
      if (node instanceof Element && node.closest('[data-tv-owned]')) return
      if (node?.parentElement?.closest('[data-tv-owned]')) return
      const rect = sel.getRangeAt(0).getBoundingClientRect()
      if (!rect.width && !rect.height) return
      buildPopup(text, rect)
    }, 220)
  })
  document.addEventListener('mousedown', (e) => {
    if (popup && !popup.contains(e.target as Node)) removePopup()
  })
  window.addEventListener('scroll', () => {
    if (hideTimer) clearTimeout(hideTimer)
    hideTimer = setTimeout(removePopup, 150) // 滚动防抖隐藏，避免定位漂移
  }, { passive: true })
}
