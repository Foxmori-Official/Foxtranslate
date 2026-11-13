// PageTranslator：整页双语翻译编排。
// IntersectionObserver 可见才译 + 并发队列 + MutationObserver 动态跟进 + 完全可逆开关。
import { findCandidates, extractText, buildTranslationHtml } from './dom'
import { injectTranslation, removeAllTranslations, showLoading, showError, clearStatus } from './render'
import { normalizeText, sameText, splitLongText } from '../core/text'
import type { PageConfig } from '../shared/pageConfig'
import type { BgResponse, TranslateResult } from '../shared/protocol'

const MAX_CONCURRENT = 4
const IO_ROOT_MARGIN = '400px 0px'
const LONG_TEXT_SPLIT = 1500
const MO_DEBOUNCE_MS = 120
const SCAN_ROOTS_PER_SLICE = 8
const CTX_DESC_MAX = 200
const CTX_BODY_MAX = 400
const CTX_TOTAL_MAX = 800

// 页面级上下文缓存：整页翻译期间所有段落共享同一份，不每段重取。
// undefined = 页面无可用上下文；null = 尚未提取。
let pageContextCache: string | undefined | null = null

/**
 * 全页摘要上下文（contextAware.enabled 时随 translate 消息发送，仅 AI 引擎使用）：
 * 标题 + meta description（截 200）+ 正文前 400 字符（空白归一化），总长截 800。
 * 页面无任何可用片段时返回 undefined。结果模块级缓存一次。
 */
export function getPageContext(): string | undefined {
  if (pageContextCache !== null) return pageContextCache
  const parts: string[] = []
  const title = document.title?.trim()
  if (title) parts.push(title)
  const desc = document
    .querySelector('meta[name="description"]')
    ?.getAttribute('content')
    ?.trim()
  if (desc) parts.push(desc.slice(0, CTX_DESC_MAX))
  // jsdom 无 innerText 实现，退 textContent（浏览器环境恒走 innerText）
  const bodyText = normalizeText(document.body?.innerText ?? document.body?.textContent ?? '')
  if (bodyText) parts.push(bodyText.slice(0, CTX_BODY_MAX))
  const joined = parts.join('\n').slice(0, CTX_TOTAL_MAX)
  pageContextCache = joined.length > 0 ? joined : undefined
  return pageContextCache
}

/** 清空页面上下文缓存（测试与 SPA 路由切换时用）。 */
export function resetPageContext(): void {
  pageContextCache = null
}

type TranslationSettings = Pick<PageConfig, 'general' | 'style' | 'contextAware'>

async function requestTranslate(text: string, config: TranslationSettings): Promise<TranslateResult> {
  const resp = (await chrome.runtime.sendMessage({
    kind: 'translate',
    text,
    targetLang: config.general.targetLang,
    sourceLang: config.general.sourceLang,
    // 仅开关开启时附带页面上下文；机器引擎在 background 侧忽略
    ...(config.contextAware.enabled ? { context: getPageContext() } : {}),
  })) as BgResponse<TranslateResult>
  if (!resp.ok) throw new Error(resp.error)
  return resp.data
}

/** 长文按句切分后顺序翻译拼接 */
async function translateLongText(text: string, config: TranslationSettings, signal?: AbortSignal): Promise<string> {
  if (text.length <= LONG_TEXT_SPLIT) {
    const r = await requestTranslate(text, config)
    return r.text
  }
  const parts = splitLongText(text, LONG_TEXT_SPLIT)
  const out: string[] = []
  for (const part of parts) {
    signal?.throwIfAborted()
    const r = await requestTranslate(part, config)
    out.push(r.text)
  }
  return out.join('\n')
}

/** 立即翻译单个元素（悬停翻译复用）。返回是否成功注入。 */
export async function translateElement(el: Element, config: TranslationSettings, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted || !el.isConnected) return false
  if (el.hasAttribute('data-tv-translated')) return true
  const extracted = extractText(el)
  if (!extracted) return false
  showLoading(el)
  try {
    const translated = await translateLongText(extracted.text, config, signal)
    if (signal?.aborted || !el.isConnected) return false
    clearStatus(el)
    if (sameText(translated, extracted.text)) {
      el.setAttribute('data-tv-translated', 'skipped')
      return true
    }
    injectTranslation(el, buildTranslationHtml(translated, extracted.placeholders), config)
    return true
  } catch (err) {
    if (signal?.aborted || !el.isConnected) return false
    showError(el, {
      message: err instanceof Error ? err.message : String(err),
      onRetry: () => void translateElement(el, config, signal),
    })
    return false
  }
}

export class PageTranslator {
  private getConfig: () => TranslationSettings
  private io: IntersectionObserver | null = null
  private mo: MutationObserver | null = null
  private pending = new Set<Element>()
  private observed = new Set<Element>()
  private working = new WeakMap<Element, AbortSignal>()
  private scanRoots = new Set<Element>()
  private running = 0
  private moTimer: ReturnType<typeof setTimeout> | null = null
  private scanIdle: number | null = null
  private session: AbortController | null = null
  translatedCount = 0
  failedCount = 0

  constructor(getConfig: () => TranslationSettings) {
    this.getConfig = getConfig
  }

  isActive(): boolean {
    return this.session !== null
  }

