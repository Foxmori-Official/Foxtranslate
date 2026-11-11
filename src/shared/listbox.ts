/** Keyboard and viewport behavior for the extension's existing visual pickers. */
export function bindListbox(
  wrap: HTMLElement,
  trigger: HTMLButtonElement,
  list: HTMLElement,
): { close: () => void } {
  const id = `fox-listbox-${crypto.randomUUID()}`
  list.id = id
  list.tabIndex = -1
  trigger.setAttribute('aria-controls', id)
  trigger.setAttribute('aria-expanded', 'false')
  let index = 0
  const options = () => Array.from(list.querySelectorAll<HTMLElement>('[role="option"]'))

  function highlight(next: number): void {
    const items = options()
    if (!items.length) return
    index = (next + items.length) % items.length
    items.forEach((item, i) => {
      item.id = `${id}-${i}`
      item.classList.toggle('is-focused', i === index)
    })
    list.setAttribute('aria-activedescendant', items[index].id)
    items[index].scrollIntoView?.({ block: 'nearest' })
  }

  function outside(event: Event): void {
    if (!wrap.contains(event.target as Node)) close()
  }

  function close(): void {
    wrap.classList.remove('open')
    trigger.setAttribute('aria-expanded', 'false')
    document.removeEventListener('pointerdown', outside, true)
  }

  function open(last = false): void {
    wrap.classList.add('open')
    trigger.setAttribute('aria-expanded', 'true')
    const box = trigger.getBoundingClientRect()
    const below = innerHeight - box.bottom - 8
    const above = box.top - 8
    const upwards = below < 160 && above > below
    list.style.position = 'fixed'
    list.style.width = `${Math.min(Math.max(box.width, 180), innerWidth - 16)}px`
    list.style.left = `${Math.max(8, Math.min(box.left, innerWidth - parseFloat(list.style.width) - 8))}px`
    list.style.right = 'auto'
    list.style.top = upwards ? 'auto' : `${box.bottom + 4}px`
    list.style.bottom = upwards ? `${innerHeight - box.top + 4}px` : 'auto'
    list.style.maxHeight = `${Math.max(80, Math.min(240, upwards ? above : below))}px`
    list.style.zIndex = '1000'
    document.addEventListener('pointerdown', outside, true)
    const selected = options().findIndex(item => item.getAttribute('aria-selected') === 'true')
    highlight(last ? options().length - 1 : Math.max(0, selected))
    list.focus()
  }

  trigger.addEventListener('click', () => {
    if (wrap.classList.contains('open')) close()
    else open()
  })
  trigger.addEventListener('keydown', event => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    open(event.key === 'ArrowUp')
  })
  list.addEventListener('click', () => {
    close()
    if (trigger.isConnected) trigger.focus()
  })
  wrap.addEventListener('focusout', event => {
    if (!wrap.contains(event.relatedTarget as Node)) close()
  })
  wrap.addEventListener('keydown', event => {
    if (!wrap.classList.contains('open')) return
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close()
      trigger.focus()
    } else if (event.key === 'Tab') {
      close()
    } else if (event.target === list) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        highlight(index + (event.key === 'ArrowDown' ? 1 : -1))
      } else if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault()
        highlight(event.key === 'Home' ? 0 : options().length - 1)
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        options()[index]?.click()
      } else if (event.key.length === 1) {
        const match = options().findIndex(item => item.textContent?.trim().toLocaleLowerCase().startsWith(event.key.toLocaleLowerCase()))
        if (match >= 0) highlight(match)
      }
    }
  })
  return { close }
}
