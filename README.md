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

- **消息优先的运行时** — `@yesimbot/agent-runtime` 将“观察”与“发言”分离：普通消息进入频道历史，Will 决定等待或触发模型回合；忙时事件加入当前 turn，不创建第二个流消费者。
- **多模型即插即用** — 通过 provider 插件接入 OpenAI、Anthropic、DeepSeek、Google 等模型，并通过 `models.json` 管理模型注册与默认值。
- **强大的插件体系** — 工具、提示词、消息转换、生命周期钩子，每个维度都可扩展。插件按 `pre` / normal / `post` 顺序编排。
- **频道存储与资源** — 公开的 `ChannelScope` 只携带当前 `platform`、`selfId`、`channelId` 与 `isDirect`。Core 在内部由 shared/direct tuple 推导存储目录；不会公开频道 identity。每个频道目录保存 `channel.json`、JSONL、assets、workspace 与插件数据。
- **平台输入边界** — 平台注册 `PlatformTranslator`；无精确或显式 `"*"` Translator 时，`message-created` 的非空 message ID 默认透传元素，媒体持久化与自定义事件仍需平台 Translator。Translator 在 Session 生命周期内接收频道 `AssetStore`，直接返回最终 Message/Event record，Gateway 负责被动回复。
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

### 自动接入 Koishi

从零创建 Koishi 应用或把 yesimbot dev 分支接入已有 Koishi 应用，可以使用仓库内置脚本，详见 [docs/setup-koishi.md](docs/setup-koishi.md)。

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

#### 模型图片能力（models.json）

模型图片能力按模型声明，Provider 本身不声明模态能力。缺少或未知图片能力时，模型调用降级为纯文本。当前版本启用图片能力需要直接编辑 `models.json`。

1. 确认模型完整 ID。格式为 `providerId:modelId`，例如 `openai:gpt-4o`。`providerId` 是 provider 插件配置里的 `id`；`modelId` 必须与 provider 插件的 `chatModels` 配置一致。
2. 打开 `models.json`。默认路径是 Koishi 应用根目录下的 `data/yesimbot/models.json`；如果自定义了 `basePath`，则在该目录下。文件不存在时先创建为 `{}`。
3. 在 `chat` 对象下添加该模型的覆盖项：

```json
{ "chat": { "openai:gpt-4o": { "modalities": { "input": ["image"] } } } }
```

4. 保存并重启 Koishi，或等对应 Runtime 被替换。活动 Runtime 在创建时快照模型能力，不会热更新。
5. 检查启动日志。若模型 ID 未注册或拼写错误，该覆盖项会被忽略并记录 warning，此时仍按纯文本处理。

`models.json` 控制“模型是否支持图片输入”，`imageInput` 控制模型调用时的全局开关和预算，两者同时生效：

- 模型未声明 `image`：即使 `imageInput` 未关闭，也只发送文本。
- 模型声明了 `image` 且 `imageInput` 未关闭：允许按 `imageInput` 配置的预算读取图片。
- `imageInput: false`：无论模型是否声明，都禁用图片输入。

模型调用不会自动扫描历史图片；图片只会在模型通过 `read` 工具读取资源后，按当前调用步骤的预算投影。PlatformTranslator 自己决定入站图片下载与持久化。

活动 Runtime 会在创建时快照模型能力、`imageInput`、Will、提示词与插件。Core 不提供 `reload()`：配置、模型或插件变化会在 Runtime 因停止或 shared Bot 变更而替换后生效。

## Plugins

YesImBot 的能力通过插件系统按需加载。

| 插件        | 包名                                    | 能力                                |
| ----------- | --------------------------------------- | ----------------------------------- |
| 工作区      | `koishi-plugin-yesimbot-workspace`      | 文件操作、命令执行与 Skill 目录访问 |
| MCP 客户端  | `koishi-plugin-yesimbot-mcp-client`     | 通过 MCP 协议接入外部工具服务       |
| MemOS       | `koishi-plugin-yesimbot-memos-client`   | 接入 MemOS Cloud 长期记忆           |
| 搜索        | `koishi-plugin-yesimbot-search-service` | 网络搜索与信息检索                  |
| OneBot 工具 | `koishi-plugin-yesimbot-onebot-utils`   | OneBot 平台工具集成                 |
| 贴纸        | `koishi-plugin-yesimbot-sticker`        | 表情与贴纸处理                      |

OneBot Translator 内置于 `koishi-plugin-yesimbot`，通过同一 PlatformTranslator 边界注册，不是可选的平台包。

### LLM Provider

| Provider  | 包名                                         |
| --------- | -------------------------------------------- |
| OpenAI    | `@yesimbot/koishi-plugin-provider-openai`    |
| Anthropic | `@yesimbot/koishi-plugin-provider-anthropic` |
| DeepSeek  | `@yesimbot/koishi-plugin-provider-deepseek`  |
| Google    | `@yesimbot/koishi-plugin-provider-google`    |

## Architecture

Athena 是一个 message-first Koishi agent runtime。入站路径如下：

```text
Session -> allowlist -> shared assignee admission -> AssetStore -> PlatformTranslator
        -> final Message/Event Record -> RuntimeManager -> ChannelRuntime FIFO
        -> wait | join | one output consumer -> passive Gateway delivery
```

Gateway 持有 live Session、Translator 调用、canonical record 与被动回复。未注册平台仍可使用默认 message-created 元素透传，但媒体持久化与自定义事件需显式 Translator。ChannelRuntime 持有 FIFO、Agent 状态、JSONL、Will、模型输入投影与 delivery feedback，不保留 Session。参见 [Core API](./core/README.md)、[维护者指南](./AGENTS.md#current-architecture) 和 [架构愿景与演进说明](./docs/athena-v4-vision-and-evolution-notes.md)。

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
