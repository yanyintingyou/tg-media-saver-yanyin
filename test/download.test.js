"use strict";
// Tests for the core download engine (download()) against a mocked page context.
// Verifies HTTP Range chunking, blob concatenation, the blob:/data: single-shot
// branch, the "server ignores Range" fallback and the File System Access path —
// without a browser or network.
const { test } = require("node:test");
const assert = require("node:assert/strict");

const { installDomShim } = require("./helpers");
const win = installDomShim(); // document.body = null -> boot() is skipped on require
const { download, __setDir } = require("../src/content.js");

// ---- mock page context (download() uses `page.*`, and page === win) ----
class MockBlob {
  constructor(parts = [], opts = {}) {
    this.parts = parts;
    this.type = opts.type || "";
    this.size = parts.reduce(
      (n, p) => n + (typeof p === "string" ? p.length : p && p.size ? p.size : 0),
      0
    );
  }
}

const created = []; // anchors created via document.createElement
function setupPage({ fetchImpl }) {
  created.length = 0;
  win.Blob = MockBlob;
  win.URL = { createObjectURL: () => "blob:mock-url", revokeObjectURL: () => {} };
  delete win.showDirectoryPicker;
  __setDir(null);
  win.fetch = fetchImpl;
  global.document.body = { appendChild() {}, removeChild() {} };
  global.document.createElement = (tag) => {
    const el = { tag, style: {}, click() {}, remove() {}, setAttribute() {} };
    created.push(el);
    return el;
  };
}

// Fake granted directory: tracks created file names, feeds a writable per file.
function setupDir() {
  const files = new Set();
  const writes = [];
  const state = { closed: false, aborted: false, name: null };
  const writable = {
    write: async (blob) => {
      writes.push(blob);
    },
    close: async () => {
      state.closed = true;
    },
    abort: async () => {
      state.aborted = true;
    },
  };
  __setDir({
    name: "mock-dir",
    getFileHandle: async (name, opts) => {
      if (!files.has(name) && !(opts && opts.create)) {
        const err = new Error("not found");
        err.name = "NotFoundError";
        throw err;
      }
      files.add(name);
      return {
        createWritable: async () => {
          state.name = name;
          state.closed = false;
          state.aborted = false;
          return writable;
        },
      };
    },
  });
  return { writes, state, files };
}

const res = (status, headers, body) => ({
  status,
  headers: { get: (name) => headers[name.toLowerCase()] ?? null },
  blob: async () => new MockBlob([body], { type: headers["content-type"] }),
});

const streamUrl = (obj) => "https://web.telegram.org/k/stream/" + encodeURIComponent(JSON.stringify(obj));
const lastAnchor = () => created.filter((e) => e.tag === "a").pop();

// ---------- Range chunking ----------
test("download: assembles a file from Range chunks", async () => {
  const calls = [];
  setupPage({
    fetchImpl: async (url, opts) => {
      const range = opts.headers.Range;
      calls.push(range);
      const start = Number(range.replace("bytes=", "").replace("-", ""));
      if (start === 0) {
        return res(206, { "content-type": "video/mp4", "content-range": "bytes 0-49/100" }, "a".repeat(50));
      }
      if (start === 50) {
        return res(206, { "content-type": "video/mp4", "content-range": "bytes 50-99/100" }, "b".repeat(50));
      }
      throw new Error("unexpected range " + range);
    },
  });

  const progress = [];
  const url = streamUrl({ fileName: "movie.mp4", size: 100, mimeType: "video/mp4", dcId: 2 });
  const name = await download(url, (p) => progress.push(p));

  assert.equal(name, "movie.mp4");
  assert.deepEqual(calls, ["bytes=0-", "bytes=50-"]);
  assert.deepEqual(progress, [0.5, 1]);

  const a = lastAnchor();
  assert.equal(a.href, "blob:mock-url");
  assert.equal(a.download, "movie.mp4");
});

