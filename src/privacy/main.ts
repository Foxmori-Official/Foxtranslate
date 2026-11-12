/// <reference types="vite/client" />
import policy from '../../PRIVACY.md?raw'
import { appSidebar } from '../shared/appShell'
import type { Config } from '../shared/config'
import { featureCopy } from '../shared/featureCopy'
import { resolveUiLang } from '../shared/i18n'
import { uiCopy } from '../shared/interface'
import type { BgResponse } from '../shared/protocol'

type Language = 'zh-CN' | 'en'

function element<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (text) node.textContent = text
  return node
}

function appendInline(parent: HTMLElement, text: string): void {
  let offset = 0
  const tokens = /\x60([^\x60]+)\x60|\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/g
  for (const match of text.matchAll(tokens)) {
    parent.append(text.slice(offset, match.index))
    if (match[1]) {
      parent.append(element('code', match[1]))
    } else {
      const link = element('a', match[2])
      link.href = match[3]
      link.target = '_blank'
      link.rel = 'noopener noreferrer'
      parent.append(link)
    }
    offset = match.index + match[0].length
  }
  parent.append(text.slice(offset))
}

function renderPolicy(content: HTMLElement, body: string): void {
  for (const block of body.trim().split(/\n\s*\n/)) {
    if (block.startsWith('### ')) {
      content.append(element('h2', block.slice(4)))
    } else if (block.startsWith('- ')) {
      const list = element('ul')
      for (const line of block.split('\n')) {
        const item = element('li')
        appendInline(item, line.replace(/^- /, ''))
        list.append(item)
      }
      content.append(list)
    } else {
      const paragraph = element('p')
      appendInline(paragraph, block)
      content.append(paragraph)
    }
  }
}

async function pageLanguage(): Promise<Language> {
  const explicit = new URL(location.href).searchParams.get('lang')
  if (explicit === 'zh-CN' || explicit === 'en') return explicit
  let lang = 'auto'
  try {
    const response = await chrome.runtime.sendMessage({ kind: 'getConfig' }) as BgResponse<Config>
    if (response.ok) lang = response.data.uiLang
  } catch {
    // The bundled policy can be read before the service worker is ready.
  }
  return resolveUiLang(lang).startsWith('zh') ? 'zh-CN' : 'en'
}

async function init(): Promise<void> {
  const app = document.getElementById('app')
  if (!app) return
  const lang = await pageLanguage()
  const [intro, chinese, english] = policy.split(/^## (?:中文|English)\s*$/m)
  const date = intro.match(/\d{4}-\d{2}-\d{2}/)?.[0]

  document.documentElement.lang = lang
  document.title = `${uiCopy('privacy', lang)} · Foxtranslate`
  app.className = 'fox-shell'
  const content = element('main')
  content.className = 'wrap fox-main'
  const settings = element('a', featureCopy('backToPrivacySettings', lang))
  settings.className = 'privacy-back'
  settings.href = chrome.runtime.getURL('options.html#privacy')
  const langs = element('nav')
  langs.className = 'lang-switch'
  langs.setAttribute('aria-label', lang === 'zh-CN' ? '政策语言' : 'Policy language')
  for (const [id, name] of [['zh-CN', '简体中文'], ['en', 'English']] as const) {
    const link = element('a', name)
    link.href = '?lang=' + id
    link.hreflang = link.lang = id
    if (id === lang) link.setAttribute('aria-current', 'page')
    langs.append(link)
  }
  content.append(settings, element('h1', uiCopy('privacy', lang)), langs)
  if (date) {
    const updated = element('p', (lang === 'zh-CN' ? '生效日期 ' : 'Effective date ') + date)
    updated.className = 'updated'
    content.append(updated)
  }
  renderPolicy(content, lang === 'zh-CN' ? chinese : english)
  app.append(appSidebar('privacy', lang), content)
}

void init()
