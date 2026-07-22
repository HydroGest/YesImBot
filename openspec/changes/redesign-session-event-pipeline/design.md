## Context

Athena receives platform activity through Koishi Session objects and persists conversation history through `@yesimbot/agent-runtime`. Koishi and Satori already define platform adapters, Session dispatch, Event resources, message elements, bot identity, and outbound send operations. Athena needs a smaller seam that handles incomplete or implementation-specific Session data without creating a second platform framework.

The current implementation spreads one lifecycle across three modules. `PlatformService` owns adapter selection, Session weak-map state, refinement, preparation, event listeners, Agent projection, and assets. `ChannelRuntime` owns every channel through an internal runtime map while also classifying messages, creating Agents, consuming streams, and invoking delivery. `DeliveryService` wraps Koishi send methods but does not feed passive failures back into channel history.

This design treats Session as an edge-only operational object. It normalizes accepted activity into Satori-shaped runtime events, stores events as Agent custom messages, evaluates a per-channel Will after persistence, and returns complete assistant messages to the Session edge for immediate platform delivery.

The change is intentionally breaking. Athena is still establishing its core architecture, and compatibility layers would preserve the same hidden contracts the redesign removes.

## Goals / Non-Goals

**Goals:**

- Keep Koishi Session access, resolver selection, Satori fallback, remote resource freezing, and passive `Session.send()` inside one Session edge module.
- Represent messages and admitted non-message events with one extensible Satori-shaped runtime event model.
- Separate structured event data from frozen model-facing content.
- Persist every resolved channel event before Will evaluation.
- Give each channel one runtime instance, one FIFO, one Agent, one history, one asset scope, and one Will instance.
- Replace `append | reply` as a permanent model with a replaceable `wait | trigger` Will interface.
- Send each complete assistant message as soon as it becomes available without exposing token or Agent-internal streams to Gateway.
- Persist passive platform send failures as channel events visible to later model context.
- Use Koishi's typed event system for committed-event and Will-decision observation.
- Keep the public facade small and aligned with real variation points.

**Non-Goals:**

- Implement a full attention engine, reply-necessity model, or global Will scheduler.
- Add a global EventStore, world state, or cross-channel event dispatcher.
- Handle channel-less guild or account events in the first version.
- Add a user-configurable rendering template language.
- Add platform-specific outbound adapters or replace Koishi send APIs.
- Add token-level platform streaming or automatic delivery retry.
- Preserve old platform APIs, delivery APIs, or JSONL records.

## Decisions

### D1: Keep Session inside `Gateway`

- **Choice:** `Gateway` registers the message middleware and non-message `internal/session` hook, owns SessionResolver registration and selection, performs fallback conversion and resource freezing, calls RuntimeManager with a Session-free EventRecord, consumes channel outputs, and performs passive Session sends.
- **Rationale:** Resolver behavior, Session lifetime, and passive reply semantics all depend on Koishi. Keeping them together creates one deep edge module and prevents Session from leaking into channel state or persistence.
- **Alternatives considered:** Passing Session into RuntimeManager was rejected because it widens the domain interface and makes later retention easy. A `ReplyPort` closure was rejected because it still strongly retains Session and can outlive the Koishi handle when queued. Keeping Session logic in the facade without a Gateway was rejected because resolver, resource, and delivery complexity would spread back into `YesImBotService`.

### D2: Register one `SessionResolver` per Koishi platform

- **Choice:** The public facade registers at most one resolver for each `platform`. The resolver exposes one asynchronous `resolve` method. It receives a compact ResolveContext with Session, an optional Satori-derived message base, and one `freezeImage()` capability. It returns EventRecord or `null`.
- **Rationale:** Platform plugin authors can handle differences among implementations of the same protocol without core ranking profiles, adapter names, and predicates. One method keeps parsing, semantic content construction, and resource collection in one concrete flow.
- **Alternatives considered:** The flat `refine` plus `prepare` protocol was rejected because it requires Session identity to reconnect stages. Automatic resolver fallback after a registered resolver throws was rejected because it hides platform plugin defects and may persist an incorrect interpretation. Requiring a resolver for every platform was rejected because standard Satori messages should work without an Athena-specific plugin.

