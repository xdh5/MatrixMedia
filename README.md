<h1 align="center">矩媒 media-publisher</h1>

> **自媒体 · 矩阵 · 批量** — 多平台视频发布命令行工具（Electron + CLI）

## 工具使用文档

- 国内文档：[Gitee Wiki](https://gitee.com/gzlingyi_0/pubtw/wikis/pages?sort_id=14772656&doc_id=7335804)

## 关键词（便于搜索）

自媒体、自媒体矩阵、矩阵发布、矩阵运营、内容矩阵、视频矩阵、多平台矩阵、跨平台发布、批量发布、批量上传、批量分发、一键发布、多账号发布、多平台发布、本地视频发布、短视频矩阵、内容分发、账号矩阵、自动化发布、CLI 批量、命令行发布、无头发布、智能体编排、OpenClaw、MCP 发布、抖音矩阵、快手矩阵、小红书矩阵、百家号矩阵、哔哩哔哩矩阵、头条矩阵、视频号矩阵、media-publisher、矩媒、pubtw

## <strong>📺 [教程视频](https://www.bilibili.com/video/BV1fiX5BzEb7)</strong>

自媒体矩阵发布工具，通过命令行完成登录和发布：

- **支持平台**：Windows、macOS、CLI。
- **CLI 登录**：目前支持**抖音**与**视频号**（终端二维码；抖音另支持 puppeteer 无头）。
- **CLI 发布**：**7 个平台**已完整自动化——抖音、快手、百家号、哔哩哔哩、头条、视频号、小红书。`file` 支持本地路径或 `http(s)` 远程 URL（自动下载，上传后清理临时文件）。
- **CLI 查询**：`cli accounts` 实时检测登录态。

便于脚本与智能体编排。

<!-- openclaw-integrable: id=media-publisher-cli version=1 platform=electron argv-marker=cli -->
<!-- 说明：本仓库以 argv 含 `cli` 作为统一入口，可被 OpenClaw / Hermes / Claude Code / Cursor / Dify / n8n 等 AI 工具与智能体编排框架发现与调用；子命令 `login`（抖音 / 视频号）、`publish` 等详见 [docs/cli.md](./docs/cli.md)。 -->

## AI 工具 / 智能体联动

本项目的 CLI 被刻意设计为 **AI 工具无关 / 框架无关** 的外部命令：只要你的工具能调用 shell、读取退出码或 JSON stdout，就能直接对接 —— 包括但不限于：

- [OpenClaw](https://github.com/openclaw/openclaw)
- [Hermes](https://github.com/NousResearch/hermes-agent)
- Claude Code、Cursor、Cline、Aider 等编程智能体
- Dify、n8n、LangChain、CrewAI、AutoGen 等工作流 / 多智能体编排框架
- 任何支持「外部命令 + argv + 退出码」约定的自动化平台（含自研调度器）

统一约定：

| 约定项        | 内容                                                                                                   |
| ------------- | ------------------------------------------------------------------------------------------------------ |
| 进入 CLI 模式 | argv 含子串 `cli`（如 `media-publisher cli publish ...`）                                                      |
| 子命令        | `cli login \| publish \| accounts`，每个均支持 `--help`                                                |
| 退出码        | `0` 成功 / `1` 异常 / `2` 参数错误 / `3` 业务失败（登录、上传等）                                      |
| 机器可读输出  | `cli accounts --json` 产出稳定 JSON，便于上游消费                                                      |
| 登录态        | Cookie 保存在 media-publisher 目录的 `data` 中                                                              |

详细文档：[CLI](./docs/cli.md) · [MCP](./docs/mcp.md)

仓库顶部的 `<!-- openclaw-integrable ... -->` HTML 注释以 OpenClaw 的 schema 示例上述约定；其它平台如需类似的仓库级可发现标记，可沿用同一 `argv-marker=cli` 语义，或加上自家的注释标签（例如 `<!-- hermes-integrable ... -->`），互不冲突。

典型用法：在 AI 平台/智能体侧将本应用配置为 **外部命令**（`command` + `args`）：`cli login` 用于扫码登录；`cli publish` 发布已支持的平台。终端二维码与无头模式等行为见 [docs/cli.md](./docs/cli.md) 与各子命令 `--help`。

### MCP Server（Claude Desktop / Cursor / Cline 原生接入）

仓库内置 `mcp/` 子包，实现了 [Model Context Protocol](https://modelcontextprotocol.io) Server，让支持 MCP 的 AI 工具**无需 shell 调用**即可直接操作 media-publisher。

**第一步：构建 MCP Server**

```bash
cd mcp && npm install && npm run build
```

**第二步：配置 AI 工具**

以下配置适用于 Claude Desktop、Cursor、Cline 等支持 MCP stdio transport 的工具。
将 `MEDIA_PUBLISHER_DIR` 设为本仓库根目录的绝对路径。

_Claude Desktop_（`~/Library/Application Support/Claude/claude_desktop_config.json`）：

```json
{
  "mcpServers": {
    "media-publisher": {
      "command": "node",
      "args": ["<MEDIA_PUBLISHER_DIR>/mcp/dist/index.js"],
      "env": {
        "MEDIA_PUBLISHER_DIR": "<MEDIA_PUBLISHER_DIR>"
      }
    }
  }
}
```

_Cursor / Cline_（`.cursor/mcp.json` 或全局 MCP 配置，格式相同）：

```json
{
  "mcpServers": {
    "media-publisher": {
      "command": "node",
      "args": ["<MEDIA_PUBLISHER_DIR>/mcp/dist/index.js"],
      "env": {
        "MEDIA_PUBLISHER_DIR": "<MEDIA_PUBLISHER_DIR>"
      }
    }
  }
}
```

重启 AI 工具后，以下 4 个 tool 即可在对话中直接调用（完整说明见 [docs/mcp.md](./docs/mcp.md)）：

| Tool              | 说明                                             |
| ----------------- | ------------------------------------------------ |
| `list_accounts`   | 列出本机已登录账号，支持按平台过滤               |
| `login`           | 截取抖音、快手、头条或视频号登录二维码           |
| `login_status`    | 等待扫码完成                                     |
| `publish_video`   | 发布视频到指定平台（最长 35 分钟，支持定时发布） |

> **登录说明**：抖音、快手、头条和视频号用 `cli login` 扫码。Cookie 保存在 media-publisher 目录的 `data` 中，MCP 发布会复用这些登录态。

## 目前可以一键发布视频的平台有

1. 抖音
2. 快手
3. 百家号
4. 哔哩哔哩
5. 头条号
6. 视频号
7. 小红书

小红书平台对 Electron 内置窗口的自动化检测日趋严格，可能出现「AI 托管」警告。为此新增**真实浏览器发布模式**，使用本机已安装的 Google Chrome / Chromium 代替内置窗口进行发布，从根源上规避检测。

**启用方法**：

1. 进入账号管理 → 小红书账号 → 「发布设置」卡片
2. 打开「使用真实浏览器」开关
3. 首次开启会**自动检测**本机 Chrome 路径；也可手动点击「选择 Chrome 浏览器」选取应用（macOS 直接选 `.app`，Windows 选 `.exe`）
4. 点击「测试连接」确认 Chrome 可用
5. 保存设置

**工作原理**：

- 使用项目已有的 `puppeteer-core`（轻量库，不捆绑 Chromium）直接驱动本机 Chrome
- 发布时自动从内置窗口同步登录态（Cookie）到真实 Chrome
- Chrome 路径为全局配置（所有小红书账号共用），保存在 `userData/chrome-config.json`
- 若检测不到 Chrome 或启动失败，自动回退到内置窗口模式

## 命令行（CLI）

从项目根启动时，在参数中加入 **`cli`**。完整参数说明见 **[docs/cli.md](./docs/cli.md)**。子命令一览：

| 子命令                | 支持平台                                                                      | 作用                                                           |
| --------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `cli login`           | **抖音、快手、头条、视频号**                                              | 终端二维码扫码登录                                             |
| `cli publish`         | **7 个已自动化平台**（`dy \| tt \| ks \| blbl \| bjh \| sph \| xhs`）     | 发布视频（本地路径或 http(s) URL）                             |
| `cli accounts`        | 已配置平台                                                                | 列出所有账号并实时检测 cookie 登录态                           |

> **登录**：使用 `cli login`。当前支持抖音、快手、头条和视频号。登录态写在 media-publisher 目录的 `data` 里，过期后重新扫码即可。

常用示例：

```bash
# 抖音登录
media-publisher cli login -p dy --phone 13800138000

# 发布视频
media-publisher cli publish -p dy --phone 13800138000 -f /path/to/video.mp4 -t "标题"

# 查看账号（JSON）
media-publisher cli accounts --json
```

开发环境调用示例：

```bash
ELECTRON_RUN_AS_NODE= electron . cli login --help
ELECTRON_RUN_AS_NODE= electron . cli publish --help
ELECTRON_RUN_AS_NODE= electron . cli accounts --help
```

### 其它提示

- 中英文可执行文件名已统一为 `media-publisher`，无需区分。
- 若环境变量 `ELECTRON_RUN_AS_NODE` 被误开启，请先按提示关闭后再启动。
- `cli accounts` 仅读取本机数据，不会触发任何登录或发布动作，适合在 pipeline 里做 preflight 检查。

## Contributors

- **核心维护**：[@hanliang97](https://github.com/hanliang97)
- **集成协作**：[OpenClaw](https://github.com/openclaw/openclaw)、[Hermes](https://github.com/NousResearch/hermes-agent) 等智能体 / 编排生态 — 本仓库顶部以 `openclaw-integrable` 注释示例地显式声明 CLI 入口；`cli login` / `cli publish` / `cli accounts` 的参数与退出码约定面向所有「外部命令型」AI 工具设计，任何遵循同样契约的平台（含自研调度器）都可直接接入，欢迎围绕 CLI 契约反馈与共建。
- **AI 协作声明**：部分 CLI 子命令（`cli accounts`）、skills 文档（`.cursor/skills/media-publisher-cli/`）以及 README 的 CLI 章节由 Anthropic Claude（通过 [Claude Code](https://claude.com/claude-code)）、DeepSeek、OpenAI Codex、GPT 等 AI 工具辅助设计、实现与撰写；人类维护者负责需求决策、代码评审与合入。所有产出遵循本仓库的 [GPL-2.0-only](./LICENSE) 授权条款，不因 AI 参与而改变许可。

欢迎通过 Issue / PR 参与共建。

## 使用声明

1. 本项目仅用于合法合规的学习与效率提升场景，请严格遵守各平台服务协议与当地法律法规。
2. 请勿将本项目用于批量作弊、恶意营销、侵权搬运、刷量等违规用途，由此产生的风险与责任由使用者自行承担。
3. 涉及账号、Cookie、本地素材等敏感数据时，请妥善保管并自行评估安全风险。
4. 部分平台（如哔哩哔哩）可能需要人工参与（例如手动上传封面），请以平台当前页面规则为准。

## 开发环境 node 20

安装依赖后，用下面的命令编译命令行主进程：

yarn
yarn build:dir

运行示例：

electron . cli accounts --help

## Star History

<a href="https://www.star-history.com/?repos=hanliang97%2FMatrixMedia&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=hanliang97/MatrixMedia&type=date&theme=dark&legend=top-left&sealed_token=e4cVgVwtHcXivuAHq9wCjXaykvJCKDP73Jp_s71S9xmzZxi2iD9fdkwdL6977hG7j9rRqLDQH25TwiZhydVJrXHmm-et_8ul06SVXS2vZoQoUYJcKcrRiw" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=hanliang97/MatrixMedia&type=date&legend=top-left&sealed_token=e4cVgVwtHcXivuAHq9wCjXaykvJCKDP73Jp_s71S9xmzZxi2iD9fdkwdL6977hG7j9rRqLDQH25TwiZhydVJrXHmm-et_8ul06SVXS2vZoQoUYJcKcrRiw" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=hanliang97/MatrixMedia&type=date&legend=top-left&sealed_token=e4cVgVwtHcXivuAHq9wCjXaykvJCKDP73Jp_s71S9xmzZxi2iD9fdkwdL6977hG7j9rRqLDQH25TwiZhydVJrXHmm-et_8ul06SVXS2vZoQoUYJcKcrRiw" />
 </picture>
</a>
