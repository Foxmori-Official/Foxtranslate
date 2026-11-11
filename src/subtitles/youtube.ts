import { normalizeConfig } from '../shared/config'
import { PlayerControl, type PlayerState } from './playerControl'
// YouTube 双语字幕主编排：配置开关 → SPA 导航 → 获取 → 前瞻翻译调度 → 渲染
import { getSubtitlesConfig, translateText, type SubtitleCue } from './types'
import { fetchYouTubeCues } from './ytFetch'
import { YouTubeRenderer } from './ytRender'

const LOOK_AHEAD_MS = 30_000 // 前瞻窗口（× playbackRate）
const LOOK_BEHIND_MS = 5_000 // 补翻刚播过的
const BATCH_MAX = 3 // 单次 tick 最多取多少条
const CONCURRENCY = 3
const FAILED_RETRY_MS = 60_000 // 失败冷却后可重试
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
let sessionSeq = 0
let session: Session | null = null
let navPollTimer: number | null = null
let uiLang = 'auto'
let playerState: PlayerState = 'off'
const control = new PlayerControl(async () => {
  const config = await getSubtitlesConfig()
  if (!config) throw new Error('Configuration unavailable')
  const next = !enabled
  const response = await chrome.runtime.sendMessage({
    kind: 'setConfig',
    patch: { subtitles: { ...config.subtitles, enabled: next || config.subtitles.enabled, youtube: next } },
  })
  if (!response?.ok) throw new Error(response?.error || 'Save failed')
  applyConfiguration(response.data)
})

function updateControl(state: PlayerState): void {
  playerState = state
  control.update(enabled, state, uiLang)
}

function mountControl(): void {
  const player = document.querySelector<HTMLElement>('#movie_player')
  if (currentVideoId() && player) control.mount(player)
  else control.destroy()
}

function applyConfiguration(raw: unknown): void {
  const config = normalizeConfig(raw)
  const nextEnabled = config.subtitles.enabled && config.subtitles.youtube
  const changed = nextEnabled !== enabled || config.general.targetLang !== targetLang
  enabled = nextEnabled
  targetLang = config.general.targetLang
  uiLang = config.uiLang
  if (changed) {
    teardownSession()
    if (enabled) onNavigate()
    else updateControl('off')
  } else {
    control.update(enabled, playerState, uiLang)
  }
}


/** 入口：由 subtitles/index.ts 在 youtube.com 页面调用 */
export function startYouTube(): void {
  if (booted) return
  booted = true
  void bootstrap()
}

async function bootstrap(): Promise<void> {
  const config = await getSubtitlesConfig()
  if (config) applyConfiguration(config)
  else updateControl('error')
  watchConfigChanges()
  window.addEventListener('yt-navigate-finish', onNavigate)
  document.addEventListener('yt-navigate-start', onNavigateStart)
  navPollTimer = window.setInterval(pollVideoIdChange, NAV_POLL_MS)
  mountControl()
  if (enabled) onNavigate()
  window.addEventListener('pagehide', () => {
    teardownSession()
    control.destroy()
    if (navPollTimer !== null) window.clearInterval(navPollTimer)
    navPollTimer = null
  })
  window.addEventListener('pageshow', event => {
    if (!event.persisted) return
    if (navPollTimer === null) navPollTimer = window.setInterval(pollVideoIdChange, NAV_POLL_MS)
    mountControl()
    if (enabled) onNavigate()
  })
}

// ===== 配置热开关 =====

function watchConfigChanges(): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes['tv:config_v1']) applyConfiguration(changes['tv:config_v1'].newValue)
  })
}

// ===== SPA 导航 =====

function currentVideoId(): string | null {
  if (location.pathname === '/watch') {
    return new URLSearchParams(location.search).get('v')
  }
  return null
}

function onNavigateStart(): void {
  // 离开旧视频：作废旧会话（sessionId 递增使在途回调失效）
  teardownSession()
}

function onNavigate(): void {
  mountControl()
  if (!enabled) return
  const videoId = currentVideoId()
  if (!videoId) {
    teardownSession()
    return
  }
  if (session && session.videoId === videoId && !session.disposed) return
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

function pollVideoIdChange(): void {
  mountControl()
  if (session?.video && !session.video.isConnected) teardownSession()
  if (!enabled) return
  const videoId = currentVideoId()
  if (!videoId) {
    if (session) teardownSession()
    return
  }
  if (!session || session.videoId !== videoId || session.disposed) onNavigate()
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

  const cues = await fetchYouTubeCues(s.videoId)
  if (s.disposed || session?.id !== s.id) return
  if (!cues || cues.length === 0) {
    updateControl('empty')
    return
  }

  s.cues = cues
  const renderer = new YouTubeRenderer()
  renderer.mount(player, video)
  renderer.setCues(cues)
  s.renderer = renderer
  s.video = video
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

// ===== 翻译调度：前瞻窗口 + 并发 3 + Set 去重 + sessionId 防竞态 =====

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
  const lo = nowMs - LOOK_BEHIND_MS
  const hi = nowMs + LOOK_AHEAD_MS * rate
  const now = Date.now()

  const capacity = Math.min(BATCH_MAX, CONCURRENCY - s.translatingStarts.size)
  if (capacity <= 0) return
  const pending: SubtitleCue[] = []
  for (const cue of s.cues) {
    if (pending.length >= capacity) break
    const key = cueKey(cue)
    if (key < lo || key > hi) continue
    if (cue.translation !== undefined) continue
    if (s.translatedStarts.has(key) || s.translatingStarts.has(key)) continue
    const failedAt = s.failedAt.get(key)
    if (failedAt !== undefined && now - failedAt < FAILED_RETRY_MS) continue
    pending.push(cue)
  }
  if (pending.length === 0) return

  for (const cue of pending) s.translatingStarts.add(cueKey(cue))

  // 并发 3 的简易 worker pool
  const queue = pending.slice()
  const worker = async (): Promise<void> => {
    for (;;) {
      const cue = queue.shift()
      if (!cue) return
      const key = cueKey(cue)
      try {
        const text = await translateText(cue.text, targetLang)
        // sessionId 校验：切换视频后丢弃过期结果
        if (s.disposed || session?.id !== s.id) return
        cue.translation = text
        s.translatedStarts.add(key)
        s.failedAt.delete(key)
        s.renderer?.updateCue(cue)
      } catch {
        if (s.disposed || session?.id !== s.id) return
        updateControl('error')
        s.failedAt.set(key, Date.now())
      } finally {
        s.translatingStarts.delete(key)
      }
    }
  }
  const workers = Math.min(CONCURRENCY, pending.length)
  for (let i = 0; i < workers; i++) void worker().finally(() => translationTick(s))
}
