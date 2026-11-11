import { uiCopy } from './interface'

export function appSidebar(active: 'page' | 'files' | 'review' | 'settings' | 'privacy', lang: string): HTMLElement {
  const sidebar = document.createElement('aside')
  sidebar.className = 'fox-sidebar'
  const brand = document.createElement('a')
  brand.className = 'fox-brand'
  brand.href = 'https://foxmori.com'
  brand.target = '_blank'
  brand.rel = 'noopener noreferrer'
  const logo = document.createElement('img')
  logo.src = chrome.runtime.getURL('icons/icon48.png')
  logo.alt = ''
  logo.width = logo.height = 36
  const name = document.createElement('span')
  name.textContent = 'Foxtranslate'
  brand.append(logo, name)
  const nav = document.createElement('nav')
  nav.className = 'fox-nav'
  nav.setAttribute('aria-label', 'Foxtranslate')
  const routes = {
    page: 'popup.html',
    files: 'files.html',
    review: 'review.html',
    settings: 'options.html',
  } as const
  for (const [key, path] of Object.entries(routes)) {
    if (key === 'page' && active !== 'page') continue
    const link = document.createElement('a')
    link.href = chrome.runtime.getURL(path)
    link.textContent = uiCopy(key as keyof typeof routes, lang)
    if (key === active) link.setAttribute('aria-current', 'page')
    if (key !== active) link.target = '_blank'
    link.rel = 'noopener noreferrer'
    nav.append(link)
  }
  const help = document.createElement('a')
  help.className = 'fox-help'
  help.href = chrome.runtime.getURL('onboarding.html')
  help.target = '_blank'
  help.rel = 'noopener noreferrer'
  help.textContent = uiCopy('guide', lang)
  sidebar.append(brand, nav, help)
  return sidebar
}
