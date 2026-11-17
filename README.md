# TG Media Saver (Web K fork)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Chrome](https://img.shields.io/badge/Chrome-MV3-229ed9.svg)](https://developer.chrome.com/docs/extensions/mv3)

**中文 → [README.zh-CN.md](./README.zh-CN.md)**

Save videos, audio and photos from Telegram Web K, including chats that disable saving.
A fork of [eiler2005/tg-media-saver](https://github.com/eiler2005/tg-media-saver) (MIT),
trimmed to the Chrome extension and tuned for saving a handful of files.

## What changed from upstream

| Change | Why |
|---|---|
| Extension only | The userscript path duplicated the logic and needed `unsafeWindow` |
| Web K only | Web A streams media as MSE blobs, which cannot be downloaded reliably |
| Directory granted once | `showDirectoryPicker` runs on the first save; later files land in the same folder without dialogs |
| Serial queue | Clicking several buttons downloads them one after another, each with its own progress state |
| Save button in the fullscreen viewer | Opening a video full screen is the usual path; the button sits top-left |
| Name conflicts get ` (1)`, ` (2)` | Telegram media often repeats names across chats |
| Popup removed | It only repeated the README; fewer files to audit |

## Install

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and pick the `extension/` folder of this repo.
3. Open `https://web.telegram.org/k/` and hard-reload the tab (Ctrl+Shift+R).

Chrome may warn about developer-mode extensions after a restart. Keep the extension enabled.

## Use

1. Open a chat, scroll to the message, press play on the video.
2. Click the ⬇ button on the media, or the one at the top-left of the fullscreen viewer.
3. Pick a folder on the first save. Later files land there with their Telegram names.
4. The button shows a percentage, then ✓. A red ✗ means the download failed; click to retry.

The floating button at the bottom-left saves whatever media loaded last.

## Limits

- Web K only. On `/a/` the extension stays idle.
- The folder grant lives in memory. After a browser restart, the next save asks again.
- File messages (zip, pdf, epub) are not handled; video, audio and photos only.
- 2 GB per file, the Telegram upload ceiling.
- Downloads depend on Telegram's Service Worker. If the video will not play, no tool can save it. Reload the tab, or unregister the service worker in DevTools and reload.

## Troubleshooting

| Symptom | Fix |
|---|---|
| No ⬇ buttons | Confirm the tab URL starts with `web.telegram.org/k/`, then hard-reload |
| Nothing happens on click | Open the console and look for `[TG Media Saver]` errors |
| ✗ with the Service Worker hint | Hard-reload the tab. If it persists, DevTools → Application → Service Workers → Unregister, then reload |
| Button stuck at 0% | The stream stalled. Reload, play again, retry |
| Files named `document_123...mp4` | The stream descriptor carried no `fileName`; the fallback name is used |

## Develop

```bash
bash scripts/build.sh   # copy src/content.js into extension/
npm test                # unit + download engine + build checks
```

Edit `src/content.js` only. `extension/content.js` is generated.

## Rights

The tool downloads media your account can already view. Use it for content you have the
right to keep. Not affiliated with Telegram.

Original work: MIT © 2026 Denis Ermilov. Fork changes: MIT, same license.
