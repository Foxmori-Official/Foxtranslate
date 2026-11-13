/** Page scripts share the DOM with content scripts, but cannot forge trusted input. */
export function isTrustedInteraction(event: Event): boolean {
  return event.isTrusted
}

export function protectExtensionUi(root: EventTarget): void {
  let origin: Element | null = null
  for (const type of ['click', 'change', 'input', 'keydown', 'keyup', 'mousedown', 'mouseup', 'pointerdown', 'pointerup']) {
    root.addEventListener(type, event => {
      const element = event.target instanceof Element ? event.target : null
      const control = element?.closest('button,input,select,textarea,label') ?? element
      if (isTrustedInteraction(event) && (type === 'pointerdown' || type === 'keydown')) {
        origin = control instanceof HTMLLabelElement ? control.control : control
      }
      // Synthetic click can cause a browser-generated trusted input/change on checkboxes.
      // Invalidate the input origin even for noncancelable events before their default action.
      if (!isTrustedInteraction(event)) origin = null
      if (!isTrustedInteraction(event) || (['click', 'input', 'change'].includes(type) && control !== origin)) {
        event.preventDefault()
        event.stopImmediatePropagation()
      }
    }, true)
  }
}
