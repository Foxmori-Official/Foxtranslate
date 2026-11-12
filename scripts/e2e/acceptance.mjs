import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'

const profile = await mkdtemp(join(tmpdir(), 'foxtranslate-browser-'))
const screenshots = process.env.FOXTRANSLATE_SCREENSHOTS
const extension = resolve('dist')
const fixture = createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader('Content-Security-Policy', "img-src 'self'")
  res.end('<!doctype html><html lang="en"><title>Reading fixture</title><main><h1>Reading with Foxtranslate</h1><p id="paragraph">This paragraph contains useful information about language learning.</p></main></html>')
})
await new Promise(done => fixture.listen(0, '127.0.0.1', done))
const address = 'http://127.0.0.1:' + fixture.address().port
let browser
try {
  browser = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    executablePath: process.env.FOXTRANSLATE_TEST_CHROMIUM,
    headless: true,
    locale: 'en-US',
    args: ['--disable-extensions-except=' + extension, '--load-extension=' + extension],
  })
  browser.setDefaultTimeout(10_000)
  const worker = browser.serviceWorkers()[0] ?? await browser.waitForEvent('serviceworker')
  const origin = 'chrome-extension://' + new URL(worker.url()).host
  await worker.evaluate(() => {
    const realFetch = globalThis.fetch
    globalThis.fetch = async (url, init) => {
      if (String(url).startsWith('https://translate.googleapis.com/')) {
        const params = new URL(String(url)).searchParams
        const text = params.get('q') || new URLSearchParams(init?.body).get('q') || 'Hello'
        if (text.startsWith('Prefetch fixture ') && globalThis.captionPrefetchGate) {
          globalThis.markCaptionPrefetchStarted()
          await globalThis.captionPrefetchGate
        }
        const target = params.get('tl')
        const translated = text.startsWith('This paragraph') && ['ja', 'fr'].includes(target)
          ? 'Google · ' + target + ' · ' + text : '译文 · ' + text
        return Response.json([[[translated, text]], null, 'en'])
      }
      if (String(url).startsWith('https://api.mymemory.translated.net/get?')) {
        const { searchParams } = new URL(String(url))
        if (searchParams.get('langpair') === 'en|fr') return new Response(null, { status: 503 })
        const translatedText = ('MyMemory · ' + searchParams.get('langpair') + ' · ' + searchParams.get('q') + '\n').repeat(12)
        return Response.json({ responseStatus: 200, responseData: { translatedText } })
      }
      if (String(url) === 'https://api.foxmori.com/v1/models') {
        if (new Headers(init?.headers).get('authorization') !== 'Bearer sk-fixture-foxmori') return Response.json({}, { status: 401 })
        return Response.json({ data: [{ id: 'fixture-chat' }, { id: 'fixture-translate' }, { id: 'fixture-chat' }] })
      }
      if (String(url) === 'https://api.foxmori.com/v1/chat/completions') {
        if (new Headers(init?.headers).get('authorization') !== 'Bearer sk-fixture-foxmori') return Response.json({}, { status: 401 })
        const request = JSON.parse(init.body)
        if (request.model !== 'fixture-translate' || request.messages.some(message => typeof message.content !== 'string')) return Response.json({}, { status: 400 })
        const question = request.messages.at(-1).content
        const content = question === '再举一个例子' ? '这是第一次追问的回复' : question === '解释这个例子' ? '这是第二次追问的回复' : '你好 · Foxmori 测试'
        return Response.json({ choices: [{ message: { content } }] })
      }
      if (String(url) === 'https://api.openai.com/v1/chat/completions') {
        if (new Headers(init?.headers).get('authorization') !== 'Bearer sk-fixture-terms') return Response.json({}, { status: 401 })
        return Response.json({ choices: [{ message: { content: '[{"src":"ambient light","dst":"环境光"}]' } }] })
      }
      return realFetch(url, init)
    }
  })
  const controlPage = await browser.newPage()
  await controlPage.goto(origin + '/options.html')
  await controlPage.locator('.nav-btn.active').waitFor()
  assert.equal(await controlPage.evaluate(() => navigator.language), 'en-US')
  async function config(patch) {
    return controlPage.evaluate(async patch => {
      const result = await chrome.runtime.sendMessage({ kind: 'setConfig', patch })
      if (!result?.ok) throw new Error(result?.error)
      return result.data
    }, patch)
  }
  async function capture(page, name) {
    if (!screenshots) return
    await mkdir(screenshots, { recursive: true })
    await page.screenshot({ path: join(screenshots, name + '.png'), fullPage: true, animations: 'disabled' })
  }
  async function leftRight(page, sidebar, main) {
    const boxes = await page.evaluate(({ sidebar, main }) => {
      const a = document.querySelector(sidebar).getBoundingClientRect()
      const b = document.querySelector(main).getBoundingClientRect()
      return { left: a.left, right: a.right, mainLeft: b.left, mainTop: b.top, sidebarTop: a.top, width: innerWidth, scroll: document.documentElement.scrollWidth }
    }, { sidebar, main })
    assert.ok(boxes.right <= boxes.mainLeft + 1, JSON.stringify(boxes))
    assert.ok(Math.abs(boxes.mainTop - boxes.sidebarTop) <= 2, JSON.stringify(boxes))
    assert.ok(boxes.scroll <= boxes.width + 1, JSON.stringify(boxes))
  }

  async function centered(page, selector) {
    const edges = await page.locator(selector).evaluate(node => {
      const rect = node.getBoundingClientRect()
      return { left: rect.left, right: document.documentElement.clientWidth - rect.right }
    })
    assert.ok(edges.left > 0 && Math.abs(edges.left - edges.right) <= 1, JSON.stringify(edges))
  }

  async function noHorizontalOverflow(page) {
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
  }

  await config({ uiLang: 'zh-CN' })
  const guide = await browser.newPage()
  await guide.setViewportSize({ width: 1100, height: 760 })
  await guide.goto(origin + '/onboarding.html')
  await guide.locator('.ob-step-1').waitFor()
  await centered(guide, '.ob-card')
  await guide.setViewportSize({ width: 390, height: 780 })
  await noHorizontalOverflow(guide)
  await guide.setViewportSize({ width: 1440, height: 900 })
  await centered(guide, '.ob-card')
  await guide.getByRole('combobox', { name: '界面语言', exact: true }).selectOption('en')
  await guide.getByRole('heading', { name: 'Welcome to Foxtranslate' }).waitFor()
  assert.equal(await guide.locator('html').getAttribute('lang'), 'en')
  assert.equal(await guide.getByRole('combobox', { name: 'Target language', exact: true }).inputValue(), 'zh-CN')
  await guide.getByRole('combobox', { name: 'Interface language', exact: true }).selectOption('zh-CN')
  await guide.getByRole('heading', { name: '欢迎使用 Foxtranslate' }).waitFor()
  await capture(guide, 'foxtranslate-onboarding')
  await guide.getByRole('combobox', { name: '目标语言', exact: true }).selectOption('en')
  await guide.getByText('设置已保存', { exact: true }).waitFor()
  let stored = await worker.evaluate(() => chrome.storage.local.get('tv:config_v1'))
  assert.equal(stored['tv:config_v1'].general.targetLang, 'en')
  await guide.getByRole('button', { name: '下一步', exact: true }).click()
  await guide.locator('.ob-step-2').waitFor()
  await guide.getByRole('img', { name: '浏览器工具栏示意' }).waitFor()
  await capture(guide, 'foxtranslate-pin-guide')
  await guide.getByRole('button', { name: '下一步', exact: true }).click()
  await guide.getByRole('button', { name: '翻译示例', exact: true }).click()
  await guide.getByText('译文 · The best way', { exact: false }).waitFor()
  await guide.getByRole('button', { name: '完成设置，开始使用', exact: true }).click()
  await guide.locator('.ob-done').waitFor()
  stored = await worker.evaluate(() => chrome.storage.local.get('tv:config_v1'))
  assert.equal(stored['tv:config_v1'].onboardingCompleted, true)
  await capture(guide, 'foxtranslate-onboarding-complete')

  // A real host page activates the normal content script and background pipeline.
  await config({ general: { ...stored['tv:config_v1'].general, targetLang: 'zh-CN' } })
  const content = await browser.newPage()
  await content.goto(address)
  await content.waitForFunction(() => {
    const icon = document.querySelector('.tv-ball > img')
    return icon?.complete && icon.naturalWidth === 48
  })
  assert.equal(await content.locator('.tv-ball').textContent(), '')
  const ballIcon = await content.locator('.tv-ball > img').getAttribute('src')
  await config({ uiLang: 'de' })
  assert.equal(await content.locator('.tv-ball > img').getAttribute('src'), ballIcon)
  await config({ uiLang: 'zh-CN' })
  const contentTab = await worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    return tab.id
  })
  await worker.evaluate(async id => {
    await chrome.tabs.sendMessage(id, { kind: 'togglePage' })
  }, contentTab)
  await content.locator('tv-translation').first().waitFor()
  await content.getByText('译文 · This paragraph', { exact: false }).waitFor()
  assert.equal(await content.locator('tv-translation .tv-tr-inner').first().evaluate(el => getComputedStyle(el).color), 'rgb(100, 116, 139)')
  await worker.evaluate(id => chrome.tabs.sendMessage(id, { kind: 'togglePage' }), contentTab)
  await content.waitForFunction(() => !document.querySelector('tv-translation'))
  await content.evaluate(() => {
    const input = document.createElement('input')
    input.type = 'password'
    input.value = 'fixture-only'
    document.querySelector('main').append(input)
  })
  await content.locator('input[type="password"]').press('Alt+Enter')
  assert.equal(await content.locator('.tv-input-tip').count(), 0)
  assert.equal(await content.locator('input[type="password"]').inputValue(), 'fixture-only')
  await content.evaluate(() => {
    document.activeElement.blur()
    getSelection().selectAllChildren(document.getElementById('paragraph'))
  })
  const bubble = content.locator('.tv-sel-popup')
  await bubble.getByRole('button', { name: '朗读', exact: true }).waitFor()
  assert.equal(await bubble.locator('.tv-sel-icon').count(), 3)
  await bubble.locator('.tv-sel-primary').filter({ hasText: '收藏' }).waitFor()
  assert.equal(await bubble.getByRole('button', { name: /写作/ }).count(), 0)
  const selectionTarget = bubble.getByRole('combobox', { name: '目标语言' })
  const selectionEngine = bubble.getByRole('combobox', { name: '翻译引擎' })
  const selectionResult = bubble.locator('.tv-sel-translation')
  assert.equal(await selectionTarget.inputValue(), 'zh-CN')
  assert.match(await selectionEngine.locator('option:checked').textContent(), /默认.*谷歌/)
  assert.equal(await selectionEngine.locator('option[value="foxmori"]').count(), 0)
  await selectionTarget.focus()
  await selectionTarget.press('Tab')
  assert.ok(await bubble.getByRole('button', { name: '关闭', exact: true }).evaluate(node => node === document.activeElement))
  await selectionTarget.selectOption('ja')
  await selectionResult.filter({ hasText: 'Google · ja · This paragraph' }).waitFor()
  await selectionEngine.selectOption('mymemory')
  await selectionResult.filter({ hasText: 'MyMemory · en|ja · This paragraph' }).waitFor()
  const readingViewport = content.viewportSize()
  await content.setViewportSize({ width: 320, height: 360 })
  await content.waitForFunction(() => {
    const card = document.querySelector('.tv-sel-popup')
    const box = card.getBoundingClientRect()
    const body = card.querySelector('.tv-sel-body')
    return box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight &&
      body.scrollHeight > body.clientHeight
  })
  await capture(content, 'foxtranslate-selection-controls')
  await content.setViewportSize(readingViewport)
  await selectionTarget.selectOption('fr')
  await selectionResult.filter({ hasText: '翻译失败：mymemory: HTTP 503' }).waitFor()
  await selectionEngine.selectOption('')
  await selectionResult.filter({ hasText: 'Google · fr · This paragraph' }).waitFor()
  const readingDefaults = await config({})
  assert.equal(readingDefaults.engine.provider, 'google')
  assert.equal(readingDefaults.general.targetLang, 'zh-CN')
  await bubble.getByRole('button', { name: '关闭', exact: true }).click()

  // Popup still uses the actual active ordinary page.
  await config({ uiLang: 'de', general: { ...stored['tv:config_v1'].general, targetLang: 'zh-CN' } })
  const popup = await browser.newPage()
  await popup.setViewportSize({ width: 360, height: 540 })
  await content.bringToFront()
  await popup.goto(origin + '/popup.html')
  await popup.locator('.controls').waitFor()
  await noHorizontalOverflow(popup)
  assert.equal(await popup.locator('body').evaluate(el => el.getBoundingClientRect().width), 360)
  assert.equal(await popup.locator('.popup-footer .fox-nav a').count(), 3)
  assert.equal(await popup.locator('.popup-header .fox-nav a').count(), 0)
  for (const label of ['Dokumente', 'Vokabeln', 'Einstellungen']) {
    assert.equal(await popup.getByText(label, { exact: true }).isVisible(), true)
  }
  assert.equal(await popup.locator('a[href$="onboarding.html"]').count(), 0)
  assert.equal(await popup.getByRole('switch').count(), 3)
  assert.equal(await popup.locator('html').getAttribute('lang'), 'de')
  assert.equal(await popup.locator('[data-row="expert"]').isVisible(), false)
  const styles = popup.locator('[data-row="style"] .style-select-btn')
  await styles.focus()
  await popup.keyboard.press('ArrowDown')
  await popup.keyboard.press('End')
  await popup.keyboard.press('Enter')
  await popup.waitForFunction(() => !document.querySelector('.style-select.open'))
  assert.ok(await styles.evaluate(el => el === document.activeElement))
  assert.equal(await styles.locator('.swatch').evaluate(el => getComputedStyle(el).filter), 'blur(1.5px)')
  await capture(popup, 'foxtranslate-popup-de')
  // Selecting a site policy does not translate the current page.
  await popup.locator('.site-policy').selectOption('never')
  await popup.waitForFunction(() => !document.querySelector('.site-policy').disabled)

  await config({ uiLang: 'zh-CN', style: { styleId: 'soft-gray' } })
  await popup.reload()
  await popup.locator('.controls').waitFor()
  for (const label of ['文档翻译', '生词复习', '设置']) {
    assert.equal(await popup.getByText(label, { exact: true }).isVisible(), true)
  }
  const hoverSwitch = popup.getByRole('switch', { name: '悬停翻译', exact: true })
  await hoverSwitch.click()
  await popup.locator('.quick-switch[aria-checked="false"]').filter({ hasText: '悬停翻译' }).waitFor()
  assert.equal((await config({})).hover.enabled, false)
  await hoverSwitch.click()
  await popup.locator('.quick-switch[aria-checked="true"]').filter({ hasText: '悬停翻译' }).waitFor()
  await capture(popup, 'foxtranslate-popup')
  const options = await browser.newPage()
  await options.setViewportSize({ width: 1440, height: 900 })
  await options.goto(origin + '/options.html#video')
  await options.locator('[data-tab="video"][aria-current="page"]').waitFor()
  const captionPreview = options.getByRole('img', { name: '字幕效果预览' })
  await captionPreview.waitFor()
  const displayType = options.getByRole('combobox', { name: '字幕显示类型' })
  await displayType.selectOption('translationOnly')
  await captionPreview.locator('.ft-caption-original').waitFor({ state: 'hidden' })
  await displayType.selectOption('bilingual')
  await captionPreview.locator('.ft-caption-original').waitFor()
  await leftRight(options, '.sidebar', '.main')
  await centered(options, '.layout')
  await capture(options, 'foxtranslate-caption-settings')
  for (const width of [1024, 820, 768, 390]) {
    await options.setViewportSize({ width, height: 780 })
    await leftRight(options, '.sidebar', '.main')
  }
  await options.setViewportSize({ width: 1440, height: 900 })
  await options.locator('[data-tab="style"]').click()
  const stylePicker = options.getByRole('combobox', { name: '译文样式', exact: true })
  await stylePicker.selectOption('highlight-yellow')
  const styledText = options.locator('.reading-preview-translation.tv-style-highlight-yellow .tv-tr-inner')
  await styledText.waitFor()
  assert.equal(await styledText.evaluate(el => getComputedStyle(el).backgroundColor), 'rgba(250, 204, 21, 0.28)')
  await capture(options, 'foxtranslate-style-settings')
  await stylePicker.selectOption('soft-gray')
  await options.getByText('已保存', { exact: true }).waitFor()

  await options.locator('[data-tab="interaction"]').click()
  const advanced = options.locator('.interaction-advanced')
  assert.equal(await advanced.evaluate(el => el.open), false)
  await advanced.locator('summary').click()
  const selectionLimit = options.getByRole('spinbutton', { name: '单次划词字数上限' })
  const previousLimit = await selectionLimit.elementHandle()
  await selectionLimit.fill('1500')
  await selectionLimit.press('Tab')
  await options.waitForFunction(element => !element.isConnected, previousLimit)
  assert.equal(await selectionLimit.inputValue(), '1500')
  assert.equal((await config({})).selection.maxChars, 1500)
  await capture(options, 'foxtranslate-interaction-settings')

  await options.locator('[data-tab="general"]').click()
  await options.getByRole('link', { name: '文档翻译', exact: true }).waitFor()
  assert.equal(await options.locator('.settings-workspace-nav a').count(), 2)
  assert.equal(await options.locator('.settings-workspace-nav [data-destination="settings"]').count(), 0)
  assert.equal(await options.locator('[data-tab="account"], [data-tab="writing"], .account-overview').count(), 0)
  assert.deepEqual(await options.locator('.settings-workspace-nav').evaluate(nav => ({
    afterDataGroup: Boolean(nav.previousElementSibling?.lastElementChild?.querySelector('[data-group="data"]')),
    outsideDetails: nav.closest('details') === null,
    footerFollows: nav.nextElementSibling?.classList.contains('side-footer'),
  })), { afterDataGroup: true, outsideDetails: true, footerFollows: true })
  assert.equal(await options.locator('[data-tab="glossaryLibs"]').isVisible(), false)
  await capture(options, 'foxtranslate-settings')
  await options.setViewportSize({ width: 390, height: 780 })
  await leftRight(options, '.sidebar', '.main')
  await capture(options, 'foxtranslate-settings-narrow')
  for (const [page, sidebar, main] of [
    ['files', '.fox-sidebar', '.layout'], ['privacy', '.fox-sidebar', '.wrap'],
  ]) {
    const view = await browser.newPage()
    await view.setViewportSize({ width: 1100, height: 760 })
    await view.goto(origin + '/' + page + '.html')
    await view.locator(main).waitFor()
    await leftRight(view, sidebar, main)
    await view.setViewportSize({ width: 390, height: 780 })
    await leftRight(view, sidebar, main)
    if (page === 'privacy') {
      await view.getByRole('heading', { name: '隐私政策', exact: true }).waitFor()
      assert.ok((await view.getByRole('link', { name: '返回隐私设置' }).getAttribute('href')).endsWith('options.html#privacy'))
      await view.getByRole('link', { name: 'English', exact: true }).click()
      await view.getByRole('heading', { name: 'Privacy policy', exact: true }).waitFor()
      await view.getByRole('link', { name: '简体中文', exact: true }).click()
      await view.getByRole('heading', { name: '隐私政策', exact: true }).waitFor()
    }
    await view.close()
  }

  // The extension reuses the first-party session and never asks for its password.
  let createdKeys = 0
  let availableGroups = []
  const consoleCookie = 'fm_fixture=logged-in; Path=/api/console/; HttpOnly; Secure; SameSite=Strict'
  const foxmoriFixture = async route => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (path === '/') {
      await route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<a href="/fixture-login">登录测试账户</a>' })
      return
    }
    if (path === '/fixture-login') {
      await route.fulfill({ contentType: 'text/html; charset=utf-8', headers: { 'set-cookie': consoleCookie }, body: '<p>已登录测试账户</p>' })
      return
    }
    const headers = await request.allHeaders()
    if (!headers.cookie?.includes('fm_fixture=logged-in')) {
      await route.fulfill({ status: 401, json: { message: '请先登录' } })
      return
    }
    if (path === '/api/console/user/profile') {
      await route.fulfill({ json: { code: 0, data: { id: 12, email: 'fixture@example.test', username: 'Fixture' } } })
    } else if (path === '/api/console/groups/available') {
      await route.fulfill({ json: { code: 0, data: availableGroups } })
    } else if (path === '/api/console/keys' && request.method() === 'POST') {
      const valid = headers.origin === 'https://foxmori.com' && headers['sec-fetch-site'] !== 'cross-site'
      const body = request.postDataJSON()
      if (!valid || body?.name !== 'Foxmori' || body?.group_id !== 7) {
        await route.fulfill({ status: 403, json: { message: 'Invalid origin or key request' } })
        return
      }
      createdKeys++
      await route.fulfill({ json: { code: 0, data: { id: 17, key: 'sk-fixture-foxmori' } } })
    } else if (path === '/api/console/keys') {
      const items = createdKeys ? [{ name: 'Foxmori', status: 'active', group_id: 7, key: 'sk-fixture-foxmori' }] : []
      await route.fulfill({ json: { code: 0, data: { items } } })
    } else {
      await route.fulfill({ status: 404, json: { message: 'Unknown fixture route' } })
    }
  }
  await browser.route(url => url.hostname === 'foxmori.com', foxmoriFixture)
  const { engine } = await config({})
  await config({ engine: { ...engine, provider: 'google' } })
  const accountOpened = browser.waitForEvent('page')
  await popup.getByRole('link', { name: 'Foxmori 账户', exact: true }).click()
  const provider = await accountOpened
  await provider.waitForURL(origin + '/options.html#engine')
  const engineNav = provider.locator('[data-tab="engine"]')
  const loginButton = provider.getByRole('button', { name: '登录 Foxmori', exact: true })
  await loginButton.waitFor()
  assert.equal(await engineNav.getAttribute('aria-current'), 'page')
  await provider.setViewportSize({ width: 1440, height: 900 })
  await provider.locator('[data-tab="general"]').click()
  assert.equal(await provider.locator('.account-overview, [data-tab="account"]').count(), 0)
  await engineNav.click()
  await loginButton.waitFor()
  await capture(provider, 'foxtranslate-engine-account')
  await provider.setViewportSize({ width: 390, height: 780 })
  await leftRight(provider, '.sidebar', '.main')
  await capture(provider, 'foxtranslate-engine-account-narrow')
  await provider.setViewportSize({ width: 1440, height: 900 })
  const siteOpened = browser.waitForEvent('page')
  await loginButton.click()
  const site = await siteOpened
  await site.waitForURL('https://foxmori.com/#models')
  const connect = provider.getByRole('button', { name: '连接已登录账户' })
  await connect.click()
  await provider.getByText('请先在 Foxmori 主站登录', { exact: false }).waitFor()
  await site.route(url => url.hostname === 'foxmori.com', foxmoriFixture)
  await site.goto('https://foxmori.com/fixture-login')
  await site.getByText('已登录测试账户').waitFor()
  await connect.click()
  await provider.getByRole('button', { name: '前往 Foxmori 订阅', exact: true }).waitFor()
  assert.equal(await provider.getByRole('button', { name: '创建 Foxmori 密钥' }).count(), 0)
  availableGroups = [{ id: 7, name: '测试套餐' }]
  await connect.click()
  await provider.getByText('fixture@example.test', { exact: true }).waitFor()
  for (const width of [320, 768]) {
    await provider.setViewportSize({ width, height: 780 })
    await leftRight(provider, '.sidebar', '.main')
  }
  await provider.setViewportSize({ width: 1440, height: 900 })
  await provider.getByRole('button', { name: '创建 Foxmori 密钥' }).click()
  await provider.getByText('密钥已配置，请获取模型列表并选择模型。', { exact: true }).waitFor()
  assert.equal(createdKeys, 1)
  assert.equal((await config({})).engine.provider, 'google')
  await provider.locator('[data-engine-id="foxmori"][aria-pressed="true"]').waitFor()
  assert.equal(await provider.locator('.engine-current').count(), 1)
  await provider.locator('[data-engine-id="google"] .engine-current').waitFor()
  await provider.locator('[data-engine-id="deepl"]').click()
  await provider.getByRole('heading', { name: 'DeepL', exact: true }).waitFor()
  await provider.locator('[data-engine-id="foxmori"]').click()
  assert.equal((await config({})).engine.provider, 'google')
  const keyField = provider.getByLabel('API Key', { exact: true })
  const modelField = provider.getByRole('textbox', { name: '模型', exact: true })
  await capture(provider, 'foxtranslate-foxmori')
  assert.equal(await keyField.getAttribute('type'), 'password')
  assert.ok((await keyField.boundingBox()).y < (await modelField.boundingBox()).y)
  assert.ok((await keyField.boundingBox()).width > (await modelField.boundingBox()).width)
  await provider.getByRole('button', { name: '获取模型列表' }).click()
  const models = provider.getByRole('combobox', { name: '选择模型…' })
  await models.waitFor()
  assert.equal(await models.locator('option').count(), 3)
  await models.selectOption('fixture-chat')
  assert.equal(await modelField.inputValue(), 'fixture-chat')
  await provider.locator('.engine-detail').evaluate(detail => {
    const model = detail.querySelector('.provider-model-input')
    const timeout = detail.querySelector('.engine-test input[type="number"]')
    model.value = 'fixture-translate'
    model.dispatchEvent(new Event('change'))
    timeout.value = '25000'
    timeout.dispatchEvent(new Event('change'))
  })
  await provider.getByRole('button', { name: '测试连接', exact: true }).click()
  await provider.getByText('你好 · Foxmori 测试', { exact: false }).waitFor()
  const testedEngine = (await config({})).engine
  assert.equal(testedEngine.provider, 'google')
  assert.equal(testedEngine.foxmori.model, 'fixture-translate')
  assert.equal(testedEngine.timeoutMs, 25000)
  for (const width of [1024, 768, 390, 320]) {
    await provider.setViewportSize({ width, height: 780 })
    await leftRight(provider, '.sidebar', '.main')
  }
  const services = provider.getByRole('combobox', { name: '翻译服务', exact: true })
  await services.selectOption('bing')
  await provider.getByRole('heading', { name: /微软/ }).waitFor()
  await provider.getByText('当前使用 谷歌（免费）', { exact: true }).waitFor()
  await services.selectOption('foxmori')
  assert.equal((await config({})).engine.provider, 'google')
  const withSelectionEngines = await config({})
  await config({ engine: {
    ...withSelectionEngines.engine,
    customEngines: [{
      id: 'selection-fixture', name: '自定义测试引擎', endpoint: 'https://api.foxmori.com/v1',
      apiKey: 'sk-fixture-foxmori', model: 'fixture-translate', headersJson: '{}',
    }],
  } })
  await content.bringToFront()
  await content.evaluate(() => {
    getSelection().removeAllRanges()
    getSelection().selectAllChildren(document.getElementById('paragraph'))
  })
  await selectionEngine.selectOption('foxmori')
  await selectionResult.filter({ hasText: /^你好 · Foxmori 测试$/ }).waitFor()
  await selectionEngine.selectOption('custom:selection-fixture')
  await selectionResult.filter({ hasText: /^你好 · Foxmori 测试$/ }).waitFor()
  assert.equal((await config({})).engine.provider, 'google')
  await bubble.getByRole('button', { name: '关闭', exact: true }).click()
  await provider.setViewportSize({ width: 1440, height: 900 })
  await provider.getByRole('button', { name: '设为当前引擎', exact: true }).click()
  await provider.locator('[data-engine-id="foxmori"] .engine-current').waitFor()
  assert.equal((await config({})).engine.provider, 'foxmori')
  await content.bringToFront()
  await content.evaluate(() => {
    getSelection().removeAllRanges()
    getSelection().selectAllChildren(document.getElementById('paragraph'))
  })
  await bubble.getByRole('button', { name: 'AI 解析', exact: true }).click()
  const analysis = bubble.locator('.tv-sel-ai')
  const initialAnalysis = Array(4).fill('你好 · Foxmori 测试').join('\n\n')
  await content.waitForFunction(expected => document.querySelector('.tv-sel-ai-result')?.textContent === expected, initialAnalysis)
  assert.ok(!(await analysis.innerText()).includes('[object Object]'))
  const followUp = analysis.getByPlaceholder('追问：用法 / 近义词 / 更多例句…')
  await followUp.fill('再举一个例子')
  await analysis.getByRole('button', { name: '发送', exact: true }).click()
  await analysis.getByText('这是第一次追问的回复', { exact: true }).waitFor()
  await followUp.fill('解释这个例子')
  await analysis.getByRole('button', { name: '发送', exact: true }).click()
  await analysis.getByText('这是第二次追问的回复', { exact: true }).waitFor()
  await capture(content, 'foxtranslate-reading-analysis')
  await bubble.getByRole('button', { name: '关闭', exact: true }).click()
  await popup.reload()
  await popup.locator('[data-row="expert"]').waitFor()
  await noHorizontalOverflow(popup)
  assert.ok((await popup.locator('body').boundingBox()).height <= 600)
  await capture(popup, 'foxtranslate-popup-ai')
  await provider.locator('[data-group="assist"]').click()
  await provider.locator('[data-tab="experts"]').click()
  await provider.getByText('当前引擎将使用「通用」策略', { exact: true }).waitFor()
  await capture(provider, 'foxtranslate-expert-settings')
  await provider.close()
  await site.close()
  await config({ engine })

  await options.setViewportSize({ width: 1440, height: 900 })
  await options.locator('[data-group="data"]').click()
  await options.locator('[data-tab="glossaryLibs"]').click()
  const library = options.getByRole('checkbox', { name: /^启用内置库/ }).first()
  await library.waitFor()
  assert.equal(await options.getByRole('button', { name: 'AI 提取', exact: true }).isDisabled(), true)
  await library.check()
  await options.locator('.library-state').filter({ hasText: '已启用' }).first().waitFor()
  await options.reload()
  await library.waitFor()
  assert.equal(await library.isChecked(), true)
  await library.uncheck()
  await options.getByText('已保存', { exact: true }).waitFor()
  await capture(options, 'foxtranslate-glossary-settings')

  await config({ engine: { ...engine, provider: 'openai', keys: { ...engine.keys, openai: 'sk-fixture-terms' } } })
  await options.reload()
  await options.getByRole('textbox', { name: '文本', exact: true }).fill('Read books in ambient light.')
  await options.getByRole('button', { name: 'AI 提取', exact: true }).click()
  await options.getByRole('cell', { name: '环境光', exact: true }).waitFor()
  await options.getByRole('heading', { name: 'AI 术语库', exact: true }).waitFor()
  await config({ engine })

  const documents = await browser.newPage()
  await documents.setViewportSize({ width: 1100, height: 760 })
  await documents.goto(origin + '/files.html')
  await documents.getByRole('heading', { name: '文档翻译', exact: true }).waitFor()
  assert.ok(await documents.locator('.card:has(.dropzone) .file-actions').isVisible())
  await documents.locator('input[type="file"]').setInputFiles({
    name: 'reading.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Reading helps us understand the world.'),
  })
  await documents.getByRole('button', { name: '开始翻译', exact: true }).click()
  await documents.getByRole('button', { name: '下载译文', exact: true }).waitFor()
  const downloadEvent = documents.waitForEvent('download')
  await documents.getByRole('button', { name: '下载译文', exact: true }).click()
  const download = await downloadEvent
  const stream = await download.createReadStream()
  const chunks = []
  for await (const chunk of stream) chunks.push(chunk)
  assert.ok(Buffer.concat(chunks).toString().includes('译文 · Reading helps'))
  await capture(documents, 'foxtranslate-documents')
  await documents.close()

  const saved = await controlPage.evaluate(() => chrome.runtime.sendMessage({
    kind: 'saveWord', word: 'curiosity', translation: '好奇心', context: 'Curiosity helps us learn.',
  }))
  assert.equal(saved.ok, true)
  const review = await browser.newPage()
  await review.setViewportSize({ width: 1100, height: 760 })
  await review.goto(origin + '/review.html')
  await review.locator('.card-word').filter({ hasText: 'curiosity' }).waitFor()
  await centered(review, '.card-scene')
  await review.setViewportSize({ width: 390, height: 780 })
  await noHorizontalOverflow(review)
  await review.setViewportSize({ width: 1100, height: 760 })
  await review.getByRole('button', { name: '显示释义', exact: true }).click()
  await capture(review, 'foxtranslate-review')
  await review.locator('.grade-btn.good').click()
  const returnToWordbook = review.getByRole('link', { name: '返回生词本', exact: true })
  await returnToWordbook.focus()
  await review.getByRole('heading', { name: '本次复习完成', exact: true }).waitFor()
  assert.equal(await returnToWordbook.evaluate(link => document.activeElement === link), true)
  const words = await controlPage.evaluate(() => chrome.runtime.sendMessage({ kind: 'getWords' }))
  assert.equal(words.data.find(word => word.word === 'curiosity').card.reps, 1)
  await returnToWordbook.press('Enter')
  await review.waitForURL(origin + '/options.html#words')
  await review.getByRole('link', { name: '开始闪卡复习', exact: true }).waitFor()
  await review.close()

  // Hostname, player, bridge and scripts match production. Network data is deterministic.
  let unsignedCaptionReads = 0
  let authorizedCaptionReads = 0
  await browser.route('https://www.youtube.com/**', async route => {
    const url = new URL(route.request().url())
    if (url.pathname === '/api/timedtext') {
      if (url.searchParams.get('pot') !== 'fixture-proof') {
        unsignedCaptionReads++
        await route.fulfill({ status: 200, body: '' })
        return
      }
      if (url.searchParams.get('cplayer') === 'UNIPLAYER') authorizedCaptionReads++
      if (url.searchParams.get('lang') === 'fr') {
        await route.fulfill({ json: { events: [
          { tStartMs: 0, dDurationMs: 30_000, segs: [{ utf8: 'Bonjour, voici la piste française.' }] },
        ] } })
        return
      }
      await route.fulfill({ json: { events: [
        { tStartMs: 0, dDurationMs: 30_000, wWinId: 1, segs: [{ utf8: 'Learn something new every day.' }] },
        { tStartMs: 31_000, dDurationMs: 3000, wWinId: 1, segs: [{ utf8: 'Prefetch fixture one.' }] },
        { tStartMs: 34_000, dDurationMs: 3000, wWinId: 1, segs: [{ utf8: 'Prefetch fixture two.' }] },
        { tStartMs: 37_000, dDurationMs: 3000, wWinId: 1, segs: [{ utf8: 'Prefetch fixture three.' }] },
        { tStartMs: 60_000, dDurationMs: 5000, wWinId: 1, segs: [{ utf8: 'A later caption outside the preview window.' }] },
      ] } })
      return
    }
    if (url.pathname === '/fixture-player.js') {
      await route.fulfill({ contentType: 'application/javascript', body: `
        const player = document.querySelector('#movie_player');
        const cc = player.querySelector('.ytp-subtitles-button');
        const videoId = () => new URLSearchParams(location.search).get('v');
        const captions = lang => '/api/timedtext?v=' + videoId() + '&lang=' + lang;
        player.getPlayerResponse = () => ({
          videoDetails: { videoId: videoId() },
          captions: { playerCaptionsTracklistRenderer: {
            captionTracks: ['fr', 'en'].map(lang => ({ baseUrl: captions(lang), languageCode: lang, vssId: '.' + lang }))
          } }
        });
        const selectedLanguage = () => player.dataset.captionLang || 'en';
        player.getOption = () => ({ vss_id: '.' + selectedLanguage(), languageCode: selectedLanguage() });
        player.toggleSubtitles = () => {
          cc.setAttribute('aria-pressed', 'true');
          const xhr = new XMLHttpRequest();
          xhr.open('GET', captions(selectedLanguage()) + '&fmt=json3&pot=fixture-proof&potc=1');
          xhr.send();
        };
      ` })
      return
    }
    await route.fulfill({
      contentType: 'text/html',
      headers: { 'content-security-policy': "script-src 'self'; img-src 'self'; require-trusted-types-for 'script'" },
      body: '<!doctype html><html><head><title>Video fixture</title></head><body style="margin:0;background:#faf9f4"><div hidden><button class="ytp-subtitles-button" aria-pressed="true">Preview CC</button></div><div id="movie_player" style="position:relative;width:900px;height:506px;background:#19251e"><video class="html5-main-video"></video><div class="ytp-right-controls" style="position:absolute;right:16px;bottom:0;height:48px"><button class="ytp-subtitles-button" aria-pressed="false">CC</button></div></div><script src="/fixture-player.js"></script></body></html>',
    })
  })
  await config({ subtitles: { enabled: true, youtube: false, meet: true }, general: { ...stored['tv:config_v1'].general, targetLang: 'zh-CN' } })
  const video = await browser.newPage()
  await video.setViewportSize({ width: 1100, height: 720 })
  await video.goto('https://www.youtube.com/watch?v=fixture')
  const ft = video.getByRole('button', { name: 'Foxtranslate · 字幕菜单' })
  const menu = video.locator('#foxtranslate-caption-menu')
  const openMenu = async () => {
    if (await ft.getAttribute('aria-expanded') !== 'true') await ft.click()
    await menu.waitFor()
  }
  await ft.waitFor()
  await video.waitForFunction(() => {
    const icon = document.querySelector('.foxtranslate-caption-button img')
    return icon?.complete && icon.naturalWidth === 48
  })
  assert.equal(await ft.locator('.foxtranslate-caption-state').textContent(), 'OFF')
  assert.equal(await ft.locator('img').getAttribute('src'), ballIcon)
  assert.equal(await ft.getAttribute('data-enabled'), 'false')
  await openMenu()
  await video.locator('video').evaluate(element => { element.currentTime = 10 })
  await worker.evaluate(() => {
    let started = 0
    globalThis.captionPrefetchStarted = new Promise(resolve => {
      globalThis.markCaptionPrefetchStarted = () => {
        if (++started === 2) resolve()
      }
    })
    globalThis.captionPrefetchGate = new Promise(resolve => { globalThis.releaseCaptionPrefetch = resolve })
  })
  await menu.getByRole('button', { name: '仅本次开启字幕翻译', exact: false }).click()
  const overlay = video.locator('#tv-yt-subtitle-host')
  await overlay.waitFor()
  await overlay.getByText('译文 · Learn something new every day.', { exact: true }).waitFor()
  assert.ok(unsignedCaptionReads > 0 && authorizedCaptionReads > 0)
  assert.equal(await video.locator('#movie_player .ytp-subtitles-button').getAttribute('aria-pressed'), 'true')
  assert.equal(await ft.locator('.foxtranslate-caption-state').textContent(), 'ON')
  assert.equal(await ft.getAttribute('data-enabled'), 'true')
  // The cue at the seek destination must translate before the stalled prefetch is released.
  await worker.evaluate(() => Promise.race([
    globalThis.captionPrefetchStarted,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Caption prefetch never started')), 5000)),
  ]))
  await video.locator('video').evaluate(element => {
    element.currentTime = 61
    element.dispatchEvent(new Event('seeked'))
  })
  await overlay.getByText('译文 · A later caption outside the preview window.', { exact: true }).waitFor()
  await worker.evaluate(() => globalThis.releaseCaptionPrefetch())
  await video.locator('video').evaluate(element => { element.currentTime = 10 })
  assert.equal((await config({})).subtitles.youtube, false)
  await openMenu()
  await capture(video, 'foxtranslate-youtube-menu')
  await menu.getByRole('button', { name: '全局字幕设置', exact: true }).click()
  await menu.getByRole('combobox', { name: '译文位置' }).selectOption('above')
  await overlay.locator('.tv-panel[data-position="above"]').waitFor()
  await menu.getByRole('combobox', { name: '字幕显示类型' }).selectOption('translationOnly')
  await overlay.locator('.tv-orig').waitFor({ state: 'hidden' })
  await menu.getByRole('combobox', { name: '字幕显示类型' }).selectOption('bilingual')
  await overlay.locator('.tv-orig').waitFor({ state: 'visible' })
  await menu.getByRole('button', { name: '字幕样式', exact: true }).click()
  const opacity = menu.getByRole('slider', { name: '背景不透明度' })
  await opacity.focus()
  await video.keyboard.press('ArrowRight')
  await video.waitForFunction(() => document.querySelector('#tv-yt-subtitle-host')?.shadowRoot?.querySelector('.tv-panel')?.style.getPropertyValue('--ft-caption-bg').includes('80%'))
  const menuBounds = await menu.locator('.panel').evaluate(panel => {
    const player = document.querySelector('#movie_player').getBoundingClientRect()
    const rect = panel.getBoundingClientRect()
    const body = panel.querySelector('.content')
    return { inside: rect.top >= player.top && rect.bottom < player.bottom, scrolls: body.scrollHeight > body.clientHeight }
  })
  assert.ok(menuBounds.inside && menuBounds.scrolls, JSON.stringify(menuBounds))
  await capture(video, 'foxtranslate-youtube-style')
  await menu.getByRole('button', { name: '重置样式' }).click()
  await video.waitForFunction(() => document.querySelector('#tv-yt-subtitle-host')?.shadowRoot?.querySelector('.tv-panel')?.style.getPropertyValue('--ft-caption-bg').includes('75%'))
  assert.equal(await overlay.locator('.tv-panel').getAttribute('data-position'), 'above')
  await video.keyboard.press('Escape')
  await menu.waitFor({ state: 'hidden' })
  assert.ok(await ft.evaluate(node => node === document.activeElement))
  await openMenu()
  await menu.getByRole('button', { name: '下载字幕', exact: true }).click()
  const subtitleDownload = video.waitForEvent('download')
  await menu.getByRole('button', { name: '翻译全部并下载双语 SRT' }).click()
  const srt = await subtitleDownload
  assert.equal(srt.suggestedFilename(), 'foxtranslate-fixture-bilingual.srt')
  const srtStream = await srt.createReadStream()
  const srtChunks = []
  for await (const chunk of srtStream) srtChunks.push(chunk)
  const srtText = Buffer.concat(srtChunks).toString()
  assert.match(srtText, /00:00:00,000 --> 00:00:30,000/)
  assert.match(srtText, /译文 · Learn something new every day\.\nLearn something new every day\./)
  assert.match(srtText, /译文 · A later caption outside the preview window/)
  await video.locator('#movie_player').evaluate(player => {
    player.dataset.captionLang = 'fr'
    player.toggleSubtitles()
  })
  await overlay.getByText('译文 · Bonjour, voici la piste française.', { exact: true }).waitFor()
  await video.getByRole('button', { name: '立即关闭字幕翻译' }).click()
  await overlay.waitFor({ state: 'detached' })
  assert.equal(await video.locator('#tv-yt-native-cap-hide').count(), 0)
  await video.keyboard.press('Alt+s')
  await overlay.waitFor()
  await openMenu()
  await menu.getByRole('button', { name: '全局字幕设置', exact: true }).click()
  await menu.getByRole('button', { name: '不再显示此快捷入口', exact: true }).click()
  await ft.waitFor({ state: 'detached' })
  assert.ok(await overlay.count())
  const sub = (await config({})).subtitles
  assert.equal(sub.showShortcut, false)
  await config({ subtitles: { ...sub, showShortcut: true } })
  await ft.waitFor()
  await video.evaluate(() => {
    history.pushState({}, '', '/watch?v=second')
    document.dispatchEvent(new Event('yt-navigate-start'))
    window.dispatchEvent(new Event('yt-navigate-finish'))
  })
  assert.equal(await video.locator('.foxtranslate-caption-button').count(), 1)
  // Replacing player controls must reattach exactly one button while disabled.
  await video.evaluate(() => {
    const previous = document.querySelector('.ytp-right-controls')
    const replacement = document.createElement('div')
    replacement.className = 'ytp-right-controls'
    previous.replaceWith(replacement)
  })
  await video.locator('.foxtranslate-caption-button').waitFor()
  assert.equal(await video.locator('.foxtranslate-caption-button').count(), 1)
  if (process.env.FOXTRANSLATE_LIVE_YOUTUBE === '1') {
    await browser.unroute('https://www.youtube.com/**')
    const live = await browser.newPage()
    await live.setViewportSize({ width: 1280, height: 800 })
    try {
      await live.goto('https://www.youtube.com/watch?v=jNQXAC9IVRw', { waitUntil: 'domcontentloaded', timeout: 30_000 })
      await live.locator('.foxtranslate-caption-button').waitFor({ timeout: 25_000 })
      await live.waitForFunction(() => {
        const icon = document.querySelector('.foxtranslate-caption-button img')
        return icon?.complete && icon.naturalWidth === 48
      })
      await live.locator('.foxtranslate-caption-button').click()
      await live.locator('#foxtranslate-caption-menu').getByRole('heading', { name: '字幕菜单' }).waitFor()
      console.log('LIVE YOUTUBE · fox button and caption menu verified')
      await capture(live, 'foxtranslate-youtube-live')
    } catch (error) {
      console.log('LIVE YOUTUBE · external page verification unavailable: ' + error.message.split('\n')[0])
      await capture(live, 'foxtranslate-youtube-live-unavailable')
    }
  }
  console.log('PASS · setup languages, workspace navigation, Foxmori account, selection languages/free/AI/custom engines/keyboard, AI analysis, page translation, document export, vocabulary review, YouTube CC/track changes/seek priority, menu/styles/SRT/shortcuts, CSP bridge and SPA')
} finally {
  await browser?.close()
  await new Promise(done => fixture.close(done))
  await rm(profile, { recursive: true, force: true })
}
