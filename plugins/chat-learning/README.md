# koishi-plugin-yesimbot-chat-learning

从真实群聊中学习消息关系、回应规律与话题发起方式，并把结果以有界 prompt 块注入模型上下文。它不改 Core、不修改 bot 输出、不做主动调度。

## 配置

| 配置项                   | 默认值  | 说明                                                |
| ------------------------ | ------- | --------------------------------------------------- |
| `maxExamples`            | `4`     | 每轮最多注入几个示例对话段                          |
| `maxMessagesPerExample`  | `5`     | 每个示例段最多包含的消息数                          |
| `maxHistoryAgeDays`      | `30`    | 学习历史的最大天数                                  |
| `maxScanMessages`        | `1000`  | 每次构建最多扫描的消息数                            |
| `refreshIntervalMinutes` | `30`    | 模型规律提炼的最小间隔分钟数                        |
| `maxPromptTokens`        | `2500`  | chat-learning 注入块的 token 预算                   |
| `maskNames`              | `true`  | 示例中把真实昵称替换为伪名                          |
| `blockedUserIds`         | `[]`    | 不参与学习、也不进入 few-shot 的 user id 黑名单     |
| `blockedUserPatterns`    | `[]`    | 按昵称或 user id 子串过滤其他 bot                   |
| `autoBlockBotNames`      | `false` | 启用常见 bot 名称自动过滤                           |
| `summaryModel`           | 留空    | 使用 Core 注册的模型 ID；留空则只使用确定性统计规律 |

`summaryModel` 使用与 Core `chatModel` 相同的 `registry.chatModels` schema，可以直接填 `provider:model`。

群里存在其他 bot 时，建议把它们的 user id 填进 `blockedUserIds`；`blockedUserPatterns` 适合按昵称规则过滤，`autoBlockBotNames` 则启用内置的 bot/机器人/小助手/官方/客服/通知/公告名称匹配。

## 行为

插件按频道维护：

- 真实群友消息收集与分段；
- quote/reply/@/相邻/实体关系的置信度图；
- 本地回应规律和话题发起规律；
- 可选的模型规律提炼；
- 有界 `<message_links>`、`<active_chain>`、`<local_patterns>`、`<group_examples>` 注入。

当 turn 来自 `global-brain` 或 `schedule` 时，会额外注入 `<event_context>` 和 `initiation` 规律，让主动发起发言也沿用本群表达方式。

## 当前边界

- 规律先按频道存储，跨频道全局规则库尚未实现。
- 显式链接优先；隐式链接使用置信度候选。
- 长期存储和注入预算已分离，prompt 不会随学习数据无限增长。

## 验证

```bash
npx tsc --noEmit -p plugins/chat-learning/tsconfig.json
npx vitest run plugins/chat-learning
yarn turbo run build --filter=koishi-plugin-yesimbot-chat-learning
```
