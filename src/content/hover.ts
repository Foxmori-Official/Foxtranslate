import { findHoverUnit } from './dom'
import { translateElement } from './page'
import type { PageConfig } from '../shared/pageConfig'
import { isTrustedInteraction } from '../shared/trustedEvents'

const KEYS = { alt: 'Alt', ctrl: 'Control', shift: 'Shift' } as const
let config: PageConfig | null = null
let pointer: { x: number; y: number } | null = null
let target: Element | null = null
let unit: HTMLElement | null = null
let timer: ReturnType<typeof setTimeout> | undefined

function resetHover(): void {
  if (timer !== undefined) clearTimeout(timer)
  timer = undefined
  target = null
  unit = null
}

export function setHoverConfig(next: PageConfig): void {
  if (config?.hover.enabled !== next.hover.enabled || config.hover.key !== next.hover.key) resetHover()
  config = next
}

function hoverAt(nextTarget: Element | null, immediate = false): void {
  if (target === nextTarget) return
  target = nextTarget
  const next = target ? findHoverUnit(target) : null
  if (unit === next) return
  if (timer !== undefined) clearTimeout(timer)
  timer = undefined
  unit = next
  if (!next || next.hasAttribute('data-tv-translated')) return
  const translate = () => {
    timer = undefined
    if (!config?.hover.enabled || !next.isConnected || next.hasAttribute('data-tv-translated') ||
        next.querySelector(':scope > [data-tv-loading]')) return
    void translateElement(next, config)
  }
  if (immediate) translate()
  else timer = setTimeout(translate, 120)
}

export function initHover(initial: PageConfig): void {
  setHoverConfig(initial)
  const onMove = (event: MouseEvent) => {
    if (!isTrustedInteraction(event)) return
    pointer = { x: event.clientX, y: event.clientY }
    if (!config?.hover.enabled || event.buttons) { resetHover(); return }
    const key = config.hover.key
    if (key !== 'none' && !event.getModifierState(KEYS[key])) { resetHover(); return }
    hoverAt(event.target instanceof Element ? event.target : null)
  }
  document.addEventListener('mouseover', onMove, true)
  document.addEventListener('mousemove', onMove, true)
  document.addEventListener('keydown', event => {
    if (!isTrustedInteraction(event) || event.repeat || !config?.hover.enabled || config.hover.key === 'none' ||
        event.key !== KEYS[config.hover.key] || !pointer) return
    if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [data-tv-owned]')) return
    hoverAt(document.elementFromPoint(pointer.x, pointer.y), true)
  }, true)
  document.addEventListener('keyup', event => {
    if (isTrustedInteraction(event) && config && config.hover.key !== 'none' && event.key === KEYS[config.hover.key]) resetHover()
  }, true)
  document.addEventListener('mouseout', event => {
    if (isTrustedInteraction(event) && !event.relatedTarget) { pointer = null; resetHover() }
  }, true)
  document.addEventListener('pointerdown', event => {
    if (isTrustedInteraction(event)) resetHover()
  }, true)
  window.addEventListener('blur', () => { pointer = null; resetHover() })
}