### D3: Use one extensible EventRecord and one Agent Event wrapper

- **Choice:** EventRecord narrows Satori Event by discriminant, carries optional frozen Koishi literal content, and is extensible through EventMap declaration merging. Event is the `yesimbot.event` Agent custom message that carries one EventRecord.
- **Rationale:** Satori already supplies the correct cross-platform vocabulary. Structured resources serve plugins and Will, while frozen content gives the LLM a deterministic local representation.
- **Alternatives considered:** Parallel `Source`, `Scope`, and `Sender` models were rejected as duplicate platform abstractions. Adding model content directly to Satori Event was rejected because it mixes source facts with Athena's persisted record. Replay-time formatting was rejected because plugin versions, templates, and remote state would change history.

Conceptual types:

```ts
interface EventMap {
  message: {
    channel: Channel
    user: User
    message: Message
  }

  "delivery.failed": {
    channel: Channel
    delivery: {
      turnId: string
      messageId: string
      error: {
        name: string
        message: string
        code?: string
      }
    }
  }
}

type EventRecord<K extends keyof EventMap = keyof EventMap> = {
  [P in K]: Readonly<
    Omit<Universal.Event, "type"> & {
      type: P
      content?: string
    } & EventMap[P]
  >
}[K]

type Event<K extends keyof EventMap = keyof EventMap> =
  CustomMessageBase<"yesimbot.event", EventRecord<K>>
```

The mapped EventRecord keeps the full union discriminated without helper aliases such as RuntimeEventType, RuntimeEventBase, RuntimeEventMap, RuntimeEvent, or ResolvedEvent. The built-in message discriminant is Satori's actual `"message"` event name.

### D4: Persist resolved events as one Agent custom message type

- **Choice:** Gateway and RuntimeManager pass EventRecord. ChannelRuntime wraps it with `CustomMessageBase<"yesimbot.event", EventRecord<K>>` before append. The internal Event ID differs from the platform message ID. The Event timestamp comes from EventRecord.
- **Rationale:** Agent custom messages already support JSONL persistence, plugin projection, and discriminated data. A separate storage entry type or event journal would duplicate persistence machinery.
- **Alternatives considered:** A dedicated EventStore was rejected because current persistence requirements are channel-history requirements. One custom message type per event variant was rejected because EventRecord already provides narrowing. Converting every event directly into an AI SDK user message was rejected because plugins and Will need structured data.

### D5: Treat successful resolution as the persistence decision

- **Choice:** `null` means no record. Every returned EventRecord with a concrete channel is wrapped as Event and persisted before any Will decision. Core fallback admits standard messages. A resolver admits platform-specific messages and non-message events.
- **Rationale:** A second `ignore | record` policy duplicates admission logic. Resolver authors already know whether a Session represents a supported semantic event. Once admitted, history should preserve the fact even when the channel chooses not to act.
- **Alternatives considered:** Persisting every Koishi event was rejected because Athena must not mirror the full Koishi event system. A separate EventPolicy registry was rejected because it creates another event-type dispatch table without a distinct current responsibility. Allowing resolved-but-unrecorded events was rejected because it weakens the meaning of resolution.

### D6: Use `RuntimeManager` for channel instances and one `ChannelRuntime` per channel

- **Choice:** RuntimeManager maps `platform:selfId:channel.id` to one ChannelRuntime, creates runtimes, injects storage, Agent dependencies, AssetStore access, and a per-channel Will, and owns reset and stop coordination. ChannelRuntime represents exactly one channel.
- **Rationale:** Cross-channel cache and lifecycle logic needs one owner. FIFO, Agent, history, local state, and Will need channel-local ownership.
- **Alternatives considered:** A single MessageRuntime was rejected because messages are only one event variant and future event scheduling would widen the module. An EventRuntime was rejected because an event is data, while the live instances are channel runtimes. Keeping the current cross-channel ChannelRuntime plus hidden `CachedRuntime` was rejected because the names and ownership remain inverted.

### D7: Persist and broadcast before Will evaluation

