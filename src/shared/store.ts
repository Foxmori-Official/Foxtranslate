import { createEmptyCard, type Card } from 'ts-fsrs'
import { DEFAULT_CONFIG, normalizeConfig, type Config } from './config'
import type { WordItem } from './protocol'
import { genId } from './ids'

const KEY_CONFIG = 'tv:config_v1'
const KEY_WORDS = 'tv:words_v1'
const KEY_STATS = 'tv:stats_v1'
let writes: Promise<unknown> = Promise.resolve()
function mutate<T>(operation: () => Promise<T>): Promise<T> {
  const result = writes.then(operation, operation)
  writes = result.catch(() => undefined)
  return result
}

function storageGet<T>(key: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(key, result => {
      const error = chrome.runtime?.lastError
      if (error) reject(new Error(error.message))
      else resolve(result[key] as T | undefined)
    })
  })
}

function storageSet(obj: Record<string, unknown>): Promise<void> {
  return new Promise((resolve, reject) => chrome.storage.local.set(obj, () => {
    const error = chrome.runtime?.lastError
    if (error) reject(new Error(error.message))
    else resolve()
  }))
}

// ===== config =====

async function readConfig(): Promise<Config> {
  const raw = await storageGet<unknown>(KEY_CONFIG)
  return normalizeConfig(raw ?? DEFAULT_CONFIG)
}

export async function getConfig(): Promise<Config> {
  const config = await readConfig()
  return { ...config, stats: { translatedChars: await getTranslatedChars(config.stats.translatedChars) } }
}

export function setConfig(patch: Partial<Config>): Promise<Config> {
  return updateConfig(() => patch)
}

export function updateConfig(patch: (current: Config) => Partial<Config>): Promise<Config> {
  return mutate(async () => {
    const current = await getConfig()
    const next = normalizeConfig({ ...current, ...patch(current), version: 1 })
    await storageSet({ [KEY_CONFIG]: next })
    return next
  })
}

let statistics: Promise<{ translatedChars: number }> | undefined
let statsTimer: ReturnType<typeof setTimeout> | undefined
let statsDirty = false

function loadStatistics(legacy?: number): Promise<{ translatedChars: number }> {
  if (!statistics) {
    statistics = (async () => {
      const stored = await storageGet<{ translatedChars?: number }>(KEY_STATS)
      const value = stored?.translatedChars ?? legacy ?? (await readConfig()).stats.translatedChars
      return { translatedChars: Number.isFinite(value) && value >= 0 ? value : 0 }
    })().catch(error => { statistics = undefined; throw error })
  }
  return statistics
}

export async function getTranslatedChars(legacy?: number): Promise<number> {
  return (await loadStatistics(legacy)).translatedChars
}

function scheduleStatsFlush() {
  if (statsTimer) return
  statsTimer = setTimeout(() => {
    statsTimer = undefined
    void flushTranslationStats().catch(() => scheduleStatsFlush())
  }, 2000)
}

/** Aggregate a noncritical counter independently of configuration and page broadcasts. */
export async function incrementTranslatedChars(count: number): Promise<void> {
  if (!Number.isFinite(count) || count <= 0) return
  const stats = await loadStatistics()
  stats.translatedChars += count
  statsDirty = true
  scheduleStatsFlush()
}

export function flushTranslationStats(): Promise<void> {
  if (statsTimer) clearTimeout(statsTimer)
  statsTimer = undefined
  return mutate(async () => {
    if (!statsDirty) return
    const stats = await loadStatistics()
    statsDirty = false
    try { await storageSet({ [KEY_STATS]: { translatedChars: stats.translatedChars } }) }
    catch (error) { statsDirty = true; throw error }
  })
}

/** 监听配置变化（popup/options 修改后 content 热同步） */
export function watchConfig(cb: (config: Config) => void): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[KEY_CONFIG]) {
      cb(normalizeConfig(changes[KEY_CONFIG].newValue))
    }
  })
}

// ===== wordbook =====

export async function getWords(): Promise<WordItem[]> {
  return (await storageGet<WordItem[]>(KEY_WORDS)) ?? []
}

async function saveWords(words: WordItem[]): Promise<void> {
  await storageSet({ [KEY_WORDS]: words })
}

export function toWordCard(card: Card): WordItem['card'] {
  return {
    due: card.due.getTime(),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsed_days,
    scheduled_days: card.scheduled_days,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    learning_steps: card.learning_steps,
    last_review: card.last_review?.getTime(),
  }
}

export function toFsrsCard(c: WordItem['card']): Card {
  return {
    due: new Date(c.due),
    stability: c.stability,
    difficulty: c.difficulty,
    elapsed_days: c.elapsed_days,
    scheduled_days: c.scheduled_days,
    reps: c.reps,
    lapses: c.lapses,
    state: c.state as Card['state'],
    learning_steps: c.learning_steps ?? 0,
    last_review: c.last_review ? new Date(c.last_review) : undefined,
  }
}

export function addWord(input: {
  word: string
  context?: string
  translation?: string
  sourceLang?: string
  targetLang?: string
  note?: string
  pageUrl?: string
  pageTitle?: string
}): Promise<WordItem> {
  return mutate(async () => {
  const words = await getWords()
  const existing = words.find((w) => w.word.toLowerCase() === input.word.toLowerCase())
  if (existing) {
    existing.seenCount += 1
    if (input.context && !existing.context) existing.context = input.context
    if (input.translation && !existing.translation) existing.translation = input.translation
    if (input.pageUrl && !existing.pageUrl) existing.pageUrl = input.pageUrl
    if (input.pageTitle && !existing.pageTitle) existing.pageTitle = input.pageTitle
    await saveWords(words)
    return existing
  }
  const item: WordItem = {
    id: genId(),
    word: input.word,
    context: input.context,
    translation: input.translation,
    sourceLang: input.sourceLang,
    targetLang: input.targetLang,
    note: input.note,
    pageUrl: input.pageUrl,
    pageTitle: input.pageTitle,
    createdAt: Date.now(),
    seenCount: 1,
    card: toWordCard(createEmptyCard()),
  }
  words.push(item)
  await saveWords(words)
  return item
  })
}

export function deleteWord(id: string): Promise<void> {
  return mutate(async () => {
    const words = await getWords()
    await saveWords(words.filter(w => w.id !== id))
  })
}

export function updateWord(id: string, updater: (w: WordItem) => WordItem): Promise<void> {
  return mutate(async () => {
  const words = await getWords()
  const idx = words.findIndex((w) => w.id === id)
  if (idx >= 0) {
    words[idx] = updater(words[idx])
    await saveWords(words)
  }
  })
}
