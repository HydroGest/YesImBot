<div align="center">
    <img src="https://raw.githubusercontent.com/HydroGest/YesImBot/main/img/logo.png" width="90%" />
	<h1>Athena | YesImBot</h1>

<h6>感谢 <a href="https://github.com/MizuAsaka">@MizuAsaka</a> 提供 <a href="https://github.com/HydroGest/YesImBot/issues/6">Logo</a></h6>

[![npm](https://img.shields.io/npm/v/koishi-plugin-yesimbot?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-yesimbot) [![MIT License](https://img.shields.io/badge/license-MIT-blue.svg?style=flat)](http://choosealicense.com/licenses/mit/) ![Language](https://img.shields.io/badge/language-TypeScript-brightgreen) ![NPM Downloads](https://img.shields.io/npm/dw/koishi-plugin-yesimbot)

*✨机器壳，人类心。✨*

</div>

## 🎐 简介

YesImBot / Athena 是一个 [Koishi](https://koishi.chat/zh-CN/) 插件，旨在让人工智能大模型也能参与到群聊的讨论中。

## 🎹 特性

- 轻松自定义：Bot 的名字、性格、情感，以及其他额外的消息都可以在插件配置中轻易修改。

- 负载均衡：你可以配置多个大模型的 API 接口， Athena 会均衡地调用每一个 API。

- 沉浸感知：大模型感知当前的背景信息，如日期时间、群聊名字，At 消息等。

- 防提示注入：Athena 将会屏蔽可能对大模型进行注入的消息，防止机器人被他人破坏。

- Prompt 自动获取：无需自行配制，多种优质 Prompt 开箱即用。

- *AND MORE...*

## 🌈 开始使用

> [!IMPORTANT]
> 继续前, 请确保正在使用 Athena 的最新版本。

> [!CAUTION]
> 请仔细阅读此部分, 这很重要。

下面来讲解配置文件的用法:

```yaml
# 群聊设置
Group:
    # 允许机器人说话的群聊
    AllowedGroups:
        - 114514
        - 1919810
    # 规定机器人能阅读的上下文数量
    SendQueueSize: 7
    # 以下是每次机器人发送消息后的冷却条数取随机数的区间。
    # 最大冷却条数
    MaxPopNum: 4
    # 最小冷却条数
    MinPopNum: 2
    # 每次收到 @ 消息，机器人马上开始做出回复的概率。 取值范围：[0, 1]
    AtReactPossiblilty: 0.50
    # 过滤的消息。这些包含这些关键词的消息将不会加入到上下文。
    # 这主要是为了防止 Bot 遭受提示词注入攻击。
    Filter:
        - You are
        - 呢
        - 大家

# LLM API 相关设置
API:
    # 这是个列表，可以配置多个 API，实现负载均衡。
    APIList:
        # API 返回格式类型，可选 OpenAI / Cloudflare
        - APIType: OpenAI
          # API 基础 URL，此处以 OpenAI 为例
          # 若你是 Cloudflare， 请填入 https://api.cloudflare.com/client/v4
          BaseURL: https://api.openai.com/
          # 你的 API 令牌
          APIKey: sk-XXXXXXXXXXXXXXXXXXXXXXXXXXXX
          # 模型
          AIModel: gpt-4o-mini
          # 若你正在使用 Cloudflare，不要忘记下面这个配置
          # Cloudflare Account ID，若不清楚可以看看你 Cloudflare 控制台的 URL
          UID:　xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# 机器人设定
Bot:
    # 名字
    BotName: 胡梨
    # 原神模式（什
    CuteMode: true
    # Prompt 文件的下载链接
    # 非常重要! 如果你不理解这是什么，请不要修改
    PromptFileUrl: 
        - "https://raw.githubusercontent.com/HydroGest/promptHosting/main/prompt.mdt" # 一代 Prompt，所有 AI 模型适用
        - "https://raw.githubusercontent.com/HydroGest/promptHosting/main/prompt-next.mdt" # 下一代 Prompt，效果最佳，如果你是富哥，用的起 Claude 3.5 / GPT-4 等，则推荐使用
        - "https://raw.githubusercontent.com/HydroGest/promptHosting/main/prompt-next-short.mdt" # 下一代 Prompt 的删减版，适合 GPT-4o-mini 等低配模型使用
    # 当前选择的 Prompt 索引，从 0 开始
    PromptFileSelected: 2
    # Bot 的自我认知
    WhoAmI: 一个普通群友
    # Bot 的性格
    BotPersonality: 冷漠/高傲/网络女神
    # 屏蔽其他指令（实验性）
    SendDirectly: true
    # 机器人的习惯，当然你也可以放点别的小叮咛
    BotHabbits: 辩论
    # 机器人的背景
    BotBackground: 校辩论队选手
```

然后，将机器人拉到对应的群组中。机器人首先会潜水一段时间，这取决于 `Group.SendQueueSize` 的配置。当新消息条数达到这个值之后，Bot 就要开始参与讨论了（这也非常还原真实人类的情况，不是吗）。

> [!TIP]
> 如果你认为 Bot 太活跃了，你也可以将 `Group.MinPopNum` 数值调高。

> [!WARNING]
> 频次配置应保持如下关系: `Group.MinPopNum` < `Group.MaxPopNum` < `Group.SendQueueSize`，否则会导致问题。

接下来你可以根据实际情况调整机器人设定中的选项。在这方面你大可以自由发挥。但是如果你用的是 Cloudflare Workers AI，你可以会发现你的机器人在胡言乱语。这是 Cloudflare Workers AI 的免费模型效果不够好，中文语料较差导致的。如果你想要在保证 AI 发言质量的情况下尽量选择价格较为经济的 AI 模型，那么 ChatGPT-4o-mini 或许是明智之选。当然，你也不一定必须使用 OpenAI 的官方 API，Athena 支持任何使用 OpenAI 官方格式的 API 接口。

> [!NOTE]
> 经过测试, Claude 3.5 模型在此场景下表现最佳。

## 🌼 推荐的 API 提供商

我们强烈推荐大家使用非 Token 计费的 API，这是因为 Athena 每次对话的前置 Prompt 本身消耗了非常多的 Token。你可以使用一些以调用次数计费的 API，比如：

- [GPTGOD](https://gptgod.online/#/register?invite_code=envrd6lsla9nydtipzrbvid2r)

## ✨ 效果

![](https://raw.githubusercontent.com/HydroGest/YesImBot/main/img/screenshot-1.png)
![](https://raw.githubusercontent.com/HydroGest/YesImBot/main/img/screenshot-2.png)

## 🍧 TODO

我们的终极目标是——即使哪一天你的账号接入了 Athena，群友也不能发现任何端倪——我们一切的改进都是朝这方面努力的。

- [x] At 消息识别
- [ ] 表情发送
- [ ] 转发消息拾取
- [ ] TTS 文字转语音
- [ ] OCR 图像识别

## 💫 贡献者

感谢贡献者们, 是你们让 Athena 成为可能。

![contributors](https://contrib.rocks/image?repo=HydroGest/YesImBot)
