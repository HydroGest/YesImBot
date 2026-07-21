# Athena 开发日志与决策日记

> 覆盖时间：2025-07 至今  
> 建档日期：2026-07-21  
> 状态：追加维护  
> 稳定愿景：[Athena v4 愿景与演进原则](./athena-v4-vision-and-evolution-notes.md)

## 1. 为什么要写这份日志

Athena 已经重写过不止一次。

每次重写都很容易产生一种错觉：新目录好像从来如此，旧架构只是“历史包袱”，当时的动机已经不重要。当前 `dev` 分支又经过了压缩，单看主线提交无法恢复全部过程。如果只看今天的代码，就会看不见为什么 willingness 曾经那么重要，为什么又被删掉；为什么曾经做了完整的 Session Runtime，最后却抽出了更小的 `agent-runtime`；为什么平台系统先走向 Reader、View 和 Snapshot，随后又把这些抽象全部撤回。

这份日志用于保存影响产品方向和系统边界的转折。

它不是发布说明、任务流水或对过去代码的辩护。我要记录的是：哪个长期问题促成了变化，为什么接受或放弃某项设计，这项变化如何影响后续演进。普通修复和机械活动由 CHANGELOG、commit、PR 或 OpenSpec artifacts 保存。

## 2. 证据标记

当前分支不能单独承担历史证据。后续记录使用以下标记：

| 标记 | 含义 | 例子 | 可信度 |
| --- | --- | --- | --- |
| `[C]` | commit、tag 或远程分支 | `6e3f647`、`v4.0.0-beta.5` | 最高，但 squash 可能隐藏中间过程 |
| `[S]` | 旧源码或文档备份 | `references/YesImBot-v3/` | 高，能证明某时点的实现形态 |
| `[D]` | OpenSpec、retrospective、当前会话中明确接受的决定 | archived change、主规范 | 高，适合解释意图和约束 |
| `[R]` | 事后回忆或解释 | “当时已经厌倦维护 fat core” | 需要与其他证据交叉验证 |

判断性语句至少应附一个 `[C]`、`[S]` 或 `[D]`。无法验证的记忆可以保留，但必须标成 `[R]`，不能写成既定事实。

## 3. 完整时间线

### 2025-07-04：v3 beta.1，第一次把“意愿”变成代码

证据：`v3.0.0-beta.1`、`ca0151b` `[C]`；`references/YesImBot-v3/` `[S]`。

v3 的核心问题已经不是“模型会不会回答”，而是“在群聊里应该不应该回答”。最早的 willingness 实现很直接：把消息、频道和状态转成一个分数，再决定是否参与。

这个方向来自真实体验。一个总在抢话的机器人很快会令人厌烦；一个永远等待点名的机器人又只是命令行。Athena 必须处于两者之间。

第一次实现并不成熟，但产品偏好从此稳定下来：沉默不是错误，参与节奏本身就是人格的一部分。

### 2025-07-07：删掉旧 willingness，承认第一次没做对

证据：`07e3ff7` `[C]`。

旧意愿计算和对话流分析被整体移除，准备重新设计。这个决定比继续修补更重要。它说明 willingness 不是一个加几条规则就能稳定的评分器，尤其不能让不透明的模型判断和手写启发式互相覆盖。

这里形成了第一条长期经验：重要概念可以保留，失败实现应该直接删除。

### 2025-07-11：意愿值从“清零”改成“递减”

证据：`8c31069`、`a2355ca`，tag `v3.0.0-beta.2` `[C]`。

新的 willingness manager 落地后，意愿值不再在一次回复后清零，而是逐渐衰减。这个修改看似只是算法细节，实际反映了对群聊节奏的新理解：一次参与不会让上下文瞬间失效，角色的兴趣应该有惯性。

后来的实现不再保留这套类和公式，但“行为需要时间连续性”被保留下来，最终体现在每频道状态、FIFO 和连续消息处理上。

### 2025-07-12 至 07-17：记忆、世界状态和提示词开始膨胀

证据：`v3.0.0-beta.3`、`4e9b9b5`、`e0396e7`、`d1cf9d5`、`v3.0.0-beta.4` `[C]`；v3 service 目录 `[S]`。

