## Why

Core currently reconstructs a Koishi `Session` before routing, so accessor-backed facts such as `isDirect` can disappear. The same path also splits authority between Session and `Platform.Message` and makes `YesImBotService` coordinate classification, preparation, Agent lifecycle, stream consumption, and output delivery. This change establishes one canonical message contract, moves the channel lifecycle behind a deep runtime module, and gives outbound delivery a Koishi/Satori-aware owner.

## What Changes

**Canonical channel message facts**
- From: Channel type, sender, scope, and mention facts are read from a mixture of raw Session fields and reconstructed Session-shaped objects.
- To: `Platform.Message` is the routing source of truth and its channel scope includes required `channelType: "private" | "group"` data captured from the real Session.
- Reason: Routing must not depend on prototype behavior after Session reconstruction.
- Impact: Breaking persisted message contract; records without `channelType` are not supported by the new runtime.

**Channel runtime ownership**
- From: `YesImBotService.handleSession()` manually coordinates routing helpers, message preparation, Agent cache creation, FIFO submission, stream consumption, reply delivery, reset, and stop.
- To: A core-owned `ChannelRuntime` exposes `handle`, `reset`, and `stop` while hiding classification, preparation order, Agent cache, storage, joined-turn submission, stream ownership, and lifecycle cleanup.
- Reason: The channel lifecycle needs one owner and one test surface.
- Impact: Internal core architecture changes while preserving the default self-ignore, group-observe, direct-reply, mention-reply, busy-join, and reset behaviors.

**Configurable deterministic routing**
- From: Self, direct, mention, and ordinary group routing rules are hard-coded across helper functions.
- To: Self messages remain a fixed ignore rule, while direct, mention, and ordinary group scenarios map to `append` or `reply` through core configuration with current behavior as defaults.
- Reason: Configuration can vary product policy without exposing lifecycle ordering or arbitrary routing hooks.
- Impact: Adds a root runtime-routing configuration section.

**Koishi-first output delivery**
- From: The active middleware consumes Agent output and calls `session.send()` directly.
- To: A core `DeliveryService` owns ordered output, passive `Session` replies, target-based `Bot.sendMessage()` calls, normalized receipts, status events, and delivery error isolation.
- Reason: Delivery is an application lifecycle with observable partial failure, while Koishi/Satori already own platform transport and encoding.
- Impact: Adds a core delivery capability without a YesImBot platform-driver or per-platform delivery-adapter registry.

**Event boundary**
- `Platform.Event` remains publish-only. This change does not define world state, standard event effects, willingness, persistence, idempotency, or event-to-Agent routing.

## Capabilities

### New Capabilities

- `message-delivery`: Koishi/Satori-aware passive and target delivery, ordered outputs, conservative receipts, and process-local status observation.

### Modified Capabilities

- `platform-message-ingestion`: Require canonical channel type data on admitted platform messages and prohibit reconstructed Session objects as message facts.
- `core-runtime-integration`: Move the complete channel message lifecycle behind `ChannelRuntime`, define configurable deterministic routing, and route Agent output through delivery.

## Impact

- Core contracts: `Platform.Message`, `Platform.MessageRecord`, channel routing configuration, and channel runtime assembly.
- Core modules: `core/src/platform/`, `core/src/runtime/`, the slim `YesImBotService` facade, JSONL message persistence, and output rendering.
- Tests: platform draft/refine tests, message routing tests, channel concurrency/lifecycle tests, reset tests, and new delivery contract tests.
- Platform packages: no new delivery adapter requirement; existing packages continue to refine or prepare inbound semantics only.
- Dependencies: Koishi `Session`, `Bot`, and `MessageEncoder` remain the platform transport abstraction; `@yesimbot/agent-runtime` remains platform-independent.
