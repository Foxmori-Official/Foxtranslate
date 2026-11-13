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
  res.end(`<!doctype html><html lang="en"><title>Security fixture</title><main>
    <p id="paragraph">This paragraph contains useful information about language learning.</p>
    <p>Language learning language learning language learning.</p><textarea id="input"></textarea>${longPage}</main>
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
  manifest.content_scripts.push({ matches: ['http://127.0.0.1/*'], js: ['security-probe.js'], run_at: 'document_idle' })
  await writeFile(manifestPath, JSON.stringify(manifest))
  await writeFile(join(extension, 'security-probe.js'), `
    if (location.pathname === '/permissions') document.addEventListener('fixture:probe', async () => {
      const report = {};
      for (const kind of ['getConfig','getPageConfig','getWords','getHighlights','foxmoriAccount','setConfig','setSubtitlePreferences']) {
        const result = await chrome.runtime.sendMessage({kind,patch:{uiLang:'de',youtube:false}});
        report[kind] = {ok: result.ok, data: kind === 'getPageConfig' || kind === 'getHighlights' ? result.data : undefined};
      }
      try { report.storageAccessible = !!(await chrome.storage.local.get('tv:config_v1'))['tv:config_v1']; }
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
        if (text.includes('Delayed audit paragraph') && globalThis.delayTranslation) {
          globalThis.markDelayedStarted()
          await globalThis.delayTranslation
        }
        return Response.json({ choices: [{ message: { content: 'Security fixture translation' } }] })
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
  const page = await browser.newPage()
  await page.goto(address + '/permissions')
  await page.locator('.tv-ball').waitFor()
  await page.evaluate(() => document.dispatchEvent(new Event('fixture:probe')))
  await page.waitForFunction(() => document.body.dataset.fixtureReport)
  const access = await page.evaluate(() => JSON.parse(document.body.dataset.fixtureReport))
  for (const kind of ['getConfig','getWords','foxmoriAccount','setConfig','setSubtitlePreferences']) assert.equal(access[kind].ok, false, kind)
  assert.equal(access.storageAccessible, false)
  assert.equal(access.storageWritable, false)
  assert.equal(access.getPageConfig.ok, true)
  assert.equal(access.getPageConfig.data.uiLang, 'zh-CN')
  assert.equal(access.getPageConfig.data.engine.provider, 'foxmori')
  assert.ok(access.getPageConfig.data.engine.choices.some(choice => choice.id === 'foxmori'))
  assert.ok(!JSON.stringify(access.getPageConfig.data).includes('security-fixture-key'))
  assert.deepEqual(access.getHighlights.data, [])
  await page.goto(address + '/attack')
  // Do not evaluate scripts in this page before its autonomous attack: DevTools evaluation
  // can itself grant temporary user activation and would weaken this regression test.
  await new Promise(resolve => setTimeout(resolve, 1200))
  assert.equal(await page.evaluate(() => window.attackActivation), false)
  assert.equal(await worker.evaluate(() => globalThis.securityCalls), 0)
  assert.equal(await page.locator('.tv-sel-popup').count(), 0)
  assert.equal(await page.locator('tv-translation').count(), 0)

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
  console.log('PASS · synthetic actions blocked, management and storage isolated, trusted input and hot config updates work, highlights stable, offscreen and dynamic translation stay viewport-bound')
} finally {
  if (browser) await browser.close()
  fixture.close()
  await rm(temp, { recursive: true, force: true })
}
