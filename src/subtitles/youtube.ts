import { DEFAULT_CONFIG, normalizeConfig, type SubtitlePatch, type SubtitlePreferences } from '../shared/config'
import { matchHotkey } from '../shared/hotkeys'
import { featureCopy } from '../shared/featureCopy'
import { isAiProvider } from '../shared/engines'
import { downloadSubtitles } from './subtitleDownload'
import type { BgResponse } from '../shared/protocol'
import { PlayerControl, type PlayerState } from './playerControl'
// YouTube 双语字幕主编排：配置开关 → SPA 导航 → 获取 → 前瞻翻译调度 → 渲染
import { getSubtitlesConfig, translateText, type SubtitleCue } from './types'
import { fetchYouTubeCues } from './ytFetch'
import { YouTubeRenderer } from './ytRender'

const LOOK_AHEAD_MS = 30_000 // 前瞻窗口（× playbackRate）
const BATCH_MAX = 8
const FAILED_RETRY_MS = 5_000
const SEEK_SETTLE_MS = 500
const NAV_POLL_MS = 1000
const PLAYER_WAIT_MS = 10_000

interface Session {
  id: number
  videoId: string
  cues: SubtitleCue[]
  translatedStarts: Set<number> // key: Math.round(start*1000)
  translatingStarts: Set<number>
  failedAt: Map<number, number> // startMs → 失败时间戳（冷却后可重试）
  renderer: YouTubeRenderer | null
  video: HTMLVideoElement | null
  seekSettleTimer: number | null
  seeking: boolean
  disposed: boolean
}

let booted = false
let enabled = false
let targetLang = 'zh-CN'
let cueConcurrency = 3
let sessionSeq = 0
let session: Session | null = null
let navPollTimer: number | null = null
let uiLang = 'auto'
let playerState: PlayerState = 'off'
let preferences = DEFAULT_CONFIG.subtitles
let hotkey = DEFAULT_CONFIG.hotkeys.toggleSubtitles
let videoOverride: { id: string; enabled: boolean } | null = null
let activeVideoId: string | null = null
let navigationRevision = 0

const control = new PlayerControl({
  save: savePreferences,
  toggleForVideo: () => setVideoOverride(!enabled),
  stopForVideo: () => setVideoOverride(false),
  preview: next => session?.renderer?.setPreferences(next),
  openSettings: async () => {
    const result = await chrome.runtime.sendMessage({ kind: 'command', cmd: 'openVideoOptions' }) as BgResponse
    if (!result?.ok) throw new Error(result?.error || 'Could not open settings')
  },
  download: async (mode, progress) => {
    const videoId = currentVideoId()
    const revision = navigationRevision
    const language = targetLang
    const translationAbove = preferences.translationPosition === 'above'
    if (!videoId) throw new Error(featureCopy('noTrack', uiLang))
    const cues = session?.videoId === videoId && session.cues.length ? session.cues : await fetchYouTubeCues(videoId)
    await downloadSubtitles({
      cues: cues ?? [], videoId, targetLang: language, uiLang, mode, translationAbove, progress,
      isCurrent: () => revision === navigationRevision && currentVideoId() === videoId && targetLang === language,
    })
  },
})

function updateControl(state: PlayerState): void {
  playerState = state
  control.update({ enabled, state, lang: uiLang, preferences, hotkey })
}

function mountControl(): void {
  const player = document.querySelector<HTMLElement>('#movie_player')
  if (currentVideoId() && player && preferences.showShortcut) control.mount(player)
  else control.destroy()
}

function setVideoOverride(value: boolean): void {
  const id = currentVideoId()
  if (!id) return
  videoOverride = { id, enabled: value }
  onNavigate()
}

function applyPreferences(next: SubtitlePreferences): void {
  if (preferences.enabled !== next.enabled || preferences.youtube !== next.youtube) videoOverride = null
  preferences = next
  session?.renderer?.setPreferences(preferences)
  onNavigate()
}

async function savePreferences(patch: SubtitlePatch): Promise<void> {
  const result = await chrome.runtime.sendMessage({ kind: 'setSubtitlePreferences', patch }) as BgResponse<SubtitlePreferences>
  if (!result?.ok) throw new Error(result?.error || 'Save failed')
  if (patch.youtube !== undefined || patch.enabled !== undefined) videoOverride = null
  applyPreferences(result.data)
}

