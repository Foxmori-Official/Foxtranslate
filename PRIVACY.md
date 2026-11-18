# Foxtranslate 隐私政策 / Privacy Policy

生效日期 2026-11-19。适用于 Foxtranslate 的 Chrome / Edge 扩展。

## 中文

### 产品与服务

Foxtranslate 是开源双语翻译扩展。扩展不要求注册账号，不内置遥测或行为分析。所选翻译与 AI 服务由对应服务商提供，其账号、计费、日志和数据处理以服务商政策为准。

### 网络请求

- 网页翻译、划词、悬停、输入框、文档与字幕功能会把待翻译文本发送给所选服务。
- 自动翻译规则、悬停与字幕等功能在触发后可自动发送文本，开关位于扩展设置中。
- 语言检测可能请求 Google。免费引擎失败降级和多引擎对比可能访问多个服务。
- 内置免费服务为 Google 翻译、Microsoft 翻译和 MyMemory。可选服务包括 Foxmori、DeepL、OpenAI 兼容端点、DeepSeek、Claude、Gemini、LibreTranslate 和用户配置的自定义端点。
- AI 阅读、对话与术语提取会发送相应文本和功能使用的上下文。开启页面上下文辅助时，会使用页面摘要等内容。
- YouTube 字幕从 YouTube 获取。播放器中的狐狸图标打开字幕菜单，会议翻译处理平台已提供的字幕文本。当前实现不录制麦克风或视频音频。
- 设置页查询模型列表和测试连接时会访问配置端点，并可携带该服务的 API Key。
- 点击「检查更新」时，扩展向 GitHub 查询公开的正式版本。版本对比在本机完成，请求不携带账号凭证、翻译文本或设置内容。
- 连接 Foxmori 由用户主动发起，通过已登录的主站读取账户和可用分组。创建密钥使用通用接口，名称默认为 Foxtranslate；结果不明确时会读取包含完整密钥的列表核对，仅把选中的有效密钥保存在浏览器。密钥可手动填写或共用，主站退出不影响密钥使用。密码和账户会话由主站处理。

### 数据用途与有限使用

Foxtranslate 对用户数据的使用遵守 Chrome Web Store 用户数据政策，包括 Limited Use 要求。数据仅用于提供或改进已披露的双语阅读、翻译和词汇复习功能。扩展不会出售用户数据，也不将其用于广告、信用评估或贷款决策。向服务商传输数据仅为完成用户使用的功能。开发者仅在用户明确授权读取特定数据、安全需要或法律要求等政策允许的情形下允许人员访问数据。

### 脱敏范围

可选脱敏在待译文本、页面上下文、语言检测和 AI 功能输入中识别邮箱、电话、银行卡、身份证及部分 API Key 和私钥格式。识别到的内容会在发送前替换为占位符；翻译结果中每个原文占位符最多还原一次。脱敏无法识别所有敏感内容，也不会移除用于服务鉴权的 API Key。

### 本地存储

连接 Foxmori 时，会在本机保存该次连接的账户 ID、邮箱、用户名和可用套餐，用于重新打开设置时显示上次连接信息。登录状态在连接主站时核验，API Key 独立配置。

设置、API Key、生词、复习记录与翻译缓存保存在 `chrome.storage.local`。扩展将这份存储限制在自己的界面和后台，网页内容脚本通过后台获取所需的控件设置和高亮词条。本地存储不是加密保险箱，译文缓存可能包含还原后的敏感内容。

收藏生词时，还会在本机保存所选例句及来源页面的 URL 和标题，用于回看来源。扩展使用选区、悬停、滚动位置和快捷键事件触发相应功能，并在本机保存译文字数和复习记录。事件不作为行为分析或遥测上传。

### 控制与删除

可以更换服务、关闭自动触发、关闭 YouTube 或会议字幕、配置不自动翻译的网站，以及删除生词。在「设置 → 隐私」可以清除翻译缓存。本地设置和词汇记录保留至用户删除或卸载扩展，缓存也可能按缓存策略淘汰。浏览器扩展存储工具或卸载操作可移除本地配置和缓存，操作前请导出需要保留的生词。删除本地数据不会撤回已发给服务商的数据。

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
- AI reading, chat and term extraction send their input and the context used by that feature. Optional page-context assistance uses page summaries and related context.
- Captions are retrieved from YouTube. The fox icon opens the player caption menu. Meeting translation processes captions supplied by the meeting platform. The current implementation does not record the microphone or video audio.
- Model discovery and connection tests in Settings can contact configured endpoints with the associated API Key.
- Clicking Check for updates queries public release metadata on GitHub. The extension compares versions locally and sends no account credentials, translation text or settings.
- Connecting Foxmori is initiated by the user and uses the signed-in website session to read the account and available groups. Key creation uses the generic API with Foxtranslate as the default name. Uncertain results are checked against the full key list; only the selected valid key is saved in this browser. Keys can be entered manually or shared, and remain usable after website logout. Foxmori handles account passwords and session credentials.

### Purpose and limited use

Foxtranslate's use of user data complies with the Chrome Web Store User Data Policy, including its Limited Use requirements. Data is used only to provide or improve the disclosed bilingual reading, translation and vocabulary review features. The extension does not sell user data or use it for advertising, creditworthiness or lending decisions. Transfers to providers are necessary to deliver the features the user uses. The developer permits human access only under policy-permitted circumstances, such as explicit consent to read specific data, security needs or legal requirements.

### Optional masking

Optional masking replaces recognized email, phone, bank-card, ID, API-key and private-key patterns in translation text, page context, language detection and AI inputs before sending them. Each source placeholder is restored at most once in a translation. Masking cannot identify every secret and does not remove the API key used to authenticate with the selected service.

### Local storage

Connecting Foxmori saves the account ID, email, username and available groups locally to display the last connected account when Settings reopens. Connecting to the website verifies its session. The API key is configured independently.

Settings, API keys, saved vocabulary, review records and translation caches use `chrome.storage.local`, restricted to extension pages and the background worker. Content scripts request the settings and vocabulary highlights they need from the worker. This storage is not an encrypted vault. Translation caches can contain restored sensitive text.

Saving vocabulary also stores the selected sentence and the source page URL and title locally so the user can revisit the source. Selection, hover, scroll position and keyboard events trigger the relevant features. Translated-character counts and review records are stored locally. Events are not uploaded as behavioral analytics or telemetry.

### Control and deletion

You can change providers, disable automatic triggers and subtitles, configure site policies, and delete saved words. Settings → Privacy includes a translation-cache clearing action. Local settings and vocabulary remain until the user deletes them or uninstalls the extension. Cached entries may also be evicted by the cache policy. Browser extension-storage tools or uninstalling can remove local configuration and caches. Export needed vocabulary first. Deleting local data does not recall information already sent to providers.

### Contact

Use the [Foxtranslate issue tracker](https://github.com/Foxmori-Official/Foxtranslate/issues). Remove API keys and private content before posting a public issue.