这一阶段完成了多级记忆、归档、防抖、图片缓存、Token 估算和提示词服务重构。WorldState 被改成 Horizon，内部使用 Percept、ChatMode 和事件管理器描述环境。

当时的想法很诱人：只要把世界建模得足够完整，Athena 就能自然理解场景。但实现逐渐证明，场景模型本身会成为第二个产品。L1/L2/L3、实体状态、摘要、归档、调度器都需要独立维护，而群聊中的收益并没有同比增长。

这里第一次出现后来反复遇到的问题：为了接近“赛博灵魂”，过早搭建了一个完整世界。

### 2025-07 至 09：v3 功能扩张，fat core 达到极限

证据：`references/YesImBot-core/`、`references/YesImBot-v3-dev/` `[S]`；2025-09 commits 和 `koishi-plugin-yesimbot@3.0.2/3.0.3` tags `[C]`。

v3 逐步加入 daily planner、贴纸、代码执行、视觉工具、MCP、TTS、多语言和情感控制。Agent、Horizon、MemoryAgent、Plugin、Role、Skill、Arousal、Prompt、Formatter、ImageCache、Hook、Model 等服务都聚集在 core。

这段时间验证了许多产品偏好：

- Athena 的价值来自工具和外部能力，而不只是语言模型。
- Persona 和提示词文件比硬编码角色更可维护。
- 语音、图像和贴纸能显著增加存在感。
- Provider 必须可替换，不能写死在核心。

代价同样明显。核心循环超过千行，服务互相知道太多，任何新能力都要穿过同一个中心。LoggerService、WebUI、配置迁移器、JavaScript executor 和多级记忆先后成为维护负担。

### 2025-09-16：删除 LoggerService

证据：`01c05bf` `[C]`。

独立 LoggerService 最终被 Koishi 自带 logger 取代。这是一个很小但持续影响后续设计的决定：框架已经提供的基础设施，不再包装一层来制造“自己的架构”。

后来对 PlatformService、ModelService 和 runtime 的收敛都在重复这条经验。

### 2026-03-19：v4 beta 连续发布，第一次 v4 重构成形

证据：`v4.0.0-beta.1` 至 `v4.0.0-beta.5` `[C]`；`references/YesImBot-4.0.0-beta.2/` `[S]`。

第一次 v4 尝试把 v3 的经验整理成十一类 Koishi Service：Agent、Horizon、Trait、Skill、Role、Prompt、Formatter、ImageCache、Model、Plugin 和 Shared。

它比 v3 更整齐，也更有野心。Willingness、trait、skill、role 和 horizon 构成了一套人格化聊天智能体词汇。Provider 开始独立，prompt 有正式分段，Tool 和 Action 被区分。

问题在于，这套结构仍然围绕一个固定心智：收到聊天消息，分析场景，计算是否回复，进入 think-act loop。模块虽然拆开了，产品假设却被复制进每个模块。

我当时想通过“职责清晰”解决复杂度，后来才意识到，错误的抽象边界即使命名很好，也只是把耦合分散到更多目录。

### 2026-04：第二次 v4 尝试，转向 Session Runtime

证据：`references/YesImBot-4.0.0-dev-d451689/` 的 `.planning/`、`VISION.md`、`PROJECT.md`、`RETROSPECTIVE.md` `[S]`。

第二次尝试明确反对旧的 ChatBot 心智，目标转向 event-driven、activation-gated、step-first 和 delivery-oriented。

十一项服务被压缩为 ModelService、PluginService 和 AgentSessionService。新的中心词汇变成 AthenaEvent、Activation、EventBatch、SessionRuntime、SessionManager、CoordinationScheduler 和 StepTranscriptWriter。消息开始使用 JSONL 持久化，插件作者有了独立 plugin-sdk，模型执行更接近 AI SDK 的 step 模型。

这是一次必要的破坏。它留下了几个后来继续使用的方向：

- 消息优先的持久化；
- per-session 或 per-channel 运行时；
- Provider 外部注册；
- 插件边界；
- 失败也应成为可记录的状态。