function applyConfiguration(raw: unknown): void {
  const config = normalizeConfig(raw)
  if (config.general.targetLang !== targetLang) {
    targetLang = config.general.targetLang
    teardownSession()
  }
  uiLang = config.uiLang
  cueConcurrency = config.batch.enabled && isAiProvider(config.engine.provider) ? BATCH_MAX : 3
  hotkey = config.hotkeys.toggleSubtitles
  applyPreferences(config.subtitles)
}

export function startYouTube(): void {
  if (booted) return
  booted = true
  void bootstrap()
}

async function bootstrap(): Promise<void> {
  const config = await getSubtitlesConfig()
  if (config) applyConfiguration(config)
  else updateControl('error')
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes['tv:config_v1']) applyConfiguration(changes['tv:config_v1'].newValue)
  })
  window.addEventListener('yt-navigate-finish', onNavigate)
  document.addEventListener('yt-navigate-start', onNavigateStart)
  document.addEventListener('keydown', event => {
    if (event.defaultPrevented || event.repeat || event.isComposing || !currentVideoId()) return
    if (event.target instanceof Element && event.target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"])')) return
    if (!matchHotkey(event, hotkey)) return
    event.preventDefault()
    setVideoOverride(!enabled)
  })
  navPollTimer = window.setInterval(onNavigate, NAV_POLL_MS)
  window.addEventListener('pagehide', () => {
    navigationRevision++
    teardownSession()
    control.destroy()
    if (navPollTimer !== null) window.clearInterval(navPollTimer)
    navPollTimer = null
  })
  window.addEventListener('pageshow', event => {
    if (!event.persisted) return
    if (navPollTimer === null) navPollTimer = window.setInterval(onNavigate, NAV_POLL_MS)
    onNavigate()
  })
}

function currentVideoId(): string | null {
  if (location.pathname !== '/watch') return null
  return new URLSearchParams(location.search).get('v')
}

function onNavigateStart(): void {
  navigationRevision++
  teardownSession()
  control.resetForVideo()
}

function onNavigate(): void {
  const videoId = currentVideoId()
  if (videoId !== activeVideoId) {
    activeVideoId = videoId
    navigationRevision++
    if (videoOverride?.id !== videoId) videoOverride = null
    teardownSession()
    control.resetForVideo()
  }
  enabled = Boolean(videoId && (videoOverride?.enabled ?? (preferences.enabled && preferences.youtube)))
  mountControl()
  if (!enabled || !videoId) {
    teardownSession()
    updateControl('off')
    return
  }
  if (session?.video && !session.video.isConnected) teardownSession()
  if (session && session.videoId === videoId && !session.disposed) {
    updateControl(playerState)
    return
  }
  teardownSession()
  const s: Session = {
    id: ++sessionSeq,
    videoId,
    cues: [],
    translatedStarts: new Set(),
    translatingStarts: new Set(),
    failedAt: new Map(),
    renderer: null,
    video: null,
    seekSettleTimer: null,
    seeking: false,
    disposed: false,
  }
  session = s
  updateControl('loading')
  void loadSession(s).catch(() => {
    if (!s.disposed && session === s) updateControl('error')
  })
}

function teardownSession(): void {
  if (!session) return
  session.disposed = true
  sessionSeq++ // 使在途异步回调失效
  if (session.seekSettleTimer !== null) window.clearTimeout(session.seekSettleTimer)
  detachVideoListeners(session)
  session.renderer?.destroy()
  session = null
}

// ===== 会话加载：找播放器 → 拉字幕 → 渲染 + 调度 =====

async function loadSession(s: Session): Promise<void> {
  const found = await waitForPlayer(s)
  if (!found) {
    if (!s.disposed && session === s) updateControl('error')
    return
  }
  if (s.disposed || session?.id !== s.id) return
  const [player, video] = found
  s.video = video

  const cues = await fetchYouTubeCues(s.videoId)
  if (s.disposed || session?.id !== s.id) return
  if (!cues || cues.length === 0) {
    updateControl('empty')
    return
  }

  s.cues = cues
  const renderer = new YouTubeRenderer()
  renderer.mount(player, video)
  renderer.setPreferences(preferences)
  renderer.setCues(cues)
  s.renderer = renderer
  updateControl('ready')
  attachVideoListeners(s)
  translationTick(s)
}

function waitForPlayer(
  s: Session,
): Promise<[HTMLElement, HTMLVideoElement] | null> {
  return new Promise((resolve) => {
    const deadline = Date.now() + PLAYER_WAIT_MS
    const probe = (): void => {
      if (s.disposed || session?.id !== s.id) {
        resolve(null)
        return
      }
      const player = document.querySelector<HTMLElement>('#movie_player')
      const video = player?.querySelector<HTMLVideoElement>('video.html5-main-video') ??
        player?.querySelector<HTMLVideoElement>('video') ??
        null
      if (player && video) {
        resolve([player, video])
        return
      }
      if (Date.now() > deadline) {
        resolve(null)
        return
      }
      window.setTimeout(probe, 500)
    }
    probe()
  })
}

