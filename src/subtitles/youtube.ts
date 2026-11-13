import { DEFAULT_CONFIG, normalizeConfig, type SubtitlePatch, type SubtitlePreferences } from '../shared/config'
import { matchHotkey } from '../shared/hotkeys'
import { featureCopy } from '../shared/featureCopy'
import { isAiProvider } from '../shared/engines'
import { downloadSubtitles } from './subtitleDownload'
import type { BgResponse } from '../shared/protocol'
import { PlayerControl, type PlayerState } from './playerControl'
// YouTube 双语字幕主编排：配置开关 → SPA 导航 → 获取 → 前瞻翻译调度 → 渲染
import { getSubtitlesConfig, translateText, type SubtitleCue } from './types'
import { fetchYouTubeCues, getYouTubeTrackKey, type YouTubeCaptions } from './ytFetch'
import { YouTubeRenderer } from './ytRender'

const LOOK_AHEAD_SECONDS = 30
const PRIORITY_LEAD_SECONDS = 2
const MAX_PREFETCH_CUES = 5
const FAILED_RETRY_MS = 5_000
const NAV_POLL_MS = 1000
const PLAYER_WAIT_MS = 10_000

interface Session {
  videoId: string
  captions: YouTubeCaptions | null
  trackRequest: Promise<YouTubeCaptions | null> | null
  checkTrackAfterLoad: boolean
  translating: Set<SubtitleCue>
  failedAt: WeakMap<SubtitleCue, number>
  priorityPending: boolean
  prefetchPending: boolean
  renderer: YouTubeRenderer | null
  video: HTMLVideoElement | null
  controller: AbortController
}