它也带来了新的过度设计。SessionRuntime 重新变成上帝对象，Activation 和 EventBatch 需要一整套新语义，Coordination 与 Delivery 迟迟无法落地。对 coding agent 架构的借鉴并不能直接解决 IM 群聊问题。

### 2026-04-19：废除 v1.1，承认路线本身需要重做

证据：dev-d451689 的 `.planning/MILESTONES.md` 和 `ROADMAP.md` `[S]`。

原定的 Runtime Debt Paydown 里程碑在正式执行前被废除，原因不是某个 bug，而是继续维护会把旧的 turn/chatbot 假设固化得更深。

这个节点改变了我看待计划的方式。计划不是必须完成的承诺；如果前提错了，按计划高质量地完成只会让回头更昂贵。

### 2026-05-04：写下 Athena v4 初始愿景

证据：本目录原始日期文档 `[D]`。

这一天的核心判断是：“群聊是场，不是线程。”

文档把长期方向写得很远：动态意愿、世界状态、长期记忆、主动行动、技能组合、多模态、语音和社交关系。它准确表达了想做的产品，却把部分历史实现和未来目标混在一起。

后来重写愿景文档，不是要收回这些期待，而是要把三个层次分开：稳定产品原则、当前工程事实、尚未接受的设想。

### 2026-07-08：第三次重写，提取 `@yesimbot/agent-runtime`

证据：`6e3f647`、`3636f7a`、`7fbc9fb` `[C]`。

这次没有继续在 core 内替换名词，而是把运行时提成框架无关包。`createAgent()`、turn queue、message storage、plugin hooks、tools 和 streamed model execution 成为独立核心；Koishi core 退回集成层。

这是当前架构最重要的断裂点。

前两次 v4 都试图在 Koishi core 中解释“Agent 是什么”。第三次则让 core 只回答“Koishi 消息如何进入 Agent”。这个边界让平台、插件、Provider 和运行时第一次可以独立演化。

### 2026-07-08：能力按包分离

证据：`c922dfe`、`77e3571`、`95e4c9c`、`cb5faf7` `[C]`。

Memos、tool observer、workspace sandbox 和 OneBot utilities 分别成为插件。长期记忆不再是 core 的内部器官，平台操作也不再混在通用运行时里。

这一阶段形成了今天仍然坚持的偏好：可选能力必须是可卸载的包；核心不通过“以后也许会用”来占有接口。

### 2026-07-10 至 07-13：OpenSpec 和运行时语义开始约束重构

证据：`026b916`、`5a3811b`、`870b386` `[C]`。

`waitTurn` 被替换为更清晰的 idle wait，OpenSpec 开始记录破坏性调整。项目从“代码先走，文档追赶”转向先明确边界和场景，再实现 vertical slice。

这个过程并不总是顺利。规格同样会过度设计，也可能在代码实践后被推翻。但它让错误假设有了可以被指出和修正的位置。

### 2026-07-15 至 07-18：平台适配器第一次设计，抽象再次膨胀

证据：`design-platform-adapter-system` 的 brainstorm、design、ROADMAP 和 Slice 01 artifacts `[D]`；`ee7bf14`、`7d1cc8a` `[C]`。

平台设计最初包含 Fact、MessageView、EventView、Reader、Snapshot、Ref、schema registry、模板和资源中心。它试图一次解决消息、事件、资源、模型表示和未来平台扩展。

Slice 01 能够工作，但接口太宽，多个概念没有第二个消费者。平台层开始拥有本应属于 core 的 formatter 和投影职责。

这个阶段再次证明：一个抽象能够解释未来，并不代表它值得进入当前公共 API。

### 2026-07-20：简化平台模型，重新确定消息真相

证据：`9082ca8` 至 `e6d7322`、`0c7a115`、`bc25436` `[C]`；归档 change `2026-07-20-simplify-platform-adapter-model` `[D]`。

平台系统经历了连续收敛：

1. `Platform.Message` 改为纯数据加 Koishi `Element[]`。
2. Event 改为 publish-only，不进入 Agent 历史。
3. 元素净化和模型投影回到 core。
4. 图片通过 `ImagePrepareSink` 在持久化前冻结。
5. 每频道生命周期改为 FIFO，busy 状态只在最终提交前读取。
6. OneBot 图片准备、reaction event 和 forward 工具形成明确边界。
7. Reader、View、Fact、模板和公共 AssetStore 被移除。

