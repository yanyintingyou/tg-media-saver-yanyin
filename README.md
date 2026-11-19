# TG Media Saver

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Chrome](https://img.shields.io/badge/Chrome-MV3-229ed9.svg)](https://developer.chrome.com/docs/extensions/mv3)

**中文 → [README.zh-CN.md](./README.zh-CN.md)**

Save video, audio and photos from Telegram Web, including chats that disable saving. Install the extension once, then click the button on the media you want.

## What it does

| Feature | Effect |
|---|---|
| Save one item | A ⬇ button sits on each media, and another at the top-left of the fullscreen viewer |
| Pick the folder once | The first save asks for a folder. Every later file lands there without a dialog |
| Batch panel (☰) | Media the page has loaded drops into a checkable list. Tick what you want and download it in one go, with per-row progress |
| Scan history | Scrolls the chat upward and opens each unplayed video poster, so those videos enter the list too |
| Real file names | Web K carries the Telegram file name in its stream address. Duplicates get ` (1)`, ` (2)` |
| Serial queue | Files download one after another, each with its own percentage, ✓ or ✗ |
| Streamed writes | With File System Access, bytes go straight to disk. A few hundred MB does not sit in memory |
| Bilingual UI | English by default. The 中 / EN button switches language and remembers the choice in `localStorage` |

## What saving looks like

Open a chat, scroll to the message, click the video so it plays. A ⬇ appears on the media. Click it, pick a folder the first time, and the file starts writing.

The button counts up in percent, then turns into ✓. A 207 MB video shows in the list as `Pmv-112 (阿里宝贝) .mp4 · 207 MB`, and that is exactly the name and size you get on disk, ready to play.

For the next file, scroll to it and click its own ⬇. It writes into the same folder, no questions asked.

To save several, press ☰. Each row has a checkbox on the left and a ↓ on the right that downloads just that row. All and Invert handle selection, Download selected (N) sends them through the queue in order. Videos you never played stay out of the list until you press Scan, which walks the chat upward and opens each poster to collect them.

## Web K vs Web A

| | Web K (`/k/`) | Web A (`/a/`) |
|---|---|---|
| Stream address | `/k/stream/<descriptor>` with name and size inside | `/a/progressive/document<id>`, id only |
| Enters the list when | The video has played, or Scan opened its poster | The message scrolls into view and mounts a `<video>` |
| Saved file name | The Telegram file name | `document<id>.mp4` |
| Photos | Yes, saved as `photo-N.jpg` | Yes, saved as `photo-N.jpg` |
| Batch collection | Needs a Scan | Scrolling is enough, Scan is optional |

Messages stay in sync, so you can keep both clients open in two tabs: chat in A, save in K when you want the original file names.

## Install

1. Open `chrome://extensions` and turn on Developer mode.
2. Click Load unpacked and pick the `extension/` folder of this repo.
3. Open `https://web.telegram.org/k/` or `https://web.telegram.org/a/` and hard-reload the tab with Ctrl+Shift+R.

Chrome may warn about developer-mode extensions after a restart. Keep the extension enabled.

## Use

**One file**

1. Open a chat, scroll to the message, click the video so it plays.
2. Click the ⬇ on the media, or the one at the top-left of the fullscreen viewer.
3. Pick a folder on the first save. Later saves reuse it.
4. The button shows a percentage, then ✓. A red ✗ means the download failed; click to retry.

**Several files**

1. Press ☰ at the bottom-left to open the batch panel.
2. Tick the rows you want, or press All.
3. Press Download selected. Files write in order, each row reporting its own state.
4. Press Scan to collect videos you never played. The extension scrolls up and opens each poster as it goes.

The single ⬇ on its own saves whatever media loaded last, without opening the panel.

## Limits

- Web K and Web A only. `/z/` redirects to `/a/`; the desktop and mobile apps are out of scope.
- File messages (zip, pdf, epub) and stickers are not handled.
- Web A stream addresses carry no file name, so those saves are named `document<id>.mp4`.
- Photos on both clients save as `photo-N.jpg`; their blob URLs carry no name.
- The batch list lives in memory. Reloading the page or switching chats empties it.
- The folder grant lives in memory. After a browser restart, the next save asks again.
- Scan stops after 400 steps, when the chat stops loading history, when you press Scan again, or when you switch chats. Long chats take minutes and pull a lot of media.
- A video poster is never saved as a photo. The picture inside a video message is its preview, and Scan opens it to collect the video behind it.
- 2 GB per file, the Telegram upload ceiling.
- Downloads depend on Telegram's Service Worker. If the video will not play, no tool can save it. Reload the tab, or unregister the service worker in DevTools and reload.

## Troubleshooting

| Symptom | Fix |
|---|---|
| No ⬇ buttons | Confirm the tab URL starts with `web.telegram.org/k/` or `web.telegram.org/a/`, then hard-reload |
| Nothing happens on click | Open the console and look for `[TG Media Saver]` errors |
| ✗ with the Service Worker hint | Hard-reload the tab. If it persists, DevTools → Application → Service Workers → Unregister, then reload |
| Button stuck at 0% | The stream stalled. Reload, play again, retry |
| Files named `document_123...mp4` | The stream carried no file name, which is always the case on Web A. The fallback name is used |
| Scan adds nothing | On Web K, an unplayed video enters the list only after its poster is opened. Check that the viewer opens and closes while scanning |

## Develop

```bash
bash scripts/build.sh   # copy src/content.js into extension/
npm test                # unit + download engine + build checks
```

Edit `src/content.js` only. `extension/content.js` is generated.

## Rights

The tool downloads media your account can already view. Use it for content you have the right to keep. Not affiliated with Telegram.

Forked from [eiler2005/tg-media-saver](https://github.com/eiler2005/tg-media-saver) (MIT), trimmed to the extension path and extended with Web A support, the folder grant, the batch panel and scanning. Original work: MIT © 2026 Denis Ermilov. Fork changes use the same license.
