import { featureCopy } from './featureCopy'
import { getStyle } from '../core/styles'
import type { Config } from './config'

export function createReadingPreview(config: Config, label: 'readingPreview' | 'stylePreview' = 'readingPreview'): HTMLElement {
  const figure = document.createElement('figure')
  figure.className = 'reading-preview'
  figure.setAttribute('aria-label', featureCopy(label, config.uiLang))
  const bar = document.createElement('div')
  bar.className = 'reading-preview-bar'
  bar.setAttribute('aria-hidden', 'true')
  const brand = document.createElement('img')
  brand.src = chrome.runtime.getURL('icons/icon48.png')
  brand.alt = ''
  brand.width = brand.height = 20
  const rule = document.createElement('span')
  bar.append(rule, brand)
  const article = document.createElement('div')
  article.className = 'reading-preview-article'
  const source = document.createElement('p')
  source.lang = 'en'
  source.textContent = 'Foxtranslate lets you read in two languages.'
  const style = getStyle(config.style.styleId)
  const translation = document.createElement('tv-translation')
  translation.className = 'reading-preview-translation ' + style.className
  translation.lang = 'zh-CN'
  const text = document.createElement('span')
  text.className = 'tv-tr-inner'
  text.textContent = 'Foxtranslate 让你用两种语言阅读。'
  translation.append(text)
  if (style.id === 'blur-mask') {
    translation.tabIndex = 0
    translation.title = featureCopy('previewReveal', config.uiLang)
  }
  if (config.general.displayMode === 'bilingual') article.append(source)
  article.append(translation)
  figure.append(bar, article)
  return figure
}
