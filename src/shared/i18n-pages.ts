// 文档、复习和引导页的英文文案。中文使用页面中的原文。
import { registerDict, resolveUiLang, type ResolvedLang } from './i18n'

const EN: Record<string, string> = {
  // review
  'review.title': 'Foxtranslate Flashcard Review',
  'review.exit': 'End review',
  'review.progress': 'Card {pos} of {total}',
  'review.reveal': 'Show meaning',
  'review.flipHint': 'Click the card or press Space to flip',
  'review.noTranslation': '(No definition yet)',
  'review.grade.again': 'Again',
  'review.grade.hard': 'Hard',
  'review.grade.good': 'Good',
  'review.grade.easy': 'Easy',
  'review.kbd.space': 'Space',
  'review.kbd.flip': 'flip',
  'review.kbd.or': 'or',
  'review.kbd.grade': 'grade',
  'review.toast.gradeFailed': 'Failed to save grade: {msg}',
  'review.toast.refreshFailed': 'Failed to refresh queue: {msg}',
  'review.toast.loadFailed': 'Failed to load words: {msg}',
  'review.stats.total': 'Total words',
  'review.stats.due': 'Due',
  'review.stats.session': 'Reviewed this session',
  'review.result.hint': 'Select words on web pages to save them',
  'review.continue': 'Continue review',
  'review.empty.title': 'Your wordbook is empty',
  'review.empty.desc': 'Select words on any web page to save them.',
  'review.done.title': 'Today’s review complete',
  'review.done.desc': 'All due cards have been reviewed.',
  'review.sessionDone.title': 'Session complete',
  'review.sessionDone.desc': 'All cards in this round have been graded.',
  'review.interval.lessThanMinute': '<1m',
  'review.interval.minutes': '{n}m',
  'review.interval.hours': '{n}h',
  'review.interval.days': '{n}d',
  'review.interval.months': '{n}mo',
  // files
  'files.title': 'Foxtranslate · Document Translation',
  'files.card.file.title': 'Choose file',
  'files.card.file.desc':
    'Files are processed locally only; translation requests are sent via the extension background to your configured engine',
  'files.dropzone.main': 'Drag & drop a file here',
  'files.dropzone.sub': 'Supports {exts}, up to {size} per file',
  'files.dropzone.button': 'Click to choose a file',
  'files.card.settings.title': 'Translation settings',
  'files.field.targetLang': 'Target language',
  'files.field.outputMode': 'Output mode',
  'files.mode.bilingual': 'Bilingual',
  'files.mode.bilingual.desc': 'Original and translation side by side for easy proofreading',
  'files.mode.translationOnly': 'Translation only',
  'files.mode.translationOnly.desc': 'Keep only the translation for a cleaner layout',
  'files.card.run.title': 'Start translation',
  'files.card.run.desc': 'Files are processed locally; download the translation anytime',
  'files.action.translate': 'Translate',
  'files.action.translateHint': 'Choose a file first',
  'files.action.cancel': 'Cancel',
  'files.action.download': 'Download translation',
  'files.pe.title': 'Post-edit translation',
  'files.pe.toggle': 'Post-edit mode',
  'files.pe.desc':
    'Check and edit the translation segment by segment; edits are saved automatically and used for the download',
  'files.pe.count': 'Edited {edited} / {total} segments',
  'files.pe.limitHint': 'Only the first {n} segments are shown for editing',
  'files.pe.segLabel': 'Edit translation of segment {n}',
  'files.file.remove': 'Remove',
  'files.toast.unsupported': 'Unsupported file format',
  'files.toast.tooLarge': 'File exceeds the {max} limit (current: {size})',
  'files.toast.running': 'Translation in progress — cancel it first',
  'files.toast.peReset': 'Re-translating will clear your edits',
  'files.status.building': 'Generating file…',
  'files.status.exported': 'Exported {file}{note}',
  'files.status.exportedNote': ', with {n} edited segments',
  'files.status.parsing': 'Parsing file…',
  'files.status.translating': 'Translating…',
  'files.status.cancelled': 'Cancelled',
  'files.status.cancelledProgress': 'Cancelled ({done} of {total} segments completed)',
  'files.status.allFailed': 'All translations failed — check your engine settings and retry',
  'files.status.donePartial': 'Done: {ok} segments translated, {failed} failed and kept the original',
  'files.status.done': 'Translation complete: {total} segments',
  'files.error.empty': 'No translatable text found in the file',
  'files.progress': 'Translated {done} of {total} segments ({pct}%)',
  // onboarding
  'onboarding.progress': 'Step {n} of {total}',
  'onboarding.loadFailed': 'Failed to load config: ',
  'onboarding.welcome.title': 'Welcome to Foxtranslate',
  'onboarding.welcome.subtitle':
    'Full-page, selection and hover translation — set up once, use everywhere.',
  'onboarding.field.targetLang': 'Target language',
  'onboarding.field.engine': 'Translation engine',
  'onboarding.field.displayMode': 'Display mode',
  'onboarding.commonLangs': 'Common languages',
  'onboarding.allLangs': 'All languages',
  'onboarding.mode.bilingual': 'Bilingual',
  'onboarding.mode.bilingualDesc': 'Keep the original text and show the translation below it',
  'onboarding.mode.translationOnly': 'Translation only',
  'onboarding.mode.translationOnlyDesc': 'Hide the original text and show only the translation',
  'onboarding.pin.title': 'Pin Foxtranslate to the toolbar',
  'onboarding.pin.desc': 'Pin it to translate pages and look up words in one click.',
  'onboarding.pin.step1': 'Click the puzzle icon in the top-right corner of your browser',
  'onboarding.pin.step2': 'Find Foxtranslate in the list',
  'onboarding.pin.step3': 'Click the pin icon to keep it on the toolbar',
  'onboarding.demo.title': 'Try selection translation',
  'onboarding.demo.hint': 'Select the sentence above to try selection translation',
  'onboarding.demo.idle': 'Select the sample text and the translation will appear here',
  'onboarding.demo.translating': 'Translating…',
  'onboarding.demo.failed': 'Translation failed: ',
  'onboarding.next': 'Next',
  'onboarding.prev': 'Back',
  'onboarding.finish': 'Finish setup and start',
  'onboarding.skip': 'Skip, use defaults',
  'onboarding.done.title': 'All set!',
  'onboarding.done.desc': 'You can close this tab and try any English page.',
}

registerDict('en', EN)

/**
 * 监听设置变更：tv:config_v1 中 uiLang 变化时回调（已解析 auto）。
 * 无 chrome.storage 的环境（单测桩未覆盖时）静默跳过，不影响页面其余逻辑。
 */
export function watchUiLang(cb: (lang: ResolvedLang) => void): void {
  try {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local' || !changes['tv:config_v1']) return
      const raw: unknown = changes['tv:config_v1']?.newValue
      const uiLang =
        typeof raw === 'object' &&
        raw !== null &&
        typeof (raw as { uiLang?: unknown }).uiLang === 'string'
          ? (raw as { uiLang: string }).uiLang
          : 'auto'
      cb(resolveUiLang(uiLang))
    })
  } catch {
    // 测试环境无 chrome.storage 桩：不监听
  }
}
