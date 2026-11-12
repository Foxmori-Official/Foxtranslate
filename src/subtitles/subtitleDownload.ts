import type { BgResponse } from '../shared/protocol'
import { featureCopy } from '../shared/featureCopy'
import type { SubtitleCue } from './types'

export type SubtitleDownloadMode = 'original' | 'bilingual' | 'translation'

function timestamp(seconds: number): string {
  const millis = Math.max(0, Math.round(seconds * 1000))
  const whole = Math.floor(millis / 1000)
  const pad = (value: number) => String(value).padStart(2, '0')
  return [
    pad(Math.floor(whole / 3600)),
    pad(Math.floor(whole / 60) % 60),
    pad(whole % 60),
  ].join(':') + ',' + String(millis % 1000).padStart(3, '0')
}

export function toSubtitleSrt(cues: SubtitleCue[], mode: SubtitleDownloadMode, translationAbove: boolean): string {
  return cues.map((cue, index) => {
    const translation = cue.translation ?? ''
    const lines = mode === 'original' ? [cue.text]
      : mode === 'translation' ? [translation]
      : translationAbove ? [translation, cue.text] : [cue.text, translation]
    const caption = lines.join('\n').replace(/\r\n/g, '\n').replace(/\n\n+/g, '\n')
    return [String(index + 1), timestamp(cue.start) + ' --> ' + timestamp(cue.end), caption].join('\n')
  }).join('\n\n') + '\n'
}

export async function downloadSubtitles({
  cues, videoId, targetLang, uiLang, mode, translationAbove, isCurrent, progress,
}: {
  cues: SubtitleCue[]
  videoId: string
  targetLang: string
  uiLang: string
  mode: SubtitleDownloadMode
  translationAbove: boolean
  isCurrent: () => boolean
  progress: (done: number, total: number) => void
}): Promise<void> {
  const checkVideo = () => {
    if (!isCurrent()) throw new Error(featureCopy('videoChanged', uiLang))
  }
  checkVideo()
  const data = cues.filter(cue => Number.isFinite(cue.start) && Number.isFinite(cue.end) && cue.end > cue.start && cue.text.trim())
    .map(cue => ({ ...cue }))
  if (!data.length) throw new Error(featureCopy('noTrack', uiLang))
  if (mode !== 'original') {
    const pending = data.filter(cue => !cue.translation)
    let done = data.length - pending.length
    progress(done, data.length)
    for (let i = 0; i < pending.length; i += 12) {
      checkVideo()
      const batch = pending.slice(i, i + 12)
      const result = await chrome.runtime.sendMessage({
        kind: 'translateBatch', texts: batch.map(cue => cue.text), targetLang,
      }) as BgResponse<string[]> | undefined
      checkVideo()
      if (!result?.ok || !Array.isArray(result.data) || result.data.length !== batch.length || result.data.some(item => typeof item !== 'string' || !item.trim())) {
        throw new Error(featureCopy('downloadFailed', uiLang))
      }
      batch.forEach((cue, index) => { cue.translation = result.data[index] })
      done += batch.length
      progress(done, data.length)
    }
  }
  checkVideo()
  const file = new Blob([toSubtitleSrt(data, mode, translationAbove)], { type: 'application/x-subrip;charset=utf-8' })
  const url = URL.createObjectURL(file)
  const link = document.createElement('a')
  link.href = url
  link.download = 'foxtranslate-' + videoId.replace(/[^a-z0-9_-]/gi, '') + '-' + mode + '.srt'
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
}
