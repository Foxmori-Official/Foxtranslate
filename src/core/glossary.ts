/**
 * Foxtranslate core — 术语表占位符注入/还原 + LLM glossary prompt 块。
 *
 * 翻译前把原文中的术语替换成 __GLOSSARY_N__ 占位符（LLM 被告知按术语表保持一致），
 * 译文返回后把占位符还原为目标术语（dst）。占位符文本即 key，还原不依赖位置映射。
 *
 * 匹配规则：
 * - src 长度降序（先长后短），重叠时长术语抢占区间，短术语只补长术语没覆盖的；
 * - 有词界的文字保护字母、数字和下划线；中日韩文字允许连续匹配（如 Transformer架构）；
 * - 大小写不敏感（"Server" 命中 "server"）；
 * - 编译后一次扫描原文，按命中区间生成占位符。
 *
 * 本模块为 core 纯逻辑：零浏览器 API、零外部依赖。
 */

import { restorePlaceholders } from './placeholders'

export interface GlossaryTerm {
  src: string
  dst: string
}

export interface GlossaryEntity {
  /** 按原文出现顺序从 1 递增 */
  serial: number
  /** 目标术语（dst），还原时写回译文 */
  value: string
}

export interface ApplyGlossaryResult {
  text: string
  entities: GlossaryEntity[]
}

const CJK = /[\p{Script_Extensions=Han}\p{Script_Extensions=Hiragana}\p{Script_Extensions=Katakana}\p{Script_Extensions=Hangul}]/u
const WORD = /[\p{L}\p{M}\p{N}_]/u

function needsBoundary(char: string | undefined): boolean {
  return !!char && WORD.test(char) && !CJK.test(char)
}

// Fold one code point at a time, so casing cannot change the original match positions.
function fold(char: string): string {
  if (char.charCodeAt(0) <= 127) return char.toLowerCase()
  if (char === 'ı' || char === 'İ') return char
  const upper = char.toUpperCase()
  return upper.length === char.length ? upper.toLowerCase() : char.toLowerCase()
}

function placeholderFor(serial: number): string {
  return `__GLOSSARY_${serial}__`
}

interface Span {
  start: number
  end: number
  term: Term
}

interface Term {
  width: number
  rank: number
  left: boolean
  right: boolean
  dst: string
}

interface Node {
  children: Map<string, Node>
  fail: Node | null
  output?: Node
  term?: Term
}

export interface CompiledGlossary {
  readonly signature: string
  apply(text: string): ApplyGlossaryResult
}

const compiled = new Map<string, CompiledGlossary>()
const MAX_COMPILED_TABLES = 4

/** Aho–Corasick trie. Suffix links reuse matches without copying every suffix into each node. */
export function compileGlossary(terms: readonly GlossaryTerm[]): CompiledGlossary {
  const signature = glossarySignature(terms)
  const previous = compiled.get(signature)
  if (previous) {
    compiled.delete(signature)
    compiled.set(signature, previous)
    return previous
  }
  const root: Node = { children: new Map(), fail: null }
  for (const [rank, { src, dst }] of terms.entries()) {
    if (!src) continue
    const chars = Array.from(src)
    let node = root
    for (const char of chars) {
      const key = fold(char)
      let child = node.children.get(key)
      if (!child) {
        child = { children: new Map(), fail: null }
        node.children.set(key, child)
      }
      node = child
    }
    node.term ??= { width: chars.length, rank, left: needsBoundary(chars[0]), right: needsBoundary(chars.at(-1)), dst }
  }
  const queue = [...root.children.values()]
  for (const node of queue) node.fail = root
  for (let i = 0; i < queue.length; i++) {
    const parent = queue[i]
    for (const [char, child] of parent.children) {
      let fallback = parent.fail
      while (fallback && !fallback.children.has(char)) fallback = fallback.fail
      child.fail = fallback?.children.get(char) ?? root
      child.output = child.fail.term ? child.fail : child.fail.output
      queue.push(child)
    }
  }

  const matcher = { signature, apply: (text: string) => applyCompiled(text, root) }
  compiled.set(signature, matcher)
  if (compiled.size > MAX_COMPILED_TABLES) compiled.delete(compiled.keys().next().value!)
  return matcher
}

function applyCompiled(text: string, root: Node): ApplyGlossaryResult {
  if (!text || !root.children.size) return { text, entities: [] }
  const chars = Array.from(text)
  const spans: Span[] = []
  let node = root
  for (let i = 0; i < chars.length; i++) {
    const key = fold(chars[i])
    while (node !== root && !node.children.has(key)) node = node.fail ?? root
    node = node.children.get(key) ?? root
    for (let match: Node | undefined = node.term ? node : node.output; match; match = match.output) {
      const term = match.term!
      const end = i + 1
      const start = end - term.width
      if ((term.left && needsBoundary(chars[start - 1])) || (term.right && needsBoundary(chars[end]))) continue
      spans.push({ start, end, term })
    }
  }
  if (!spans.length) return { text, entities: [] }

  // Resolve overlaps by length globally, including a longer term starting later in the source.
  spans.sort((a, b) => b.term.width - a.term.width || a.term.rank - b.term.rank || a.start - b.start)
  const occupied = new Uint8Array(chars.length)
  const chosen: Span[] = []
  for (const span of spans) {
    if (occupied.subarray(span.start, span.end).includes(1)) continue
    occupied.fill(1, span.start, span.end)
    chosen.push(span)
  }
  chosen.sort((a, b) => a.start - b.start)
  const entities = chosen.map(({ term }, i) => ({ serial: i + 1, value: term.dst }))
  const parts: string[] = []
  let cursor = 0
  for (const [i, { start, end }] of chosen.entries()) {
    parts.push(chars.slice(cursor, start).join(''), placeholderFor(i + 1))
    cursor = end
  }
  parts.push(chars.slice(cursor).join(''))
  return { text: parts.join(''), entities }
}

export function applyGlossary(text: string, terms: GlossaryTerm[]): ApplyGlossaryResult {
  return text && terms.length ? compileGlossary(terms).apply(text) : { text, entities: [] }
}

/**
 * 还原。占位符文本即 key（不依赖位置映射）。容忍引擎对占位符的常见改写：
 * 大小写变化、下划线旁插空格、尾部下划线丢失。
 * 找不到的占位符跳过（该实体在译文中缺失，只影响完整性不泄露信息）。
 */
export function restoreGlossary(text: string, entities: GlossaryEntity[]): string {
  return restorePlaceholders(text, [], entities)
}

/**
 * 生成注入 system prompt 的 glossary 块；terms 为空时返回空串，调用方自行跳过。
 * 每行 `- src → dst`。
 */
export function glossaryPromptBlock(terms: GlossaryTerm[]): string {
  if (terms.length === 0) return ''
  return terms.map((t) => `- ${t.src} → ${t.dst}`).join('\n')
}

/** Preserve term order and encode values unambiguously, including literal '=' and ';'. */
export function glossarySignature(terms: readonly GlossaryTerm[]): string {
  return terms.length ? JSON.stringify(terms.map(({ src, dst }) => [src, dst])) : ''
}
