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

当前 Core 把参与判断限制为每频道的 WillEngine：默认 routing 根据 direct、mention 和 group 选择 `wait | trigger`；可选 WillPlugin 通过 `agent.will()` 注册，按 priority 稳定排序。

这不是 world state，也不是一套可无限扩展的行为状态机。未来若要引入学习型或评分型判断，必须先定义可解释输入、离线样本、评估方法和独立边界。

### 3.3 记忆的目标是延续关系，不是囤积日志

Athena 应该记得长期偏好、共同经历和稳定的人际信息，但不需要把所有消息都升级成“记忆”。

旧版本的多级记忆、时间线和自主 MemoryAgent 过于沉重。当前版本把频道消息历史和长期记忆分开：核心保存可重放的消息记录，长期记忆由 Memos 等插件负责。这条边界应继续保持。

### 3.4 工具和技能是行动能力，不是核心特权

搜索、工作区操作、MCP、贴纸、平台消息操作和记忆服务都应通过插件进入 Agent。核心负责生命周期、工具执行边界和事件，不负责理解每一种业务能力。

用户应能够清楚知道 Athena 拥有哪些工具。工具是否存在，也可以静态影响消息格式，例如只有启用消息操作工具时才把平台消息 ID 放进模型输入。

### 3.5 人格来自稳定的提示词与行为，而不是复杂模板引擎

Athena 需要可持续的人格，但人格不应依赖难以追踪的模板变量和多层渲染器。

当前运行时以 Constitution、一个 persona、可选 `AGENTS.md` 和运行时上下文构造固定顺序的系统提示词。Runtime 在创建时快照 prompt、模型、工具和插件；资源变化只在 Runtime 替换后生效。

### 3.6 多模态必须先变成可验证的本地事实

图片、音频、视频、文件、引用和合并转发不是普通字符串。

当前链路把入站图片的下载与持久化交给平台 PlatformTranslator。Translator 将成功字节写入频道 Scoped AssetStore；模型调用只从本地 assets 读取受支持图片，并按当次调用预算投影。历史重放不重新请求平台 API。Core 不为 PlatformTranslator 规定统一入站下载策略，也不自动展开 forward 或 quote。

### 3.7 主动性是长期方向，不是当前承诺

未来的 Athena 可以观察事件、维护目标、主动发起行动，但主动性必须具备明确的触发、权限、预算、审计和停止条件。

在这些条件没有形成独立设计前，不把“世界状态”“自主计划”或“主动投递”写成当前能力。愿景可以向前看，文档不能把设想伪装成事实。

## 4. 2026-08 的当前基线

当前 Athena 的输入与输出由五个明确边界组成：

```text
Session
  -> Messenger（allowlist、assignee、ChannelResources、Translator、canonical record、被动回复）
  -> Runtimes（频道 Runtime 创建、替换、reset、stop）
  -> ChannelRuntime（FIFO、Agent、WillEngine、JSONL、模型输入、输出）
      -> @yesimbot/agent-runtime + AgentPlugin / tools / providers
```

Messenger 是 live Session 的唯一 owner。它在同一 handler 内完成准入、Translator
调用、入站资源持久化和被动 `Session.send()`，随后将不含 Session 的 MessageRecord
或 EventRecord 交给 Runtimes。ChannelRuntime 对一个频道按 FIFO 处理记录，并由
Messenger 作为唯一 output consumer 消费流输出。

### 4.1 `@yesimbot/agent-runtime`

运行时保持框架无关，负责：

- `createAgent()` 与 turn queue；
- 消息追加、发送、运行、等待、中断和停止；
- 消息存储接口；
- 有序插件钩子；
- 模型流执行、工具包装和 terminal events。

它不理解 Koishi Session、平台 API、频道目录或资源下载。

### 4.2 `core/`

Koishi core 负责模型注册、Messenger admission、ChannelScope、Channel/Conversation/
ChannelResources、Runtimes、ChannelRuntime、Core prompt 和回复投递。公开
`ctx.yesimbot` 只提供 model、messenger、agent、resource 和 stop。

Core 不提供 public channel identity、storage namespace registration、reload、
DeliveryService 或 PlatformService。稳定模型、图片预算、prompt、tools 和插件在
Runtime 创建时形成快照。

### 4.3 `core/src/platforms/`

内置平台通过 Translator 处理输入侧差异。Translator 接收 live Session 和
ChannelResources，直接返回最终 MessageRecord、EventRecord 或 `null`。无精确或显式
通配 Translator 时，message-created 元素使用内置默认透传；媒体持久化与自定义事件
仍需平台 Translator。Translator 失败没有 Satori fallback。OneBot 只持久化可接受的
图片和文本文件，保留其他 Element 的结构。

