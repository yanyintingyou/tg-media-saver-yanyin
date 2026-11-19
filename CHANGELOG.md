# Changelog

All notable changes to **TG Media Saver** are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/), and the project
adheres to [Semantic Versioning](https://semver.org/).

## [1.3.0] - 2026-11-19

Batch downloading.

### Added

- ☰ panel listing every media the page has rendered, with checkboxes, select all / invert and
  per-row download.
- Scan: scrolls the chat upward until history stops loading, collects media that was never
  rendered, then restores the scroll position.
- Photos now write into the granted directory as `photo-N.jpg`; previously they fell back to the
  browser's Save dialog.

### Changed

- `download()` takes an optional name hint, so batch rows keep their list name.

## [1.2.0] - 2026-11-17

Web A support.

### Added

- Web A (`web.telegram.org/a/`): media is fetched from `/a/download/<hash>`, the endpoint behind
  Web A's own "Save as". One request, whole file, streamed into the granted directory.
- `weba.telegram.org` match pattern alongside `webk.telegram.org`.

### Changed

- Client detection replaces the `/k/`-only guard; both clients share the capture, queue and UI.
- Manifest name and description cover Web K and Web A.

### Known limits

- Web A saves are named `document<id>.<ext>`: its stream URL carries no file name.
- Web A photos and file messages stay in-memory blobs with no stream URL, so they are not saved.

## [1.1.0] - 2026-11-17

Fork for Telegram Web K, extension only.

### Added

- Directory granted once (`showDirectoryPicker`), then every file is written into it.
- Serial download queue with per-button progress, ✓ and ✗ states.
- Save button inside the fullscreen media viewer.
- Numeric suffix on name conflicts: `name (1).mp4`.
- `/k/` guard: the script idles on other Telegram clients instead of producing partial files.
- Chinese README (`README.zh-CN.md`).

### Changed

- Extension targets `web.telegram.org/k/*` and `webk.telegram.org/*` only.
- `page` resolves to `window`; the `unsafeWindow` branch is gone.
- `src/content.js` exports `__setDir` for tests to inject a fake directory.

### Removed

- Userscript build (`tg-media-saver.user.js`, `src/userscript.meta.js`).
- `dist/` zip, toolbar popup, `scripts/make_icons.py`, Russian README, `docs/`.

## [1.0.1] - 2026-07-26

### Added

- Test suite on Node's built-in runner (`npm test`, no dependencies): unit tests for the pure
  helpers, the core `download()` engine (Range chunking, blob concatenation, `blob:`/`data:`
  single-shot, "server ignores Range" fallback, error propagation), the content-script boot
  path, and end-to-end build/manifest validation.
- GitHub Actions CI (`.github/workflows/ci.yml`) running `npm test` on push/PR, with a CI badge
  in the README.
- Bilingual README: English base (`README.md`) + Russian (`README.ru.md`).

### Changed

- `download()` now returns the final file name **with extension** in every branch (previously
  the `blob:`/`data:` and no-`Range` branches returned the base name without extension).
- Renamed the internal stream-descriptor parser `describe` → `describeStream` (clearer; avoids
  clashing with test-framework globals) and exposed it, along with `download`, via a guarded
  `module.exports` test hook (no-op in browsers).

## [1.0.0] - 2026-07-26

### Added

- Initial public release.
- Save photos, videos, GIFs and voice messages from Telegram Web (`/k/` and `/z/`),
  including channels with "restrict saving content" enabled.
- Two distribution modes from a single source (`src/content.js`):
  - Tampermonkey / Violentmonkey **userscript** (`tg-media-saver.user.js`);
  - **Chrome MV3 extension** (`extension/`, MAIN-world content script).
- Inline ⬇ buttons on feed media + floating ⬇ button with file name/size and progress.
- Real file names and extensions parsed from Telegram's `/stream/` descriptor.
- Streaming to disk via the File System Access API, with an in-memory Blob fallback.
- Toolbar help popup for the extension; generated PNG icons (16/48/128/512).
- Build tooling: `scripts/build.sh` (userscript + extension + store zip) and
  `scripts/make_icons.py` (Pillow via `uv`).
- Console helpers: `tgSaver.status()`, `tgSaver.downloadLast()`, `tgSaver.debug()`.