最终确定的消息路径是：

```text
Session
  -> 单次 Adapter 选择与同步 refine
  -> 每频道 FIFO 分类
  -> 受限资源准备
  -> Platform.MessageRecord 持久化
  -> 本地递归模型投影
  -> Agent append / send(join) / run
```

这次重构还明确拒绝旧数据兼容。当前分支是全新实现，未发布的历史 JSONL 不足以成为长期负担。

旧 `design-platform-adapter-system` 没有立即继续 Slice 02。它必须先按新基线重写：事件消费者、新平台和模型媒体能力应成为独立 change，不能恢复 Reader/View/Snapshot 或把 world state 当成既定需求。

### 2026-07-21：重设计 core 消息运行时，明确四个 owner

证据：`f1a607d` `[C]`；`core-runtime-integration`、`message-delivery` 和 `platform-message-ingestion` 主规范 `[D]`。

平台模型收敛后，core 仍把分类、FIFO、Agent cache、stream、reset、stop 和输出编排集中在 `YesImBotService`。Session 和 `Platform.Message` 同时参与路由，频道生命周期与 Koishi composition 也没有清晰 owner。

新的边界把 `channelType` 纳入 `Platform.Message.scope` 和持久化 record。Core 只在 draft 阶段从真实 Session 读取一次 directness，后续 self、mention、direct/group 和 channel key 全部从 canonical message 推导。原始 Session 只作为平台准备和被动回复的操作依赖，不能参与路由、持久化、Agent context 或跨 `handle()` 缓存。

Core 的消息路径变成四个明确 owner：

```text
PlatformService
  -> ChannelRuntime（分类、FIFO、Agent、stream、reset/stop）
  -> DeliveryService（reply/send、顺序、receipt、状态事件）
  -> Koishi Session / Bot
```

`YesImBotService` 只负责 Koishi middleware、reset command、AgentPlugin factory 和 delegation。`ChannelRuntime.handle/reset/stop` 隐藏 Agent cache、JSONL storage、busy join、stream owner 和 teardown 顺序；`DeliveryService` 复用 `Session.send()` 与 `Bot.sendMessage()`，保留包括空数组在内的 `string[]` message IDs，并以 `sent`、`partial`、`failed` 表达保守结果。

## 4. 决策索引

### 当前有效

| ID | 决策 | 状态与理由 |
| --- | --- | --- |
| P-01 | 群聊按“场”理解，而不是独立请求 | 产品原则，持续有效 |
| P-02 | 不回复是一等行为 | 产品原则；当前尚无内置 willingness 模块 |
| P-03 | `@yesimbot/agent-runtime` 保持框架无关 | 当前核心边界 |
| P-04 | Koishi core 是集成层，不拥有全部业务能力 | 当前核心边界 |
| P-05 | 可选能力进入 `plugins/*`，模型进入 `providers/*` | 已实施 |
| P-06 | 平台输入进入 `platforms/*` | 已实施 |
| P-07 | 频道消息使用 JSONL，长期记忆由插件负责 | 已实施 |
| P-08 | Adapter 只选择一次；异常不 fallback | 已实施 |
| P-09 | `Platform.Message` 与 `MessageRecord` 分离 | 已实施 |
| P-10 | Event publish-only，不进入 Agent 历史 | 已实施 |
| P-11 | 资源在首次持久化前冻结，历史投影不得请求平台 | 已实施 |
| P-12 | Forward 和 quote 不自动展开 | 已实施 |
| P-13 | 每频道 FIFO 管理分类、准备和首次提交 | 已实施 |
| P-14 | 模型流消费在 FIFO 外 | 已实施 |
| P-15 | 消息 formatter 由 core 固定 | 已实施 |
| P-16 | 插件侧唯一平台入口是 `ctx.yesimbot.platform` | 已实施 |
| P-17 | 未发布旧格式不提供兼容层 | 当前分支明确偏好 |
| P-18 | Prompt 使用固定 core prompt 加 `AGENTS.md`、`PERSONA.md` | 已实施 |
| P-19 | 公共 API 只为现有用例服务 | KISS / YAGNI 原则 |
| P-21 | `Platform.Message` 是路由事实的唯一来源 | Session 只保留为准备和被动回复的操作依赖 |
| P-22 | `ChannelRuntime` 独占频道 Agent 生命周期 | `YesImBotService` 只做 Koishi composition 与 delegation |
| P-23 | `DeliveryService` 独占出站顺序、receipt 和状态观察 | 复用 Koishi Session/Bot，不增加平台 delivery adapter |