### 4.4 `plugins/*` 与 `providers/*`

可选插件以具名 AgentPlugin 对象通过 `agent.use()` 增加工具和运行时行为，以
WillPlugin 对象通过 `agent.will()` 增加被动参与策略；受信任插件通过
`resource.get(scope)` 获取稳定 ChannelResources 并选择自己的子目录。Provider
包只注册模型实现。插件不持有 Gateway/ Messenger 的 Session，也不复制 Core 的
模型输入或消息格式协议。

## 5. 当前已经接受的工程决策

### 5.1 Messenger 组装唯一 ingress 事实

Translator 返回最终 Message/Event record；Messenger 从 live Session 和 ChannelScope
推导 RecordBase，并把事件通过 `assembleEvent` 构造。Session 在 Messenger handler
外不再存在，JSONL 读回只逐行 `JSON.parse`，跳过 JSON 语法损坏行而不做语义验证。

### 5.2 频道上下文保持原始且可读

公开 `ChannelScope` 只含 discriminated `shared { platform, channelId }` 或 `direct
{ platform, selfId, channelId }`；这些 tuple 和 Runtime map key 保持私有。可读
`shared-*` / `direct-*` 根目录以 versionless `channel.json` 为权威，插件通过
`resource.get(scope)` 获得稳定 `ChannelResources` 后管理子目录。

### 5.3 Runtime 生命周期优先于热更新

Runtimes 为每个持久化频道维护一个 Runtime。shared 频道的当前 Bot 变化时，Core
停止旧 Runtime、删除缓存、创建新 Runtime 并处理当前记录。Core 不提供 reload；
模型、prompt、tools 和插件的稳定变化在正常替换后生效。每个 ChannelRuntime 独占
FIFO、Agent、WillEngine、JSONL、ChannelResources 和 output ownership。

### 5.4 资产持久化与模型投影分离

AssetStore 只存取频道范围内的字节，以前 32 位小写 SHA-256 hex 标识内容。Translator
决定入站下载和持久化；模型调用按当前调用预算读取本地图片。历史重放不请求平台 API。
模型 capability 只由 `models.json` 声明。

### 5.5 交付仍属于产生输出的频道

Messenger 用产生输入的 Session 被动发送。主动 `messenger.post()` 使用匹配当前 Bot
的 `sendMessage()`。输出失败经同频道 `delivery.failed` 回到产生输出的 Runtime，后续
输出继续；失败不重新调用 `post()`。

### 5.6 Prompt、回复与公共 API 保持小而固定

Core Constitution、persona、可选 agents 和 runtime context 按固定顺序组成系统提示词。
Reply 直接传递标准 Koishi 元素，`<message>` 负责平台原生分段，`<text>` 保护逐字
内容，`inner_thought` 是唯一 Core 私有元素。公共 facade 不为未来的 identity、delivery、
reload、storage registry 或 WillEngine factory 预留入口。

### 5.7 延后方向保持显式边界

World state、主动行为、学习型 WillEngine、跨频道资源中心和额外媒体类型都不是当前 Core 需求。它们必须在出现具体消费者后以独立设计讨论，不能借插件或配置名提前进入公共协议。

## 6. 仍然保留，但明确延后的方向

| 方向             | 当前态度                                                | 重新启动的条件                        |
| ---------------- | ------------------------------------------------------- | ------------------------------------- |
| 群聊 willingness | 基础 routing/willingness 已实现；学习型或评分型版本延后 | 有可解释输入、离线样本和评估方法      |
| 标准事件消费者   | 候选 Slice                                              | 明确事件到 agent context 的路由与幂等 |
| World state      | 非当前需求                                              | 出现独立于聊天历史的具体状态查询需求  |
| 主动行动         | 长期愿景                                                | 具备权限、预算、审计和停止机制        |
| 更多平台         | 可逐个平台实现                                          | 不扩张公共 Adapter 接口即可落地       |
| 音频与视频理解   | 延后                                                    | 模型能力和本地资产协议均明确          |
| TTS 与语音人格   | 历史上做过，当前未恢复                                  | 有稳定维护者和清晰的插件边界          |
| 跨频道资源中心   | 不做                                                    | 出现真实的跨频道去重或生命周期需求    |

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

1. 先维护 runtime、Gateway、PlatformTranslator、plugin 和 provider 边界的稳定性。
2. 新平台通过一个 PlatformTranslator 落地，在 Core 内置或可选包之间按当前真实集成需求选择，不先扩张公共协议。
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
