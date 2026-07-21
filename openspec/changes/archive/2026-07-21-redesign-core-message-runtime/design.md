## Context

`YesImBotService.handleSession()` currently obtains a normalized `Platform.Message` but reconstructs the triggering Koishi `Session` before classification. Object spread does not preserve prototype accessors such as `isDirect`, so real direct messages can enter the group-observation path. The reconstruction also creates competing authorities for sender, scope, content, and channel type.

The same method owns the per-channel FIFO, platform preparation, Agent creation and caching, append/join/run submission, stream consumption, reply rendering, and error delivery. Helper functions in `runtime/message.ts` expose implementation steps rather than a coherent channel lifecycle.

Koishi and Satori already provide the stable bidirectional platform seam. Session preserves passive-reply context, including Satori referrer data. Bot and MessageEncoder provide target sending and platform-specific encoding. YesImBot should orchestrate those primitives rather than add another platform driver or per-platform delivery registry.

The stale `design-platform-adapter-system` change mentions world state and willingness. Current main specifications only require typed, frozen, publish-only `Platform.Event` values. No accepted event effect belongs in this change.

## Goals / Non-Goals

**Goals:**

- Make `Platform.Message` the sole routing and persistence authority for admitted channel messages.
- Preserve real Koishi Session behavior without cloning or serializing Session objects.
- Place classification, FIFO submission, Agent lifecycle, stream ownership, and reset behind a small `ChannelRuntime` interface.
- Add deterministic scenario-to-action configuration without a public rule registry.
- Place output ordering, passive replies, target sends, status observation, and delivery errors behind `DeliveryService`.
- Keep Koishi/Satori responsible for platform transport, encoding, splitting, and passive referrer semantics.
- Test behavior through deep module interfaces rather than helper call order.

**Non-Goals:**

- Concrete standard event consumers or event-to-Agent routing.
- World state, willingness, deferred reevaluation, schedulers, or proactive behavior policy.
- A YesImBot platform driver, integration bundle, capability registry, or delivery adapter registry.
- Streaming delivery, message editing, deletion, reactions, presence, retry, outbox, or durable delivery acknowledgements.
- Guild-scoped or account-scoped Agent runtimes.
- Compatibility reads for persisted messages that lack the new channel type field.

## Decisions

### D1: Keep Koishi/Satori as the bidirectional platform seam

- **Choice:** YesImBot uses Session for passive replies and Bot/MessageEncoder for target sending. Platform packages remain inbound semantic extensions.
- **Rationale:** Koishi and Satori already preserve platform reply context, encode standard elements, expose Bot identity, and own adapter lifecycle. A second driver would duplicate those contracts and risk losing passive referrer data.
- **Alternatives considered:** A unified YesImBot platform driver, an input/delivery bundle, typed capability contributions, and separate per-platform delivery adapters. Each added infrastructure without a current transport gap.

### D2: Split core ownership into four modules

- **Choice:** `YesImBotService` acts as Koishi facade and composition root; `PlatformService` owns input semantics; `ChannelRuntime` owns channel Agent execution; `DeliveryService` owns output orchestration.
- **Rationale:** Each module presents a small interface and concentrates one lifecycle. Removing ChannelRuntime or DeliveryService would redistribute substantial ordering, state, and error logic across callers.
- **Alternatives considered:** Keeping orchestration in `YesImBotService` or decomposing it into public helper functions. Both preserve the current shallow call graph.

### D3: Add channel type to the canonical message scope

- **Choice:** An admitted `Platform.Message` channel scope includes required `channelType: "private" | "group"` data. The draft path reads the original Session accessor once.
- **Rationale:** Channel type cannot be derived reliably from `channelId` or `guildId`, but routing, Agent context, and persistence all need it.
- **Alternatives considered:** A separate incoming-message wrapper, route-facts object, top-level transient metadata, or repeated Session reads. The wrapper and facts duplicate existing message data; repeated reads preserve competing authorities.

### D4: Pass the original Session only as an operational dependency

- **Choice:** `ChannelRuntime.handle(message, session)` receives the real Session. ChannelRuntime may pass it to platform preparation and passive delivery, but must not use it for routing facts, serialize it, cache it, spread it, or pass it into `agent-runtime`.
- **Rationale:** Adapter preparation and passive delivery need live Koishi context. Keeping that dependency explicit is safer than hiding it in a data wrapper.
- **Alternatives considered:** A pure-data reply target. Satori passive requests may require opaque referrer data and a limited reply window, so target data cannot replace Session reliably.

### D5: Derive all remaining routing facts from Platform.Message

- **Choice:** Self-message detection compares normalized sender and source identities. Mention detection scans normalized elements. Runtime key, Agent context, and storage scope derive from normalized message source and scope.
- **Rationale:** Adapter refinement can correct canonical message semantics. Re-reading raw Session content or sender fields after refinement would recreate divergence.
- **Alternatives considered:** Preserve the current userId/author/event fallback chain in the classifier. The draft path already resolves those inputs into the canonical sender.

### D6: Keep deterministic routing inside ChannelRuntime

