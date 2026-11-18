export const FOXMORI_SITE = 'https://foxmori.com'
export const FOXMORI_API = 'https://api.foxmori.com/v1'

export interface FoxmoriGroup { id: number; name: string }
export interface FoxmoriAccount {
  authenticated: boolean
  user?: { id: number; email: string; username: string }
  groups: FoxmoriGroup[]
}
export type FoxmoriBridgeRequest =
  | { kind: 'foxmoriBridge'; action: 'ready' | 'account' }
  | { kind: 'foxmoriBridge'; action: 'createKey'; groupId: number; accountId: number; reconcile?: boolean }

export function isFoxmoriSite(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.origin === FOXMORI_SITE
  } catch { return false }
}
