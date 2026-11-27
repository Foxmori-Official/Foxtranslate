import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createServer } from 'node:http'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { chooseTrustedOption, selectParagraph } from './helpers.mjs'

const fixture = createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  const longPage = req.url === '/long'
    ? '<div style="height:4000px" aria-hidden="true"></div><p id="offscreen">Offscreen audit text is only translated after scrolling.</p>' : ''
  const retryPage = req.url === '/retry' ? [1, 2, 3].map(i =>
    '<p id="retry-' + i + '">Retry audit paragraph number ' + i + ' contains useful public information.</p>').join('') : ''
  res.end(`<!doctype html><html lang="en"><title>Security fixture</title><main>
    <p id="paragraph">This paragraph contains useful information about language learning.</p>
    <p>Language learning language learning language learning.</p><textarea id="input"></textarea>
    ${req.url === '/interactions' ? '<div id="hover-div"><span>This div contains a line for modifier hover testing.</span></div>' : ''}
    ${longPage}${retryPage}</main>
    <script>
      window.attackActivation = null;
      if (location.pathname === '/attack') setTimeout(() => {
        window.attackActivation = navigator.userActivation.hasBeenActive;
        const paragraph = document.querySelector('#paragraph');
        getSelection().selectAllChildren(paragraph);
        paragraph.dispatchEvent(new MouseEvent('pointerup', {button:0,bubbles:true}));
        paragraph.dispatchEvent(new MouseEvent('mouseover', {altKey:true,bubbles:true}));
        const input = document.createElement('textarea'); input.hidden = true; input.value = 'untrusted text'; document.body.append(input);
        input.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter',altKey:true,bubbles:true}));
        document.dispatchEvent(new KeyboardEvent('keydown', {key:'t',altKey:true,bubbles:true}));
        document.dispatchEvent(new CustomEvent('tv:compare'));
        const ball = document.querySelector('.tv-ball');
        ball?.dispatchEvent(new MouseEvent('mousedown', {bubbles:true}));
        document.dispatchEvent(new MouseEvent('mouseup', {bubbles:true}));
        ball?.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter',bubbles:true}));
      }, 400);
    </script></html>`)
})
await new Promise(done => fixture.listen(0, '127.0.0.1', done))
const address = `http://127.0.0.1:${fixture.address().port}`
const temp = await mkdtemp(join(tmpdir(), 'foxtranslate-security-'))
const profile = join(temp, 'profile')
const extension = join(temp, 'extension')
let browser
try {
  // A test-only isolated content script can exercise the same message/storage permissions as
  // the real content script. The shipped bundle and manifest are never modified.
  await cp(resolve(process.env.FOXTRANSLATE_EXTENSION_DIR || 'dist'), extension, { recursive: true })
  const manifestPath = join(extension, 'manifest.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  manifest.content_scripts.push({ matches: ['http://127.0.0.1/*', 'https://foxmori.com/*'], js: ['security-probe.js'], run_at: 'document_idle' })
  await writeFile(manifestPath, JSON.stringify(manifest))
  const backgroundPath = join(extension, 'background.js')
  const background = await readFile(backgroundPath, 'utf8')
  await writeFile(backgroundPath, `
    const nativeCreateMenu = chrome.contextMenus.create.bind(chrome.contextMenus);
    globalThis.fixtureMenus = new Map();
    chrome.contextMenus.create = (properties, callback) => {
      globalThis.fixtureMenus.set(properties.id, properties);
      return nativeCreateMenu(properties, callback);
    };
    const nativeAddMenuListener = chrome.contextMenus.onClicked.addListener.bind(chrome.contextMenus.onClicked);
    chrome.contextMenus.onClicked.addListener = listener => {
      globalThis.fixtureMenuClick = listener;
      nativeAddMenuListener(listener);
    };
  ` + background)
  await writeFile(join(extension, 'security-probe.js'), `
    if (location.pathname === '/permissions') document.addEventListener('fixture:probe', async () => {
      const report = {};
      for (const kind of ['getConfig','getPageConfig','getWords','getHighlights','foxmoriLogin','foxmoriAccount','savedFoxmoriAccount','foxmoriCreateKey','clearTranslationCache','setConfig','setSubtitlePreferences']) {
        const result = await chrome.runtime.sendMessage({kind,accountId:12,groupId:7,patch:{uiLang:'en',youtube:false}});
        report[kind] = {ok: result.ok, data: kind === 'getPageConfig' || kind === 'getHighlights' ? result.data : undefined};
      }
      try { report.storageAccessible = Object.keys(await chrome.storage.local.get(['tv:config_v1','tv:foxmori_account_v1'])).length > 0; }
      catch { report.storageAccessible = false; }
      try { await chrome.storage.local.set({ 'tv:fixture-probe': true }); report.storageWritable = true; }
      catch { report.storageWritable = false; }
      document.body.dataset.fixtureReport = JSON.stringify(report);
    });
  `)
  browser = await chromium.launchPersistentContext(profile, { channel: 'chromium', executablePath: process.env.FOXTRANSLATE_TEST_CHROMIUM, headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] })
  browser.setDefaultTimeout(10_000)
  await browser.route(/^https?:\/\/(?!127\.0\.0\.1)/, route => route.abort())
  const worker = browser.serviceWorkers()[0] ?? await browser.waitForEvent('serviceworker')
  const origin = 'chrome-extension://' + new URL(worker.url()).host
  await worker.evaluate(() => {
    const realFetch = globalThis.fetch
    globalThis.securityCalls = 0
    globalThis.securityTexts = []
    globalThis.fetch = async (url, init) => {
      if (String(url) === 'https://api.foxmori.com/v1/chat/completions') {
        if (new Headers(init?.headers).get('Authorization') !== 'Bearer security-fixture-key') throw new Error('Unexpected fixture credential')
        globalThis.securityCalls++
        const text = JSON.parse(init.body).messages.at(-1).content
        globalThis.securityTexts.push(text)
        if (globalThis.failRetryAudit && /Retry audit paragraph number [12]/.test(text)) return new Response('', { status: 524 })
        if (text.includes('Delayed audit paragraph') && globalThis.delayTranslation) {
          globalThis.markDelayedStarted()
          await globalThis.delayTranslation
        }
        return Response.json({ choices: [{ message: { content: 'Security fixture translation' } }] })
      }
      if (String(url).startsWith('https://edge.microsoft.com/translate/translatetext?')) {
        return Response.json([{ translations: [{ text: 'Microsoft fixture translation' }] }])
      }
      if (/^https?:/.test(String(url))) throw new Error('External network is disabled during security acceptance')
      return realFetch(url, init)
    }
  })
  const control = await browser.newPage()
  await control.goto(origin + '/options.html')
  const send = request => control.evaluate(async request => {
    const response = await chrome.runtime.sendMessage(request)
    if (!response.ok) throw new Error(response.error)
    return response.data
  }, request)
  const config = await send({ kind: 'getConfig' })
  config.engine.provider = 'foxmori'
  config.engine.keys.foxmori = 'security-fixture-key'
  config.engine.foxmori.model = 'security-fixture-model'
  config.batch.enabled = false
  config.uiLang = 'zh-CN'
  await send({ kind: 'setConfig', patch: config })
  await worker.evaluate(() => chrome.storage.local.set({
    'tv:foxmori_account_v1': {
      authenticated: true, user: { id: 12, email: 'private-fixture@example.test', username: 'Fixture' }, groups: [],
    },
  }))
  let consoleCalls = 0
  await browser.route('https://foxmori.com/**', route => {
    if (new URL(route.request().url()).pathname === '/permissions') {
      return route.fulfill({ contentType: 'text/html', body: '<title>Foxmori security fixture</title><p>Fixture</p>' })
    }
    consoleCalls++
    return route.abort()
  })
  const page = await browser.newPage()
  for (const url of [address + '/permissions', 'https://foxmori.com/permissions']) {
    await page.goto(url)
    await page.locator('.tv-ball').waitFor()
    await page.evaluate(() => document.dispatchEvent(new Event('fixture:probe')))
    await page.waitForFunction(() => document.body.dataset.fixtureReport)
    const access = await page.evaluate(() => JSON.parse(document.body.dataset.fixtureReport))
    for (const kind of ['getConfig','getWords','foxmoriLogin','foxmoriAccount','savedFoxmoriAccount','foxmoriCreateKey','clearTranslationCache','setConfig','setSubtitlePreferences']) assert.equal(access[kind].ok, false, kind)
    assert.equal(access.storageAccessible, false)
    assert.equal(access.storageWritable, false)
    assert.equal(access.getPageConfig.ok, true)
    assert.equal(access.getPageConfig.data.uiLang, 'zh-CN')
    assert.equal(access.getPageConfig.data.engine.provider, 'foxmori')
    assert.ok(access.getPageConfig.data.engine.choices.some(choice => choice.id === 'foxmori'))
    assert.doesNotMatch(JSON.stringify(access.getPageConfig.data), /security-fixture-key|private-fixture@example\.test/)
    assert.deepEqual(access.getHighlights.data, [])
  }
  assert.equal(consoleCalls, 0)
  await page.goto(address + '/attack')
  // Do not evaluate scripts in this page before its autonomous attack: DevTools evaluation
  // can itself grant temporary user activation and would weaken this regression test.
  await new Promise(resolve => setTimeout(resolve, 1200))
  assert.equal(await page.evaluate(() => window.attackActivation), false)
  assert.equal(await worker.evaluate(() => globalThis.securityCalls), 0)
  assert.equal(await page.locator('.tv-sel-popup').count(), 0)
  assert.equal(await page.locator('tv-translation').count(), 0)

  const interactions = await browser.newPage()
  await interactions.goto(address + '/interactions')
  await interactions.locator('.tv-ball').waitFor()
  await interactions.locator('#paragraph').hover()
  await interactions.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Alt', altKey: true, bubbles: true })))
  assert.equal(await worker.evaluate(() => globalThis.securityCalls), 0)
  // A real modifier press must work after the cursor has stopped moving.
  await interactions.keyboard.press('Alt')
  await interactions.locator('#paragraph tv-translation').filter({ hasText: 'Security fixture translation' }).waitFor()
  // A real move while holding the modifier must also work on a non-semantic block.
  await interactions.keyboard.down('Alt')
  const hoverText = await interactions.locator('#hover-div span').boundingBox()
  await interactions.mouse.move(hoverText.x + hoverText.width / 2, hoverText.y + hoverText.height / 2)
  await interactions.locator('#hover-div tv-translation').filter({ hasText: 'Security fixture translation' }).waitFor()
  await interactions.keyboard.up('Alt')

  const menuId = 'tv-translate-selection'
  const menu = await worker.evaluate(id => globalThis.fixtureMenus.get(id), menuId)
  assert.deepEqual(menu?.contexts, ['selection'])
  assert.ok(menu?.title.includes('Foxtranslate'))
  await send({ kind: 'setConfig', patch: { selection: { ...config.selection, enabled: false } } })
  await interactions.reload()
  await interactions.locator('.tv-ball').waitFor()
  await interactions.evaluate(() => {
    document.querySelector('#paragraph').style.marginTop = '220px'
    document.body.style.minHeight = '1800px'
  })
  await selectParagraph(interactions)
  const text = await interactions.evaluate(() => getSelection().toString().trim())
  assert.match(text, /language learning/)
  await new Promise(resolve => setTimeout(resolve, 300))
  assert.equal(await interactions.locator('.tv-sel-popup').count(), 0)
  await interactions.bringToFront()
  const tab = await worker.evaluate(async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0])
  assert.ok(tab?.id != null)
  const menuMessage = { kind: 'translateSelectedText', text, pageUrl: interactions.url() }
  await control.evaluate(({ id, message }) => chrome.tabs.sendMessage(id, message), { id: tab.id, message: menuMessage })
  assert.equal(await interactions.locator('.tv-sel-popup').count(), 0)
  const selectedRect = await interactions.evaluate(() => {
    const { left, top, bottom, height } = getSelection().getRangeAt(0).getBoundingClientRect()
    // A page can clear the live range while handling the browser's contextmenu event.
    document.addEventListener('contextmenu', event => {
      event.preventDefault()
      getSelection().removeAllRanges()
    }, { once: true })
    return { left, top, bottom, height }
  })
  await interactions.mouse.click(selectedRect.left + 10, selectedRect.top + selectedRect.height / 2, { button: 'right' })
  assert.equal(await interactions.evaluate(() => getSelection().rangeCount), 0)
  await interactions.evaluate(() => scrollBy(0, 100))
  await worker.evaluate(({ menuId, tab, message }) => {
    globalThis.fixtureMenuClick({ menuItemId: menuId, selectionText: message.text, pageUrl: message.pageUrl }, tab)
  }, { menuId, tab, message: menuMessage })
  await interactions.locator('.tv-sel-translation').getByText('Security fixture translation', { exact: true }).waitFor()
  await interactions.locator('.tv-sel-popup').evaluate(async popup => {
    await Promise.all(popup.getAnimations().map(animation => animation.finished))
  })
  const menuPopup = await interactions.locator('.tv-sel-popup').boundingBox()
  assert.ok(Math.abs(menuPopup.x - Math.max(8, selectedRect.left)) <= 2)
  const scrollY = await interactions.evaluate(() => window.scrollY)
  assert.ok(Math.abs(menuPopup.y - (selectedRect.bottom - scrollY + 8)) <= 2, JSON.stringify({ menuPopup, selectedRect, scrollY }))
  await interactions.close()
  await send({ kind: 'setConfig', patch: { selection: config.selection } })
  await page.goto(address + '/selection')
  await page.locator('.tv-ball').waitFor()

  await selectParagraph(page)
  const popup = page.locator('.tv-sel-popup')
  await popup.getByText('Security fixture translation', { exact: true }).waitFor()
  const before = await worker.evaluate(() => globalThis.securityCalls)
  await popup.evaluate(node => {
    node.querySelector('.tv-sel-target').value = 'ja'
    node.querySelector('.tv-sel-target').dispatchEvent(new Event('change', { bubbles: true }))
    node.querySelector('.tv-sel-secondary').click()
    node.querySelector('.tv-sel-secondary').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: false }))
  })
  await new Promise(resolve => setTimeout(resolve, 300))
  assert.equal(await worker.evaluate(() => globalThis.securityCalls), before)
  await chooseTrustedOption(popup.locator('.tv-sel-target'), 'fr')
  await popup.getByText('Security fixture translation', { exact: true }).waitFor()
  await popup.getByRole('button', { name: 'AI 解析', exact: true }).click()
  await popup.locator('.tv-sel-ai-result').filter({ hasText: 'Security fixture translation' }).waitFor()
  assert.equal(await worker.evaluate(() => globalThis.securityCalls), before + 5)
  await popup.getByRole('button', { name: '关闭', exact: true }).click()

  const input = page.locator('#input')
  await input.fill('A real keyboard request')
  await input.press('Alt+Enter')
  await page.waitForFunction(() => document.querySelector('#input').value === 'Security fixture translation')
  const inputCalls = await worker.evaluate(() => globalThis.securityCalls)
  assert.equal(inputCalls, before + 6)
  await page.evaluate(() => {
    const input = document.querySelector('#input')
    input.value = 'Another untrusted request after real user activity'
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', altKey: true, bubbles: true }))
  })
  await new Promise(resolve => setTimeout(resolve, 100))
  assert.equal(await worker.evaluate(() => globalThis.securityCalls), inputCalls)

  config.learning.highlightOnPage = true
  await send({ kind: 'setConfig', patch: { learning: config.learning } })
  await send({ kind: 'saveWord', word: 'language', translation: '语言' })
  await page.goto(address + '/highlight')
  await page.locator('mark.tv-hl').first().waitFor()
  await page.evaluate(() => {
    window.initialMarks = Array.from(document.querySelectorAll('mark.tv-hl'))
    window.removedMarks = 0
    new MutationObserver(records => {
      for (const record of records) for (const node of record.removedNodes) {
        if (node.nodeType === 1 && node.matches('mark.tv-hl')) window.removedMarks++
      }
    }).observe(document.body, { childList: true, subtree: true })
  })
  for (let n = 0; n < 6; n++) await send({ kind: 'translate', text: 'Statistics regression ' + n, targetLang: 'zh-CN' })
  await new Promise(resolve => setTimeout(resolve, 2200))
  const marks = await page.evaluate(() => ({ removed: window.removedMarks, preserved: window.initialMarks.every(node => node.isConnected) }))
  assert.deepEqual(marks, { removed: 0, preserved: true })
  assert.ok((await send({ kind: 'getStats' })).translatedChars > 0)
  await send({ kind: 'setConfig', patch: { learning: { enabled: true, highlightOnPage: false } } })
  await page.locator('mark.tv-hl').first().waitFor({ state: 'detached' })

  await page.goto(address + '/long')
  const ball = page.locator('.tv-ball')
  await ball.click()
  await page.locator('#paragraph tv-translation').waitFor()
  // Offscreen source stays out of the background queue until near the viewport.
  const beforeScroll = await worker.evaluate(() => globalThis.securityTexts.some(text => text.includes('Offscreen audit text')))
  assert.equal(beforeScroll, false)
  await page.locator('#offscreen').scrollIntoViewIfNeeded()
  await page.locator('#offscreen tv-translation').waitFor()
  await page.evaluate(() => {
    const anchor = document.getElementById('offscreen')
    for (let i = 0; i < 2; i++) setTimeout(() => {
      const paragraph = document.createElement('p'); paragraph.id = 'dynamic-' + i
      paragraph.textContent = 'Dynamic audit paragraph number ' + i + ' arrives independently.'
      anchor.after(paragraph)
    }, i * 40)
  })
  await page.locator('#dynamic-0 tv-translation').waitFor()
  await page.locator('#dynamic-1 tv-translation').waitFor()
  await ball.click()
  await page.locator('tv-translation').first().waitFor({ state: 'detached' })
  await ball.click()
  await page.locator('#offscreen tv-translation').waitFor()
  // A result arriving after the user restores the original page must not reinsert a translation.
  await worker.evaluate(() => {
    globalThis.delayedStarted = new Promise(resolve => { globalThis.markDelayedStarted = resolve })
    globalThis.delayTranslation = new Promise(resolve => { globalThis.releaseDelayed = resolve })
  })
  await page.evaluate(() => {
    const paragraph = document.createElement('p')
    paragraph.id = 'delayed'
    paragraph.textContent = 'Delayed audit paragraph for restoring original text.'
    document.getElementById('offscreen').after(paragraph)
  })
  await worker.evaluate(() => Promise.race([
    globalThis.delayedStarted,
    new Promise((_resolve, reject) => setTimeout(() => reject(new Error('Delayed paragraph was not scheduled')), 5000)),
  ]))
  await ball.click()
  await worker.evaluate(() => globalThis.releaseDelayed())
  await page.locator('#delayed [data-tv-loading]').waitFor({ state: 'detached' })
  await page.waitForTimeout(150)
  assert.equal(await page.locator('#delayed tv-translation').count(), 0)
  await worker.evaluate(() => { globalThis.failRetryAudit = true })
  const retryPage = await browser.newPage()
  await retryPage.goto(address + '/retry')
  await retryPage.locator('.tv-ball').click()
  await retryPage.locator('#retry-1 [data-tv-error]').waitFor()
  await retryPage.locator('#retry-2 [data-tv-error]').waitFor()
  await retryPage.locator('#retry-3 tv-translation').waitFor()
  const beforeRetry = await worker.evaluate(() => globalThis.securityTexts.length)
  await retryPage.locator('#retry-1 .tv-error-retry').evaluate(button => button.click())
  assert.equal(await worker.evaluate(() => globalThis.securityTexts.length), beforeRetry)
  // A failed paragraph moved outside the viewport must still join the retry wave.
  await retryPage.locator('#retry-2').evaluate(el => { el.style.marginTop = '4000px' })
  await worker.evaluate(() => { globalThis.failRetryAudit = false })
  await retryPage.locator('#retry-1 .tv-error-retry').click()
  await retryPage.locator('#retry-1 tv-translation').waitFor()
  await retryPage.locator('#retry-2 tv-translation').waitFor()
  const retried = await worker.evaluate(start => globalThis.securityTexts.slice(start), beforeRetry)
  assert.equal(retried.filter(text => text.includes('Retry audit paragraph number 1')).length, 1)
  assert.equal(retried.filter(text => text.includes('Retry audit paragraph number 2')).length, 1)
  assert.equal(retried.filter(text => text.includes('Retry audit paragraph number 3')).length, 0)

  const cachedText = 'Cache audit public text for checking the clear button.'
  await send({ kind: 'translate', text: cachedText, targetLang: 'zh-CN' })
  let cacheCalls = await worker.evaluate(() => globalThis.securityCalls)
  await send({ kind: 'translate', text: cachedText, targetLang: 'zh-CN' })
  assert.equal(await worker.evaluate(() => globalThis.securityCalls), cacheCalls)
  const retained = await worker.evaluate(() => chrome.storage.local.get(['tv:config_v1', 'tv:words_v1']))
  const privacy = await browser.newPage()
  await privacy.goto(origin + '/options.html?uiLang=zh-CN#privacy')
  await privacy.getByRole('button', { name: '清除翻译缓存', exact: true }).click()
  await privacy.getByText('翻译缓存已清除', { exact: true }).waitFor()
  assert.deepEqual(await worker.evaluate(async () => (await chrome.storage.local.get('tv:cache_v1'))['tv:cache_v1']), {})
  assert.deepEqual(await worker.evaluate(() => chrome.storage.local.get(['tv:config_v1', 'tv:words_v1'])), retained)
  cacheCalls = await worker.evaluate(() => globalThis.securityCalls)
  await send({ kind: 'translate', text: cachedText, targetLang: 'zh-CN' })
  assert.equal(await worker.evaluate(() => globalThis.securityCalls), cacheCalls + 1)
  await privacy.goto(origin + '/options.html?uiLang=en#privacy')
  await privacy.getByRole('button', { name: 'Clear translation cache', exact: true }).waitFor()

  await send({ kind: 'setConfig', patch: { general: { ...config.general, targetLang: 'ja' } } })
  await worker.evaluate(() => { globalThis.failRetryAudit = true })
  const switchPage = await browser.newPage()
  await switchPage.goto(address + '/retry')
  await switchPage.locator('.tv-ball').click()
  await switchPage.locator('#retry-1 [data-tv-error]').waitFor()
  await switchPage.locator('#retry-2 [data-tv-error]').waitFor()
  await switchPage.locator('#retry-3 tv-translation').getByText('Security fixture translation').waitFor()
  await send({ kind: 'setConfig', patch: { engine: { ...config.engine, provider: 'bing' } } })
  await switchPage.locator('#retry-1 tv-translation').getByText('Microsoft fixture translation').waitFor()
  await switchPage.locator('#retry-2 tv-translation').getByText('Microsoft fixture translation').waitFor()
  assert.match(await switchPage.locator('#retry-3 tv-translation').innerText(), /Security fixture translation/)
  assert.equal(await switchPage.locator('[data-tv-error]').count(), 0)
  console.log('PASS · cache clearing, page-wide failed retries, engine switching, trusted controls, management/storage isolation and viewport translation')
} finally {
  if (browser) await browser.close()
  fixture.close()
  await rm(temp, { recursive: true, force: true })
}
