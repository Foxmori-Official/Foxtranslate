import type { SubtitleCue } from './types'

export interface TrackSelection {
  languageCode?: string
  kind?: string
  vssId?: string
}

export interface CaptionTrack extends TrackSelection {
  baseUrl: string
  languageCode: string
}

export interface PlayerData {
  videoId: string
  captionTracks: CaptionTrack[]
  audioCaptionTracks?: CaptionTrack[]
  defaultTrack?: CaptionTrack
  selectedTrack?: TrackSelection
  cachedTimedtextUrl?: string
  device?: string
  clientVersion?: string
}

export interface YouTubeCaptions {
  cues: SubtitleCue[]
  trackKey: string
}

const PLAYER_TIMEOUT_MS = 8000
const BRIDGE_TIMEOUT_MS = 1500
const FETCH_TIMEOUT_MS = 4000
const PROOF_WAIT_MS = 5000
const POLL_MS = 200
const RETRY_MS = 600
const DEVICE_PARAMS = ['cbrand', 'cbr', 'cbrver', 'cos', 'cosver', 'cplatform']

export function timedtextUrl(raw: string, videoId?: string): URL | null {
  try {
    const url = new URL(raw, location.origin)
    const id = url.searchParams.get('v')
    if (url.origin !== location.origin || url.pathname !== '/api/timedtext' || (videoId && id && id !== videoId)) return null
    return url
  } catch {
    return null
  }
}

interface BridgeResponse {
  type: 'tv-yt-bridge-response'
  requestId: string
  ok: boolean
  data?: PlayerData
}

let requestCounter = 0
function requestPlayer(action: 'playerData' | 'ensureCc', videoId: string, signal?: AbortSignal): Promise<BridgeResponse | null> {
  if (signal?.aborted) return Promise.resolve(null)
  return new Promise(resolve => {
    const requestId = 'tv-' + Date.now() + '-' + ++requestCounter
    const finish = (response: BridgeResponse | null): void => {
      window.clearTimeout(timer)
      window.removeEventListener('message', onMessage)
      signal?.removeEventListener('abort', onAbort)
      resolve(response)
    }
    const onAbort = () => finish(null)
    const onMessage = (event: MessageEvent<BridgeResponse>) => {
      if (event.source !== window || event.origin !== location.origin) return
      if (event.data?.type === 'tv-yt-bridge-response' && event.data.requestId === requestId) finish(event.data)
    }
    const timer = window.setTimeout(onAbort, BRIDGE_TIMEOUT_MS)
    window.addEventListener('message', onMessage)
    signal?.addEventListener('abort', onAbort, { once: true })
    window.postMessage({ type: 'tv-yt-bridge-request', requestId, action, videoId }, location.origin)
  })
}