### 明确延后

| ID | 方向 | 启动条件 |
| --- | --- | --- |
| D-01 | 新 willingness 实现 | 有可解释输入、离线样本和插件 seam |
| D-02 | 标准事件消费者 | 明确路由、持久化和幂等 |
| D-03 | World state | 出现聊天历史无法回答的具体状态需求 |
| D-04 | 主动计划与投递 | 权限、预算、审计、停止机制齐备 |
| D-05 | 音频和视频模型输入 | Provider 能力与资产协议明确 |
| D-06 | TTS 和语音人格 | 有稳定维护者与独立插件边界 |
| D-07 | 跨频道资源中心 | 出现真实跨频道复用需求 |

### 已否决或退役

| ID | 旧方向 | 原因 |
| --- | --- | --- |
| R-01 | v3 fat mono-core | 中心循环和服务耦合无法持续扩展 |
| R-02 | L1/L2/L3 多级记忆作为 core 基础设施 | 成本高，收益不稳定 |
| R-03 | 独立 LoggerService | Koishi 已提供能力 |
| R-04 | Handlebars prompt 变量体系 | 难以审查，运行时纯文本更直接 |
| R-05 | v4 beta 十一服务人格架构 | 拆目录没有消除聊天机器人心智耦合 |
| R-06 | SessionRuntime / Activation / EventBatch 作为中心模型 | 复杂度高，Coordination/Delivery 未闭合 |
| R-07 | 公共 plugin-sdk 装饰器体系 | 当前有更小的 AgentPlugin factory seam |
| R-08 | 平台 Fact / View / Reader / Snapshot / template 系统 | 没有足够消费者，职责侵入 core |
| R-09 | 自动递归展开 forward/quote | 不稳定、昂贵且污染历史 |
| R-10 | 旧 JSONL 与旧平台消息兼容 | 当前是全新实现，没有现实消费者 |

## 5. 明确表达过的偏好

### 产品偏好

- Athena 应像群聊参与者，而不是客服机器人。
- 回复节奏、沉默和延迟都是人格的一部分。
- 长期记忆要服务关系延续，不能把所有日志都叫记忆。
- 多模态和语音值得做，但不能为了愿景污染核心边界。
- 平台细节应被保留为事实，而不是提前渲染成 prompt 文案。

### 工程偏好

- 破坏性重写可以接受，未发布数据不构成兼容义务。
- KISS、YAGNI、DRY、SOLID 用于减少边界，不用于增加模式名。
- 只有一个权威状态源，例如 busy 状态、消息内容和 MIME 类型。
- Core policy 不应伪装成 Adapter 配置。
- 先写失败回归，再做最小修复。
- 跨包协议变更必须检查消费者和 fixture。
- 不为了通过检查修改无关文件或做样式 churn。

## 6. 反复出现的教训

### 6.1 产品概念不等于核心模块

Willingness、world state、memory 和 proactivity 都是合理概念，但只有在输入、输出、消费者和失败方式明确时，才应该进入实现。

### 6.2 不要把未来可能性预先编码进公共 API

Reader、View、Snapshot 和 schema registry 都曾经能解释未来，却没有足够当前用例。公共 API 一旦发布，就会把猜测变成维护义务。

### 6.3 参照外部架构时，先确认问题是否相同

Coding agent 的 session、step 和 delivery seam 很有启发，但 IM 群聊的多参与者、沉默和平台语义不同。借用机制可以，照搬中心模型会产生翻译成本。

### 6.4 重写不是失败，重复同一种重写才是

