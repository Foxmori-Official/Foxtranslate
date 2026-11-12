// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchYouTubeCues, type PlayerData } from '../../src/subtitles/ytFetch'

const videoId = 'fixture'
const cue = { start: 1, end: 3, text: 'Hello world.' }
const captions = JSON.stringify({ events: [{ tStartMs: 1000, dDurationMs: 2000, segs: [{ utf8: cue.text }] }] })
const english = { baseUrl: '/api/timedtext?v=fixture&lang=en', languageCode: 'en', vssId: '.en' }
const french = { baseUrl: '/api/timedtext?v=fixture&lang=fr', languageCode: 'fr', vssId: '.fr' }

function installBridge(getData: () => Partial<PlayerData> | null) {
  return vi.spyOn(window, 'postMessage').mockImplementation(message => {
    const data = message.action === 'playerData' ? getData() : {}
    window.dispatchEvent(new MessageEvent('message', {
      source: window,
      origin: location.origin,
      data: {
        type: 'tv-yt-bridge-response', requestId: message.requestId, ok: data !== null,
        data: { videoId, captionTracks: [english], ...data },
      },
    }))
  })
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('YouTube 字幕读取', () => {
  it('跟随播放器选轨，用同视频的音频轨凭据拼接请求参数', async () => {
    installBridge(() => ({
      captionTracks: [french, english],
      defaultTrack: french,
      selectedTrack: { vssId: '.en' },
      audioCaptionTracks: [
        { ...english, baseUrl: '/api/timedtext?v=ad&lang=en&pot=ad-proof' },
        { ...english, baseUrl: english.baseUrl + '&pot=audio-proof&potc=1' },
      ],
      cachedTimedtextUrl: french.baseUrl + '&pot=other-track',
      device: 'cos=Macintosh&cbr=Chrome',
      clientVersion: '2.20261111.01.00',
    }))
    const request = vi.fn(async (_url: URL) => new Response(captions))
    vi.stubGlobal('fetch', request)

    expect((await fetchYouTubeCues(videoId))?.cues).toEqual([cue])
    expect(request).toHaveBeenCalledTimes(1)
    const params = request.mock.calls[0][0].searchParams
    expect(Object.fromEntries(params)).toMatchObject({
      lang: 'en', pot: 'audio-proof', potc: '1', fmt: 'json3', c: 'WEB',
      cplayer: 'UNIPLAYER', cver: '2.20261111.01.00', cos: 'Macintosh', cbr: 'Chrome',
    })
  })

  it('等播放器响应更新，并在空响应后使用 CC 刚发出的授权地址', async () => {
    vi.useFakeTimers()
    let reads = 0
    const bridge = installBridge(() => {
      reads++
      if (reads === 1) return null
      return reads >= 4 ? { cachedTimedtextUrl: english.baseUrl + '&pot=native-proof' } : {}
    })
    const request = vi.fn(async (url: URL) => new Response(url.searchParams.has('pot') ? captions : ''))
    vi.stubGlobal('fetch', request)

    const result = fetchYouTubeCues(videoId)
    await vi.advanceTimersByTimeAsync(500)
    expect((await result)?.cues).toEqual([cue])
    expect(bridge.mock.calls.filter(([message]) => message.action === 'ensureCc').map(([message]) => message.videoId))
      .toEqual([videoId])
    expect(request.mock.calls.map(([url]) => url.searchParams.get('pot'))).toEqual([null, 'native-proof'])
  })

  it('中止卡住的 timedtext 请求并在视频切换后停止读取', async () => {
    const bridge = installBridge(() => ({}))
    const request = vi.fn((_url: URL, init?: RequestInit): Promise<Response> => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
    }))
    vi.stubGlobal('fetch', request)
    const controller = new AbortController()

    const result = fetchYouTubeCues(videoId, controller.signal)
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1))
    controller.abort()
    await expect(result).rejects.toThrow()
    expect(request.mock.calls[0][1]?.signal?.aborted).toBe(true)
    expect(bridge.mock.calls.some(([message]) => message.action === 'ensureCc')).toBe(false)
  })

  it('授权请求暂时返回空响应时会重新请求', async () => {
    vi.useFakeTimers()
    const signed = { ...english, baseUrl: english.baseUrl + '&pot=proof' }
    installBridge(() => ({ captionTracks: [signed] }))
    const request = vi.fn(async (_url: URL) => new Response(captions))
      .mockResolvedValueOnce(new Response(''))
    vi.stubGlobal('fetch', request)
    const result = fetchYouTubeCues(videoId)
    await vi.advanceTimersByTimeAsync(700)
    expect((await result)?.cues).toEqual([cue])
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('保留人工字幕的时间边界，即使字幕使用了滚动窗口', async () => {
    installBridge(() => ({ captionTracks: [french, english], defaultTrack: english }))
    const request = vi.fn(async (_url: URL) => Response.json({ events: [
      { tStartMs: 3000, dDurationMs: 1200, wWinId: 1, aAppend: 1, segs: [{ utf8: 'Second line' }] },
      { tStartMs: 1000, dDurationMs: 1600, wWinId: 1, segs: [{ utf8: 'First line' }] },
    ] }))
    vi.stubGlobal('fetch', request)

    const result = await fetchYouTubeCues(videoId)
    expect(request.mock.calls[0][0].searchParams.get('lang')).toBe('en')
    expect(result?.cues).toEqual([
      { start: 1, end: 2.6, text: 'First line' },
      { start: 3, end: 4.2, text: 'Second line' },
    ])
  })

  it('保留自动字幕中有文字的追加段落', async () => {
    installBridge(() => ({ captionTracks: [{ ...english, kind: 'asr' }] }))
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ events: [
      { tStartMs: 1000, dDurationMs: 800, wWinId: 1, segs: [{ utf8: 'Hello' }] },
      { tStartMs: 1800, dDurationMs: 1200, wWinId: 1, aAppend: 1, segs: [{ utf8: 'world.' }] },
    ] })))

    expect((await fetchYouTubeCues(videoId))?.cues).toEqual([cue])
  })

  it('按实际字幕时间整理滚动轨中交错的片段', async () => {
    installBridge(() => ({ captionTracks: [{ ...english, kind: 'asr' }] }))
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ events: [
      { tStartMs: 1000, dDurationMs: 5200, wWinId: 1, aAppend: 1, segs: [
        { utf8: 'First.' }, { utf8: 'Last.', tOffsetMs: 4000 },
      ] },
      { tStartMs: 3500, dDurationMs: 1000, wWinId: 1, segs: [{ utf8: 'Middle.' }] },
    ] })))

    expect((await fetchYouTubeCues(videoId))?.cues).toEqual([
      { start: 1, end: 3.5, text: 'First.' },
      { start: 3.5, end: 4.5, text: 'Middle.' },
      { start: 5, end: 6.2, text: 'Last.' },
    ])
  })
})