- **Choice:** Self messages always map to `ignore`. Root configuration maps direct, group mention, and ordinary group scenarios to `append` or `reply`, with current behavior as defaults.
- **Rationale:** Product policy can vary without exposing Agent busy state, platform internals, or lifecycle ordering to plugins and adapters.
- **Alternatives considered:** Arbitrary predicate lists, plugin-registered routing rules, adapter-owned intent, willingness scoring, and LLM judgment. None has a current second implementation or accepted behavior contract.

### D7: Preserve the FIFO submission invariant

- **Choice:** Per-channel FIFO execution includes static classification, platform preparation, Agent resolution, final busy read, and initial append/join/run submission. Stream consumption and delivery occur outside the FIFO.
- **Rationale:** This keeps submission order deterministic while allowing later messages to join an active turn during model execution.
- **Alternatives considered:** Holding the FIFO through stream completion would block joined inputs; reading busy before preparation would make the decision stale.

### D8: Give each run one stream owner

- **Choice:** The `run()` caller owns the turn stream, collects assistant output, observes terminal events, and invokes delivery once. Messages joined to the active turn do not create another stream consumer.
- **Rationale:** Agent runtime already merges joined inputs into the active turn. Multiple consumers would duplicate output and terminal handling.
- **Alternatives considered:** Bind one output consumer to every input message. `send(ifBusy: "join")` does not produce an independent stream.

### D9: Use a narrow ChannelRuntime interface

- **Choice:** ChannelRuntime exposes `handle(message, session)`, `reset(scope)`, and `stop()` and does not return classification, turn IDs, Agent handles, or streams.
- **Rationale:** Callers should not participate in internal orchestration. Storage, delivery events, and diagnostics provide the observable behavior needed by tests and operators.
- **Alternatives considered:** Return an internal submission result. That surface would couple callers to append/join/run implementation details.

### D10: Make DeliveryService a Koishi-first orchestration module

- **Choice:** Delivery exposes passive `reply(session, outputs)`, target `send(source, scope, outputs)`, and status `subscribe(listener)` operations. Outputs are ordered Koishi fragments.
- **Rationale:** Passive and proactive operations have different context requirements, while both need shared ordering, result normalization, diagnostics, and status events.
- **Alternatives considered:** A single platform-neutral target request. It cannot preserve Session/referrer semantics. Per-platform delivery adapters would duplicate MessageEncoder.

### D11: Report conservative delivery states

- **Choice:** Delivery reports `started`, `sent`, `partial`, or `failed` and preserves the message ID arrays returned by Koishi. Operational failures return structured receipts; subscriber failures only produce diagnostics.
- **Rationale:** Both Session.send and Bot.sendMessage return message ID arrays, but neither Koishi nor Satori guarantees that a successful array is non-empty or provides a universal delivered/read acknowledgement.
- **Alternatives considered:** Accepted, delivered, read, retryable, or exactly-once states. The current platform contracts cannot prove those outcomes.

### D12: Preserve reset and persistence ownership

- **Choice:** Reset remains `interrupt -> stop -> storage clear -> asset clear -> cache delete`. `scope.channelType` enters `Platform.MessageRecord`. Delivery events remain process-local.
- **Rationale:** Reset must coordinate the Agent, history, assets, and cache under the same channel FIFO. Persisting channel type keeps restored messages canonical.
- **Alternatives considered:** Guess channel type when reading old records or persist delivery events in channel JSONL. Both mix incompatible semantics into current storage.

## Risks / Trade-offs

- **[Risk] Existing JSONL records lack `scope.channelType`.** Mitigation: treat the contract change as breaking and use a one-time development-data migration or reset; do not keep heuristic runtime fallback code.
- **[Risk] Session lifetime extends through model execution.** Mitigation: retain Session only for the active handle call and turn stream; do not persist it, place it in Agent state, or use it for scheduled work.
- **[Risk] A successful send may return no message IDs.** Mitigation: keep `messageIds` as an array that may be empty and define `sent` as successful completion of the Koishi send call.
- **[Risk] A delivery implementation could duplicate MessageEncoder behavior.** Mitigation: pass Koishi fragments through Session/Bot and leave encoding, splitting, upload, and platform API calls to Koishi adapters.
- **[Risk] Delivery listeners could delay or break output.** Mitigation: make listeners observational, isolate thrown and rejected errors, and keep receipt state independent from listener completion.
- **[Trade-off] The first routing policy remains simple.** The design favors a correct execution foundation over speculative willingness, scheduler, or LLM-decision infrastructure.
- **[Trade-off] ChannelRuntime depends on Koishi Session.** The dependency remains in the Koishi core package while `@yesimbot/agent-runtime` stays generic.

## Migration Plan

Implementation sequencing is deferred to a later plan. Any implementation and rollout MUST keep the message-contract change, Session-routing removal, ChannelRuntime ownership, and DeliveryService adoption consistent as one migration. Replacement behavior MUST retain the accepted FIFO, joined-turn, reset, persistence, and error contracts before the old orchestration path is removed.

Rollback requires reverting the contract and implementation together. The runtime does not support mixed JSONL records with and without `scope.channelType`, and it MUST NOT introduce a long-lived fallback to infer that field.

## Open Questions

None. File layout, implementation sequencing, and test command selection belong to a later plan and are intentionally absent from this change draft.
