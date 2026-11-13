// PageTranslator：整页双语翻译编排。
// IntersectionObserver 可见才译 + 并发队列 + MutationObserver 动态跟进 + 完全可逆开关。
import { discoverCandidates, coveredByParent, isValidUnit, extractText, buildTranslationHtml } from './dom'
import { injectTranslation, removeTranslation, removeAllTranslations, showLoading, showError, clearStatus } from './render'
import { normalizeText, sameText } from '../core/text'
import type { PageConfig } from '../shared/pageConfig'
import type { BgResponse, TranslateResult } from '../shared/protocol'

const MAX_CONCURRENT = 4
const IO_ROOT_MARGIN = '400px 0px'
const MO_DEBOUNCE_MS = 120
const SCAN_BUDGET_MS = 6
const SCAN_UNITS_PER_SLICE = 128
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

const unitSources = new WeakMap<Element, string>()
const unitRequests = new WeakMap<Element, object>()

function sourceText(el: Element): string {
  const backup = el.querySelector(':scope > tv-translation > template.tv-backup')
  if (backup && !Array.from(el.childNodes).some(node => node.nodeType === Node.TEXT_NODE ? !!node.textContent?.trim() : node instanceof Element && !node.hasAttribute('data-tv-owned'))) {
    return unitSources.get(el) ?? ''
  }
  return extractText(el)?.text ?? ''
}

type TranslationSettings = Pick<PageConfig, 'general' | 'style' | 'contextAware'>

async function requestTranslate(text: string, config: TranslationSettings, signal?: AbortSignal): Promise<TranslateResult> {
  signal?.throwIfAborted()
  const requestId = crypto.randomUUID()
  const cancel = () => { void chrome.runtime.sendMessage({ kind: 'cancelTranslation', requestId }).catch(() => {}) }
  signal?.addEventListener('abort', cancel, { once: true })
  try {
    const resp = (await chrome.runtime.sendMessage({
    kind: 'translate',
    text,
    targetLang: config.general.targetLang,
    sourceLang: config.general.sourceLang,
    scope: 'page',
    requestId,
    // 仅开关开启时附带页面上下文；机器引擎在 background 侧忽略
    ...(config.contextAware.enabled ? { context: getPageContext() } : {}),
  })) as BgResponse<TranslateResult>
    if (!resp.ok) throw new Error(resp.error)
    return resp.data
  } finally { signal?.removeEventListener('abort', cancel) }
}

/** The worker masks the complete paragraph before splitting it. */
async function translateLongText(text: string, config: TranslationSettings, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted()
  return (await requestTranslate(text, config, signal)).text
}

