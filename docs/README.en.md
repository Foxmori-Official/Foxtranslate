<div align="center">
  <img src="../public/icons/foxtranslate-logo.png" alt="" width="80" height="80">
  <h1>Foxtranslate</h1>
  <p>Read webpages in two languages, translate captions and documents, and save words for review</p>
  <p><a href="https://chromewebstore.google.com/detail/oebmlalinodadlbommbkkpijkcnhdhln"><img src="https://img.shields.io/badge/Chrome%20Web%20Store-Install-1A73E8?style=for-the-badge&amp;logo=googlechrome&amp;logoColor=white" alt="Install Foxtranslate from the Chrome Web Store"></a></p>
  <p><a href="https://github.com/Foxmori-Official/Foxtranslate/releases/latest">Download</a> · <a href="#install">Installation</a> · <a href="../README.md">简体中文</a></p>
</div>

Requires Chrome / Edge 140 or newer for extension storage isolation and document parsing.

## Install

1. Download the `foxtranslate-version.zip` extension asset from [GitHub Releases](https://github.com/Foxmori-Official/Foxtranslate/releases/latest) and extract it.
2. Open `chrome://extensions` or `edge://extensions`. Enable Developer mode, choose **Load unpacked**, and select the folder containing `manifest.json`.
3. Pick a target language and translation engine during setup, then pin Foxtranslate to the toolbar. The default free engine is ready to use. Open a webpage and choose **Translate this page**.

The settings sidebar shows your installed version next to **About and updates**. Open it and choose **Check for updates** to find the latest stable release on GitHub. To upgrade, copy the new files into the existing extension folder, click **Reload** in your browser’s extension manager, then refresh open webpages.

This page describes the current source. See the notes for each download in the [release history](../CHANGELOG.md).

## What you can do

- **Read foreign-language webpages.** Switch between bilingual and translation-only views. Right-click a selection to translate it, press the configured modifier while hovering over a paragraph, or use a shortcut to translate text in an editable field.
- **Translate video and meeting captions.** Use the fox button in the YouTube player. For browser-based Google Meet, Microsoft Teams, and Zoom, turn on captions in the meeting platform first.
- **Translate and edit documents.** Import PDF, EPUB, DOCX, PPTX, XLSX, HTML, JSON, Markdown, TXT, SRT, VTT, or ASS. Review individual segments before downloading. PDF exports as HTML.
- **Save and review vocabulary.** Save words and examples while reading, review due cards with FSRS, and optionally highlight saved words on webpages.

YouTube translation requires a readable caption track on a regular watch page. PDF input requires extractable text and exports as bilingual or translation-only HTML.

## Translation engines

| Setup | Services |
| --- | --- |
| Free without a key | Google, Microsoft, and MyMemory, with fallback among the free engines |
| Foxmori subscription | Connect a signed-in website account, choose an available subscription group, and configure a key |
| Bring your own configuration | DeepL, OpenAI-compatible services, DeepSeek, Claude, Gemini, self-hosted LibreTranslate, and custom services |

In **Settings → Translation engines**, configure and test a service before setting it as the current engine. Expert prompts and AI reading features use supported AI engines. Glossaries keep translations of selected terms consistent.

## Privacy

Foxtranslate includes no telemetry. The browser stores settings, API keys, vocabulary, and translation caches locally. Translation and AI features send the necessary text to the relevant services. Automatic translation and free-engine fallback can also send requests. Local sensitive-data masking is optional. [Privacy policy](../PRIVACY.md)

## Build from source

Use Node.js 22 and npm, then load the `dist` folder as an unpacked extension.

```sh
git clone https://github.com/Foxmori-Official/Foxtranslate.git
cd Foxtranslate
npm ci
npm run build
```

See the [architecture](architecture.md) and the [build, verification, and release guide](UPDATING.md).

## Credits and license

Foxtranslate is licensed under GPL-3.0. Thanks to the authors and contributors of KISS Translator, FluentRead, Read Frog, Interline, OpenImmersive Translator, and MTranBrowser. [License](../LICENSE) · [Third-party notices](third-party.md)
