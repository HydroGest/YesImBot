<div align="center">
    <img src="https://raw.githubusercontent.com/HydroGest/YesImBot/main/logo.png"/>
	<h1 id="koishi">Athena | YesImBot</h1>

[![npm](https://img.shields.io/npm/v/koishi-plugin-yesimbot?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-yesimbot) [![MIT License](https://img.shields.io/badge/license-MIT-blue.svg?style=flat)](http://choosealicense.com/licenses/mit/) ![Language](https://img.shields.io/badge/language-TypeScript-brightgreen) ![NPM Downloads](https://img.shields.io/npm/dw/koishi-plugin-yesimbot)

*✨机器壳，人类心。✨*

</div>

## 🎐 简介

YesImBot / Athena 是一个 [Koishi](https://koishi.chat/zh-CN/) 插件，旨在让大模型人工智能也能参与到聊群的讨论中。

## 🌈 开始使用

首先确保安装了 YesImBot 最新版，填入配置文件。下面来讲解配置文件的用法。

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

# LLM API 相关设置
API:
    # API 的类型，可选 OpenAI / Cloudflare
    APIType: OpenAI
    # API 基础 URL。以 OpenAI 为例。
    # 若你是 Cloudflare， 请填入 https://api.cloudflare.com/client/v4
    BaseAPI: https://api.openai.com/v1/chat/completions/
    # 你的 API 令牌
    APIKey: sk-XXXXXXXXXXXXXXXXXXXXXXXXXXXX
    # 模型
    AIModel: gpt-4o-mini
    # 若你是 Cloudflare，不要忘记下面这个配置
    # Cloudflare Account ID，若不清楚可以看看你 Cloudflare 控制台的 URL。
    UID:　xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# 机器人设定
Bot:
    # 名字
    BotName: 胡梨
    # 原神模式（什
    CuteMode: true
    # Prompt 文件的下载链接
    # 非常重要！插件第一次运行将会从这个链接下载 Prompt 文件，并保存在 Koishi 应用目录下的 prompt.mdt
    PromptFileUrl: https://github.com/HydroGest/promptHosting/blob/main/prompt.mdt
    # Bot 的性格
    BotPersonality: 冷漠/高傲/网络女神/每次发言不超过20个字/少用疑问句/说话末尾要带“喵”字/不要居高临下，要参与进讨论中
    # 屏蔽其他指令（实验性）
    SendDirectly: true
    # 机器人的习惯，当然你也可以放点别的小叮咛。
    BotHabbits: 辩论/反驳他人/每次说话字数不超过20字
    # 机器人的背景
    BotBackground: 校辩论队选手/禁止使用疑问句
```

然后，将机器人拉到对应的群组中。机器人首先会潜水一段时间，这取决于 `Group.SendQueueSize` 的配置。当新消息条数达到这个值之后，Bot 就要开始参与讨论了（这也非常还原真实人类的情况，不是吗）。如果你认为 Bot 太活跃了，你也可以将 `Group.MinPopNum` 调高。**请注意**，`Group.MinPopNum` 必须小于 `Group.MaxPopNum`，并且 `Group.MaxPopNum` 必须小于 `Group.SendQueueSize`。

接下来你可以根据实际情况调整机器人设定中的选项。在这方面你大可以自由发挥。但是如果你用的是 Cloudflare Workers AI，你可以会发现你的机器人在胡言乱语。这是 Cloudflare Workers AI 的免费模型效果不够好，中文语料较差导致的。如果你想要在保证 AI 发言质量的情况下尽量选择价格较为经济的 AI 模型，那么 ChatGPT-4o-mini 或许是明智之选。当然，你也不必强制自己使用 OpenAI 的官方 API，所有官方 API 格式都支持 YesImBot。

## 🌼 推荐的 API 提供商

我们强力推荐大家使用非 Token 计费的 API，这是因为 YesImBot 每次请求需要发送的 Prompt 本身占用了非常多的 Token。你可以使用以调用次数计费的 API，比如：

- [GPTGOD](https://gptgod.online/#/register?invite_code=envrd6lsla9nydtipzrbvid2r)

## 🍧 TODO

我们的终极目标是——即使哪一天你的账号接入了 YesImBot，群友也不能发现任何端倪——我们一切的改进都是朝这方面努力的。

- [x] At 消息识别
- [ ] 转发消息拾取
- [ ] TTS 文字转语音
- [ ] OCR 图像识别