/** 立即翻译单个元素（悬停翻译复用）。返回是否成功注入。 */
export async function translateElement(el: Element, config: TranslationSettings, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted || !el.isConnected) return false
  if (el.hasAttribute('data-tv-translated')) return true
  const extracted = extractText(el)
  if (!extracted) return false
  const request = {}
  unitRequests.set(el, request)
  unitSources.set(el, extracted.text)
  const current = () => !signal?.aborted && el.isConnected && unitRequests.get(el) === request && sourceText(el) === extracted.text
  showLoading(el)
  try {
    const translated = await translateLongText(extracted.text, config, signal)
    if (!current()) return false
    clearStatus(el)
    if (sameText(translated, extracted.text)) {
      el.setAttribute('data-tv-translated', 'skipped')
      return true
    }
    injectTranslation(el, buildTranslationHtml(translated, extracted.placeholders), config)
    return true
  } catch (err) {
    if (!current()) return false
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
  private working = new WeakMap<Element, AbortController>()
  private scanRoots = new Set<Element>()
  private scans: Generator<Element | null>[] = []
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
    this.scans = []
    this.observed.clear()
    this.pending.clear()
    removeAllTranslations()
  }

  /** Queue discovery without traversing or extracting the entire page synchronously. */
  scan(root: ParentNode) {
    if (!this.session || !(root instanceof Element)) return
    this.scanRoots.add(root)
    this.scheduleScan()
  }

  private invalidateChangedUnit(el: Element) {
    const previous = unitSources.get(el)
    if (previous === undefined || sourceText(el) === previous) return
    unitRequests.delete(el)
    unitSources.delete(el)
    this.working.get(el)?.abort()
    const wrapper = el.querySelector(':scope > tv-translation')
    // A framework's new content must not be mixed with the saved translation-only source.
    if (wrapper?.querySelector('template.tv-backup')) wrapper.remove()
    else removeTranslation(el)
    el.removeAttribute('data-tv-translated')
    clearStatus(el)
    this.unobserve(el)
  }

  private queueMutationRoot(el: Element) {
    if (!el.isConnected) return
    const root = el.closest('p,li,blockquote,td,th,dd,dt,figcaption,summary,h1,h2,h3,h4,h5,h6') ?? el
    this.invalidateChangedUnit(root)
    this.scanRoots.add(root)
  }

  private onMutations(records: MutationRecord[]) {
    let removed = false
    for (const record of records) {
      const target = record.target
      const parent = target instanceof Element ? target : target.parentElement
      if (!parent || parent.closest('[data-tv-owned], tv-translation')) continue
      if (record.type === 'characterData') { this.queueMutationRoot(parent); continue }
      let sourceChanged = false
      for (const node of Array.from(record.addedNodes)) {
        if (node instanceof Element) {
          if (node.hasAttribute('data-tv-owned') || node.tagName === 'TV-TRANSLATION') continue
          this.queueMutationRoot(node)
          sourceChanged = true
        } else if (node.nodeType === Node.TEXT_NODE) sourceChanged = true
      }
      if (Array.from(record.removedNodes).some(node => node instanceof Element ? !node.hasAttribute('data-tv-owned') : node.nodeType === Node.TEXT_NODE)) {
        removed = true
        sourceChanged = true
      }
      if (sourceChanged) this.queueMutationRoot(parent)
    }
    if (removed) for (const el of this.observed) if (!el.isConnected) this.unobserve(el)
    if (!this.scanRoots.size || this.moTimer || this.scanIdle !== null) return
    this.moTimer = setTimeout(() => { this.moTimer = null; this.scheduleScan() }, MO_DEBOUNCE_MS)
  }

  private scheduleScan() {
    if (this.scanIdle !== null || !this.session) return
    this.scanIdle = window.requestIdleCallback(deadline => {
      this.scanIdle = null
      if (!this.session || !this.io) return
      const started = performance.now()
      let visited = 0
      while (visited++ < SCAN_UNITS_PER_SLICE) {
        if (!this.scans.length) {
          const root = this.scanRoots.values().next().value
          if (!root) break
          this.scanRoots.delete(root)
          if (!root.isConnected) continue
          let covered = false
          for (let parent = root.parentElement; parent; parent = parent.parentElement) {
            if (this.scanRoots.has(parent)) { covered = true; break }
          }
          if (covered) continue
          this.scans.push(discoverCandidates(root))
        }
        const next = this.scans[0].next()
        if (next.done) this.scans.shift()
        else if (next.value) {
          const el = next.value
          const work = this.working.get(el)
          if (el.isConnected && !el.hasAttribute('data-tv-translated') && !this.observed.has(el) && (!work || work.signal.aborted)) {
            this.observed.add(el)
            this.io.observe(el)
          }
        }
        if (performance.now() - started >= SCAN_BUDGET_MS || deadline.timeRemaining() < 1) break
      }
      if (this.scans.length || this.scanRoots.size) this.scheduleScan()
    }, { timeout: 100 })
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
      const language = this.getConfig().general.targetLang
      if (coveredByParent(el, language)) continue
      const valid = isValidUnit(el, language)
      if (valid !== 'ok') {
        if (valid === 'done') { unitSources.set(el, sourceText(el)); el.setAttribute('data-tv-translated', 'skipped') }
        continue
      }
      void this.process(el, this.session.signal)
    }
  }

  private async process(el: Element, signal: AbortSignal) {
    this.running += 1
    const controller = new AbortController()
    const abort = () => controller.abort()
    signal.addEventListener('abort', abort, { once: true })
    this.working.set(el, controller)
    try {
      const ok = await translateElement(el, this.getConfig(), controller.signal)
      if (controller.signal.aborted) return
      if (ok) this.translatedCount += 1
      else this.failedCount += 1
    } finally {
      signal.removeEventListener('abort', abort)
      if (this.working.get(el) === controller) this.working.delete(el)
      this.running -= 1
      this.drain()
    }
  }
}