- **Choice:** ChannelRuntime appends Event, then publishes `yesimbot/event`, then calls Will, then publishes `yesimbot/will`.
- **Rationale:** Listeners observe a committed fact. Will can inspect the same record and updated channel history. Broadcast failures remain diagnostic-only and cannot alter control flow.
- **Alternatives considered:** Broadcasting immediately after resolve was rejected because listeners could observe records that later fail to persist. Using Koishi events as the authoritative request-response path was rejected because `emit` is broadcast-only while `serial` stops at the first result. A custom EventManager wrapper was rejected as a shallow wrapper over typed `ctx.emit`.

The first observation surface is:

```ts
interface Events {
  "yesimbot/event"(event: Event): void
  "yesimbot/will"(observation: WillObservation): void
}
```

### D8: Use a per-channel replaceable Will as a turn gate

- **Choice:** RuntimeManager creates one Will per ChannelRuntime through `Will.Factory`. ChannelRuntime passes the committed Event and read-only `Will.State` to `Will.decide()`. The decision is the string `wait` or `trigger`.
- **Rationale:** MaiBot and CyberGroupmate both separate fact accumulation from intervention. A per-channel instance supports local accumulation, backoff, and reply-necessity state without cross-channel leakage.
- **Alternatives considered:** A boolean return was rejected because it offers no stable extension point. A complete `ignore | observe | reply | defer | proactive` action union was rejected because it models future planners before Athena has those capabilities. Letting Will persist or send was rejected because it would combine policy and execution.

```ts
interface Will {
  decide(event: Event, state: Will.State): Awaitable<Will.Decision>

  stop?(): Awaitable<void>
}

namespace Will {
  type Decision = "wait" | "trigger"
  interface State { /* confirmed channel state */ }
  type Factory = (channel: ChannelScope) => Awaitable<Will>
}
```

`DefaultWill` maps direct messages and group mentions to `trigger`; ordinary group messages, accepted non-message events, and `delivery.failed` map to `wait`.

### D9: Return a message-level outbound iterable to Gateway

- **Choice:** ChannelRuntime remains the sole consumer of `AgentInternalEvent`. When the Agent appends a complete, renderable assistant message, ChannelRuntime yields `ChannelRuntime.Output` containing turn ID, assistant message ID, and Koishi Fragment. Gateway sends each item immediately.
- **Rationale:** Users receive complete messages without waiting for the whole turn. Gateway does not learn Agent-internal event types or token streams. Agent runtime buffering prevents platform send latency from blocking model execution.
- **Alternatives considered:** Waiting for turn completion was rejected because it adds user-visible latency. Token streaming was rejected because Koishi platforms differ in editing and streaming support. Returning raw Agent events was rejected because it couples Gateway to turn and tool internals.

```ts
namespace ChannelRuntime {
  interface Output {
    turnId: string
    messageId: string
    content: Fragment
  }
}
```

Only the Gateway that starts a turn receives the iterable. Events that join an active turn do not create another consumer.

### D10: Keep delivery internal and persist passive failures

- **Choice:** Gateway calls `Session.send()` for passive output. The core active-send tool calls `Bot.sendMessage()` with the current bot and an explicit channel ID. Each call site handles its own small result shape; no shared delivery abstraction, DeliveryService, or delivery listener API exists.
- **Rationale:** Koishi already owns transport behavior. Athena only needs receipt normalization and durable failure feedback.
- **Alternatives considered:** A bidirectional platform adapter was rejected as duplicate transport abstraction. A public DeliveryService was rejected because its interface was nearly the same size as its implementation. Persisting active tool failures as a second event was rejected because the structured tool result already records the failure in the same turn.

Gateway attempts every complete outbound message independently. A passive rejection creates a `delivery.failed` resolved event linked to the turn and assistant message IDs. Gateway continues consuming and sending later items.

### D11: Share `AssetStore` through composition

