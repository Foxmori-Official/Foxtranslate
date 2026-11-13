import { DEFAULT_CONFIG, type Config } from '../shared/config'
import { FOXMORI_API } from '../shared/foxmori'
import { assertHostPermission, parseHttpEndpoint } from '../shared/endpoint'

export async function fetchProviderModels(config: Config, provider: string, fetcher: typeof fetch = fetch): Promise<string[]> {
  if (provider !== 'foxmori' && provider !== 'openai' && provider !== 'deepseek') {
    throw new Error('此服务暂不支持自动获取模型。')
  }
  const endpoint = provider === 'foxmori'
    ? FOXMORI_API
    : config.engine[provider].endpoint.trim() || DEFAULT_CONFIG.engine[provider].endpoint
  const key = provider === 'foxmori' ? config.engine.keys.foxmori : config.engine.keys.openai
  if (!key.trim()) throw new Error('请先配置 API Key。')

  const url = parseHttpEndpoint(endpoint, true)
  await assertHostPermission(url)
  url.pathname = url.pathname.replace(/\/+$/, '') + '/models'
  const response = await fetcher(url.href, {
    headers: { Authorization: 'Bearer ' + key.trim(), Accept: 'application/json' },
    redirect: 'error',
    credentials: 'omit',
    cache: 'no-store',
    signal: AbortSignal.timeout(config.engine.timeoutMs),
  })
  if (response.status === 401) throw new Error('API Key 无效或已过期，请重新配置。')
  if (response.status === 403) throw new Error('此密钥没有模型访问权限，请检查服务配置或套餐分组。')
  if (!response.ok) throw new Error('模型列表获取失败（HTTP ' + response.status + '），请重试。')

  const payload = await response.json() as { data?: { id?: unknown }[] } | null
  const data = Array.isArray(payload?.data) ? payload.data : []
  const ids = data.map(model => model?.id).filter((id): id is string => typeof id === 'string' && id.trim() !== '')
  const models = [...new Set(ids)].sort()
  if (!models.length) throw new Error('此密钥暂无可用模型，请检查模型访问权限。')
  return models
}