function initialPlayerData(videoId: string): PlayerData | null {
  for (const script of document.scripts) {
    const text = script.textContent ?? ''
    const marker = /(?:var\s+)?ytInitialPlayerResponse\s*=\s*\{/.exec(text)
    if (!marker || !text.includes('captionTracks')) continue
    const start = marker.index + marker[0].length - 1
    let depth = 0
    let quoted = false
    for (let i = start; i < text.length; i++) {
      const ch = text[i]
      if (quoted && ch === '\\') {
        i++
        continue
      }
      if (ch === '"') quoted = !quoted
      if (quoted) continue
      if (ch === '{') depth++
      if (ch === '}') depth--
      if (depth !== 0) continue
      try {
        const data = JSON.parse(text.slice(start, i + 1))
        if (data?.videoDetails?.videoId === videoId) {
          const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks
          if (Array.isArray(tracks)) {
            return { videoId, captionTracks: tracks.filter(track => typeof track?.baseUrl === 'string') }
          }
        }
      } catch {
        break
      }
      break
    }
  }
  return null
}

const waitForPlayerPoll = () => new Promise(resolve => window.setTimeout(resolve, POLL_MS))

async function waitForPlayerData(videoId: string, signal?: AbortSignal): Promise<PlayerData | null> {
  const deadline = Date.now() + PLAYER_TIMEOUT_MS
  do {
    const response = await requestPlayer('playerData', videoId, signal)
    signal?.throwIfAborted()
    if (response?.ok && response.data?.videoId === videoId) return response.data
    if (!response) break
    await waitForPlayerPoll()
  } while (Date.now() < deadline)
  return initialPlayerData(videoId)
}

function pickTrack(data: PlayerData): CaptionTrack | undefined {
  const { captionTracks, selectedTrack, defaultTrack } = data
  const selectedById = selectedTrack?.vssId
    ? captionTracks.find(track => track.vssId === selectedTrack.vssId) : undefined
  const selectedByLanguage = selectedTrack?.languageCode
    ? captionTracks.filter(track => track.languageCode === selectedTrack.languageCode) : []
  return selectedById ??
    selectedByLanguage.find(track => track.kind === selectedTrack?.kind) ??
    selectedByLanguage[0] ??
    defaultTrack ??
    captionTracks.find(track => track.kind !== 'asr') ??
    captionTracks[0]
}

function trackKey(track: CaptionTrack): string {
  return [track.vssId, track.languageCode, track.kind, timedtextUrl(track.baseUrl)?.searchParams.get('name')].join('|')
}

export async function getYouTubeTrackKey(videoId: string, signal: AbortSignal): Promise<string | undefined> {
  const response = await requestPlayer('playerData', videoId, signal)
  if (!response?.ok || response.data?.videoId !== videoId) return undefined
  const track = pickTrack(response.data)
  return track ? trackKey(track) : undefined
}

function getCaptionUrls(track: CaptionTrack, data: PlayerData): URL[] {
  const url = timedtextUrl(track.baseUrl, data.videoId)
  if (!url) return []

  // A proof token belongs to one video. Prefer the active audio track, then the native request.
  const cached = data.cachedTimedtextUrl ? timedtextUrl(data.cachedTimedtextUrl, data.videoId) : null
  const audioProofs = (data.audioCaptionTracks ?? []).flatMap(candidate => {
    const proof = timedtextUrl(candidate.baseUrl, data.videoId)
    return proof?.searchParams.get('pot') ? [{ candidate, proof }] : []
  })
  const proof = audioProofs.find(({ candidate }) => track.vssId && candidate.vssId === track.vssId)?.proof ??
    audioProofs.find(({ candidate }) => candidate.languageCode === track.languageCode && candidate.kind === track.kind)?.proof ??
    audioProofs.find(({ proof }) => proof.searchParams.get('v') === data.videoId)?.proof ??
    cached

  for (const [key, value] of Object.entries({
    fmt: 'json3', xorb: '2', xobt: '3', xovt: '3', c: 'WEB', cplayer: 'UNIPLAYER',
  })) {
    url.searchParams.set(key, value)
  }
  const device = new URLSearchParams(data.device)
  for (const key of DEVICE_PARAMS) {
    const value = device.get(key)
    if (value) url.searchParams.set(key, value)
  }
  if (data.clientVersion) url.searchParams.set('cver', data.clientVersion)
  const pot = proof?.searchParams.get('pot')
  if (pot) {
    url.searchParams.set('pot', pot)
    const potc = proof?.searchParams.get('potc')
    if (potc) url.searchParams.set('potc', potc)
    else url.searchParams.delete('potc')
  }

  // Replay the player's request only if it belongs to this exact source track.
  if (cached && !cached.searchParams.has('tlang') && ['lang', 'kind', 'name'].every(key => cached.searchParams.get(key) === url.searchParams.get(key))) {
    cached.searchParams.set('fmt', 'json3')
    return [url, cached]
  }
  return [url]
}

async function fetchText(url: URL, signal?: AbortSignal): Promise<string | null> {
  signal?.throwIfAborted()
  const controller = new AbortController()
  const abort = () => controller.abort()
  const timer = window.setTimeout(abort, FETCH_TIMEOUT_MS)
  signal?.addEventListener('abort', abort, { once: true })
  try {
    const response = await fetch(url, { credentials: 'include', cache: 'no-store', signal: controller.signal })
    return response.ok ? await response.text() : null
  } catch {
    signal?.throwIfAborted()
    return null
  } finally {
    window.clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
  }
}

// ===== 解析：json3 / XML → 统一事件 → SubtitleCue[] =====

interface TimedEvent {
  tStartMs: number
  dDurationMs: number
  aAppend?: number
  wWinId?: number
  segs?: Array<{ utf8?: string; tOffsetMs?: number }>
}

function parseTimedText(text: string): TimedEvent[] | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  const events = trimmed.startsWith('{') ? parseJson3(trimmed) : parseXml(trimmed)
  return events?.sort((a, b) => a.tStartMs - b.tStartMs) ?? null
}

