# koishi-plugin-yesimbot-chat-learning

从真实群聊中学习消息关系、回应规律与话题发起方式，并把学习结果以有界 prompt 块注入模型上下文。

该插件不修改 Core、不直接改写 bot 输出、不做主动调度。它只负责把历史群聊转换为可审计、可纠错、可跨群聚合的风格先验，并在模型生成前按 token 预算注入。

## 项目定位

- 按频道维护独立学习状态，频道之间不互相污染。
- 用消息关系图而不是简单时间相邻来判断“谁回应了谁”。
- 用模型标注 `role / intent`，把对话抽象为意图链和真实样本。
- 用链级 `style` 描述“这条链的说话风格”，而不是总结“聊了什么内容”。
- 跨群聚合只作为弱先验，本地样本始终优先。
- prompt 注入有上限，学习数据可以长期增长，但注入内容不会同步无限增长。

## 模块结构

```text
plugins/chat-learning/
├── src/
│   ├── index.ts              插件入口、AgentPlugin 生命周期、命令、reflection 注入
│   ├── collector.ts          消息历史读取、元素渲染、mention/quote 提取
│   ├── links.ts              消息关系图、置信度边、会话链构建
│   ├── chains.ts             意图链模式与链样本生成
│   ├── patterns.ts           模型意图分类、链级 style 生成、样本签名
│   ├── projector.ts          prompt 块组装、token 预算、XML 转义
│   ├── global-store.ts       跨群规则库、链聚合、相关性选择
│   ├── store.ts              频道学习状态 JSON 持久化
│   ├── history.ts            频道/全局历史 JSONL 存储
│   ├── feedback.ts           人工消息关系纠错存储
│   ├── corrections.ts        纠错应用到链接图
│   ├── reflection-store.ts   bot 发言反思 JSONL 存储
│   ├── reflection.ts         自动反思生成、反思历史注入构建
│   ├── embedding.ts          可选 embedding 语义归并
│   ├── memes.ts              梗模板提炼与过滤
│   ├── text.ts               文本清洗、占位符、@ 归一化
│   ├── forward.ts            OneBot 合并转发
│   ├── proactive.ts          主动事件识别
│   ├── types.ts              领域类型契约
│   └── ...其他支撑模块
├── tests/                    单元测试
├── README.md                 项目文档
└── package.json
```

## 核心数据流

```text
平台消息
  → chat-learning-history.jsonl
  → collectTurns()
  → segmentTurns() / buildLinks()
  → buildConversationChains()
  → classifyPatternsWithModel()
  → responsePatterns / initiationPatterns
  → buildLocalChainPatterns()
  → generateChainStyle()
  → mergeLocalPatterns()
  → global rule bank
  → prepareStep()
  → buildPromptBlock() + buildReflectionHistory()
  → 注入模型上下文
```

关键点：

1. 消息先持久化到频道独立历史，再参与重建。
2. 只有 quote/reply/entity 等有明确关系边或处于同一回复链的消息才会形成对话链。
3. 模型标注意图后，`chain` 只是数据层聚合 key，不再作为 prompt 属性重复展示。
4. prompt 展示的是“链级风格描述 + 每个意图对应的真实发言”。
5. 人工纠错和人工反思持久化，并在后续重建或注入时生效。

## 核心概念

| 概念 | 说明 |
| --- | --- |
| `MessageTurn` | 一条可学习的人类消息，包含文本、quote、mention、媒体标记。 |
| `MessageLink` | 消息之间的关系边，支持 quote/reply/at/adjacent/entity。 |
| `ConversationSegment` | 按时间间隔切分的对话片段。 |
| `ConversationChain` | 从关系图构建的按时间顺序排列的回复链。 |
| `ResponseIntent` | 回应意图：ack/agree/question/joke/roast/empathy/refuse。 |
| `InitiationIntent` | 发起意图：share/question/react/recall/opinion。 |
| `LocalChainPattern` | 本频道中某条意图链及其样本、风格。 |
| `GlobalChainPattern` | 跨群聚合后的意图链，包含真实样本、风格、频道统计。 |
| `style` | 链级说话风格描述，由模型从真实样本生成。 |
| `styleSampleId` | 生成 style 时对应的样本签名，用于判断是否需要重新生成。 |
| `semantics` | 旧版场景/内容总结字段；为兼容旧数据保留，但不再进入 prompt。 |
| `reflection` | 对 bot 最近发言的自动或人工反思，注入到提示词末尾。 |

## Prompt 注入

注入块由 `buildPromptBlock()` 组装，按 token 预算从高到低依次尝试：

```text
<chat_learning_guide>
<style_examples>
<local_patterns>
<meme_templates>
<global_patterns>
<global_chains>
<reflection_history>
```

`<global_chains>` 的示例形态：

```xml
<global_chains>
  <chain>
    <style>
      语气：直接，带反问，不绕弯。
      句式：短句；否定用反问打掉对方前提，随后补一句宏观论据。
      节奏：先否前提 → 再补论据 → 条件句收束。
      句长：每句 5-30 字。
      语言习惯：少语气词，不解释、不道歉、不复读。
    </style>
    <sample>
      <turn intent="opinion" speaker="A">这些都是手段而已，目前就是不让参与分蛋糕</turn>
      <turn intent="refuse" speaker="B">哪有什么蛋糕</turn>
      <turn intent="refuse" speaker="B">全球的蛋糕就是第三世界的资源和我们的劳动</turn>
      <turn intent="agree" speaker="A">新的工业革命没到来，产业没有升级，蛋糕做不大</turn>
    </sample>
  </chain>
</global_chains>
```

设计规则：

