import { uiCopy } from './interface'
import { outlineIcon } from './ui/icon'

const ROUTES = [
  { page: 'files', path: 'files.html', icon: 'M6 3h8l4 4v14H6zM14 3v5h4M9 12h6m-6 4h6' },
  { page: 'review', path: 'review.html', icon: 'M7 7h13v13H7zM4 16V4h12m-6 9 2 2 4-4' },
  { page: 'settings', path: 'options.html', icon: 'M4 6h16M4 12h16M4 18h16M8 3v6m8 0v6m-6 0v6' },
] as const

type AppPage = typeof ROUTES[number]['page']

export function appNavigation(active: AppPage | null, lang: string, icons = false): HTMLElement {
  const nav = document.createElement('nav')
  nav.className = icons ? 'fox-nav fox-nav-icons' : 'fox-nav'
  nav.setAttribute('aria-label', 'Foxtranslate')
  for (const { page, path, icon } of ROUTES) {
    const link = document.createElement('a')
    const label = uiCopy(page, lang)
    link.href = chrome.runtime.getURL(path)
    link.dataset.destination = page
    if (icons) {
      link.title = label
      link.setAttribute('aria-label', label)
      link.append(outlineIcon(icon))
    } else {
      link.textContent = label
    }
    if (page === active) link.setAttribute('aria-current', 'page')
    else link.target = '_blank'
    link.rel = 'noopener noreferrer'
    nav.append(link)
  }
  return nav
}

export function appSidebar(active: AppPage | 'privacy', lang: string): HTMLElement {
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
  const help = document.createElement('a')
  help.className = 'fox-help'
  help.href = chrome.runtime.getURL('onboarding.html')
  help.target = '_blank'
  help.rel = 'noopener noreferrer'
  help.textContent = uiCopy('guide', lang)
  sidebar.append(brand, appNavigation(active === 'privacy' ? null : active, lang), help)
  return sidebar
}
