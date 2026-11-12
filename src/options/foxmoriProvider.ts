import type { Config } from '../shared/config'
import type { FoxmoriAccount } from '../shared/foxmori'
import { FOXMORI_API } from '../shared/foxmori'
import type { BgRequest } from '../shared/protocol'
import { featureCopy } from '../shared/featureCopy'

interface Context {
  config: () => Config
  send: <T>(request: BgRequest) => Promise<T>
  saveEngine: (update: (engine: Config['engine']) => Config['engine']) => Promise<void>
  reload: () => Promise<void>
}

let account: FoxmoriAccount | null = null
let keyConfigured = false
let awaitingLogin = false
let refreshOnReturn: (() => void) | null = null
if (typeof window !== 'undefined') {
  window.addEventListener('focus', () => refreshOnReturn?.())
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshOnReturn?.()
  })
}

function node<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag)
  if (cls) element.className = cls
  if (text) element.textContent = text
  return element
}

function button(text: string, primary = false): HTMLButtonElement {
  const element = node('button', primary ? 'btn' : 'btn btn-secondary', text)
  element.type = 'button'
  return element
}

function field(label: string, control: HTMLElement, cls = ''): HTMLElement {
  const row = node('div', 'field ' + cls)
  const target = control.matches('input,select') ? control : control.querySelector('input,select')
  const caption = target ? node('label', 'field-label', label) : node('span', 'field-label', label)
  if (target && caption instanceof HTMLLabelElement) {
    target.id = 'fox-provider-' + crypto.randomUUID()
    caption.htmlFor = target.id
  }
  row.append(caption, control)
  return row
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function renderModelField(provider: 'foxmori' | 'openai' | 'deepseek', ctx: Context): HTMLElement {
  const copy = (key: Parameters<typeof featureCopy>[0]) => featureCopy(key, ctx.config().uiLang)
  const wrap = node('div', 'provider-model')
  const actions = node('div', 'model-actions')
  const controls = node('div', 'provider-model-controls')
  const input = node('input', 'control provider-model-input')
  input.value = ctx.config().engine[provider].model
  input.placeholder = copy('modelPlaceholder')
  input.spellcheck = false

  function save(value: string): Promise<void> {
    return ctx.saveEngine(engine => ({ ...engine, [provider]: { ...engine[provider], model: value } }))
  }

  const fetch = button(copy('fetchModels'))
  const pick = node('select', 'control model-picker')
  const status = node('p', 'hint model-status')
  pick.hidden = true
  pick.setAttribute('aria-label', copy('chooseModel'))
  status.setAttribute('role', 'status')
  fetch.addEventListener('click', async () => {
    fetch.disabled = true
    fetch.textContent = copy('fetchingModels')
    status.textContent = ''
    status.setAttribute('role', 'status')
    pick.hidden = true
    try {
      const models = await ctx.send<string[]>({ kind: 'fetchModels', provider })
      if (!wrap.isConnected) return
      const placeholder = node('option', '', copy('chooseModel'))
      placeholder.value = ''
      pick.replaceChildren(placeholder)
      for (const model of models) {
        const option = node('option', '', model)
        option.value = model
        pick.append(option)
      }
      pick.value = models.includes(input.value) ? input.value : ''
      pick.hidden = false
      status.textContent = copy('modelsReady')
      pick.focus()
    } catch (error) {
      status.setAttribute('role', 'alert')
      status.textContent = message(error)
    } finally {
      fetch.disabled = false
      fetch.textContent = copy('fetchModels')
    }
  })
  input.addEventListener('change', () => { void save(input.value.trim()) })
  pick.addEventListener('change', () => {
    if (!pick.value) return
    input.value = pick.value
    void save(pick.value)
  })
  controls.append(input, fetch)
  actions.append(pick)
  wrap.append(field(copy('model'), controls, 'provider-model-row'), actions, status)
  return wrap
}

export function renderFoxmoriAccount(ctx: Context, standalone = false): HTMLElement {
  const copy = (key: Parameters<typeof featureCopy>[0]) => featureCopy(key, ctx.config().uiLang)
  const panel = node('section', standalone ? 'card fox-account fox-account-page' : 'fox-account')
  const header = node('div', 'fox-account-header')
  const logo = node('img', 'account-logo')
  logo.src = chrome.runtime.getURL('icons/icon48.png')
  logo.alt = ''
  logo.width = logo.height = 36
  const title = node('div')
  title.append(node(standalone ? 'h2' : 'h3', 'account-title', copy(standalone ? 'accountConnection' : 'account')))
  header.append(logo, title)

  const accountBody = node('div', 'fox-account-body')
  const toolbar = node('div', 'toolbar')
  const login = button(copy('login'), !account)
  const connectButton = button(copy('connect'))
  const status = node('p', 'hint account-status')
  if (keyConfigured && ctx.config().engine.keys.foxmori) {
    status.textContent = copy(standalone ? 'accountKeyCreated' : 'keyCreated')
  }
  status.setAttribute('role', 'status')
  let connecting = false

  function renderAccount(): void {
    accountBody.replaceChildren()
    login.classList.toggle('btn-secondary', Boolean(account))
    login.textContent = copy(account?.user ? (account.groups.length ? 'openConsole' : 'viewSubscriptions') : 'login')
    if (!account?.user) {
      accountBody.append(node('p', 'hint', copy('loginHint')))
      return
    }
    const accountId = account.user.id
    accountBody.append(node('p', 'account-identity', account.user.email || account.user.username || 'Foxmori'))
    if (!account.groups.length) {
      accountBody.append(node('p', 'hint', copy('noGroups')))
      return
    }

    accountBody.append(node('p', 'hint', copy('accountHint')))
    const groups = node('select', 'control fox-account-groups')
    const empty = node('option', '', copy('selectGroup'))
    empty.value = ''
    groups.append(empty)
    for (const group of account.groups) {
      const option = node('option', '', group.name)
      option.value = String(group.id)
      groups.append(option)
    }
    if (account.groups.length === 1) groups.value = String(account.groups[0].id)
    const create = button(copy('createKey'), true)
    create.disabled = !groups.value
    groups.addEventListener('change', () => { create.disabled = !groups.value })
    create.addEventListener('click', async () => {
      create.disabled = true
      groups.disabled = true
      create.textContent = copy('creatingKey')
      status.textContent = ''
      try {
        await ctx.send({ kind: 'foxmoriCreateKey', groupId: Number(groups.value), accountId })
        keyConfigured = true
        await ctx.reload()
      } catch (error) {
        status.textContent = message(error)
        status.setAttribute('role', 'alert')
      } finally {
        create.disabled = false
        groups.disabled = false
        create.textContent = copy('createKey')
      }
    })
    const actions = node('div', 'account-key-actions')
    actions.append(field(copy('group'), groups), create)
    accountBody.append(actions)
  }

  async function connect(): Promise<void> {
    if (connecting || !panel.isConnected) return
    connecting = true
    status.setAttribute('role', 'status')
    status.textContent = copy('connecting')
    connectButton.disabled = true
    try {
      const connected = await ctx.send<FoxmoriAccount>({ kind: 'foxmoriAccount' })
      if (!panel.isConnected) return
      account = connected
      awaitingLogin = false
      status.textContent = ''
    } catch (error) {
      if (!panel.isConnected) return
      account = null
      status.setAttribute('role', 'alert')
      status.textContent = message(error)
    } finally {
      renderAccount()
      connecting = false
      connectButton.disabled = false
    }
  }

  refreshOnReturn = () => { if (awaitingLogin) void connect() }
  login.addEventListener('click', async () => {
    awaitingLogin = true
    login.disabled = true
    try {
      await ctx.send({ kind: 'foxmoriLogin' })
    } catch (error) {
      awaitingLogin = false
      status.setAttribute('role', 'alert')
      status.textContent = message(error)
    } finally {
      login.disabled = false
    }
  })
  connectButton.addEventListener('click', () => { void connect() })
  toolbar.append(login, connectButton)
  renderAccount()
  panel.append(header, accountBody, toolbar, status)
  return panel
}

export function renderFoxmoriProvider(area: HTMLElement, ctx: Context): void {
  const copy = (key: Parameters<typeof featureCopy>[0]) => featureCopy(key, ctx.config().uiLang)
  const secret = node('div', 'provider-key')
  const key = node('input', 'control')
  key.type = 'password'
  key.autocomplete = 'off'
  key.spellcheck = false
  key.value = ctx.config().engine.keys.foxmori
  key.placeholder = copy('keyPlaceholder')
  key.addEventListener('change', () => {
    const value = key.value.trim()
    keyConfigured = false
    void ctx.saveEngine(engine => ({ ...engine, keys: { ...engine.keys, foxmori: value } }))
  })
  const reveal = button(copy('show'))
  reveal.addEventListener('click', () => {
    key.type = key.type === 'password' ? 'text' : 'password'
    reveal.textContent = copy(key.type === 'password' ? 'show' : 'hide')
  })
  secret.append(key, reveal)
  area.append(
    renderFoxmoriAccount(ctx),
    field('API Base URL', node('span', 'field-static', FOXMORI_API)),
    field('API Key', secret, 'provider-key-row'),
    node('p', 'hint', copy('keyHint')),
    renderModelField('foxmori', ctx),
  )
}