- `<turn intent="...">` 是发言动作标签，不是发言内容。
- `<style>` 描述历史群友怎么说，不描述聊了什么。
- `chain` 数组留在数据层，不渲染 `intents="..."` 属性。
- 旧 `semantics` 不进入 prompt，避免把内容主题当成风格规则。
- 同一说话人连续多条消息会保留为多条 `<turn>`，因为每条意图可能不同。
- 消息中的 @ 会归一化为 `@成员`，避免真实 ID/昵称进入 prompt。
- 默认忽略直接 @ 本 bot 的消息，避免把对 bot 的指令或提示词注入内容当作群友风格学习。

## 配置

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `maxExamples` | `4` | 每轮最多注入几个示例对话段。 |
| `maxMessagesPerExample` | `5` | 每个示例段最多包含的消息数。 |
| `maxHistoryAgeDays` | `30` | 学习历史的最大天数。 |
| `maxScanMessages` | `1000` | 每次构建最多扫描的消息数。 |
| `refreshIntervalMinutes` | `30` | 模型规律提炼的最小间隔分钟数。 |
| `maxPromptTokens` | `2500` | chat-learning 注入块的 token 预算。 |
| `maskNames` | `true` | 示例中把真实昵称替换为伪名。 |
| `blockedUserIds` | `[]` | 不参与学习、也不进入 few-shot 的 user id 黑名单。 |
| `blockedUserPatterns` | `[]` | 按昵称或 user id 子串过滤其他 bot。 |
| `autoBlockBotNames` | `false` | 启用常见 bot 名称自动过滤。 |
| `ignoreBotMentions` | `true` | 学习时忽略 @ 本 bot 的消息，降低提示词注入内容进入风格样本的风险。 |
| `observeAllChannels` | `false` | 在未启用 yesimbot 的频道也采集消息，用于跨群全局规律学习。 |
| `globalRulePath` | 留空 | 跨群全局规则文件路径；留空时使用 `data/yesimbot/chat-learning-global.json`。 |
| `globalSyncIntervalMinutes` | `60` | 跨群全局规律同步最小间隔分钟数。 |
| `minGlobalChannels` | `2` | 全局规律至少出现的频道数。 |
| `maxGlobalPatterns` | `8` | 每轮最多注入的全局规律数；global chains 渲染时上限为 3。 |
| `summaryModel` | 留空 | 使用 Core 注册的模型 ID；留空则使用默认 chat 模型进行意图分类和链级风格提炼。 |
| `embeddingModel` | 留空 | 可选 embedding 模型；配置后用于语义归并全局规律，留空则精确匹配。 |
| `embeddingSimilarity` | `0.92` | embedding 语义归并阈值，越高要求越相似。 |
| `maxModelThreads` | `3` | 每次模型标注最多使用几条完整对话线程。 |
| `maxModelThreadMessages` | `30` | 每条线程最多送入模型的消息数。 |
| `reflectionModel` | 留空 | 可选独立模型；用于评价 bot 最近发言并生成风格反思，留空则关闭。 |
| `maxInjectedReflections` | `3` | 每次注入提示词末尾的最近反思条数。 |
| `injectStyleAsSystem` | `false` | 将风格参考作为 system 消息注入；默认用尾部 user 消息以兼容更多 provider。 |

## 持久化

| 文件 | 作用 |
| --- | --- |
| `chat-learning-history.jsonl` | 频道原始消息历史。 |
| `chat-learning.json` | 频道学习状态快照。 |
| `chat-learning-feedback.jsonl` | 人工消息关系纠错。 |
| `chat-learning-reflections.jsonl` | 自动与人工反思记录。 |
| `chat-learning-global.json` | 跨群规则库。 |
| `chat-learning-global-history.jsonl` | 跨群原始历史，聚合成功后清空。 |

## 人工纠错与运维

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

行为说明：

- `link` / `unlink` 用于修正消息关系，纠错会持久化并在后续重建时影响链接图。
- `reflect` 用于人工标注 bot 的最终发言；人工反思优先于自动反思。
- 人工标注过的目标消息，其同目标自动反思不会再同时注入，避免给模型冲突指令。
- `sync` 会忽略刷新间隔，立即重建本地学习、提炼风格、同步全局规则。
- `reset` 只清空当前频道的 chat-learning 数据，不影响 Core session。

## 当前边界

- 本地规律按频道存储，跨群全局规则库只提供基础聚合。
- 显式链接优先；隐式链接使用置信度候选。
- `chain` 是意图序列的统计结构，不是转移概率模型。
- 当前不维护运行时“当前对话意图前缀”，也不预测下一步意图。
- 同一意图链在不同频道可能存在不同风格；链级 style 是弱提示，不是硬规则。
- 旧数据中的链级 `semantics` 会保留兼容，但不再渲染；`<pattern>` 内的 `<semantics>` 标签是短语语义说明，与旧链级字段无关。

## 开发与验证

```bash
npx tsc --noEmit -p plugins/chat-learning/tsconfig.json
npx vitest run plugins/chat-learning
yarn turbo run build --filter=koishi-plugin-yesimbot-chat-learning
```

常用单文件测试：

```bash
npx vitest run plugins/chat-learning/tests/projector.test.ts
npx vitest run plugins/chat-learning/tests/reflection.test.ts
npx vitest run plugins/chat-learning/tests/collector.test.ts
```

调试日志统一使用 `yesimbot.chat-learning` logger 的 debug 级别。Core `logLevel` 设为 `3` 时即可在控制台查看。

## Roadmap

- 按 `tone` 做风格多样化选择，避免连续注入同质化链。
- 将 `style` 细化到 intent 级，描述每个发言动作的语气。
- 在运行时维护当前对话意图前缀，按前缀选择更相关的链。
- 对旧全局链自动补齐或刷新 `style`，避免长期使用单一样本。
- 为 style 生成增加质量过滤与多样本共识。
