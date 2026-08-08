# koishi-plugin-yesimbot-chat-learning

从真实群聊中学习消息关系、回应规律与话题发起方式，并把结果以有界 prompt 块注入模型上下文。它不改 Core、不修改 bot 输出、不做主动调度。

## 配置

| 配置项                      | 默认值  | 说明                                                                       |
| --------------------------- | ------- | -------------------------------------------------------------------------- |
| `maxExamples`               | `4`     | 每轮最多注入几个示例对话段                                                 |
| `maxMessagesPerExample`     | `5`     | 每个示例段最多包含的消息数                                                 |
| `maxHistoryAgeDays`         | `30`    | 学习历史的最大天数                                                         |
| `maxScanMessages`           | `1000`  | 每次构建最多扫描的消息数                                                   |
| `refreshIntervalMinutes`    | `30`    | 模型规律提炼的最小间隔分钟数                                               |
| `maxPromptTokens`           | `2500`  | chat-learning 注入块的 token 预算                                          |
| `maskNames`                 | `true`  | 示例中把真实昵称替换为伪名                                                 |
| `blockedUserIds`            | `[]`    | 不参与学习、也不进入 few-shot 的 user id 黑名单                            |
| `blockedUserPatterns`       | `[]`    | 按昵称或 user id 子串过滤其他 bot                                          |
| `autoBlockBotNames`         | `false` | 启用常见 bot 名称自动过滤                                                  |
| `observeAllChannels`        | `false` | 在未启用 yesimbot 的频道也采集消息，用于跨群全局规律学习                   |
| `globalRulePath`            | 留空    | 跨群全局规则文件路径；留空时使用 `data/yesimbot/chat-learning-global.json` |
| `globalSyncIntervalMinutes` | `60`    | 跨群全局规律同步最小间隔分钟数                                             |
| `minGlobalChannels`         | `2`     | 全局规律至少出现的频道数                                                   |
| `maxGlobalPatterns`         | `8`     | 每轮最多注入的全局规律数                                                   |
| `summaryModel`              | 留空    | 使用 Core 注册的模型 ID；留空则只使用确定性统计规律                        |

`summaryModel` 使用与 Core `chatModel` 相同的 `registry.chatModels` schema，可以直接填 `provider:model`。

群里存在其他 bot 时，建议把它们的 user id 填进 `blockedUserIds`；`blockedUserPatterns` 适合按昵称规则过滤，`autoBlockBotNames` 则启用内置的 bot/机器人/小助手/官方/客服/通知/公告名称匹配。

## 行为

插件按频道维护：

- 独立的 `chat-learning-history.jsonl`，与 Core session 归档/清空解耦；
- quote/reply/@/相邻/实体关系的置信度图；
- 本地回应规律和话题发起规律；
- 可选的模型规律提炼；
- 有界 `<message_links>`、`<active_chain>`、`<local_patterns>`、`<group_examples>` 注入。

启用 `observeAllChannels` 后，插件会在未开启 yesimbot 的频道采集真实消息，写入全局历史，并按频道聚合到 `chat-learning-global.json`。原始全局历史会在聚合成功后清空，避免无限增长。

当 turn 来自 `global-brain` 或 `schedule` 时，会额外注入 `<event_context>` 和 `initiation` 规律，让主动发起发言也沿用本群表达方式。

注入块前面会固定附带 `<chat_learning_guide>`，明确告诉模型 `<group_examples>` 和 `<local_patterns>` 是本群真实消息组成的 few-shot 风格样本，要求模仿表达节奏，不复制内容，也不把这些标签写进对外回复。

## 人工纠错

管理员可以通过命令修正消息关系，纠错会持久化到频道下的 `chat-learning-feedback.jsonl`，并在后续重建时影响链接图：

```text
yesimbot.chat-learning.status
yesimbot.chat-learning.preview [--event global-brain|schedule|chat-learning]
yesimbot.chat-learning.reset
yesimbot.chat-learning.link <from> <to> <kind> [--confidence 0-1]
yesimbot.chat-learning.unlink <from> <to> [kind]
```

`kind` 支持 `quote`、`reply`、`at`、`adjacent`、`entity` 和 `*`。`unlink` 不传 kind 时默认移除两消息之间的全部关系。

`preview` 会读取当前频道持久化后的学习状态，并输出实际会注入模型的 `<message_links>`、`<local_patterns>` 等 prompt 块。合并转发中保留原始标签；回退为普通文本时会把标签转义，避免被 Koishi/Satori 当元素解析。传 `--event` 可以预览 global-brain/schedule 主动事件下的发起规律版本。

`status` 和 `preview` 的长回复在 OneBot 适配器支持时使用合并转发发送，避免长文本直接刷屏；适配器不支持时回退为普通文本。

`reset` 只清空当前频道的 `chat-learning.json`、`chat-learning-history.jsonl` 和 `chat-learning-feedback.jsonl`，不会归档或清空 Core session。

媒体占位符、URL、@提及、纯 hashtag 和常见 bot 状态文本不会进入 `local_patterns`；预览里的长链接和资源引用也会被压缩，降低 token 占用。

调试日志统一使用 `yesimbot.chat-learning` logger 的 debug 级别，覆盖插件启动、频道 Runtime 创建、数据重建、事件识别、prompt 注入和纠错命令。

## 当前边界

- 本地规律按频道存储，跨频道全局规则库已提供基础聚合。
- 显式链接优先；隐式链接使用置信度候选。
- 人工纠错会在命令执行后触发当前频道重建；如果没有运行中的 Runtime，则下一次频道 Runtime 初始化时应用。
- 长期存储和注入预算已分离，prompt 不会随学习数据无限增长。

## 验证

```bash
npx tsc --noEmit -p plugins/chat-learning/tsconfig.json
npx vitest run plugins/chat-learning
yarn turbo run build --filter=koishi-plugin-yesimbot-chat-learning
```
