import { appSidebar } from '../shared/appShell'
// 隐私政策页：内置页面，不跳转外部站点。仅英文（商店审核语言）。

interface PrivacySection {
  title: string
  body?: string[]
  list?: string[]
}

interface PrivacyContent {
  updated: string
  sections: PrivacySection[]
}

const EN: PrivacyContent = {
  updated: '2026-11-11',
  sections: [
    {
      title: 'Who we are',
      body: ['Foxtranslate is an open-source browser translation extension (GPL-3.0). This extension has no servers: we operate no backend, collect no analytics, show no ads, and have no accounts.'],
    },
    {
      title: 'What data the extension handles',
      body: ['Translation and AI features send text to the selected service. Automatic page translation, hover, input and subtitle features can send text when triggered. Free-engine fallback and comparisons can contact more than one provider. YouTube captions are retrieved from YouTube; language detection can contact Google.'],
      list: [
        'Free engines: Google Translate, Microsoft Translator, MyMemory',
        'Bring-your-own-key engines: DeepL, OpenAI-compatible endpoints (OpenAI / DeepSeek / any compatible endpoint), Claude, Gemini, self-hostable LibreTranslate, AI Mao',
      ],
    },
    {
      title: 'Optional sensitive-data masking',
      body: ['You can enable "Sensitive data masking" in settings: email addresses, phone numbers, bank card numbers, ID numbers, and API keys are replaced with placeholders locally in your browser before being sent for translation, and restored locally afterwards. Masking attempts to cover recognized patterns in the translation pipeline. It does not guarantee detection of every sensitive value, and language detection, AI actions and extra page context may follow different processing paths.'],
    },
    {
      title: 'API keys',
      body: ['Keys you enter (DeepL / OpenAI, etc.) are stored only in chrome.storage.local and are used solely to authenticate requests to the provider you configured. Local browser storage is not an encrypted vault. Translation caches can contain restored sensitive text.'],
    },
    {
      title: 'Wordbook',
      body: ['Saved words and flashcard review records stay in local browser storage and are never uploaded.'],
    },
    {
      title: 'What we do NOT do',
      list: [
        'No browsing-history collection, no behavior tracking, no telemetry or analytics',
        'No sale, sharing, or transfer of user data',
        'No ads, no browser-setting changes',
        'No remote code execution (all program logic ships inside the extension package)',
      ],
    },
    {
      title: 'Your controls',
      list: [
        'Switch translation engines anytime; choose self-hosted engines so text never leaves your network',
        'Enable masking to protect sensitive content',
        'Delete local data through the browser extension storage tools or uninstall the extension. This does not recall data already sent to providers.',
      ],
    },
  ],
}

const app = document.getElementById('app')!
if (app) {
  app.className = 'fox-shell'
  const content = document.createElement('main')
  content.className = 'wrap fox-main'
  app.append(appSidebar('privacy', 'en'), content)

  const brand = document.createElement('div')
  brand.className = 'brand'
  const logo = document.createElement('img')
  logo.src = chrome.runtime.getURL('icons/icon128.png')
  logo.alt = 'Foxtranslate'
  const name = document.createElement('span')
  name.className = 'brand-name'
  name.textContent = 'Foxtranslate'
  brand.append(logo, name)
  content.appendChild(brand)

  const updated = document.createElement('p')
  updated.className = 'updated'
  updated.textContent = `Effective date: ${EN.updated}`
  content.appendChild(updated)

  for (const sec of EN.sections) {
    const h = document.createElement('h2')
    h.textContent = sec.title
    content.appendChild(h)
    for (const p of sec.body ?? []) {
      const el = document.createElement('p')
      el.textContent = p
      content.appendChild(el)
    }
    if (sec.list) {
      const ul = document.createElement('ul')
      for (const item of sec.list) {
        const li = document.createElement('li')
        li.textContent = item
        ul.appendChild(li)
      }
      content.appendChild(ul)
    }
  }
}
