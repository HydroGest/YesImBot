# Session and Event Pipeline Redesign: Brainstorming Record

## Background

Athena currently splits inbound platform handling, channel execution, and outbound delivery across `PlatformService`, `ChannelRuntime`, and `DeliveryService`.

`PlatformService` has accumulated several unrelated responsibilities over multiple redesigns:

- It registers platform adapters and selects them for each Koishi `Session`.
- It listens to `internal/session` and stores per-Session state in weak maps.
- It refines messages and events, prepares remote resources, freezes message elements, publishes process-local events, builds an Agent projection plugin, and clears channel assets.
- Its `refine()`, `prepare()`, and model projection stages form an implicit protocol tied together by cached Session identity.

The current `ChannelRuntime` name also hides its actual shape. It owns a map of cached per-channel runtimes instead of representing one channel. It classifies messages into `ignore`, `append`, or `reply`, creates Agents, consumes Agent streams, calls delivery, and manages every channel's lifecycle.

`DeliveryService` wraps Koishi's existing `session.send()` and `bot.sendMessage()` operations. It returns receipts and publishes process-local status events, but a failed passive reply never enters the Agent's history. The model can therefore believe an assistant message reached the platform when it did not.

The redesign must respect Koishi and Satori rather than build a second platform framework:

- Koishi already owns native platform adapters, bot identity, Session dispatch, middleware, event hooks, and outbound sending.
- Satori already defines the cross-platform `Event`, `Message`, `Channel`, `User`, `Guild`, and related resources.
- YesImBot still needs an internal normalization seam because Session fields remain optional and platform implementations may expose protocol-specific details differently.
- Session is an operational edge object. It must not enter Agent messages, JSONL history, channel state, or long-lived runtime interfaces.

This change is a clean break. It will not preserve `Platform.MessageRecord`, `ctx.yesimbot.platform`, `ctx.yesimbot.delivery`, or the existing JSONL record format.

## Evidence Reviewed

The exploration reviewed:

- The archived changes `simplify-platform-adapter-model` and `redesign-core-message-runtime`.
- Current `PlatformService`, `ChannelRuntime`, `DeliveryService`, Agent message projection, turn queue, stream consumption, storage, and OneBot event refinement.
- Koishi documentation for Session, middleware, event hooks, service events, and adapter behavior.
- Satori documentation for Event resources, message resources, resource lifting, and element literals.
- ChatLuna, CyberGroupmate, MaiBot, and AstrBot through DeepWiki.

The external systems did not provide a platform abstraction that should replace Koishi. Their useful patterns were higher-level:

- MaiBot separates fact accumulation from turn triggering. A per-conversation scheduler uses frequency, reply necessity, forced triggers, and local state to decide whether to run reasoning.
- CyberGroupmate separates group observation from intervention. It accumulates attention signals and later decides whether to observe, ignore, reply, defer, or start proactive work.
- Both systems keep the decision to retain facts separate from the decision to start an Agent turn.
- Projects that do not use Koishi must build their own Platform IO layer. Athena should not copy that layer.

## Decision Chain

### Delivery semantics

Passive replies remain automatic. The model's final assistant outputs are sent through the original Koishi Session.

Active or cross-channel sending uses a core Agent tool. The tool is bound to the current bot and may target any channel that bot can access. Its structured receipt returns to the model in the same turn.

A passive send failure creates an immutable `delivery.failed` runtime event. The event is persisted in the same channel history and can appear in future model context. Athena does not modify or roll back the assistant message that preceded the failed send.

Passive delivery failure does not start a new turn. Concurrent processing only guarantees that the failure becomes visible after it is persisted; it does not block a turn that already started before the receipt arrived.

Each complete assistant message is attempted independently. One send failure does not stop later assistant messages from being attempted.

An active send failure remains only in the persisted tool result. Adding a second `delivery.failed` event for the same tool call would duplicate context.

### Event admission and persistence

Messages and non-message events are both future Will triggers.

Koishi events are not mirrored wholesale. A `SessionResolver` decides whether a Session becomes an Athena event:

- `skip` means the Session is unsupported or should not enter Athena.
- A resolved event is accepted and will be persisted in its channel history.

The design does not retain a second product-level `ignore` stage between resolution and persistence. Resolution itself is the admission and recording decision.

Messages are accepted by default through a Satori fallback when a platform does not register a resolver. Non-message Sessions require a platform resolver. A registered resolver is authoritative for its platform; if it throws, the Session is not admitted and Athena does not silently fall back.

