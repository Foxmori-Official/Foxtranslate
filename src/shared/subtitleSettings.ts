import { DEFAULT_CONFIG, mergeSubtitlePreferences, type SubtitlePatch, type SubtitlePreferences } from './config'
import { featureCopy } from './featureCopy'

export function resetSubtitleStyle(): SubtitlePatch {
  const { backgroundColor, backgroundOpacity, edgeStyle, original, translation } = DEFAULT_CONFIG.subtitles
  return { backgroundColor, backgroundOpacity, edgeStyle, original, translation }
}

export function applyCaptionStyle(
  panel: HTMLElement,
  original: HTMLElement,
  translation: HTMLElement,
  preferences: SubtitlePreferences,
): void {
  panel.dataset.mode = preferences.displayMode
  panel.dataset.position = preferences.translationPosition
  panel.dataset.edge = preferences.edgeStyle
  panel.style.setProperty('--ft-caption-bg', 'color-mix(in srgb, ' + preferences.backgroundColor + ' ' + preferences.backgroundOpacity + '%, transparent)')
  for (const [line, settings] of [[original, preferences.original], [translation, preferences.translation]] as const) {
    line.style.color = settings.color
    line.style.fontFamily = settings.font === 'default' ? '' : settings.font
    line.style.fontWeight = String(settings.weight)
    line.style.setProperty('--ft-caption-scale', String(settings.size / 100))
  }
}

export const CAPTION_LINE_CSS = `
.ft-caption-lines { flex-direction: column; align-items: center; gap: 4px; text-align: center; }
.ft-caption-line { max-width: 100%; box-sizing: border-box; border-radius: 5px; padding: 2px 10px;
  color: #fff; background: var(--ft-caption-bg, #000b); white-space: pre-wrap; overflow-wrap: anywhere;
  font-size: calc(var(--ft-caption-base, 16px) * var(--ft-caption-scale, 1)); line-height: 1.35; }
.ft-caption-lines[data-position="above"] .ft-caption-translation { order: -1; }
.ft-caption-lines[data-mode="translationOnly"] .ft-caption-original { display: none; }
.ft-caption-lines[data-edge="shadow"] .ft-caption-line { text-shadow: 0 1px 3px #000, 0 1px 8px #000; }
.ft-caption-lines[data-edge="outline"] .ft-caption-line { -webkit-text-stroke: 2px #000; paint-order: stroke fill; }
`

function node<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag)
  if (cls) element.className = cls
  if (text) element.textContent = text
  return element
}

export function createCaptionPreview(lang: string, preferences: SubtitlePreferences) {
  const stage = node('div', 'caption-preview')
  stage.setAttribute('role', 'img')
  stage.setAttribute('aria-label', featureCopy('preview', lang))
  const lines = node('div', 'ft-caption-lines')
  const original = node('div', 'ft-caption-line ft-caption-original', featureCopy('previewOriginal', lang))
  const translation = node('div', 'ft-caption-line ft-caption-translation', featureCopy('previewTranslation', lang))
  lines.append(original, translation)
  const controls = node('div', 'caption-preview-bar')
  const icon = node('img')
  icon.src = chrome.runtime.getURL('icons/icon48.png')
  icon.alt = ''
  icon.width = icon.height = 20
  controls.append(node('span', 'caption-preview-track'), icon, node('span', 'caption-preview-close', '×'), node('span', 'caption-preview-cc', 'CC'))
  stage.append(lines, controls)
  const update = (next: SubtitlePreferences) => applyCaptionStyle(lines, original, translation, next)
  update(preferences)
  return { element: stage, update }
}

interface EditorOptions {
  preferences: SubtitlePreferences
  lang: string
  onChange: (patch: SubtitlePatch) => void
  onPreview?: (preferences: SubtitlePreferences) => void
  includeDisplay?: boolean
  includeStyle?: boolean
  allowReset?: boolean
}

type CopyKey = Parameters<typeof featureCopy>[0]
type Option = readonly [value: string, label: CopyKey]

