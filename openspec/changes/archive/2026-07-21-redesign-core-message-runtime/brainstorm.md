# Brainstorm: Redesign Core Message Runtime

## Background

`YesImBotService.handleSession()` currently reconstructs a Koishi `Session` with object spread before classifying a message. Real Koishi sessions expose `isDirect` through an accessor, so the reconstructed plain object loses that behavior and can misclassify direct messages.

The defect exposes a wider design problem. Core reads routing facts from both the raw `Session` and `Platform.Message`, manually composes classification, preparation, Agent submission, stream consumption, and `session.send()`, and gives `YesImBotService` too many unrelated responsibilities.

The original exploration also referenced Slice 02 of `design-platform-adapter-system`. That change contains stale world-state, Reader/View, template, and willingness assumptions. Current main specifications define `Platform.Event` as typed, frozen, and publish-only. No accepted requirement currently defines world state, a standard event effect, or event-triggered Agent behavior.

## Decision Chain

### 1. Design scope

The design covers the complete channel message lifecycle and records the constraints that future event consumers must respect. It does not create an event consumer framework or define concrete event effects.

### 2. Runtime extensibility

Core owns a stable lifecycle. Configuration may map known message scenarios to existing actions, but plugins and platform adapters do not register arbitrary routing predicates. The first version keeps deterministic `ignore`, `append`, and `reply` behavior.

### 3. Agent context scope

Agent runtimes remain channel-scoped. Guild and account scopes do not become Agent types.

### 4. Conversation rhythm

Long-term Athena behavior may include willingness, silence, delayed response, and conditional LLM judgment. Current infrastructure does not justify timers, schedulers, observers, or deferred reevaluation. The first version does not design or implement them.

### 5. Delivery ownership

Delivery is a first-class core module, not a callback wrapper in `YesImBotService`. It owns output ordering, passive versus proactive sending, normalized results, status publication, and error isolation.

### 6. Platform integration research

Hermes Agent and AstrBot implement their own bidirectional platform abstractions because they own their messaging gateways. CyberGroupmate likewise needs a custom platform adapter and notification center.

ChatLuna relies on Koishi for messaging-platform input and output. Koishi and Satori already provide the mature product seam YesImBot needs:

- `Session` preserves passive-reply context.
- Satori `referrer` carries callback tokens, source event identifiers, thread data, and reply-window context.
- `Bot.sendMessage()` supports target-based sending.
- `MessageEncoder` owns platform encoding, splitting, upload, and send events.
- Satori message APIs and login features describe standard platform operations.

YesImBot therefore must not add a platform driver, integration bundle, capability registry, or per-platform delivery adapter registry. Its platform plugins remain semantic input extensions over Koishi/Satori.

### 7. Module ownership

The approved module split is:

- `YesImBotService`: Koishi facade and composition root.
- `PlatformService`: one-time Session collection, input refinement, message preparation, assets, and publish-only events.
- `ChannelRuntime`: classification, per-channel FIFO, Agent lifecycle, storage, stream ownership, and reset/stop.
- `DeliveryService`: output sequencing and Koishi/Satori delivery orchestration.
- `@yesimbot/agent-runtime`: generic Agent execution with no Koishi or platform dependency.

### 8. Canonical message facts

No `IncomingMessage`, `MessageRouteFacts`, or `ReplyOrigin` wrapper is introduced. `Platform.Message` remains the canonical pure-data message and gains one required fact that cannot be derived reliably from its existing fields:

```ts
scope: {
  type: "channel"
  channelId: string
  channelType: "private" | "group"
  guildId?: string
  threadId?: string
}
```

Core reads `session.isDirect` once while drafting the message. Self-message and mention checks derive from `Platform.Message.source`, `sender`, and `elements`. Runtime keys, Agent context, classification, and persistence use `Platform.Message` rather than re-reading Session fields.

`ChannelRuntime.handle(message, session)` receives the original Session only as a short-lived operational dependency. It may pass that Session to platform preparation and passive delivery. It must not read routing facts from it, serialize it, cache it, spread it, or pass it into `agent-runtime`.

### 9. Routing policy

Self messages always map to `ignore`. Core configuration maps three scenarios to `append` or `reply`:

- direct message, default `reply`;
- group mention, default `reply`;
- ordinary group message, default `append`.

The policy is an internal seam in `ChannelRuntime`, not a public plugin registry.

### 10. Channel execution order

For each admitted channel message, the per-channel FIFO serializes static classification, preparation, Agent resolution, the final busy read, and the initial `append`, `send(ifBusy: "join")`, or `run` submission. Stream consumption and delivery occur outside the FIFO.

A new `run()` owns one stream consumer. Messages joined to that active turn do not create another consumer. The original turn stream owner delivers the turn output.

Reset preserves the order `interrupt -> stop -> storage clear -> asset clear -> runtime cache delete`.

### 11. Delivery contract

Delivery exposes three conceptual entry points:

```ts
delivery.reply(session, outputs)
delivery.send(source, scope, outputs)
delivery.subscribe(listener)
```

`reply()` uses the original Session to preserve passive context. `send()` resolves a Koishi Bot by `platform + selfId` and calls the standard channel send path. Outputs are ordered Koishi fragments.

Delivery reports only observable process-level states: `started`, `sent`, `partial`, and `failed`. Both Koishi send paths return message ID arrays, which delivery preserves without treating an empty array as stronger delivery evidence. Delivery does not claim accepted, delivered, read, exactly-once, automatic retry, or durable status semantics.

### 12. Persistence and compatibility

`scope.channelType` is stored in `Platform.MessageRecord`. The new runtime does not maintain a permanent fallback for records that lack this field. Delivery receipts and events remain process-local and do not enter channel JSONL.

## Rejected Approaches

- Patch only the missing `isDirect` value.
- Reconstruct or clone Session-shaped objects.
- Add `IncomingMessage`, route-fact, or reply-origin wrappers.
- Expand the current inbound `Platform.Adapter` with outbound methods.
- Add a platform integration bundle or typed capability registry.
- Add per-platform delivery adapters above Koishi/Satori.
- Add a generic message/event behavior runtime.
- Introduce world state, willingness, delayed response, or a scheduler in this change.
- Replace passive Session delivery with a pure target object.

## Approved Non-Goals

- Concrete standard event consumers.
- World state or event persistence.
- Willingness, LLM response judgment, deferred reevaluation, or proactive behavior.
- Streaming delivery, edit, delete, reaction, presence, retry, outbox, or durable acknowledgements.
- Guild-scoped or account-scoped Agents.
- Legacy JSONL compatibility.

## Principal Risks

- `scope.channelType` changes the persisted message contract.
- A successful Koishi send may return an empty message ID array, which provides no stronger delivery evidence.
- Holding the original Session beyond the current turn would violate the design.
- Delivery must not duplicate Koishi `MessageEncoder` responsibilities.
- Splitting the implementation into shallow helpers would recreate the current orchestration problem.