Only events with a concrete `channel.id` enter the first version of the runtime. Guild-level or account-level events without a channel are skipped. Athena will not broadcast them to every channel or invent synthetic channel histories.

Athena will not create a separate event store. Accepted messages and non-message events are stored as Agent custom messages in channel JSONL history.

### Resolver shape

Each Koishi platform may register at most one `SessionResolver`. Platform plugins must handle differences among protocol implementations such as NapCat and Lagrange inside that resolver. Core does not rank adapters by profile, Koishi adapter name, or predicate priority.

The resolver has one asynchronous method named `resolve`. It receives:

- The Koishi Session.
- An optional base message event constructed from standard Satori resources.
- A restricted resource capability for freezing supported binary media.

The resolver completes platform interpretation, semantic content construction, and remote resource freezing in one call. Athena does not expose independent `refine`, `prepare`, or replay-time projector hooks.

The resolver returns either `skip` or a structured runtime event with optional frozen model content.

### Structured event and model content

Athena uses two models for every accepted event.

The structured model extends and narrows Satori Event. It exists for plugins, routing, ChannelRuntime, and Will.

The model-facing content is a separately frozen Koishi element literal. It exists for Agent history projection. The LLM projection never rereads platform resources or invokes a resolver.

For message events, `message` remains a top-level Satori Event resource. Resource lifting also keeps `user`, `member`, `channel`, and `guild` at the event's top level.

Athena will not reintroduce parallel `Source`, `Scope`, or `Sender` types.

The resolver result has the conceptual shape:

```ts
interface ResolvedEvent<K extends RuntimeEventType = RuntimeEventType> {
  event: RuntimeEvent<K>
  content?: string
}
```

`content` is optional because some structured events may need persistence and Will evaluation without a model-facing body.

An accepted event becomes one Agent custom message:

```ts
type EventRecord<K extends RuntimeEventType = RuntimeEventType> =
  CustomMessageBase<
    "athena.event",
    ResolvedEvent<K>
  >
```

The EventRecord ID is an internal record ID. A platform message ID remains at `record.data.event.message.id`. The EventRecord timestamp comes from the runtime event timestamp.

Core builds the fixed model header from locally stored event resources. The header contains time, sender, and a conditional message ID. The frozen `content` supplies the semantic body. Runtime projection does not consult Session, the platform resolver, or a platform API.

### Will model

Will is an independent replaceable module. It does not parse Session, persist records, operate the Agent, or send platform messages.

Every ChannelRuntime owns one Will instance created by a `WillFactory`. Per-channel instances allow future implementations to keep local reply-necessity state, backoff state, message accumulation, or other conversation-specific scheduling data.

The stable first interface is a turn gate:

```ts
interface Will {
  evaluate(
    record: EventRecord,
    state: Readonly<ChannelState>,
  ): Awaitable<WillDecision>

  stop?(): Awaitable<void>
}

type WillDecision =
  | { kind: "wait" }
  | { kind: "trigger" }
```

The record is already persisted before Will runs. Will therefore answers only whether the channel should wait or start/join a turn.

The read-only ChannelState must provide enough local context for the default routing policy and future attention engines. The initial design includes active turn identity, pending event count, last activity time, and a bounded recent-record view.

The first `DefaultWill` reproduces current behavior without exposing `append` or `reply` as long-term event semantics:

- Direct messages trigger.
- Group mentions trigger.
- Ordinary group messages wait.
- Accepted non-message events wait.
- `delivery.failed` waits.

Future Will implementations may adopt MaiBot-style frequency and reply-necessity gates or CyberGroupmate-style attention and observation logic without changing resolver, record, or channel interfaces.

### Module topology

The accepted topology uses a Koishi Session gateway, a cross-channel runtime manager, and one runtime instance per channel.

```text
YesImBotService
  ├─ SessionGateway
  ├─ RuntimeManager
  │    └─ ChannelRuntime × N
  └─ shared AssetStore
```

`SessionGateway` is the only module that directly handles Session. It owns:

- Koishi middleware registration for messages.
- `internal/session` handling for non-message events.
- The per-platform SessionResolver registry.
- Satori fallback conversion.
- Resolver selection, fail-closed diagnostics, and resource freezing.
- The local Session lifetime while channel processing produces outputs.
- Passive `session.send()` calls and receipt normalization.
- Construction and reinjection of `delivery.failed` events.

