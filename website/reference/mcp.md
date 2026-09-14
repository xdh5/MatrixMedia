---
title: MCP Server
description: 矩媒 MatrixMedia MCP Server：通过 Model Context Protocol 让 Claude Desktop、Cursor 等 AI 工具直接操作登录与发布。
---

# MCP Server 说明

仓库内置 `mcp/` 子包，实现了 [Model Context Protocol](https://modelcontextprotocol.io) Server，让支持 MCP 的 AI 工具**无需 shell 调用**即可直接操作 MatrixMedia。

MCP **不直接请求 HTTP**，而是通过 stdio transport 接收 tool 调用，内部 `spawn` CLI 子进程完成实际操作。

## 构建

```bash
cd mcp && npm install && npm run build
```

构建产物：`mcp/dist/index.js`

## 配置 AI 工具

将 `MATRIXMEDIA_DIR` 设为本仓库根目录的绝对路径。

**Claude Desktop**（`~/Library/Application Support/Claude/claude_desktop_config.json`）：

```json
{
  "mcpServers": {
    "matrixmedia": {
      "command": "node",
      "args": ["<MATRIXMEDIA_DIR>/mcp/dist/index.js"],
      "env": {
        "MATRIXMEDIA_DIR": "<MATRIXMEDIA_DIR>"
      }
    }
  }
}
```

**Cursor / Cline**（`.cursor/mcp.json` 或全局 MCP 配置，格式相同）：

```json
{
  "mcpServers": {
    "matrixmedia": {
      "command": "node",
      "args": ["<MATRIXMEDIA_DIR>/mcp/dist/index.js"],
      "env": {
        "MATRIXMEDIA_DIR": "<MATRIXMEDIA_DIR>"
      }
    }
  }
}
```

重启 AI 工具后即可在对话中调用下方 tool。

## Tool 一览

| Tool              | 底层 CLI                  | 说明                                           |
| ----------------- | ------------------------- | ---------------------------------------------- |
| `list_accounts`   | `cli accounts --json`     | 列出本机已登录账号，支持按平台过滤             |
| `list_history`    | `cli history --json`      | 查询本机发布记录，支持按平台/状态/天数过滤     |
| `login`           | `cli login --save-qr-png` | 截取抖音/视频号登录二维码，返回图片给 Agent    |
| `login_status`    | 查询进行中的 `cli login`  | 等待用户扫码，直到登录成功                     |
| `publish_video`   | `cli publish ...`         | 发布视频（最长约 35 分钟，支持草稿和定时发布） |
| `publish_article` | `cli publish-article ...` | 发布掘金文章（需已登录掘金账号）               |

### list_accounts

| 参数       | 必填 | 说明                                                                              |
| ---------- | ---- | --------------------------------------------------------------------------------- |
| `platform` | 否   | 平台过滤：`dy` / `ks` / `blbl` / `bjh` / `tt` / `sph` / `xhs` / `juejin` / `fqsp` |

### list_history

| 参数       | 必填 | 说明                                              |
| ---------- | ---- | ------------------------------------------------- |
| `days`     | 否   | 最近 N 天，默认 7                                 |
| `platform` | 否   | 平台过滤                                          |
| `status`   | 否   | `success` / `failed` / `publishing` / `scheduled` |
| `all`      | 否   | 为 `true` 时返回全部历史                          |

### login

| 参数         | 必填 | 说明                                      |
| ------------ | ---- | ----------------------------------------- |
| `platform`   | 是   | `dy` / `sph` / `ks`                       |
| `phone`      | 是   | 与 `list_accounts` / `publish_video` 一致 |
| `timeoutSec` | 否   | 等待扫码秒数，默认 900                    |

返回二维码图片 + JSON（`status=waiting_scan` 时带 `login_id`）。Agent 必须把图片发给用户扫码。

### login_status

| 参数       | 必填 | 说明                    |
| ---------- | ---- | ----------------------- |
| `login_id` | 是   | `login` 返回的 `login_id` |

`waiting_scan` 时可能附带最新二维码；`success` 后即可发布。

### publish_video

| 参数           | 必填 | 说明                                                          |
| -------------- | ---- | ------------------------------------------------------------- |
| `platform`     | 是   | `dy` / `ks` / `blbl` / `bjh` / `tt` / `sph`                   |
| `file`         | 是   | 视频文件绝对路径                                              |
| `title`        | 是   | 视频标题                                                      |
| `phone`        | 是   | 账号手机号，用于推导 session partition                        |
| `bt2`          | 否   | 第二标题 / 视频号短标                                         |
| `tags`         | 否   | 标签字符串                                                    |
| `address`      | 否   | 地址（百家号等）                                              |
| `publishAt`    | 否   | 定时发布，`YYYY-MM-DD HH:mm`                                  |
| `show`         | 否   | 是否显示底层浏览器窗口                                        |
| `draft`             | 否   | `true` 时保存到草稿箱，不直接发布                             |
| `creativeStatement` | 否   | 创作声明 / 视频号视频标注                                     |
| `sphProductId`      | 否   | 视频号商品上架编号（推荐）                                    |
| `sphLink`           | 否   | 视频号链接对象；与 `sphProductId` 同时传时优先 `sphProductId` |

视频号商品上架草稿调用参数示例：

```json
{
  "platform": "sph",
  "file": "D:\\videos\\a.mp4",
  "title": "视频标题",
  "phone": "13800138000",
  "bt2": "视频号短标题",
  "draft": true,
  "sphProductId": "10000591263144",
  "creativeStatement": "含AI生成内容"
}
```

当 `platform` 不是 `sph` 时，`sphProductId` / `sphLink` 会被忽略。若商品添加失败但视频已成功转存草稿，Tool 返回 `status: needs_attention`，不会误报为发布成功。

### publish_article

| 参数        | 必填   | 说明                   |
| ----------- | ------ | ---------------------- |
| `platform`  | 是     | 目前仅支持 `juejin`    |
| `phone`     | 是     | 已登录掘金账号手机号   |
| `title`     | 是     | 文章标题               |
| `content`   | 二选一 | 正文内容               |
| `file`      | 二选一 | Markdown 文件路径      |
| `cover`     | 否     | 封面图片路径           |
| `category`  | 否     | 分类                   |
| `tags`      | 否     | 标签                   |
| `summary`   | 否     | 摘要                   |
| `publishAt` | 否     | 定时发布时间           |
| `show`      | 否     | 是否显示底层浏览器窗口 |

## 登录说明

- 发布前用 `list_accounts` 看登录态。
- **抖音 / 视频号 / 快手未登录**：调用 `login(platform, phone)`。工具会打开登录页、截取二维码，并以图片返回。Agent 必须把这张图发给用户扫码，然后反复调用 `login_status(login_id)`，直到 `status=success`，再 `publish_video`。
- **其它平台未登录**：请用户在矩媒 GUI 扫码登录；MCP 无法弹窗。
- `login` 与 GUI / `publish_video` 共用同一 session partition。

## 相关文档

- [CLI 说明](/reference/cli)
- [HTTP API 说明](/reference/http-api)
