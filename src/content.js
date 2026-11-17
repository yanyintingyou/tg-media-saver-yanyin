/*
 * TG Media Saver — fork for Telegram Web K (/k/), directory-once saving.
 * Based on TG Media Saver by Denis Ermilov (MIT).
 *
 * How it works:
 *  - Telegram /k/ streams media through its own Service Worker at
 *    /k/stream/<urlencoded JSON descriptor>. The descriptor carries the real file
 *    name, size, mime type and DC id. Bytes are only served when the fetch runs in
 *    the PAGE context, so every request goes through `window.fetch`.
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
  const IS_K =
    typeof location !== "undefined" &&
    (location.hostname === "webk.telegram.org" || location.pathname.startsWith("/k/"));

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
  // Returns the saved file name. Uses the granted directory when available,
  // otherwise falls back to an in-memory Blob.
  const download = async (url, onProgress) => {
    const meta = describeStream(url);
    const base = (meta && meta.name) || `tg-media-${Date.now()}`;

    if (/^(blob:|data:)/.test(url)) {
      const blob = await (await page.fetch(url)).blob();
      const finalName = withExt(base, blob.type);
      await writeOut(blob, finalName);
      if (onProgress) onProgress(1);
      return finalName;
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

  const capture = () => {
    document.querySelectorAll("video, audio").forEach((el) => {
      const url = mediaUrl(el);
      if (!url || url.startsWith("data:")) return;
      if (el.getAttribute("data-tgs-src") !== url) {
        el.setAttribute("data-tgs-src", url);
        state.last = { url, kind: el.tagName === "AUDIO" ? "audio" : "video", meta: describeStream(url) };
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
    if (/^HTTP \d+/.test(msg)) return `服务器返回 ${msg.slice(5)}`;
    if (err instanceof TypeError) return "网络中断或 Telegram 的 Service Worker 没在供数据：硬刷新后重试";
    return msg;
  };

  const runDownload = async (url, btn) => {
    if (!url || btn.dataset.busy === "1") return;
    btn.dataset.busy = "1";
    setBtnState(btn, "0%", BTN_BUSY);
    try {
      const name = await download(url, (p) => setBtnState(btn, `${Math.round(p * 100)}%`, BTN_BUSY));
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
      btn.title = `失败：${hint(err)}（点击重试）`;
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
    floatBtn = makeButton("⬇", "保存最近加载的媒体");
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
        info("尚未捕获媒体：先播放一个视频/音频");
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

  const attachInline = (host, onClick, title, fixed) => {
    if (!fixed && getComputedStyle(host).position === "static") host.style.position = "relative";
    const b = makeButton("⬇", title);
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
          else info("媒体还没加载：先播放再点");
        },
        "保存这个媒体"
      );
    });

    document.querySelectorAll(".bubble img, .media img, .message img").forEach((im) => {
      if (im.offsetWidth < 120 || im.offsetHeight < 120) return;
      const host = im.closest(".media, .bubble, .message") || im.parentElement;
      if (!host || host.querySelector("." + INLINE)) return;
      attachInline(
        host,
        () => {
          const url = im.currentSrc || im.src;
          if (url) queueDownload(url, host.querySelector("." + INLINE));
        },
        "保存这张图片"
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
          else info("媒体还没加载：先播放再点");
        },
        "保存这个媒体",
        true
      );
    }
  };

  // ---------- console helpers ----------
  try {
    page.tgSaver = {
      status: () => ({ last: state.last, verbose, dir: dirHandle && dirHandle.name }),
      downloadLast: () => state.last && queueDownload(state.last.url, floatBtn),
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
  if (!IS_K) {
    info("当前不是 Telegram Web K：请打开 https://web.telegram.org/k/ 后使用");
    return;
  }

  const tick = () => {
    capture();
    decorate();
  };

  const boot = () => {
    buildFloating();
    setInterval(tick, POLL_MS);
    info("ready — 播放视频后点 ⬇");
  };

  if (document.body) boot();
  else document.addEventListener("DOMContentLoaded", boot, { once: true });
})();