// ===== 视频事件：timeupdate 驱动翻译调度；seek 暂停/恢复 =====

function attachVideoListeners(s: Session): void {
  const video = s.video
  if (!video) return
  const h = handlersFor(s)
  video.addEventListener('timeupdate', h.onTimeUpdate)
  video.addEventListener('seeking', h.onSeeking)
  video.addEventListener('seeked', h.onSeeked)
}

function detachVideoListeners(s: Session): void {
  const video = s.video
  if (!video) return
  const h = handlersFor(s)
  video.removeEventListener('timeupdate', h.onTimeUpdate)
  video.removeEventListener('seeking', h.onSeeking)
  video.removeEventListener('seeked', h.onSeeked)
}

// 事件回调挂在 session 对象外，避免接口膨胀：用 WeakMap 存
type SessionHandlers = {
  onTimeUpdate: () => void
  onSeeking: () => void
  onSeeked: () => void
}
const sessionHandlers = new WeakMap<Session, SessionHandlers>()

function handlersFor(s: Session): SessionHandlers {
  let h = sessionHandlers.get(s)
  if (!h) {
    h = {
      onTimeUpdate: () => translationTick(s),
      onSeeking: () => {
        s.seeking = true
        if (s.seekSettleTimer !== null) {
          window.clearTimeout(s.seekSettleTimer)
          s.seekSettleTimer = null
        }
      },
      onSeeked: () => {
        // 回稳 500ms 后恢复翻译调度
        s.seekSettleTimer = window.setTimeout(() => {
          s.seekSettleTimer = null
          s.seeking = false
          translationTick(s)
        }, SEEK_SETTLE_MS)
      },
    }
    sessionHandlers.set(s, h)
  }
  return h
}

// ===== 翻译调度：当前字幕优先、前瞻预取、去重与会话隔离 =====

function cueKey(cue: SubtitleCue): number {
  return Math.round(cue.start * 1000)
}

function translationTick(s: Session): void {
  if (!enabled || s.disposed || session?.id !== s.id) return
  if (s.seeking) return
  const video = s.video
  if (!video || s.cues.length === 0) return

  const rate = video.playbackRate || 1
  const nowMs = video.currentTime * 1000
  const hi = nowMs + LOOK_AHEAD_MS * rate
  const now = Date.now()

  const capacity = Math.min(BATCH_MAX, cueConcurrency - s.translatingStarts.size)
  if (capacity <= 0) return
  const pending: SubtitleCue[] = []
  for (const cue of s.cues) {
    if (pending.length >= capacity) break
    const key = cueKey(cue)
    if (cue.end * 1000 <= nowMs || key > hi) continue
    if (cue.translation !== undefined) continue
    if (s.translatedStarts.has(key) || s.translatingStarts.has(key)) continue
    const failedAt = s.failedAt.get(key)
    if (failedAt !== undefined && now - failedAt < FAILED_RETRY_MS) continue
    pending.push(cue)
  }
  if (pending.length === 0) return

  for (const cue of pending) s.translatingStarts.add(cueKey(cue))

  // 当前字幕单独排到后台队列前部，后续字幕可聚合，沿用引擎并发限制。
  const queue = pending.slice()
  const worker = async (): Promise<void> => {
    for (;;) {
      if (s.disposed || session?.id !== s.id) return
      const cue = queue.shift()
      if (!cue) return
      const key = cueKey(cue)
      try {
        const current = cue.start <= video.currentTime && cue.end > video.currentTime
        const text = await translateText(cue.text, targetLang, current)
        // sessionId 校验：切换视频后丢弃过期结果
        if (s.disposed || session?.id !== s.id) return
        cue.translation = text
        s.translatedStarts.add(key)
        s.failedAt.delete(key)
        s.renderer?.updateCue(cue)
        if (!s.failedAt.size && playerState === 'error') updateControl('ready')
      } catch {
        if (s.disposed || session?.id !== s.id) return
        updateControl('error')
        s.failedAt.set(key, Date.now())
      } finally {
        s.translatingStarts.delete(key)
      }
    }
  }
  const workers = Math.min(cueConcurrency, pending.length)
  for (let i = 0; i < workers; i++) void worker().finally(() => translationTick(s))
}