The Gateway does not pass Session, a Session closure, or a ReplyPort into RuntimeManager or ChannelRuntime.

`RuntimeManager` owns cross-channel runtime management:

- It maps `platform:selfId:channel.id` to one ChannelRuntime.
- It creates ChannelRuntime with its Agent dependencies, storage, AssetStore access, and per-channel Will.
- It routes resolved events to the correct runtime.
- It handles channel reset, global stop, and runtime eviction.
- It does not resolve Session, send messages, broadcast observations, or evaluate Will itself.

`ChannelRuntime` represents exactly one channel. It replaces the existing hidden `CachedRuntime` concept and owns:

- The channel FIFO.
- The channel Agent and JSONL storage.
- Channel assets and local state access.
- EventRecord creation and persistence.
- Per-channel Will invocation.
- Busy-turn join behavior.
- The sole consumer and projection of the Agent internal event stream.

The shared `AssetStore` remains an internal module created by the composition root. SessionGateway writes frozen resources. ChannelRuntime reads resources during local model projection and clears scoped assets during reset.

### Event observations

Runtime management and Koishi event broadcasting remain separate. RuntimeManager does not serve as an event bus.

Athena uses Koishi's typed event system directly. The first version exposes two observation surfaces:

```ts
interface Events {
  "yesimbot/event"(record: EventRecord): void
  "yesimbot/will"(observation: WillObservation): void
}
```

`yesimbot/event` fires after EventRecord persistence and before Will evaluation.

`yesimbot/will` fires after Will returns `wait` or `trigger`.

Listener failures are diagnostic-only. They cannot undo persistence, block Will, change a decision, or interrupt the authoritative runtime path.

Agent internal events, tool lifecycle, successful delivery receipts, and channel lifecycle events remain on their existing or local mechanisms. Athena does not copy every internal state transition into one generic observation stream.

### Output timing

Athena must send a complete valid assistant message as soon as the Agent appends it. It must not wait for the entire turn to finish, but it also does not stream individual tokens to the platform.

ChannelRuntime remains the sole consumer of `AgentInternalEvent`. It transforms only complete, renderable assistant messages into:

```ts
interface OutboundMessage {
  turnId: string
  messageId: string
  content: Fragment
}
```

When ChannelRuntime starts a new turn, its result includes a message-level `AsyncIterable<OutboundMessage>`. Gateway consumes this iterable and sends each item through the original Session.

The Agent runtime already buffers turn events independently of consumer speed. A slow platform send therefore does not stop model execution, although pending internal events may remain queued until Gateway catches up.

A Session that joins an existing busy turn does not receive a second output iterable. The Gateway that started the turn retains the Session used for passive replies.

### Delivery consistency

Delivery remains an internal operation rather than a public service.

Each outbound assistant message produces one receipt:

```ts
interface DeliveryReceipt {
  deliveryId: string
  mode: "reply" | "send"
  status: "sent" | "failed"
  messageIds: string[]
  startedAt: number
  finishedAt: number
  error?: DeliveryError
}
```

Koishi returning an empty message ID array still counts as a successful send. Only a rejected send is a failure.

A passive send failure produces a `delivery.failed` runtime event associated with the turn and assistant message IDs. Its frozen model content explains that a prior assistant message did not reach the platform. The event is routed back through RuntimeManager and persisted in the same channel.

Gateway continues consuming and attempting later outbound messages after a failure. Each failure produces its own record.

The core active-send tool uses the current bot's `bot.sendMessage(channelId, content)` operation. It may target any channel available to that bot. The tool result contains the structured receipt and is sufficient model feedback. Athena does not create a duplicate `delivery.failed` record for active tool sends.

### Lifecycle

Channel reset follows this order:

```text
interrupt Agent
→ stop Agent
→ stop Will
→ wait channel work
→ clear JSONL
→ clear scoped assets
→ remove ChannelRuntime
```

Global stop follows this order:

```text
stop SessionGateway admission
→ stop RuntimeManager admission
→ interrupt and stop ChannelRuntime instances
→ terminate outbound iterables
→ wait active Gateway handlers and sends
→ release in-memory instances
```

Global stop preserves JSONL history and assets. Reset clears only the selected channel.

