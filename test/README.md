# Tests

Node's built-in test runner, no dependencies.

```bash
npm test          # or: node --test test/*.test.js
```

CI (`.github/workflows/ci.yml`) runs `npm test` on push and pull requests.

## Suites

- `test/unit.test.js` — pure helpers: `describeStream`, `humanSize`, `extFromMime`, `withExt`.
- `test/download.test.js` — `download()` against a mocked `page.fetch`: Range chunking, the
  "server ignores Range" fallback, `blob:`/`data:` single-shot, non-2xx errors, and the
  directory path (streaming into a granted folder, name conflicts, abort on failure).
- `test/content.test.js` — loads `src/content.js` under a DOM shim and checks the `tgSaver`
  console API.
- `test/build.test.js` — runs `scripts/build.sh`, verifies the copy matches the source, and
  validates the manifest (MV3, MAIN world, `/k/` matches, no permissions, files present).

## Hooks the tests rely on

- `src/content.js` ends with a guarded `module.exports` block. In Node it exposes the helpers,
  `download` and `__setDir` (injects a fake directory handle). In browsers `module` is
  undefined, so the block is a no-op.
- `test/helpers.js` sets `global.window = {}` and a minimal `document` with `body: null`, so
  the IIFE loads without running `boot()`. Tests then install recording `createElement` and
  `document.body` as needed.

## Before committing

```bash
npm test
bash scripts/build.sh   # keeps extension/content.js in sync
```

Manual smoke test on `web.telegram.org/k/`: play a video, click ⬇, confirm the file name and
size match what Telegram reports.
