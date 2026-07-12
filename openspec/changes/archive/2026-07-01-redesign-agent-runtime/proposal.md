## Why

`packages/agent` 已经验证了基于 `ai-sdk` 的 agent loop、消息转换和工具调用方向，但 `AgentSession`、`HookRunner`、`SessionManager`、compact、retry 和工具状态逐渐耦合在一起。现在需要在新目录设计一个更小的 agent-runtime，让插件、storage、turn 生命周期和 session 能力有清晰边界，同时保留 Athena 需要的“记录消息但不触发响应”能力。

## What Changes

**Runtime Package**
- From: 在现有 `packages/agent` 内继续演进，容易受历史职责和 core 兼容性牵制。
- To: 新建 agent-runtime 包设计，作为未来 runtime 的目标形态。
- Reason: 降低迁移负担，允许重新收敛 API、类型和插件边界。
- Impact: 新 API 具备 breaking-change 空间，但本 change 不要求替换现有调用方。

**Extension Model**
- From: 公开 `HookRunner` 风格的事件名注册和分发。
- To: 使用稳定 `AgentPlugin` 外壳、`hooks?: Partial<AgentPluginHooks>`、typed channel 和 declaration merging。
- Reason: 保持类型安全和可演化性，避免 hook runner 与 plugin 两套扩展机制并存。
- Impact: 新插件需要按新接口编写；旧 hook 不在本 change 中迁移。

**Persistence and Session Boundary**
- From: 固定 `SessionEntry` union 承载 message、custom、compact、model change 等多种语义。
- To: 使用最小 `AgentStorage` 和 `AgentEntry + AgentCustomEntry`；session manager、compact 等作为插件或适配器。
- Reason: storage 只负责 append/read/clear，插件拥有自身数据语义。
- Impact: 新 storage/session 模型与旧 JSONL session 不直接兼容。

**Turn Lifecycle**
- From: `prompt/steer/followUp` 和 active run 状态混合。
- To: `append/send/run/waitTurn`，所有 turn 事件和消息通过 `turnId` 关联。
- Reason: 支持异步 stream、fire-and-forget、严格 busy 策略和稳定结算结果。
- Impact: 调用模型与只追加消息的行为边界变清晰。

## Capabilities

### New Capabilities

- `agent-runtime-core`: Defines the new ai-sdk-based runtime API, message model, turn lifecycle, queue semantics, model/system prompt resources, and tool execution boundary.
- `agent-plugin-system`: Defines typed plugins, hook composition, channels, declaration merging, plugin lifecycle, and plugin error policies.
- `agent-storage-session`: Defines append-only entries, storage contract, append pipeline, session adapter boundary, and compact-as-plugin expectations.

### Modified Capabilities

None.

## Impact

- Affects future code under a new runtime package, expected as `packages/agent-runtime`.
- Keeps `ai-sdk` as the LLM abstraction and does not introduce an `xsai` runner dependency.
- Does not modify current `core` integration or require compatibility with current `packages/agent` in this planning change.
- Creates a spec baseline for later implementation and migration planning.
