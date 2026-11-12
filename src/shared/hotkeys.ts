// ===== 快捷键匹配 =====
/** e.code → 规格主键名：KeyT→'T'、Digit1→'1'、Space/Enter/F5 等原样。 */
function codeToKeyName(code: string): string {
  if (code.startsWith('Key')) return code.slice(3)
  if (code.startsWith('Digit')) return code.slice(5)
  return code
}

/** e.code 为修饰键本身时返回其名称，否则 null。 */
function modifierOfCode(code: string): 'alt' | 'ctrl' | 'shift' | 'meta' | null {
  if (code === 'AltLeft' || code === 'AltRight') return 'alt'
  if (code === 'ControlLeft' || code === 'ControlRight') return 'ctrl'
  if (code === 'ShiftLeft' || code === 'ShiftRight') return 'shift'
  if (code === 'MetaLeft' || code === 'MetaRight') return 'meta'
  return null
}

/**
 * 匹配快捷键规格（如 'Alt+T'、'Ctrl+Shift+D'、'Alt'）。
 * - 空串 = 禁用，永不命中。
 * - 修饰键 Alt/Ctrl/Shift/Meta 必须与事件严格一致（多按少按都不命中）。
 * - 主键按 e.code 匹配：KeyT→'T'、Digit1→'1'、Space→'Space'，大小写不敏感。
 * - 仅修饰键规格（如 'Alt'）：只在按下该修饰键本身时命中，Alt+A 不命中。
 * - Mac 上 Meta 与 Ctrl 等价：规格写 Ctrl 时按 Cmd（metaKey）同样命中，反之亦然，
 *   避免同一份配置跨平台失效。
 */
export function matchHotkey(e: KeyboardEvent, spec: string): boolean {
  const parts = spec
    .split('+')
    .map((s) => s.trim())
    .filter(Boolean)
  if (!parts.length) return false

  const want = { alt: false, ctrl: false, shift: false, meta: false }
  let mainKey = ''
  for (const part of parts) {
    const p = part.toLowerCase()
    if (p === 'alt') want.alt = true
    else if (p === 'ctrl' || p === 'control') want.ctrl = true
    else if (p === 'shift') want.shift = true
    else if (p === 'meta' || p === 'cmd' || p === 'command') want.meta = true
    else mainKey = part
  }

  // Mac 等价：Ctrl 与 Meta 任一声明即接受任一键按下
  const wantCtrlOrMeta = want.ctrl || want.meta
  const eventCtrlOrMeta = e.ctrlKey || e.metaKey
  if (e.altKey !== want.alt) return false
  if (eventCtrlOrMeta !== wantCtrlOrMeta) return false
  if (e.shiftKey !== want.shift) return false

  if (!mainKey) {
    // 仅修饰键规格：事件主键必须是已声明的修饰键本身
    const mod = modifierOfCode(e.code)
    if (!mod) return false
    if (mod === 'ctrl' || mod === 'meta') return wantCtrlOrMeta
    return want[mod]
  }
  return codeToKeyName(e.code).toLowerCase() === mainKey.toLowerCase()
}
