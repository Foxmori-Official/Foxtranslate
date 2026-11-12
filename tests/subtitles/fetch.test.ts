// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

const captions = JSON.stringify({ events: [{ tStartMs: 1000, dDurationMs: 2000, segs: [{ utf8: 'Hello world.' }] }] })

function installBridge(cachedUrl: string | null): void {
  vi.spyOn(window, 'postMessage').mockImplementation(message => {
    const response = message.action === 'playerData'
      ? { videoId: 'fixture', captionTracks: [{ baseUrl: 'https://www.youtube.com/direct', languageCode: 'en' }], cachedTimedtextUrl: cachedUrl }
      : { url: 'https://www.youtube.com/captured' }
    window.dispatchEvent(new MessageEvent('message', {
      source: window,
      data: { type: 'tv-yt-bridge-response', requestId: message.requestId, ok: true, ...response },
    }))
  })
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('YouTube 字幕读取', () => {
  it('优先复用播放器已捕获的授权字幕地址', async () => {
    vi.resetModules()
    installBridge('https://www.youtube.com/captured')
    const fetch = vi.fn(async (_url: RequestInfo | URL) => new Response(captions))
    vi.stubGlobal('fetch', fetch)
    const { fetchYouTubeCues } = await import('../../src/subtitles/ytFetch')
    expect(await fetchYouTubeCues('fixture')).toEqual([{ start: 1, end: 3, text: 'Hello world.' }])
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(String(fetch.mock.calls[0][0])).toContain('/captured?fmt=json3')
  })

  it('原始地址卡住时会中止请求并尝试播放器捕获的地址', async () => {
    vi.resetModules()
    vi.useFakeTimers()
    installBridge(null)
    const fetch = vi.fn((url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      if (String(url).includes('/captured')) return Promise.resolve(new Response(captions))
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
      })
    })
    vi.stubGlobal('fetch', fetch)
    const { fetchYouTubeCues } = await import('../../src/subtitles/ytFetch')
    const request = fetchYouTubeCues('fixture')
    await vi.advanceTimersByTimeAsync(4001)
    expect(await request).toEqual([{ start: 1, end: 3, text: 'Hello world.' }])
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(fetch.mock.calls[0][1]?.signal?.aborted).toBe(true)
  })
})
