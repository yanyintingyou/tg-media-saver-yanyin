/*
 * TG Media Saver — fork for Telegram Web K (/k/) and Web A (/a/), directory-once saving.
 * Based on TG Media Saver by Denis Ermilov (MIT).
 *
 * How it works:
 *  - Both clients stream media through their own Service Worker, and both only serve
 *    bytes when the fetch runs in the PAGE context, so every request goes through
 *    `window.fetch`.
 *      /k/  /k/stream/<urlencoded JSON descriptor>  — descriptor carries name/size/mime,
 *           ranged 206 responses.
 *      /a/  /a/progressive/document<id>             — ranged 206, 512KB per part. Swapping
 *           `progressive` for `download` yields the whole file as one 200 stream, which is
 *           the endpoint Web A's own "Save as" uses.
 *  - Media URLs are discovered by polling <video>/<audio>/<img> sources.
 *  - Saving: ask for a directory once (File System Access API), then write each
 *    file straight into it. Without FSA, fall back to an in-memory Blob download.
 */
(function () {
  "use strict";

  const page = window;
  const TAG = "[TG Media Saver]";
  const POLL_MS = 600;
  const INLINE = "tgs-inline-btn";
  const CLIENT = (() => {
    if (typeof location === "undefined") return null;
    const { hostname, pathname } = location;
    if (hostname === "webk.telegram.org" || pathname.startsWith("/k/")) return "k";
    if (hostname === "weba.telegram.org" || pathname.startsWith("/a/")) return "a";
    return null;
  })();

  let verbose = false;
  const log = (...a) => {
    if (verbose) console.log(TAG, ...a);
  };
  const info = (...a) => console.info(TAG, ...a);
  const fail = (...a) => console.error(TAG, ...a);

  // ---------- helpers ----------
  const humanSize = (n) => {
    if (!n) return "";
    const u = ["B", "KB", "MB", "GB"];
    let i = 0;
    while (n >= 1024 && i < u.length - 1) {
      n /= 1024;
      i++;
    }
    return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
  };

  const extFromMime = (mime) => {
    const map = {
      "video/mp4": "mp4",
      "video/webm": "webm",
      "video/quicktime": "mov",
      "audio/ogg": "ogg",
      "audio/mpeg": "mp3",
      "audio/mp4": "m4a",
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/gif": "gif",
      "image/webp": "webp",
    };
    return map[mime] || (mime ? mime.split("/")[1] : "") || "bin";
  };

  const withExt = (name, mime) => {
    const ext = extFromMime(mime);
    if (!ext) return name;
    return /\.[a-z0-9]+$/i.test(name) ? name : `${name}.${ext}`;
  };

  // /k/stream/<urlencoded JSON> -> {name,size,mime,dcId} | null
  const describeStream = (url) => {
    try {
      const seg = url.split("/").pop();
      const d = JSON.parse(decodeURIComponent(seg));
      if (d && (d.fileName || d.size)) {
        return { name: d.fileName || null, size: d.size || 0, mime: d.mimeType || null, dcId: d.dcId };
      }
    } catch (_) {
      /* not a stream descriptor */
    }
    return null;
  };

  // /a/progressive/<hash> -> the same file as one whole-file 200 stream.
  const toDownloadUrl = (url) => {
    const u = new URL(url, location.href);
    u.pathname = u.pathname.replace("/progressive/", "/download/");
    u.searchParams.delete("fileSize");
    u.searchParams.delete("mimeType");
    return u.href;
  };

  const describeSource = (url) => {
    if (url.includes("/progressive/")) {
      const id = url.split("/progressive/")[1].split(/[?#]/)[0];
      return { name: id || null, size: 0, mime: null };
    }
    return describeStream(url);
  };

  // ---------- save target ----------
  let dirHandle = null;

  // Must run inside a user gesture (click). Kept in memory; lost on reload.
  const ensureDir = async () => {
    if (dirHandle) return dirHandle;
    if (!page.showDirectoryPicker) return null;
    dirHandle = await page.showDirectoryPicker({ id: "tg-save", mode: "readwrite" });
    log("directory granted", dirHandle.name);
    return dirHandle;
  };

  // name.ext -> "name (1).ext" when taken
  const freeName = async (dir, name) => {
    const m = /^(.*?)(\.[^./\\]+)?$/.exec(name);
    const base = (m && m[1]) || name;
    const ext = (m && m[2]) || "";
    for (let n = 0; ; n++) {
      const candidate = n ? `${base} (${n})${ext}` : name;
      try {
        await dir.getFileHandle(candidate); // resolves only when the file exists
      } catch (_) {
        return candidate;
      }
    }
  };

  const saveBlob = (blob, name) => {
    const u = page.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = u;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    page.URL.revokeObjectURL(u);
  };

  const writeOut = async (blob, name, writable) => {
    if (writable) {
      await writable.write(blob);
      await writable.close();
      return;
    }
    saveBlob(blob, name);
  };

  // ---------- download engine ----------
  // Reads the response body into the writable, or into memory when there is none.
  const pump = async (res, writable, total, onProgress) => {
    const reader = res.body.getReader();
    const parts = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (writable) await writable.write(value);
      else parts.push(value);
      if (onProgress && total) onProgress(Math.min(received / total, 1));
    }
    return parts;
  };

  // Returns the saved file name. Uses the granted directory when available,
  // otherwise falls back to an in-memory Blob.
  const download = async (url, onProgress, nameHint) => {
    const meta = describeSource(url);
    const base = (meta && meta.name) || nameHint || `tg-media-${Date.now()}`;

    if (/^(blob:|data:)/.test(url)) {
      const blob = await (await page.fetch(url)).blob();
      const finalName = withExt(base, blob.type);
      if (dirHandle) {
        const name = await freeName(dirHandle, finalName);
        const fh = await dirHandle.getFileHandle(name, { create: true });
        const writable = await fh.createWritable();
        try {
          await writable.write(blob);
          await writable.close();
        } catch (err) {
          await writable.abort().catch(() => {});
          throw err;
        }
        if (onProgress) onProgress(1);
        return name;
      }
      await writeOut(blob, finalName);
      if (onProgress) onProgress(1);
      return finalName;
    }

    // Web A: one request for the whole file. The name is only known once the
    // response headers arrive (the hash carries no extension).
    if (url.includes("/progressive/")) {
      const res = await page.fetch(toDownloadUrl(url));
      if (res.status !== 200 && res.status !== 206) throw new Error(`HTTP ${res.status}`);
      const mime = (res.headers.get("Content-Type") || (meta && meta.mime) || "video/mp4").split(";")[0];
      const total = Number(res.headers.get("Content-Length")) || 0;
      let finalName = withExt(base, mime);
      let writable = null;
      if (dirHandle) {
        finalName = await freeName(dirHandle, finalName);
        const fh = await dirHandle.getFileHandle(finalName, { create: true });
        writable = await fh.createWritable();
      }
      try {
        const parts = await pump(res, writable, total, onProgress);
        if (writable) {
          await writable.close();
        } else {
          saveBlob(new page.Blob(parts, { type: mime }), finalName);
        }
        if (onProgress && !total) onProgress(1);
        return finalName;
      } catch (err) {
        if (writable) await writable.abort().catch(() => {});
        throw err;
      }
    }

    let writable = null;
    let finalName = withExt(base, meta && meta.mime);
    if (dirHandle) {
      finalName = await freeName(dirHandle, finalName);
      const fh = await dirHandle.getFileHandle(finalName, { create: true });
      writable = await fh.createWritable();
    }

    const parts = [];
    let offset = 0;
    let total = null;
    let mime = (meta && meta.mime) || "video/mp4";

    try {
      for (;;) {
        const res = await page.fetch(url, { headers: { Range: `bytes=${offset}-` } });
        if (res.status !== 200 && res.status !== 206) throw new Error(`HTTP ${res.status}`);
        mime = (res.headers.get("Content-Type") || mime).split(";")[0];
        const range = res.headers.get("Content-Range");
        const chunk = await res.blob();

        if (!range) {
          // Server ignored Range and sent the whole file at once.
          finalName = withExt(base, mime);
          await writeOut(chunk, finalName, writable);
          writable = null;
          if (onProgress) onProgress(1);
          return finalName;
        }

        const m = /bytes (\d+)-(\d+)\/(\d+)/.exec(range);
        if (!m) throw new Error(`Malformed Content-Range header: ${range}`);
        const end = Number(m[2]);
        total = Number(m[3]);
        if (end + 1 <= offset) throw new Error("Download stalled: server did not advance the offset");

        if (writable) await writable.write(chunk);
        else parts.push(chunk);

        offset = end + 1;
        if (onProgress && total) onProgress(offset / total);
        if (offset >= total) break;
      }

      if (writable) {
        await writable.close();
        writable = null;
      } else {
        finalName = withExt(base, mime);
        saveBlob(new page.Blob(parts, { type: mime }), finalName);
      }
      return finalName;
    } catch (err) {
      if (writable) await writable.abort().catch(() => {});
      throw err;
    }
  };

  // ---------- queue ----------
  let chain = Promise.resolve();
  const enqueue = (task) => {
    chain = chain.then(task, task);
    return chain;
  };

  // ---------- capture ----------
  const state = { last: null };

  const mediaUrl = (el) => (el && (el.currentSrc || el.getAttribute("data-tgs-src") || el.src)) || "";

  // A picture living in a video message is that video's poster frame, not a
  // photo. Both clients keep the poster in the same media block as a <video>, a
  // preview <canvas>, a play badge or a duration badge; photos carry none of
  // those. The duration check stays inside the media block, because every
  // message has a timestamp somewhere in the bubble.
  const isVideoThumb = (im) => {
    const src = im.currentSrc || im.src || "";
    if ([...document.querySelectorAll("video")].some((v) => (v.poster && v.poster === src) || v.currentSrc === src)) return true;

    const media = im.closest(".media-container, .media-inner, .media, .video, .video-container, [class*='video'], [class*='Video']");
    const scope = media || im.closest(".bubble, .message");
    if (!scope) return false;
    if (scope.querySelector("video, canvas")) return true;
    if (scope.querySelector("[class*='play'], [class*='Play'], [class*='video'], [class*='Video']")) return true;
    if (media && scope.querySelector("[class*='duration'], [class*='Duration'], [class*='time'], [class*='Time']")) return true;
    return false;
  };

  const capture = () => {
    document.querySelectorAll("video, audio").forEach((el) => {
      const url = mediaUrl(el);
      if (!url || url.startsWith("data:")) return;
      if (el.getAttribute("data-tgs-src") !== url) {
        el.setAttribute("data-tgs-src", url);
        state.last = { url, kind: el.tagName === "AUDIO" ? "audio" : "video", meta: describeSource(url) };
        log("captured", el.tagName, state.last.meta ? state.last.meta.name : url);
        refreshFloating();
      }
    });
  };

  // ---------- UI ----------
  let floatBtn = null;
  let floatCap = null;

  const BTN_IDLE = "rgba(80,140,190,0.95)";
  const BTN_BUSY = "rgba(90,90,90,0.85)";
  const BTN_OK = "rgba(70,150,90,0.95)";
  const BTN_ERR = "rgba(170,80,80,0.95)";
  const BTN_OFF = "rgba(90,90,90,0.5)";

  const styles = (el, css) => Object.assign(el.style, css);

  const makeButton = (label, title) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.title = title;
    b.setAttribute("aria-label", title);
    return b;
  };

  // ---------- i18n ----------
  // English is the default; the choice is stored per browser.
  const LANG_KEY = "tms-lang";
  const STRINGS = {
    en: {
      batchOpen: "Batch download",
      floatSave: "Save the last loaded media",
      saveMedia: "Save this media",
      savePhoto: "Save this photo",
      playFirst: "Media not loaded yet: play it first",
      nothingCaptured: "Nothing captured yet: play a video or audio",
      loaded: (n) => `Loaded ${n}`,
      scan: "Scan",
      stop: "Stop",
      stopping: "Stopping…",
      scanTitle: "Scroll up and open each poster to collect unplayed videos; click again to stop",
      downloadSelected: (n) => `Download selected (${n})`,
      downloadSelectedTitle: "Download the ticked items",
      selectAll: "All",
      invert: "Invert",
      close: "Close",
      empty: "Nothing yet. Scroll the chat, or press Scan.",
      untitled: "untitled",
      rowDownload: "Download only this one",
      kindV: "V",
      kindA: "A",
      kindP: "P",
      failTitle: (m) => `Failed: ${m} (click to retry)`,
      httpErr: (c) => `Server returned ${c}`,
      netErr: "Network dropped, or Telegram's Service Worker stopped serving: hard-reload and retry",
      noScroller: "Message list not found; scrolling manually also collects media",
      notTelegram: "Not Telegram Web: open https://web.telegram.org/k/ or /a/",
      ready: "ready — ⬇ saves one file, ☰ opens the batch list",
      langSwitch: "Switch to Chinese",
    },
    zh: {
      batchOpen: "批量下载",
      floatSave: "保存最近加载的媒体",
      saveMedia: "保存这个媒体",
      savePhoto: "保存这张图片",
      playFirst: "媒体还没加载：先播放再点",
      nothingCaptured: "尚未捕获媒体：先播放一个视频/音频",
      loaded: (n) => `已加载 ${n} 项`,
      scan: "扫描",
      stop: "停止",
      stopping: "停止中…",
      scanTitle: "向上滚动并逐个打开封面，把未播放的视频也收进来；再点一次停止",
      downloadSelected: (n) => `下载选中 (${n})`,
      downloadSelectedTitle: "下载勾选的项目",
      selectAll: "全选",
      invert: "反选",
      close: "收起",
      empty: "还没有媒体。滚一遍会话，或点「扫描」。",
      untitled: "未命名",
      rowDownload: "只下载这个",
      kindV: "视",
      kindA: "音",
      kindP: "图",
      failTitle: (m) => `失败：${m}（点击重试）`,
      httpErr: (c) => `服务器返回 ${c}`,
      netErr: "网络中断或 Telegram 的 Service Worker 没在供数据：硬刷新后重试",
      noScroller: "找不到消息列表：手动滚一遍也能收集",
      notTelegram: "当前不是 Telegram Web：请打开 https://web.telegram.org/k/ 或 /a/ 后使用",
      ready: "准备就绪 — ⬇ 保存单个，☰ 打开批量列表",
      langSwitch: "切换到英文",
    },
  };

  let lang = "en";
  try {
    if (localStorage.getItem(LANG_KEY) === "zh") lang = "zh";
  } catch (_) {
    /* storage blocked: stay on the default */
  }

  const t = (key, arg) => {
    const v = (STRINGS[lang] && STRINGS[lang][key]) || STRINGS.en[key] || key;
    return typeof v === "function" ? v(arg) : v;
  };

  // Elements that outlive a language switch carry their key, so relabelling is a
  // single pass instead of rebuilding them.
  const tagTitle = (el, key) => {
    el.dataset.tmsTitle = key;
    el.title = t(key);
    el.setAttribute("aria-label", el.title);
  };

  const tagText = (el, key) => {
    el.dataset.tmsText = key;
    el.textContent = t(key);
  };

  const setBtnState = (btn, text, bg) => {
    btn.textContent = text;
    btn.style.background = bg;
    btn.style.cursor = bg === BTN_IDLE ? "pointer" : "default";
  };

  const refreshFloating = () => {
    if (!floatBtn) return;
    const has = !!state.last;
    styles(floatBtn, {
      cursor: has ? "pointer" : "default",
      background: has ? BTN_IDLE : BTN_OFF,
      opacity: has ? "1" : "0.6",
    });
    if (floatCap) {
      const meta = state.last && state.last.meta;
      const text = meta ? `${meta.name || "media"}${meta.size ? " · " + humanSize(meta.size) : ""}` : "";
      floatCap.textContent = text;
      floatCap.style.display = text ? "block" : "none";
    }
  };

  const hint = (err) => {
    const msg = String((err && err.message) || err);
    if (/^HTTP \d+/.test(msg)) return t("httpErr", msg.slice(5));
    if (err instanceof TypeError) return t("netErr");
    return msg;
  };

  const runDownload = async (url, btn) => {
    if (!url || btn.dataset.busy === "1") return;
    btn.dataset.busy = "1";
    setBtnState(btn, "0%", BTN_BUSY);
    try {
      const name = await download(url, (p) => setBtnState(btn, `${Math.round(p * 100)}%`, BTN_BUSY),
        (items.get(url) || {}).name);
      info("saved", name);
      setBtnState(btn, "✓", BTN_OK);
      if (btn === floatBtn && floatCap) floatCap.textContent = name;
    } catch (err) {
      delete btn.dataset.busy;
      if (err && err.name === "AbortError") {
        setBtnState(btn, "⬇", BTN_IDLE);
        return;
      }
      fail("download failed:", hint(err));
      setBtnState(btn, "✗", BTN_ERR);
      btn.title = t("failTitle", hint(err));
      return;
    }
    delete btn.dataset.busy;
  };

  const queueDownload = (url, btn) => {
    if (!url || !btn || btn.dataset.busy === "1") return;
    if (page.showDirectoryPicker && !dirHandle) ensureDir().catch(() => {});
    enqueue(() => runDownload(url, btn));
  };

  const buildFloating = () => {
    floatBtn = makeButton("⬇", t("floatSave"));
    tagTitle(floatBtn, "floatSave");
    styles(floatBtn, {
      position: "fixed",
      left: "14px",
      bottom: "14px",
      zIndex: "2147483646",
      width: "46px",
      height: "46px",
      borderRadius: "50%",
      border: "none",
      color: "#fff",
      fontSize: "20px",
      boxShadow: "0 2px 8px rgba(0,0,0,.4)",
    });
    floatBtn.addEventListener("click", () => {
      if (!state.last) {
        info(t("nothingCaptured"));
        return;
      }
      queueDownload(state.last.url, floatBtn);
    });

    floatCap = document.createElement("div");
    styles(floatCap, {
      position: "fixed",
      left: "14px",
      bottom: "66px",
      zIndex: "2147483646",
      color: "#fff",
      background: "rgba(0,0,0,0.72)",
      padding: "3px 10px",
      borderRadius: "8px",
      fontSize: "11px",
      maxWidth: "280px",
      display: "none",
      pointerEvents: "none",
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis",
    });

    document.body.appendChild(floatBtn);
    document.body.appendChild(floatCap);
    refreshFloating();
  };

  const attachInline = (host, onClick, titleKey, fixed) => {
    if (!fixed && getComputedStyle(host).position === "static") host.style.position = "relative";
    const b = makeButton("⬇", t(titleKey));
    tagTitle(b, titleKey);
    b.className = INLINE;
    styles(b, {
      position: fixed ? "fixed" : "absolute",
      top: "12px",
      left: fixed ? "12px" : "auto",
      right: fixed ? "auto" : "6px",
      zIndex: fixed ? "2147483647" : "40",
      width: "30px",
      height: "30px",
      borderRadius: "50%",
      border: "none",
      background: BTN_IDLE,
      color: "#fff",
      fontSize: "15px",
    });
    b.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      onClick();
    });
    host.appendChild(b);
  };

  const decorate = () => {
    document.querySelectorAll("video, audio").forEach((el) => {
      if (el.offsetWidth < 80 || el.offsetHeight < 80) return;
      const host = el.closest(".media, .bubble, .message") || el.parentElement;
      if (!host || host.querySelector("." + INLINE)) return;
      attachInline(
        host,
        () => {
          const url = mediaUrl(el);
          if (url) queueDownload(url, host.querySelector("." + INLINE));
          else info(t("playFirst"));
        },
        "saveMedia"
      );
    });

    document.querySelectorAll(".bubble img, .media img, .message img").forEach((im) => {
      if (im.offsetWidth < 120 || im.offsetHeight < 120) return;
      if (isVideoThumb(im)) return;
      const host = im.closest(".media, .bubble, .message") || im.parentElement;
      if (!host || host.querySelector("." + INLINE)) return;
      attachInline(
        host,
        () => {
          const url = im.currentSrc || im.src;
          if (url) queueDownload(url, host.querySelector("." + INLINE));
        },
        "savePhoto"
      );
    });

    // Fullscreen viewer: fixed button top-left (Telegram puts close on the right).
    const viewer = document.querySelector("#MediaViewer, .media-viewer-whole");
    const video = viewer && viewer.querySelector("video");
    if (video && !viewer.querySelector("." + INLINE)) {
      attachInline(
        viewer,
        () => {
          const url = mediaUrl(video);
          if (url) queueDownload(url, viewer.querySelector("." + INLINE));
          else info(t("playFirst"));
        },
        "saveMedia",
        true
      );
    }
  };

  // ---------- batch ----------
  const items = new Map();
  let panel = null;
  let listEl = null;
  let countEl = null;
  let dlBtn = null;
  let scanBtn = null;
  let toggleBtn = null;
  let selAllBtn = null;
  let invBtn = null;
  let closeBtn = null;
  let langBtn = null;
  let renderedCount = -1;
  let scanning = false;
  let scanStop = false;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Both clients keep the current peer in the location hash (`#@name`, `#-100...`).
  // Switching chats has to drop the previous list, otherwise the panel keeps
  // showing media from the conversation the user already left.
  const peerFromHash = () => {
    if (typeof location === "undefined") return "";
    const h = (location.hash || "").replace(/^#/, "");
    if (!h) return "";
    if (h.startsWith("?")) return null;
    return h.split("?")[0];
  };
  let session = peerFromHash() || "";
  let imgSeq = 0;

  const dropList = () => {
    items.clear();
    imgSeq = 0;
    renderedCount = -1;
    state.last = null;
    if (panel && !panel.hidden) renderPanel();
  };

  const syncSession = () => {
    const now = peerFromHash();
    if (now === null || now === session) return;
    session = now;
    scanStop = true;
    dropList();
  };

  const kindOf = (tag) => (tag === "AUDIO" ? "a" : "v");

  const addItem = (url, meta, kind) => {
    if (!url || items.has(url)) return;
    const name = (meta && meta.name) || (kind === "p" ? `photo-${++imgSeq}` : "");
    items.set(url, {
      url,
      name,
      size: (meta && meta.size) || 0,
      kind,
      checked: true,
      statusEl: null,
    });
  };

  const collectAll = () => {
    document.querySelectorAll("video, audio").forEach((el) => {
      const url = mediaUrl(el);
      if (!url || url.startsWith("data:")) return;
      addItem(url, describeSource(url), kindOf(el.tagName));
    });
    // Photos are already-decrypted blobs; nothing to stream, just save the Blob.
    document.querySelectorAll(".bubble img, .media img, .message img").forEach((im) => {
      if (im.offsetWidth < 120 || im.offsetHeight < 120) return;
      if (isVideoThumb(im)) return;
      const url = im.currentSrc || im.src;
      if (!/^blob:/.test(url || "")) return;
      addItem(url, null, "p");
    });
  };

  const updateCount = () => {
    const picked = [...items.values()].filter((i) => i.checked).length;
    countEl.textContent = t("loaded", items.size);
    dlBtn.textContent = t("downloadSelected", picked);
    dlBtn.disabled = !picked;
  };

  const renderPanel = () => {
    if (!panel) return;
    renderedCount = items.size;
    listEl.textContent = "";
    if (!items.size) {
      const empty = document.createElement("div");
      empty.textContent = t("empty");
      styles(empty, { opacity: ".6", padding: "6px 0" });
      listEl.appendChild(empty);
    }
    items.forEach((item) => {
      const row = document.createElement("div");
      styles(row, {
        display: "flex",
        alignItems: "center",
        gap: "6px",
        padding: "3px 0",
        borderBottom: "1px solid rgba(255,255,255,.08)",
        cursor: "pointer",
      });

      // Native checkboxes are restyled into invisibility by the page CSS, so the
      // box is drawn by hand and the whole row toggles it.
      const cb = document.createElement("span");
      const paint = () => {
        cb.textContent = item.checked ? "✓" : "";
        styles(cb, {
          width: "14px",
          height: "14px",
          flex: "0 0 14px",
          lineHeight: "13px",
          textAlign: "center",
          fontSize: "11px",
          color: "#fff",
          borderRadius: "3px",
          border: item.checked ? "1px solid #5aa9e6" : "1px solid rgba(255,255,255,.4)",
          background: item.checked ? "#2f78ad" : "transparent",
          userSelect: "none",
        });
        row.style.background = item.checked ? "rgba(90,169,230,.12)" : "transparent";
      };
      const toggle = () => {
        item.checked = !item.checked;
        paint();
        updateCount();
      };
      paint();
      row.addEventListener("click", toggle);

      const kind = document.createElement("span");
      kind.textContent = t("kind" + item.kind.toUpperCase());
      styles(kind, { opacity: ".55", width: "12px" });

      const name = document.createElement("span");
      name.textContent = item.name || t("untitled");
      name.title = item.name || item.url;
      styles(name, { flex: "1", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" });

      const size = document.createElement("span");
      size.textContent = humanSize(item.size);
      styles(size, { opacity: ".55" });

      const status = document.createElement("span");
      status.textContent = "↓";
      status.title = t("rowDownload");
      item.statusEl = status;
      styles(status, { cursor: "pointer", padding: "0 2px" });
      status.addEventListener("click", (e) => {
        e.stopPropagation();
        enqueue(() => runDownload(item.url, status));
      });

      row.append(cb, kind, name, size, status);
      listEl.appendChild(row);
    });
    updateCount();
  };

  const applyLang = () => {
    document.querySelectorAll("[data-tms-title]").forEach((el) => {
      el.title = t(el.dataset.tmsTitle);
      el.setAttribute("aria-label", el.title);
    });
    document.querySelectorAll("[data-tms-text]").forEach((el) => {
      el.textContent = t(el.dataset.tmsText);
    });
    if (langBtn) {
      langBtn.textContent = lang === "en" ? "中" : "EN";
      langBtn.title = t("langSwitch");
      langBtn.setAttribute("aria-label", langBtn.title);
    }
    if (countEl) updateCount();
    if (scanBtn && scanning) scanBtn.textContent = scanStop ? t("stopping") : t("stop");
    if (panel && !panel.hidden) renderPanel();
  };

  const downloadChecked = () => {
    [...items.values()]
      .filter((i) => i.checked && i.statusEl)
      .forEach((i) => enqueue(() => runDownload(i.url, i.statusEl)));
  };

  // The message list is virtualized, so older media only exists after scrolling
  // it into view. Scan upward until the list stops loading history, then put the
  // scroll position back.
  const findScroller = () => {
    let el = document.querySelector("video, audio, .bubble, .message");
    while (el && el !== document.body) {
      const oy = getComputedStyle(el).overflowY;
      if (/(auto|scroll)/.test(oy) && el.scrollHeight > el.clientHeight + 80) return el;
      el = el.parentElement;
    }
    return null;
  };

  // An unplayed video exists only as a poster; its stream URL is created when
  // the player opens. Probing clicks the poster, waits for the new <video>,
  // closes the viewer and keeps the URL.
  const closeViewer = () => {
    const btn = document.querySelector(
      '#MediaViewer [aria-label="Close"], .MediaViewer [aria-label="Close"], [class*="MediaViewer"] [aria-label="Close"], .media-viewer-whole [aria-label="Close"]'
    );
    if (btn) {
      btn.click();
      return;
    }
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, bubbles: true }));
  };

  const previewTargets = () => {
    const blocks = new Set();
    document.querySelectorAll(".bubble, .message").forEach((el) => blocks.add(el.closest(".bubble") || el));
    return [...blocks].flatMap((block) => {
      if (block.dataset.tgsProbe || block.querySelector("video")) return [];
      const media = block.querySelector(".media-container, .media-inner, .media");
      const poster = media && media.querySelector("img[src^='blob:'], canvas");
      if (!poster) return [];
      const play = block.querySelector("canvas[aria-label], [class*='play'], [class*='Play']");
      const timed = media.querySelector("[class*='duration'], [class*='Duration'], [class*='time'], [class*='Time']");
      return play || timed ? [{ block, target: poster }] : [];
    });
  };

  // A bare .click() misses handlers bound to pointer events, so the whole press
  // sequence goes out. Both clients open the viewer from a plain click.
  const press = (el) => {
    const base = { bubbles: true, cancelable: true, view: window, button: 0 };
    const pointer = typeof PointerEvent === "function";
    const fire = (type) =>
      el.dispatchEvent(
        type.startsWith("pointer") && pointer
          ? new PointerEvent(type, { ...base, pointerId: 1, isPrimary: true, pointerType: "mouse" })
          : new MouseEvent(type, base)
      );
    ["pointerdown", "mousedown", "pointerup", "mouseup"].forEach(fire);
    el.dispatchEvent(new MouseEvent("click", base));
  };

  const waitForStream = async (before, timeout = 2500) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const v = [...document.querySelectorAll("video")].find((el) => {
        const u = el.currentSrc || el.src;
        return u && !before.has(u) && /\/(k\/stream|progressive)\//.test(u);
      });
      if (v) return v.currentSrc;
      await sleep(150);
    }
    return "";
  };

  const probeBlock = async ({ block, target }) => {
    const before = new Set([...document.querySelectorAll("video")].map((v) => v.currentSrc || v.src).filter(Boolean));
    press(target);
    const url = await waitForStream(before);
    closeViewer();
    await sleep(700);
    if (scanStop) return;
    block.dataset.tgsProbe = "1";
    if (url) addItem(url, describeSource(url), "v");
  };

  const probeVisible = async () => {
    for (const item of previewTargets()) {
      if (scanStop) return;
      await probeBlock(item);
    }
  };

  const scan = async () => {
    if (scanning) {
      scanStop = true;
      scanBtn.textContent = t("stopping");
      return;
    }
    const el = findScroller();
    if (!el) {
      info(t("noScroller"));
      return;
    }
    const saved = el.scrollTop;
    const scanSession = session;
    scanning = true;
    scanStop = false;
    scanBtn.disabled = false;
    scanBtn.textContent = t("stop");
    try {
      for (let i = 0; i < 400; i++) {
        if (scanStop) break;
        await probeVisible();
        if (scanStop) break;
        const heightBefore = el.scrollHeight;
        el.scrollTop = Math.max(0, el.scrollTop - el.clientHeight * 0.6);
        await sleep(450);
        if (scanStop) break;
        collectAll();
        if (items.size !== renderedCount) renderPanel();
        if (el.scrollTop === 0) {
          await sleep(700);
          if (scanStop) break;
          if (el.scrollHeight === heightBefore) break;
        }
      }
    } finally {
      scanning = false;
      if (session === scanSession) el.scrollTop = saved;
      scanBtn.disabled = false;
      scanBtn.textContent = t("scan");
      renderPanel();
    }
  };

  const batchButton = (label, title, handler) => {
    const b = makeButton(label, title);
    styles(b, {
      background: "rgba(80,140,190,.9)",
      color: "#fff",
      border: "none",
      borderRadius: "6px",
      padding: "3px 8px",
      fontSize: "12px",
      cursor: "pointer",
    });
    b.addEventListener("click", handler);
    return b;
  };

  const buildBatch = () => {
    toggleBtn = makeButton("☰", t("batchOpen"));
    tagTitle(toggleBtn, "batchOpen");
    styles(toggleBtn, {
      position: "fixed",
      left: "70px",
      bottom: "14px",
      zIndex: "2147483646",
      width: "46px",
      height: "46px",
      borderRadius: "50%",
      border: "none",
      color: "#fff",
      background: "rgba(80,140,190,0.95)",
      fontSize: "18px",
      boxShadow: "0 2px 8px rgba(0,0,0,.4)",
      cursor: "pointer",
    });

    panel = document.createElement("div");
    panel.hidden = true;
    styles(panel, {
      position: "fixed",
      left: "14px",
      bottom: "70px",
      zIndex: "2147483647",
      width: "380px",
      maxHeight: "52vh",
      overflowY: "auto",
      background: "rgba(24,24,24,.96)",
      color: "#eee",
      borderRadius: "10px",
      padding: "8px 10px",
      font: "12px/1.4 system-ui, sans-serif",
      boxShadow: "0 4px 16px rgba(0,0,0,.5)",
    });

    const head = document.createElement("div");
    styles(head, { display: "flex", alignItems: "center", gap: "6px", marginBottom: "6px", flexWrap: "wrap" });
    countEl = document.createElement("span");
    countEl.textContent = t("loaded", 0);
    styles(countEl, { flex: "1", opacity: ".8" });

    selAllBtn = batchButton(t("selectAll"), t("selectAll"), () => {
      items.forEach((i) => { i.checked = true; });
      renderPanel();
    });
    tagText(selAllBtn, "selectAll");
    tagTitle(selAllBtn, "selectAll");

    invBtn = batchButton(t("invert"), t("invert"), () => {
      items.forEach((i) => { i.checked = !i.checked; });
      renderPanel();
    });
    tagText(invBtn, "invert");
    tagTitle(invBtn, "invert");

    scanBtn = batchButton(t("scan"), t("scanTitle"), scan);
    tagText(scanBtn, "scan");
    tagTitle(scanBtn, "scanTitle");

    dlBtn = batchButton(t("downloadSelected", 0), t("downloadSelectedTitle"), downloadChecked);
    tagTitle(dlBtn, "downloadSelectedTitle");

    langBtn = batchButton(lang === "en" ? "中" : "EN", t("langSwitch"), () => {
      lang = lang === "en" ? "zh" : "en";
      try {
        localStorage.setItem(LANG_KEY, lang);
      } catch (_) {
        /* storage blocked: switch still applies for this page */
      }
      applyLang();
    });

    closeBtn = batchButton("×", t("close"), () => { panel.hidden = true; });
    tagTitle(closeBtn, "close");

    head.append(countEl, selAllBtn, invBtn, scanBtn, dlBtn, langBtn, closeBtn);

    listEl = document.createElement("div");
    panel.append(head, listEl);
    document.body.append(toggleBtn, panel);

    toggleBtn.addEventListener("click", () => {
      panel.hidden = !panel.hidden;
      if (!panel.hidden) renderPanel();
    });
  };

  // ---------- console helpers ----------
  try {
    page.tgSaver = {
      status: () => ({ last: state.last, verbose, dir: dirHandle && dirHandle.name, batch: items.size }),
      downloadLast: () => state.last && queueDownload(state.last.url, floatBtn),
      scan,
      debug: (v) => {
        verbose = !!v;
        info("verbose logging", verbose);
      },
    };
  } catch (_) {
    /* ignore */
  }

  // Test hook: no-op in browsers (module is undefined there).
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      describeStream,
      describeSource,
      toDownloadUrl,
      client: CLIENT,
      humanSize,
      extFromMime,
      withExt,
      download,
      __setDir: (d) => {
        dirHandle = d;
      },
    };
  }

  // ---------- boot ----------
  if (!CLIENT) {
    info(t("notTelegram"));
    return;
  }

  const tick = () => {
    syncSession();
    capture();
    collectAll();
    decorate();
    if (panel && items.size !== renderedCount) renderPanel();
  };

  const boot = () => {
    buildFloating();
    buildBatch();
    window.addEventListener("hashchange", syncSession);
    setInterval(tick, POLL_MS);
    info(t("ready"));
  };

  if (document.body) boot();
  else document.addEventListener("DOMContentLoaded", boot, { once: true });
})();
