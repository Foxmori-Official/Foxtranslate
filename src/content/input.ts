// 输入框翻译：Alt+Enter 或三连空格触发，整段翻译后写回。
// 写回采用三级降级（参考 KISS smartReplaceText），每层执行后验证（值是否变成译文），失败才降级：
//   1. 富文本/contenteditable：focus → DataTransfer 塞译文 → 合成 ClipboardEvent('paste') 派发
//   2. document.execCommand('insertText')（浏览器原生插入，走完整编辑管线）
//   3a. input/textarea：原生原型 value setter（绕开 React 对实例 value 的重写）+ input/change 事件
//   3b. contenteditable：textContent 直接赋值 + InputEvent
import type { Config } from '../shared/config'
import type { BgResponse, TranslateResult } from '../shared/protocol'
import { ct } from './uiLang'
import { isTrustedInteraction } from '../shared/trustedEvents'

let config: Pick<Config, 'input'> | null = null
let lastKeyTime = 0
let spaceCount = 0
let keydownHandler: ((e: KeyboardEvent) => void) | null = null
const pendingInputs = new WeakMap<HTMLElement, object>()

export function setInputConfig(c: Pick<Config, 'input'>) {
  config = c
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

function isEditable(el: EventTarget | null): HTMLElement | null {
  if (!(el instanceof HTMLElement)) return null
  if (el instanceof HTMLTextAreaElement) return el
  if (el instanceof HTMLInputElement) {
    const t = el.type
    return ['text', 'search', 'url', 'email', ''].includes(t) ? el : null
  }
  if (el.isContentEditable || el.getAttribute('contenteditable') === 'true') return el
  return null
}

function getText(el: HTMLElement): string {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return el.value
  return el.textContent ?? ''
}

/** 富文本编辑器（X/Discord/Slack 等通常是 contenteditable 的 div/span） */
function isRichEditor(el: HTMLElement): boolean {
  return !(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)
}

/** 全选现有内容，让 paste / insertText 覆盖旧文本 */
function selectAll(el: HTMLElement) {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    el.select()
    return
  }
  let done = false
  try {
    done = document.execCommand('selectAll', false)
  } catch {
    done = false
  }
  if (!done) {
    try {
      const sel = window.getSelection()
      if (sel) {
        sel.removeAllRanges()
        const range = document.createRange()
        range.selectNodeContents(el)
        sel.addRange(range)
      }
    } catch {
      /* 选择失败不阻断后续策略 */
    }
  }
}

/** 验证写回结果：当前文本已包含译文（编辑器可能规范化空白，故用 includes） */
function checkSuccess(el: HTMLElement, newText: string): boolean {
  const target = newText.trim()
  if (!target) return getText(el) === newText
  return getText(el).includes(target)
}

function fireContentEditableInput(el: HTMLElement) {
  let evt: Event
  try {
    evt = new InputEvent('input', { bubbles: true })
  } catch {
    evt = new Event('input', { bubbles: true })
  }
  el.dispatchEvent(evt)
}

/**
 * 智能替换文本：三级降级，每层执行后验证，失败才降级。返回是否任一级成功写入译文。
 */
export async function smartReplaceText(el: HTMLElement, newText: string, canReplace: () => boolean = () => true): Promise<boolean> {
  if (!canReplace()) return false
  el.focus()
  await sleep(10)
  if (!canReplace()) return false
  selectAll(el)
  await sleep(50)
  if (!canReplace()) return false

  // 第 1 级：富文本编辑器优先走合成 paste 事件（多数富文本库监听 paste 并读取 clipboardData）
  if (isRichEditor(el)) {
    try {
      const dt = new DataTransfer()
      dt.setData('text/plain', newText)
      const pasteEvt = new ClipboardEvent('paste', {
        clipboardData: dt,
        bubbles: true,
        cancelable: true,
        composed: true,
      })
      el.dispatchEvent(pasteEvt)
      await sleep(100) // 给框架处理 paste 的时间
      if (checkSuccess(el, newText)) return true
    } catch {
      /* DataTransfer/ClipboardEvent 不可用或被拦截 → 降级 */
    }
  }

  // 第 2 级：execCommand('insertText')（浏览器原生插入，触发 beforeinput/input 完整管线）
  if (!canReplace()) return false
  try {
    if (document.execCommand('insertText', false, newText)) {
      await sleep(20)
      if (checkSuccess(el, newText)) return true
    }
  } catch {
    /* execCommand 不可用（如 jsdom）→ 降级 */
  }

  // 第 3 级：兜底直写
  if (!canReplace()) return false
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    // 原生原型链上的 value setter，绕开 React 等对实例 value 的重写
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
    if (setter) setter.call(el, newText)
    else el.value = newText
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  } else {
    el.textContent = newText
    fireContentEditableInput(el)
  }
  return checkSuccess(el, newText)
}

