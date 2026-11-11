# Foxtranslate

Foxmori 的开源双语翻译扩展，支持 Chrome 和 Edge。网页翻译、文档翻译、生词复习和设置使用左侧导航、右侧工作区。

扩展不要求注册账号，不内置遥测。翻译与 AI 功能会将文本发送给选定的服务，部分服务需要账号、API Key 或付费额度。

## 功能

- 网页双语对照、仅译文模式、可见段落调度，以及动态页面翻译。
- 划词、按住修饰键悬停、输入框翻译、可配置快捷键和悬浮球。
- YouTube 双语字幕。播放器右下角的 **FT** 按钮可开关字幕翻译，支持切换视频后的重新挂载、加载反馈和失败提示。
- Google Meet、Teams、Zoom 网页会议字幕翻译。需要先开启会议平台提供的字幕。
- PDF、ePub、DOCX、PPTX、XLSX、HTML、JSON、TXT、Markdown、SRT、VTT、ASS 文档翻译与导出，支持译文校订。PDF 当前导出为双语 HTML。
- Google、Microsoft、MyMemory 免费引擎，以及 DeepL、OpenAI 兼容端点、DeepSeek、Claude、Gemini、LibreTranslate 和自定义服务。
- 适用 AI 引擎的专家提示词、AI 阅读与写作辅助、术语库。
- 生词本和 FSRS 闪卡复习，可选网页高亮。
- 可选本地敏感信息脱敏、术语替换与翻译缓存。

YouTube 功能依赖视频提供可读取的字幕轨。无字幕视频、Shorts、Netflix、扫描件 OCR 和保留原版式的 PDF 导出不在当前实现范围内。

## 安装

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

在 YouTube 的 `/watch?v=…` 页面，FT 按钮位于原生播放器控制栏。默认字幕翻译选项在“设置 → 视频与会议”中，关闭时按钮仍可用于重新开启。没有可读取字幕时会提示原因，不会进行音频转写。

商店发行前可自行构建安装包。解压 ZIP 后再按上述方式加载。

```sh
npm run zip
```

## 开发与验证

```sh
npm run typecheck
npm test
npm run build
npm run verify:package
npm run test:browser
```

浏览器集成测试先运行 `npx playwright install chromium`。也可通过 `FOXTRANSLATE_TEST_CHROMIUM` 指向本机 Chromium 可执行文件。测试用独立配置目录与模拟服务，检查安装引导、配置保存、键盘选择、左右布局、网页翻译、YouTube FT 控件与字幕。真实服务的额度、密钥和视频字幕可用性需要单独验收。

- `src/core` 负责文本、语言、术语与脱敏等纯逻辑。
- `src/background` 负责消息、翻译管线、引擎路由与缓存。
- `src/content` 负责网页 DOM、划词、悬停和输入交互。
- `src/subtitles` 负责视频与会议字幕，`ytBridge.ts` 为包内 MAIN world 桥接脚本。
- `src/shared` 负责配置、存储、协议、词典与共享界面行为。

架构细节见 [ARCHITECTURE.md](ARCHITECTURE.md)。

## 参考项目与致谢

Foxtranslate 在原 [Rtranslate 项目](https://github.com/aimaonews/Rtranslate) 基础上维护，并参考以下开源项目的功能与实现思路。各项目的功能范围、协议和许可证存在差异，表中只说明本项目的参考方向。

| 项目 | 参考方向 |
|---|---|
| [KISS Translator](https://github.com/fishjar/kiss-translator) | 富文本占位符、聚合翻译、划词、悬停与输入框翻译 |
| [FluentRead 流畅阅读](https://github.com/FluentRead/FluentRead) | 分层架构、阅读辅助、文档与视频使用流程 |
| [Read Frog 陪读蛙](https://github.com/mengxi-ream/read-frog) | YouTube 播放器入口、字幕交互、生词本与 FSRS 学习流程 |
| [Interline 行间](https://github.com/eigenlux-ai/interline-translator) | 免费引擎、译文样式、术语签名与缓存 |
| [OpenImmersive Translator](https://github.com/OpenImmersive/OpenImmersive-Translator) | 本地敏感信息脱敏、免费引擎失败降级 |
| [MTranBrowser](https://github.com/xxnuo/MTranBrowser) | 可见内容调度、版式继承、悬停快捷键与悬浮入口 |

内置领域术语数据来自 [immersive-translate/terms](https://github.com/immersive-translate/terms)。运行时使用 PDF.js、JSZip 和 ts-fsrs，归属与许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 更新维护

[更新与参考项目跟踪指南](docs/UPDATING.md) 说明如何收集上游 Release 和提交差异，选择可用改进，记录取舍，通过测试并发布。

```sh
npm run check:upstreams
```

命令生成 `reports/upstream-updates.md` 和 JSON 数据。GitHub Actions 每周一北京时间 09:17 检查六个参考项目，在同一条 Issue 更新待审阅报告。第一次运行尚无人工基线，会列出全部项目供初次评估。维护者审阅后才更新基线，采用代码需另行提交 PR。

提交和 PR 会运行检查与打包工作流。推送与版本号一致的 `v*` 标签后，发行工作流生成附安装包和校验和的草稿 Release，维护者验收后发布。版本记录见 [CHANGELOG.md](CHANGELOG.md)。

## 隐私与许可

设置、API Key、生词和缓存保存在浏览器本地。Key 以服务认证用途发送给所选端点。自动翻译、悬停和字幕等功能可触发网络请求，免费引擎失败降级也可能访问多个服务。

脱敏仅覆盖翻译管线识别的模式，语言检测、AI 辅助与页面上下文等路径可能具有不同的数据处理方式。完整说明见 [PRIVACY.md](PRIVACY.md)。

项目沿用 GPL-3.0 许可证，见 [LICENSE](LICENSE)。参考与后续采用的上游代码、数据及依赖保留各自的归属和许可要求。
