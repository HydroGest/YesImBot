<div align="center">
  <img src="assets/logo.png" width="60%" alt="Athena Logo" />

[![npm](https://img.shields.io/npm/v/koishi-plugin-yesimbot?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-yesimbot)
[![License](https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square)](LICENSE)
![Language](https://img.shields.io/badge/language-TypeScript-brightgreen?style=flat-square)
![Status](https://img.shields.io/badge/status-beta-yellow?style=flat-square)
[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/YesWeAreBot/YesImBot)

**机器壳，人类心。**
<br/>
_让 AI 更像人类，让聊天更有温度_
<br/>
[Features](#features) • [Architecture](#architecture) • [Quick Start](#quick-start) • [Plugins](#plugins) • [Community](#community)

</div>

---

**YesImBot** 是一套基于 Koishi 的群聊 AI 插件与运行时，让大语言模型以自然的方式融入你的群聊。

## Features

- **消息优先的运行时** — `@yesimbot/agent-runtime` 将"观察"与"发言"分离：普通消息进入频道历史，Will 决定等待或触发模型回合；忙时事件加入当前 turn，不创建第二个流消费者。
- **多模型即插即用** — 通过 provider 插件接入 OpenAI、Anthropic、DeepSeek、Google 等模型，并通过 `models.json` 管理模型注册与默认值。
- **强大的插件体系** — 工具、提示词、消息转换、生命周期钩子，每个维度都可扩展。插件按 `pre` / normal / `post` 顺序编排，互不干扰。
- **上下文持久化** — Core 以稳定的 26 字符 `channelIdentity` 识别频道，并将 Manifest、JSONL、assets、workspace 和插件 namespace 放在可读的 `<basePath>/channels/v1-shared-*/` 或 `v1-direct-*/` 目录。`channel.json` 是唯一权威来源，启动时扫描 Manifest，不创建 `channels.json`。
- **平台输入边界** — 平台插件注册 `SessionResolver`，Gateway 在 Session 生命周期内完成解析、图片冻结和被动回复。普通消息以 `yesimbot.message` 持久化唯一结构化 `elements`、冻结的 `text` 和 `messageId`；非消息输入以 `yesimbot.event` 及 `eventType`、冻结的 `text` 持久化。
- **丰富的能力插件** — 虚拟文件系统与 Bash 沙箱、MCP 客户端、Skill 加载、Web 搜索、MemOS Cloud 记忆、OneBot 工具、贴纸处理等。
- **Koishi 原生集成** — 作为 `koishi-plugin-yesimbot` 运行，复用 Koishi 生态的适配器、中间件和插件体系。

## Quick Start

YesImBot 作为 Koishi 插件运行，安装方式与普通 Koishi 插件一致：

```bash
# 使用 yarn（推荐）
yarn add koishi-plugin-yesimbot

# 或使用 npm
npm install koishi-plugin-yesimbot
```

然后在 Koishi 配置文件中启用插件，配置你偏好的模型 provider 即可开始使用。

> [!TIP]
> 想了解详细的配置与使用方式？请查阅[官方文档站](https://docs.yesimbot.chat/)。

### 升级配置迁移

新版本的 `allowedChannels` 采用严格的默认拒绝策略。未配置或配置为
`allowedChannels: []` 时，不接收任何外部 Session；至少配置一条规则后再
启动。规则按 OR 合并，`platform` 和 `channelId` 支持精确值或 `*`，省略
`isDirect` 表示同时匹配私聊和群聊。需要限定类型时必须显式写布尔值：

```yaml
# 精确频道；不限制私聊/群聊
allowedChannels:
  - platform: onebot
    channelId: "123456"

# 仅私聊、仅群聊
allowedChannels:
  - platform: discord
    channelId: "dm-123"
    isDirect: true
  - platform: onebot
    channelId: "group-456"
    isDirect: false

# 明确允许所有外部平台和频道范围
allowedChannels:
  - platform: "*"
    channelId: "*"
```

模型图片能力只在 `models.json` 的模型覆盖项中声明，Provider 本身不声明
模态能力。缺少或未知图片能力时，模型调用降级为纯文本。启用一个模型的
图片输入：

```json
{
  "chat": {
    "provider:model": {
      "modalities": { "input": ["image"] }
    }
  }
}
```

也可以使用四级权限命令：

```text
yesimbot.model.add-input-modality provider:model image
```

多媒体模型调用默认启用，每次最多 4 张图片、单张 5 MiB、单次 10 MiB，
选择策略为 `current-first`。该策略先访问本次请求的新消息批次，再按 FIFO
访问历史；批次为空时回退到历史 FIFO。`fifo` 和 `lifo` 是 Event 访问顺序，
其中 `lifo` 从新到旧；每个 Event 内的图片引用仍保持源顺序。图片选择和文件
part 只属于本次模型调用，不会改写持久化历史。

活动 Runtime 会快照模型能力、多媒体策略和 Will 引擎。配置或模型能力变更后，
使用非破坏性的 `ctx.yesimbot.reload(scope)` 应用新快照；它保留历史、assets
和 workspace。回滚时将 `will.engine` 设为 `routing`，或将
`multimedia.enabled` 设为 `false`，再 reload 受影响频道。

## Plugins

YesImBot 的能力通过插件系统按需加载。

| 插件        | 包名                                     | 能力                                |
| ----------- | ---------------------------------------- | ----------------------------------- |
| 工作区      | `koishi-plugin-yesimbot-workspace`       | 文件操作、命令执行等工作区工具      |
| MCP 客户端  | `koishi-plugin-yesimbot-mcp-client`      | 通过 MCP 协议接入外部工具服务       |
| 技能        | `koishi-plugin-yesimbot-skills`          | 动态加载与执行预定义技能            |
| MemOS       | `koishi-plugin-yesimbot-memos-client`    | 接入 MemOS Cloud 长期记忆           |
| 搜索        | `koishi-plugin-yesimbot-search-service`  | 网络搜索与信息检索                  |
| OneBot 平台 | `koishi-plugin-yesimbot-platform-onebot` | OneBot 入站消息、图片准备与事件适配 |
| OneBot 工具 | `koishi-plugin-yesimbot-onebot-utils`    | OneBot 平台工具集成                 |
| 贴纸        | `koishi-plugin-yesimbot-sticker`         | 表情与贴纸处理                      |

### LLM Provider

| Provider  | 包名                                         |
| --------- | -------------------------------------------- |
| OpenAI    | `@yesimbot/koishi-plugin-provider-openai`    |
| Anthropic | `@yesimbot/koishi-plugin-provider-anthropic` |
| DeepSeek  | `@yesimbot/koishi-plugin-provider-deepseek`  |
| Google    | `@yesimbot/koishi-plugin-provider-google`    |

## Architecture

Athena 是一个 message-first Koishi agent runtime。当前架构见 [AGENTS.md](./AGENTS.md#current-architecture)。

## Development

本仓库使用 **Yarn 4** 与 **Turborepo** 管理。

```bash
yarn install
yarn check-types
yarn test
yarn build
```

包级验证使用 Turbo filter：

```bash
yarn turbo run test --filter=@yesimbot/agent-runtime
yarn turbo run check-types --filter=koishi-plugin-yesimbot
```

## Community

[![QQ Group](https://img.shields.io/badge/QQ-857518324-blue?style=flat-square)](http://qm.qq.com/cgi-bin/qm/qr?_wv=1027&k=k3O5_1kNFJMERGxBOj1ci43jHvLvfru9&authKey=TkOxmhIa6kEQxULtJ0oMVU9FxoY2XNiA%2B7bQ4K%2FNx5%2F8C8ToakYZeDnQjL%2B31Rx%2B&noverify=0&group_code=857518324)
[![GitHub Issues](https://img.shields.io/badge/Issues-GitHub-181717?style=flat-square&logo=github)](https://github.com/YesWeAreBot/YesImBot/issues)
[![Documentation](https://img.shields.io/badge/DOCS-docs.yesimbot.chat-blue?style=flat-square)](https://docs.yesimbot.chat)

---

## Contributors

感谢所有为 YesImBot 付出努力的人：

[![Contributors](https://contrib.rocks/image?repo=YesWeAreBot/YesImBot)](https://github.com/YesWeAreBot/YesImBot/graphs/contributors)

## Star History

<div align="center">

<a href="https://www.star-history.com/?repos=YesWeAreBot%2FYesImBot&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/image?repos=YesWeAreBot/YesImBot&type=date&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/image?repos=YesWeAreBot/YesImBot&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/image?repos=YesWeAreBot/YesImBot&type=date&legend=top-left" />
 </picture>
</a>

![Activity](https://repobeats.axiom.co/api/embed/6e29e048274c301e59d2c774189029f6f0085a37.svg "Repobeats analytics image")

</div>
