# Foxtranslate 隐私政策 / Privacy Policy

生效日期 2026-11-12。适用于 Foxtranslate 的 Chrome / Edge 扩展。

## 中文

### 产品与服务

Foxtranslate 是开源双语翻译扩展。扩展不要求注册账号，不内置遥测或行为分析。所选翻译与 AI 服务由对应服务商提供，其账号、计费、日志和数据处理以服务商政策为准。

### 网络请求

- 网页翻译、划词、悬停、输入框、文档与字幕功能会把待翻译文本发送给所选服务。
- 自动翻译规则、悬停与字幕等功能在触发后可自动发送文本，开关位于扩展设置中。
- 语言检测可能请求 Google。免费引擎失败降级和多引擎对比可能访问多个服务。
- 内置免费服务为 Google 翻译、Microsoft 翻译和 MyMemory。可选服务包括 Foxmori、DeepL、OpenAI 兼容端点、DeepSeek、Claude、Gemini、LibreTranslate 和用户配置的自定义端点。
- AI 阅读、对话、写作与术语提取会发送相应文本和功能使用的上下文。开启页面上下文辅助时，会使用页面摘要等内容。
- YouTube 字幕从 YouTube 获取。播放器中的狐狸图标打开字幕菜单，会议翻译处理平台已提供的字幕文本。当前实现不录制麦克风或视频音频。
- 设置页查询模型列表和测试连接时会访问配置端点，并可携带该服务的 API Key。
- 选择连接 Foxmori 后，扩展通过已登录的主站读取账户和可用分组。点击创建密钥时，扩展将新建或复用该分组内名为 Foxmori 的密钥并保存在浏览器。密码和账户会话由主站处理。

### 脱敏范围

可选脱敏在翻译管线中识别邮箱、电话、银行卡、身份证和部分 API Key 模式，先用占位符替换，收到译文后尝试还原。它不能保证识别所有敏感内容。语言检测、AI 辅助和额外页面上下文等路径可能具有不同的处理方式，不能把脱敏开关视为全面保密保证。

### 本地存储

设置、API Key、生词、复习记录与翻译缓存保存在 `chrome.storage.local`。本地存储不是加密保险箱。Key 用于向用户配置的服务认证，译文缓存可能包含还原后的敏感内容。

### 控制与删除

可以更换服务、关闭自动触发、关闭 YouTube 或会议字幕、配置不自动翻译的网站，以及删除生词。浏览器扩展存储工具或卸载操作可移除本地配置和缓存，操作前请导出需要保留的生词。删除本地数据不会撤回已发给服务商的数据。

### 联系

问题与数据处理说明可在 [Foxtranslate 仓库](https://github.com/Foxmori-Official/Foxtranslate/issues) 提交。提交公开 Issue 前，请移除 API Key、个人内容与其他不希望公开的信息。

## English

### Product and services

Foxtranslate is an open-source bilingual translation extension. The extension requires no account and includes no telemetry or behavioral analytics. Selected translation and AI providers operate their own authentication, billing, logging and data policies.

### Network requests

- Page, selection, hover, input, document and subtitle features send text to the selected service.
- Automatic site rules, hover and subtitle triggers can send text when activated.
- Language detection may contact Google. Free-engine fallback and multi-engine comparison can contact several providers.
- Built-in free services are Google Translate, Microsoft Translator, and MyMemory. Optional services include Foxmori, DeepL, OpenAI-compatible endpoints, DeepSeek, Claude, Gemini, LibreTranslate, and user-configured endpoints.
- AI reading, chat, writing and term extraction send their input and the context used by that feature. Optional page-context assistance uses page summaries and related context.
- Captions are retrieved from YouTube. The fox icon opens the player caption menu. Meeting translation processes captions supplied by the meeting platform. The current implementation does not record the microphone or video audio.
- Model discovery and connection tests in Settings can contact configured endpoints with the associated API Key.
- Connecting Foxmori uses the signed-in website session to read the account and available groups. When you create a key, the extension saves a new or existing key named Foxmori for that group in this browser. Foxmori handles account passwords and session credentials.

### Optional masking

The translation pipeline can replace recognized email, phone, bank-card, ID and API-key patterns with placeholders, then attempt to restore them in the returned translation. Detection is incomplete by nature. Language detection, AI actions and additional page context may follow different processing paths. Masking is not a comprehensive confidentiality guarantee.

### Local storage

Settings, API keys, saved vocabulary, review records and translation caches use `chrome.storage.local`. This storage is not an encrypted vault. Keys authenticate requests to configured services. Translation caches can contain restored sensitive text.

### Control and deletion

You can change providers, disable automatic triggers and subtitles, configure site policies, and delete saved words. Browser extension-storage tools or uninstalling can remove local configuration and caches. Export needed vocabulary first. Deleting local data does not recall information already sent to providers.

### Contact

Use the [Foxtranslate issue tracker](https://github.com/Foxmori-Official/Foxtranslate/issues). Remove API keys and private content before posting a public issue.
