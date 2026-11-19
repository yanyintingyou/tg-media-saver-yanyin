# TG Media Saver

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Chrome](https://img.shields.io/badge/Chrome-MV3-229ed9.svg)](https://developer.chrome.com/docs/extensions/mv3)

**English → [README.md](./README.md)**

在 Telegram 网页版保存视频、音频和图片，包括开了「限制保存内容」的频道。浏览器扩展，装一次，之后在页面上点按钮就能存。

## 功能

| 功能 | 效果 |
|---|---|
| 单条保存 | 媒体右上角一个 ⬇，全屏查看器左上角一个，点一下开始存 |
| 目录授权一次 | 第一次保存选目录，之后所有文件直接写进去，不再逐个弹窗 |
| 批量面板（☰） | 页面加载过的媒体自动进列表，勾选后一次下载，逐行显示进度 |
| 扫描历史 | 自动向上翻会话，逐个打开没播放过的视频封面，把这些视频也收进列表 |
| 原始文件名 | Web K 从流地址里读出 Telegram 的文件名；重名自动加 ` (1)`、` (2)` |
| 串行队列 | 多个文件排队下载，一个完成再下一个，不会同时向 Telegram 发一堆请求 |
| 边下边写 | 有 File System Access 时字节直接写入磁盘，几百 MB 的视频不占内存 |
| 双语界面 | 默认英文，面板里「中 / EN」切换，选择记在 `localStorage` |

## 用起来是什么样

进会话，滚到目标消息，点开视频让它播放。媒体右上角出现 ⬇，点一下，第一次会弹出目录选择。

选好之后文件就开始写入那个目录，按钮上跑百分比，跑完变 ✓。比如一个 207 MB 的视频，列表里显示 `Pmv-112 (阿里宝贝) .mp4 · 207 MB`，存下来就是这个名字、这个大小，目录里直接能播。

要继续存别的，滚到下一条，点它自己的 ⬇。文件全部落进同一个目录，中间不再问。

想一次存多个，点 ☰ 打开面板：左边勾选框，右边每行一个 ↓ 单独下载。顶部 All、Invert 全选反选，Download selected (N) 按顺序把勾中的都存掉，每行状态独立。没播放过的视频这时还不在列表里，点 Scan 让扩展自己翻上去、逐个点开封面收集。

## 两个客户端的差别

| | Web K（`/k/`） | Web A（`/a/`） |
|---|---|---|
| 媒体地址 | `/k/stream/<描述符>`，里面带文件名和大小 | `/a/progressive/document<id>`，只有 id |
| 进列表的时机 | 播放过，或被 Scan 打开过 | 滚动到可见就挂上 `<video>`，自动进列表 |
| 保存的文件名 | Telegram 原始文件名 | `document<id>.mp4` |
| 图片 | 支持，存成 `photo-N.jpg` | 支持，存成 `photo-N.jpg` |
| 批量收集 | 需要点 Scan | 滚一遍就够，Scan 可选 |

消息完全同步，两个客户端可以各开一个标签页：A 用来看和聊，K 用来存需要原始文件名的内容。

## 安装

1. 打开 `chrome://extensions`，右上角开启开发者模式
2. 点「加载已解压的扩展程序」，选择仓库里的 `extension` 文件夹
3. 打开 `https://web.telegram.org/k/` 或 `https://web.telegram.org/a/`，按 Ctrl+Shift+R 硬刷新

Chrome 重启后可能提示停用开发者模式扩展，选择保留。

## 使用

**单个文件**

1. 进会话，滚到目标消息，点开视频播放
2. 点媒体上的 ⬇，或全屏查看器左上角的 ⬇
3. 第一次选保存目录，之后不再问
4. 按钮显示百分比，完成变 ✓；红色 ✗ 表示失败，再点一次重试

**多个文件**

1. 点左下角 ☰ 打开批量面板
2. 勾选要下的条目，或点 All 全选
3. 点 Download selected，文件按顺序写入目录，每行独立显示状态
4. 没播放过的视频点 Scan，扩展会向上滚动并逐个打开封面收集

左下角单独的 ⬇ 保存最近加载的那个媒体，不需要开面板。

## 限制

- 只支持 Web K 和 Web A，`/z/` 会跳到 `/a/`；桌面端和手机端不在范围内
- 文档类消息（zip、pdf、epub）和贴纸不处理
- Web A 的流地址不带文件名，存下来是 `document<id>.mp4`
- 图片在两边都存成 `photo-N.jpg`，blob 地址里没有文件名
- 批量列表存在内存里，刷新页面清空；切换会话也清空
- 目录授权存在内存里，浏览器重启后要重新选一次
- 扫描最多 400 步，到会话不再加载历史、再点一次 Scan、或切换会话时停止。会话很长时耗时几分钟，流量也大
- 视频封面不会被当成图片保存：视频消息里的图片是预览图，Scan 打开它收的是视频本身
- 单文件上限 2GB，Telegram 的传输上限
- 下载依赖 Telegram 的 Service Worker。视频播不了的时候，任何工具都存不下来：刷新页面，或在开发者工具里注销 Service Worker 后重载

## 常见问题

| 现象 | 处理 |
|---|---|
| 没有 ⬇ 按钮 | 确认地址是 `web.telegram.org/k/` 或 `web.telegram.org/a/`，然后硬刷新 |
| 点击没反应 | 打开控制台，找 `[TG Media Saver]` 开头的报错 |
| ✗ 并提示 Service Worker | 硬刷新。持续出现时进开发者工具 → Application → Service Workers → Unregister，再刷新 |
| 一直停在 0% | 流断了，刷新后重新播放再试 |
| 文件名是 `document_123...mp4` | 流里没带原始文件名，Web A 一律如此，走了兜底命名 |
| Scan 之后列表没变多 | K 上没播放过的视频要先被点开封面；确认扫描时查看器有自动开关的动作 |

## 开发

```bash
bash scripts/build.sh   # 把 src/content.js 复制到 extension/
npm test                # 单元测试 + 下载引擎 + 构建检查
```

只改 `src/content.js`，`extension/content.js` 是生成文件。

## 使用边界

工具下载的是你账号本来就能看的内容，请只保存你有权保留的材料。与 Telegram 官方无关。

改自 [eiler2005/tg-media-saver](https://github.com/eiler2005/tg-media-saver)（MIT），只保留扩展这条路径，并加上 Web A 支持、目录授权、批量面板和扫描。原作者：MIT © 2026 Denis Ermilov。分支改动同样以 MIT 发布。
