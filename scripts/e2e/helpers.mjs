import assert from 'node:assert/strict'

export async function selectParagraph(page, selector = '#paragraph') {
  // A real pointer gesture is essential: script-created ranges must never authorize translation.
  await page.locator(selector).click({ clickCount: 3 })
}

export async function chooseTrustedOption(select, value) {
  const handle = await select.elementHandle()
  const previous = await handle.evaluate(node => ({ size: node.size, style: node.style.cssText }))
  try {
    // Playwright selectOption dispatches an untrusted change. Render the same native control
    // as a listbox temporarily so Chromium on macOS and Linux can click a real option.
    await handle.evaluate(node => { node.size = Math.min(8, Math.max(2, node.options.length)); node.style.setProperty('height', 'auto', 'important') })
    const index = await handle.evaluate((node, wanted) => Array.from(node.options).findIndex(option => option.value === wanted), value)
    assert.ok(index >= 0, `Missing select option: ${value}`)
    const options = await handle.$$('option')
    await options[index].click()
    assert.equal(await handle.evaluate(node => node.value), value)
  } finally {
    await handle.evaluate((node, old) => { node.size = old.size; node.style.cssText = old.style }, previous)
  }
}