v3、v4 beta、Session Runtime 和当前 agent-runtime 都有删除前一版的部分。真正需要警惕的是，每次都重新造一个更大的中心对象。当前版本通过更小的 runtime 和明确包边界尝试打断这个循环。

### 6.5 规格也必须接受代码反馈

OpenSpec 能防止实现漂移，但设计文档不是权威到不可推翻。平台第一版规格在实现后暴露过度抽象，当前规范因此收窄了公开协议和 owner 边界。

## 7. 尚未回答的问题

- Willingness 应基于可解释规则、轻量模型，还是二者组合？
- Event consumer 如何把 guild/account 事实路由到具体 Agent context？
- 长期记忆插件之间是否需要统一最小协议？
- 主动行为如何声明权限、预算和停止条件？
- 音频、视频和 TTS 应共享多少资产基础设施？
- 多平台身份和跨频道关系是否值得成为独立领域模型？

这些问题不会因为写在愿景里就自动成为 roadmap。启动前应建立独立 OpenSpec change，并写明当前消费者和退出条件。

## 8. 如何维护这份日志

### 8.1 追加，不重写历史

新的重大变化按日期追加。旧判断被推翻时，在旧条目旁保留原意，再新增“取代”条目。除非事实证据错误，不为了让故事更顺而删除尴尬阶段。

追加原则只保护产品判断和系统演进。误写进日志的执行流水、普通修复和机械活动应删除或移到对应载体，不能因为“已经记录”而永久保留。

### 8.2 每次重大变更记录五件事

1. 日期和证据。
2. 哪个产品判断、系统边界或长期方向发生了变化。
3. 接受了什么。
4. 放弃或取代了什么。
5. 这项变化如何影响后续演进。

### 8.3 何时算重大变化

- 新的 runtime、消息真相或持久化模型；
- 公共 API 的破坏性调整；
- 产品方向正式接受、延后或否决；
- 改变系统架构、数据完整性或安全边界认知的重大专项 bug 修复；
- 新版本备份或历史证据被发现，足以纠正现有叙述。

以下内容不进入开发日志：

- 普通 bug 修复、review finding 和测试补强；
- task/Phase 进度、代理调度、工具故障和人工例外；
- build、type check、format、validation 和测试数量；
- spec sync、commit、PR、archive 和发布操作；
- 依赖升级、文件移动和格式变更。

这些内容分别留在 commit/PR、CHANGELOG、OpenSpec artifacts 或 archived retrospective 中。

### 8.4 更新决策索引

每个重大条目结束后检查决策索引：

- 新决定分配新 ID；
- 被取代的决定移到“已否决或退役”，不复用 ID；
- 延后事项必须写启动条件；
- 当前有效决定必须能指向代码、主规范或归档 change。

### 8.5 与其他文档的分工

| 文档 | 负责内容 |
| --- | --- |
| 本日志 | 产品判断、系统演进、长期偏好及其证据 |
| 愿景文档 | 稳定产品方向和当前边界 |
| `AGENTS.md` | 当前仓库事实与工作规则 |
| `CHANGELOG.md` | 面向版本的功能变化和普通 bug 修复 |
| `openspec/specs/` | 当前规范要求 |
| OpenSpec change / retrospective | 单次变更的任务、验证、review、同步和归档记录 |
| commit / PR | 具体实现、机械操作和低层证据 |

### 8.6 取证顺序

当前分支经过重写或 squash 时，按以下顺序恢复历史：

1. Git tags、临时分支和可达 commit；
2. `references/YesImBot-*` 与 `references/#legacy`；
3. 旧 `.planning/`、OpenSpec 和 retrospective；
4. 最后才使用未验证回忆。

如果证据冲突，正文保留冲突，不擅自选择更好看的版本。

## 9. 给未来维护者的话

不要把这份日志当成一条必然进步的路线。

Athena 的历史更像多次靠近同一个问题：如何让一个智能体长期存在于多人环境中，又不被自己的架构拖住。旧版本经常走得太远，当前版本也一定会暴露新的局限。

维护这份文档的价值，不是证明每次决定都正确，而是让下一次重构知道自己正在重复什么，也知道哪些产品偏好值得跨越实现继续保留。
