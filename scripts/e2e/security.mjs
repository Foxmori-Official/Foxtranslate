import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { chooseTrustedOption, selectParagraph } from './helpers.mjs'

const fixture = createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.end(`<!doctype html><html lang="en"><title>Security fixture</title><main>
    <p id="paragraph">This paragraph contains useful information about language learning.</p>
    <p>Language learning language learning language learning.</p><textarea id="input"></textarea></main>
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
const profile = await mkdtemp(join(tmpdir(), 'foxtranslate-security-'))
const extension = resolve(process.env.FOXTRANSLATE_EXTENSION_DIR || 'dist')
let browser
try {
  browser = await chromium.launchPersistentContext(profile, { channel: 'chromium', executablePath: process.env.FOXTRANSLATE_TEST_CHROMIUM, headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] })
  browser.setDefaultTimeout(10_000)
  await browser.route(/^https?:\/\/(?!127\.0\.0\.1)/, route => route.abort())
  const worker = browser.serviceWorkers()[0] ?? await browser.waitForEvent('serviceworker')
  const origin = 'chrome-extension://' + new URL(worker.url()).host
  await worker.evaluate(() => {
    const realFetch = globalThis.fetch
    globalThis.securityCalls = 0
    globalThis.fetch = async (url, init) => {
      if (String(url) === 'https://api.foxmori.com/v1/chat/completions') {
        if (new Headers(init?.headers).get('Authorization') !== 'Bearer security-fixture-key') throw new Error('Unexpected fixture credential')
        globalThis.securityCalls++
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
  console.log('PASS · untrusted selection/input/hover/hotkeys/controls blocked; trusted selection, language changes, AI and input work; statistics preserve highlights')
} finally {
  if (browser) await browser.close()
  fixture.close()
  await rm(profile, { recursive: true, force: true })
}
