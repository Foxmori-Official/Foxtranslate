# Foxtranslate 商店资料

从待提交版本的 `public/_locales/<locale>/messages.json` 复制 `extName` 与 `extDescription`。详情页文案在[各语言模板](../docs/store-listing/)中。截图使用待发布安装包实际渲染的页面。

隐私政策使用公开的 [Foxtranslate 隐私政策](https://github.com/Foxmori-Official/Foxtranslate/blob/main/PRIVACY.md)。扩展内「设置 → 隐私」也有入口。

## 权限说明

| 权限 | 用途 |
| --- | --- |
| `storage` | 在浏览器保存设置、API Key、翻译缓存、生词和复习进度 |
| `contextMenus` | 提供网页翻译和打开扩展设置的右键入口 |
| `content_scripts` 的网站匹配 | 在网页上执行用户配置的整页、划词和输入框翻译，在指定视频与会议页面处理字幕 |
| `host_permissions` | 请求内置翻译服务；用户连接 Foxmori 时，通过主站读取账户和可用分组，并按操作创建或复用密钥 |
| `optional_host_permissions` | 为用户配置的自定义翻译端点申请相应域名权限 |

翻译和 AI 功能会向服务发送所需文本，自动翻译等开关也可触发请求。连接 Foxmori 是可选操作。数据申报以待审版本的实际行为与隐私政策为依据。

## 审核测试说明

1. Load the extension and open an ordinary webpage. Use the toolbar action to translate the page with the default free engine.
2. Select text to open the translation bubble and save a word. Open Vocabulary from the popup to review it.
3. Open Settings to switch the display mode or review the optional engine settings. For YouTube, use a regular watch page with a readable caption track.
4. Open the Privacy tab and follow the privacy policy link to see how local storage and provider requests are handled.

## 构建

```sh
npm run build:store
npm run verify:package
node scripts/zip-dist.mjs
```

商店截图和宣传图保存在本地 `store-assets/screenshots/` 和 `store-assets/promo/`。参考[发布与验收指南](../docs/UPDATING.md)核对安装包。
