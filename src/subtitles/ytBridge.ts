import type { CaptionTrack, BridgeAction } from './ytFetch'

function mainWorldBridge(): void {
  const w = window as unknown as Record<string, unknown>
  if (w.__tvYtBridgeInjected__) return
  w.__tvYtBridgeInjected__ = true

  const REQ = 'tv-yt-bridge-request'
  const RES = 'tv-yt-bridge-response'

  interface YtPlayer extends HTMLElement {
    getPlayerResponse?: () => unknown
    toggleSubtitles?: () => void
  }

  // --- timedtext URL 捕获（带 pot token 的完整 URL，按 videoId 缓存） ---
  const urlCache = new Map<string, string>()
  const urlWaiters = new Map<string, Array<(url: string) => void>>()

  function cacheTimedtextUrl(rawUrl: string): void {
    try {
      if (!rawUrl || rawUrl.indexOf('api/timedtext') === -1) return
      const u = new URL(rawUrl)
      const vid = u.searchParams.get('v')
      if (!vid || !u.searchParams.get('pot')) return
      urlCache.set(vid, rawUrl)
      const waiters = urlWaiters.get(vid)
      if (waiters) {
        urlWaiters.delete(vid)
        for (const resolve of waiters) resolve(rawUrl)
      }
    } catch {
      /* ignore */
    }
  }

  function waitForUrl(vid: string, timeoutMs: number): Promise<string | null> {
    const cached = urlCache.get(vid)
    if (cached) return Promise.resolve(cached)
    return new Promise((resolve) => {
      const list = urlWaiters.get(vid) ?? []
      const entry = (url: string): void => resolve(url)
      list.push(entry)
      urlWaiters.set(vid, list)
      setTimeout(() => {
        const cur = urlWaiters.get(vid)
        if (cur) {
          const i = cur.indexOf(entry)
          if (i !== -1) cur.splice(i, 1)
          if (cur.length === 0) urlWaiters.delete(vid)
        }
        resolve(urlCache.get(vid) ?? null)
      }, timeoutMs)
    })
  }

  // hook XHR
  type Variadic = (this: XMLHttpRequest, ...args: unknown[]) => void
  const origOpen = XMLHttpRequest.prototype.open as unknown as Variadic
  const origSend = XMLHttpRequest.prototype.send as unknown as Variadic
  XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, ...args: unknown[]): void {
    ;(this as unknown as { __tvUrl?: string }).__tvUrl = String(args[1])
    origOpen.apply(this, args)
  } as unknown as typeof XMLHttpRequest.prototype.open
  XMLHttpRequest.prototype.send = function (this: XMLHttpRequest, ...args: unknown[]): void {
    this.addEventListener('load', function (this: XMLHttpRequest) {
      const self = this as unknown as { __tvUrl?: string; responseURL: string }
      cacheTimedtextUrl(self.responseURL || self.__tvUrl || '')
    })
    origSend.apply(this, args)
  } as unknown as typeof XMLHttpRequest.prototype.send

  // hook fetch（新版播放器可能走 fetch）
  const origFetch = window.fetch
  window.fetch = function (this: unknown, input: RequestInfo | URL): Promise<Response> {
    try {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url && url.indexOf('api/timedtext') !== -1) cacheTimedtextUrl(url)
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line prefer-rest-params
    return origFetch.apply(this, arguments as unknown as [RequestInfo | URL])
  } as typeof window.fetch

  function findPlayer(): YtPlayer | null {
    const el = document.querySelector<YtPlayer>('#movie_player')
    if (el) return el
    return document.querySelector<YtPlayer>('.html5-video-player')
  }

  interface RawTrack {
    baseUrl?: string
    languageCode?: string
    kind?: string
    vssId?: string
    name?: { simpleText?: string }
  }

  function getPlayerData(expectedVideoId: string): {
    ok: boolean
    videoId?: string
    captionTracks?: CaptionTrack[]
    cachedTimedtextUrl?: string | null
    error?: string
  } {
    const player = findPlayer()
    if (!player || typeof player.getPlayerResponse !== 'function') {
      return { ok: false, error: 'PLAYER_NOT_FOUND' }
    }
    const resp = player.getPlayerResponse() as {
      videoDetails?: { videoId?: string }
      captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: RawTrack[] } }
    } | null
    const videoId = resp?.videoDetails?.videoId
    if (!videoId || videoId !== expectedVideoId) {
      return { ok: false, error: 'VIDEO_ID_MISMATCH' }
    }
    const raw = resp?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? []
    const captionTracks: CaptionTrack[] = raw
      .filter((t): t is RawTrack & { baseUrl: string } => typeof t?.baseUrl === 'string')
      .map((t) => ({
        baseUrl: t.baseUrl,
        languageCode: typeof t.languageCode === 'string' ? t.languageCode : '',
        ...(t.kind ? { kind: t.kind } : {}),
        ...(t.vssId ? { vssId: t.vssId } : {}),
        ...(t.name?.simpleText ? { name: t.name.simpleText } : {}),
      }))
    return {
      ok: true,
      videoId,
      captionTracks,
      cachedTimedtextUrl: urlCache.get(videoId) ?? null,
    }
  }

  function ensureCc(): void {
    const player = findPlayer()
    const btn = document.querySelector('.ytp-subtitles-button')
    const pressed = btn?.getAttribute('aria-pressed') === 'true'
    if (pressed) return
    if (player && typeof player.toggleSubtitles === 'function') {
      player.toggleSubtitles()
    } else if (btn instanceof HTMLElement) {
      btn.click()
    }
  }

  window.addEventListener('message', (event: MessageEvent) => {
    if (event.source !== window) return
    const data = event.data as {
      type?: string
      requestId?: string
      action?: BridgeAction
      videoId?: string
      timeoutMs?: number
    } | null
    if (!data || data.type !== REQ || typeof data.requestId !== 'string') return

    const reply = (payload: Record<string, unknown>): void => {
      window.postMessage({ type: RES, requestId: data.requestId, ...payload }, location.origin)
    }

    if (data.action === 'playerData' && typeof data.videoId === 'string') {
      try {
        reply(getPlayerData(data.videoId))
      } catch (e) {
        reply({ ok: false, error: String(e) })
      }
    } else if (data.action === 'waitTimedtext' && typeof data.videoId === 'string') {
      void waitForUrl(data.videoId, data.timeoutMs ?? 8000).then((url) => {
        reply({ ok: true, url })
      })
    } else if (data.action === 'ensureCc') {
      try {
        ensureCc()
      } catch {
        /* ignore */
      }
      reply({ ok: true })
    }
  })
}


mainWorldBridge()