function offerTranslation(el: HTMLElement, translation: string) {
  showTip(el, ct('input.edited', '内容已变化，译文未自动替换。'), 30_000)
  const tip = document.querySelector('.tv-input-tip')
  if (!tip) return
  const preview = document.createElement('textarea')
  preview.readOnly = true
  preview.value = translation
  preview.rows = 3
  preview.setAttribute('aria-label', ct('input.translation', '待应用的译文'))
  const copy = document.createElement('button')
  copy.textContent = ct('sel.copy', '复制')
  copy.addEventListener('click', event => {
    if (event.isTrusted) void navigator.clipboard.writeText(translation).then(() => tip.remove()).catch(() => preview.select())
  })
  tip.append(preview, copy)
}

function showTip(el: HTMLElement, text: string, duration = 2200) {
  document.querySelectorAll('.tv-input-tip').forEach((n) => n.remove())
  const tip = document.createElement('div')
  tip.className = 'tv-input-tip'
  tip.setAttribute('data-tv-owned', '1')
  tip.textContent = text
  document.body.appendChild(tip)
  const rect = el.getBoundingClientRect()
  tip.style.top = `${rect.top - 34}px`
  tip.style.left = `${rect.left}px`
  setTimeout(() => tip.remove(), duration)
}

async function translateInput(el: HTMLElement, raw: string, targetLang: string) {
  const request = {}
  pendingInputs.set(el, request)
  const original = getText(el)
  let edited = false
  const onEdit = () => { edited = true }
  el.addEventListener('input', onEdit)
  const isLatest = () => pendingInputs.get(el) === request
  const canReplace = () => isLatest() && !edited && el.isConnected && getText(el) === original &&
    config?.input.enabled === true && document.activeElement === el
  let text = raw
  if (config?.input.trigger === 'tripleSpace') text = raw.replace(/[ =\-]{3}$/, '')
  showTip(el, ct('sel.translating', '翻译中…'))
  try {
    const resp = (await chrome.runtime.sendMessage({
      kind: 'translate', text, targetLang, sourceLang: 'auto',
    })) as BgResponse<TranslateResult>
    if (!isLatest() || !el.isConnected) return
    if (!resp.ok) throw new Error(resp.error)
    const ok = await smartReplaceText(el, resp.data.text, canReplace)
    if (!isLatest() || !el.isConnected) return
    if (!ok && !canReplace()) { offerTranslation(el, resp.data.text); return }
    showTip(el, ok ? ct('input.replaced', '已翻译并替换') : ct('input.replaceFailed', '替换失败，请手动粘贴'))
  } catch (err) {
    if (isLatest() && el.isConnected) showTip(el, ct('sel.translateFailed', '翻译失败：') + (err instanceof Error ? err.message : String(err)))
  } finally {
    el.removeEventListener('input', onEdit)
    if (isLatest()) pendingInputs.delete(el)
  }
}

export function initInput(c: Pick<Config, 'input'>) {
  config = c
  // 幂等：重复初始化先移除旧监听，避免重复触发
  if (keydownHandler) document.removeEventListener('keydown', keydownHandler)
  keydownHandler = (e: KeyboardEvent) => {
    if (!isTrustedInteraction(e) || !config?.input.enabled) return
    const el = isEditable(e.target)
    if (!el) return
    if (!document.activeElement?.contains(el) || !el.getClientRects().length) return
    const trigger = config.input.trigger

    if (trigger === 'altEnter') {
      if (e.altKey && (e.key === 'Enter' || e.code === 'Enter')) {
        e.preventDefault()
        const text = getText(el).trim()
        if (text) void translateInput(el, text, config.input.targetLang)
      }
      return
    }

    // tripleSpace / 三连等号/短横线
    if (e.key === ' ' || e.key === '=' || e.key === '-') {
      const now = Date.now()
      if (now - lastKeyTime < 1000) spaceCount += 1
      else spaceCount = 1
      lastKeyTime = now
      if (spaceCount >= 3) {
        e.preventDefault()
        spaceCount = 0
        const raw = getText(el)
        if (raw.trim()) void translateInput(el, raw, config.input.targetLang)
      }
    } else {
      spaceCount = 0
    }
  }
  document.addEventListener('keydown', keydownHandler)
}