function parseJson3(text: string): TimedEvent[] | null {
  try {
    const data = JSON.parse(text) as { events?: TimedEvent[] }
    if (!Array.isArray(data.events)) return null
    return data.events.filter(e => e && Number.isFinite(e.tStartMs) && Array.isArray(e.segs))
  } catch {
    return null
  }
}

function parseXml(text: string): TimedEvent[] | null {
  try {
    const xml = new DOMParser().parseFromString(text, 'text/xml')
    if (xml.querySelector('parsererror')) return null
    // srv1: transcript > text[start(秒) dur(秒)]；srv3: timedtext > body > p[t(ms) d(ms)]
    const nodes = Array.from(xml.querySelectorAll('transcript > text, timedtext > body > p'))
    const events: TimedEvent[] = nodes.flatMap((node) => {
      const srv3 = node.tagName === 'p'
      const rawStart = node.getAttribute(srv3 ? 't' : 'start')
      const start = Number(rawStart) * (srv3 ? 1 : 1000)
      const dur = Number(node.getAttribute(srv3 ? 'd' : 'dur')) * (srv3 ? 1 : 1000)
      if (rawStart === null || !Number.isFinite(start)) return []
      return [{
        tStartMs: start,
        dDurationMs: Number.isFinite(dur) ? dur : 0,
        segs: [{ utf8: node.textContent ?? '' }],
      }]
    })
    return events.length ? events : null
  } catch {
    return null
  }
}

// ===== 事件 → Cue：标准轨与滚动 ASR 轨 =====