Changing or unregistering the active WillFactory evicts existing ChannelRuntime instances without clearing history or assets. The next accepted event recreates each channel with the new factory. This prevents an unloaded plugin's Will object from surviving inside existing runtimes.

### Public surface

The public facade keeps the extension points that correspond to real variation:

```ts
interface YesImBotService {
  registerSessionResolver(resolver: SessionResolver): () => void
  registerWillFactory(factory: WillFactory): () => void
  registerAgentPlugin(factory: AgentPluginFactory): () => void
  reset(scope: ChannelIdentity): Promise<void>
}
```

Each platform may register one SessionResolver. At most one custom WillFactory may replace DefaultWill.

Athena removes `ctx.yesimbot.platform` and `ctx.yesimbot.delivery`. It does not expose SessionGateway, RuntimeManager, ChannelRuntime, AssetStore, or the internal submit implementation as public Koishi services.

## Candidate Topologies Considered

### Single deep MessageRuntime

This topology would place Session handling, event routing, channel state, Will, Agent execution, and delivery behind one interface.

It initially appeared attractive because it minimized external interfaces. It stopped fitting once messages and non-message events became common Will triggers. A module named MessageRuntime would own non-message event scheduling and future global event concerns. It would also risk recreating PlatformService as a larger god object.

### Gateway plus explicit EventRuntime and ChannelRuntime

This topology separated the Session edge, an event runtime, and channel execution.

The name EventRuntime was rejected. Event is data, not a runtime instance. A future global event dispatcher may exist, but the current design only needs cross-channel runtime management and typed observation broadcasts.

### SessionGateway plus RuntimeManager plus per-channel ChannelRuntime

This is the selected topology.

The Gateway contains all Koishi Session-specific complexity. RuntimeManager owns the channel instance map and lifecycle. ChannelRuntime owns local execution. Koishi `ctx.emit()` exposes observations without forcing publishers to hold a RuntimeManager reference.

The deletion test supports each module:

- Removing SessionGateway spreads resolver selection, fallback, resource freezing, passive sending, and failure reinjection across the facade and runtime.
- Removing RuntimeManager spreads concurrent channel creation, cache ownership, reset, and stop across callers.
- Removing ChannelRuntime removes the local FIFO, Agent, Will, history, and stream ownership boundary.
- AssetStore remains shared because Gateway writes assets while ChannelRuntime reads and clears them.

## Rejected Designs

- A bidirectional platform adapter that parses inbound Session and implements outbound send.
- Passing Session into RuntimeManager or ChannelRuntime.
- Passing a ReplyPort closure that implicitly retains Session inside a channel FIFO.
- Caching parsed data by Session identity across `internal/session` and middleware.
- A public DeliveryService or a delivery listener bus.
- A public PlatformService with refine, prepare, publish, projection, and asset responsibilities.
- Replaying platform formatters or remote APIs when building model history.
- Persisting every Koishi event.
- A global EventStore in the first version.
- A generic `ignore | persist | act` decision union shared by parsing and Will.
- Treating current `append | reply` routing as the permanent event model.
- Returning the Agent internal event stream directly to Gateway.
- Waiting for the whole turn before sending complete assistant messages.
- Token-level platform streaming.
- One catch-all internal observation stream containing Agent, tool, Will, delivery, and channel lifecycle events.
- Legacy API and JSONL compatibility code.

## Validated First-Version Flow

```text
Native platform event
  → Koishi adapter creates Session
  → message middleware OR non-message internal/session hook
  → SessionGateway creates optional Satori base
  → SessionResolver or Satori fallback
  → skip OR ResolvedEvent { event, content? }
  → RuntimeManager routes by platform:selfId:channel.id
  → ChannelRuntime FIFO
  → EventRecord persisted to JSONL
  → ctx.emit("yesimbot/event", record)
  → Will.evaluate(record, state)
  → ctx.emit("yesimbot/will", observation)
  → wait OR trigger/join
  → Agent internal stream
  → complete assistant message projected to OutboundMessage
  → SessionGateway calls session.send()
  → success OR delivery.failed reinjected through RuntimeManager
```

## Non-Goals

- Implementing the full Will system in this change.
- Implementing a global attention accumulator or cross-channel event dispatcher.
- Adding world state, global memory, or a durable event journal.
- Supporting channel-less guild or account events.
- Adding user-configurable rendering templates.
- Adding platform-specific outbound adapters.
- Adding active-send retry or passive-send automatic retry.
- Preserving old storage or extension interfaces.
