# YesImBot / Athena

<div align="center">
<img src="https://raw.githubusercontent.com/HydroGest/YesImBot/main/img/logo.png" width="60%" alt="YesImBot Logo" />

[![npm](https://img.shields.io/npm/v/koishi-plugin-yesimbot?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-yesimbot)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square)](http://choosealicense.com/licenses/mit/)
![Language](https://img.shields.io/badge/language-TypeScript-brightgreen?style=flat-square)
![NPM Downloads](https://img.shields.io/npm/dw/koishi-plugin-yesimbot?style=flat-square)
[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/MiaowFISH/YesImBot)

**✨ 机器壳，人类心 ✨**

_让 AI 大模型自然融入群聊的智能机器人系统_

[快速开始](#-快速开始) • [核心特性](#-核心特性) • [项目结构](#-项目结构) • [文档](#-文档) • [社区](#-社区支持)

</div>

---

## 📖 项目简介

YesImBot (Athena) 是一个基于 [Koishi](https://koishi.chat/zh-CN/) 的智能聊天机器人插件，旨在让人工智能大模型能够自然地参与到群聊讨论中，模拟真实的人类互动体验。通过先进的意愿值系统、智能记忆管理和可扩展的工具框架，为用户提供更加人性化、更有温度的 AI 交流体验。

不同于传统的命令式 AI 助手，Athena 的设计理念是让机器人像真正的群友一样参与对话——它会观察群聊氛围、记住对话内容、选择合适的时机发言，而不是被动地等待指令。

## 🎯 核心特性

- **🧠 智能意愿系统** - 基于意愿值算法控制 Bot 的主动发言频率，模拟真实人类的交流节奏。Bot 会根据群聊活跃度、@消息、话题相关性等因素动态调整参与意愿，避免过度活跃或过于沉默

- **💾 上下文感知记忆** - 通过 Memory 和 Scenario 系统管理对话上下文，机器人能够记住历史对话、理解话题延续，并在合适的时机回忆起相关内容。支持短期记忆（会话内）和长期记忆（跨会话）

- **🔗 多模型适配器** - 支持多种 LLM API（OpenAI、Cloudflare Workers AI、Ollama 等），内置负载均衡和故障转移机制，确保服务稳定性。可根据任务类型动态选择最合适的模型

- **🛠️ 可扩展工具系统** - 基于工具调用（Function Calling）框架，允许机器人执行各种操作：发送消息、管理记忆、搜索信息、调用外部 API 等。开发者可以轻松添加自定义工具

- **🌍 世界状态管理** - 采用 WorldState 上下文工程设计，将群聊背景、用户信息、时间、环境等信息提炼为结构化的"世界状态"，为 AI 提供完整的场景认知

- **🎭 人格化定制** - 支持自定义 Bot 的名字、性格特征、说话风格、兴趣爱好等。通过 Persona 配置和提示词模板，打造独一无二的虚拟角色

- **🔌 插件生态集成** - 充分利用 Koishi 的插件机制，与现有生态无缝集成。支持 Model Context Protocol (MCP) 扩展，可接入更多外部服务和能力

- **📊 智能调度系统** - 内置心跳处理器和事件调度机制，支持定时任务、延迟响应、消息合并等高级功能，让 Bot 的行为更加自然流畅

## 🏗️ 项目架构

Athena 采用模块化设计，核心功能由多个服务层协作完成：

```
packages/
├── core/                      # 核心插件
│   ├── agent/                 # 智能体系统（意愿值、调度）
│   ├── services/
│   │   ├── memory/            # 记忆管理服务
│   │   ├── model/             # LLM 模型适配服务
│   │   ├── prompt/            # 提示词管理服务
│   │   ├── plugin/            # 工具/插件系统
│   │   ├── horizon/           # 策略与场景管理
│   │   ├── worldstate/        # 世界状态服务
│   │   └── ...
│   └── resources/             # 资源文件（提示词模板等）
├── shared-model/              # 共享模型工具库
└── plugins/
    └── provider-openai/       # OpenAI 提供者插件
```

### 架构特点

- **Service-Oriented** - 各功能模块以服务形式独立，通过依赖注入协作
- **Middleware-Based** - 可在消息处理流程的各个阶段插入自定义逻辑
- **Event-Driven** - 基于事件驱动架构，支持异步处理和灵活的消息流转
- **Highly Extensible** - 清晰的接口设计，便于二次开发和功能扩展

## 📦 项目结构

本项目采用 Monorepo 架构管理，使用 Turborepo 和 Yarn Workspaces：

| 包                    | 描述                            | NPM 包名                        | 状态 |
| --------------------- | ------------------------------- | ------------------------------- | ---- |
| `packages/core`       | 核心机器人插件                  | `koishi-plugin-yesimbot`        | ✅   |
| `packages/shared-model` | 共享的模型工具和类型定义      | `@yesimbot/shared-model`        | ✅   |
| `plugins/provider-openai` | OpenAI 兼容的模型提供者   | `koishi-plugin-yesimbot-provider-openai` | ✅   |

## 🚀 快速开始

### 前置要求

- [Node.js](https://nodejs.org/) >= 18.17.0
- [Koishi](https://koishi.chat/zh-CN/) >= 4.18.7
- 一个可用的 LLM API（如 OpenAI API、Ollama 等）

### 安装

在 Koishi 控制台的插件市场中搜索 `yesimbot`，点击安装即可。

或者使用命令行安装：

```bash
npm install koishi-plugin-yesimbot
# 或
yarn add koishi-plugin-yesimbot
```

### 基础配置

安装后，在 Koishi 配置文件中添加以下配置：

```yaml
plugins:
  yesimbot:
    # 记忆槽位配置
    MemorySlot:
      SlotContains:
        - 123456789  # 群号
      SlotSize: 20
      AtReactPossibility: 0.5
      IncreaseWillingnessOn:
        Message: 15
        At: 80
      Threshold: 80
      MessageWaitTime: 2000
      
    # LLM API 配置
    API:
      APIList:
        - APIType: OpenAI
          BaseURL: https://api.openai.com/v1
          APIKey: sk-your-api-key-here
          AIModel: gpt-4o-mini
          
    # Bot 设定
    Bot:
      WordsPerSecond: 20
```

详细配置说明请参考 [packages/core/README.md](packages/core/README.md)。

### 快速测试

配置完成后，将 Bot 添加到群聊中。发送消息并 @ 机器人，它应该会根据配置的意愿值系统做出响应。

> [!TIP]
> 如果想要 Bot 更活跃，可以降低 `Threshold` 值；如果想让它更安静，则提高此值。开启 `Debug.TestMode` 可以让每条消息都触发回复，便于测试。

## 📋 文档

### 在线文档

访问官方文档站了解更多：[https://docs.yesimbot.chat/](https://docs.yesimbot.chat/)

### 仓库文档

| 文档                                       | 描述                                     |
| ------------------------------------------ | ---------------------------------------- |
| [packages/core/README.md](packages/core/README.md) | 核心插件详细使用说明和配置指南          |
| [conversation/](conversation/)             | 设计文档和开发历程记录                  |
| [conversation/docs/](conversation/docs/)   | 架构设计文档（记忆系统、WorldState 等） |

### 关键概念

- **意愿值系统（Willingness）** - 控制 Bot 主动发言的核心机制
- **记忆槽位（Memory Slot）** - 管理不同会话的上下文隔离和共享
- **世界状态（WorldState）** - 结构化的场景信息，为 AI 提供完整的上下文认知
- **工具调用（Tool Calling）** - 让 AI 能够执行具体操作的框架
- **策略系统（Strategy）** - 根据不同场景选择最合适的提示词策略

## 🛠️ 开发

### 环境设置

```bash
# 克隆仓库
git clone https://github.com/HydroGest/YesImBot.git
cd YesImBot

# 安装依赖
yarn install

# 构建所有包
yarn build

# 开发模式（监听文件变化）
yarn dev
```

### 项目脚本

- `yarn build` - 构建所有包
- `yarn dev` - 开发模式
- `yarn lint` - 运行代码检查
- `yarn test` - 运行测试
- `yarn clean` - 清理构建产物

### 扩展开发

Athena 提供了丰富的扩展点，开发者可以：

1. **添加自定义工具** - 实现新的工具函数，让 AI 能够执行更多操作
2. **扩展服务层** - 增加新的服务模块，如外部 API 集成、数据分析等
3. **定制提示词策略** - 为特定场景设计专门的提示词模板
4. **集成 MCP 协议** - 接入支持 Model Context Protocol 的外部服务

详见开发文档（敬请期待）。

## 🤝 贡献

我们欢迎各种形式的贡献！无论是报告 Bug、提出新功能建议、改进文档，还是提交代码，都对项目的发展有重要意义。

### 贡献者

感谢所有为 Athena 做出贡献的开发者们：

![contributors](https://contrib.rocks/image?repo=HydroGest/YesImBot)

### 如何贡献

1. Fork 本仓库
2. 创建你的特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交你的更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启一个 Pull Request

## 💬 社区支持

### 获取帮助

- **问题反馈** - [GitHub Issues](https://github.com/HydroGest/YesImBot/issues)
- **功能建议** - [GitHub Discussions](https://github.com/HydroGest/YesImBot/discussions)
- **QQ 交流群** - [857518324](http://qm.qq.com/cgi-bin/qm/qr?_wv=1027&k=k3O5_1kNFJMERGxBOj1ci43jHvLvfru9&authKey=TkOxmhIa6kEQxULtJ0oMVU9FxoY2XNiA%2B7bQ4K%2FNx5%2F8C8ToakYZeDnQjL%2B31Rx%2B&noverify=0&group_code=857518324)

### 相关资源

- [Koishi 官方文档](https://koishi.chat/zh-CN/)
- [Koishi 插件市场](https://koishi.chat/zh-CN/market.html)

## ⭐ Star 历史

如果这个项目对你有帮助，请考虑给我们一个 ⭐ Star！

[![Star History Chart](https://api.star-history.com/svg?repos=Hydrogest/Yesimbot&type=Date)](https://star-history.com/#Hydrogest/Yesimbot&Date)

## 🙏 致谢

- 感谢 [Koishi](https://koishi.chat/) 提供的强大机器人框架
- 感谢 [Letta](https://github.com/letta-ai/letta)（原 MemGPT）项目的设计灵感
- 感谢 [@MizuAsaka](https://github.com/MizuAsaka) 设计的精美 Logo
- 感谢所有贡献者和社区成员的支持

---

<div align="center">

**让 AI 更像人类，让聊天更有温度** 💝

Made with ❤️ by the YesImBot Team

</div>
