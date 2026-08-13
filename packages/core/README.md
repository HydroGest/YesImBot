<div align="center">
    <img src="https://raw.githubusercontent.com/HydroGest/YesImBot/main/img/logo.png" width="90%" />
	<h1>Athena | YesImBot</h1>

<h6>感谢 <a href="https://github.com/MizuAsaka">@MizuAsaka</a> 提供 <a href="https://github.com/HydroGest/YesImBot/issues/6">Logo</a></h6>

[![npm](https://img.shields.io/npm/v/koishi-plugin-yesimbot?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-yesimbot) [![MIT License](https://img.shields.io/badge/license-MIT-blue.svg?style=flat)](http://choosealicense.com/licenses/mit/) ![Language](https://img.shields.io/badge/language-TypeScript-brightgreen) ![NPM Downloads](https://img.shields.io/npm/dw/koishi-plugin-yesimbot) ![Static Badge](https://img.shields.io/badge/QQ交流群-857518324-green)

_✨机器壳，人类心。✨_

</div>

## 👋 欢迎使用 Athena

欢迎来到 Athena (YesImBot) 项目！这是一个让 AI 大模型自然融入群聊的 Koishi 插件，让你的机器人拥有更加人性化的交流体验。无论你是开发者还是普通用户，我们都希望这个项目能为你带来价值。

## 🎐 简介

YesImBot / Athena 是一个 [Koishi](https://koishi.chat/zh-CN/) 插件，旨在让人工智能大模型能够自然地参与到群聊讨论中，模拟真实的人类互动体验。插件基于中间件架构设计，具有高度的可扩展性和灵活性。

## 🏗️ 架构与模块

Athena（core）采用模块化架构，核心功能由多个子系统协作实现：

- **Agent 智能体系统**：负责对话意愿、行为调度与主动性模拟。
- **Service 服务层**：包括记忆（Memory）、模型（Model）、提示词（Prompt）、工具（Tool）、资源（Asset）、日志（Logger）、世界状态（WorldState）等服务，分别管理不同的AI能力与资源。
- **工具调用框架**：支持多种工具扩展，便于实现消息发送、记忆管理、外部API调用等高级操作。
- **配置与命令系统**：支持热更新、版本迁移和灵活的参数定制。

所有模块均以插件方式集成于 Koishi 生态，支持按需启用、扩展和二次开发，便于开发者基于 Athena 进行功能增强或个性化定制。

## 🔌 可扩展性与生态集成

Athena 充分利用 Koishi 的插件机制，具备如下优势：

- **高度可扩展**：开发者可自定义服务、工具、指令等，轻松集成第三方 LLM、RAG、TTS/STT、图片识别等能力。
- **生态兼容**：可与 Koishi 现有插件（如通知、数据库、Puppeteer等）无缝协作，支持多平台、多协议机器人部署。
- **二次开发友好**：清晰的服务接口和模块边界，便于社区贡献和业务集成。

Athena 致力于成为最具“人性化”的 AI 群聊插件，助力开发者和用户打造独特的智能机器人体验。

_新的文档站已上线：[https://docs.yesimbot.chat/](https://docs.yesimbot.chat/)_

## 🎹 特性

- **智能对话管理**：基于意愿值系统控制Bot的主动发言频率，模拟真实人类的交流模式。

- **记忆系统**：通过Memory和Scenario管理上下文，使机器人能够记住和理解对话历史。

- **多适配器支持**：支持多种LLM API（如OpenAI、Cloudflare、Ollama等），实现负载均衡和故障转移。

- **可扩展的工具系统**：基于工具调用框架，允许机器人执行各种操作，如发送消息、管理记忆等。

- **高级上下文感知**：自动感知当前场景信息（群组信息、时间、@消息等），增强对话的沉浸感。

- **自定义人格与行为**：轻松定制Bot的名字、性格、响应模式等，打造独特的交互体验。

- _AND MORE..._

## 🌈 开始使用

> [!IMPORTANT]
> 继续前, 请确保正在使用 Athena 的最新版本。

> [!CAUTION]
> 请仔细阅读此部分, 这很重要。

下面来讲解配置文件的用法:

```yaml
# 记忆槽位设置
MemorySlot:
    # 记忆槽位，每一个记忆槽位都可以填入一个或多个会话id（群号或private:私聊账号），在一个槽位中的会话id会共享上下文
    SlotContains:
        - 114514 # 收到来自114514的消息时，优先使用这个槽位，意味着bot在此群中无其他会话的记忆
        - 114514, private:1919810 # 收到来自1919810的私聊消息时，优先使用这个槽位，意味着bot此时拥有两个会话的记忆
        - private:1919810, 12085141, 2551991321520
    # Bot能接收的上下文数量
    SlotSize: 20
    # @消息立即回复的概率（取值0-1）
    AtReactPossibility: 0.5
    # 意愿值增加设置
    IncreaseWillingnessOn:
        # 收到普通消息时增加的意愿值
        Message: 15
        # 收到@消息时增加的意愿值
        At: 80
    # 回复意愿阈值（超过此值触发回复）
    Threshold: 80
    # 消息等待时间(毫秒)，用于合并连续的消息
    MessageWaitTime: 2000
    # 判定为同一用户连续消息的时间阈值(毫秒)
    SameUserThreshold: 5000
    # 记忆文件存储配置
    StoreFile:
        human: "data/yesimbot/memory/human.txt"
        persona: "data/yesimbot/memory/persona.txt"

# LLM API 配置
API:
    # API列表，支持多个API进行负载均衡
    APIList:
        # 支持类型：OpenAI / Cloudflare / Ollama / Custom
        - APIType: OpenAI
          # API基础URL
          BaseURL: https://api.openai.com/
          # API密钥
          APIKey: sk-XXXXXXXXXXXXXXXXXXXXXXXXXXXX
          # 使用的模型
          AIModel: gpt-4o-mini
          # Cloudflare配置（如果使用Cloudflare）
          # UID: xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# 机器人设定
Bot:
    # 每秒发送的字符数，影响机器人回复的打字速度
    WordsPerSecond: 20

# 调试设置
Debug:
    # 在控制台显示Debug消息
    EnableDebug: false
    # 测试模式（每条消息都会触发回复）
    TestMode: false
```

配置完成后，将机器人拉到对应的群组中。机器人会根据意愿值系统决定何时参与讨论。每收到一条消息，机器人的"回复意愿"会增加（见`IncreaseWillingnessOn.Message`配置），当意愿值超过设定的阈值（`Threshold`）时，机器人就会发送回复。被@时，意愿值会大幅增加（见`IncreaseWillingnessOn.At`配置），并且有一定概率（由`AtReactPossibility`决定）立即回复。

> [!TIP]
> 如果想让机器人更活跃，可以降低`Threshold`值；反之，提高此值会让机器人更"安静"。

> [!NOTE]
> 系统会自动合并短时间内的连续消息以优化上下文处理。`MessageWaitTime`和`SameUserThreshold`参数可以调整这一行为。

## 📃 自定义系统提示词

你可以根据自己的需求自定义系统提示词。`StoreFile` 的内容将被添加到系统提示词的末尾。

- 消息队列呈现给LLM的格式：

```text
[messageId][{date} from_guild:{channelId}] {senderName}<{senderId}> 说: {userContent}
```

- Athena期望LLM返回的格式：

```json
{
    "function": "{functionName}",
    "params": {
        "{paramName}": "{paramValue}"
    }
}
```

## 🚧 从 v2 版本迁移

> [!NOTE]
> 由于大量的代码重构，v3 版本的配置文件与 v2 版本的配置文件不兼容。建议先将 v2 版本的插件删除，然后安装 v3 版本。

## 🌼 推荐的 API 提供商

我们强烈推荐使用非Token计费的API服务，因为Athena的系统提示词较长，基于Token计费会增加使用成本。以下是一些按调用次数计费的推荐服务：

- [GPTGOD](https://gptgod.online/#/register?invite_code=envrd6lsla9nydtipzrbvid2r)

## ✨ 效果

<details>
  <summary>截图</summary>

![截图1](https://raw.githubusercontent.com/HydroGest/YesImBot/main/img/screenshot-1.png)
![截图2](https://raw.githubusercontent.com/HydroGest/YesImBot/main/img/screenshot-2.png)

</details>

## 🍧 TODO

我们的终极目标是——即使哪一天你的账号接入了Athena，群友也不能发现任何端倪——我们一切的改进都是朝这方面努力的。

- [x] At 消息识别
- [x] 表情发送
- [x] 图片多模态与基于图像识别的伪多模态
- [ ] 转发消息拾取
- [ ] TTS/STT
- [ ] RAG 记忆库
- [ ] 读取文件
- [x] 工具调用

## 🚩 构建

```bash
# 安装依赖
yarn install

# 构建
yarn build

# 打包外部依赖
cd packages/core
yarn bundle
```

## 💫 贡献者

感谢贡献者们, 是你们让 Athena 成为可能。

![contributors](https://contrib.rocks/image?repo=HydroGest/YesImBot)

## 💡 反馈

欢迎发布issue，或是直接加入Athena官方交流&测试群：[857518324](http://qm.qq.com/cgi-bin/qm/qr?_wv=1027&k=k3O5_1kNFJMERGxBOj1ci43jHvLvfru9&authKey=TkOxmhIa6kEQxULtJ0oMVU9FxoY2XNiA%2B7bQ4K%2FNx5%2F8C8ToakYZeDnQjL%2B31Rx%2B&noverify=0&group_code=857518324)，我们随时欢迎你的来访！

## ⭐ Star 历史

[![Athena/YesImBot Star 历史图表](https://api.star-history.com/svg?repos=Hydrogest/Yesimbot&type=Date)](https://star-history.com/#Hydrogest/Yesimbot&Date)