- **Choice:** `YesImBotService` creates one internal AssetStore from `shared/asset.ts` and injects it into Gateway and RuntimeManager/ChannelRuntime. Gateway writes scoped assets through `freezeImage()`. Event formatting reads them during local model projection, and ChannelRuntime clears them during reset.
- **Rationale:** Resource capture happens while Session is available, while model projection and cleanup happen in the channel runtime. A shared dependency avoids reverse module references.
- **Alternatives considered:** RuntimeManager ownership was rejected because Gateway would need to call runtime management for resource writes. Gateway ownership was rejected because ChannelRuntime would need to call back into the Session edge. JSONL binary inlining was rejected because of size and memory cost.

### D12: Expose only resolver and Will factory registration

- **Choice:** The public facade adds `registerResolver()` and `registerWill()`, keeps Agent plugin registration and reset, and removes platform and delivery services.
- **Rationale:** These are the only current behavior seams with more than one concrete implementation. Gateway, RuntimeManager, ChannelRuntime, AssetStore, and delivery operations are implementation details.
- **Alternatives considered:** Keeping `ctx.yesimbot.platform` was rejected because the namespace implies a platform framework. Exposing RuntimeManager was rejected because plugins would depend on lifecycle internals. Configuration-only Will selection was rejected because optional Koishi plugins need a typed registration seam.

Changing or unregistering `Will.Factory` evicts existing channel runtimes without clearing persisted data. Future events recreate them with the current factory.

### D13: Preserve explicit reset and stop ordering

- **Choice:** Gateway stops admission before RuntimeManager teardown. RuntimeManager interrupts and stops channel Agents and Will instances, terminates output streams, and then Gateway drains active sends. Reset clears one channel's history and assets; global stop preserves both.
- **Rationale:** The system must stop new work before destroying channel state while allowing active Session handlers to finish or terminate cleanly.
- **Alternatives considered:** Letting each ChannelRuntime subscribe to Koishi disposal was rejected because it decentralizes global coordination. Clearing all persisted data during stop was rejected because stop is operational, while reset is destructive.

## Target Code Organization

The source tree is organized around three deep modules: the Koishi Session edge, persisted event semantics, and channel execution. Shared operations remain single internal files rather than public services.

```text
core/src/
├── index.ts
├── config.ts
├── service.ts
├── channel/
│   └── index.ts
├── event/
│   ├── index.ts
│   └── formatter.ts
├── gateway/
│   ├── index.ts
│   ├── session.ts
│   ├── message.ts
├── model/
│   └── ...
├── runtime/
│   ├── index.ts
│   ├── manager.ts
│   ├── channel.ts
│   ├── prompt.ts
│   └── storage.ts
├── shared/
│   ├── index.ts
│   ├── asset.ts
│   └── element.ts
└── will/
    └── index.ts
```

The OneBot package keeps its existing deep implementation files and changes only the extension contract:

```text
platforms/onebot/src/
├── index.ts      # createResolver() and registerResolver()
├── events.ts     # typed OneBot non-message event parsing
└── image.ts      # OneBot image acquisition through ResolveContext.freezeImage()
```

`createOneBotAdapter()` becomes the internal `createResolver()`. The resolver's single `resolve()` method first checks supported OneBot non-message events, otherwise uses the optional Satori message base and delegates implementation-specific image loading to `image.ts`. No shallow `resolver.ts` or `types.ts` pass-through file is added.

File responsibilities:

| File | Responsibility |
|---|---|
| `service.ts` | YesImBotService composition root, Koishi command/lifecycle registration, and public registration facade. |
| `channel/index.ts` | Stable ChannelScope model plus channel key, persistence path, conversion, and equality operations. |
| `event/index.ts` | EventMap, mapped EventRecord, Agent custom Event, creation/type guards, and event-related type augmentations. |
| `event/formatter.ts` | Pure local projection from Event to model messages with fixed headers and AssetStore reads. |
| `gateway/index.ts` | Public SessionResolver and ResolveContext plus internal Gateway export. |
| `gateway/session.ts` | Resolver registry, middleware and `internal/session` entry points, Session handle tracking, passive sends, and delivery-failure reinjection. |
| `gateway/message.ts` | Satori message fallback and message preparation through shared element and image-freezing capabilities. |
| `runtime/manager.ts` | Cross-channel ChannelRuntime cache, atomic create/replace, Will.Factory generation, route, reset, and stop. |
| `runtime/channel.ts` | One channel's FIFO, Agent, storage, Event append, Will decision, busy join, output stream, and active-send tool. |
| `runtime/storage.ts` | JSONL AgentStorage. |
| `runtime/prompt.ts` | Runtime prompt file loading and prompt Agent plugin. |
| `shared/asset.ts` | Internal scoped binary AssetStore shared by Gateway and Event formatter/reset. |
| `shared/element.ts` | Stable sealed-element protocol shared by Gateway and Event formatter. |
| `will/index.ts` | Will interface/namespace, per-channel State, Factory, and DefaultWill. |

