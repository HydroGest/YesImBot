## Context

A channel runtime already accepts a host-owned `MessageRecord` or `EventRecord` after RuntimeManager selects the channel tuple. It persists the input, publishes a Core event, asks Will whether to wait or trigger, and exposes one output iterable only when it starts a turn. Both built-in Will engines return `wait` for an Event, so the existing route path records an autonomous event but cannot make the Agent act on it.

Gateway adapts that output iterable to the live inbound Session. It holds the paced delivery loop, first-success acknowledgement, cancellation checks, and same-channel `delivery.failed` feedback. A Core or plugin trigger has no Session, while the matching Bot can send to the record's channel.

## Goals / Non-Goals

**Goals:**

- Give Core and trusted in-process plugins one typed, Session-free operation that initiates autonomous Agent work in a declared channel.
- Preserve the per-channel FIFO, durable event history, event observation, single output consumer, and active-turn join behavior.
- Deliver autonomous replies through the Bot selected by the event's `platform` and `selfId` while preserving current delivery semantics.
- Keep RuntimeManager free of Session and platform-send responsibilities.

**Non-Goals:**

- Accept external, user-supplied trigger requests or re-run Gateway allowlist and assignee admission.
- Create synthetic Sessions, a public RuntimeManager API, a public delivery abstraction, or a second output consumer.
- Treat triggered event text as trusted system instructions or expose declaration-merged extension fields to the model.
- Add scheduling, retry, idempotency, queueing, or trigger authorization policy beyond the existing trusted-plugin boundary.

## Decisions

### D1: Expose one facade operation that accepts a complete EventRecord

- **Choice:** Add `YesImBotService.trigger<K extends keyof EventMap>(event: EventRecord<K>): Promise<void>`.
- **Reason:** `EventRecord` already forms the public, declaration-mergeable event contract and names the destination identity. A complete record makes the trigger independent of a Session and avoids a second scope-plus-draft contract.
- **Considered alternative:** Expose RuntimeManager or accept `ChannelScope` plus a new event draft. Both leak or duplicate internal routing contracts.

The operation accepts Events only. A manually created record must not represent a user Message.

### D2: Separate trusted-host event ingress from Session ingress

- **Choice:** Gateway remains the authority that builds final records from a Resolver draft and a Session. The facade accepts a final EventRecord only from trusted Core or plugin code.
- **Reason:** The two paths have different sources. Gateway must keep refusing Draft-owned platform envelope fields, while a host trigger needs no Session envelope.
- **Considered alternative:** Fabricate a Session and send it to Gateway. That would extend Session lifetime outside inbound dispatch and blur external admission with trusted host work.

`trigger()` does not reapply `allowedChannels` or shared-assignee admission. Those controls protect external Session ingress, while installed Core and plugins already hold trusted process capabilities.

### D3: Forced events append and observe, then run or join without Will

- **Choice:** `ChannelRuntime.trigger(event)` enters the existing channel FIFO, appends the Event, emits `yesimbot/event`, and bypasses `WillEngine.decide()`. It starts a turn while idle and joins the active turn while busy.
- **Reason:** Both built-in Will engines intentionally wait for Events. Autonomous work needs an explicit host-owned force path without changing normal Session routing.
- **Considered alternative:** Add an Event rule to Will configuration. That would turn trusted scheduling policy into a global ingress routing setting and alter ordinary platform-event behavior.

The forced path emits no `yesimbot/will` observation because it makes no Will decision. A successfully delivered first segment still invokes the existing result acknowledgement so Will state can apply its existing reply notification.

### D4: Keep transport at the service facade and share the delivery loop

- **Choice:** Extract Gateway's delivery loop into the private top-level `core/src/delivery.ts` function. `Gateway` invokes it with `Session.send()`. `YesImBotService.trigger()` invokes it with `Bot.sendMessage(event.channel.id, segment)` after RuntimeManager returns the internal run result.
- **Reason:** The function owns common delivery behavior, while each caller owns the transport capability appropriate to its ingress path. RuntimeManager continues to own runtime lifecycle and does not send platform messages.
- **Considered alternative:** Let RuntimeManager send through Bot. That conflicts with its existing transport boundary and makes runtime lifecycle code own platform delivery.

The function consumes a running result once. A join result creates no second consumer; the active turn's existing owner continues delivery.

### D5: Resolve the autonomous Bot before starting a turn

- **Choice:** `YesImBotService.trigger()` resolves the current Bot that exactly matches the event platform and self ID before it requests the forced runtime operation.
- **Reason:** Core avoids spending a model turn on an output that cannot be sent and uses the explicit target named by the event.
- **Considered alternative:** Start the turn and find a Bot when output arrives. Bot disappearance would create an avoidable model call and blur the operation's admission failure.

No matching Bot rejects the operation without appending the event.

### D6: Preserve segment delivery and failure semantics

- **Choice:** Shared delivery keeps the existing segment order, pacing, AbortSignal checks, first-success `onDelivered()` call, and failure feedback shape.
- **Reason:** An autonomous reply must have the same observable delivery contract as a passive reply.
- **Considered alternative:** Use Bot delivery as a fire-and-forget send or return the output stream to the plugin. Either loses acknowledgement, failure persistence, or single-consumer ownership.

A resolved empty message-ID array counts as a successful Bot send. A rejected segment sends exactly one same-channel `delivery.failed` event and stops later segments. A model or turn-stream failure rejects `trigger()` so the caller retains retry policy.
`core/tests/delivery.test.ts` will test the shared helper directly. `core/tests/gateway-delivery.test.ts` will retain Session-adapter coverage, and `core/tests/service.test.ts` will cover the Bot adapter through the public facade.

### D7: Preserve event model projection

- **Choice:** Triggered Events use the current event projection, which exposes `eventType` and frozen `text` inside the untrusted event wrapper.
- **Reason:** Forcing a turn controls execution, not the authority of event content. Structured extension fields remain available to plugins and observers without entering the model prompt by default.
- **Considered alternative:** Add a trusted prompt class or project every extension field. That would create a second event trust model and leak host data into model context.

## Risks / Trade-offs

- [Risk] A trusted plugin can trigger model work and send to any channel it names. → Mitigation: retain the existing trust boundary for installed Core and plugins; do not expose the operation to external Sessions.
- [Risk] Bot availability can change between trigger calls. → Mitigation: resolve the exact Bot before the event enters the forced path and reject when absent.
- [Risk] Shared delivery refactoring can change passive behavior. → Mitigation: preserve the current delivery contract with tests that run the same cases through both Session and Bot sender adapters.
- [Trade-off] `trigger()` returns no assistant content or message IDs. → Acceptance: Core owns delivery and output iteration; callers retain event observation and plugin hooks without competing consumers.
- [Trade-off] Forced events bypass Will scoring and probability decisions. → Acceptance: the caller explicitly requests an autonomous turn; successful delivery still performs the existing reply acknowledgement.

## Migration Plan

The change adds an additive facade operation and keeps the JSONL EventRecord format unchanged. No data migration, configuration migration, or deployment ordering is required.

Rollback removes the facade operation and its force path. Existing triggered events remain valid current-format `yesimbot.event` records; an earlier runtime can retain them as historical Events even though it cannot initiate new triggers.

## Open Questions

None. The user confirmed the forced-run semantics, complete `EventRecord` input, Core-owned output consumption, Bot transport at `YesImBotService`, and the inherited delivery failure contract.
