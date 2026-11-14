export const RELEASES_URL = 'https://github.com/Foxmori-Official/Foxtranslate/releases'
const LATEST_API = 'https://api.github.com/repos/Foxmori-Official/Foxtranslate/releases/latest'
const VERSION = /^(?:0|[1-9]\d{0,4})(?:\.(?:0|[1-9]\d{0,4})){0,3}$/

function parts(value: string): number[] {
  const numbers = VERSION.test(value) ? value.split('.').map(Number) : []
  if (!numbers.some(Boolean) || numbers.some(number => number > 65535)) {
    throw new Error('Invalid extension version')
  }
  return numbers
}

export async function checkLatestRelease(installed: string): Promise<{ version: string; status: 'available' | 'current' | 'ahead'; url: string }> {
  const current = parts(installed)
  const response = await fetch(LATEST_API, {
    credentials: 'omit',
    redirect: 'error',
    referrerPolicy: 'no-referrer',
    cache: 'no-store',
    headers: { Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error('Could not query GitHub Releases')
  const release = await response.json()
  if (release?.draft !== false || release.prerelease !== false || typeof release.tag_name !== 'string' || !release.tag_name.startsWith('v')) {
    throw new Error('Invalid GitHub release')
  }
  const version = release.tag_name.slice(1)
  const latest = parts(version)
  let status: 'available' | 'current' | 'ahead' = 'current'
  for (let index = 0; index < 4; index++) {
    const difference = (latest[index] ?? 0) - (current[index] ?? 0)
    if (difference) {
      status = difference > 0 ? 'available' : 'ahead'
      break
    }
  }
  return { version, status, url: RELEASES_URL + '/tag/v' + version }
}