Deleted or absorbed files:

| Current file/module | Destination |
|---|---|
| `platform/service.ts` | Replaced by `gateway/session.ts`; no platform service survives. |
| `platform/types.ts` | Split between `event/index.ts` and `gateway/index.ts`. |
| `platform/message.ts` | Split between `gateway/message.ts` and `event/formatter.ts`. |
| `platform/utils/elements.ts` | Moved to `shared/element.ts`. |
| `platform/assets.ts` | Moved to `shared/asset.ts`. |
| `platform/config.ts` | Removed; resolver profiles disappear and image policy is hidden behind `freezeImage()`. |
| `delivery/` | Deleted; passive and active send sites remain local to their owners. |
| `runtime/service.ts` | Moved to top-level `service.ts`. |
| `runtime/channel-runtime.ts` | Split into `runtime/manager.ts` and one-channel `runtime/channel.ts`. |
| `runtime/key.ts` | Channel operations move to `channel/index.ts`; `resolveBasePath()` moves to `config.ts`. |
| `runtime/message.ts` | Admission moves to Gateway, Event creation to `event/index.ts`, and routing to `will/index.ts`. |
| `runtime/render.ts` | Complete assistant-message conversion is inlined into `runtime/channel.ts`. |
| `shared/types.ts` | Removed; AgentPluginFactory is defined by `service.ts` with an inline context. |
| `extension/` | Deleted because the empty placeholders are not an active extension lifecycle. |

The published package keeps only the root entry, `./model`, and `./package.json`. Root exports public config, service, channel, event, resolver, Will, and Agent-plugin contracts. Runtime and shared implementations remain internal. The `./platform` and `./shared` subpaths are removed, and no new implementation subpaths are added.

Focused tests remain flat under `core/tests/` and follow the deep-module names:

```text
core/tests/
├── channel.test.ts
├── event.test.ts
├── gateway.test.ts
├── runtime-manager.test.ts
├── channel-runtime.test.ts
├── will.test.ts
├── asset.test.ts
├── element.test.ts
└── lifecycle.test.ts
```

Event tests cover EventRecord, Event, and formatter together. Gateway tests own passive delivery failures; ChannelRuntime tests own the active-send tool. Existing platform, delivery, projection, and channel tests move only when their behavior belongs to the corresponding new module. Independent JSONL storage and model tests remain separate.

## Interface Shapes

### Event contracts

`event/index.ts` uses one mapped EventRecord and one Agent custom Event wrapper:

```ts
import type { CustomMessageBase } from "@yesimbot/agent-runtime"
import type { Universal } from "koishi"

export interface EventMap {
  message: {
    channel: Universal.Channel
    user: Universal.User
    message: Universal.Message
  }

  "delivery.failed": {
    channel: Universal.Channel
    delivery: {
      turnId: string
      messageId: string
      error: {
        name: string
        message: string
        code?: string
      }
    }
  }
}

export type EventRecord<K extends keyof EventMap = keyof EventMap> = {
  [P in K]: Readonly<
    Omit<Universal.Event, "type"> & {
      type: P
      content?: string
    } & EventMap[P]
  >
}[K]

export type Event<K extends keyof EventMap = keyof EventMap> =
  CustomMessageBase<"yesimbot.event", EventRecord<K>>

export function createEvent(record: EventRecord): Event
export function isEvent(message: AgentMessage): message is Event
```

Platform plugins augment EventMap in the root module. EventRecord is the persistable custom-message data; Event is the complete Agent custom message.

