# Athena v4 愿景与演进原则

> 初稿日期：2026-05-04  
> 重写日期：2026-07-21  
> 状态：持续维护的愿景文档  
> 配套记录：[Athena 开发日志与决策日记](./athena-development-log.md)

## 1. 这份文档负责什么

这份文档只回答三个问题：

1. Athena 最终想成为怎样的存在。
2. 哪些产品原则和工程边界已经稳定下来。
3. 接下来值得做什么，哪些事情暂时不做。

它不是架构规范，也不代替代码、`AGENTS.md` 或 OpenSpec。实现细节变化时，应先更新代码旁的规范；只有当长期方向发生变化时，才改这里。

完整时间线、失败尝试、提交证据和个人判断放在开发日志中。这样，愿景不会被流水账淹没，历史也不会为了配合最新说法而被改写。

## 2. 我真正想解决的问题

Athena 最初看起来是一个 Koishi 聊天插件，但我想解决的从来不只是“把一条消息发给模型，再把文本发回来”。

真正困难的是群聊。

私聊通常是一条线：用户说话，智能体回答。群聊更像一个持续变化的场。多个人在交谈，话题会分叉，气氛会升温或冷却，有些话是在叫 Athena，有些话只是从她身边经过。一个自然的参与者必须知道什么时候加入、什么时候等待、什么时候保持沉默。

因此，Athena 的目标不是更快地回复，而是更合适地存在。

## 3. 稳定下来的产品愿景

### 3.1 群聊是一个场，不是一串独立请求

消息的意义来自上下文。发送者、频道、时间、引用、媒体、最近发生的事情，以及其他人的反应共同构成场景。

这条原则已经影响当前实现：消息按频道串行进入生命周期，历史按频道保存，平台元数据在模型输入前被固定下来。未来如果重新引入更高层的场景判断，也必须建立在这些稳定事实之上，而不是绕开消息管道再造一套真相。

### 3.2 不回复是一等行为

早期版本把 willingness，也就是“意愿值”，直接做进核心。这个概念仍然重要，但旧实现证明了两件事：

- 回复判断不能依赖一套难以解释的庞大内部状态机。
- 愿景中的重要概念，不等于必须立即成为核心模块。

当前实现没有内置 world state 或 willingness 系统。未来若重新实现，应优先作为可观察、可替换的插件或事件消费者，并明确输入、输出和失败方式。

### 3.3 记忆的目标是延续关系，不是囤积日志

Athena 应该记得长期偏好、共同经历和稳定的人际信息，但不需要把所有消息都升级成“记忆”。

旧版本的多级记忆、时间线和自主 MemoryAgent 过于沉重。当前版本把频道消息历史和长期记忆分开：核心保存可重放的消息记录，长期记忆由 Memos 等插件负责。这条边界应继续保持。

### 3.4 工具和技能是行动能力，不是核心特权

搜索、工作区操作、MCP、贴纸、平台消息操作和记忆服务都应通过插件进入 Agent。核心负责生命周期、工具执行边界和事件，不负责理解每一种业务能力。

用户应能够清楚知道 Athena 拥有哪些工具。工具是否存在，也可以静态影响消息格式，例如只有启用消息操作工具时才把平台消息 ID 放进模型输入。

### 3.5 人格来自稳定的提示词与行为，而不是复杂模板引擎

Athena 需要可持续的人格，但人格不应依赖难以追踪的模板变量和多层渲染器。

当前做法是固定核心系统提示词，再加载运行时 `AGENTS.md` 与 `PERSONA.md`。这比旧版 Handlebars、SOUL/TOOLS/POLICY 多文件渲染体系更朴素，也更容易审查。

### 3.6 多模态必须先变成可验证的本地事实

图片、音频、视频、文件、引用和合并转发不是普通字符串。

当前原则是：需要进入模型的二进制资源必须在首次持久化前完成受限采集，成功后变成频道本地资产，失败后永久变成 unavailable。历史重放不得重新请求平台 API。

引用和合并转发采用更克制的策略：入站消息只保存 ID 和固定摘要，需要详细内容时由显式工具读取。核心不自动递归展开，也不把平台原始结构塞进历史。

### 3.7 主动性是长期方向，不是当前承诺

未来的 Athena 可以观察事件、维护目标、主动发起行动，但主动性必须具备明确的触发、权限、预算、审计和停止条件。

在这些条件没有形成独立设计前，不把“世界状态”“自主计划”或“主动投递”写成当前能力。愿景可以向前看，文档不能把设想伪装成事实。

## 4. 2026-07 的当前基线

当前 Athena 由四类边界组成：

```text
Platform Session
  -> PlatformService（采集、refine、资源准备）
  -> ChannelRuntime（分类、FIFO、Agent、stream、reset/stop）
      -> @yesimbot/agent-runtime + AgentPlugin / tools / providers
  -> DeliveryService（reply/send、receipt、状态事件）
  -> Koishi Session / Bot
```

