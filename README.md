<div align="center">
  <img src="public/icons/icon.svg" alt="" width="80" height="80">
  <h1>Foxtranslate</h1>
  <p>在浏览器里双语阅读网页、看字幕、翻译文档，随手收藏生词</p>
  <p><a href="https://github.com/Foxmori-Official/Foxtranslate/releases/latest">下载安装包</a> · <a href="#快速安装">安装步骤</a> · <a href="README.en.md">English</a></p>
</div>

## 快速安装

1. 从 [GitHub Releases](https://github.com/Foxmori-Official/Foxtranslate/releases/latest) 下载 `foxtranslate-版本号.zip` 并解压。使用发布附件中的安装包。
2. 打开 `chrome://extensions` 或 `edge://extensions`，开启开发者模式，点击「加载已解压的扩展程序」，选择包含 `manifest.json` 的文件夹。
3. 按引导选择目标语言和翻译服务，把 Foxtranslate 固定到工具栏。打开普通网页，点击「翻译此页」。

默认免费引擎可直接使用。更新扩展后，刷新已打开的网页。此 README 介绍当前源码，下载包的功能以对应的[发布说明](https://github.com/Foxmori-Official/Foxtranslate/releases)为准。

## 可以用它做什么

- **阅读外文网页**。在双语对照与仅译文之间切换，划词看译文、按住修饰键翻译一段，或用快捷键翻译正在编辑的文本。
- **看视频和会议字幕**。在 YouTube 播放器点击狐狸图标，开启当前视频的字幕翻译。在 Google Meet、Microsoft Teams 或 Zoom 网页端，先打开会议平台的字幕。
- **翻译并校订文档**。支持 PDF、EPUB、DOCX、PPTX、XLSX、HTML、JSON、Markdown、TXT、SRT、VTT、ASS。翻译后可逐段校订并下载，PDF 导出为 HTML。
- **收藏与复习生词**。划词时保存生词和例句，通过 FSRS 闪卡复习到期词汇，也可在网页上高亮已收藏的词。

YouTube 翻译需要可读取的字幕轨，适用于普通视频播放页。PDF 输入需要可提取的文本，导出支持双语或仅译文 HTML。

## 翻译引擎

| 使用方式 | 服务 |
| --- | --- |
| 免费免密钥 | Google、Microsoft、MyMemory，失败时可在免费引擎间自动切换 |
| Foxmori 订阅 | 从「Foxmori 账户」连接已登录的主站，选择可用套餐分组并配置密钥 |
| 自备配置 | DeepL、OpenAI 兼容接口、DeepSeek、Claude、Gemini、自托管 LibreTranslate 和自定义服务 |

在「设置 → 翻译引擎」配置模型并测试连接，再设为当前引擎。AI 专家和阅读、写作辅助使用适用的 AI 服务。术语表和术语库可用于固定译法。

## 隐私

扩展不内置遥测。设置、密钥、生词和翻译缓存保存在浏览器本地。翻译和 AI 功能会向相应服务发送所需文本，自动翻译和免费引擎降级也可能触发请求。可在设置中启用本地敏感信息脱敏。 [完整隐私政策](PRIVACY.md)

## 从源码构建

使用 Node.js 22 和 npm。构建后，在扩展管理页加载 `dist`。

```sh
git clone https://github.com/Foxmori-Official/Foxtranslate.git
cd Foxtranslate
npm ci
npm run build
```

开发细节见[架构说明](ARCHITECTURE.md)和[构建、验证与发布指南](docs/UPDATING.md)。

## 致谢与许可

Foxtranslate 使用 GPL-3.0 许可。感谢 KISS Translator、FluentRead、Read Frog、Interline、OpenImmersive Translator 和 MTranBrowser 的作者与贡献者。 [许可证](LICENSE) · [第三方归属与参考方向](THIRD_PARTY_NOTICES.md)