// ---------- server ignores Range ----------
test("download: falls back to whole-file save when the server ignores Range", async () => {
  let count = 0;
  setupPage({
    fetchImpl: async () => {
      count++;
      return res(200, { "content-type": "video/mp4" }, "x".repeat(123)); // no Content-Range
    },
  });

  const progress = [];
  const url = streamUrl({ fileName: "one.mp4", size: 123, mimeType: "video/mp4" });
  const name = await download(url, (p) => progress.push(p));

  assert.equal(name, "one.mp4");
  assert.equal(count, 1, "must fetch exactly once");
  assert.deepEqual(progress, [1]);
  assert.equal(lastAnchor().download, "one.mp4");
});

// ---------- blob:/data: single shot ----------
test("download: blob: source is fetched in a single shot", async () => {
  const calls = [];
  setupPage({
    fetchImpl: async (url) => {
      calls.push(url);
      return res(200, { "content-type": "video/webm" }, "y".repeat(10));
    },
  });

  const name = await download("blob:https://web.telegram.org/abc-123");

  assert.equal(calls.length, 1);
  assert.equal(calls[0], "blob:https://web.telegram.org/abc-123");
  assert.match(name, /\.webm$/, "name gets the mime-derived extension");
  assert.equal(lastAnchor().download, name);
});

// ---------- error propagation ----------
test("download: surfaces non-2xx responses as errors", async () => {
  setupPage({ fetchImpl: async () => res(403, { "content-type": "video/mp4" }, "") });
  const url = streamUrl({ fileName: "x.mp4", size: 1, mimeType: "video/mp4" });
  await assert.rejects(() => download(url), /HTTP 403/);
});

// ---------- File System Access (stream to a granted directory) ----------
const chunkedFetch = async (url, opts) => {
  const start = Number(opts.headers.Range.replace("bytes=", "").replace("-", ""));
  if (start === 0) {
    return res(206, { "content-type": "video/mp4", "content-range": "bytes 0-49/100" }, "a".repeat(50));
  }
  if (start === 50) {
    return res(206, { "content-type": "video/mp4", "content-range": "bytes 50-99/100" }, "b".repeat(50));
  }
  throw new Error("unexpected range " + opts.headers.Range);
};

test("download: streams Range chunks into the granted directory", async () => {
  setupPage({ fetchImpl: chunkedFetch });
  const { writes, state } = setupDir();

  const progress = [];
  const url = streamUrl({ fileName: "movie.mp4", size: 100, mimeType: "video/mp4" });
  const name = await download(url, (p) => progress.push(p));

  assert.equal(name, "movie.mp4");
  assert.equal(state.name, "movie.mp4");
  assert.equal(writes.length, 2, "both chunks written to the writable");
  assert.equal(state.closed, true, "writable closed on success");
  assert.equal(state.aborted, false, "not aborted on success");
  assert.deepEqual(progress, [0.5, 1]);
  assert.equal(lastAnchor(), undefined, "no anchor download in the directory path");
});

test("download: existing file name gets a numeric suffix", async () => {
  setupPage({ fetchImpl: chunkedFetch });
  const { files } = setupDir();
  files.add("movie.mp4");

  const url = streamUrl({ fileName: "movie.mp4", size: 100, mimeType: "video/mp4" });
  const name = await download(url);

  assert.equal(name, "movie (1).mp4");
});

test("download: aborts the writable when a chunk fetch fails", async () => {
  setupPage({
    fetchImpl: async (url, opts) => {
      const start = Number(opts.headers.Range.replace("bytes=", "").replace("-", ""));
      if (start === 0) {
        return res(206, { "content-type": "video/mp4", "content-range": "bytes 0-49/100" }, "a".repeat(50));
      }
      return res(500, { "content-type": "video/mp4" }, ""); // second chunk fails
    },
  });
  const { writes, state } = setupDir();

  const url = streamUrl({ fileName: "movie.mp4", size: 100, mimeType: "video/mp4" });
  await assert.rejects(() => download(url), /HTTP 500/);

  assert.equal(writes.length, 1, "first chunk written before the failure");
  assert.equal(state.aborted, true, "writable aborted on error");
  assert.equal(state.closed, false, "writable not closed on error");
});
