import type { Engine } from './types'
import { getFetch, httpError } from './fetch'

const TRANSLATE_URL = 'https://edge.microsoft.com/translate/translatetext'

/**
 * 语言码映射：Bing 用 zh-Hans/zh-Hant 区分简繁；其余语言用主码（en-US→en）。
 * 'auto' 由调用方处理（自动检测时 from 留空）。
 */
export function toBingLang(code: string): string {
  const c = code.trim().toLowerCase()
  if (c === 'zh' || c.startsWith('zh-') || c.startsWith('zh_')) {
    return /tw|hk|mo|hant/.test(c) ? 'zh-Hant' : 'zh-Hans'
  }
  return c.split('-')[0]
}

interface BingItem {
  translations?: Array<{ text?: string }>
  detectedLanguage?: { language?: string }
}

export const bingEngine: Engine = {
  id: 'bing',
  name: 'Microsoft Translator (free)',
  kind: 'free',
  maxTextLength: 5000,

  async translate(text, from, to, _ctx, signal) {
    const params = new URLSearchParams({
      from: from === 'auto' ? '' : toBingLang(from),
      to: toBingLang(to),
      isEnterpriseClient: 'false',
    })
    const res = await getFetch()(`${TRANSLATE_URL}?${params.toString()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([text]),
      credentials: 'omit',
      redirect: 'error',
      signal,
    })
    if (!res.ok) throw httpError('bing', res)
    const data = (await res.json()) as unknown
    // 坑（OpenImmersive 2.3）：微软系端点会把业务错误裹在 HTTP 200 里返回对象而非数组
    // （如 {"statusCode":400,...}），必须校验形状再取字段。
    if (!Array.isArray(data)) {
      throw new Error('bing: business error hidden in HTTP 200 (non-array response)')
    }
    const item = data[0] as BingItem | undefined
    const translated = item?.translations?.[0]?.text
    if (typeof translated !== 'string') throw new Error('bing: unexpected response shape')
    const detectedLang = item?.detectedLanguage?.language
    return { text: translated, detectedLang }
  },
}