export function renderSubtitlePreferences(options: EditorOptions): HTMLElement {
  const copy = (key: CopyKey) => featureCopy(key, options.lang)
  const root = node('div', 'caption-editor')
  let preferences = options.preferences
  const onPreview = (patch: SubtitlePatch) => {
    const draft = mergeSubtitlePreferences(preferences, patch)
    options.onPreview?.(draft)
  }
  const commit = (patch: SubtitlePatch) => {
    preferences = mergeSubtitlePreferences(preferences, patch)
    options.onPreview?.(preferences)
    options.onChange(patch)
  }

  function row(title: CopyKey, control: HTMLInputElement | HTMLSelectElement, value?: HTMLOutputElement) {
    const wrapper = node('label', 'caption-field')
    wrapper.append(node('span', '', copy(title)), value ?? control)
    if (value) wrapper.append(control)
    control.setAttribute('aria-label', copy(title))
    return wrapper
  }
  function select(title: CopyKey, value: string, choices: readonly Option[], change: (value: string) => void) {
    const input = node('select')
    for (const [id, key] of choices) {
      const option = node('option', '', copy(key))
      option.value = id
      input.append(option)
    }
    input.value = value
    input.addEventListener('change', () => change(input.value))
    return row(title, input)
  }
  function color(title: CopyKey, value: string, patch: (value: string) => SubtitlePatch) {
    const input = node('input')
    input.type = 'color'
    input.value = value
    input.addEventListener('input', () => onPreview(patch(input.value)))
    input.addEventListener('change', () => commit(patch(input.value)))
    return row(title, input)
  }
  function range(title: CopyKey, value: number, min: number, max: number, step: number, unit: string, patch: (value: number) => SubtitlePatch) {
    const input = node('input'), output = node('output', '', value + unit)
    input.type = 'range'
    input.min = String(min)
    input.max = String(max)
    input.step = String(step)
    input.value = String(value)
    input.addEventListener('input', () => {
      output.value = input.value + unit
      onPreview(patch(input.valueAsNumber))
    })
    input.addEventListener('change', () => commit(patch(input.valueAsNumber)))
    return row(title, input, output)
  }
  function group(title: CopyKey, fields: HTMLElement[]) {
    const element = node('fieldset', 'caption-style-group')
    element.append(node('legend', '', copy(title)), ...fields)
    return element
  }
  function textStyle(line: 'original' | 'translation', title: CopyKey) {
    const style = preferences[line]
    return group(title, [
      range('size', style.size, 50, 200, 5, '%', size => ({ [line]: { size } })),
      color('color', style.color, color => ({ [line]: { color } })),
      select('font', style.font, [['default', 'defaultFont'], ['sans-serif', 'sans'], ['serif', 'serif'], ['monospace', 'mono']],
        font => commit({ [line]: { font } })),
      range('weight', style.weight, 300, 800, 100, '', weight => ({ [line]: { weight } })),
    ])
  }

  function build(): void {
    root.replaceChildren()
    if (options.includeDisplay) {
      const display = node('div', 'caption-display-fields')
      const position = select('position', preferences.translationPosition, [['below', 'below'], ['above', 'above']], value => {
        commit({ translationPosition: value === 'above' ? 'above' : 'below' })
      })
      position.hidden = preferences.displayMode !== 'bilingual'
      display.append(
        select('displayType', preferences.displayMode, [['bilingual', 'bilingual'], ['translationOnly', 'translatedOnly']], value => {
          commit({ displayMode: value === 'translationOnly' ? 'translationOnly' : 'bilingual' })
          position.hidden = preferences.displayMode !== 'bilingual'
        }),
        position,
      )
      root.append(display)
    }
    if (options.includeStyle) {
      const grid = node('div', 'caption-style-groups')
      grid.append(
        group('commonStyle', [
          color('background', preferences.backgroundColor, backgroundColor => ({ backgroundColor })),
          range('opacity', preferences.backgroundOpacity, 0, 100, 5, '%', backgroundOpacity => ({ backgroundOpacity })),
          select('edge', preferences.edgeStyle, [['shadow', 'shadow'], ['outline', 'outline'], ['none', 'none']],
            edgeStyle => commit({ edgeStyle: edgeStyle === 'outline' || edgeStyle === 'none' ? edgeStyle : 'shadow' })),
        ]),
        textStyle('translation', 'translationStyle'),
        textStyle('original', 'originalStyle'),
      )
      root.append(grid)
      if (options.allowReset) {
        const reset = node('button', 'btn btn-secondary caption-reset', copy('reset'))
        reset.type = 'button'
        reset.addEventListener('click', () => { commit(resetSubtitleStyle()); build(); root.querySelector<HTMLButtonElement>('.caption-reset')?.focus() })
        root.append(reset)
      }
    }
  }
  build()
  return root
}

export const SUBTITLE_SETTINGS_CSS = CAPTION_LINE_CSS + `
.caption-editor { min-width: 0; }
.caption-editor [hidden] { display: none !important; }
.caption-field { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 8px; padding: 8px 0;
  min-height: 36px; font: inherit; cursor: default; }
.caption-field + .caption-field { border-top: 1px solid var(--caption-border, var(--tv-border)); }
.caption-field span { min-width: 0; overflow-wrap: anywhere; }
.caption-field select { width: auto; max-width: min(160px, 100%); padding: 5px 7px;
  font: inherit; color: inherit; background: var(--caption-surface, var(--tv-card)); border: 1px solid var(--caption-border, var(--tv-border-strong)); border-radius: 6px; }
.caption-field input[type="range"] { grid-column: 1 / -1; width: 100%; margin: 2px 0 5px; accent-color: var(--caption-accent, var(--tv-primary)); }
.caption-field input[type="color"] { width: 32px; height: 30px; padding: 2px; border-radius: 6px;
  border: 1px solid var(--caption-border, var(--tv-border-strong)); background: var(--caption-surface, var(--tv-card)); }
.caption-field output { color: var(--caption-muted, var(--tv-text-sub)); font-variant-numeric: tabular-nums; }
.caption-style-groups { display: grid; gap: 12px; margin-block: 12px; }
.caption-style-group { min-width: 0; margin: 0; padding: 2px 12px 6px; border: 1px solid var(--caption-border, var(--tv-border)); border-radius: 8px; }
.caption-style-group legend { font-weight: 650; padding-inline: 4px; }
.caption-preview { position: relative; display: flex; flex-direction: column; justify-content: flex-end; gap: 14px; min-height: 190px;
  margin-bottom: 16px; padding: 20px 16px 12px; background: #20382e; color: #f3f4e9; border-radius: 10px; overflow: hidden; }
.caption-preview .ft-caption-lines { display: flex; --ft-caption-base: 17px; }
.caption-preview-bar { display: flex; align-items: center; gap: 8px; }
.caption-preview-bar img { object-fit: contain; }
.caption-preview-track { flex: 1; height: 3px; background: linear-gradient(to right, #a8be87 36%, #53675a 36%); }
.caption-preview-cc { font-size: 10px; font-weight: 700; border: 1px solid currentColor; border-radius: 3px; padding: 0 2px; }
.caption-preview-close { width: 16px; font-size: 18px; line-height: 18px; text-align: center; }
`
