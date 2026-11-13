/** User-configured local services are valid; the browser still requires permission for the host. */
export function parseHttpEndpoint(raw: string, base = false): URL {
  const url = parseUrl(raw)
  if (!url || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash || (base && url.search)) {
    throw new Error('请填写有效的 HTTP(S) 接口地址。')
  }
  return url
}

function parseUrl(raw: string): URL | null {
  try { return new URL(raw) } catch { return null }
}

export async function assertHostPermission(url: URL): Promise<void> {
  const granted = await chrome.permissions.contains({ origins: [`${url.origin}/*`] })
  if (!granted) throw new Error(`缺少对 ${url.origin} 的访问权限，请在设置页保存引擎配置以授予权限`)
}
