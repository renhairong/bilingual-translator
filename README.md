# Bilingual AI Translator

A Chrome/Edge extension that automatically translates web pages into Chinese using AI, with bilingual display. Supports OpenAI-compatible API providers including DeepSeek, Qwen, GLM, and any other provider that offers an OpenAI-compatible endpoint.

---

## Features

- **Auto-translate** — Automatically translates supported web pages on load
- **Bilingual display** — Original text on top, translation below, side by side
- **Multiple display modes** — Bilingual or translation-only view
- **Multi-language support** — Auto-detect source language + 7 target languages (Chinese, English, Japanese, Korean, Spanish, German, French)
- **Any AI model** — Works with any OpenAI-compatible API (DeepSeek, Qwen, GLM, etc.)
- **Per-model API keys** — Each model can have its own API key stored separately
- **Translation cache** — Caches translations to save API calls; supports per-page and full cache clearing
- **Customizable styles** — Adjust translation text color and font size
- **Error notification** — Friendly error messages shown in the popup when something goes wrong

## Screenshots

| Popup | Settings |
|-------|----------|
| ![Popup](https://via.placeholder.com/280x400?text=Popup) | ![Settings](https://via.placeholder.com/540x600?text=Settings) |

*(Replace placeholder images with your own screenshots)*

---

## Installation

### From Chrome Web Store / Edge Add-ons

*(Coming soon — links will be added once published)*

### Manual Installation (Developer Mode)

1. Download the latest release ZIP or clone this repository
2. Open Chrome/Edge and go to `chrome://extensions` (or `edge://extensions`)
3. Enable **Developer mode** (toggle in the top-right corner)
4. Click **Load unpacked**
5. Select the `bilingual-translator` folder

---

## Configuration

### 1. Open Settings

Click the extension icon in the toolbar, then click the gear icon in the bottom-right corner.

Or right-click the extension icon and select **Options**.

### 2. Configure AI Model

Fill in three fields:

| Field | Description | Example |
|-------|-------------|---------|
| **API Base URL** | Your AI provider's API endpoint (must end with `/v1`) | `https://api.deepseek.com/v1` |
| **API Key** | Your API key for the AI provider | `sk-...` |
| **Model Name** | The model identifier to use | `deepseek-chat` |

Click the preset buttons (DeepSeek / Qwen / GLM) to auto-fill, or enter your own values.

### 3. Language Settings

- **Source Language**: Choose `Auto-detect` or a specific language
- **Target Language**: Choose the language you want to translate into

### 4. Display Preferences

- **Auto-translate**: Toggle automatic translation on/off
- **Display Mode**: `Bilingual` (original + translation) or `Translation only`
- **Translation Color**: Customize the text color of translations

---

## Usage

### From the Popup

| Button | Action |
|--------|--------|
| **Re-translate this page** | Clears existing translations and re-translates the page |
| **Show original** | Removes translations and prevents auto re-translate |
| **Auto-translate toggle** | Enables or disables automatic translation |

### Cache Management

- **Clear current page cache** — Removes cached translations for the current URL (all language pairs)
- **Clear all cache** — Removes all cached translations across all pages

---

## Supported Language Pairs

| Source | Target |
|--------|--------|
| Auto-detect | 🇨🇳 Chinese (Simplified) |
| 🇬🇧 English | 🇬🇧 English |
| 🇨🇳 Chinese | 🇯🇵 Japanese |
| 🇯🇵 Japanese | 🇰🇵 Korean |
| 🇰🇵 Korean | 🇪🇸 Spanish |
| 🇪🇸 Spanish | 🇩🇪 German |
| 🇩🇪 German | 🇫🇷 French |
| 🇫🇷 French | |

---

## Privacy

This extension **does not collect any personal data**:

- **API keys** are stored locally in your browser via `chrome.storage.sync`
- **Translation requests** are sent directly to the AI provider you configure — no intermediate servers
- **Translation cache** is stored locally in your browser and can be cleared at any time
- **No analytics**, no tracking, no third-party services

See the full [Privacy Policy](privacy.html) for details.

**Privacy policy URL:** [https://26c1a7c0d0164f32a6b689a30a8274f0.app.codebuddy.work/privacy.html](https://26c1a7c0d0164f32a6b689a30a8274f0.app.codebuddy.work/privacy.html)

---

## Tech Stack

- Manifest V3
- Chrome Extension APIs (`storage`, `unlimitedStorage`)
- OpenAI-compatible API interface
- Vanilla JavaScript (no frameworks)

---

## License

Copyright © mrleocc. All rights reserved.

For feedback: [mrleocc88@gmail.com](mailto:mrleocc88@gmail.com)