`YesImBotService` 只组合这些 owner，注册 middleware、reset command 和 AgentPlugin factory，再把消息、reset 与 stop 委托给 `ChannelRuntime`。它不再持有第二套 Agent cache、FIFO、stream consumer 或出站发送流程。

### 4.1 `@yesimbot/agent-runtime`

运行时是框架无关的消息与 turn 核心，负责：

- `createAgent()` 与 turn queue；
- 消息追加、发送、运行、等待、中断和停止；
- JSONL 消息存储接口；
- 有序插件钩子；
- 模型流执行、工具包装和 terminal events。

它不理解 Koishi Session、OneBot API 或平台资源下载。

### 4.2 `core/`

Koishi core 是集成层，负责：

- 模型注册和配置；
- 通过 `PlatformService` 收集、细化和准备平台消息；
- 通过 `ChannelRuntime` 管理每频道 runtime cache、FIFO、Agent lifecycle 和 stream ownership；
- 通过 `DeliveryService` 管理被动回复、目标发送、顺序与保守 receipt；
- 通过 `YesImBotService` 组合 Koishi middleware、command 和插件注册；
- prompt 文件加载；
- JSONL channel history；
- 模型输出渲染；
- reset 和资源清理。

core 应保持薄，但“薄”不等于把边界责任推给插件。消息格式、持久化格式、生命周期顺序和资源安全仍由 core 决定。

### 4.3 `platforms/*`

平台包只处理输入侧差异：

- 确定自己是否匹配 Session；
- 同步细化平台消息或事件；
- 在 core 给定预算内准备图片等资源；
- 保留必要的平台语义。

Adapter 不负责 Agent 创建、模型投影、prompt 格式或长期存储。插件侧唯一入口是 `ctx.yesimbot.platform`。

### 4.4 `plugins/*` 与 `providers/*`

插件通过 `registerAgentPlugin()` 增加工具和运行时行为。Provider 包只向模型服务注册模型实现。

这两类扩展不应穿透平台存储内部，也不应复制 core 的消息格式化逻辑。

## 5. 当前已经接受的工程决策

### 5.1 消息工作态与持久化态分离

`Platform.Message` 在准备阶段使用 Koishi `Element[]`。持久化时转成 `Platform.MessageRecord`，其中 `content` 是净化后的字面量字符串。

旧 JSONL 格式不再读取。当前分支是全新实现，不为未发布的数据结构保留兼容层。

### 5.2 Adapter 只选择一次

Session 收集阶段按确定顺序匹配 Adapter。`accepts() === false` 可以尝试下一个候选；一旦候选抛错或进入 `refine()`，不会悄悄换另一个 Adapter。

资源准备复用已选择的 Adapter，不进行第二次匹配。

### 5.3 Event 只发布，不混入消息历史

`Platform.Event` 是 typed data 加冻结内容。它没有 core receipt time，不进入 Agent 消息、不写频道 JSONL，也不进入一个全局事件仓库。

需要消费事件的能力应成为独立消费者，并自行定义持久化和幂等策略。

### 5.4 每频道 FIFO 是生命周期边界

分类、准备、Agent 解析、最终 busy 读取和首次 `append`、`send(join)` 或 `run` 提交在同一频道 FIFO 内完成。模型流消费在 FIFO 外继续，避免长 turn 阻塞后续消息。

最终 busy read 与 `send(join)` / `run` 之间没有 `await`。一个 `run()` 只有一个 stream owner；后来 join 的消息不创建第二个 consumer。`handle()` 在 FIFO 外等待自己拥有的 stream，因此原始 Session 不会在 active handle 结束后继续被后台任务持有。

Reset 进入同一 FIFO，按 interrupt、stop、消息存储清理、资产清理、runtime cache 删除的顺序执行。全局 stop 等待 owned streams，并隔离单个 Agent teardown 或 diagnostic 失败，避免一处错误跳过其他频道清理。

### 5.5 Canonical message 是路由事实的唯一来源

`Platform.Message.scope.channelType` 必须是 `private` 或 `group`。Core 在 draft 阶段从真实 Koishi Session 读取一次 directness；后续 self、mention、direct/group、channel key、context 和 storage 都只读取 canonical message。

原始 Session 只服务两个当前用例：平台准备和被动回复。Core 不展开或重建 Session，不把它传给 `agent-runtime`，也不在 `ChannelRuntime.handle()` 结束后缓存它。

Direct、group mention 和普通 group 的 `append` / `reply` 策略可以独立配置。Self-message ignore 固定存在，不开放配置。

### 5.6 出站消息由 DeliveryService 统一编排

被动回复使用原始 `Session.send()`，目标发送先按 platform/selfId 解析一个 Bot，再使用 `Bot.sendMessage()`。一个逻辑输出按 fragment 顺序提交，失败后停止后续 fragment，并返回 `sent`、`partial` 或 `failed` receipt。