```ts
declare module "koishi-plugin-yesimbot" {
  interface EventMap {
    "onebot.message-reactions-updated": {
      channel: Universal.Channel
      reaction: MessageReactionsUpdated
    }
  }
}
```

The same file owns the two required type augmentations:

```ts
declare module "@yesimbot/agent-runtime" {
  interface AgentCustomMessages {
    "yesimbot.event": Event
  }
}

declare module "koishi" {
  interface Events {
    "yesimbot/event"(event: Event): void
  }
}
```

`event/formatter.ts` exports one async `formatEvent(event, options)` function. It reads only Event and local AssetStore state, applies the fixed core header, and returns local ModelMessages. Runtime/channel wraps it in the Agent plugin hook.

### SessionResolver

```ts
export interface ResolveContext {
  readonly session: Session
  readonly base?: Omit<EventRecord<"message">, "content">

  readonly freezeImage: (
    element: Element,
    load: (signal: AbortSignal) => Promise<{
      data: Uint8Array
      mime?: string
    }>,
  ) => Promise<Element>
}

export interface SessionResolver {
  readonly platform: string
  resolve(context: ResolveContext): Awaitable<EventRecord | null>
}
```

The resolver object has no ID, priority, `accepts`, `refine`, `prepare`, route action, persistence flag, or outbound method. `platform` is the unique registry key. `base` is present only for standard Satori message Sessions. `freezeImage()` hides all count, concurrency, timeout, byte, MIME, AssetStore, and unavailable-element policy. `null` is the only non-admission result.

### Will

```ts
export interface Will {
  decide(event: Event, state: Will.State): Awaitable<Will.Decision>
  stop?(): Awaitable<void>
}

export namespace Will {
  export type Decision = "wait" | "trigger"

  export interface State {
    readonly activeTurnId: string | null
    readonly pending: readonly Event[]
    readonly recent: readonly Event[]
    readonly lastActivityAt: number | null
  }

  export type Factory = (channel: ChannelScope) => Awaitable<Will>
}
```

`pending` contains committed events not yet consumed by the active turn. `recent` is a bounded, ordered view selected by ChannelRuntime, not a storage object or complete-history guarantee. `will/index.ts` contains both the public contract and the small DefaultWill implementation.

The first-version config removes platform profiles and `append | reply` actions:

```ts
export interface DefaultWillConfig {
  readonly direct: Will.Decision
  readonly mention: Will.Decision
  readonly group: Will.Decision
}

export interface Config {
  basePath: string
  chatModel: string
  logLevel?: number
  will?: Partial<DefaultWillConfig>
}
```

### Runtime and Gateway internal contracts

```ts
export class ChannelRuntime {
  handle(record: EventRecord): Promise<ChannelRuntime.Result>
  reset(): Promise<void>
  stop(): Promise<void>
}

export namespace ChannelRuntime {
  export interface Output {
    readonly turnId: string
    readonly messageId: string
    readonly content: Fragment
  }

  export type Result =
    | { readonly kind: "wait"; readonly eventId: string }
    | { readonly kind: "join"; readonly eventId: string; readonly turnId: string }
    | {
        readonly kind: "run"
        readonly eventId: string
        readonly turnId: string
        readonly output: AsyncIterable<Output>
      }
}
```

Agent plugin context is inlined in AgentPluginFactory as `{ channel: ChannelScope; bot: Bot }`; no ChannelAgentContext type remains.

The implementation classes stay internal:

```ts
class Gateway {
  register(resolver: SessionResolver): () => void
  close(): void
  drain(): Promise<void>
}

class RuntimeManager {
  route(record: EventRecord): Promise<ChannelRuntime.Result>
  setWill(factory: Will.Factory): void
  reset(scope: ChannelScope): Promise<void>
  stop(): Promise<void>
}
```

Gateway registers its Koishi middleware and non-message `internal/session` hook during construction and keeps their disposers. `close()` synchronously prevents new handles and removes hook registrations. `drain()` waits tracked Session handlers after RuntimeManager has interrupted channel work.

