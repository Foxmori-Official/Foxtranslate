import { DEFAULT_CONFIG, type SubtitlePatch, type SubtitlePreferences } from '../shared/config'
import { protectExtensionUi } from '../shared/trustedEvents'
import { featureCopy } from '../shared/featureCopy'
import { uiCopy } from '../shared/interface'
import { renderSubtitlePreferences, resetSubtitleStyle, SUBTITLE_SETTINGS_CSS } from '../shared/subtitleSettings'
import type { SubtitleDownloadMode } from './subtitleDownload'

export type PlayerState = 'off' | 'loading' | 'ready' | 'empty' | 'error' | 'translateError'
type View = 'main' | 'settings' | 'style' | 'download'
type CopyKey = Parameters<typeof featureCopy>[0]
interface State {
  enabled: boolean
  state: PlayerState
  lang: string
  preferences: SubtitlePreferences
  hotkey: string
}
interface Actions {
  save: (patch: SubtitlePatch) => Promise<void>
  toggleForVideo: () => void
  stopForVideo: () => void
  preview: (preferences: SubtitlePreferences) => void
  download: (mode: SubtitleDownloadMode, progress: (done: number, total: number) => void) => Promise<void>
  openSettings: () => Promise<void>
}

const PLAYER_MENU_CSS = `
:host { display: flex; flex-direction: column; color-scheme: dark; color: #f0f3eb; --caption-surface: #1d2a23; --caption-border: #45534a;
  --caption-muted: #bac8bc; --caption-accent: #a9bf8d; font: 13px/1.4 system-ui, sans-serif; }
:host([hidden]) { display: none !important; }
* { box-sizing: border-box; }
[hidden] { display: none !important; }
.panel { display: flex; flex-direction: column; min-height: 0; overflow: hidden; background: #1d2a23;
  border: 1px solid #45534a; border-radius: 12px; box-shadow: 0 12px 30px #0006; }
.header { min-height: 46px; display: flex; align-items: center; padding: 7px 8px; gap: 8px;
  border-bottom: 1px solid var(--caption-border); }
.title { min-width: 0; margin: 0; flex: 1; font-size: 14px; font-weight: 650; overflow-wrap: anywhere; }
.icon { width: 28px; height: 28px; flex: none; display: grid; place-items: center; padding: 4px; }
.icon svg, .menu-action svg { width: 16px; height: 16px; flex: none; }
.content { min-height: 0; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; scrollbar-color: #5f7565 transparent; padding: 5px 8px 8px; }
button { border: 0; border-radius: 6px; background: transparent; color: inherit; font: inherit; cursor: pointer; }
button:hover { background: #34463a; }
button:focus-visible, select:focus-visible, input:focus-visible { outline: 2px solid var(--caption-accent); outline-offset: 1px; }
button:disabled { opacity: .55; cursor: wait; }
.menu-action { display: flex; width: 100%; align-items: center; gap: 9px; min-height: 36px; padding: 7px 8px; text-align: start; }
.menu-action > span:first-of-type { flex: 1; overflow-wrap: anywhere; }
.menu-action + .menu-action { margin-top: 2px; }
.menu-scope { margin: 6px 8px 2px; color: var(--caption-muted); font-size: 12px; font-weight: 600; }
.menu-tail { color: var(--caption-muted); }
.toggle-track { flex: none; width: 31px; height: 17px; border-radius: 100px; background: #68766b; position: relative; }
.toggle-track::after { content: ''; position: absolute; inset: 3px auto 3px 3px; width: 11px; border-radius: 50%; background: #f4f6ef; }
[aria-checked="true"] .toggle-track { background: #a9bf8d; }
[aria-checked="true"] .toggle-track::after { transform: translateX(14px); background: #1d2a23; }
.status, .hint { margin: 6px 8px; color: var(--caption-muted); font-size: 12px; }
.status:empty { display: none; }
.reset { font-size: 12px; padding: 5px; }
kbd { padding: 1px 4px; border: 1px solid #65766b; border-radius: 4px; font: inherit; font-size: 11px; color: var(--caption-muted); }
`
const ICONS = {
  close: 'M6 6l12 12M18 6L6 18',
  back: 'M14 6l-6 6 6 6',
  next: 'M9 6l6 6-6 6',
  captions: 'M3 5h18v14H3zM6 13h4m2 0h6M6 16h6m2 0h4',
  clock: 'M12 8v4l3 2m6-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  download: 'M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5',
  settings: 'M4 7h16M4 17h16M9 4v6m6 4v6',
  hide: 'M3 12s3-6 9-6 9 6 9 6-3 6-9 6-9-6-9-6Zm3 8L18 4',
  external: 'M14 4h6v6m0-6-9 9m8 0v7H4V5h7',
} as const

