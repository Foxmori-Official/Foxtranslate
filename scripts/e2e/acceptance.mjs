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
    args: ['--disable-extensions-except=' + extension, '--load-extension=' + extension],
  })
  browser.setDefaultTimeout(10_000)
  const worker = browser.serviceWorkers()[0] ?? await browser.waitForEvent('serviceworker')
  const origin = 'chrome-extension://' + new URL(worker.url()).host
  await worker.evaluate(() => {
    const realFetch = globalThis.fetch
    globalThis.fetch = async (url, init) => {
      if (String(url).startsWith('https://translate.googleapis.com/')) {
        const text = new URL(String(url)).searchParams.get('q') || new URLSearchParams(init?.body).get('q') || 'Hello'
        return Response.json([[['译文 · ' + text, text]], null, 'en'])
      }
      return realFetch(url, init)
    }
  })
  const controlPage = await browser.newPage()
  await controlPage.goto(origin + '/options.html')
  await controlPage.locator('.nav-btn.active').waitFor()
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
    await page.screenshot({ path: join(screenshots, name + '.png'), fullPage: true })
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

  await config({ uiLang: 'zh-CN' })
  const guide = await browser.newPage()
  await guide.setViewportSize({ width: 1100, height: 760 })
  await guide.goto(origin + '/onboarding.html')
  await guide.locator('.ob-step-1').waitFor()
  await leftRight(guide, '.ob-head', '.ob-content')
  await guide.setViewportSize({ width: 390, height: 780 })
  await leftRight(guide, '.ob-head', '.ob-content')
  await guide.setViewportSize({ width: 1100, height: 760 })
  await guide.getByRole('combobox', { name: '目标语言', exact: true }).selectOption('en')
  await guide.getByText('设置已保存', { exact: true }).waitFor()
  let stored = await worker.evaluate(() => chrome.storage.local.get('tv:config_v1'))
  assert.equal(stored['tv:config_v1'].general.targetLang, 'en')
  await guide.getByRole('button', { name: '下一步', exact: true }).click()
  await guide.locator('.ob-step-2').waitFor()
  await guide.getByRole('button', { name: '下一步', exact: true }).click()
  await guide.getByRole('button', { name: '翻译示例', exact: true }).click()
  await guide.getByText('译文 · The best way', { exact: false }).waitFor()
  await guide.getByRole('button', { name: '完成设置，开始使用', exact: true }).click()
  await guide.locator('.ob-done').waitFor()
  stored = await worker.evaluate(() => chrome.storage.local.get('tv:config_v1'))
  assert.equal(stored['tv:config_v1'].onboardingCompleted, true)
  await capture(guide, 'foxtranslate-onboarding')

  // A real host page activates the normal content script and background pipeline.
  const content = await browser.newPage()
  await content.goto(address)
  const contentTab = await worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    return tab.id
  })
  await worker.evaluate(async id => {
    await chrome.tabs.sendMessage(id, { kind: 'togglePage' })
  }, contentTab)
  await content.locator('tv-translation').first().waitFor()
  await content.getByText('译文 · This paragraph', { exact: false }).waitFor()
  await worker.evaluate(id => chrome.tabs.sendMessage(id, { kind: 'togglePage' }), contentTab)
  await content.waitForFunction(() => !document.querySelector('tv-translation'))

  // Popup still uses the actual active ordinary page.
  await config({ uiLang: 'de', general: { ...stored['tv:config_v1'].general, targetLang: 'zh-CN' } })
  const popup = await browser.newPage()
  await popup.setViewportSize({ width: 720, height: 560 })
  await content.bringToFront()
  await popup.goto(origin + '/popup.html')
  await popup.locator('.controls').waitFor()
  await leftRight(popup, '.fox-sidebar', '.popup-main')
  assert.equal(await popup.locator('html').getAttribute('lang'), 'de')
  assert.equal(await popup.locator('[data-row="expert"]').isVisible(), false)
  const styles = popup.locator('[data-row="style"] .style-select-btn')
  await styles.focus()
  await popup.keyboard.press('ArrowDown')
  await popup.keyboard.press('End')
  await popup.keyboard.press('Enter')
  await popup.waitForFunction(() => !document.querySelector('.style-select.open'))
  assert.ok(await styles.evaluate(el => el === document.activeElement))
  await capture(popup, 'foxtranslate-popup-de')
  // Selecting a site policy does not translate the current page.
  await popup.locator('.site-policy').selectOption('never')
  await popup.waitForFunction(() => !document.querySelector('.site-policy').disabled)

  await config({ uiLang: 'zh-CN', style: { styleId: 'soft-gray' } })
  await popup.reload()
  await popup.locator('.controls').waitFor()
  await capture(popup, 'foxtranslate-popup')
  const options = await browser.newPage()
  await options.setViewportSize({ width: 1100, height: 760 })
  await options.goto(origin + '/options.html#video')
  await options.locator('[data-tab="video"][aria-current="page"]').waitFor()
  await options.getByText('FT 按钮', { exact: false }).waitFor()
  await leftRight(options, '.sidebar', '.main')
  await options.locator('[data-tab="general"]').click()
  await capture(options, 'foxtranslate-settings')
  await options.setViewportSize({ width: 390, height: 780 })
  await leftRight(options, '.sidebar', '.main')
  await capture(options, 'foxtranslate-settings-narrow')
  for (const [page, sidebar, main] of [
    ['files', '.fox-sidebar', '.layout'], ['review', '.topbar', '.stage'], ['privacy', '.fox-sidebar', '.wrap'],
  ]) {
    const view = await browser.newPage()
    await view.setViewportSize({ width: 1100, height: 760 })
    await view.goto(origin + '/' + page + '.html')
    await view.locator(main).waitFor()
    await leftRight(view, sidebar, main)
    await view.setViewportSize({ width: 390, height: 780 })
    await leftRight(view, sidebar, main)
    await view.close()
  }

  const documents = await browser.newPage()
  await documents.goto(origin + '/files.html')
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
  await documents.close()

  const saved = await controlPage.evaluate(() => chrome.runtime.sendMessage({
    kind: 'saveWord', word: 'curiosity', translation: '好奇心', context: 'Curiosity helps us learn.',
  }))
  assert.equal(saved.ok, true)
  const review = await browser.newPage()
  await review.goto(origin + '/review.html')
  await review.locator('.card-word').filter({ hasText: 'curiosity' }).waitFor()
  await review.getByRole('button', { name: '显示释义', exact: true }).click()
  await review.locator('.grade-btn.good').click()
  const words = await controlPage.evaluate(() => chrome.runtime.sendMessage({ kind: 'getWords' }))
  assert.equal(words.data.find(word => word.word === 'curiosity').card.reps, 1)
  await review.close()

  // Hostname, player, bridge and scripts match production. Network data is deterministic.
  await browser.route('https://www.youtube.com/**', async route => {
    const url = new URL(route.request().url())
    if (url.pathname === '/api/timedtext') {
      await route.fulfill({ json: { events: [{ tStartMs: 0, dDurationMs: 30_000, segs: [{ utf8: 'Learn something new every day.' }] }] } })
      return
    }
    if (url.pathname === '/fixture-player.js') {
      await route.fulfill({ contentType: 'application/javascript', body: `
        document.querySelector('#movie_player').getPlayerResponse = () => ({
          videoDetails: { videoId: new URLSearchParams(location.search).get('v') },
          captions: { playerCaptionsTracklistRenderer: { captionTracks: [{baseUrl:'https://www.youtube.com/api/timedtext?v=fixture',languageCode:'en'}] } }
        });
      ` })
      return
    }
    await route.fulfill({
      contentType: 'text/html',
      headers: { 'content-security-policy': "script-src 'self'; require-trusted-types-for 'script'" },
      body: '<!doctype html><html><head><title>Video fixture</title></head><body style="margin:0;background:#faf9f4"><div id="movie_player" style="position:relative;width:900px;height:506px;background:#19251e"><video class="html5-main-video"></video><div class="ytp-right-controls" style="position:absolute;right:16px;bottom:0;height:48px"><button class="ytp-subtitles-button" aria-pressed="true">CC</button></div></div><script src="/fixture-player.js"></script></body></html>',
    })
  })
  await config({ subtitles: { enabled: true, youtube: false, meet: true }, general: { ...stored['tv:config_v1'].general, targetLang: 'zh-CN' } })
  const video = await browser.newPage()
  await video.setViewportSize({ width: 1100, height: 720 })
  await video.goto('https://www.youtube.com/watch?v=fixture')
  const ft = video.getByRole('button', { name: /Foxtranslate/ })
  await ft.waitFor()
  assert.equal(await ft.getAttribute('aria-pressed'), 'false')
  await ft.click()
  await video.locator('#tv-yt-subtitle-host').waitFor()
  await video.locator('#tv-yt-subtitle-host .tv-trans').waitFor()
  await video.getByText('译文 · Learn something new every day.', { exact: true }).waitFor()
  assert.equal(await ft.getAttribute('aria-pressed'), 'true')
  await capture(video, 'foxtranslate-youtube')
  await ft.click()
  await video.waitForFunction(() => !document.querySelector('#tv-yt-subtitle-host'))
  assert.equal(await video.locator('#tv-yt-native-cap-hide').count(), 0)
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
      console.log('LIVE YOUTUBE · FT button mounted in the current player controls')
      await capture(live, 'foxtranslate-youtube-live')
    } catch (error) {
      console.log('LIVE YOUTUBE · external page verification unavailable: ' + error.message.split('\n')[0])
      await capture(live, 'foxtranslate-youtube-live-unavailable')
    }
  }
  console.log('PASS · onboarding, persistence, translation/restore, keyboard, locales, document export, vocabulary review, left/right layouts, YouTube toggle, CSP bridge, SPA and player reattachment')
} finally {
  await browser?.close()
  await new Promise(done => fixture.close(done))
  await rm(profile, { recursive: true, force: true })
}