RuntimeManager stores a Will.Factory generation with each channel entry. `setWill()` changes the generation synchronously so no new route can use an old Will. Stale runtimes are stopped under the per-channel lifecycle queue before reuse; the public registration API can therefore remain synchronous.

### Public facade

```ts
export interface AgentPluginFactory {
  (context: {
    readonly channel: ChannelScope
    readonly bot: Bot
  }): Awaitable<AgentPlugin | null>

  readonly requiresMessageId?: boolean
}

export class YesImBotService extends Service<Config> {
  readonly model: ModelService

  registerResolver(resolver: SessionResolver): () => void
  registerWill(factory: Will.Factory): () => void
  registerAgentPlugin(factory: AgentPluginFactory): () => void

  reset(scope: ChannelScope): Promise<void>
  stop(): Promise<void>
}
```

Only one custom Will.Factory can be active. Registration or disposal swaps RuntimeManager's factory generation; DefaultWill is used when no custom factory is registered. SessionResolver disposal removes only the same resolver instance currently registered for its platform.

### Delivery data

There is no shared delivery module or receipt model. Gateway handles `Session.send()` locally. The active-send tool handles `Bot.sendMessage()` locally and returns its own structured tool result. The only persisted delivery shape is the inline `delivery.failed` EventMap variant shown above.

A successful empty Koishi `string[]` remains a successful send. Passive failure records do not duplicate assistant content and use Event ID/timestamp instead of delivery-specific IDs and timestamps.

## Risks / Trade-offs

[Risk] Gateway retains the original Session while a triggered turn remains active. → Mitigation: Gateway owns only the active handle, never stores Session in channel queues or runtime fields, and releases it when the outbound iterable terminates.

[Risk] Slow platform sends allow Agent internal events to accumulate in the runtime's buffered stream. → Mitigation: emit only complete assistant messages, preserve one consumer, monitor queue growth, and avoid token-level output volume.

[Risk] Resolver admission now implies persistence, so a resolver bug can write an unwanted event. → Mitigation: require one authoritative resolver per platform, fail closed on exceptions, validate required channel resources, and cover each resolver with type and behavior tests.

[Risk] A Will plugin may retain resources or start background work. → Mitigation: create one Will per channel, support `stop()`, and evict channel runtimes when the active Will.Factory changes.

[Risk] Synchronous Koishi observation listeners may throw before Will runs. → Mitigation: isolate `ctx.emit` calls with diagnostic-only error handling and continue the authoritative path.

[Risk] Passive delivery failure arrives after a later turn has already started. → Mitigation: accept eventual consistency as an explicit first-version trade-off; once persisted, the failure appears in subsequent model contexts.

[Trade-off] The clean break discards old channel JSONL history. → Accepted because compatibility code would preserve removed `Platform.MessageRecord` semantics and complicate the new event record model.

[Trade-off] Channel-less events are skipped. → Accepted because implicit fan-out and synthetic global histories require a future global dispatcher and product policy that do not yet exist.

[Trade-off] DefaultWill remains simple routing. → Accepted because the change establishes a stable per-channel Will seam without prebuilding an attention engine.

## Migration Plan

1. Introduce the new event, resolver, Will, outbound, and public facade types behind a clean compile-time break.
2. Add Gateway, shared AssetStore composition, RuntimeManager, and one-channel ChannelRuntime implementations.
3. Move message and non-message ingestion to Gateway and remove Session weak-map staging.
4. Replace platform message records with `yesimbot.event` custom messages and update local model projection.
5. Add DefaultWill, committed-event and Will observations, and message-level outbound transformation.
6. Move passive delivery to Gateway, add `delivery.failed`, and add the current-bot active-send tool.
7. Migrate OneBot resolver behavior and optional plugins to the new facade.
8. Remove PlatformService, DeliveryService, old adapter types, old delivery listeners, and old JSONL readers.
9. Verify focused package tests, type tests, reset/stop ordering, and full repository checks before archive.

Rollback is source-level only. Reverting the code restores the previous runtime but does not make new JSONL files readable by the old format. This change therefore requires an explicit development-time storage reset when switching between implementations.

## Open Questions

None. Diagnostic codes and other private implementation details remain constrained by the confirmed contracts above.