function icon(name: keyof typeof ICONS): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('width', '16')
  svg.setAttribute('height', '16')
  svg.setAttribute('aria-hidden', 'true')
  const path = document.createElementNS(svg.namespaceURI, 'path')
  path.setAttribute('d', ICONS[name])
  path.setAttribute('stroke', 'currentColor')
  path.setAttribute('fill', 'none')
  path.setAttribute('stroke-width', '1.6')
  path.setAttribute('stroke-linecap', 'round')
  path.setAttribute('stroke-linejoin', 'round')
  svg.append(path)
  return svg
}

export class PlayerControl {
  private button: HTMLButtonElement | null = null
  private quickOff: HTMLButtonElement | null = null
  private host: HTMLDivElement | null = null
  private notice: HTMLDivElement | null = null
  private listeners: AbortController | null = null
  private noticeTimer = 0
  private view: View = 'main'
  private pendingSaves = 0
  private downloading = false
  private downloadStatus = ''
  private state: State = { enabled: false, state: 'off', lang: 'auto', preferences: DEFAULT_CONFIG.subtitles, hotkey: '' }

  constructor(private readonly actions: Actions) {}

  private copy(key: CopyKey): string { return featureCopy(key, this.state.lang) }

  mount(player: HTMLElement): void {
    const controls = player.querySelector('.ytp-right-controls')
    if (!controls || (this.button?.parentElement === controls && this.host?.parentElement === player)) return
    this.destroy()

    const button = document.createElement('button')
    button.className = 'ytp-button foxtranslate-caption-button'
    button.type = 'button'
    button.setAttribute('translate', 'no')
    button.setAttribute('data-tv-owned', '1')
    button.setAttribute('aria-haspopup', 'dialog')
    button.style.cssText = 'width:44px!important;border:0;background:transparent;vertical-align:top;position:relative;'
    const logo = document.createElement('img')
    logo.src = chrome.runtime.getURL('icons/icon48.png')
    logo.alt = ''
    logo.width = logo.height = 28
    logo.draggable = false
    logo.style.cssText = 'position:absolute;inset:0;display:block;width:28px;height:28px;margin:auto;object-fit:contain;pointer-events:none;'
    const badge = document.createElement('span')
    badge.className = 'foxtranslate-caption-state'
    badge.setAttribute('aria-hidden', 'true')
    badge.style.cssText = 'position:absolute;right:0;bottom:3px;min-width:22px;padding:2px 3px;border-radius:4px;font:700 8px/1 system-ui;text-align:center;pointer-events:none;'
    button.append(logo, badge)

    const quickOff = document.createElement('button')
    quickOff.className = 'ytp-button foxtranslate-caption-off'
    quickOff.type = 'button'
    quickOff.setAttribute('data-tv-owned', '1')
    quickOff.style.cssText = 'width:30px!important;border:0;color:#f2f5ed;background:transparent;vertical-align:top;'
    quickOff.append(icon('close'))

    const host = document.createElement('div')
    host.className = 'foxtranslate-caption-menu-host'
    host.id = 'foxtranslate-caption-menu'
    host.setAttribute('data-tv-owned', '1')
    host.setAttribute('translate', 'no')
    host.style.cssText = 'position:absolute;right:12px;bottom:56px;width:min(300px,calc(100% - 24px));max-height:calc(100% - 68px);z-index:70;'
    host.attachShadow({ mode: 'open' })
    protectExtensionUi(host.shadowRoot!)
    host.hidden = true
    button.setAttribute('aria-controls', host.id)

    const notice = document.createElement('div')
    notice.className = 'foxtranslate-caption-status'
    notice.setAttribute('data-tv-owned', '1')
    notice.setAttribute('role', 'status')
    notice.style.cssText = 'position:absolute;left:14px;bottom:54px;z-index:61;max-width:min(360px,72%);padding:8px 12px;border-radius:8px;background:#26392e;color:#fff;font:13px/1.4 system-ui;pointer-events:none;'
    notice.hidden = true

    this.button = button
    this.quickOff = quickOff
    this.host = host
    this.notice = notice
    controls.prepend(button, quickOff)
    player.append(host, notice)
    this.listeners = new AbortController()
    const { signal } = this.listeners
    button.addEventListener('click', event => {
      if (!event.isTrusted) return
      event.stopPropagation()
      if (host.hidden) {
        this.view = 'main'
        this.render(true)
        host.hidden = false
        notice.hidden = true
        this.updateButtons()
        this.focusPanel()
      } else {
        this.close(true)
      }
    }, { signal })
    quickOff.addEventListener('click', event => {
      if (!event.isTrusted) return
      event.stopPropagation()
      this.actions.stopForVideo()
      this.close(true)
    }, { signal })
    host.addEventListener('click', event => event.stopPropagation(), { signal })
    host.addEventListener('keydown', event => event.stopPropagation(), { signal })
    document.addEventListener('pointerdown', event => {
      if (!host.hidden && !event.composedPath().includes(host) && !event.composedPath().includes(button) && !event.composedPath().includes(quickOff)) this.close(false)
    }, { signal, capture: true })
    document.addEventListener('keydown', event => {
      if (host.hidden || event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      this.close(true)
    }, { signal, capture: true })
    this.updateButtons()
  }

  update(next: State): void {
    const previous = this.state
    this.state = next
    this.updateButtons()
    if (this.host && !this.host.hidden) {
      if (this.view === 'main' && (previous.enabled !== next.enabled || previous.state !== next.state || previous.preferences.youtube !== next.preferences.youtube || previous.preferences.enabled !== next.preferences.enabled || previous.lang !== next.lang)) this.render(true)
    } else if (previous.state !== next.state && next.state !== 'off') {
      this.showNotice(uiCopy(this.statusKey(), next.lang))
    }
  }

  private statusKey() {
    return ({
      off: 'ytOff', loading: 'ytLoading', ready: 'ytReady', empty: 'ytEmpty',
      error: 'ytError', translateError: 'ytRetry',
    } as const)[this.state.state]
  }

  private updateButtons(): void {
    if (!this.button || !this.quickOff) return
    const label = 'Foxtranslate · ' + this.copy('captionMenu')
    this.button.title = label
    this.button.setAttribute('aria-label', label)
    this.button.setAttribute('aria-description', uiCopy(this.statusKey(), this.state.lang))
    this.button.setAttribute('aria-expanded', String(this.host?.hidden === false))
    this.button.dataset.state = this.state.state
    this.button.dataset.enabled = String(this.state.enabled)
    const badge = this.button.querySelector<HTMLElement>('.foxtranslate-caption-state')
    const status = this.state.enabled ? 'ON' : 'OFF'
    if (badge && badge.textContent !== status) {
      badge.textContent = status
      badge.style.backgroundColor = this.state.enabled ? '#a9bf8d' : '#343434'
      badge.style.color = this.state.enabled ? '#1d2a23' : '#fff'
    }
    const off = this.copy('quickOff')
    this.quickOff.title = off
    this.quickOff.setAttribute('aria-label', off)
    this.quickOff.hidden = !this.state.enabled
    this.quickOff.style.display = this.state.enabled ? 'inline-block' : 'none'
  }

  private showNotice(message: string): void {
    if (!this.notice) return
    this.notice.textContent = message
    this.notice.hidden = false
    window.clearTimeout(this.noticeTimer)
    this.noticeTimer = window.setTimeout(() => { if (this.notice) this.notice.hidden = true }, 5000)
  }

  private focusPanel(): void {
    this.host?.shadowRoot?.querySelector<HTMLElement>('.title')?.focus()
  }

  private close(restoreFocus: boolean): void {
    if (this.host) this.host.hidden = true
    this.actions.preview(this.state.preferences)
    this.updateButtons()
    if (restoreFocus) this.button?.focus()
  }

  resetForVideo(): void {
    this.downloadStatus = ''
    this.close(false)
  }

  private changeView(view: View): void {
    this.view = view
    this.render()
    this.focusPanel()
  }

  private save(patch: SubtitlePatch, onSuccess?: () => void): void {
    this.pendingSaves++
    void this.actions.save(patch).then(() => onSuccess?.()).catch(error => {
      this.actions.preview(this.state.preferences)
      this.showNotice(uiCopy('saveFailed', this.state.lang) + ' ' + (error instanceof Error ? error.message : String(error)))
      if (this.host && !this.host.hidden) this.render(true)
    }).finally(() => { this.pendingSaves-- })
  }

  private render(preserveFocus = false): void {
    const shadow = this.host?.shadowRoot
    if (!shadow) return
    const focused = preserveFocus ? (shadow.activeElement as HTMLElement | null)?.dataset.control : undefined
    const style = document.createElement('style')
    style.textContent = PLAYER_MENU_CSS + SUBTITLE_SETTINGS_CSS
    const panel = document.createElement('div')
    panel.className = 'panel'
    panel.setAttribute('role', 'dialog')
    panel.setAttribute('aria-labelledby', 'ft-caption-title')
    const header = document.createElement('header')
    header.className = 'header'
    const iconButton = (key: CopyKey, glyph: keyof typeof ICONS, action: () => void) => {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'icon'
      button.setAttribute('aria-label', this.copy(key))
      button.title = this.copy(key)
      button.append(icon(glyph))
      button.addEventListener('click', action)
      return button
    }
    const back: View = this.view === 'style' ? 'settings' : 'main'
    if (this.view !== 'main') header.append(iconButton('back', 'back', () => this.changeView(back)))
    const title = document.createElement('h2')
    title.className = 'title'
    title.id = 'ft-caption-title'
    title.tabIndex = -1
    title.textContent = this.copy(({ main: 'captionMenu', settings: 'captionSettings', style: 'captionStyle', download: 'download' } as const)[this.view])
    header.append(title)
    if (this.view === 'style') {
      const reset = document.createElement('button')
      reset.type = 'button'
      reset.className = 'reset'
      reset.dataset.control = 'reset'
      reset.textContent = this.copy('reset')
      reset.addEventListener('click', () => this.save(resetSubtitleStyle(), () => this.render(true)))
      header.append(reset)
    }
    header.append(iconButton('closeMenu', 'close', () => this.close(true)))
    const body = document.createElement('div')
    body.className = 'content'
    panel.append(header, body)
    const menuAction = (id: CopyKey, glyph: keyof typeof ICONS, action: () => void, tail?: HTMLElement | SVGSVGElement) => {
      const button = document.createElement('button')
      const label = document.createElement('span')
      button.type = 'button'
      button.className = 'menu-action'
      button.dataset.control = id
      label.textContent = this.copy(id)
      button.append(icon(glyph), label)
      if (tail) button.append(tail)
      button.addEventListener('click', action)
      body.append(button)
      return button
    }
    const text = (content: string, className: string) => {
      const p = document.createElement('p')
      p.className = className
      p.textContent = content
      body.append(p)
      return p
    }
    const { enabled, preferences, hotkey, lang } = this.state
    if (this.view === 'main') {
      text(this.copy('captionThisVideo'), 'menu-scope')
      const key = hotkey ? document.createElement('kbd') : undefined
      if (key) key.textContent = hotkey
      menuAction(enabled ? 'sessionOff' : 'sessionOn', 'clock', () => {
        this.actions.toggleForVideo()
        this.close(true)
      }, key)
      menuAction('download', 'download', () => this.changeView('download'), icon('next'))
      if (enabled) text(uiCopy(this.statusKey(), lang), 'status').setAttribute('role', 'status')

      text(this.copy('captionGlobal'), 'menu-scope')
      const track = document.createElement('span')
      track.className = 'toggle-track'
      track.setAttribute('aria-hidden', 'true')
      const auto = preferences.enabled && preferences.youtube
      const toggle = menuAction('enableCaptions', 'captions', () => {
        if (!this.pendingSaves) this.save(auto ? { youtube: false } : { enabled: true, youtube: true })
      }, track)
      toggle.setAttribute('role', 'switch')
      toggle.setAttribute('aria-checked', String(auto))
      menuAction('captionSettings', 'settings', () => this.changeView('settings'), icon('next'))
    } else if (this.view === 'download') {
      text(this.copy('downloadHint'), 'hint')
      for (const [mode, key] of [['original', 'downloadOriginal'], ['bilingual', 'downloadBilingual'], ['translation', 'downloadTranslation']] as const) {
        const button = menuAction(key, 'download', () => this.download(mode))
        button.disabled = this.downloading
      }
      text(this.downloadStatus, 'status download-status').setAttribute('role', 'status')
    } else {
      text(this.copy('captionGlobalHint'), 'hint')
      body.append(renderSubtitlePreferences({
        lang, preferences,
        onChange: patch => this.save(patch),
        onPreview: this.actions.preview,
        includeDisplay: this.view === 'settings',
        includeStyle: this.view === 'style',
      }))
      if (this.view === 'settings') {
        menuAction('captionStyle', 'settings', () => this.changeView('style'), icon('next'))
        menuAction('hideShortcut', 'hide', () => {
          if (!this.pendingSaves) this.save({ showShortcut: false })
        })
        text(this.copy('shortcutHint'), 'hint')
        menuAction('moreSettings', 'external', () => {
          this.close(true)
          void this.actions.openSettings().catch(() => this.showNotice(uiCopy('saveFailed', lang)))
        })
      }
    }
    shadow.replaceChildren(style, panel)
    if (focused) {
      const target = Array.from(shadow.querySelectorAll<HTMLElement>('[data-control]')).find(control => control.dataset.control === focused)
      if (target) target.focus()
      else this.focusPanel()
    }
  }

  private download(mode: SubtitleDownloadMode): void {
    if (this.downloading) return
    this.downloading = true
    this.downloadStatus = this.copy('downloading')
    this.render(true)
    const progress = (done: number, total: number) => {
      this.downloadStatus = this.copy('downloading') + ' ' + done + '/' + total
      const status = this.host?.shadowRoot?.querySelector('.download-status')
      if (status) status.textContent = this.downloadStatus
    }
    void this.actions.download(mode, progress).then(() => {
      this.downloadStatus = this.copy('downloadReady')
    }).catch(error => {
      this.downloadStatus = error instanceof Error ? error.message : String(error)
    }).finally(() => {
      this.downloading = false
      if (this.view === 'download' && this.host && !this.host.hidden) this.render(true)
    })
  }

  destroy(): void {
    this.listeners?.abort()
    this.listeners = null
    window.clearTimeout(this.noticeTimer)
    this.button?.remove()
    this.quickOff?.remove()
    this.host?.remove()
    this.notice?.remove()
    this.button = this.quickOff = this.host = this.notice = null
  }
}
