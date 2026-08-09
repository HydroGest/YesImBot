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
| `summaryModel`              | 留空    | 使用 Core 注册的模型 ID；留空则使用默认 chat 模型进行意图分类              |
| `embeddingModel`            | 留空    | 可选 embedding 模型；配置后用于语义归并全局规律，留空则精确匹配             |
| `embeddingSimilarity`       | `0.92`  | embedding 语义归并阈值，越高要求越相似                                      |
| `maxModelThreads`           | `3`     | 每次模型标注最多使用几条完整对话线程                                        |
| `maxModelThreadMessages`    | `30`    | 每条线程最多送入模型的消息数                                                |
| `reflectionModel`           | 留空    | 可选独立模型；用于评价 bot 最近发言并生成风格反思，留空则关闭                 |
| `maxInjectedReflections`    | `3`     | 每次注入提示词末尾的最近反思条数                                             |
| `injectStyleAsSystem`       | `false` | 将风格参考作为 system 消息注入；默认用尾部 user 消息以兼容更多 provider       |

`summaryModel` 使用与 Core `chatModel` 相同的 `registry.chatModels` schema，可以直接填 `provider:model`；没有可用模型时不生成 `local_patterns`。

`embeddingModel` 使用与 Core 一致的 `registry.embeddingModels` schema，可以直接填 `provider:model`；留空时不调用 embedding，避免产生额外成本和 provider 依赖。

群里存在其他 bot 时，建议把它们的 user id 填进 `blockedUserIds`；`blockedUserPatterns` 适合按昵称规则过滤，`autoBlockBotNames` 则启用内置的 bot/机器人/小助手/官方/客服/通知/公告名称匹配。

## 行为

插件按频道维护：

- 独立的 `chat-learning-history.jsonl`，与 Core session 归档/清空解耦；
- quote/reply/@/相邻/实体关系的置信度图；
- 本地回应规律和话题发起规律；
- 模型驱动的响应/发起意图分类，并按真实样本频率聚合规律；
- 有界注入 `<style_examples>` 完整对话样本，以及 `<local_patterns>`、`<global_patterns>`、`<global_chains>` 语言风格样本。

响应规律只从图中有明确边或处于同一回复链的消息对提取；仅时间相邻但没有关系边的消息不会进入 response pattern。

配置 `embeddingModel` 后，全局规律会按 embedding 相似度把语义相近的短语归并到同一跨群规律；不配置则保持精确短语匹配。

模型标注时会把完整对话线程交给模型，由模型结合上下文逐条标注 role/intent，而不是单独标注单条消息；线程数、消息总数和字符数都有上限，避免无限消耗额度。

配置 `reflectionModel` 后，插件会在 bot 的最终发言成功发送后，用该模型基于同一份群聊 few-shot 即时生成 2-3 句可执行反思，并在下一次提示词末尾注入最近 `maxInjectedReflections` 条反思历史，人工标注优先显示。每条反思会同时保存被评价的 bot 发言，注入时用 `<target>` 明确指向对应消息，避免模型不知道在说哪条。反思按频道串行异步生成，不阻塞下一次发言；连续发送时只会保留最新消息的反思结果。留空则不调用，也不会产生额外额度消耗。

启用 `observeAllChannels` 后，插件会在未开启 yesimbot 的频道采集真实消息，写入全局历史，并按频道聚合到 `chat-learning-global.json`。原始全局历史会在聚合成功后清空，避免无限增长。

注入块前面会固定附带 `<chat_learning_guide>`，明确告诉模型 `<style_examples>` 是本群完整对话样本，`<local_patterns>` 是本群语言风格样本；`<global_patterns>` 和 `<global_chains>` 是跨群弱先验，只用于补充表达和接话节奏。要求模仿表达节奏，不复制内容；同时禁止“笑点解析/分析/总结”式长篇解释、连续刷多条说明和复读群友原句，也不把这些标签写进对外回复。

## 人工纠错

管理员可以通过命令修正消息关系，纠错会持久化到频道下的 `chat-learning-feedback.jsonl`，并在后续重建时影响链接图：

```text
yesimbot.chat-learning.status
yesimbot.chat-learning.global [--limit 20]
yesimbot.chat-learning.preview [--event global-brain|schedule|chat-learning]
yesimbot.chat-learning.sync
yesimbot.chat-learning.reset
yesimbot.chat-learning.link <from> <to> <kind> [--confidence 0-1]
yesimbot.chat-learning.unlink <from> <to> [kind]
yesimbot.chat-learning.reflect [note] --score -1|0|1
```

`kind` 支持 `quote`、`reply`、`at`、`adjacent`、`entity` 和 `*`。`unlink` 不传 kind 时默认移除两消息之间的全部关系。

`reflect` 用于人工标注 bot 的最终发言：先引用 bot 的一条已发送消息，再运行 `yesimbot.chat-learning.reflect 保持 --score=1` 或 `yesimbot.chat-learning.reflect 太长太正式 --score=-1`；`score` 支持 `-1|0|1`。人工反思会持久化到 `chat-learning-reflections.jsonl`，并优先于自动反思注入。

`global` 查看跨群全局规则库，包含高频短语、跨群回复链结构以及链上代表短语；`preview` 会读取当前频道持久化后的学习状态，并输出实际会注入模型的 `<style_examples>`、`<local_patterns>`、`<global_patterns>`、`<global_chains>` 等 prompt 块，配置 `reflectionModel` 时还会在末尾显示反思历史。预览头部会显示 `globalPatterns=选中数/全局库总数`，方便区分“没有全局数据”和“未达到 `minGlobalChannels`”。`<style_examples>` 会标注 `chain` 路径，便于审计样本来自哪条历史回复链；`<global_chains>` 会优先渲染一条真实完整短对话 `<sample>`，旧数据没有样本时再回退到 `phrases` 代表短语。合并转发中保留原始标签；回退为普通文本时会把标签转义，避免被 Koishi/Satori 当元素解析。传 `--event` 可以预览 global-brain/schedule 主动事件下的发起规律版本。

`status` 和 `preview` 的长回复在 OneBot 适配器支持时使用合并转发发送，避免长文本直接刷屏；适配器不支持时回退为普通文本。

`reset` 只清空当前频道的 `chat-learning.json`、`chat-learning-history.jsonl`、`chat-learning-feedback.jsonl` 和 `chat-learning-reflections.jsonl`，不会归档或清空 Core session。

`sync` 会忽略 `refreshIntervalMinutes` 和 `globalSyncIntervalMinutes`，立即重建本地学习、触发模型规律提炼，并同步全局历史、全局规则库与全局图链。

媒体占位符、URL、@提及、纯 hashtag 和常见 bot 状态文本不会进入 `local_patterns`；预览里的长链接和资源引用也会被压缩，降低 token 占用。

调试日志统一使用 `yesimbot.chat-learning` logger 的 debug 级别，并跟随 Core `logLevel`；Core 设为 `3` 时即可在控制台看到。日志覆盖插件启动、频道 Runtime 创建、数据重建、事件识别、prompt 注入和纠错命令。

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