const SENTENCE_END = /[.!?。！？…]["'”’)\]]?\s*$/
const ASR_MAX_CHARS = 100
const ASR_GAP_MS = 800

function cleanText(s: string): string {
  return s.replace(/​/g, '').replace(/\s+/g, ' ').trim()
}

function isScrollingAsr(events: TimedEvent[]): boolean {
  return events.some(e => e.wWinId !== undefined && e.aAppend === 1)
}

function appendCue(cues: SubtitleCue[], cue: SubtitleCue): void {
  const last = cues.at(-1)
  if (last?.start === cue.start) {
    if (last.text !== cue.text) last.text += '\n' + cue.text
    last.end = Math.max(last.end, cue.end)
    return
  }
  if (last && last.end > cue.start) last.end = cue.start
  cues.push(cue)
}

/** 标准轨：一个事件一条 cue */
function eventsToCuesStandard(events: TimedEvent[]): SubtitleCue[] {
  const cues: SubtitleCue[] = []
  for (const e of events) {
    const text = cleanText((e.segs ?? []).map(s => s?.utf8 ?? '').join(''))
    if (!text) continue
    const start = e.tStartMs / 1000
    const duration = Number.isFinite(e.dDurationMs) && e.dDurationMs > 0 ? e.dDurationMs : 2000
    appendCue(cues, { start, end: (e.tStartMs + duration) / 1000, text })
  }
  return cues
}

/** 滚动 ASR：跨事件累积词片段，按句末标点/长度/时间间隙断句 */
function eventsToCuesAsr(events: TimedEvent[], language: string): SubtitleCue[] {
  const cues: SubtitleCue[] = []
  const usesSpaces = !/^(zh|ja|th)(-|$)/i.test(language)
  let buf = ''
  let bufStart = 0
  let bufEnd = 0
  let pendingSplit = false

  const flush = (): void => {
    const text = cleanText(buf)
    if (text) {
      const start = bufStart / 1000
      cues.push({ start, end: Math.max(start + 0.2, bufEnd / 1000), text })
    }
    buf = ''
    bufEnd = 0
    pendingSplit = false
  }

  for (const e of events) {
    if (!e.segs?.length) continue
    // 只有空白的滚动事件是分隔符。带文字的追加事件仍是字幕。
    if (e.aAppend === 1 && e.segs.every(seg => !seg?.utf8?.trim())) {
      if (buf) {
        bufEnd = Math.max(bufEnd, e.tStartMs + (e.dDurationMs || 0))
        if (pendingSplit) flush()
      }
      continue
    }
    if (buf && e.tStartMs - bufEnd > ASR_GAP_MS) flush()
    if (usesSpaces && buf && !pendingSplit && !/\s$/.test(buf) && /^\S/.test(e.segs[0]?.utf8 ?? '')) buf += ' '

    for (let i = 0; i < e.segs.length; i++) {
      const seg = e.segs[i]
      const segText = seg?.utf8 ?? ''
      if (!segText) continue
      // 上一句已满（句末标点/长度上限）：在追加新词前落盘
      if (buf && pendingSplit) flush()
      if (!buf.trim()) bufStart = e.tStartMs + (seg.tOffsetMs ?? 0)
      buf += segText
      const nextOffset = e.segs[i + 1]?.tOffsetMs
      bufEnd =
        nextOffset !== undefined
          ? Math.max(e.tStartMs + nextOffset, bufEnd)
          : Math.max(e.tStartMs + (e.dDurationMs || 0), e.tStartMs + (seg.tOffsetMs ?? 0) + 200)
      const trimmed = segText.trim()
      if (SENTENCE_END.test(trimmed) || cleanText(buf).length >= ASR_MAX_CHARS) {
        pendingSplit = true
      }
    }
  }
  flush()
  const ordered: SubtitleCue[] = []
  for (const cue of cues.sort((a, b) => a.start - b.start)) appendCue(ordered, cue)
  return ordered
}

/** Read the active CC track. A missing track is distinct from a failed fetch. */
export async function fetchYouTubeCues(videoId: string, signal?: AbortSignal): Promise<YouTubeCaptions | null> {
  const player = await waitForPlayerData(videoId, signal)
  if (!player) throw new Error('YouTube player data unavailable')
  if (!player.captionTracks.length) return null

  const tried = new Map<string, { count: number; time: number }>()
  async function tryPlayerData(data: PlayerData): Promise<YouTubeCaptions | null> {
    const track = pickTrack(data)
    if (!track) return null
    for (const url of getCaptionUrls(track, data)) {
      const attempt = tried.get(url.href)
      const time = Date.now()
      if (attempt && (!url.searchParams.has('pot') || attempt.count >= 2 || time - attempt.time < RETRY_MS)) continue
      tried.set(url.href, { count: (attempt?.count ?? 0) + 1, time })
      const body = await fetchText(url, signal)
      const events = body && parseTimedText(body)
      if (!events) continue
      const scrolling = track.kind === 'asr' && isScrollingAsr(events)
      const cues = scrolling ? eventsToCuesAsr(events, track.languageCode) : eventsToCuesStandard(events)
      if (cues.length) return { cues, trackKey: trackKey(track) }
    }
    return null
  }

  const fast = await tryPlayerData(player)
  if (fast) return fast

  // An unsigned timedtext request can return HTTP 200 with an empty body.
  // Ask the actual watch player to start CC, then read the fresh audio track or intercepted URL.
  const activated = await requestPlayer('ensureCc', videoId, signal)
  signal?.throwIfAborted()
  if (activated?.ok) {
    const deadline = Date.now() + PROOF_WAIT_MS
    do {
      const response = await requestPlayer('playerData', videoId, signal)
      signal?.throwIfAborted()
      if (!response) break
      if (response.ok && response.data?.videoId === videoId) {
        const result = await tryPlayerData(response.data)
        if (result) return result
      }
      await waitForPlayerPoll()
    } while (Date.now() < deadline)
  }
  throw new Error('YouTube captions could not be loaded')
}