  counts(): { translatedCount: number; failedCount: number } {
    return { translatedCount: this.translatedCount, failedCount: this.failedCount }
  }

  /** 切换整页翻译状态，返回切换后状态 */
  async toggle(): Promise<boolean> {
    if (this.session) {
      this.deactivate()
      return false
    }
    this.activate()
    return true
  }

  private activate() {
    this.session = new AbortController()
    this.translatedCount = 0
    this.failedCount = 0
    resetPageContext()
    this.io = new IntersectionObserver(
      (entries, observer) => {
        if (observer !== this.io) return
        for (const entry of entries) {
          const el = entry.target
          if (!el.isConnected) this.unobserve(el)
          else if (entry.isIntersecting) this.pending.add(el)
          else this.pending.delete(el)
        }
        this.drain()
      },
      { rootMargin: IO_ROOT_MARGIN, threshold: 0 },
    )
    this.scan(document.body)
    this.mo = new MutationObserver((records) => this.onMutations(records))
    this.mo.observe(document.body, { childList: true, subtree: true, characterData: true })
  }

  private deactivate() {
    this.session?.abort()
    this.session = null
    this.io?.disconnect()
    this.io = null
    this.mo?.disconnect()
    this.mo = null
    if (this.moTimer) clearTimeout(this.moTimer)
    this.moTimer = null
    if (this.scanIdle !== null) window.cancelIdleCallback(this.scanIdle)
    this.scanIdle = null
    this.scanRoots.clear()
    this.observed.clear()
    this.pending.clear()
    removeAllTranslations()
  }

  /** 扫描根节点下的候选并交给 IO/队列 */
  scan(root: ParentNode) {
    if (!this.session || !this.io) return
    const config = this.getConfig()
    const candidates = findCandidates(root, config.general.targetLang)
    for (const el of candidates) {
      if (this.observed.has(el) || this.working.get(el) === this.session.signal) continue
      this.observed.add(el)
      this.io.observe(el)
    }
  }

  private queueMutationRoot(el: Element) {
    if (!el.isConnected) return
    // A streamed inline edit must rescan its paragraph, not only the text's immediate span.
    const root = el.closest('p,li,blockquote,td,th,dd,dt,figcaption,summary,h1,h2,h3,h4,h5,h6') ?? el
    this.scanRoots.add(root)
  }

  private onMutations(records: MutationRecord[]) {
    let removed = false
    for (const r of records) {
      const target = r.target
      if (target instanceof Element && target.closest('[data-tv-owned], tv-translation')) continue
      if (r.type === 'characterData') {
        const parent = target.parentElement
        if (parent && !parent.closest('[data-tv-owned], tv-translation')) this.queueMutationRoot(parent)
        continue
      }
      for (const node of Array.from(r.addedNodes)) {
        if (node instanceof Element) {
          if (node.hasAttribute('data-tv-owned') || node.tagName === 'TV-TRANSLATION') continue
          this.queueMutationRoot(node)
        } else if (node.nodeType === Node.TEXT_NODE && target instanceof Element) {
          this.queueMutationRoot(target)
        }
      }
      removed ||= Array.from(r.removedNodes).some(node => node instanceof Element && !node.hasAttribute('data-tv-owned'))
    }
    if (removed) for (const el of this.observed) if (!el.isConnected) this.unobserve(el)
    if (!this.scanRoots.size || this.moTimer || this.scanIdle !== null) return
    this.moTimer = setTimeout(() => {
      this.moTimer = null
      this.scheduleScan()
    }, MO_DEBOUNCE_MS)
  }

  private scheduleScan() {
    this.scanIdle = window.requestIdleCallback(deadline => {
      this.scanIdle = null
      if (!this.session) return
      // Ignore descendants covered by a queued parent, including updates from earlier observer callbacks.
      for (const el of this.scanRoots) {
        for (let parent = el.parentElement; parent; parent = parent.parentElement) {
          if (this.scanRoots.has(parent)) { this.scanRoots.delete(el); break }
        }
      }
      let scanned = 0
      for (const el of this.scanRoots) {
        this.scanRoots.delete(el)
        if (el.isConnected) this.scan(el)
        if (++scanned >= SCAN_ROOTS_PER_SLICE || deadline.timeRemaining() < 2) break
      }
      if (this.scanRoots.size) this.scheduleScan()
    }, { timeout: 250 })
  }

  private unobserve(el: Element) {
    this.pending.delete(el)
    this.observed.delete(el)
    this.io?.unobserve(el)
  }

  private drain() {
    while (this.session && this.running < MAX_CONCURRENT && this.pending.size) {
      const el = this.pending.values().next().value as Element
      this.unobserve(el)
      if (!el.isConnected || el.hasAttribute('data-tv-translated')) continue
      void this.process(el, this.session.signal)
    }
  }

  private async process(el: Element, signal: AbortSignal) {
    this.running += 1
    this.working.set(el, signal)
    try {
      const ok = await translateElement(el, this.getConfig(), signal)
      if (signal.aborted) return
      if (ok) this.translatedCount += 1
      else this.failedCount += 1
    } finally {
      if (this.working.get(el) === signal) this.working.delete(el)
      this.running -= 1
      this.drain()
    }
  }
}
