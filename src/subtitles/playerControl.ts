import { uiCopy } from '../shared/interface'

export type PlayerState = 'off' | 'loading' | 'ready' | 'empty' | 'error'
export class PlayerControl {
  private button: HTMLButtonElement | null = null
  private notice: HTMLElement | null = null
  private noticeTimer = 0
  private state: PlayerState = 'off'
  private enabled = false
  private lang = 'auto'
  private busy = false
  constructor(private onToggle: () => Promise<void>) {}

  mount(player: HTMLElement): void {
    const controls = player.querySelector('.ytp-right-controls')
    if (!controls || this.button?.parentElement === controls) return
    this.button?.remove()
    this.notice?.remove()
    const button = document.createElement('button')
    button.className = 'ytp-button foxtranslate-caption-button'
    button.type = 'button'
    button.textContent = 'FT'
    button.style.cssText = 'width:48px!important;font:700 15px/1 system-ui!important;color:#fff;border:0;background:transparent;vertical-align:top;position:relative;'
    button.addEventListener('click', event => {
      event.stopPropagation()
      if (this.busy) return
      this.busy = true
      this.update(this.enabled, this.state, this.lang)
      void this.onToggle().catch(() => this.update(this.enabled, 'error', this.lang)).finally(() => {
        this.busy = false
        this.update(this.enabled, this.state, this.lang)
      })
    })
    controls.prepend(button)
    this.button = button
    const notice = document.createElement('div')
    notice.className = 'foxtranslate-caption-status'
    notice.setAttribute('role', 'status')
    notice.style.cssText = 'position:absolute;right:16px;bottom:64px;z-index:62;max-width:min(400px,80%);padding:10px 14px;border-radius:8px;background:#293d33;color:#fff;font:13px/1.5 system-ui;pointer-events:none;'
    notice.hidden = true
    player.append(notice)
    this.notice = notice
    this.update(this.enabled, this.state, this.lang)
  }

  update(enabled: boolean, state: PlayerState, lang: string): void {
    const changed = this.state !== state
    this.enabled = enabled
    this.state = state
    this.lang = lang
    if (!this.button) return
    const key = state === 'loading' ? 'ytLoading'
      : state === 'empty' ? 'ytEmpty'
      : state === 'error' ? 'ytError'
      : enabled ? 'ytOn' : 'ytOff'
    const label = 'Foxtranslate · ' + uiCopy(key, lang) + ((state === 'empty' || state === 'error') && enabled ? ' ' + uiCopy('ytOn', lang) : '')
    this.button.title = label
    this.button.setAttribute('aria-label', label)
    this.button.setAttribute('aria-pressed', String(enabled))
    this.button.setAttribute('aria-busy', String(this.busy || state === 'loading'))
    this.button.dataset.state = state
    this.button.style.boxShadow = enabled ? 'inset 0 -3px #8fa66f' : 'none'
    if (changed && this.notice) {
      this.notice.textContent = state === 'ready' ? uiCopy('ytReady', lang) : uiCopy(key, lang)
      this.notice.hidden = false
      window.clearTimeout(this.noticeTimer)
      this.noticeTimer = window.setTimeout(() => { if (this.notice) this.notice.hidden = true }, 7000)
    }
  }

  destroy(): void {
    window.clearTimeout(this.noticeTimer)
    this.button?.remove()
    this.notice?.remove()
    this.button = null
    this.notice = null
  }
}
