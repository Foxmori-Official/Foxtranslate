# Foxtranslate

[简体中文](#中文) · [English](#english)

## 中文

Foxmori 的开源双语翻译扩展，支持 Chrome 和 Edge。网页翻译、文档翻译、生词复习和设置使用左侧导航、右侧工作区。

扩展不要求注册账号，不内置遥测。翻译与 AI 功能会将文本发送给选定的服务，部分服务需要账号、API Key 或付费额度。

### 功能

- 网页双语对照、仅译文模式、可见段落调度，以及动态页面翻译。
- 划词、按住修饰键悬停、输入框翻译、可配置快捷键和悬浮球。
- YouTube 双语字幕。播放器右下角的 **狐狸图标**按钮可开关字幕翻译，支持切换视频后的重新挂载、加载反馈和失败提示。
- Google Meet、Teams、Zoom 网页会议字幕翻译。需要先开启会议平台提供的字幕。
- PDF、ePub、DOCX、PPTX、XLSX、HTML、JSON、TXT、Markdown、SRT、VTT、ASS 文档翻译与导出，支持译文校订。PDF 当前导出为双语 HTML。
- Google、Microsoft、MyMemory 免费引擎，以及 DeepL、OpenAI 兼容端点、DeepSeek、Claude、Gemini、LibreTranslate 和自定义服务。
- 适用 AI 引擎的专家提示词、AI 阅读与写作辅助、术语库。
- 生词本和 FSRS 闪卡复习，可选网页高亮。
- 可选本地敏感信息脱敏、术语替换与翻译缓存。

YouTube 功能依赖视频提供可读取的字幕轨。无字幕视频、Shorts、Netflix、扫描件 OCR 和保留原版式的 PDF 导出不在当前实现范围内。

### 安装

需要 Node.js 22 和 npm。

```sh
git clone https://github.com/Foxmori-Official/Foxtranslate.git
cd Foxtranslate
npm ci
npm run build
```

1. 打开 `chrome://extensions` 或 `edge://extensions`，开启开发者模式。
2. 点击“加载已解压的扩展程序”，选择项目中的 `dist` 文件夹。
3. 首次安装会打开三步引导，选择目标语言、翻译服务和显示方式，然后将扩展固定到工具栏。
4. 默认使用无需 Key 的 Google 免费引擎。AI 或付费服务请在“设置 → 翻译引擎”填写配置并测试连接。
5. 在普通网页打开扩展，点击“翻译此页”。更新扩展后刷新已打开的网页，内容脚本才会使用新版本。

在 YouTube 的 `/watch?v=…` 页面，狐狸图标按钮位于原生播放器控制栏。默认字幕翻译选项在“设置 → 视频与会议”中，关闭时按钮仍可用于重新开启。没有可读取字幕时会提示原因，不会进行音频转写。

从 [GitHub Releases](https://github.com/Foxmori-Official/Foxtranslate/releases) 下载安装包并解压，也可自行构建，再按上述方式加载。

```sh
npm run zip
```

### 开发与验证

```sh
npm run typecheck
npm test
npm run build
npm run verify:package
npm run test:browser
```

浏览器集成测试先运行 `npx playwright install chromium`。也可通过 `FOXTRANSLATE_TEST_CHROMIUM` 指向本机 Chromium 可执行文件。测试用独立配置目录与模拟服务，检查安装引导、配置保存、键盘选择、左右布局、网页翻译、YouTube 狐狸图标控件与字幕。真实服务的额度、密钥和视频字幕可用性需要单独验收。

- `src/core` 负责文本、语言、术语与脱敏等纯逻辑。
- `src/background` 负责消息、翻译管线、引擎路由与缓存。
- `src/content` 负责网页 DOM、划词、悬停和输入交互。
- `src/subtitles` 负责视频与会议字幕，`ytBridge.ts` 为包内 MAIN world 桥接脚本。
- `src/shared` 负责配置、存储、协议、词典与共享界面行为。

图标由源码中的 SVG 和可逆 Base64 资源在构建时恢复，PDF.js 运行时资源从锁定的 npm 包复制。历史商店截图保留在本地，发布新版本时需要重新生成。

架构细节见 [ARCHITECTURE.md](ARCHITECTURE.md)。

### 参考项目与致谢

Foxtranslate 参考以下开源项目的功能与实现思路。各项目的功能范围、协议和许可证存在差异，表中只说明本项目的参考方向。

| 项目 | 参考方向 |
|---|---|
| [KISS Translator](https://github.com/fishjar/kiss-translator) | 富文本占位符、聚合翻译、划词、悬停与输入框翻译 |
| [FluentRead 流畅阅读](https://github.com/FluentRead/FluentRead) | 分层架构、阅读辅助、文档与视频使用流程 |
| [Read Frog 陪读蛙](https://github.com/mengxi-ream/read-frog) | YouTube 播放器入口、字幕交互、生词本与 FSRS 学习流程 |
| [Interline 行间](https://github.com/eigenlux-ai/interline-translator) | 免费引擎、译文样式、术语签名与缓存 |
| [OpenImmersive Translator](https://github.com/OpenImmersive/OpenImmersive-Translator) | 本地敏感信息脱敏、免费引擎失败降级 |
| [MTranBrowser](https://github.com/xxnuo/MTranBrowser) | 可见内容调度、版式继承、悬停快捷键与悬浮入口 |

内置领域术语数据来自 [immersive-translate/terms](https://github.com/immersive-translate/terms)。运行时使用 PDF.js、JSZip 和 ts-fsrs，归属与许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

### 更新维护

[更新与参考项目跟踪指南](docs/UPDATING.md) 说明如何收集上游 Release 和提交差异，选择可用改进，记录取舍，通过测试并发布。

```sh
npm run check:upstreams
```

命令生成 `reports/upstream-updates.md` 和 JSON 数据。GitHub Actions 每周一北京时间 09:17 检查六个参考项目，在同一条 Issue 更新待审阅报告。第一次运行尚无人工基线，会列出全部项目供初次评估。维护者审阅后才更新基线，采用代码需另行提交 PR。

提交和 PR 会运行检查与打包工作流。发布支持版本标签、`release/v版本号` 分支和手动触发。版本分支通过测试后公开发布，标签和手动触发默认生成草稿。发布说明使用中文，安装包附 SHA-256 校验和。版本记录见 [CHANGELOG.md](CHANGELOG.md)。

### 隐私与许可

设置、API Key、生词和缓存保存在浏览器本地。Key 以服务认证用途发送给所选端点。自动翻译、悬停和字幕等功能可触发网络请求，免费引擎失败降级也可能访问多个服务。

脱敏仅覆盖翻译管线识别的模式，语言检测、AI 辅助与页面上下文等路径可能具有不同的数据处理方式。完整说明见 [PRIVACY.md](PRIVACY.md)。

项目沿用 GPL-3.0 许可证，见 [LICENSE](LICENSE)。参考与后续采用的上游代码、数据及依赖保留各自的归属和许可要求。

## English

Foxtranslate is Foxmori’s open-source bilingual translation extension for Chrome and Edge. A left navigation rail sits beside the workspace across page translation, documents, vocabulary review, settings and setup.

The extension requires no account and includes no telemetry. Translation and AI features send text to the selected provider. Some providers require credentials or paid quota.

### Features

- Bilingual and translation-only webpages with visible-paragraph scheduling and dynamic-page support.
- Selection, modifier-key hover and input translation, configurable shortcuts and a draggable floating control.
- YouTube bilingual captions controlled by the extension’s fox icon in the player, with video-navigation recovery and status feedback.
- Caption translation for browser-based Google Meet, Teams and Zoom meetings, using captions enabled on the meeting platform.
- PDF, EPUB, DOCX, PPTX, XLSX, HTML, JSON, TXT, Markdown, SRT, VTT and ASS document translation, export and post-editing. PDF exports as bilingual HTML.
- Free Google, Microsoft and MyMemory engines, plus DeepL, OpenAI-compatible services, DeepSeek, Claude, Gemini, LibreTranslate and custom services.
- Expert prompts, AI reading and writing assistance, terminology libraries, optional local masking and translation caching.
- A vocabulary notebook, FSRS flashcards and optional page highlights.

YouTube requires readable caption tracks. Videos without captions, Shorts, Netflix, scanned-document OCR and PDF export retaining the original layout remain outside the current implementation.

### Installation

Download and extract the extension ZIP from [GitHub Releases](https://github.com/Foxmori-Official/Foxtranslate/releases), or build it with Node.js 22 and npm.

```sh
git clone https://github.com/Foxmori-Official/Foxtranslate.git
cd Foxtranslate
npm ci
npm run build
```

1. Open `chrome://extensions` or `edge://extensions` and enable Developer mode.
2. Choose Load unpacked and select `dist`. For a downloaded ZIP, select the extracted folder containing `manifest.json`.
3. Follow setup to select the target language, translation service and display mode, then pin the extension.
4. Google is the default free engine and needs no key. Configure and test paid or AI services in Settings → Translation engines.
5. Open a normal webpage and choose Translate this page. Reload existing webpages after updating the extension.

On YouTube `/watch?v=…` pages, the fox player button toggles bilingual captions. Video and meeting defaults are in Settings. The button remains available when caption translation is off. Audio transcription is outside the current implementation.

### Development and verification

```sh
npm run typecheck
npm test
npm run build
npm run verify:package
npx playwright install chromium
npm run test:browser
npm run zip
```

`FOXTRANSLATE_TEST_CHROMIUM` can point to a local Chromium executable. Browser tests use an isolated profile and controlled services to check setup, persistence, keyboard selection, layouts, page translation, document export, vocabulary review and YouTube controls. Real provider credentials, quotas and live-caption availability need separate verification.

Source modules cover pure text logic in `src/core`, the translation pipeline in `src/background`, webpage interaction in `src/content`, captions in `src/subtitles` and shared configuration and UI in `src/shared`. The packaged YouTube MAIN world bridge is `ytBridge.ts`. Builds restore icons from SVG and lossless Base64 resources and copy PDF.js assets from the locked dependency. See [ARCHITECTURE.md](ARCHITECTURE.md).

### References and acknowledgments

These open-source projects informed the functionality and implementation. Their scope, protocols and licenses differ.

| Project | Reference area |
|---|---|
| [KISS Translator](https://github.com/fishjar/kiss-translator) | Rich-text placeholders, batching, selection, hover and input translation |
| [FluentRead](https://github.com/FluentRead/FluentRead) | Layered architecture, reading assistance, document and video workflows |
| [Read Frog](https://github.com/mengxi-ream/read-frog) | YouTube controls, captions, vocabulary and FSRS learning |
| [Interline](https://github.com/eigenlux-ai/interline-translator) | Free engines, styles, glossary signatures and caching |
| [OpenImmersive Translator](https://github.com/OpenImmersive/OpenImmersive-Translator) | Local masking and free-engine fallback |
| [MTranBrowser](https://github.com/xxnuo/MTranBrowser) | Visibility scheduling, layout inheritance, hover and floating controls |

Bundled terminology comes from [immersive-translate/terms](https://github.com/immersive-translate/terms). Runtime dependencies include PDF.js, JSZip and ts-fsrs. Attribution is in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

### Updates and releases

The [maintenance guide](docs/UPDATING.md) describes reviewing upstream notes and differences, selecting changes, recording decisions and publishing verified updates.

```sh
npm run check:upstreams
```

Reports are written under `reports`. GitHub Actions checks six reference repositories every Monday at 09:17 China Standard Time and updates one review issue. The initial run lists all projects until maintainers establish reviewed baselines. Code adoption uses separate pull requests.

CI checks pushes and pull requests. Releases accept version tags, `release/vVERSION` branches and manual dispatch. Version branches publish after verification. Tag and manual builds default to drafts. Release notes are written in Chinese, and packages include SHA-256 checksums. See [CHANGELOG.md](CHANGELOG.md).

### Privacy and license

Settings, API keys, vocabulary and caches use local browser storage. Keys authenticate requests to configured providers. Automatic translation, hover, input and captions can send text when triggered. Fallback can contact multiple services. Masking covers recognized patterns in the translation pipeline, while language detection, AI actions and extra context can follow different paths. See [PRIVACY.md](PRIVACY.md).

The project uses GPL-3.0 in [LICENSE](LICENSE). Upstream code, data and dependencies retain their applicable attribution and licensing requirements.