let booted = false
let enabled = false
let targetLang = 'zh-CN'
let prefetchLimit = 2
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
    const pendingTrack = session?.videoId === videoId && (session.captions || playerState === 'loading')
      ? session.trackRequest : null
    const captions = await (pendingTrack ?? fetchYouTubeCues(videoId))
    await downloadSubtitles({
      cues: captions?.cues ?? [], videoId,
      targetLang: language, uiLang, mode, translationAbove, progress,
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
  prefetchLimit = config.batch.enabled && isAiProvider(config.engine.provider)
    ? Math.min(MAX_PREFETCH_CUES, Math.max(1, config.batch.maxTexts || 1)) : 2
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
  window.addEventListener('message', onNativeTimedtext)
  document.addEventListener('keydown', event => {
    if (!event.isTrusted) return
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

function onNativeTimedtext(event: MessageEvent): void {
  if (event.source !== window || event.origin !== location.origin || event.data?.type !== 'tv-yt-native-timedtext') return
  const s = session
  if (!s || !isCurrent(s) || event.data.videoId !== s.videoId) return
  if (s.captions) void refreshSelectedTrack(s)
  else if (playerState === 'loading') s.checkTrackAfterLoad = true
  else restartCaptionTrack()
}

async function refreshSelectedTrack(s: Session): Promise<void> {
  const selected = await getYouTubeTrackKey(s.videoId, s.controller.signal)
  if (selected && selected !== s.captions?.trackKey && isCurrent(s)) restartCaptionTrack()
}

function restartCaptionTrack(): void {
  navigationRevision++
  teardownSession()
  onNavigate()
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
  if (session && session.videoId === videoId) {
    updateControl(playerState)
    translationTick(session)
    return
  }
  teardownSession()
  const s: Session = {
    videoId,
    captions: null,
    trackRequest: null,
    checkTrackAfterLoad: false,
    translating: new Set(),
    failedAt: new WeakMap(),
    priorityPending: false,
    prefetchPending: false,
    renderer: null,
    video: null,
    controller: new AbortController(),
  }
  session = s
  updateControl('loading')
  void loadSession(s).catch(() => {
    if (isCurrent(s)) updateControl('error')
  })
}

function teardownSession(): void {
  if (!session) return
  session.controller.abort()
  session.renderer?.destroy()
  session = null
}

function isCurrent(s: Session): boolean {
  return session === s && currentVideoId() === s.videoId
}

// ===== 会话加载：找播放器 → 拉字幕 → 渲染 + 调度 =====

async function loadSession(s: Session): Promise<void> {
  const found = await waitForPlayer(s)
  if (!isCurrent(s)) return
  if (!found) {
    updateControl('error')
    return
  }
  const [player, video] = found
  s.video = video

  const { signal } = s.controller
  s.trackRequest = fetchYouTubeCues(s.videoId, signal)
  const captions = await s.trackRequest
  if (!isCurrent(s)) return
  if (!captions) {
    updateControl('empty')
    return
  }

  s.captions = captions
  const renderer = new YouTubeRenderer()
  renderer.mount(player, video)
  renderer.setPreferences(preferences)
  renderer.setCues(captions.cues)
  s.renderer = renderer
  updateControl('ready')
  if (s.checkTrackAfterLoad) void refreshSelectedTrack(s)
  for (const event of ['timeupdate', 'seeked', 'ratechange']) {
    video.addEventListener(event, () => translationTick(s), { signal })
  }
  translationTick(s)
}

function waitForPlayer(
  s: Session,
): Promise<[HTMLElement, HTMLVideoElement] | null> {
  return new Promise((resolve) => {
    const deadline = Date.now() + PLAYER_WAIT_MS
    const probe = (): void => {
      if (!isCurrent(s)) {
        resolve(null)
        return
      }
      const player = document.querySelector<HTMLElement>('#movie_player')
      const video = player?.querySelector<HTMLVideoElement>('video.html5-main-video') ??
        player?.querySelector<HTMLVideoElement>('video') ??
        null
      if (player && video) {
        if (!player.matches('.ad-showing, .ad-interrupting')) {
          resolve([player, video])
          return
        }
      } else if (Date.now() > deadline) {
        resolve(null)
        return
      }
      window.setTimeout(probe, 500)
    }
    probe()
  })
}

// Jump directly to the first cue that has not expired.
function firstCueAfter(cues: SubtitleCue[], time: number): number {
  let low = 0
  let high = cues.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (cues[middle].end <= time) low = middle + 1
    else high = middle
  }
  return low
}

function translationTick(s: Session): void {
  const { video, captions } = s
  if (!isCurrent(s) || !video || !captions || video.seeking ||
      video.closest('.ad-showing, .ad-interrupting')) return

  const { cues } = captions
  const time = video.currentTime
  const first = firstCueAfter(cues, time)
  const next = cues[first]
  if (!next) return
  if (playerState === 'translateError' && next.start <= time && next.translation !== undefined) updateControl('ready')

  const now = Date.now()
  const canTranslate = (cue: SubtitleCue) => cue.translation === undefined && !s.translating.has(cue) &&
    now - (s.failedAt.get(cue) ?? -Infinity) >= FAILED_RETRY_MS

  // Keep a slot for the playing (or imminent) cue when the prefetch batch is busy.
  if (!s.priorityPending && next.start <= time + PRIORITY_LEAD_SECONDS && canTranslate(next)) {
    s.priorityPending = true
    void translateCue(s, next, true).finally(() => {
      s.priorityPending = false
      translationTick(s)
    })
  }
  if (s.prefetchPending) return

  const rate = Math.min(4, Math.max(1, video.playbackRate || 1))
  const horizon = time + LOOK_AHEAD_SECONDS * rate
  const pending: SubtitleCue[] = []
  for (let i = first; i < cues.length && pending.length < prefetchLimit; i++) {
    const cue = cues[i]
    if (cue.start > horizon) break
    if (canTranslate(cue)) pending.push(cue)
  }
  if (!pending.length) return

  s.prefetchPending = true
  void Promise.all(pending.map(cue => translateCue(s, cue, false))).finally(() => {
    s.prefetchPending = false
    translationTick(s)
  })
}

async function translateCue(s: Session, cue: SubtitleCue, immediate: boolean): Promise<void> {
  s.translating.add(cue)
  const isPlaying = () => {
    const time = s.video?.currentTime ?? -1
    return cue.start <= time && time < cue.end
  }
  try {
    const translation = await translateText(cue.text, targetLang, { immediate, scope: 'youtube' })
    if (!isCurrent(s)) return
    if (!translation.trim()) throw new Error('Translation returned no text')
    cue.translation = translation
    s.failedAt.delete(cue)
    s.renderer?.updateCue(cue)
    if (playerState === 'translateError' && isPlaying()) updateControl('ready')
  } catch {
    if (!isCurrent(s)) return
    s.failedAt.set(cue, Date.now())
    if (isPlaying()) updateControl('translateError')
  } finally {
    s.translating.delete(cue)
  }
}
