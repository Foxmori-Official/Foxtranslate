import { registerDict, resolveUiLang, t } from './i18n'

const COPY = {
  page: ['网页翻译', 'Page translation', 'Webseiten übersetzen'],
  files: ['文档翻译', 'Documents', 'Dokumente'],
  review: ['生词复习', 'Vocabulary', 'Vokabeln'],
  settings: ['设置', 'Settings', 'Einstellungen'],
  guide: ['安装引导', 'Setup guide', 'Einrichtung'],
  chooseLanguages: ['选择自动翻译的语言', 'Choose languages for automatic translation', 'Sprachen für automatische Übersetzung auswählen'],
  noneAuto: ['未设置自动翻译语言', 'No automatic translation languages selected', 'Keine Sprachen für automatische Übersetzung ausgewählt'],
  startReading: ['打开英文示例网页', 'Open an English example page', 'Englische Beispielseite öffnen'],
  startReadingHint: ['打开示例后，点击工具栏中的 Foxtranslate，选择“翻译此页”。', 'Open the example, then choose Foxtranslate in the toolbar and click Translate this page.', 'Öffnen Sie das Beispiel, wählen Sie Foxtranslate in der Symbolleiste und dann Diese Seite übersetzen.'],
  language: ['语言设置', 'Languages', 'Sprachen'],
  source: ['原文语言', 'Source language', 'Ausgangssprache'],
  target: ['目标语言', 'Target language', 'Zielsprache'],
  gestures: ['快捷交互', 'Quick interactions', 'Schnellaktionen'],
  policy: ['此网站的翻译规则', 'Translation on this site', 'Übersetzung dieser Website'],
  manual: ['手动翻译', 'Translate manually', 'Manuell übersetzen'],
  always: ['自动翻译', 'Translate automatically', 'Automatisch übersetzen'],
  never: ['从不自动翻译', 'Never translate automatically', 'Nie automatisch übersetzen'],
  policyHint: ['规则用于下次访问；本页由上方按钮控制。', 'Applies on your next visit. Use the button above for this page.', 'Gilt beim nächsten Besuch. Diese Seite steuern Sie oben.'],
  unavailable: ['请打开普通网页。更新扩展后，请刷新网页再试。', 'Open a normal web page. After an extension update, reload the page.', 'Öffnen Sie eine normale Webseite. Laden Sie sie nach einem Update neu.'],
  saveFailed: ['保存失败，请重试。', 'Could not save. Please try again.', 'Speichern fehlgeschlagen. Bitte erneut versuchen.'],
  saved: ['设置已保存', 'Settings saved', 'Einstellungen gespeichert'],
  saving: ['正在保存…', 'Saving…', 'Wird gespeichert…'],
  translating: ['正在翻译…', 'Translating…', 'Wird übersetzt…'],
  defaults: ['基础设置', 'Preferences', 'Grundeinstellungen'],
  assist: ['阅读与写作', 'Reading and writing', 'Lesen und Schreiben'],
  data: ['词汇与隐私', 'Vocabulary and privacy', 'Vokabeln und Datenschutz'],
  video: ['视频与会议', 'Video and meetings', 'Videos und Besprechungen'],
  videoHint: ['点击 YouTube 播放器里的狐狸图标，打开字幕菜单。视频需要提供可读取的字幕轨，会议需要先开启平台字幕。', 'Use the fox icon in the YouTube player to open the caption menu. A readable caption track is required. Enable platform captions before using meeting captions.', 'Die Fuchs-Schaltfläche im YouTube-Player öffnet das Untertitelmenü. Eine lesbare Untertitelspur ist erforderlich. Aktivieren Sie bei Besprechungen zuerst die Plattformuntertitel.'],
  serviceHint: ['免费引擎无需密钥。付费或 AI 引擎需在设置中填写密钥并测试连接。', 'Free engines need no key. Configure and test paid or AI services in Settings.', 'Kostenlose Dienste benötigen keinen Schlüssel. Kostenpflichtige und KI-Dienste richten Sie in den Einstellungen ein.'],
  configure: ['配置翻译服务', 'Configure services', 'Dienste einrichten'],
  trySample: ['翻译示例', 'Translate sample', 'Beispiel übersetzen'],
  privacy: ['隐私政策', 'Privacy policy', 'Datenschutz'],
  ytOn: ['双语字幕已开启，点击关闭', 'Bilingual captions on. Click to turn off.', 'Zweisprachige Untertitel an. Zum Ausschalten klicken.'],
  ytOff: ['开启双语字幕', 'Turn on bilingual captions', 'Zweisprachige Untertitel einschalten'],
  ytLoading: ['正在读取字幕…', 'Loading captions…', 'Untertitel werden geladen…'],
  ytEmpty: ['此视频未提供可读取的字幕。开启 CC，并关闭后重新开启字幕翻译以重试。', 'No readable captions found. Enable CC, then turn caption translation off and on to retry.', 'Keine lesbaren Untertitel gefunden. CC aktivieren und Untertitelübersetzung aus- und wieder einschalten.'],
  ytError: ['字幕加载失败，请关闭后重新开启字幕翻译以重试。', 'Could not load captions. Turn caption translation off and on to retry.', 'Untertitel konnten nicht geladen werden. Untertitelübersetzung aus- und wieder einschalten.'],
  ytReady: ['字幕翻译已就绪', 'Caption translation ready', 'Untertitelübersetzung bereit'],
  ytRetry: ['部分字幕翻译失败，请检查翻译服务或点击重试。', 'Some captions failed to translate. Check your service or click to retry.', 'Einige Untertitel konnten nicht übersetzt werden. Dienst prüfen oder erneut versuchen.'],
} as const

type CopyKey = keyof typeof COPY
for (const [index, locale] of [[1, 'en'], [2, 'de']] as const) {
  registerDict(locale, Object.fromEntries(Object.entries(COPY).map(([key, value]) => ['fox.' + key, value[index]])))
}
export function uiCopy(key: CopyKey, lang: string): string {
  return t('fox.' + key, resolveUiLang(lang), COPY[key][0])
}