Receipt 保留 Koishi 返回的全部 `string[]` message IDs，包括合法的空数组。Process-local listener 可以观察 started 和 terminal 状态，但 listener 或 diagnostic 失败不能中断 delivery。Core 不增加 per-platform delivery adapter，也不重写 Satori/Koishi encoder。

### 5.7 消息格式由 core 固定

模型看到的头部格式是：

```text
[time="..." sender="..." id="..."]
<sanitized Koishi content>
```

`time` 和 `sender` 始终存在，`id` 只在活动插件声明需要消息 ID 时存在。Adapter 不能提供自定义 prompt header 或模板。

### 5.8 二进制资源采用固定预算

首版图片规则是：

- 每条消息最多处理前四个图片节点；
- 单图最多 5 MiB；
- 每条消息累计最多 10 MiB；
- 单图超时 10 秒；
- 每条消息最多两个并发下载；
- 只接受经过字节签名验证的 JPEG、PNG、WebP、GIF；
- SVG 不作为模型图片接纳。

预算属于 core policy，不是公开可配置的 Adapter 协议。

### 5.9 公开协议宁可小，也不为未来留空壳

当前明确拒绝在平台层重新引入：

- Fact / View / Presentation 层级；
- Reader registry；
- 通用 Snapshot / Ref 资源系统；
- runtime schema registry；
- Adapter 自定义 formatter；
- 为旧格式准备的 alias、facade 和迁移 reader。

这些抽象只有在出现两个以上真实用例、且现有边界无法承载时，才值得重新讨论。

## 6. 仍然保留，但明确延后的方向

| 方向 | 当前态度 | 重新启动的条件 |
| --- | --- | --- |
| 群聊 willingness | 产品愿景保留，实现延后 | 有可解释输入、测试数据和插件边界 |
| 标准事件消费者 | 候选 Slice | 明确事件到 agent context 的路由与幂等 |
| World state | 非当前需求 | 出现独立于聊天历史的具体状态查询需求 |
| 主动行动 | 长期愿景 | 具备权限、预算、审计和停止机制 |
| 更多平台 | 可逐个平台实现 | 不扩张公共 Adapter 接口即可落地 |
| 音频与视频理解 | 延后 | 模型能力和本地资产协议均明确 |
| TTS 与语音人格 | 历史上做过，当前未恢复 | 有稳定维护者和清晰的插件边界 |
| 跨频道资源中心 | 不做 | 出现真实的跨频道去重或生命周期需求 |

## 7. 从旧版本保留下来的，不是旧架构

v3、v4 beta 和后来的 Session Runtime 都被重写过。保留下来的主要是产品经验：

- 群聊需要控制参与节奏；
- 人格需要稳定上下文；
- 工具必须可见、可约束；
- 长期记忆不能等同于聊天日志；
- Provider 和业务能力必须可替换；
- 历史重放不能依赖平台仍然在线；
- 复杂抽象一旦没有真实消费者，就会反过来支配产品。

实现被删除，不代表当时的探索没有价值。相反，正是多次失败让当前边界变得更窄。

## 8. 未来的工作顺序

1. 先维护当前 runtime、core、platform、plugin 和 provider 边界的稳定性。
2. 新平台按独立 `platforms/<name>` 包落地，不先扩展通用协议。
3. 标准事件消费者使用独立 OpenSpec change，禁止顺手恢复旧 world-state 系统。
4. 只有出现具体模型需求时，才设计音频、视频或更多媒体能力。
5. 主动性、计划和长期自治放在可审计的更高层，不侵入基本消息真相。

## 9. 如何维护这份愿景

### 应该更新的情况

- 产品长期目标改变；
- 一个延后方向正式成为当前能力；
- 核心边界发生破坏性调整；
- 某项稳定原则被实践推翻。

### 不应该更新的情况

- 普通 bug 修复；
- 单个插件新增工具；
- 文件移动、命名整理或格式修改；
- 尚未接受的头脑风暴。

### 更新规则

1. 先更新代码、测试和 OpenSpec，再更新这里。
2. 不删除历史结论来制造连续性；在开发日志中追加“被取代”记录。
3. 每个“当前能力”都应能指向代码或主规范。
4. 每个“未来方向”都要明确触发条件，避免把愿望写成路线承诺。
5. 每次重大调整后，在 [开发日志](./athena-development-log.md) 追加日期、证据和个人判断。

## 10. 一句话定义

Athena 是一个面向多人长期关系的智能体运行时：她理解自己身处怎样的场景，知道何时回应，能借助工具行动，也知道何时保持沉默。

当前工程的任务不是一次性实现这句话中的全部能力，而是保证每向前一步，都不需要再用一套更复杂的幻觉解释自己。
