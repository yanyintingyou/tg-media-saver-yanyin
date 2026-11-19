# TG Media Saver（Web K/A 分支）

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Chrome](https://img.shields.io/badge/Chrome-MV3-229ed9.svg)](https://developer.chrome.com/docs/extensions/mv3)

**English → [README.md](./README.md)**

从 Telegram Web K 和 Web A 保存视频、音频，频道开了"限制保存内容"也能下。
基于 [eiler2005/tg-media-saver](https://github.com/eiler2005/tg-media-saver)（MIT）修改，只保留 Chrome 扩展，按"一次下几个文件"的场景调整。

## 与原项目的差异

| 改动 | 原因 |
|---|---|
| 只保留扩展 | userscript 那条线重复了同一份逻辑，还要依赖 unsafeWindow |
| 同时支持 Web K 和 Web A | 两个客户端都用自己的 Service Worker 供字节。A 通过 `/a/download/` 端点保存，官方"另存为"走的就是它 |
| 目录授权一次 | 第一次保存选目录，后续文件直接写进去，不再逐次弹窗 |
| 串行队列 | 连点多个按钮按顺序下载，每个按钮独立显示进度 |
| 批量面板（☰） | 页面渲染过的媒体都进一个可勾选列表：全选、反选、单独下载一行。下载仍走同一条队列 |
| 扫描历史 | 自动向上滚动会话直到不再加载，把没渲染过的媒体也收进来，结束后恢复滚动位置；再点一次可中止 |
| 全屏查看器里有保存按钮 | 全屏播放是最常用的动作，按钮放在左上角 |
| 重名自动加 ` (1)`、` (2)` | Telegram 里同名文件很常见 |
| 界面默认英文，带中/EN 切换 | 面板和按钮文案双语，选择记在 `localStorage` |
| 去掉 popup | 里面只是重复 README 的说明，少一个需要审计的文件 |

## 安装

1. 打开 `chrome://extensions`，右上角开启开发者模式
2. 点"加载已解压的扩展程序"，选择仓库里的 `extension` 文件夹
3. 打开 `https://web.telegram.org/k/` 或 `https://web.telegram.org/a/`，按 Ctrl+Shift+R 硬刷新

Chrome 重启后可能提示停用开发者模式扩展，选择保留。

## 使用

1. 进会话，滚到目标消息，点开视频播放
2. 点媒体右上角的 ⬇；全屏查看器里点左上角的 ⬇
3. 第一次点击选一个保存目录，之后文件按 Telegram 原始名写入该目录；Web A 的流地址里没有文件名，那边存下来是 `document<id>.mp4`
4. 按钮显示百分比，完成变 ✓，红色 ✗ 表示失败，再点一次重试
界面首次是英文，面板里的「中 / EN」按钮可切换，选择会被记住。

5. 点 ☰ 打开批量列表：勾选后按「下载选中」，逐行显示状态；点「扫描」自动向上翻会话，把历史里的媒体也收进来

左下角浮动按钮保存最近加载的那个媒体。

## 限制

- 只在 Web K 和 Web A 生效，`/z/` 会跳到 `/a/`；桌面端和手机端不在范围内
- 图片在两边都存成 `photo-N.jpg`，blob 地址里没有文件名
- Web A 的流地址不带文件名，存下来是 `document<id>.mp4`
- 批量列表存在内存里，刷新页面清空
- 扫描最多 400 步，到会话不再加载历史、再点一次「扫描」、或切换会话时停止；会话很长时耗时几分钟，流量也大
- 切换会话会清空列表，每个会话从空开始
- 目录授权存在内存里，浏览器重启后要重新选一次
- 视频封面会被跳过：视频消息里的图片是预览图，不算图片文件
- 不处理文档类消息（zip、pdf、epub）
- 单文件上限 2GB，Telegram 的传输上限
- 下载依赖 Telegram 的 Service Worker。视频本身播不了的时候，任何工具都存不下来：刷新页面，或在开发者工具里注销 Service Worker 后重载

## 常见问题

| 现象 | 处理 |
|---|---|
| 没有 ⬇ 按钮 | 确认地址是 `web.telegram.org/k/` 或 `web.telegram.org/a/`，然后硬刷新 |
| 点击没反应 | 打开控制台，找 `[TG Media Saver]` 开头的报错 |
| ✗ 并提示 Service Worker | 硬刷新。持续出现时进开发者工具 → Application → Service Workers → Unregister，再刷新 |
| 一直停在 0% | 流断了，刷新后重新播放再试 |
| 文件名是 `document_123...mp4` | 流里没带原始文件名，Web A 一律如此，走了兜底命名 |

## 开发

```bash
bash scripts/build.sh   # 把 src/content.js 复制到 extension/
npm test                # 单元测试 + 下载引擎 + 构建检查
```

只改 `src/content.js`，`extension/content.js` 是生成文件。

## 使用边界

工具下载的是你账号本来就能看的内容，请只保存你有权保留的材料。与 Telegram 官方无关。

原作者：MIT © 2026 Denis Ermilov。分支改动同样以 MIT 发布。
