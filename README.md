<div align="center">
	<img src="assets/logo.png" width="60%" />

[![npm](https://img.shields.io/npm/v/koishi-plugin-yesimbot?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-yesimbot)
[![License](https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square)](LICENSE)
![Language](https://img.shields.io/badge/language-TypeScript-brightgreen?style=flat-square)
![Status](https://img.shields.io/badge/status-beta-yellow?style=flat-square)
[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/YesWeAreBot/YesImBot)

**机器壳，人类心。**

_让 AI 大模型自然融入群聊的智能机器人系统_

</div>

---

## 这是什么

Athena（YesImBot v4）是一套 Koishi 插件与运行时，用来把大语言模型接入群聊。

它不把群聊当成一串命令，而是围绕频道、上下文、模型、工具和插件建立一套可持续运行的结构。目标很朴素：让机器人在群里更会看上下文，更少打断人，也更容易扩展。

Athena 目前处于 **v4 beta**。当前重点是稳定运行骨架、模型接入和插件边界；更细腻的发言时机、记忆与群聊行为还在继续打磨。

## 当前可用

- **Koishi 集成**：作为 `koishi-plugin-yesimbot` 运行，按频道维护独立会话。
- **消息运行时**：`@yesimbot/agent-runtime` 负责消息追加、模型回合、工具调用、状态和事件。
- **多模型接入**：通过 provider 插件接入 OpenAI、Anthropic、DeepSeek、Google。
- **工具插件**：Workspace、MCP Client、Skill、Search、MemOS Cloud、OneBot 工具、Sticker 等能力按需启用。
- **上下文持久化**：每个频道使用 JSONL 保存消息历史，便于恢复和调试。
- **提示词文件**：运行数据目录中的 `AGENTS.md` 与 `PERSONA.md` 可用于调整机器人行为和表达风格。

## 设计取向

### 群聊不是命令行

群聊里最重要的不是每次都回答，而是理解什么时候需要回应、什么时候只记录上下文。Athena 的运行时把“观察”和“发言”分开：普通消息可以只进入上下文，私聊或明确提及时再触发模型回合。

### Core 保持小

`core/` 只负责 Koishi 接入、消息路由、模型注册和频道运行时创建。搜索、工作区、记忆、MCP、平台工具等能力放在插件里，避免把所有逻辑塞进主插件。

### 先稳定，再扩展

v4 的重点不是堆功能，而是把消息、模型、工具、插件和持久化的边界理顺。骨架稳定以后，群聊行为、长期记忆和更多平台能力才更容易持续演进。

## 项目结构

```text
Athena/
├── core/                    Koishi 主插件：消息路由、模型服务、频道运行时
├── packages/
│   └── agent-runtime/       消息运行时：回合队列、工具调用、插件钩子、状态和存储
├── providers/               模型提供商插件：OpenAI / Anthropic / DeepSeek / Google
├── plugins/                 可选能力插件：Workspace / MCP / Skill / Search / MemOS 等
├── docs/                    设计记录与归档文档
└── assets/                  项目资源
```

| 目录                      | 包名                                  | 说明                 |
| ------------------------- | ------------------------------------- | -------------------- |
| `core/`                   | `koishi-plugin-yesimbot`              | Koishi 主插件        |
| `packages/agent-runtime/` | `@yesimbot/agent-runtime`             | 通用消息运行时       |
| `plugins/workspace/`      | `koishi-plugin-yesimbot-workspace`    | 工作区与命令工具     |
| `plugins/mcp-client/`     | `koishi-plugin-yesimbot-mcp-client`   | MCP 客户端工具       |
| `plugins/skill/`          | `koishi-plugin-yesimbot-skill`        | Skill 加载工具       |
| `plugins/memos-client/`   | `koishi-plugin-yesimbot-memos-client` | MemOS Cloud 记忆工具 |

Provider 包位于 `providers/*`，目前包括 OpenAI、Anthropic、DeepSeek 和 Google。

## 开发入口

本仓库使用 Yarn 4 与 Turborepo。

```bash
yarn install
yarn check-types
yarn test
yarn build
```

常用的包级验证可以用 Turbo filter，例如：

```bash
yarn turbo run test --filter=@yesimbot/agent-runtime
yarn turbo run check-types --filter=koishi-plugin-yesimbot
```

## 快速了解

| 想了解   | 阅读                                                                                  |
| -------- | ------------------------------------------------------------------------------------- |
| 当前进度 | [ROADMAP.md](ROADMAP.md)                                                              |
| 更新记录 | [CHANGELOG.md](CHANGELOG.md)                                                          |
| 设计背景 | [vision-and-evolution-notes](docs/2026-05-04-athena-v4-vision-and-evolution-notes.md) |
| 文档站   | [docs.yesimbot.chat](https://docs.yesimbot.chat/)                                     |

## 社区与支持

- 问题反馈：[GitHub Issues](https://github.com/YesWeAreBot/YesImBot/issues)
- QQ 交流群：[857518324](http://qm.qq.com/cgi-bin/qm/qr?_wv=1027&k=k3O5_1kNFJMERGxBOj1ci43jHvLvfru9&authKey=TkOxmhIa6kEQxULtJ0oMVU9FxoY2XNiA%2B7bQ4K%2FNx5%2F8C8ToakYZeDnQjL%2B31Rx%2B&noverify=0&group_code=857518324)

## 贡献者

感谢所有为 Athena 付出努力的人：

![contributors](https://contrib.rocks/image?repo=YesWeAreBot/YesImBot)

## Star 趋势

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

---

<div align="center">

**Code is open, but the soul is yours.**

_让 AI 更像人类，让聊天更有温度_

</div>
