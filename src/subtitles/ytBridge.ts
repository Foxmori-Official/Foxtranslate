import { timedtextUrl, type CaptionTrack, type PlayerData, type TrackSelection } from './ytFetch'

interface RawTrack extends TrackSelection {
  baseUrl?: string
  url?: string
  vss_id?: string
  trackKind?: string
}

interface TrackList {
  captionTracks?: RawTrack[]
  audioTracks?: Array<{ defaultCaptionTrackIndex?: number; captionTrackIndices?: number[] }>
  defaultAudioTrackIndex?: number
}

interface YouTubePlayer extends HTMLElement {
  getPlayerResponse?: () => {
    videoDetails?: { videoId?: string }
    captions?: { playerCaptionsTracklistRenderer?: TrackList }
  }
  getAudioTrack?: () => { captionTracks?: RawTrack[] }
  getOption?: (module: string, option: string) => RawTrack | undefined
  getWebPlayerContextConfig?: () => { innertubeContextClientVersion?: string }
  toggleSubtitles?: () => void
}

function mainWorldBridge(): void {
  const w = window as Window & {
    __tvYtBridgeInjected__?: boolean
    ytcfg?: { get?: (key: string) => string | undefined }
  }
  if (w.__tvYtBridgeInjected__) return
  w.__tvYtBridgeInjected__ = true

  // Observe the requests made by YouTube itself, in the page's world.
  const nativeUrls = new Map<string, { latest: string; authorized?: string }>()
  function capture(raw: string): void {
    if (!raw.includes('/api/timedtext')) return
    const url = timedtextUrl(raw)
    const videoId = url?.searchParams.get('v')
    if (!url || !videoId) return
    const previous = nativeUrls.get(videoId)
    if (previous?.latest === url.href) return
    nativeUrls.delete(videoId)
    nativeUrls.set(videoId, {
      latest: url.href,
      authorized: url.searchParams.has('pot') ? url.href : previous?.authorized,
    })
    const oldest = nativeUrls.keys().next().value
    if (nativeUrls.size > 8 && oldest) nativeUrls.delete(oldest)
    window.postMessage({ type: 'tv-yt-native-timedtext', videoId }, location.origin)
  }

  const open = XMLHttpRequest.prototype.open
  XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, ...args: [string, string | URL, boolean?, string?, string?]): void {
    Reflect.apply(open, this, args)
    capture(String(args[1]))
  }

  const fetch = window.fetch
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url
    if (url) capture(url)
    return fetch.call(this, input, init)
  }

  function asTrack(raw: RawTrack, videoId: string): CaptionTrack | null {
    const baseUrl = raw?.baseUrl || raw?.url
    const url = typeof baseUrl === 'string' ? timedtextUrl(baseUrl, videoId) : null
    if (!url) return null
    return {
      baseUrl: url.href,
      languageCode: raw.languageCode || url.searchParams.get('lang') || '',
      kind: raw.kind || raw.trackKind || url.searchParams.get('kind') || undefined,
      vssId: raw.vssId || raw.vss_id || url.searchParams.get('vssId') || url.searchParams.get('vss_id') || undefined,
    }
  }

  function playerData(player: YouTubePlayer, videoId: string, list: TrackList | undefined): PlayerData {
    const tracks = (list?.captionTracks ?? []).map(raw => asTrack(raw, videoId))
    const audio = list?.audioTracks?.[list.defaultAudioTrackIndex ?? 0] ?? list?.audioTracks?.[0]
    const defaultIndex = audio?.defaultCaptionTrackIndex
    const trackIndices = audio?.captionTrackIndices
    const resolvedIndex = defaultIndex !== undefined && trackIndices && !trackIndices.includes(defaultIndex)
      ? trackIndices[defaultIndex] : defaultIndex
    const selected = player.getOption?.('captions', 'track')
    const selectedUrl = selected?.baseUrl ? timedtextUrl(selected.baseUrl, videoId) : null
    const audioCaptionTracks = (player.getAudioTrack?.()?.captionTracks ?? [])
      .map(raw => asTrack(raw, videoId)).filter(track => track !== null)
    const native = nativeUrls.get(videoId)
    return {
      videoId,
      captionTracks: tracks.filter(track => track !== null),
      audioCaptionTracks,
      defaultTrack: resolvedIndex === undefined ? undefined : tracks[resolvedIndex] ?? undefined,
      selectedTrack: {
        vssId: selected?.vssId || selected?.vss_id || selectedUrl?.searchParams.get('vssId') || selectedUrl?.searchParams.get('vss_id') || undefined,
        languageCode: selected?.languageCode || selectedUrl?.searchParams.get('lang') || undefined,
        kind: selected?.kind || selected?.trackKind || selectedUrl?.searchParams.get('kind') || undefined,
      },
      cachedTimedtextUrl: native?.authorized ?? native?.latest,
      device: w.ytcfg?.get?.('DEVICE'),
      clientVersion: player.getWebPlayerContextConfig?.()?.innertubeContextClientVersion ?? w.ytcfg?.get?.('INNERTUBE_CLIENT_VERSION'),
    }
  }

  window.addEventListener('message', (event: MessageEvent) => {
    if (event.source !== window || event.origin !== location.origin) return
    const { type, action, videoId, requestId } = event.data ?? {}
    if (type !== 'tv-yt-bridge-request' || typeof videoId !== 'string' || typeof requestId !== 'string') return
    if (action !== 'playerData' && action !== 'ensureCc') return

    const reply = (payload: { ok: boolean; data?: PlayerData }): void => {
      window.postMessage({ type: 'tv-yt-bridge-response', requestId, ...payload }, location.origin)
    }

    try {
      const player = document.querySelector<YouTubePlayer>('#movie_player')
      const response = player?.getPlayerResponse?.()
      if (
        !player || response?.videoDetails?.videoId !== videoId ||
        new URLSearchParams(location.search).get('v') !== videoId ||
        player.matches('.ad-showing, .ad-interrupting')
      ) {
        reply({ ok: false })
        return
      }
      if (action === 'playerData') {
        reply({ ok: true, data: playerData(player, videoId, response.captions?.playerCaptionsTracklistRenderer) })
        return
      }

      const button = player.querySelector<HTMLElement>('.ytp-subtitles-button')
      if (button && button.getAttribute('aria-pressed') !== 'true' && button.getAttribute('aria-disabled') !== 'true') {
        if (player.toggleSubtitles) player.toggleSubtitles()
        else button.click()
      }
      reply({ ok: true })
    } catch {
      reply({ ok: false })
    }
  })
}

mainWorldBridge()
